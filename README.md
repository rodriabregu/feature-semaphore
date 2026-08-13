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

### Your first evaluation

Three calls take you from an empty store to an explained evaluation result:

```bash
export FS="Authorization: Bearer $ADMIN_API_KEY"

# 1. Create a flag — both environments start at version 1, disabled
curl -s -X POST localhost:3000/api/v1/flags -H "$FS" \
  -H 'Content-Type: application/json' \
  -d '{"key":"new-checkout","name":"New checkout"}' > /dev/null

# 2. Enable it in development at a 100% rollout
curl -s -X PATCH localhost:3000/api/v1/flags/new-checkout/config/development -H "$FS" \
  -H 'If-Match: "1"' -H 'Content-Type: application/json' \
  -d '{"enabled":true,"rollout_percentage":100}' > /dev/null

# 3. Ask what a given user would see, and why
curl -s -X POST localhost:3000/api/v1/evaluate/preview -H "$FS" \
  -H 'Content-Type: application/json' \
  -d '{"flag_key":"new-checkout","environment":"development",
       "context":{"unit_id":"user-42","default_value":false}}' | jq
```

```json
{
  "value": true,
  "reason": "FALLTHROUGH_ROLLOUT",
  "flag_key": "new-checkout",
  "environment": "development",
  "candidate_applied": false
}
```

That `reason` is the point of the whole system — every result tells you which
decision produced it. Read on for the `If-Match` contract that step 2 used, and
for the preview endpoint's candidate overlay.

### Configuration

| Variable                     | Default    | Notes                                                                                                                                    |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_API_KEY`              | _required_ | `fs_admin_<43 chars>`. Stored as a SHA-256 hash, never logged                                                                            |
| `SERVER_API_KEY_DEVELOPMENT` | —          | `fs_server_<43 chars>`, scopes the SDK API to `development`. Optional — an unset value is tolerated; a malformed one still fails startup |
| `SERVER_API_KEY_PRODUCTION`  | —          | Same shape and rules, scoped to `production`                                                                                             |
| `DATABASE_DRIVER`            | `postgres` | `memory`, `sqlite`, or `postgres`                                                                                                        |
| `DATABASE_URL`               | —          | Required when the driver is `postgres`                                                                                                   |
| `SQLITE_FILE`                | —          | Required when the driver is `sqlite`                                                                                                     |
| `PORT`                       | `3000`     |                                                                                                                                          |
| `HOST`                       | `0.0.0.0`  |                                                                                                                                          |

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
| `POST`  | `/api/v1/evaluate/preview`                 | Evaluate without persisting anything    |
| `GET`   | `/api/v1/flags/:key/exposures`             | Exposure counts for one flag, by reason |
| `GET`   | `/api/v1/exposures`                        | Exposure totals for every flag          |

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

### Previewing an evaluation

`POST /api/v1/evaluate/preview` answers "what would this user see, and why" without
writing anything — no audit row, no exposure event. It reads the flag's **saved**
config, so with no `candidate` field it is a debugger for what is live right now.

Pass a `candidate` and it overlays the saved config **in memory only**, which lets you
test a rule set before committing it:

```bash
curl -s -X POST localhost:3000/api/v1/evaluate/preview -H "$FS" \
  -H 'Content-Type: application/json' \
  -d '{"flag_key":"new-checkout","environment":"development",
       "context":{"unit_id":"user-42","attributes":{"plan":"pro"},"default_value":false},
       "candidate":{"rules":[{"attribute":"plan","operator":"in","values":["pro"],
                              "serve":true,"rollout":100}]}}' | jq
