# First deploy to Fly

`pnpm deploy` (`scripts/deploy.sh`) refuses to run against a brand-new app: its gate
demands that `feature-semaphore-bff` already report **exactly one** running machine, and a
new app has zero. That is deliberate (design `#1980`) — `packages/bff` keeps sessions in an
in-memory `Map`, so a second machine logs operators out at random with nothing in any log
explaining why, and no in-process check can see a sibling instance.

This document is the one-time bootstrap that gets each app to its first machine. **Every
deploy after this goes through `pnpm deploy` and nothing else.**

> Status: written from `fly.toml`, `fly.server.toml`, `scripts/deploy.sh`,
> `packages/bff/src/main/env.ts` and Fly's documentation. It has not been executed
> end-to-end against a real Fly account — treat the verification step after each phase as
> the thing that actually decides, not the command that precedes it.

## What you end up with

Two apps in one Fly organization:

| App                        | Public?                | Holds                                     |
| -------------------------- | ---------------------- | ----------------------------------------- |
| `feature-semaphore-bff`    | yes, the demo URL      | session `Map`, the `fs_admin_` key        |
| `feature-semaphore-server` | **no public IP, ever** | the management + SDK API, Postgres access |

The server is reachable only over Fly's private `.internal` network, from the BFF's
`UPSTREAM_URL`. That absence of a public IP — not an auth check — is what keeps `/metrics`
and the management API off the internet.

## Three traps, read these first

**1. Do not run `fly launch`.** It rewrites `fly.toml` and allocates a public IP. Both
config files in this repo are hand-written and load-bearing, and `fly.server.toml`'s whole
security posture is _no public IP_. Use `fly apps create`, which does neither.

**2. The first deploy creates TWO machines by default.** Fly provisions a spare for
availability unless you pass `--ha=false`. For the BFF that is not a capacity decision, it
is a silent-logout bug — and it also permanently blocks `pnpm deploy`, whose gate wants
exactly one. `--ha=false` has been reported not to take effect in every configuration, so
**verify the count afterwards; do not assume the flag worked.**

**3. `fly mpg attach` triggers a deployment.** Set `ADMIN_API_KEY` before attaching, or the
server boots without it and crash-loops — `packages/server` fails fast on a missing or
malformed key by design.

## 0. Prerequisites

```bash
brew install flyctl
fly auth login
fly auth whoami          # confirm the right account before anything else
```

## 1. Generate the shared admin key

One key, used by **both** apps: the BFF injects it on every proxied call, the server
authenticates with it. They must match exactly.

```bash
export FS_ADMIN_KEY="fs_admin_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
echo "$FS_ADMIN_KEY"     # save this in your password manager now
```

The server validates the shape `fs_admin_<43 url-safe base64 chars>` at boot and refuses to
start on anything else.

## 2. Create both apps

```bash
fly apps create feature-semaphore-server
fly apps create feature-semaphore-bff
```

**Verify** the server has no public IP — this must print an empty list, now and forever:

```bash
fly ips list --app feature-semaphore-server
```

## 3. Postgres

```bash
fly mpg create --name feature-semaphore-db --region iad
fly mpg list                                   # note the cluster ID
```

Set the admin key on the server **before** attaching, because attaching deploys:

```bash
fly secrets set ADMIN_API_KEY="$FS_ADMIN_KEY" --app feature-semaphore-server
fly mpg attach <cluster-id> --app feature-semaphore-server
```

`attach` sets `DATABASE_URL` for you. `fly.server.toml` already pins
`DATABASE_DRIVER = "postgres"` and `SEED_DEMO_FLAG = "true"`.

**Verify:**

```bash
fly secrets list --app feature-semaphore-server   # expect ADMIN_API_KEY and DATABASE_URL
```

## 4. BFF secrets

```bash
fly secrets set \
  ADMIN_API_KEY="$FS_ADMIN_KEY" \
  DASHBOARD_PASSWORD="<pick a real password>" \
  --app feature-semaphore-bff
```

Nothing else. `UPSTREAM_URL`, `DASHBOARD_DIST_DIR` and `READ_ONLY_MODE` live in `fly.toml`
in plain sight, on purpose — they state intent and this repo is public.

## 5. First deploy: server

```bash
fly deploy --config fly.server.toml --app feature-semaphore-server --ha=false
```

**Verify** — the app is up, and still has no public IP:

```bash
fly status --app feature-semaphore-server
fly ips list --app feature-semaphore-server     # still empty
fly logs --app feature-semaphore-server         # migrations ran, demo flag seeded
```

## 6. First deploy: BFF

```bash
fly deploy --config fly.toml --app feature-semaphore-bff --ha=false
```

**Verify the machine count — this is the step that matters:**

```bash
fly status --app feature-semaphore-bff --json | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log("machines:", (d.Machines ?? []).length);
'
```

It must print `machines: 1`. If it prints `2`, trap 2 caught you:

```bash
fly scale count 1 --app feature-semaphore-bff
```

Then re-run the count check. That command reads `Machines` exactly the way
`scripts/deploy.sh` does, so a `1` here means `pnpm deploy` will let you through.

## 7. Prove the demo

```bash
open https://feature-semaphore-bff.fly.dev
```

Log in with the `DASHBOARD_PASSWORD` from step 4. You should see the seeded `checkout-v2`
flag.

Confirm the read-only gate is live — this must be a **403**, not a 200:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
  https://feature-semaphore-bff.fly.dev/api/flags/checkout-v2/config/development
```

And confirm an unmapped API path is a **404**, never the SPA shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://feature-semaphore-bff.fly.dev/api/nope
```

## 8. From here on

```bash
pnpm deploy
```

Never `fly deploy` directly again. The gate is the only mechanical enforcement of the
single-instance invariant; going around it is going around the invariant.

## What the public demo does NOT show

`packages/bff`'s proxy is a closed allow-list (`src/http/proxy/route-table.ts`), and the
SDK routes `/api/v1/sdk/*` are **not** in it. The server, which serves them, has no public
IP. So the deployed demo shows the dashboard and its read paths — it cannot host a live SDK
integration, and no URL you hand someone will let their SDK poll this deployment.

That is a consequence of the security posture, not an oversight, but it means the SDK story
has to be told another way: the local Docker stack (`docker compose up -d --wait`), the
thesis test (`packages/sdk-node/src/__tests__/thesis-offline.test.ts`), and
`pnpm bench:evaluate`. Worth deciding before the case study is written, not during.

## Rolling it back

```bash
fly apps destroy feature-semaphore-bff
fly apps destroy feature-semaphore-server
fly mpg destroy <cluster-id>
```

Nothing in this repo holds state that survives that.
