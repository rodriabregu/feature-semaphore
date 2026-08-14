# BFF — backend-for-frontend for the dashboard

A thin Fastify service that sits between the browser-based dashboard
(`packages/dashboard`) and the management API (`packages/server`). It turns a
password into a session cookie, then forwards an allow-listed set of admin
requests upstream with the real `ADMIN_API_KEY` injected server-side — the
browser never sees that key.

## Read this before you deploy it

**This service is single-instance by construction.** The session store is an
in-memory `Map` (`packages/bff/src/session/session-store.ts`) with no shared
backing store. Run two replicas behind a load balancer and each request lands
on a coin flip: an operator's session exists on the instance that handled
`POST /login` and nowhere else, so roughly half their requests come back
`401` at random. This is a deliberate tradeoff, not an oversight — see
"Why not a stateless cookie?" below — but it means **scale this service
vertically, or put a single replica behind a sticky session, never a plain
round-robin pool of ≥2 instances.**

This warning is not just documentation: `fly.toml` pins
`auto_stop_machines = false` and `min_machines_running = 1` for exactly this
reason, and `pnpm deploy` (`scripts/deploy.sh`) runs `fly status --json`
before every deploy and refuses to proceed unless the app already has
exactly one machine — see "Deploying" below.

**`READ_ONLY_MODE` is the entire safety boundary for a public deployment.**
The BFF holds a full-write `ADMIN_API_KEY` server-side — there is no
read-only key kind on the management API to fall back on (`packages/server`
issues exactly one admin key shape, `fs_admin_<43 chars>`, and it can always
write). If you expose this BFF publicly (a demo, a read-only showcase), the
one and only thing standing between "read-only" and "anyone with the login
password can mutate flags" is `READ_ONLY_MODE=true`. There is no second
layer underneath it.

On top of that, the BFF refuses to **boot** at all if it looks like a public
deployment (`FLY_APP_NAME` set by the Fly platform, or `PUBLIC_DEMO=true`)
and `READ_ONLY_MODE` is not `'true'` — see "The public-deployment boot gate"
below.

## Quick path

```bash
pnpm build   # builds packages/bff/dist AND packages/dashboard/dist (bundled by Vite)

# Assumes the management API (packages/server) is already running on :3000 —
# the BFF needs its own, different port.
export UPSTREAM_URL="http://localhost:3000"          # the management API, no default
export ADMIN_API_KEY="fs_admin_..."                  # full-write key, no default
export DASHBOARD_PASSWORD="correct-horse-battery"    # the one login credential, no default
export DASHBOARD_DIST_DIR="$(pwd)/packages/dashboard/dist"  # required, no default
export PORT=4000

node packages/bff/dist/main/index.js
```

