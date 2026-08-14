#!/usr/bin/env bash
# Focused test harness for scripts/deploy.sh's single-instance gate.
#
# Run: bash scripts/__tests__/deploy-gate.test.sh
#
# No Fly account or `flyctl` install is required: a stub `fly` binary is put
# first on PATH so `assert_single_machine` can be exercised in isolation
# (the script is `source`d, never executed, so `main` — which would call the
# real `fly deploy` — never runs). Covers every required case from design
# §10's "Deploy shell" threat-matrix row: machine count 0, count 2,
# malformed JSON, empty output, and a non-zero `fly` exit must all abort;
# only exactly 1 running machine may proceed.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy_script="${repo_root}/scripts/deploy.sh"
stub_dir="$(mktemp -d)"
trap 'rm -rf "$stub_dir"' EXIT

cat >"${stub_dir}/fly" <<'STUB'
#!/usr/bin/env bash
# Test double for `fly` — never the real Fly CLI. Behavior selected by
# FLY_STUB_MODE so each abort case from the threat matrix is reproducible
# without a Fly account.
case "${FLY_STUB_MODE:-}" in
  zero)      echo '{"Machines":[]}' ;;
  two)       echo '{"Machines":[{"id":"1"},{"id":"2"}]}' ;;
  one)       echo '{"Machines":[{"id":"1"}]}' ;;
  malformed) echo '{not valid json' ;;
  empty)     printf '' ;;
  fail)      echo 'error: could not connect to the Fly API' >&2; exit 1 ;;
  *)         echo "unknown FLY_STUB_MODE: ${FLY_STUB_MODE:-<unset>}" >&2; exit 2 ;;
esac
STUB
chmod +x "${stub_dir}/fly"

failures=0

run_case() {
  local mode="$1"
  local expect="$2" # "abort" or "proceed"
  local rc=0

  PATH="${stub_dir}:${PATH}" FLY_STUB_MODE="$mode" \
    bash -c "source \"${deploy_script}\"; assert_single_machine test-app" \
    >/tmp/deploy-gate-case.out 2>&1 || rc=$?

  if [ "$expect" = "abort" ] && [ "$rc" -eq 0 ]; then
    echo "FAIL: mode=${mode} expected abort (non-zero exit), got exit 0"
    cat /tmp/deploy-gate-case.out
    failures=$((failures + 1))
  elif [ "$expect" = "proceed" ] && [ "$rc" -ne 0 ]; then
    echo "FAIL: mode=${mode} expected proceed (exit 0), got exit ${rc}"
    cat /tmp/deploy-gate-case.out
    failures=$((failures + 1))
  else
    echo "PASS: mode=${mode} expect=${expect} rc=${rc}"
  fi
}

run_case zero abort       # fly status --json reports 0 machines
run_case two abort        # fly status --json reports 2 machines
run_case malformed abort  # fly status --json is not valid JSON
run_case empty abort      # fly status --json produced no output at all
run_case fail abort       # the `fly` command itself exited non-zero
run_case one proceed      # exactly 1 machine — the only passing case

rm -f /tmp/deploy-gate-case.out

if [ "$failures" -ne 0 ]; then
  echo "${failures} case(s) failed."
  exit 1
fi

echo "All 6 deploy-gate cases passed (5 abort, 1 proceed)."
