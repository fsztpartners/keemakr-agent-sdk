// @keemakr/agent-sdk — the floor for keemakr marketplace agents.
//
// Inbound: verify the operator's capability grant in your channel.
//   import { grantAuth } from '@keemakr/agent-sdk';
//   export default eveChannel({ auth: [localDev(), grantAuth()] });
//
// Inside a tool: reach tenant data through keemakr-core, without holding secrets.
//   import { useKee } from '@keemakr/agent-sdk';
//   const kee = useKee(ctx);
//   const r = await kee.connections.hunter.call('email-finder', { domain, first_name, last_name });

export { grantAuth } from './grant-auth.js';
export { verifyGrant, type VerifiedGrant } from './verify-grant.js';
export {
  useKee,
  type Kee,
  type KeeConnection,
  type KeeContext,
  type KeeError,
  type KeeMemory,
  type KeeTools,
  type MemoryEntry,
  type MemorySearchHit,
} from './client.js';
export { keemakrToolDirectory } from './tool-directory.js';
