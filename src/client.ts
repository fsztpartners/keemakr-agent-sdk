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
  body?: unknown,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
): Promise<unknown> {
  const url = `${coreBaseUrl()}/api/capability/${path}`;
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const res = await fetch(url, {
    method,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${grant.token}`,
      ...(grant.traceId ? { 'x-keemakr-trace-id': grant.traceId } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}),
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
  /** Pin subsequent calls to one tenant-scoped connected account row. */
  account(connectionId: string): KeeConnection;
}

/** One stored memory entry. */
export interface MemoryEntry {
  namespace: string;
  key: string;
  value: unknown;
  written_by_agent: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Cross-session, tenant-owned key-value memory. TENANT-SHARED: any of the
 * tenant's installed agents can read/write any namespace. For per-session working
 * memory use eve's defineState instead — this is for state that must outlive the
 * session. Requires the `memory:rw` scope.
 */
/** A semantic-search hit — a memory entry with its similarity score. */
export interface MemorySearchHit extends MemoryEntry {
  /** Cosine similarity in [0,1] (1 = identical). */
  score: number;
}

export interface KeeMemory {
  /** Read a key's value, or null if absent. */
  get(namespace: string, key: string): Promise<unknown | null>;
  /** Read the full entry (value + provenance + timestamps), or null. */
  getEntry(namespace: string, key: string): Promise<MemoryEntry | null>;
  /** Write a key. Returns the stored entry. */
  set(namespace: string, key: string, value: unknown): Promise<MemoryEntry>;
  /** Delete a key. Returns whether it existed. */
  delete(namespace: string, key: string): Promise<boolean>;
  /** List every entry in a namespace (tenant-wide). */
  list(namespace: string): Promise<MemoryEntry[]>;
  /** Semantic search by meaning. Optionally scope to a namespace. */
  search(
    query: string,
    opts?: { namespace?: string; limit?: number },
  ): Promise<MemorySearchHit[]>;
}

/** Platform registry tools (Shape B) — defined in core, run server-side. */
export interface KeeTools {
  /** List the registry tools this grant is entitled to. */
  list(): Promise<Array<{ name: string; description: string; requiredScope?: string }>>;
  /** Run a registry tool by name and return its result. Requires `tools:run`. */
  run(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface Kee {
  tenantId: string;
  scopes: string[];
  connections: Record<string, KeeConnection> & {
    /** Explicit accessor (equivalent to kee.connections[provider]). */
    get(provider: string): KeeConnection;
  };
  memory: KeeMemory;
  tools: KeeTools;
}

/**
 * Build a tenant-scoped capability client from a tool's context. Call inside a
 * tool's execute: `const kee = useKee(ctx)`.
 */
export function useKee(ctx: KeeContext): Kee {
  const grant = readGrant(ctx);

  const connectionFor = (provider: string, connectionId?: string): KeeConnection => ({
    async call(op, args) {
      const json = (await capabilityFetch(grant, `conn/${provider}/${op}`, {
        ...(connectionId ? { connection_id: connectionId } : {}),
        args: args ?? {},
      })) as { result?: unknown };
      return json.result;
    },
    async token() {
      const json = (await capabilityFetch(grant, `conn/${provider}/token`, {
        ...(connectionId ? { connection_id: connectionId } : {}),
      })) as {
        access_token: string;
        account_label: string | null;
      };
      return { access_token: json.access_token, account_label: json.account_label };
    },
    account(accountId) {
      return connectionFor(provider, accountId);
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

  const enc = encodeURIComponent;
  const memory: KeeMemory = {
    async getEntry(namespace, key) {
      try {
        const json = (await capabilityFetch(
          grant,
          `memory/${enc(namespace)}/${enc(key)}`,
          undefined,
          'GET',
        )) as { entry?: MemoryEntry };
        return json.entry ?? null;
      } catch (e) {
        if ((e as KeeError).status === 404) return null;
        throw e;
      }
    },
    async get(namespace, key) {
      const entry = await this.getEntry(namespace, key);
      return entry ? entry.value : null;
    },
    async set(namespace, key, value) {
      const json = (await capabilityFetch(
        grant,
        `memory/${enc(namespace)}/${enc(key)}`,
        { value },
        'PUT',
      )) as { entry: MemoryEntry };
      return json.entry;
    },
    async delete(namespace, key) {
      const json = (await capabilityFetch(
        grant,
        `memory/${enc(namespace)}/${enc(key)}`,
        undefined,
        'DELETE',
      )) as { deleted: boolean };
      return !!json.deleted;
    },
    async list(namespace) {
      const json = (await capabilityFetch(
        grant,
        `memory/${enc(namespace)}`,
        undefined,
        'GET',
      )) as { entries?: MemoryEntry[] };
      return json.entries ?? [];
    },
    async search(query, opts) {
      const json = (await capabilityFetch(grant, 'memory/search', {
        query,
        namespace: opts?.namespace,
        limit: opts?.limit,
      })) as { hits?: MemorySearchHit[] };
      return json.hits ?? [];
    },
  };

  const tools: KeeTools = {
    async list() {
      const json = (await capabilityFetch(grant, 'tools', undefined, 'GET')) as {
        tools?: Array<{ name: string; description: string; requiredScope?: string }>;
      };
      return json.tools ?? [];
    },
    async run(name, args) {
      const json = (await capabilityFetch(grant, `tools/${encodeURIComponent(name)}`, {
        args: args ?? {},
      })) as { result?: unknown };
      return json.result;
    },
  };

  return { tenantId: grant.tenantId, scopes: grant.scopes, connections, memory, tools };
}
