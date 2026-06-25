// keemakrToolDirectory — a defineDynamic file that surfaces the platform's
// registry tools (Shape B) to an agent at session start, with NO redeploy.
//
// Drop it into your agent in one line:
//   // agent/tools/keemakr-directory.ts
//   export { keemakrToolDirectory as default } from '@keemakr/agent-sdk/tool-directory';
//
// On session.started it reads the verified grant off the session, asks
// keemakr-core which registry tools this install is entitled to, and synthesizes
// one delegation tool per entry. Each synthesized tool's execute calls
// useKee(ctx).tools.run(name, args) — so the tool runs IN CORE, governed
// centrally: a fix or a new tool in core's registry reaches every agent next
// session, no redeploy here. Mirrors keemakr-core's marketplace-dispatch.ts.

import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { useKee, type KeeContext } from './client.js';

export const keemakrToolDirectory = defineDynamic({
  events: {
    'session.started': async (_event, ctx) => {
      // No grant on the session (e.g. local dev without grantAuth) → no tools.
      let kee;
      try {
        kee = useKee(ctx as KeeContext);
      } catch {
        return null;
      }

      let entries: Array<{ name: string; description: string }>;
      try {
        entries = await kee.tools.list();
      } catch {
        return null;
      }
      if (!entries.length) return null;

      // One delegation tool per entitled registry tool. The args are passed
      // through as a generic object; core validates them against the tool's real
      // schema and returns a typed error if they don't fit. (Names are namespaced
      // `kee__<name>` to avoid colliding with the agent's own tools.)
      const pairs = entries.map((t) => {
        const name = t.name;
        const tool = defineTool({
          description: `${t.description} (keemakr platform tool, runs server-side)`,
          inputSchema: z.object({
            args: z
              .record(z.string(), z.unknown())
              .optional()
              .describe('Arguments for the tool, per its description.'),
          }),
          execute: async ({ args }) => {
            const result = await useKee(ctx as KeeContext).tools.run(name, args ?? {});
            return { ok: true, tool: name, result };
          },
        });
        return [`kee__${name.replace(/[^a-z0-9]+/gi, '_')}`, tool] as const;
      });

      return Object.fromEntries(pairs);
    },
  },
});
