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

A call whose grant lacks the required scope returns a `KeeError` with `status: 403`; an expired/invalid grant returns `status: 401`.

## Security model

- **Tenant always comes from the verified grant**, resolved server-side. Never pass a tenant id from tool input.
- **On the proxy path, credentials never leave keemakr-core.** You send operation args; core runs the third-party request with the tenant's credential and returns only the result.
- **The token path is opt-in and scope-gated** (`conn:<provider>:token`), declared per dependency in your `entry.json` (`"access": "token"`).
- Every capability call re-verifies the grant and enforces scope on the server.

## License

MIT
