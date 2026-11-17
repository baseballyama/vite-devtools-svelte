---
'@sveltejs/vite-devtools-svelte': minor
---

- The API playground sends requests from the browser instead of the dev server, so they carry your app's cookies (httpOnly included) and work behind Docker, proxies and tunnels. A `Set-Cookie` in a response now updates your app's session. Cross-origin URLs now need a CORS policy that allows them.
- Responses stream in as they arrive (SSE included), with a Stop button. The 30 s timeout covers only the wait for the headers, and bodies are cut at 5 MB.
- Removed: the `send-api-request` RPC and the `ApiResponse` type. `ApiEndpoint` gains `url`.
