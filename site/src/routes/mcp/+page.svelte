<script lang="ts">
  import { base } from '$app/paths'
  import CodeBlock from '$lib/CodeBlock.svelte'
  import { MCP_TOOL_COUNT, MCP_TOOL_GROUPS } from '$lib/mcp-tools'
  import { MCP_EXAMPLES, MCP_EXAMPLES_SOURCE, type McpExample } from '$lib/mcp-examples'

  const printedCode = `  svelte-devtools MCP ready — register with Claude Code:
    claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:<token>`

  const reRegisterCode = `claude mcp remove svelte
claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:<new token>`

  const mcpJsonCode = `{
  "mcpServers": {
    "svelte": {
      "type": "http",
      "url": "http://localhost:5173/__svelte-devtools/mcp",
      "headers": { "x-svelte-devtools-token": "\${SVELTE_DEVTOOLS_TOKEN}" }
    }
  }
}`

  const envCode = `export SVELTE_DEVTOOLS_TOKEN=<token from the printed line>
claude`

  const curlCode = `curl -s http://localhost:5173/__svelte-devtools/mcp \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'x-svelte-devtools-token: <token>' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`

  const promptCode = `The cart total on /cart looks wrong after I change the tax rate.
Use the svelte MCP server: find the busiest components, look at the
ReactivePriceChart instance, and tell me which state can affect grandTotal
and what changed when I edited the tax rate.`

  const sections = [
    { num: '01', title: 'What it is', anchor: 'what' },
    { num: '02', title: 'Connect Claude Code', anchor: 'connect' },
    { num: '03', title: 'Other MCP clients', anchor: 'clients' },
    { num: '04', title: `The ${MCP_TOOL_COUNT} tools`, anchor: 'tools' },
    { num: '05', title: 'Walkthrough: why did it update?', anchor: 'walkthrough' },
    { num: '06', title: 'Measure a change', anchor: 'sessions' },
    { num: '07', title: 'What the answers cover', anchor: 'limits' },
    { num: '08', title: 'The same data in the panel', anchor: 'panel' },
    { num: '09', title: 'Troubleshooting', anchor: 'troubleshooting' },
    { num: '10', title: 'Security', anchor: 'security' },
    { num: '11', title: 'Versions', anchor: 'versions' },
  ]

  const ex = (id: string): McpExample => {
    const e = MCP_EXAMPLES.find((x) => x.id === id)
    if (!e) throw new Error(`missing MCP example ${id}`)
    return e
  }
  const request = (e: McpExample) => JSON.stringify({ name: e.tool, arguments: e.arguments }, null, 2)
  const response = (e: McpExample) => JSON.stringify(e.response, null, 2)

  const walkthrough = [
    {
      id: 'summary',
      title: 'Find where the activity is',
      text: 'Counters over all instances, without capturing the graph. The answer says what it covers: here 2 of 5 registered components were active, and sampledActiveMs shows that sampling ran for only 5 s of the 30 s window (the runtime samples only while a panel or an agent is reading). The price chart has not changed yet, so it is not listed.',
    },
    {
      id: 'live',
      title: 'Get instance ids with their page load',
      text: 'Component ids restart on every page load, so ask for the epoch together with the ids. ReactivePriceChart is instance 14 here.',
    },
    {
      id: 'scope',
      title: 'Look at one instance',
      text: 'Nodes of that instance and their direct neighbours. An edge means the source can affect the target (a current dependency), not that it caused a change. Note that the $effect has no edges although it reads grandTotal (see What the answers cover).',
    },
    {
      id: 'timeline-first',
      title: 'Read the change timeline',
      text: 'The first call has no cursor, so reset is true and the answer holds the newest entries of the buffer. Keep the returned cursor. Old and new values are included; larger ones are replaced by a size summary.',
    },
    {
      id: 'timeline-next',
      title: 'Edit, then read only what is new',
      text: 'After changing the tax rate in the app from 0.1 to 0.08, pass the cursor as since: only that change comes back.',
    },
    {
      id: 'capture',
      title: 'Check how complete the data is',
      text: 'What the DevTools hold versus what the app reported, per dataset, with the selection policy. A total of null means unknown. Read it before drawing conclusions from capped data.',
    },
    {
      id: 'stale',
      title: 'After a reload, ids are refused, not guessed',
      text: 'After reloading the app page, the same componentId with the old epoch returns an empty graph with staleReason "epoch-changed" instead of another instance.',
    },
  ]

  const shots = [
    {
      src: 'reactivity-overview.png',
      alt: 'Reactivity overview: window, sampling, coverage and the most active component',
      caption: 'Overview: the same counters as get_reactive_summary.',
    },
    {
      src: 'reactivity-component.png',
      alt: 'Local graph of ReactivePriceChart with taxRate selected; the inspector says Cause: Not recorded',
      caption: 'One instance, as get_reactive_scope returns it. Edges mean can affect.',
    },
    {
      src: 'reactivity-states.png',
      alt: 'States: the running state of FpsCanvas with three sampled changes',
      caption: 'States from the timeline buffer, as get_state_timeline returns it.',
    },
    {
      src: 'reactivity-epoch.png',
      alt: 'After a reload the panel says the app page reloaded and asks to pick the component again',
      caption: 'After a reload: the epoch-changed answer, in the panel.',
    },
  ]
