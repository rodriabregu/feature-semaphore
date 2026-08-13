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

**`READ_ONLY_MODE` is the entire safety boundary for a public deployment.**
The BFF holds a full-write `ADMIN_API_KEY` server-side — there is no
read-only key kind on the management API to fall back on (`packages/server`
issues exactly one admin key shape, `fs_admin_<43 chars>`, and it can always
write). If you expose this BFF publicly (a demo, a read-only showcase), the
one and only thing standing between "read-only" and "anyone with the login
password can mutate flags" is `READ_ONLY_MODE=true`. There is no second
layer underneath it.

## Quick path

```bash
pnpm build   # builds packages/bff/dist alongside the rest of the workspace

# Assumes the management API (packages/server) is already running on :3000 —
# the BFF needs its own, different port.
export UPSTREAM_URL="http://localhost:3000"          # the management API, no default
export ADMIN_API_KEY="fs_admin_..."                  # full-write key, no default
export DASHBOARD_PASSWORD="correct-horse-battery"    # the one login credential, no default
export PORT=4000

node packages/bff/dist/main/index.js
```

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

| Variable             | Default    | Notes                                                                                                  |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `UPSTREAM_URL`       | _required_ | The management API's base URL. No default — a silent fallback would be how a demo writes to production |
| `ADMIN_API_KEY`      | _required_ | Forwarded as `Authorization: Bearer` on every proxied request. Never reaches the browser               |
| `DASHBOARD_PASSWORD` | _required_ | The one login credential, system-wide. No user accounts                                                |
| `COOKIE_SECURE`      | secure     | Only the exact string `'false'` disables `Secure`. Every other value, including unset, keeps it        |
| `READ_ONLY_MODE`     | `false`    | Only the exact string `'true'` enables it. Every other value, including unset, allows mutations        |
| `PORT`               | `3000`     |                                                                                                        |
| `HOST`               | `0.0.0.0`  |                                                                                                        |

`COOKIE_SECURE` and `READ_ONLY_MODE` default in opposite string directions on
purpose — each variable defaults to whichever value is _safe_, so a typo in
either one degrades toward safety rather than away from it.

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

## Next step

See the root [README](../../README.md) for the management API this service
proxies to, and `packages/dashboard/README.md` for the UI that talks to this
BFF.
