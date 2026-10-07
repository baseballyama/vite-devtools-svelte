---
'vite-devtools-svelte': patch
---

Security: the API playground and Social preview no longer fetch private addresses written as bracketed IPv6 literals (`http://[fd00::1]/`, `http://[fe80::1]/`, `http://[::ffff:127.0.0.1]/`) or in ranges the old check missed (`0.0.0.0/8`, `100.64.0.0/10`, multicast, reserved, documentation and benchmarking ranges, NAT64 and 6to4 forms of private IPv4, `*.localhost`, `localhost.`). Names that fail to resolve are now rejected instead of fetched.
