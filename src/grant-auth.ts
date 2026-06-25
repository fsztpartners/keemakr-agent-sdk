// Capability-grant verification for a remote keemakr agent.
//
// The keemakr operator attaches a short-lived signed JWT — a "capability grant" —
// on every delegation. It carries a VERIFIABLE tenant id + scopes (+ a trace id),
// signed with keemakr-core's RS256 key and verifiable against the JWKS it
// publishes at /.well-known/jwks.json.
//
// grantAuth() returns an eve AuthFn that verifies the grant against core's JWKS
// and surfaces the tenant + scopes (and the raw grant, for useKee to forward) on
// the session auth context. Use it as the PRIMARY inbound auth in your channel.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { type AuthFn, extractBearerToken } from 'eve/channels/auth';
import type { SessionAuthContext } from 'eve/context';

// The issuer keemakr-core mints grants with.
const GRANT_ISSUER = 'keemakr';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwksFor(url: string) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(url));
  return jwks;
}

/**
 * An eve AuthFn that accepts a keemakr capability grant. Returns a principal
 * carrying `tenant_id`, `scopes`, and the raw `grant_token` in attributes on
 * success, or `null` to skip to the next auth entry (so it composes before any
 * fallback).
 *
 * Environment:
 *   KEE_CORE_JWKS_URL   keemakr-core's JWKS endpoint
 *                       (e.g. https://app.keemakr.com/.well-known/jwks.json).
 *                       If unset, this AuthFn skips entirely (grant path off).
 *   KEE_AGENT_AUDIENCE  this deployment's audience — the runtime URL's origin —
 *                       matching the `aud` the operator mints. If unset, the
 *                       audience check is skipped (dev convenience only).
 */
export function grantAuth(opts?: { jwksUrl?: string; audience?: string }): AuthFn<Request> {
  return async (request) => {
    const jwksUrl = opts?.jwksUrl ?? process.env.KEE_CORE_JWKS_URL;
    if (!jwksUrl) return null;

    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) return null;

    const expectedAud = opts?.audience ?? process.env.KEE_AGENT_AUDIENCE;
    try {
      const { payload } = await jwtVerify(token, jwksFor(jwksUrl), {
        issuer: GRANT_ISSUER,
        ...(expectedAud ? { audience: expectedAud } : {}),
      });
      const tenantId = payload.tenant_id;
      const scopes = payload.scopes;
      const installedAgent = payload.installed_agent;
      const traceId = payload.trace_id;
      if (typeof tenantId !== 'string' || !Array.isArray(scopes)) return null;

      return {
        authenticator: 'keemakr-grant',
        issuer: GRANT_ISSUER,
        principalId: typeof installedAgent === 'string' ? installedAgent : 'keemakr-agent',
        principalType: 'service',
        subject: typeof payload.sub === 'string' ? payload.sub : undefined,
        attributes: {
          via: 'grant',
          tenant_id: tenantId,
          scopes: scopes.map(String),
          grant_token: token,
          ...(typeof traceId === 'string' ? { trace_id: traceId } : {}),
        },
      } satisfies SessionAuthContext;
    } catch {
      return null;
    }
  };
}