```

Every `candidate` field is optional and only the ones you send are overlaid. `key`,
`environment`, `salt`, `version` and `archived` are **absent from the schema on
purpose** — sending one is a `400`, not a silent strip, because a preview that quietly
ignored a field you set would be worse than no preview at all. The response echoes
`candidate_applied` so a client can never confuse the two modes.

`context.attributes` is deliberately **not** strict — an application attribute may
legitimately be called `salt`. It is user data, and it can never reach a flag field.

### Reading exposures

The SDK reports which flags it evaluated (see [Using the Node SDK](#using-the-node-sdk)).
Both read endpoints take the same query:

| Param   | Required | Notes                                                           |
| ------- | -------- | --------------------------------------------------------------- |
| `env`   | yes      | `development` or `production`                                   |
| `since` | no       | ISO timestamp. Defaults to 24h ago, capped at a 30-day lookback |

A `since` in the future, or further back than 30 days, is a `400`. An unknown query
param is also a `400`, matching the audit endpoint.

```bash
# One flag, broken down by evaluation reason
curl -s "localhost:3000/api/v1/flags/new-checkout/exposures?env=development" -H "$FS" | jq
```

```json
{
  "flag_key": "new-checkout",
  "environment": "development",
  "since": "2026-08-10T12:00:00.000Z",
  "total": 1432,
  "breakdown": [
    { "value": true, "reason": "FALLTHROUGH_ROLLOUT", "count": 1301 },
    { "value": false, "reason": "OVERRIDE", "count": 131 }
  ]
}
```

`breakdown` is sorted by `count` descending, then by `reason`. `since` is truncated to
the UTC hour, so the window you get back is the one that was actually queried rather
than the instant you happened to ask.

`total` is derived from `breakdown`, never a second query, so the two can never
disagree. `GET /api/v1/exposures` is the fleet-wide sibling — one total per flag, no
breakdown — and lives at the top level rather than under `/flags/` because a flag could
legally be keyed `exposures` and a static route would permanently shadow it.

Errors across the whole surface are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
`application/problem+json`.

## The SDK API

Two routes sit under `/api/v1/sdk` in a separate auth scope. They take a `server`-kind
key, **not** the admin key, and the key alone determines the environment — there is no
`env` parameter to get wrong.

| Method | Path                      | Purpose                                         |
| ------ | ------------------------- | ----------------------------------------------- |
| `GET`  | `/api/v1/sdk/definitions` | Every flag definition for the key's environment |
| `POST` | `/api/v1/sdk/events`      | Report evaluated exposures (`202`)              |

`GET /definitions` emits an `ETag` and honours `If-None-Match` with a `304`, which is
what makes the SDK's polling loop cheap. It also sets `Vary: Authorization` and
`Cache-Control: private, no-cache`, because the payload differs per environment and
must never land in a shared cache.

`POST /events` **always answers `202`**, even when persistence fails. A telemetry write
is not a transaction, and a `5xx` would invite a retry storm from every SDK instance in
the fleet over a usage signal. The one exception is a malformed body, which is a `400`
— that means the SDK's own serialiser is broken, the single failure it can actually act
on. You normally never call this route yourself; the SDK does it on its flush path.

## Using the Node SDK

`@rodriab/feature-semaphore` (`packages/sdk-node`) evaluates flags **locally**, in your own
process — it never makes a network call on the `isEnabled()`/`getEvaluation()` path. It compiles
the same `evaluate()` function the server uses (`packages/core`), so a flag's outcome can never
diverge between the two.

```ts
import { createClient } from '@rodriab/feature-semaphore';

const client = createClient({
  baseUrl: 'https://flags.example.com',
  apiKey: process.env.SERVER_API_KEY, // a `server`-kind key, one per environment
});

await client.ready(); // resolves once a definitions cache is available (or its 5s timeout elapses)

const enabled = client.isEnabled(
  'checkout-v2',
  { unitId: userId, attributes: { plan: 'pro' } },
  false, // required — see "Why defaultValue is required" below
);

// On shutdown: flushes pending usage telemetry once, then resolves.
await client.close();
```

### Eventual consistency

The client polls `GET /api/v1/sdk/definitions` on a fixed interval (`pollIntervalMs`, default
30s) using `If-None-Match`, so a config change can take up to that long to reach a running
process. This is a deliberate tradeoff, not an oversight: SSE/WebSocket push is explicitly out
of scope (see below), and polling with ETag caching means an unchanged environment costs one
cheap `304` per interval, not a full payload. If you flip a kill switch expecting every instance
to react instantly, budget for `pollIntervalMs` of propagation delay first.

### The server-side-only key model

A `server`-kind API key carries **every flag's `salt` and rollout percentage** for its
environment — that is what makes local bucketing possible without a round trip. Shipping that
key to a browser or a mobile app therefore leaks enough for anyone to predict every user's
bucket for every flag. **Server keys are for server-side processes only.** There is currently no
browser/edge-safe key kind; that is a documented gap, not a silent one.

### Why `defaultValue` is a required parameter

The flags service is explicitly allowed to be down (ADR-05): the SDK's whole design — local
evaluation, a poll-and-cache loop, `isEnabled()`/`getEvaluation()` that never throw — exists so a
dead or unreachable server degrades your application instead of taking it down with it. Making
`defaultValue` a required positional argument, rather than a client-wide default, is the
type-level enforcement of that contract: there is no library-chosen fallback that could be wrong
for your domain, and a caller cannot forget to decide what "the flags service is unreachable"
should mean for that one call site.

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
  core/       — pure domain: evaluate(), bucket(), matches(), rolloutThreshold()
  server/     — application/ (ports, use cases), infrastructure/ (persistence, http), main/
  sdk-node/   — @rodriab/feature-semaphore: local evaluation, ETag polling cache, fail-safe
  bff/        — Fastify: password session, and the only process that holds the admin key
  dashboard/  — React 19 + Vite 7 + TanStack Query, container/presentational
```

