#!/usr/bin/env bash
# Publishes both Fly apps (server, bff) — but only after proving exactly one
# BFF machine is currently running.
#
# WHY THIS GATE EXISTS (design decision #1980): packages/bff keeps sessions
# in an in-memory Map, so a second BFF machine logs operators out at random
# with nothing in any log explaining why. No in-process runtime check can
# see a sibling instance, so this deploy path is the ONLY place the
# single-instance invariant can be enforced mechanically. If this gate is
# wrong, nothing else protects it — so it fails closed: anything other than
# exactly one machine aborts, including a `fly` call that itself failed.
#
# NOTE: the very first deploy of a brand-new app has zero machines and will
# be correctly refused by this gate (count 0 is not count 1). Create the app
# once with `fly launch`/`fly apps create` + a manual first `fly deploy`
# outside this script; every deploy after that goes through here.
set -euo pipefail

# Reads `fly status --json` for the given app and aborts (returns non-zero)
# unless it reports EXACTLY one running machine. Parses the machine list
# structurally via `node` (never scrapes human-readable text), because a
# count read out of prose breaks silently the moment Fly changes its output
# format.
assert_single_machine() {
  local app="$1"
  local output=""
  local rc=0

  output="$(fly status --app "$app" --json)" || rc=$?

  if [ "$rc" -ne 0 ]; then
    echo "ERROR: 'fly status --app ${app} --json' exited non-zero (${rc}); refusing to deploy." >&2
    return 1
  fi

  if [ -z "$output" ]; then
    echo "ERROR: 'fly status --app ${app} --json' returned no output; refusing to deploy." >&2
    return 1
  fi

  local count
  count="$(node -e '
    try {
      const data = JSON.parse(process.argv[1]);
      const machines = Array.isArray(data.Machines) ? data.Machines : [];
      process.stdout.write(String(machines.length));
    } catch {
      process.stdout.write("invalid");
    }
  ' "$output")"

  if [ "$count" = "invalid" ]; then
    echo "ERROR: could not parse 'fly status --json' output for app '${app}' as JSON; refusing to deploy." >&2
    return 1
  fi

  if [ "$count" != "1" ]; then
    echo "ERROR: app '${app}' reports ${count} running machine(s), expected exactly 1; refusing to deploy." >&2
    return 1
  fi

  echo "OK: app '${app}' has exactly 1 running machine."
  return 0
}

main() {
  local bff_app="${FLY_BFF_APP:-feature-semaphore-bff}"
  local server_app="${FLY_SERVER_APP:-feature-semaphore-server}"

  assert_single_machine "$bff_app"

  fly deploy --config fly.server.toml --app "$server_app"
  fly deploy --config fly.toml --app "$bff_app"
}

# Guards `main` so this file can be `source`d in a test (see
# scripts/__tests__/deploy-gate.test.sh) without ever invoking the real
# `fly deploy` — sourcing is the only way to test `assert_single_machine` in
# isolation.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
