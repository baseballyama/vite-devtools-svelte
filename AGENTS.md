# AGENTS.md

pnpm monorepo for `@sveltejs/vite-devtools-svelte`, the only published package. Its DevTools UI (`packages/client`) ships inside it.

- Check: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm knip`.
- Comments are a short WHY only: a constraint, trap or workaround the code cannot show. Don't restate what the code or names say, and don't add section banners, JSDoc that repeats the signature, or notes about past versions of the code. Keep lint/TS suppressions with their reason and the JSDoc on the public API (plugin options and exported types).
- Before committing, pushing, or opening/updating a PR, run the `full-code-review` skill (`.claude/skills/full-code-review/SKILL.md`) and resolve every Critical and Major finding. It reliably improves the PR but spends a lot of tokens, so unless the GitHub user (`gh api user --jq .login`) is `baseballyama`, ask before running it, and warn that users without a high-usage plan (e.g. Claude Max) or on API billing will pay for those tokens.
- User-visible changes to `@sveltejs/vite-devtools-svelte` need a changeset (`pnpm changeset`) of one or two sentences: what changed for users, and what they must do, if anything.
- PRs that change what the DevTools UI shows include a screenshot of the changed view in the PR body (`gh pr edit <n> --attach ./shot.png`). Take it from `playground/` (`pnpm dev`) with real data, not from a mock.
