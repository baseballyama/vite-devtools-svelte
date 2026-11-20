---
name: full-code-review
description: Owner-level review of the current branch of vite-devtools-svelte — WHY, design, then a chunked multi-reviewer implementation review — fixing findings with the user until no Critical or Major remains, then the CI gates and the changeset. Use for "/full-code-review", "full review", "review this", and before committing, pushing, or opening/updating a PR (ask first unless the GitHub user is `baseballyama`; see AGENTS.md).
---

# Full code review

Review the branch as its code owner would, phase by phase. Each phase finds problems, fixes the approved ones, and only then moves on.

## Ground rules

- **Ask before running.** This review spends a lot of tokens. Unless `gh api user --jq .login` is `baseballyama` or the user invoked it directly (`/full-code-review`, "full review"), ask before starting, and warn that users without a high-usage plan (e.g. Claude Max) or on API billing will pay for those tokens.
- **Verify, don't trust.** This skill and `implementation-checklist.md` say where to look, not what is true; the code at HEAD wins. Reviewer output (subagents, Codex) is a claim until you have read the cited lines and can state the concrete failure. Drop what you cannot confirm.
- **Every finding** has a severity, `file:line`, the failure scenario (input/state → wrong result), and a fix.
- **Fix with consent.** Present findings in one batch per phase or chunk; apply what the user approves. When the user asked for the review only, report and stop.
- **Never merge.** Commit or push only when the user asks.

| Severity | Meaning                                                                                         | Handling                                 |
| -------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Critical | Security hole, effect on production builds, breaks the user's app                               | Must fix                                 |
| Major    | Wrong behavior, leak, perf regression, missing test for new logic, broken invariant (see below) | Fix unless the user explicitly waives it |
| Minor    | Readability, naming, small simplification                                                       | Optional; list them, don't loop on them  |

## Project invariants

These are what most reviews hinge on. Confirm each against the code before relying on it.