</script>

<svelte:head>
  <title>MCP — vite-devtools-svelte</title>
  <meta
    name="description"
    content="Connect Claude Code and other MCP clients to your Svelte dev server: setup, the 20 tools with real examples, limits, troubleshooting and security."
  />
</svelte:head>

<section class="band no-border hero">
  <div class="container">
    <div class="head-meta">
      <span class="eyebrow"><span class="eyebrow-num">§ mcp</span> · for AI agents</span>
      <span class="mono dim">{MCP_TOOL_COUNT} tools</span>
      <a class="mono" href="{base}/ja/mcp" hreflang="ja" lang="ja">日本語クイックスタート</a>
    </div>
    <h1>MCP.</h1>
    <p class="lead">
      The dev server also speaks the Model Context Protocol. Coding agents such as
      Claude Code read the same render, reactivity, load and frame-rate data as the
      panels, and every answer says what it covers.
    </p>
    <p class="release-note">
      This guide describes <strong>vite-devtools-svelte ≥ 0.4.0</strong> (not yet
      published). Set it up first with <a href="{base}/getting-started">Getting Started</a>.
    </p>
  </div>
</section>

<section class="band">
  <div class="container doc">
    <nav class="toc" aria-label="Table of contents">
      <span class="toc-label mono">contents</span>
      <ol>
        {#each sections as s (s.anchor)}
          <li>
            <a href="#{s.anchor}">
              <span class="toc-num mono">{s.num}</span>
              <span>{s.title}</span>
            </a>
          </li>
        {/each}
      </ol>
    </nav>

    <article class="content">
      <section id="what" class="step">
        <header class="step-head">
          <span class="step-num mono">01</span>
          <h2>What it is</h2>
        </header>
        <p>
          While <code>vite dev</code> runs, the plugin serves an MCP endpoint at
          <code>/__svelte-devtools/mcp</code> (Streamable HTTP). Agents call tools on it
          to read what the panels show: the busiest components, the reactive graph of one
          instance, sampled state changes, render profiles, load functions and frame
          rate. They can also run measurement sessions to compare before and after a
          change.
        </p>
        <p>
          No tool changes your app's code or state. Two things do happen: a call keeps the
          runtime in the page sampling for about a minute, and the session tools keep
          measurement sessions (in memory; on disk only when asked, and
          <code>delete_session</code> removes them). Runtime data comes from the app page
          open in a browser, so keep the app open while the agent works.
        </p>
      </section>

      <section id="connect" class="step">
        <header class="step-head">
          <span class="step-num mono">02</span>
          <h2>Connect Claude Code</h2>
        </header>
        <p>
          Start the dev server. Once it listens, it prints the exact command to register
          the server with Claude Code, including the port and a token:
        </p>
        <CodeBlock code={printedCode} lang="text" filename="terminal (npm run dev)" />
        <p>
          Run that line as printed. Every request must carry the token in the
          <code>x-svelte-devtools-token</code> header; without it the endpoint answers
          <code>403</code>.
        </p>
        <h3 class="content-h2">The token changes on every start</h3>
        <p>
          The token is random per dev-server start (also when Vite restarts after a
          config change). After a restart, register again with the newly printed line:
        </p>
        <CodeBlock code={reRegisterCode} lang="bash" />
        <h3 class="content-h2">Project file instead of the command</h3>
        <p>
          <code>claude mcp add</code> registers the server for you only (local scope). A
          <code>.mcp.json</code> file in the project is shared with everyone who opens the
          project (project scope), so never write the token into it. Claude Code expands
          environment variables in that file, so read the token from one:
        </p>
        <CodeBlock code={mcpJsonCode} lang="json" filename=".mcp.json" />
        <p>Set it from the line the dev server printed, then start Claude Code:</p>
        <CodeBlock code={envCode} lang="bash" />
        <p>The port in the URL must match your dev server.</p>
        <h3 class="content-h2">Ask</h3>
        <p>For example, with the cart page of your app open:</p>
        <CodeBlock code={promptCode} lang="text" filename="prompt" />
        <p>
          The agent typically starts with <code>get_reactive_summary</code> or
          <code>list_performance_issues</code> and follows the hints in the answers. The
          <a href="#walkthrough">walkthrough</a> shows each step with real answers.
        </p>
      </section>

      <section id="clients" class="step">
        <header class="step-head">
          <span class="step-num mono">03</span>
          <h2>Other MCP clients</h2>
        </header>
        <p>
          Any client that supports Streamable HTTP with custom headers can connect. It
          needs two values:
        </p>
        <ul>
          <li>URL: <code>http://localhost:&lt;port&gt;/__svelte-devtools/mcp</code></li>
          <li>Header: <code>x-svelte-devtools-token: &lt;token&gt;</code> (from the printed line)</li>
        </ul>
        <p>
          The server is stateless and answers with JSON. Only the Claude Code command is
          printed by the dev server; for other clients, use their own configuration
          format with these two values. To check the endpoint by hand:
        </p>
        <CodeBlock code={curlCode} lang="bash" />
      </section>

      <section id="tools" class="step">
        <header class="step-head">
          <span class="step-num mono">04</span>
          <h2>The {MCP_TOOL_COUNT} tools</h2>
        </header>
        <p>All inputs are optional unless they have no <code>?</code>.</p>
        {#each MCP_TOOL_GROUPS as group (group.id)}
          <h3 class="group-title" id="tools-{group.id}">{group.title}</h3>
          <p class="group-intro">{group.intro}</p>
          <dl class="tools">
            {#each group.tools as tool (tool.name)}
              <div class="tool">
                <dt><code>{tool.name}</code></dt>
                <dd>
                  <p class="tool-input mono">{tool.input}</p>
                  <p>{tool.summary}</p>
                  {#if tool.note}<p class="tool-note">{tool.note}</p>{/if}
                </dd>
              </div>
            {/each}
          </dl>
        {/each}
      </section>

      <section id="walkthrough" class="step">
        <header class="step-head">
          <span class="step-num mono">05</span>
          <h2>Walkthrough: why did it update?</h2>
        </header>
        <p>
          Real calls against the example app (<code>examples/sample-app</code>, a synthetic
          shop) with one item in the cart. Absolute paths are replaced by
          <code>&lt;project&gt;</code>; long answers are shortened where marked.
        </p>
        <p class="provenance">{MCP_EXAMPLES_SOURCE}</p>
        <ol class="flow">
          {#each walkthrough as step (step.id)}
            {@const e = ex(step.id)}
            <li>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <CodeBlock code={request(e)} lang="json" filename="→ {e.tool}" />
              <CodeBlock code={response(e)} lang="json" filename="← response{e.shortened ? ' (shortened)' : ''}" />
            </li>
          {/each}
        </ol>
        <p>
          In a large app the same order keeps every answer small: summary first, then
          one instance, then only the new timeline entries.
        </p>
      </section>

      <section id="sessions" class="step">
        <header class="step-head">
          <span class="step-num mono">06</span>
          <h2>Measure a change</h2>
        </header>
        <p>
          Start a session, use the app, end it; do the same after your change, then
          compare. Each section of the comparison has a verdict. In this run nothing heavy changed between the two sessions, so every verdict is unchanged.
        </p>
        {#each ['session-start', 'session-compare'] as id (id)}
          {@const e = ex(id)}
          <CodeBlock code={request(e)} lang="json" filename="→ {e.tool}" />
          <CodeBlock code={response(e)} lang="json" filename="← response{e.shortened ? ' (shortened)' : ''}" />
        {/each}
        <p>
          Sessions live in memory for the life of the dev server.
          <code>end_session</code> with <code>keep: "disk"</code> writes them to
          <code>node_modules/.vite-devtools-svelte/sessions/</code> in your project.
        </p>
      </section>

      <section id="limits" class="step">
        <header class="step-head">
          <span class="step-num mono">07</span>
          <h2>What the answers cover</h2>
        </header>
        <ul class="limits">
          <li>
            <strong>Sampled.</strong> State is checked every 200 ms; several writes within
            one sample count once. Counts are not totals or rates.
          </li>
          <li>
            <strong>Component state only.</strong> State created during a component's
            init is tracked; module-level state in <code>.svelte.ts</code> files is not.
          </li>
          <li>
            <strong>Can affect, not caused.</strong> Edges are current dependencies. Which
            write changed a value is not recorded.
          </li>
          <li>
            <strong>Some dependencies are missing.</strong> An <code>$effect</code> may show
            no incoming edges even when it reads state.
          </li>
          <li>
            <strong>Values are summaries in the graph.</strong> Objects and arrays appear as
            <code>(object)</code>, <code>[n]</code> or <code>{'{n}'}</code>. The timeline
            includes values up to <code>maxValueChars</code>.
          </li>
          <li>
            <strong>No per-signal history.</strong> The timeline keeps the latest 500
            sampled changes across all signals.
          </li>
          <li>
            <strong>Caps.</strong> Graphs stop at 5000 nodes and 20000 edges and say so
            (<code>truncated</code>, <code>total</code>, <code>edgesOmitted</code>);
            <code>get_capture_info</code> reports what was dropped and why.
          </li>
          <li>
            <strong>One page load.</strong> Component ids are valid within one epoch.
            Answers may come from a cache for up to 1 s; <code>computedAt</code> and
            <code>window.until</code> say when they were computed.
          </li>
        </ul>
        <p>
          Performance with very large apps has not been measured; no size is promised.
        </p>
      </section>

      <section id="panel" class="step">
        <header class="step-head">
          <span class="step-num mono">08</span>
          <h2>The same data in the panel</h2>
        </header>
        <p>
          The Reactivity panel shows the answers above to people. Screenshots of the real
          runtime on the example app, taken in CI.
        </p>
        <div class="shots">
          {#each shots as s (s.src)}
            <figure>
              <img src="{base}/images/{s.src}" alt={s.alt} width="1440" height="900" loading="lazy" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          {/each}
        </div>
        <p class="provenance">
          Captured by <code>scripts/screenshots/reactivity.mjs</code> in CI run 37193781813
          (Linux, headless Chromium, 1440×900) on the PR merge commit 623e27a, whose client
          sources are those of a42a9e4, on <code>examples/sample-app</code> (a synthetic demo
          app) with the real runtime.
        </p>
      </section>

      <section id="troubleshooting" class="step">
        <header class="step-head">
          <span class="step-num mono">09</span>
          <h2>Troubleshooting</h2>
        </header>
        <dl class="faq">
          <div>
            <dt><code>403 Forbidden</code></dt>
            <dd>
              The token is missing or from an earlier start. Register again with the line
              the dev server printed last.
            </dd>
          </div>
          <div>
            <dt>Empty answers with <code>staleReason: "no-runtime"</code></dt>
            <dd>No app page is connected. Open the app in a browser and call again.</dd>
          </div>
          <div>
            <dt><code>staleReason: "timeout"</code></dt>
            <dd>
              The app page did not answer within 1 s. The answer is the previous one (with
              its own <code>computedAt</code>) or empty; call again.
            </dd>
          </div>
          <div>
            <dt><code>staleReason: "epoch-changed"</code></dt>
            <dd>
              The page reloaded. Call <code>get_live_components</code> with
              <code>includeMeta: true</code> for new ids and their epoch.
            </dd>
          </div>
          <div>
            <dt><code>componentId requires epoch</code></dt>
            <dd>Pass the epoch from the same <code>get_live_components</code> answer.</dd>
          </div>
          <div>
            <dt>No components or reactive nodes</dt>
            <dd>
              Check that <code>componentTracking</code> is not set to <code>false</code> and
              that the plugin comes before <code>sveltekit()</code> in
              <code>vite.config.ts</code>.
            </dd>
          </div>
          <div>
            <dt>Several app tabs</dt>
            <dd>The answers follow the page that reported most recently; close the others.</dd>
          </div>
        </dl>
      </section>

      <section id="security" class="step">
        <header class="step-head">
          <span class="step-num mono">10</span>
          <h2>Security</h2>
        </header>
        <ul class="limits">
          <li>The endpoint exists only in the dev server. Production builds don't contain it.</li>
          <li>
            Every request needs the token. It is random per start and printed only in your
            terminal. Treat it like a password and don't commit it.
          </li>
          <li>
            The token is separate from the browser sign-in of the panels (the one-time
            code). MCP clients are local processes, so the browser origin is not checked;
            the token is the gate.
          </li>
          <li>
            <code>get_state_timeline</code> returns real state values of your running app,
            so the agent sees them. Keep secrets out of dev state, or don't use that tool.
          </li>
          <li>
            When the dev server listens on the network (<code>--host</code>), so does the
            endpoint. Prefer localhost.
          </li>
          <li>
            Sessions are written to disk only with <code>persist</code> or
            <code>keep: "disk"</code>, under <code>node_modules/</code> of the project.
          </li>
        </ul>
      </section>

      <section id="versions" class="step">
        <header class="step-head">
          <span class="step-num mono">11</span>
          <h2>Versions</h2>
        </header>
        <dl class="faq">
          <div>
            <dt>vite-devtools-svelte</dt>
            <dd>≥ 0.4.0 (not yet published) for this guide and the four reactivity tools</dd>
          </div>
          <div>
            <dt>Vite</dt>
            <dd>≥ 8.3.2</dd>
          </div>
          <div>
            <dt>Svelte</dt>
            <dd>5 (runes mode); plain Svelte, SvelteKit 2 and Kit 3 are tested in CI</dd>
          </div>
          <div>
            <dt>MCP</dt>
            <dd>
              Streamable HTTP, stateless, JSON responses. CI calls the endpoint with plain
              HTTP (<code>initialize</code>, <code>tools/list</code>,
              <code>tools/call</code>).
            </dd>
          </div>
        </dl>
      </section>

      <section class="next">
        <h2 class="content-h2">Next steps</h2>
        <ul>
          <li><a href="{base}/getting-started">Set up the plugin</a></li>
          <li><a href="{base}/panels/reactive">The Reactivity panel</a></li>
        </ul>
      </section>
    </article>
  </div>
</section>

<style>
  .hero {
    padding-bottom: 3.5rem;
  }

  .head-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    color: var(--text-3);
  }

  .head-meta::after {
    content: '';
    flex: 1 1 4rem;
    height: 1px;
    background: var(--line);
  }

  h1 {
    margin: 0 0 1rem;
  }

  .lead {
    font-size: 1.15rem;
    color: var(--text-2);
    margin: 0 0 1.5rem;
    max-width: 620px;
    line-height: 1.6;
  }

  .release-note {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--text-2);
    font-size: 0.92rem;
  }

  .doc {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 3rem;
    align-items: start;
  }

  @media (max-width: 820px) {
    .doc {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }
  }

  .toc {
    position: sticky;
    top: 88px;
  }

  @media (max-width: 820px) {
    .toc {
      position: static;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 1rem;
      background: var(--paper);
    }
  }

  .toc-label {
    display: block;
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 0.8rem;
  }

  .toc ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .toc li {
    margin-bottom: 0.45rem;
  }

  .toc a {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    color: var(--text-2);
    font-size: 0.88rem;
    padding: 0.3rem 0;
    border-left: 2px solid transparent;
    padding-left: 0.6rem;
    margin-left: -0.6rem;
    transition: border-color 150ms var(--ease), color 150ms var(--ease);
  }

  .toc a:hover {
    color: var(--text);
    border-left-color: var(--brand);
    text-decoration: none;
  }

  .toc-num {
    color: var(--text-3);
    font-size: 0.72rem;
  }

  .content {
    min-width: 0;
  }

  .step {
    margin-bottom: 3rem;
    scroll-margin-top: 88px;
  }

  .step-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.25rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--line);
  }

  .step-head h2 {
    margin: 0;
    font-size: clamp(1.6rem, 2.6vw, 2.1rem);
  }

  .step-num {
    color: var(--brand);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
  }

  /* --brand is 3.18:1 on the light background; --link is the accent's text tone (4.89:1). */
  :global(html[data-theme='light']) .step-num {
    color: var(--link);
  }

  .content-h2 {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 500;
    margin: 2rem 0 0.85rem;
    color: var(--text-3);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .group-title {
    margin: 2.25rem 0 0.35rem;
    font-size: 1.15rem;
    scroll-margin-top: 88px;
  }

  .group-intro {
    margin: 0 0 1rem;
    color: var(--text-2);
  }

  .tools {
    margin: 0;
    border-top: 1px solid var(--line);
  }

  .tool {
    display: grid;
    grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
    gap: 0.5rem 1.5rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--line);
  }

  @media (max-width: 700px) {
    .tool {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .tool dt {
    overflow-wrap: anywhere;
  }

  .tool dd {
    margin: 0;
  }

  .tool dd p {
    margin: 0 0 0.35rem;
  }

  .tool-input {
    font-size: 0.8rem;
    color: var(--text-3);
    overflow-wrap: anywhere;
  }

  .tool-note {
    font-size: 0.9rem;
    color: var(--text-2);
  }

  .flow {
    padding-left: 1.25rem;
    margin: 1.5rem 0;
  }

  .flow li {
    margin-bottom: 2rem;
  }

  .flow h3 {
    font-size: 1.05rem;
    margin: 0 0 0.35rem;
  }

  .provenance {
    font-size: 0.85rem;
    color: var(--text-3);
  }

  .limits {
    padding-left: 1.25rem;
  }

  .limits li {
    margin-bottom: 0.6rem;
  }

  .shots {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.25rem;
    margin: 1.25rem 0;
  }

  @media (max-width: 700px) {
    .shots {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  figure {
    margin: 0;
  }

  figure img {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  figcaption {
    margin-top: 0.45rem;
    font-size: 0.85rem;
    color: var(--text-2);
  }

  .faq {
    margin: 0;
    border-top: 1px solid var(--line);
  }

  .faq > div {
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--line);
  }

  .faq dt {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .faq dd {
    margin: 0;
    color: var(--text-2);
  }

  .next {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--line);
  }

  .next ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .next li {
    border-bottom: 1px solid var(--line);
  }

  .next a {
    display: block;
    padding: 0.85rem 0;
    color: var(--text);
  }

  .next a::after {
    content: ' →';
    color: var(--text-3);
  }

  .next a:hover {
    text-decoration: none;
    color: var(--brand);
  }
</style>