See the root [README](../../README.md#quick-start-docker-compose) for a
one-command `docker compose up` alternative that wires all three services
(`db`, `server`, `bff`) together with a seeded demo flag.

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/healthz   # 200 once alive
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/readyz    # 200 immediately — no migration to wait on
```

```bash
curl -c cookies.txt -X POST localhost:4000/login \
  -H 'Content-Type: application/json' -d '{"password":"correct-horse-battery"}'

curl -b cookies.txt localhost:4000/api/flags   # proxied, admin key injected server-side
```

## Configuration

| Variable                 | Default    | Notes                                                                                                                                    |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTREAM_URL`           | _required_ | The management API's base URL. No default — a silent fallback would be how a demo writes to production                                  |
| `ADMIN_API_KEY`          | _required_ | Forwarded as `Authorization: Bearer` on every proxied request. Never reaches the browser                                                |
| `DASHBOARD_PASSWORD`     | _required_ | The one login credential, system-wide. No user accounts                                                                                 |
| `DASHBOARD_DIST_DIR`     | _required_ | Absolute path to the built dashboard bundle (`packages/dashboard/dist`). No default — a wrong guess would silently serve nothing         |
| `COOKIE_SECURE`          | secure     | Only the exact string `'false'` disables `Secure`. Every other value, including unset, keeps it                                          |
| `READ_ONLY_MODE`         | `false`    | Only the exact string `'true'` enables it. Every other value, including unset, allows mutations — see "The public-deployment boot gate" |
| `ALLOW_WRITES_ON_PUBLIC` | `false`    | Only the exact string `'true'` bypasses the public-deployment boot gate below. A deliberate, named, greppable escape hatch, not a silent one |
| `PUBLIC_DEMO`            | `false`    | Only the exact string `'true'` marks this a public deployment, ORed with the platform-set `FLY_APP_NAME`. Lets the boot gate be tested and used off-Fly |
| `PORT`                   | `3000`     |                                                                                                                                          |
| `HOST`                   | `0.0.0.0`  |                                                                                                                                          |
| `LOG_LEVEL`              | `info`     | Passed straight to pino. Each package's own `vitest.config.ts` sets this to `silent` so the test suite stays quiet                       |

`COOKIE_SECURE` and `READ_ONLY_MODE` default in opposite string directions on
purpose — each variable defaults to whichever value is _safe_ for that
setting alone. `READ_ONLY_MODE` itself does **not** default to the safe
value: it defaults to permissive (writable), deliberately, because a
self-hosted operator needs a writable dashboard — that is the product. The
public-deployment boot gate below exists to cover the one case where that
permissive default would otherwise be unsafe, rather than flipping the
default for everyone.

### Static serving and the `/api` 404 invariant

`registerDashboard` (`packages/bff/src/http/static/register-dashboard.ts`)
serves the built dashboard bundle from `DASHBOARD_DIST_DIR` at root, using
`@fastify/static` with **`wildcard: false`**. That flag is the load-bearing
setting, not a tuning knob: with it, `@fastify/static` globs `DASHBOARD_DIST_DIR`
at registration time and creates one concrete route per file — it never
registers the plugin's default catch-all `GET {prefix}*`, which at
`prefix: '/'` would otherwise match `/api/nope` and swallow every `/api` 404
before it ever fires. Registration order (dashboard mounted after the `/api`
scope in `packages/bff/src/main/composition-root.ts`) is real, but it is the
**weakest** of the three mechanisms that keep `/api` from being swallowed —
`wildcard: false` is the one to preserve if you ever touch this code. See the
call-site comment in `composition-root.ts` for the full three-mechanism
breakdown.

The cost of `wildcard: false`: Vite emits hash-named asset files on every
rebuild, and the startup glob never sees a filename it didn't see at boot —
so a rebuild that changes asset names needs a BFF restart. In local
development, run `vite build --watch` (in `packages/dashboard`) alongside
`node --watch-path=<dist> packages/bff/dist/main/index.js` so the BFF picks
up new filenames automatically. Because the session store is an in-memory
`Map`, each restart also logs the operator out — real friction, priced in
rather than hidden.

`registerApiNotFound` (`packages/bff/src/http/proxy/api-not-found.ts`) is
what actually answers an unregistered `/api/*` path: a scoped
`setNotFoundHandler` registered inside `registerProxyRoutes`, so both
production (`buildApp`) and the BFF's own fidelity test harness get it for
free. It returns `application/problem+json` with the `not_found` problem
code (see "Problem codes" below), never Fastify's default plain-JSON 404.

### Problem codes

`packages/bff/src/http/problem.ts` defines **five** problem codes, not four:
`unauthenticated`, `read_only`, `invalid_credentials`, `upstream_unavailable`,
and `not_found` (added for the `/api` 404 invariant above — every BFF error,
including "this route doesn't exist," now answers with the same
`application/problem+json` shape).

### The public-deployment boot gate

`readCompositionConfig` (`packages/bff/src/main/env.ts`) refuses to return a
config — the process never boots — when the deployment looks public
(`FLY_APP_NAME` is set by the Fly platform, or `PUBLIC_DEMO=true`) and
neither `READ_ONLY_MODE=true` nor `ALLOW_WRITES_ON_PUBLIC=true` is set. The
thrown error names both exits. This closes the gap where a self-hosted
default (writable) would otherwise ship silently writable to the public
internet. `ALLOW_WRITES_ON_PUBLIC=true` is the deliberate, named foot-gun for
a self-hoster who deploys to Fly on purpose and wants a writable public
deployment anyway.

## Login and the capped escalating delay

```
POST /login    { password }   →  200 + Set-Cookie   |  401 invalid_credentials (delayed)
POST /logout                  →  204, cookie cleared, session revoked server-side
```

A wrong password is never locked out — it is only slowed, on one counter
global to this BFF instance (never per-IP, since exactly one credential
exists system-wide and a per-IP scheme is both evadable and collaterally
punishes a legitimate operator sharing a NAT with an attacker):

| Consecutive failures | Delay before the `401` |
| -------------------- | ---------------------- |
| 1st                  | ~250ms                 |
| 2nd                  | ~500ms                 |
| 3rd                  | ~1s                    |
| 4th and beyond       | capped at 2s           |

**The correct password always succeeds**, however many failures preceded it —
delayed by the same capped schedule, never refused. This replaced an earlier
hard-lockout design: with exactly one shared credential, a mechanism that can
_deny_ access is a denial-of-service switch handed to an unauthenticated
attacker over the internet-exposed login. A mechanism that only _slows_
access is not — at the 2s cap, sustained guessing is bounded to roughly 1,800
attempts/hour, indistinguishable from zero brute-force resistance gained
against a high-entropy password.

## Why not a stateless cookie?

A signed, stateless cookie (e.g. a JWT) cannot be revoked before it expires —
there is no server-side record to delete. `POST /logout` needs to actually
end the session, immediately, which is exactly what an opaque
server-side-store id gives you and a signature alone cannot. That server-side
store is the in-memory `Map` this README opens with: the same design choice
that makes logout real is what makes this service single-instance.

## Proxied routes

Every route below requires a valid session cookie (`401` otherwise) and is
declared, at registration, as mutating or not — never inferred from the HTTP
method, since `POST /evaluate/preview` is a read despite its verb. An
undeclared route fails closed as mutating. `READ_ONLY_MODE=true` rejects
every mutating route with `403`, before it reaches the upstream server.

| Method  | Path                                    | Mutating? |
| ------- | --------------------------------------- | --------- |
| `GET`   | `/api/flags`                            | no        |
| `GET`   | `/api/flags/:key`                       | no        |
| `PATCH` | `/api/flags/:key/config/:env`           | yes       |
| `PUT`   | `/api/flags/:key/config/:env/rules`     | yes       |
| `PUT`   | `/api/flags/:key/config/:env/overrides` | yes       |
| `POST`  | `/api/evaluate/preview`                 | no        |
| `GET`   | `/api/flags/:key/audit`                 | no        |
| `GET`   | `/api/flags/:key/exposures`             | no        |
| `GET`   | `/api/exposures`                        | no        |

`If-Match`/`ETag`/`problem+json` bodies (including a `412`'s
`expectedVersion`/`actualVersion`) forward byte-for-byte — the BFF never
synthesises or repairs a version. `POST /flags` and `POST /flags/:key/archive`
are deliberately absent from this table: absence means `404`, which is the
enforcement, not a comment.

## Checklist before exposing this publicly

- [ ] Exactly one replica is running, or all replicas share a sticky session — never plain round-robin
- [ ] `READ_ONLY_MODE=true` if this deployment should not accept writes from anyone who knows the login password
- [ ] `COOKIE_SECURE` is left at its default (secure) unless you have a specific, understood reason to disable it
- [ ] `DASHBOARD_PASSWORD` is high-entropy — it is the only thing standing between the public internet and a write-capable admin key

## Deploying

`fly.toml` (this app) enforces the single-instance warning above at the
platform level: `[http_service]` pins `auto_stop_machines = false` and
`min_machines_running = 1`, with a comment stating the failure mode
(silent operator logout) rather than just the value. That is the first line
of defense, not the only one — `pnpm deploy` (`scripts/deploy.sh`) calls
`fly status --json` before every deploy and **aborts** unless this app
already reports exactly one machine, so a config edit or a manual `fly
scale` cannot silently reintroduce a second replica. The gate targets this
app specifically, since it is the one with the in-memory session `Map`;
`packages/server` (`fly.server.toml`) is stateless and has no equivalent
invariant. A brand-new app has zero machines before its first deploy, so the
very first `fly deploy` for each app must be run manually
(`fly launch`/`fly apps create` + one manual `fly deploy`); every deploy
after that goes through the gate.

## Next step

See the root [README](../../README.md) for the management API this service
proxies to, and `packages/dashboard/README.md` for the UI that talks to this
BFF.
