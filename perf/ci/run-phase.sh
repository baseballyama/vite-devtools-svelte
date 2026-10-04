#!/usr/bin/env bash
# One measurement phase on a GitHub-hosted Linux runner (perf-linux.yml).
# Every phase records the runner spec, per-file hash manifests of each
# measured checkout (same method on every side), a resource sampler and
# timings into $OUT (under $RUNNER_TEMP, outside every checkout), which
# perf/ci/sanitize-artifact.mjs scrubs before upload. Console output is
# redacted on the way to the public job log as well.
#
# Kit 3 stack: the baseline is main 71a9992 (SvelteKit 3 playground, kit3
# fixture shape). Numbers from the pre-Kit-3 branch (perf/linux-bench-smoke,
# e0d1e51 / kit2 shape) are never compared with these.
#
#   smoke            71a9992 only, S1k: OFF / CLOSED / OPEN + DevTools UI. n = 1.
#   reactive         reduced reactive fixture (separate axis), OFF / CLOSED / OPEN, n = 1.
#   profile          71a9992, mode "profiled": per-window CPU profiles (mount / idle /
#                    input / churn) for CLOSED and OPEN, server cold load vs steady
#                    windows, DevTools UI operations. Never compared with latency runs.
#   improve          B 71a9992 vs F $PERF_CANDIDATE (plugin code delta, same lockfile
#                    and deps), order BFFBBFFB (n = 4 per side), mode latency.
set -euo pipefail

PHASE="${1:?phase}"
ROOT="$(pwd)"
OUT="${RUNNER_TEMP:?}/perf-out"
SIDES="$RUNNER_TEMP/sides"
mkdir -p "$OUT/manifests" "$OUT/results" "$SIDES"
T0=$(date +%s)
step() { echo "$(( $(date +%s) - T0 ))s $*" | tee -a "$OUT/timings.txt"; }
redact() { node "$ROOT/perf/ci/sanitize-artifact.mjs" --stream; }
RESULT_DIRS=("$ROOT/playground/.temp/perf-results")

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

# Same method for every side: lockfile, plugin and client sources, dist files,
# resolved versions. `dirty` ignores the harness's own fixture/result dirs.
manifest() { # <dir> <label>
  local d="$1" f="$OUT/manifests/$2.txt"
  {
    echo "rev $(git -C "$d" rev-parse HEAD)"
    echo "dirty $(git -C "$d" status --porcelain -- . ':!playground/.temp' | wc -l)"
    (cd "$d" && sha256sum pnpm-lock.yaml)
    echo "src-tree $(cd "$d" && find packages/vite-devtools-svelte/src packages/vite-devtools-svelte/client/src -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)"
    (cd "$d" && find packages/vite-devtools-svelte/src -type f -print0 | sort -z | xargs -0 sha256sum)
    (cd "$d" && find packages/vite-devtools-svelte/dist -type f -print0 | sort -z | xargs -0 sha256sum)
    for p in vite svelte @sveltejs/kit @sveltejs/vite-plugin-svelte @vitejs/devtools; do
      echo "dep $p $(node -p "require('$d/playground/node_modules/$p/package.json').version" 2>/dev/null || echo n/a)"
    done
  } > "$f"
}

side() { # <sha> <label>: pristine worktree, its own pnpm, build
  local sha="$1" dir="$SIDES/$2"
  git cat-file -e "$sha^{commit}" || { echo "commit $sha not available" >&2; exit 2; }
  git worktree add -q --detach "$dir" "$sha"
  local pm; pm=$(node -p "require('$dir/package.json').packageManager.replace(/\+.*/, '')")
  # build:plugin + build:client called directly with the side's own pnpm (the
  # root "build" script would re-enter whichever pnpm is on PATH)
  (cd "$dir" && npx -y "$pm" install --frozen-lockfile --reporter=silent \
    && npx -y "$pm" -C packages/vite-devtools-svelte build >/dev/null \
    && npx -y "$pm" -C packages/vite-devtools-svelte/client build >/dev/null)
  manifest "$dir" "$2"
  RESULT_DIRS+=("$dir/playground/.temp/perf-results")
  step "side $2 ($sha, $pm) installed + built"
}

# assert_same <a> <b> <regex of manifest lines that must match> <what>
assert_same() {
  local a="$OUT/manifests/$1.txt" b="$OUT/manifests/$2.txt"
  if diff <(grep -E "$3" "$a") <(grep -E "$3" "$b") > /dev/null; then
    echo "stack check: $4 identical ($1 vs $2)" | tee -a "$OUT/spec.txt"
  else
    echo "stack check: $4 DIFFERS ($1 vs $2)" | tee -a "$OUT/spec.txt"
    diff <(grep -E "$3" "$a") <(grep -E "$3" "$b") | head -20 >> "$OUT/spec.txt" || true
    exit 2
  fi
}

