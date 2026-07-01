// @keemakr/agent-sdk/connectors — the generated connector manifest.
//
// A typed, metadata-only view of keemakr-core's connector catalog so an agent
// author (and the port kit) can discover providers + operation names + their arg
// schemas WITHOUT scanning a core checkout or hitting a running instance. Credential-
// free by construction — this is the same data GET /api/connections/catalog serves,
// committed as a snapshot (src/connectors.snapshot.json) and codegen'd into
// connectors.generated.ts. Refresh: see scripts/gen-connectors.mjs.
//
// Usage:
//   import { connectors, opNames } from '@keemakr/agent-sdk/connectors';
//   connectors.hunter.ops['email-finder'].inputSchema; // JSON Schema for the args
//   opNames('meta');                                    // string[] of meta's op names
//   isReady('meta');                                    // false while coming_soon

export {
  connectors,
  type ConnectorName,
  type ConnectorInfo,
  type ConnectorOp,
  type ConnectorOps,
} from './connectors.generated.js';

import { connectors, type ConnectorName } from './connectors.generated.js';

/** All provider slugs in the manifest. */
export function providerNames(): ConnectorName[] {
  return Object.keys(connectors) as ConnectorName[];
}

/** The operation names a provider exposes (empty for a coming_soon stub). */
export function opNames(provider: ConnectorName): string[] {
  return Object.keys(connectors[provider]?.ops ?? {});
}

/** True when the provider's connect path is proven and its operations are callable. */
export function isReady(provider: ConnectorName): boolean {
  return connectors[provider]?.maturity === 'ready';
}
