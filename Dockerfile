# syntax=docker/dockerfile:1.7
#
# Two runtime targets — `server` and `bff` — sharing one build stage. Every
# Node stage is pinned to Debian 12 (bookworm), full or slim (design D7): the
# server's `better-sqlite3` native binary is a package.json-declared runtime
# dependency (compiled here regardless of which database driver is actually
# selected at runtime), and a binary compiled against glibc fails at process
# START on an alpine (musl) runtime, not at build time — the worst place to
# find it. One shared libc across every stage removes the failure class.

# ---- build: full toolchain (gcc/g++/make/python3 ship with the non-slim
# image), all dependencies including dev, TypeScript + Vite build ----
FROM node:22-bookworm AS build
WORKDIR /app
RUN npm install -g pnpm@11.8.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- server runtime ----
# Whole /app copied from the build stage, dev dependencies included — the
# documented D7 fallback rather than a pruned prod-deps stage. pnpm's
# workspace node_modules is a tree of relative symlinks (one root .pnpm
# virtual store plus one node_modules per package); copying it wholesale from
# a single stage is the reliable choice, copying it selectively is the
# fragile one. Same bookworm glibc as `build`, so the already-compiled
# better-sqlite3 binary runs unmodified.
FROM node:22-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "packages/server/dist/main/index.js"]

# ---- bff runtime ----
FROM node:22-bookworm-slim AS bff
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Normalizes the built dashboard bundle to the path docker-compose.yml's
# DASHBOARD_DIST_DIR points at, independent of where the monorepo happens to
# place packages/dashboard/dist.
COPY --from=build /app/packages/dashboard/dist /app/dashboard-dist
CMD ["node", "packages/bff/dist/main/index.js"]