- **Dev only.** Every hook bails out unless `serving()` / `command === 'serve'` (`packages/vite-devtools-svelte/src/plugin.ts`). `pnpm perf:noop` proves production output carries no devtools code.
- **Browser runtime** (`src/runtime/wrapper.js`, `client.js`) runs inside the user's page: one store under `window.__SVELTE_DEVTOOLS__`, no other globals, no prototype changes, no `eval`. `wrapper.js` replaces `svelte/internal/client` for app code; `src/runtime/transform.ts` adds the tracking to components and `.svelte.js/ts` modules.
- **Runtime ↔ server** over Vite's HMR channel: event names live in `HOT_EVENTS` (`src/runtime/ids.ts`); every `send` needs a matching `on` on the other side, and request/reply pairs need a timeout that removes the pending request.
- **Server → UI** over devframe RPC: `defineRpcFunction` in `src/server/devframe.ts`, typed in `src/types.ts`, called from `packages/client/src/lib/rpc.ts`. Arguments are validated with zod.
- **Bounded memory.** Long-lived datasets use `Ring` (`src/server/ring.ts`) or another explicit cap.
- **Security** helpers in `src/security.ts`: outbound URLs go through `validateExternalUrl` / its DNS-resolving variant; served files through `resolveWithinRoot`. The standalone UI is gated by a one-time code (`clientAuth`, `src/server/mount.ts`).
- **MCP** endpoint (`src/mcp/http.ts`) is gated by a token; its tools never modify the user's project.
- **UI** (`packages/client`, shipped in the plugin's `dist/client`): panels register in `src/lib/panels.ts`; reuse `src/components/`; colors and sizes come from `src/design-system.css` tokens.
- **Shipped skills** (`packages/vite-devtools-svelte/skills/`): `name` equals the directory name, lowercase with hyphens (enforced by `test/skills.test.ts`).
- **Public API** = the plugin options and the npm package contents. Changing either needs README and changeset updates.

## Step 0: Scope

1. Base: the user's choice, else the PR's base (`gh pr view <n> --json baseRefName`), else `origin/main`. Run `git fetch origin` first.
2. Scope is everything since the merge base, including uncommitted and untracked files:
   ```bash
   node .claude/skills/full-code-review/scripts/plan-review-chunks.mjs "$BASE" --format=md
   ```
3. Report the base, file count and chunk table. Flag untracked files that look accidental (screenshots, scratch output, `.playwright-mcp/`) instead of reviewing them.

## Phase 1: WHY

Read the PR body and linked issues (`gh pr view`), the commit messages and the changesets. State the problem being solved, who benefits, and whether the change is proportionate. Ask the user only when the intent is unclear or the change looks unjustified, scope-crept, or likely to add noticeable dev-time overhead. Otherwise state your understanding and continue.

## Phase 2: Design

Read the whole diff once and judge:

- It follows the invariants above and existing patterns instead of adding a parallel mechanism.
- Data flow is one-directional and each dataset has one owner.
- No speculative abstraction, option or extension point (YAGNI); nothing duplicated that a shared helper already covers.
- Public API or breaking changes are intentional, documented, and in the changeset.

Report the design in a few lines plus findings. Resolve Critical/Major with the user before Phase 3.

## Phase 3: Implementation (per chunk)

For each chunk, in table order, launch the reviewers below **in parallel in one message** (subagents, read-only: they must not edit files). Give each the chunk's file list, `$BASE`, the merge base, and: "Review only these files; report findings as severity, file:line, failure scenario, fix; say 'no findings' if none."

1. **Security** — injection, path traversal, SSRF, XSS/prototype pollution in the runtime, unsafe RegExp from input, auth bypass of the standalone UI or MCP endpoint.
2. **Correctness** — read `implementation-checklist.md` first; bugs, races, leaks, broken invariants, missing or wrong tests.
3. **Simplicity** — reuse of existing helpers/components, dead code, needless abstraction, comments that are not a short WHY (restating code, banners, signature-repeating JSDoc, history). (Do not run the `simplify` skill here: it edits files.)

Skip a reviewer that has nothing to look at (e.g. Security on a docs chunk). For `changeset`, `lockfile`, `docs`, and `apps` chunks, a single combined reviewer is enough; for `lockfile`, only check that changes match the `package.json` edits.

**External reviewer**, once for the whole branch at the start of Phase 3, in the background, if installed and authenticated (otherwise record "skipped"):

```bash
codex review --base "$BASE"
```

Assign its findings to chunks and verify them like any other.

**Per chunk:** merge and dedupe the findings, verify each yourself, present them, apply approved fixes, then re-run only the reviewers that reported Critical/Major, on the files touched. Repeat until no unwaived Critical/Major remains. After three rounds on one chunk, ask the user whether to continue.

Progress line: `Chunk 2/7 (plugin: src/server/) · round 1`.

## Phase 4: Gates and changeset

1. Run the CI checks that cover the touched packages and fix failures:
   ```bash
   pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm knip && pnpm sherif
   ```
   Add `pnpm build && pnpm publint` when the package contents or exports change, and `pnpm perf:noop` when plugin hooks or injection change.
2. Changeset: needed for any user-visible change to `@sveltejs/vite-devtools-svelte`, including the DevTools UI and shipped skills. Not needed for tests, CI, tooling, docs-only, or private packages (`svelte-devtools-client`, `vite-devtools-svelte-inspector`, `playground`, `site`). Each changeset is **one or two sentences**: what changed for users, plus the action they must take if any. No implementation details, internal rationale, or numbers. Shorten any changeset that does more.
3. Screenshot: when the branch changes what the DevTools UI shows (`packages/client`, or anything the panels render), capture the changed view from `playground/` with real data and put it in the PR body (`gh pr edit <n> --attach ./shot.png`). A UI PR without one is not ready.

## Phase 5: Summary

```
## Review summary — Approve / Request changes
Base: origin/main · 12 files · 4 chunks · Codex skipped (not installed)

| Phase | Result | Fixed | Waived |
|---|---|---|---|
| WHY | OK | – | – |
| Design | OK | 1 Major | – |
| Implementation | OK | 2 Major, 3 Minor | 1 Minor |
| Gates | all pass | – | – |
| Changeset | added / shortened / not needed | – | – |
| Screenshot | attached / not a UI change | – | – |

Waived: <finding — user's reason>
Manual checks for the owner: <e.g. try it in playground/, the Vite DevTools dock and the standalone UI>
```

Approve only when no unwaived Critical/Major remains and every gate passes. Then, only if the user asks, commit and push (branch first if on `main`), and watch CI with `gh pr checks` until it is green.
