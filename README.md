# @keemakr/agent-sdk

The floor for **keemakr marketplace agents** — separately deployed eve agents that the keemakr operator delegates to. The SDK gives your agent a stable, secure contract to:

- **verify** the operator's capability grant on every inbound delegation, and
- **reach tenant connections** (and, in later versions, memory and shared tools) through keemakr-core — **without holding raw secrets** and **without resolving the tenant yourself**.

The tenant identity and scopes come from a short-lived signed grant the operator mints per delegation; keemakr-core re-verifies the grant and enforces scope on every capability call. Connection credentials never leave keemakr-core on the default (proxy) path.

## Install

```bash
npm install @keemakr/agent-sdk
```

Peer dependencies (match your eve agent): `eve@0.13.0`, `jose@^6.2.3`.

## Configure

Set these in your deployed agent's environment:

| Variable | Purpose |
|---|---|
| `KEE_CORE_JWKS_URL` | keemakr-core's JWKS endpoint, e.g. `https://app.keemakr.com/.well-known/jwks.json`. Enables grant verification. |
| `KEE_AGENT_AUDIENCE` | This deployment's audience — your runtime URL's origin, e.g. `https://my-agent.example.com`. Must match the audience the operator mints. |
| `KEE_CORE_URL` | keemakr-core's base URL for capability calls, e.g. `https://app.keemakr.com`. (Derived from `KEE_CORE_JWKS_URL` if unset.) |

If `KEE_CORE_JWKS_URL` is unset, `grantAuth()` skips entirely — useful during local development.

## 1. Verify the grant in your channel

`grantAuth()` returns an eve `AuthFn`. Put it ahead of any fallback:

```ts title="agent/channels/eve.ts"
import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { grantAuth } from "@keemakr/agent-sdk";

export default eveChannel({
  auth: [localDev(), vercelOidc(), grantAuth()],
});
```

On success the verified tenant id and scopes are attached to the session auth context, where `useKee` reads them.

## 2. Reach tenant data from a tool

```ts title="agent/tools/find_email.ts"
import { defineTool } from "eve/tools";
import { z } from "zod";
import { useKee } from "@keemakr/agent-sdk";

export default defineTool({
  description: "Find a lead's work email.",
  inputSchema: z.object({
    domain: z.string(),
    first_name: z.string(),
    last_name: z.string(),
  }),
  async execute(args, ctx) {
    const kee = useKee(ctx);
    // Proxy path: the credential stays in keemakr-core; you get the result.
    const result = await kee.connections.hunter.call("email-finder", args);
    return result; // { email, score, status }
  },
});
```

### Connections API

```ts
const kee = useKee(ctx);
kee.tenantId;            // the tenant this delegation is for (from the grant)
kee.scopes;              // the scopes the grant carries

// Proxy (default): run a named operation; the secret never leaves core.
await kee.connections.hunter.call("email-finder", { domain, first_name, last_name });
await kee.connections.get("hunter").call("email-finder", { ... }); // equivalent

// Token (opt-in): only if your entry.json declared `access: "token"` on the
// dependency. Returns a short-lived credential you may use directly.
const { access_token } = await kee.connections.hunter.token();
```

### Discover connectors + operations

`@keemakr/agent-sdk/connectors` ships a generated, typed manifest of every connector keemakr-core exposes — provider slugs, `maturity`, and each operation's name + JSON-Schema arg contract. Use it to discover what's callable (and get autocomplete on provider + op names) **without** scanning a core checkout or hitting a running instance. It's **metadata only** — no credentials.

```ts
import { connectors, opNames, isReady } from "@keemakr/agent-sdk/connectors";

opNames("hunter");                                  // → ["email-finder"]
connectors.hunter.ops["email-finder"].inputSchema;  // JSON Schema for the args
isReady("meta");                                     // false while a connector is coming_soon
connectors.meta.maturity;                            // "coming_soon" | "ready"
```

A `coming_soon` connector is declarable in your `entry.json` `dependencies` today; its operations start callable (and `isReady` flips to `true`) once core ships them — **no change to your agent**.

**Refresh the manifest** after core ships new connectors/operations (it's a committed snapshot of `GET /api/connections/catalog`):

```bash
curl -s "$KEE_CORE_URL/api/connections/catalog" > src/connectors.snapshot.json
npm run gen:connectors    # or: npm run build (runs gen first)
```

### Memory (cross-session, tenant-shared)

```ts
await kee.memory.set("prefs", "tone", { tone: "formal" });
await kee.memory.get("prefs", "tone");          // → { tone: "formal" }
await kee.memory.list("prefs");                  // → entries in the namespace
await kee.memory.delete("prefs", "tone");
// Semantic search by meaning (embeddings):
const hits = await kee.memory.search("how should I speak to the user?", { limit: 5 });
// → [{ namespace, key, value, score, … }]  (score 0–1, nearest first)
```

### Platform tools

```ts
await kee.tools.list();                 // tools this grant is entitled to
await kee.tools.run("current-time");    // run one in keemakr-core
```

A call whose grant lacks the required scope returns a `KeeError` with `status: 403`; an expired/invalid grant returns `status: 401`.

## Autonomous / scheduled runs

A cron/scheduled turn has no operator session, so it gets no session grant. keemakr-core can mint a **machine grant** for it (gated on the tenant's per-install `unattended_consent`). If your remote runs **outside** an eve channel, verify that grant directly:

```ts
import { verifyGrant } from "@keemakr/agent-sdk";

const claims = await verifyGrant(grantToken, { audience: process.env.KEE_AGENT_AUDIENCE });
if (!claims) throw new Error("invalid or expired grant");
// claims.tenantId, claims.scopes, claims.aud, claims.exp
```

Inside an eve channel, `grantAuth()` already accepts machine grants (same token shape) — no extra work.

## Credential & model contract

- **Tenant/service credentials live in keemakr-core**, reached only via the proxy — the credential never crosses the wire. Tenant is always the verified grant, resolved server-side; never pass a tenant id from tool input.
- **The token path is opt-in and scope-gated** (`conn:<provider>:token`), declared per dependency in `entry.json` (`"access": "token"`).
- **You MAY hold your own model key.** There is no platform model gateway today, so an agent routing its own LLM calls (its own Anthropic/AI-Gateway key) is expected and fine — that is *not* a credential leak. A leak is a *tenant/service* credential read in agent code.
- Every capability call re-verifies the grant and enforces scope on the server.

Full contract: keemakr-core `docs/CONNECTOR-CONTRACT.md`.

## License

MIT
