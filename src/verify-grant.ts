// Standalone capability-grant verification — for a scheduled/headless remote.
//
// grantAuth() (grant-auth.ts) is the right entry point for an eve CHANNEL: it
// returns an AuthFn. But an autonomous/machine turn may run OUTSIDE a channel (a
// cron worker that received a machine grant from core's machine-grant endpoint
// and wants to verify it before acting). verifyGrant() is that path: give it the
// token, get back the trusted claims (or null), verifying signature + issuer +
// audience against core's JWKS.
//
// A machine grant is the SAME token shape as a session grant (same issuer, aud,
// tenant_id, scopes) — only the TTL and the mint path differ — so this one
// verifier covers both.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const GRANT_ISSUER = 'keemakr';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwksFor(url: string) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(url));
  return jwks;
}

/** Trusted claims after verifyGrant() succeeds. */
export interface VerifiedGrant {
  tenantId: string;
  installedAgent: string | null;
  scopes: string[];
  traceId: string | null;
  aud: string | null;
  exp: number | null;
}

/**
 * Verify a capability grant (session OR machine) against keemakr-core's JWKS.
 * Returns the trusted claims, or `null` on any failure (bad signature, wrong
 * issuer/audience, expired). Both `jwksUrl` and `audience` fall back to
 * KEE_CORE_JWKS_URL / KEE_AGENT_AUDIENCE. `audience` is strongly recommended: a
 * grant is only valid for the remote it was minted for.
 */
export async function verifyGrant(
  token: string,
  opts?: { jwksUrl?: string; audience?: string },
): Promise<VerifiedGrant | null> {
  const jwksUrl = opts?.jwksUrl ?? process.env.KEE_CORE_JWKS_URL;
  if (!jwksUrl) return null;
  const expectedAud = opts?.audience ?? process.env.KEE_AGENT_AUDIENCE;
  try {
    const { payload } = await jwtVerify(token, jwksFor(jwksUrl), {
      issuer: GRANT_ISSUER,
      ...(expectedAud ? { audience: expectedAud } : {}),
    });
    if (typeof payload.tenant_id !== 'string' || !Array.isArray(payload.scopes)) return null;
    return {
      tenantId: payload.tenant_id,
      installedAgent:
        typeof payload.installed_agent === 'string' ? payload.installed_agent : null,
      scopes: payload.scopes.map(String),
      traceId: typeof payload.trace_id === 'string' ? payload.trace_id : null,
      aud: typeof payload.aud === 'string' ? payload.aud : null,
      exp: typeof payload.exp === 'number' ? payload.exp : null,
    };
  } catch {
    return null;
  }
}