`packages/core` has zero runtime dependencies and performs no IO. Every other package
in the eventual system (`server`, `sdk-node`, `bff`, `dashboard`, `e2e`) compiles against
it without duplicating evaluation logic.

`packages/server` is hexagonal: `application/` owns the ports and use cases and imports
nothing from `infrastructure/`, which holds the three interchangeable persistence
adapters (in-memory, SQLite, Postgres) and the HTTP layer. All three adapters pass one
shared contract suite, so they cannot drift apart.

`packages/sdk-node` has exactly one dependency (`packages/core`, workspace-linked). Its two
IO adapters (`fetch`, `setInterval`) each take their global as an injected, test-overridable
parameter — the only two modules in the package that name them at all.

`packages/bff` is deliberately **not** hexagonal. The server's four layers earn their keep
because one `FlagRepository` port has three interchangeable adapters; the BFF has one
upstream and one session store, so the same structure would be ceremony. Its upstream seam
is an injected `fetchFn`, matching what `packages/sdk-node` already chose.

`packages/dashboard` never fetches from a presentational component — containers own every
query. All four mutating screens go through one shared hook, `useVersionedMutation`, which
reads the `version` for `If-Match` from the query cache at mutation time rather than from
props captured at render.

## The dashboard and its BFF

The dashboard is a browser SPA, so it can never hold an admin key: a `fs_admin_` token is
full write access to every flag in both environments, and there is no revocation path short
of redeploying. A BFF sits between them and holds that key server-side. The browser gets an
`httpOnly` session cookie and nothing else — a test runs a real `vite build` and greps the
shipped bundle to prove it.

```
browser --cookie httpOnly--> packages/bff --Bearer fs_admin_--> packages/server
```

Same-origin by construction, which dissolves CORS rather than configuring it.

| Variable             | Default    | Notes                                                                                                                        |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `UPSTREAM_URL`       | _required_ | The management API's base URL. Never defaults — a silent localhost fallback is how a demo writes to production               |
| `ADMIN_API_KEY`      | _required_ | Same key the management API expects. Never leaves this process                                                               |
| `DASHBOARD_PASSWORD` | _required_ | What an operator types to log in. Separate from the admin key by design                                                      |
| `READ_ONLY_MODE`     | `false`    | Exactly the string `true` enables it. Rejects every route declared mutating with `403` before the request reaches the server |
| `COOKIE_SECURE`      | `true`     | Exactly the string `false` disables it, so a typo cannot silently ship an insecure cookie                                    |

`READ_ONLY_MODE` classifies routes by an explicit per-route declaration, **never by HTTP
method** — `POST /evaluate/preview` writes nothing and stays reachable. A route that forgets
to declare itself fails closed as mutating, and omitting the field is a compile error.

Failed logins escalate a delay (250ms, 500ms, 1s, capped at 2s) that resets on success. There
is deliberately no lockout: with exactly one legitimate credential, a mechanism that _denies_
hands an attacker a way to lock out the only operator. A 2s cap still bounds guessing to
roughly 1,800 attempts an hour, which is nothing against a high-entropy secret.

Two things to know before deploying it, both documented in `packages/bff/README.md`:
the session store is an in-memory `Map`, so the BFF is **single-instance** — two replicas log
operators out at random. And there is no dev-proxy or static-serving path yet, so the
dashboard needs an external reverse proxy to sit same-origin with the BFF.

## Scripts

| Script                    | What it does                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test`               | Run the test suite (`vitest run`)                                                               |
| `pnpm test:coverage`      | Run tests with the coverage gate                                                                |
| `pnpm lint`               | ESLint over the whole workspace                                                                 |
| `pnpm format:check`       | Prettier check                                                                                  |
| `pnpm typecheck`          | `tsc -b` across the solution (src and tests)                                                    |
| `pnpm build`              | Compile `core`, `server`, `sdk-node` and `bff` with `tsc -b`, then bundle `dashboard` with Vite |
| `pnpm vectors:verify`     | Regenerate golden bucketing vectors in memory and diff against the committed fixture            |
| `pnpm crosscheck:vectors` | Recompute every golden vector with an independent hash library                                  |

`pnpm test` skips the Postgres legs of the persistence and ETag-parity contract suites unless
`DATABASE_URL` is set — 28 tests, reported as skipped rather than silently absent:

```bash
pnpm test                                                     # 570 passed | 28 skipped
DATABASE_URL=postgres://localhost:5432/postgres pnpm test     # 598 passed | 0 skipped
```

Coverage thresholds are declared per package in the root `vitest.config.ts` and nowhere else —
Vitest silently ignores a `coverage` block inside a project config under a `projects` topology,
so a per-package threshold would be a green gate enforcing nothing.
