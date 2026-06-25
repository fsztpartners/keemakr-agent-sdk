// useKee(ctx) — the tenant-scoped capability client a marketplace agent's tools
// use to reach tenant data through keemakr-core. It reads the verified grant off
// the session auth context (put there by grantAuth) and calls back into core's
// /api/capability/* endpoints, forwarding the grant. Core re-verifies the grant
// and enforces scope on every call; the SDK never sees a raw credential on the
// proxy path.

export interface KeeError extends Error {
  status?: number;
}

function keeError(message: string, status?: number): KeeError {
  const e = new Error(message) as KeeError;
  e.name = 'KeeError';
  e.status = status;
  return e;
}

// The slice of eve's ToolContext we read. Kept structural so the SDK doesn't
// hard-depend on a specific eve type export.
export interface KeeContext {
  session?: {
    auth?: {
      current?: {
        attributes?: Record<string, string | readonly string[] | undefined> | null;
      } | null;
    } | null;
  } | null;
}

interface GrantInfo {
  token: string;
  tenantId: string;
  scopes: string[];
  traceId?: string;
}

function readGrant(ctx: KeeContext): GrantInfo {
  const attrs = ctx?.session?.auth?.current?.attributes ?? {};
  const token = typeof attrs.grant_token === 'string' ? attrs.grant_token : undefined;
  const tenantId = typeof attrs.tenant_id === 'string' ? attrs.tenant_id : undefined;
  const scopes = Array.isArray(attrs.scopes) ? [...attrs.scopes] : [];
  const traceId = typeof attrs.trace_id === 'string' ? attrs.trace_id : undefined;
  if (!token || !tenantId) {
    throw keeError(
      'no capability grant on the session — was the request authenticated with grantAuth()?',
      401,
    );
  }
  return { token, tenantId, scopes, traceId };
}

// Resolve core's base URL. Prefer KEE_CORE_URL; otherwise derive it from the
// JWKS URL by stripping the well-known path.
function coreBaseUrl(): string {
  const explicit = process.env.KEE_CORE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const jwks = process.env.KEE_CORE_JWKS_URL;
  if (jwks) return jwks.replace(/\/\.well-known\/jwks\.json\/?$/, '');
  throw keeError('KEE_CORE_URL (or KEE_CORE_JWKS_URL) must be set to reach the Capability API');
}

async function capabilityFetch(
  grant: GrantInfo,
  path: string,
  body: unknown,
): Promise<unknown> {
  const url = `${coreBaseUrl()}/api/capability/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${grant.token}`,
      ...(grant.traceId ? { 'x-keemakr-trace-id': grant.traceId } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
    [k: string]: unknown;
  };
  if (!res.ok) {
    throw keeError(json.error ?? `capability request failed (${res.status})`, res.status);
  }
  return json;
}

/** Per-provider connection surface. */
export interface KeeConnection {
  /** Run a named proxy operation. The credential stays in core. */
  call(op: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Request a short-lived scoped token (opt-in; requires the conn:<p>:token scope). */
  token(): Promise<{ access_token: string; account_label: string | null }>;
}

export interface Kee {
  tenantId: string;
  scopes: string[];
  connections: Record<string, KeeConnection> & {
    /** Explicit accessor (equivalent to kee.connections[provider]). */
    get(provider: string): KeeConnection;
  };
}

/**
 * Build a tenant-scoped capability client from a tool's context. Call inside a
 * tool's execute: `const kee = useKee(ctx)`.
 */
export function useKee(ctx: KeeContext): Kee {
  const grant = readGrant(ctx);

  const connectionFor = (provider: string): KeeConnection => ({
    async call(op, args) {
      const json = (await capabilityFetch(grant, `conn/${provider}/${op}`, {
        args: args ?? {},
      })) as { result?: unknown };
      return json.result;
    },
    async token() {
      const json = (await capabilityFetch(grant, `conn/${provider}/token`, {})) as {
        access_token: string;
        account_label: string | null;
      };
      return { access_token: json.access_token, account_label: json.account_label };
    },
  });

  const connections = new Proxy(
    { get: connectionFor } as Record<string, KeeConnection> & {
      get(provider: string): KeeConnection;
    },
    {
      get(target, prop: string) {
        if (prop === 'get') return connectionFor;
        return connectionFor(prop);
      },
    },
  );

  return { tenantId: grant.tenantId, scopes: grant.scopes, connections };
}
