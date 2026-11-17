---
'vite-devtools-svelte': minor
---

The API playground now sends requests from the browser instead of proxying them through the dev server. Requests to your app carry its cookies (httpOnly ones included), and `Set-Cookie` responses land in the browser, so endpoints behind a session can be tried directly. The app's own URLs work wherever the DevTools page is opened from (Docker, a reverse proxy, a tunnel, middleware mode); before, only the dev server's resolved URLs were allowed. Picking an endpoint fills its URL under `paths.base`. `GET` endpoints also list `HEAD`. Streaming responses such as SSE show what arrived before the 30 s timeout, and bodies are cut at 5 MB. The `send-api-request` RPC is removed, and the playground's server-side outbound fetch with it. Cross-origin URLs now work only where their CORS policy allows it.
