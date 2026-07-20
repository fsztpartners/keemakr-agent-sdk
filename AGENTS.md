# keemakr-agent-sdk

`@keemakr/agent-sdk` — a published TypeScript **library** (the "floor" for building
separately-deployed marketplace agents that the keemakr core delegates to). It is
**not a runnable service**. Peer deps: `eve` + `jose`.

## Commands

| Task      | Command             |
| --------- | ------------------- |
| Install   | `npm install`       |
| Build     | `npm run build` (runs `gen:connectors` then `tsc`) |
| Typecheck | `npm run typecheck` (runs `gen:connectors` then `tsc --noEmit`) |

`gen:connectors` regenerates `src/connectors.generated.ts` and runs automatically
before build/typecheck. Uses plain **npm** (has `package-lock.json`), public registry
only — no auth token needed.

## Cursor Cloud specific instructions

- **Node** v24 is the VM default (engines want `>=20.9`) and is already on `PATH`.
- This is a library, not a service: there is nothing to "run". The startup update
  script keeps deps fresh with `npm install`; verify changes with `npm run build`
  / `npm run typecheck` (both succeed clean in this VM).
