---
'vite-devtools-svelte': patch
---

Internal hardening from stricter type checking and linting: malformed hot-channel payloads (non-object messages, FPS samples without numbers, runtime errors without a string message) are dropped instead of stored; a failing MCP request is logged instead of becoming an unhandled rejection; a custom `logger.warn` is called with its logger as `this`; `exports` lists `types` first and exports `./package.json`.
