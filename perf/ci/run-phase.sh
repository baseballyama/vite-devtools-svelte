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
#   smoke-reactive  smoke, then the reactive phase below (both mode latency)
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

# Resource sampler for the whole phase (peak memory / load / CPU): one line
# every 2 s. Only this PID (our own child) is stopped at the end.
sampler() {
  local prev; prev=$(head -1 /proc/stat)
  while sleep 2; do
    local cur; cur=$(head -1 /proc/stat)
    local idle; idle=$(awk -v a="$prev" -v b="$cur" 'BEGIN{split(a,x," ");split(b,y," ");i0=(y[5]+y[6])-(x[5]+x[6]);t=0;for(i=2;i<=11;i++)t+=y[i]-x[i];printf "%.1f",(t>0?100*i0/t:0)}')
    prev=$cur
    echo "$(date +%s) avail_mb=$(awk '/^MemAvailable/{print int($2/1024)}' /proc/meminfo) load1=$(cut -d' ' -f1 /proc/loadavg) idle=$idle psi_mem=$(awk '/^some/{print $2}' /proc/pressure/memory 2>/dev/null)"
  done > "$OUT/resources.txt"
}
sampler &
SAMPLER_PID=$!
finish() {
  kill "$SAMPLER_PID" 2>/dev/null || true
  if [ -s "$OUT/resources.txt" ]; then
    awk '{for(i=2;i<=NF;i++){split($i,kv,"=");v[kv[1]]=kv[2]}
      if(min==""||v["avail_mb"]<min)min=v["avail_mb"]; if(v["load1"]>ml)ml=v["load1"];
      if(mi==""||v["idle"]<mi)mi=v["idle"]; n++}
      END{printf "samples %d (2 s), min MemAvailable %s MB, max load1 %s, min CPU idle %s%%\n",n,min,ml,mi}' \
      "$OUT/resources.txt" > "$OUT/resources-summary.txt"
  fi
}
trap finish EXIT

spec
step "start"
GATE="--gate=$(nproc):50 --linux-gate=2048:10 --gate-wait=180 --gate-policy=skip"

case "$PHASE" in
  smoke | smoke-reactive)
    # This branch changes only perf/ and .github/ relative to e0d1e51.
    git diff --quiet e0d1e5165ebb16436da8ea4897e2cf3050047fd5 HEAD -- packages playground pnpm-lock.yaml \
      && echo "plugin/playground/lockfile identical to e0d1e51" >> "$OUT/spec.txt"
    manifest "$ROOT" e0d1e51-branch
    node perf/run-paired.mjs --order=F --parts=A,OFF,UI --scales=1000:none \
      --label=smoke-S1k $GATE --max-min=7 2>&1 | tee "$OUT/smoke.log"
    step "smoke S1k OFF/CLOSED/OPEN/UI done (mode latency)"
    if [ "$PHASE" = smoke-reactive ]; then
      node perf/reactive-smoke.mjs --treeDepth=3 --gate=$(nproc):50 --linux-gate=2048:10 \
        --gate-wait=180 --max-min=9 2>&1 | tee "$OUT/reactive.log"
      step "reactive smoke done (mode latency)"
    fi
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
