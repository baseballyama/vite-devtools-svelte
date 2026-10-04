#!/usr/bin/env bash
# One measurement phase on a GitHub-hosted Linux runner (perf-linux.yml).
# Every phase records the runner spec, per-file hash manifests of each
# measured checkout (same method on every side) and timings per step into
# $OUT, which perf/ci/sanitize-artifact.mjs then scrubs before upload.
#
#   smoke   e0d1e51 (this branch's plugin source) only, S1k: OFF / CLOSED / OPEN
#           + DevTools UI latencies. Harness check; n = 1, no effect conclusions.
#   profile e0d1e51 OPEN with CDP + node CPU profiles (mode "profiled"; its
#           timings are not compared with latency runs)
#   reactive reduced reactive fixture (separate axis), OFF / CLOSED / OPEN, n = 1
#   pairA   ee3a716 vs dc60aa2 (code delta, same deps)    — later run
#   pairB   dc60aa2 vs e0d1e51 (deps delta, same source)  — later run
set -euo pipefail

PHASE="${1:?phase}"
ROOT="$(pwd)"
OUT="$ROOT/perf-out"
SIDES="$RUNNER_TEMP/sides"
mkdir -p "$OUT/manifests" "$SIDES"
T0=$(date +%s)
step() { echo "$(( $(date +%s) - T0 ))s $*" | tee -a "$OUT/timings.txt"; }

spec() {
  {
    echo "phase: $PHASE"
    echo "run: ${GITHUB_RUN_ID:-local} attempt ${GITHUB_RUN_ATTEMPT:-}"
    echo "runner: ${RUNNER_NAME:-?} / ${ImageOS:-?} ${ImageVersion:-?}"
    echo "head: $(git rev-parse HEAD)"
    echo "kernel: $(uname -r)"
    echo "nproc: $(nproc)"
    lscpu | grep -E '^(Model name|CPU\(s\)|Thread|Core|Socket|CPU max MHz|L3)' || true
    grep -E '^(MemTotal|MemAvailable|SwapTotal):' /proc/meminfo
    echo "cgroup memory.max: $(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo n/a)"
    echo "cgroup cpu.max: $(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo n/a)"
    echo "node: $(node --version)"
    df -h / | tail -1
  } > "$OUT/spec.txt"
}

# Same method for every side: lockfile, plugin sources, dist files.
manifest() { # <dir> <label>
  local d="$1" f="$OUT/manifests/$2.txt"
  {
    echo "rev $(git -C "$d" rev-parse HEAD)"
    echo "dirty $(git -C "$d" status --porcelain | wc -l)"
    (cd "$d" && sha256sum pnpm-lock.yaml)
    (cd "$d" && find packages/vite-devtools-svelte/src -type f -print0 | sort -z | xargs -0 sha256sum)
    (cd "$d" && find packages/vite-devtools-svelte/dist -type f -print0 | sort -z | xargs -0 sha256sum)
    for p in vite svelte @sveltejs/kit @sveltejs/vite-plugin-svelte @vitejs/devtools; do
      echo "$p $(node -p "require('$d/playground/node_modules/$p/package.json').version" 2>/dev/null || echo n/a)"
    done
  } > "$f"
}

side() { # <sha> <label>: pristine worktree, its own pnpm, build
  local sha="$1" dir="$SIDES/$2"
  git worktree add -q --detach "$dir" "$sha"
  local pm; pm=$(node -p "require('$dir/package.json').packageManager.replace(/\+.*/, '')")
  (cd "$dir" && npx -y "$pm" install --frozen-lockfile --reporter=silent && npx -y "$pm" build >/dev/null)
  manifest "$dir" "$2"
  step "side $2 ($sha, $pm) installed + built"
}

spec
step "start"
GATE="--gate=$(nproc):50 --linux-gate=2048:10 --gate-wait=180 --gate-policy=skip"

case "$PHASE" in
  smoke)
    # This branch changes only perf/ and .github/ relative to e0d1e51.
    git diff --quiet e0d1e5165ebb16436da8ea4897e2cf3050047fd5 HEAD -- packages playground pnpm-lock.yaml \
      && echo "plugin/playground/lockfile identical to e0d1e51" >> "$OUT/spec.txt"
    manifest "$ROOT" e0d1e51-branch
    node perf/run-paired.mjs --order=F --parts=A,OFF,UI --scales=1000:none \
      --label=smoke-S1k $GATE --max-min=7 2>&1 | tee "$OUT/smoke.log"
    step "smoke S1k OFF/CLOSED/OPEN/UI done (mode latency)"
    ;;
  profile)
    # Separate run: profiler overhead must not leak into latency numbers.
    manifest "$ROOT" e0d1e51-branch
    node perf/run-paired.mjs --order=F --parts=A --scales=1000:none --cpu-profile=1 \
      --label=profile-S1k-open $GATE --max-min=6 2>&1 | tee "$OUT/profile.log"
    step "profiled OPEN item done (mode profiled)"
    ;;
  reactive)
    # Separate axis: reduced reactive-state fixture (treeDepth 3 ~ 6 000 tracked
    # nodes, not the 50 800-node default), OFF / CLOSED / OPEN, n = 1.
    manifest "$ROOT" e0d1e51-branch
    node perf/reactive-smoke.mjs --treeDepth=3 --gate=$(nproc):50 --linux-gate=2048:10 \
      --gate-wait=180 --max-min=9 2>&1 | tee "$OUT/reactive.log"
    step "reactive smoke done (mode latency)"
    ;;
  *)
    echo "phase $PHASE not enabled in this run" >&2
    exit 2
    ;;
esac
cp -r playground/.temp/perf-results "$OUT/results" 2>/dev/null || true
step "end"
