# feature-semaphore

A self-hostable feature flag service.

## Why does this exist?

Feature-flagging platforms like [Unleash](https://www.getunleash.io/) and
[Flagsmith](https://www.flagsmith.com/) already exist, are open source, and are good at
what they do. This project exists as a deliberately smaller, self-hostable
implementation focused on one thing done precisely: deterministic, side-effect-free
flag evaluation shared byte-for-byte between the server and the Node SDK, with a
transparent "why did this user see this" evaluation reason on every result.

It is not an attempt to replace either project's feature surface. It is a narrower
system built to be fully understood, with the evaluation core (`packages/core`)
isolated as a pure, zero-dependency, IO-free function that the server and SDK both
compile against — so server-side and client-side evaluation can never diverge.

## What is deliberately out of scope

| Area                                       | Rationale                                                  |
| ------------------------------------------ | ---------------------------------------------------------- |
| Multi-tenant / orgs / teams                | Single-tenant self-host is the target deployment shape     |
| SSO / OAuth / user management              | Out of scope for the evaluation-engine-first MVP           |
| Billing                                    | Not a hosted product                                       |
| Multivariate flags (>2 values)             | Bucket space is designed to allow it later; not built now  |
| Experimentation / statistical significance | This is a flagging system, not an experimentation platform |
| SSE / WebSocket streaming updates          | Polling + ETag caching is sufficient for the SDK's needs   |
| Non-Node SDKs                              | Node is the only supported SDK runtime for the MVP         |

## Workspace layout

```
packages/
  core/    — pure domain: evaluate(), bucket(), matches(), rolloutThreshold()
```

`packages/core` has zero runtime dependencies and performs no IO. Every other package
in the eventual system (`server`, `sdk-node`, `dashboard`, `e2e`) compiles against it
without duplicating evaluation logic.

## Scripts

| Script                    | What it does                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm test`               | Run the test suite (`vitest run`)                                                    |
| `pnpm test:coverage`      | Run tests with the coverage gate                                                     |
| `pnpm lint`               | ESLint over the whole workspace                                                      |
| `pnpm format:check`       | Prettier check                                                                       |
| `pnpm typecheck`          | `tsc -b` across the solution (src and tests)                                         |
| `pnpm build`              | Compile `packages/core` to `dist/`                                                   |
| `pnpm vectors:verify`     | Regenerate golden bucketing vectors in memory and diff against the committed fixture |
| `pnpm crosscheck:vectors` | Recompute every golden vector with an independent hash library                       |
