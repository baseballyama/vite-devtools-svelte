# AGENTS.md

pnpm monorepo for `@sveltejs/vite-devtools-svelte`, the only published package. Its DevTools UI (`packages/client`) ships inside it.

- Check: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm knip`.
- Before committing, pushing, or opening/updating a PR, always run the `full-code-review` skill (`.claude/skills/full-code-review/SKILL.md`) and resolve every Critical and Major finding.
- User-visible changes to `@sveltejs/vite-devtools-svelte` need a changeset (`pnpm changeset`) of one or two sentences: what changed for users, and what they must do, if anything.