# Resource sampler for the whole phase (peak memory / load / CPU / PSI): one
# line every 2 s. Only this PID (our own child) is stopped at the end.
sampler() {
  local prev; prev=$(head -1 /proc/stat)
  while sleep 2; do
    local cur; cur=$(head -1 /proc/stat)
    local idle; idle=$(awk -v a="$prev" -v b="$cur" 'BEGIN{split(a,x," ");split(b,y," ");i0=(y[5]+y[6])-(x[5]+x[6]);t=0;for(i=2;i<=11;i++)t+=y[i]-x[i];printf "%.1f",(t>0?100*i0/t:0)}')
    prev=$cur
    local psi; psi=$(awk '/^some/{sub("avg10=","",$2);print $2}' /proc/pressure/memory 2>/dev/null)
    echo "$(date +%s) avail_mb=$(awk '/^MemAvailable/{print int($2/1024)}' /proc/meminfo) load1=$(cut -d' ' -f1 /proc/loadavg) idle=$idle psi_mem=${psi:-na}"
  done > "$OUT/resources.txt"
}
sampler &
SAMPLER_PID=$!
finish() {
  local code=$?
  kill "$SAMPLER_PID" 2>/dev/null || true
  # results are copied on every exit path, incl. failures and watchdogs (M4)
  for d in "${RESULT_DIRS[@]}"; do
    [ -d "$d" ] && cp -r "$d/." "$OUT/results/" 2>/dev/null || true
  done
  if [ -s "$OUT/resources.txt" ]; then
    awk '{for(i=2;i<=NF;i++){split($i,kv,"=");v[kv[1]]=kv[2]}
      if(min==""||v["avail_mb"]+0<min)min=v["avail_mb"]+0; if(v["load1"]+0>ml)ml=v["load1"]+0;
      if(mi==""||v["idle"]+0<mi)mi=v["idle"]+0; if(v["psi_mem"]+0>mp)mp=v["psi_mem"]+0; n++}
      END{printf "samples %d (2 s), min MemAvailable %s MB, max load1 %s, min CPU idle %s%%, max PSI mem some avg10 %s\n",n,min,ml,mi,mp+0}' \
      "$OUT/resources.txt" > "$OUT/resources-summary.txt"
  fi
  echo "oom after phase: $(grep -E '^(oom|oom_kill) ' /sys/fs/cgroup/memory.events 2>/dev/null | tr '\n' ' ')" >> "$OUT/resources-summary.txt"
  echo "exit $code" >> "$OUT/timings.txt"
}
trap finish EXIT

spec
step "start"
GATE="--gate=$(nproc):50 --linux-gate=2048:10 --gate-wait=180 --gate-policy=skip"
BASE=71a99925d9c551b364aecec12bd01d3bf7455808

same_as_base() {
  # This branch changes only perf/ and .github/ relative to 71a9992.
  if git diff --quiet "$BASE" HEAD -- packages playground pnpm-lock.yaml; then
    echo "plugin/playground/lockfile identical to 71a9992" >> "$OUT/spec.txt"
  else
    echo "plugin/playground/lockfile DIFFERS from 71a9992" | tee -a "$OUT/spec.txt"
    exit 2
  fi
  manifest "$ROOT" 71a9992-branch
}

case "$PHASE" in
  smoke)
    same_as_base
    node perf/run-paired.mjs --order=F --parts=A,OFF,UI --scales=1000:none \
      --label=smoke-S1k $GATE --max-min=7 2>&1 | redact | tee "$OUT/smoke.log"
    step "smoke S1k OFF/CLOSED/OPEN/UI done (mode latency)"
    ;;
  reactive)
    same_as_base
    node perf/reactive-smoke.mjs --treeDepth=3 --gate=$(nproc):50 --linux-gate=2048:10 \
      --gate-wait=180 --max-min=9 2>&1 | redact | tee "$OUT/reactive.log"
    step "reactive smoke done (mode latency)"
    ;;
  profile)
    # Separate run: profiler overhead must not leak into latency numbers.
    same_as_base
    node perf/run-paired.mjs --order=F --parts=A,UI --scales="${PROFILE_SCALES:-3000:4x5}" \
      --cpu-profile=1 --label=profile $GATE --max-min=10 2>&1 | redact | tee "$OUT/profile.log"
    step "profiled windows done (mode profiled)"
    ;;
  improve)
    # Pristine detached worktrees, each installed with its own pnpm and built;
    # the harness and Chromium come from this branch. The candidate is a
    # pushed commit (checkout fetch-depth 0 brings every branch).
    side "$BASE" base
    side "${PERF_CANDIDATE:?PERF_CANDIDATE}" candidate
    # plugin code delta only: same lockfile and resolved deps on both sides
    assert_same base candidate '(pnpm-lock\.yaml$|^dep )' 'lockfile + resolved deps'
    node perf/run-paired.mjs --baseline="$SIDES/base" --final="$SIDES/candidate" \
      --order=BFFBBFFB --parts=A,OFF,UI --scales="${PAIR_SCALES:-3000:4x5}" \
      --label=improve $GATE --max-min=14 2>&1 | redact | tee "$OUT/improve.log"
    step "improve BFFBBFFB done (mode latency)"
    ;;
  *)
    echo "phase $PHASE not enabled in this run" >&2
    exit 2
    ;;
esac
step "end"
