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

## Quick start

```bash
pnpm install
pnpm build

# The admin key must match fs_admin_<43 url-safe base64 characters>.
# Startup fails if ADMIN_API_KEY is unset or malformed.
export ADMIN_API_KEY="fs_admin_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"

DATABASE_DRIVER=memory node packages/server/dist/main/index.js
```

Then confirm it is up. `/healthz` and `/readyz` sit outside `/api/v1` and need no key:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/healthz   # 200 once the process is alive
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/readyz    # 503 until migrations and seeding finish, then 200
```

There is no `pnpm start` script yet — run the built entrypoint directly.

### Configuration

| Variable          | Default    | Notes                                                         |
| ----------------- | ---------- | ------------------------------------------------------------- |
| `ADMIN_API_KEY`   | _required_ | `fs_admin_<43 chars>`. Stored as a SHA-256 hash, never logged |
| `DATABASE_DRIVER` | `postgres` | `memory`, `sqlite`, or `postgres`                             |
| `DATABASE_URL`    | —          | Required when the driver is `postgres`                        |
| `SQLITE_FILE`     | —          | Required when the driver is `sqlite`                          |
| `PORT`            | `3000`     |                                                               |
| `HOST`            | `0.0.0.0`  |                                                               |

Migrations run at startup under a lock, so two instances can boot simultaneously without racing.

## Using the management API

Every `/api/v1` route needs an admin key. A missing or malformed key is `401`; a
`server`-kind key on a management route is `403`.

```bash
export FS="Authorization: Bearer $ADMIN_API_KEY"
```

| Method  | Path                                       | Purpose                                 |
| ------- | ------------------------------------------ | --------------------------------------- |
| `GET`   | `/api/v1/flags`                            | List every flag with both environments  |
| `POST`  | `/api/v1/flags`                            | Create a flag (`409` if the key exists) |
| `GET`   | `/api/v1/flags/:key`                       | One flag, both environments             |
| `PATCH` | `/api/v1/flags/:key/config/:env`           | Toggle, change rollout or on/off values |
| `PUT`   | `/api/v1/flags/:key/config/:env/rules`     | Replace the ordered rule set            |
| `PUT`   | `/api/v1/flags/:key/config/:env/overrides` | Replace per-unit overrides              |
| `POST`  | `/api/v1/flags/:key/archive`               | Archive, never delete (`204`)           |
| `GET`   | `/api/v1/flags/:key/audit`                 | Change history, `?limit=` up to 500     |

`:env` is `development` or `production`. Anything else is `400` — "that is not an
environment" — never `403`, which means "your key is the wrong kind".

### Creating a flag

```bash
curl -X POST localhost:3000/api/v1/flags -H "$FS" \
  -H 'Content-Type: application/json' \
  -d '{"key":"new-checkout","name":"New checkout"}'
```

Both environments are seeded at version `1`, disabled, with an independent random salt.

### Changing config: the `If-Match` contract

Reads carry a `version` inside each environment block and emit **no** `ETag`, because
the two environments have independent counters and no single value could honestly
represent both. Mutations act on one environment, so they do emit one.

```bash
# 1. Read the version you intend to replace
curl -s localhost:3000/api/v1/flags/new-checkout -H "$FS" \
  | jq '.environments.development.version'          # 1

# 2. Send it back as If-Match
curl -i -X PATCH localhost:3000/api/v1/flags/new-checkout/config/development -H "$FS" \
  -H 'If-Match: "1"' -H 'Content-Type: application/json' \
  -d '{"enabled":true,"rollout_percentage":12.34}'  # 200, ETag: "2", body {"version":2}
```

Three failure modes stay distinct, so a client can tell them apart:

| Status | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| `428`  | `If-Match` absent — the header is required, not optional |
| `400`  | `If-Match` malformed, or the body failed validation      |
| `412`  | The version moved since you read it; re-read and retry   |

Versions are per environment. A `412` on `production` says nothing about `development`.

`rollout_percentage` accepts two decimals. `33.333` is rejected with `400` rather than
silently rounded, because storing a value the engine will not honour is worse than
refusing it.

### Targeting rules

Rules are an ordered set and the first attribute match wins. A rollout miss on a
matched rule is terminal — evaluation does not fall through to the next rule.

```bash
curl -X PUT localhost:3000/api/v1/flags/new-checkout/config/development/rules -H "$FS" \
  -H 'If-Match: "2"' -H 'Content-Type: application/json' \
  -d '{"rules":[{"attribute":"plan","operator":"in","values":["pro"],"serve":true,"rollout":100}]}'
```

| Operator                  | `values` shape      |
| ------------------------- | ------------------- |
| `in`, `not_in`            | array of any length |
| `contains`, `starts_with` | exactly one string  |
| `gt`, `lt`                | exactly one number  |

Absent attributes do not match, string comparison is case-sensitive, and `gt`/`lt` are
numeric-only with no coercion.

Errors across the whole surface are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
`application/problem+json`.

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
  core/      — pure domain: evaluate(), bucket(), matches(), rolloutThreshold()
  server/    — application/ (ports, use cases), infrastructure/ (persistence, http), main/
```

`packages/core` has zero runtime dependencies and performs no IO. Every other package
in the eventual system (`server`, `sdk-node`, `dashboard`, `e2e`) compiles against it
without duplicating evaluation logic.

`packages/server` is hexagonal: `application/` owns the ports and use cases and imports
nothing from `infrastructure/`, which holds the three interchangeable persistence
adapters (in-memory, SQLite, Postgres) and the HTTP layer. All three adapters pass one
shared contract suite, so they cannot drift apart.

## Scripts

| Script                    | What it does                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm test`               | Run the test suite (`vitest run`)                                                    |
| `pnpm test:coverage`      | Run tests with the coverage gate                                                     |
| `pnpm lint`               | ESLint over the whole workspace                                                      |
| `pnpm format:check`       | Prettier check                                                                       |
| `pnpm typecheck`          | `tsc -b` across the solution (src and tests)                                         |
| `pnpm build`              | Compile `packages/core` and `packages/server` to their `dist/`                       |
| `pnpm vectors:verify`     | Regenerate golden bucketing vectors in memory and diff against the committed fixture |
| `pnpm crosscheck:vectors` | Recompute every golden vector with an independent hash library                       |

`pnpm test` skips the Postgres leg of the persistence contract suite unless `DATABASE_URL`
is set — 19 tests, reported as skipped rather than silently absent. Set it to run all of
them: `DATABASE_URL=postgres://localhost:5432/postgres pnpm test`.
