<script lang="ts">
  // Japanese quickstart for the MCP guide. The English page (/mcp) is the
  // source of truth: keep facts, limits and versions in step with it.
  import { resolve } from '$app/paths';

  import CodeBlock from '#lib/CodeBlock.svelte';
  import { MCP_STDIO_TOOL_JA, mcpToolsJa } from '#lib/mcp-tools.ja.ts';
  import { MCP_SERVER_INPUT, MCP_TOOL_COUNT } from '#lib/mcp-tools.ts';

  const groups = mcpToolsJa();

  const addCode = `claude mcp add svelte-devtools -- npx @sveltejs/vite-devtools-svelte mcp`;

  const svelteMcpCode = `claude mcp add svelte -- npx -y @sveltejs/mcp`;

  const mcpJsonCode = `{
  "mcpServers": {
    "svelte-devtools": {
      "command": "npx",
      "args": ["@sveltejs/vite-devtools-svelte", "mcp"]
    }
  }
}`;

  const remoteCode = `claude mcp add svelte-devtools \\
  -e VITE_DEVTOOLS_SVELTE_URL=http://localhost:5173 \\
  -e VITE_DEVTOOLS_SVELTE_TOKEN=<token> \\
  -- npx @sveltejs/vite-devtools-svelte mcp`;

  const middlewareCode = `const vite = await createServer({ server: { middlewareMode: true } });
const devtools = vite.config.plugins.find(p => p.name === 'vite-devtools-svelte');
const token = devtools?.api?.getDevtoolsToken?.();`;

  const curlCode = `curl -s http://localhost:5173/__svelte-devtools/mcp \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'x-svelte-devtools-token: <token>' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

  const promptCode = `/cart で税率を変えるとカートの合計がおかしい。
svelte-devtools MCP サーバーを使って、活発なコンポーネントを探し、
ReactivePriceChart のインスタンスを見て、grandTotal に影響しうる state と、
税率を編集したときに何が変わったかを教えて。`;

  const sections = [
    { num: '01', title: 'これは何か', anchor: 'what' },
    { num: '02', title: 'Claude Code に接続する', anchor: 'connect' },
    { num: '03', title: '基本の流れ', anchor: 'flow' },
    { num: '04', title: `${MCP_TOOL_COUNT} のツール`, anchor: 'tools' },
    { num: '05', title: '変更を計測する', anchor: 'sessions' },
    { num: '06', title: '回答がカバーする範囲', anchor: 'limits' },
    { num: '07', title: 'トラブルシューティング', anchor: 'troubleshooting' },
    { num: '08', title: 'セキュリティ', anchor: 'security' },
    { num: '09', title: 'バージョンと資料', anchor: 'versions' },
  ];

  const flow = [
    {
      tool: 'get_reactive_summary',
      text: 'まず全体の活発さを見ます。グラフは取得しないので、大きなアプリでも回答は小さく収まります。回数は各インスタンスがマウントされてからの累計で、lastActiveAt が最後に動いた時刻を示します。',
    },
    {
      tool: 'get_live_components',
      text: 'includeMeta: true で、インスタンスの id とその epoch（ページ読み込み）を一緒に取得します。id はページを読み込むたびに振り直されます。',
    },
    {
      tool: 'get_reactive_scope',
      text: 'componentId と epoch を渡して、1 つのインスタンスのノードと直接の隣接ノードを見ます。エッジは「影響しうる」（現在の依存関係）という意味で、変化の原因ではありません。',
    },
    {
      tool: 'get_state_timeline',
      text: '最初はカーソルなしで呼び（reset: true）、返された cursor を保存します。アプリで値を変えたあと、cursor を since に渡すと新しい変化だけが返ります。',
    },
    {
      tool: 'get_capture_info',
      text: '上限で切られたデータから結論を出す前に、DevTools が保持している量とアプリが報告した量を確認します。total が null の場合は不明という意味です。',
    },
  ];
</script>

<svelte:head>
  <title>MCP クイックスタート（日本語） — vite-devtools-svelte</title>
  <meta
    name="description"
    content="Claude Code などの MCP クライアントを Svelte の開発サーバーに接続する日本語クイックスタート: 接続と認証、基本の流れ、{MCP_TOOL_COUNT} のツール、制約、トラブルシューティング。"
  />
  <link rel="alternate" hreflang="en" href={resolve('/mcp')} />
</svelte:head>

<div lang="ja">
  <section class="band no-border hero">
    <div class="container">
      <div class="head-meta">
        <span class="eyebrow"><span class="eyebrow-num">§ mcp</span> · 日本語クイックスタート</span>
        <span class="mono dim">{MCP_TOOL_COUNT} tools</span>
      </div>
      <h1>MCP クイックスタート</h1>
      <p class="lead">
        開発サーバーは Model Context Protocol にも対応しています。Claude Code
        などのコーディングエージェントが、パネルと同じレンダー・リアクティビティ・load・フレームレートのデータを読めます。どの回答も、自分が何をカバーしているかを明示します。
      </p>
      <p class="release-note">
        このページは <strong>vite-devtools-svelte ≥ 0.10.0</strong> を対象にした、<a
          href={resolve('/mcp')}
          lang="en">英語の MCP ガイド</a
        >の要約です。内容が食い違う場合は英語版が正です。実際の回答例（JSON）とスクリーンショットは英語版にあります。先に
        <a href={resolve('/getting-started')}>Getting Started</a> でプラグインを設定してください。
      </p>
    </div>
  </section>

  <section class="band">
    <div class="container doc">
      <nav class="toc" aria-label="目次">
        <span class="toc-label mono">目次</span>
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
            <h2>これは何か</h2>
          </header>
          <p>
            <code>vite dev</code> の実行中、プラグインは
            <code>/__svelte-devtools/mcp</code> に MCP エンドポイント（Streamable
            HTTP）を提供します。エージェントは通常、各呼び出しを中継する小さな stdio サーバー
            <code>vite-devtools-svelte mcp</code> を通してツールを呼び、パネルに表示される内容を読みます:
            活発なコンポーネント、1 つのインスタンスのリアクティブグラフ、サンプリングされた state の変化、レンダープロファイル、load
            関数、フレームレート。変更の前後を比べる計測セッションも実行できます。
          </p>
          <p>
            アプリのコードや state を変更するツールはありません。起きることは 2 つです:
            呼び出しのたびにページ内のランタイムが約 1
            分間サンプリングを続けること、そしてセッション系のツールが計測セッションを保持すること（メモリ内。ディスクには指定したときだけ書き込み、<code
              >delete_session</code
            > で削除できます）。実行時のデータはブラウザで開いているアプリのページから来るので、エージェントの作業中はアプリを開いたままにしてください。
          </p>
        </section>

        <section id="connect" class="step">
          <header class="step-head">
            <span class="step-num mono">02</span>
            <h2>Claude Code に接続する</h2>
          </header>
          <p>
            プロジェクトごとに 1 回、MCP
            サーバーを登録します。開発サーバーも起動時にこのコマンドを表示します:
          </p>
          <CodeBlock code={addCode} lang="bash" />
          <p>
            <code>vite-devtools-svelte mcp</code> は stdio で動き、カレントディレクトリのプロジェクトで動いている開発サーバーに各呼び出しを中継します。開発サーバーとそのポート、トークンは自分で見つけるので、再起動やポートの変更があっても登録し直す必要はありません。開発サーバーが動いていないときは、ツールが起動のしかたを返します。
          </p>
          <p>
            動いている開発サーバーは <code>~/.cache/vite-devtools-svelte/servers/</code>
            に 1 つずつファイルを書いて自分の存在を知らせます（<code>$XDG_CACHE_HOME</code>
            があればその下、Windows では <code>%LOCALAPPDATA%</code> の下）。使われるのは同じマシンの開発サーバーだけです。
          </p>

          <h3 class="content-h2">Svelte のドキュメントとコードチェック</h3>
          <p>
            ドキュメントと <code>svelte-autofixer</code> は公式の
            <a href="https://svelte.dev/docs/mcp">Svelte MCP サーバー</a
            >が提供します。このサーバーは、公式サーバーが設定されていればそちらを使うよう AI
            に指示するので、あわせて追加してください:
          </p>
          <CodeBlock code={svelteMcpCode} lang="bash" />

          <h3 class="content-h2">コマンドの代わりにプロジェクトのファイルを使う</h3>
          <p>
            <code>claude mcp add</code> は自分だけにサーバーを登録します（local
            スコープ）。プロジェクトの <code>.mcp.json</code> はプロジェクトを開く全員と共有されます（project
            スコープ）。トークンを含まないので、コミットしてかまいません:
          </p>
          <CodeBlock code={mcpJsonCode} lang="json" filename=".mcp.json" />

          <h3 class="content-h2">開発サーバーが複数あるとき</h3>
          <p>
            stdio
            のサーバーは、カレントディレクトリを含むルートの開発サーバー（いちばん内側のもの）を使い、なければカレントディレクトリの中にある唯一の開発サーバーを使います。モノレポのルートから使う場合や、同じアプリを
            2 つ起動している場合は、複数が該当します。そのとき AI は <code>list_dev_servers</code>
            を呼び、使うサーバーを <code>server</code> で指定します（id、ルート、パッケージ名のどれか）。
          </p>

          <h3 class="content-h2">他の MCP クライアント</h3>
          <p>
            stdio のサーバーを起動できるクライアントでは、同じコマンド（<code
              >npx @sveltejs/vite-devtools-svelte mcp</code
            >）を使います。カスタムヘッダー付きの Streamable HTTP
            にしか対応していないクライアントは、開発サーバーに直接接続します。必要なのは URL（<code
              >http://localhost:&lt;port&gt;/__svelte-devtools/mcp</code
            >）とヘッダー（<code>x-svelte-devtools-token: &lt;token&gt;</code>）の 2
            つです。トークンは開発サーバーを起動するたびに変わります（<a href="#token"
              >トークンの取得方法</a
            >）。HTTP のエンドポイントはステートレスで JSON で応答します。手動で確認するには:
          </p>
          <CodeBlock code={curlCode} lang="bash" />

          <h3 class="content-h2" id="remote">コンテナ、別のマシン、ミドルウェアモード</h3>
          <p>
            stdio
            のサーバーが見つけられるのは、同じマシンで自分の存在を知らせた開発サーバーだけです。コンテナや別のマシンで動いている開発サーバーは見つからず、Vite
            のミドルウェアモードでは、プラグインが存在を知らせるのに使う自前のサーバーがありません。その場合は接続先を自分で
            stdio のサーバーに渡します:
          </p>
          <ul>
            <li>
              <code>VITE_DEVTOOLS_SVELTE_URL</code>: MCP クライアントから届く開発サーバーの URL（例:
              <code>http://localhost:5173</code>）。パスがなければ
              <code>/__svelte-devtools/mcp</code> を補います。
            </li>
            <li>
              <code>VITE_DEVTOOLS_SVELTE_TOKEN</code>: その開発サーバーのトークン。URL
              を設定したら必須です。
            </li>
          </ul>
          <p>
            これらを設定すると、すべての呼び出しがその接続先に送られ、<code>server</code>
            は無視されます。Claude Code の場合:
          </p>
          <CodeBlock code={remoteCode} lang="bash" />
          <p>
            トークンは起動のたびに変わるので、開発サーバーを再起動したら登録を更新してください。
          </p>

          <h3 class="content-h2" id="token">トークンの取得方法</h3>
          <ul>
            <li>
              開発サーバーが動いているマシン（またはコンテナ）の
              <code>~/.cache/vite-devtools-svelte/servers/</code>
              にあるファイルから読みます。ファイル名は
              <code>&lt;pid&gt;-&lt;port&gt;.json</code> で、<code>token</code> と
              <code>url</code> が入っています。
            </li>
            <li>
              ミドルウェアモードではファイルは書かれません。<code>vite-devtools-svelte</code>
              という名前のプラグインの API から読みます（リポジトリの
              <code>examples/svelte-middleware/server.js</code> と同じ方法）:
            </li>
          </ul>
          <CodeBlock code={middlewareCode} lang="js" filename="server.js" />

          <h3 class="content-h2">聞いてみる</h3>
          <p>たとえばアプリのカートページを開いた状態で:</p>
          <CodeBlock code={promptCode} lang="text" filename="prompt" />
          <p>
            エージェントは通常 <code>get_reactive_summary</code> か
            <code>list_performance_issues</code> から始め、回答に含まれるヒントをたどります。
          </p>
        </section>

        <section id="flow" class="step">
          <header class="step-head">
            <span class="step-num mono">03</span>
            <h2>基本の流れ</h2>
          </header>
          <p>
            大きなアプリでも回答を小さく保つ順序です。各ステップの実際の回答は<a
              href={resolve('/mcp#walkthrough')}
              lang="en">英語版の Walkthrough</a
            >にあります（合成データのサンプルアプリ <code>examples/sample-app</code> で CI が記録したもの）。
          </p>
          <ol class="limits">
            {#each flow as step (step.tool)}
              <li><code>{step.tool}</code> — {step.text}</li>
            {/each}
          </ol>
          <p>
            ページをリロードすると、古い epoch のままの componentId
            は別のインスタンスとして推測されず、<code>staleReason: "epoch-changed"</code>
            の空の回答になります。<code>get_live_components</code> で新しい id を取得し直してください。
          </p>
        </section>

        <section id="tools" class="step">
          <header class="step-head">
            <span class="step-num mono">04</span>
            <h2>{MCP_TOOL_COUNT} のツール</h2>
          </header>
          <p>入力は <code>?</code> が付いていないもの以外すべて省略できます。</p>
          <p>
            開発サーバーのエンドポイントにあるのは以下の {MCP_TOOL_COUNT} のツールです。<code
              >vite-devtools-svelte mcp</code
            >
            は <code>list_dev_servers</code> を追加し、各ツールに <code>server?</code>
            の入力を加えます（<a href="#tools-stdio">最後のグループ</a>を参照）。
          </p>
          {#each groups as group (group.id)}
            <h3 class="group-title" id="tools-{group.id}">{group.title}</h3>
            <p class="group-intro">{group.intro}</p>
            <dl class="tools">
              {#each group.tools as tool (tool.name)}
                <div class="tool">
                  <dt><code>{tool.name}</code></dt>
                  <dd>
                    <p class="tool-input mono" lang="en">{tool.input}</p>
                    <p>{tool.summary}</p>
                    {#if tool.note}<p class="tool-note">{tool.note}</p>{/if}
                  </dd>
                </div>
              {/each}
            </dl>
          {/each}
          <h3 class="group-title" id="tools-stdio">開発サーバー（stdio のみ）</h3>
          <p class="group-intro">
            <code>vite-devtools-svelte mcp</code> が追加します。上のすべてのツールが
            <code class="mono" lang="en">{MCP_SERVER_INPUT}</code>
            も受け取ります。必要なのは複数の開発サーバーが該当するときだけです。
          </p>
          <dl class="tools">
            <div class="tool">
              <dt><code>{MCP_STDIO_TOOL_JA.name}</code></dt>
              <dd>
                <p class="tool-input mono" lang="en">{MCP_STDIO_TOOL_JA.input}</p>
                <p>{MCP_STDIO_TOOL_JA.summary}</p>
                {#if MCP_STDIO_TOOL_JA.note}<p class="tool-note">{MCP_STDIO_TOOL_JA.note}</p>{/if}
              </dd>
            </div>
          </dl>
        </section>

        <section id="sessions" class="step">
          <header class="step-head">
            <span class="step-num mono">05</span>
            <h2>変更を計測する</h2>
          </header>
          <p>
            <code>start_session</code> でセッションを始めてアプリを操作し、<code>end_session</code>
            で終了します。変更後にも同じことをして、<code>compare_sessions</code>
            で比較します。比較の各項目には判定（improved / regressed / unchanged）が付きます。
          </p>
          <p>
            セッションは開発サーバーが動いている間メモリに保持されます。<code>end_session</code> に
            <code>keep: "disk"</code> を指定すると、プロジェクトの
            <code>node_modules/.vite-devtools-svelte/sessions/</code> に書き込まれます。
          </p>
        </section>

        <section id="limits" class="step">
          <header class="step-head">
            <span class="step-num mono">06</span>
            <h2>回答がカバーする範囲</h2>
          </header>
          <ul class="limits">
            <li>
              <strong>サンプリング。</strong> state は 200 ms ごとに確認され、1 回のサンプル内の複数回の書き込みは
              1 回と数えます。回数は総数や発生率ではありません。
            </li>
            <li>
              <strong>コンポーネントとモジュールの state。</strong>
              コンポーネントの初期化中に作られた state と、<code>.svelte.js</code> /
              <code>.svelte.ts</code>
              モジュールの共有 state を追跡します。それ以外の場所（イベントハンドラーの中など）で作られた
              state は対象外です。
            </li>
            <li>
              <strong>「影響しうる」であって「原因」ではない。</strong> エッジは現在の依存関係です。どの書き込みが値を変えたかは記録しません。
            </li>
            <li>
              <strong>表示されない依存関係があります。</strong> DevTools が追跡していない
              state（SvelteKit のページの state など、<code>node_modules</code>
              で作られたもの）の読み取りにはエッジがなく、そのノードの <code>untrackedDeps</code>
              に数えられます。
            </li>
            <li>
              <strong>グラフ内の値は要約。</strong> オブジェクトや配列は
              <code>(object)</code>、<code>[n]</code>、<code>{'{n}'}</code>
              と表示されます。タイムラインには
              <code>maxValueChars</code> までの値が含まれます。
            </li>
            <li>
              <strong>signal ごとの履歴はありません。</strong> タイムラインはすべての signal をまとめて、サンプリングされた最新
              500 件の変化を保持します。
            </li>
            <li>
              <strong>上限。</strong> グラフは 5000 ノード・20000
              エッジで打ち切られ、そのことを明示します（<code>truncated</code>、<code>total</code
              >、<code>edgesOmitted</code>）。<code>get_capture_info</code>
              が何をなぜ落としたかを報告します。
            </li>
            <li>
              <strong>1 回のページ読み込み。</strong> コンポーネント id は 1 つの epoch
              の中でだけ有効です。回答は最大 1 秒間キャッシュから返ることがあり、<code
                >computedAt</code
              >
              が計算時刻を示します。
            </li>
          </ul>
          <p>非常に大きなアプリでの性能は計測していません。対応できる規模は約束していません。</p>
        </section>

        <section id="troubleshooting" class="step">
          <header class="step-head">
            <span class="step-num mono">07</span>
            <h2>トラブルシューティング</h2>
          </header>
          <dl class="faq">
            <div>
              <dt><code>403 Forbidden</code></dt>
              <dd>
                HTTP で接続している場合: トークンがないか、以前の起動のものです。<code
                  >~/.cache/vite-devtools-svelte/servers/</code
                > にある開発サーバーのファイルから読み直してください。
              </dd>
            </div>
            <div>
              <dt><code>No running dev server for …</code></dt>
              <dd>
                Claude Code
                を動かしているプロジェクトの開発サーバーを起動するか、回答に並んだ開発サーバーのどれかを
                <code>server</code>
                で指定してください。回答に、インストールされているバージョンは開発サーバーの存在を知らせないとあれば、0.10.0
                以降に上げてください。コンテナ、別のマシン、ミドルウェアモードでは<a href="#remote"
                  >環境変数</a
                >を設定してください。
              </dd>
            </div>
            <div>
              <dt><code>The dev server at … did not answer</code></dt>
              <dd>
                開発サーバーが止まっているか、<code>VITE_DEVTOOLS_SVELTE_URL</code>
                を使っている場合は URL かトークンが間違っています。トークンは起動のたびに変わります。
              </dd>
            </div>
            <div>
              <dt>
                <code>VITE_DEVTOOLS_SVELTE_URL is set without VITE_DEVTOOLS_SVELTE_TOKEN</code>
              </dt>
              <dd>両方を設定するか、どちらも設定しないでください。</dd>
            </div>
            <div>
              <dt><code>staleReason: "no-runtime"</code> の空の回答</dt>
              <dd>
                アプリのページが接続されていません。ブラウザでアプリを開いてから呼び直してください。
              </dd>
            </div>
            <div>
              <dt><code>staleReason: "timeout"</code></dt>
              <dd>
                アプリのページが 1 秒以内に応答しませんでした。回答は前回のもの（その
                <code>computedAt</code> つき）か空です。呼び直してください。
              </dd>
            </div>
            <div>
              <dt><code>staleReason: "epoch-changed"</code></dt>
              <dd>
                ページがリロードされました。<code>includeMeta: true</code> で
                <code>get_live_components</code> を呼び、新しい id と epoch を取得してください。
              </dd>
            </div>
            <div>
              <dt><code>componentId requires epoch</code></dt>
              <dd>
                同じ <code>get_live_components</code> の回答に含まれる epoch を渡してください。
              </dd>
            </div>
            <div>
              <dt>コンポーネントやリアクティブノードが出てこない</dt>
              <dd>
                <code>componentTracking</code> が <code>false</code> になっていないこと、
                <code>vite.config.ts</code> でプラグインが <code>sveltekit()</code>
                より前にあることを確認してください。
              </dd>
            </div>
            <div>
              <dt>アプリのタブが複数ある</dt>
              <dd>回答は最後に報告したページに従います。他のタブは閉じてください。</dd>
            </div>
          </dl>
        </section>

        <section id="security" class="step">
          <header class="step-head">
            <span class="step-num mono">08</span>
            <h2>セキュリティ</h2>
          </header>
          <ul class="limits">
            <li>エンドポイントは開発サーバーにだけ存在します。本番ビルドには含まれません。</li>
            <li>
              すべてのリクエストにトークンが必要です。トークンは起動ごとにランダムで、自分のユーザーだけが読めるファイル（<code
                >~/.cache/vite-devtools-svelte/servers/</code
              >）に置かれます。パスワードと同じように扱い、コミットしないでください。
            </li>
            <li>
              トークンはパネルのブラウザでのサインイン（ワンタイムコード）とは別物です。MCP
              クライアントはローカルのプロセスなのでブラウザの origin
              は確認されず、トークンだけが関門です。
            </li>
            <li>
              <code>get_state_timeline</code> は実行中のアプリの実際の state の値を返すので、エージェントにも見えます。開発中の
              state に秘密情報を入れないか、このツールを使わないでください。
            </li>
            <li>
              開発サーバーがネットワークで待ち受けている場合（<code>--host</code
              >）、エンドポイントも同様です。localhost を推奨します。
            </li>
            <li>
              セッションがディスクに書かれるのは <code>persist</code> か
              <code>keep: "disk"</code> を指定したときだけで、プロジェクトの
              <code>node_modules/</code> 以下です。
            </li>
          </ul>
        </section>

        <section id="versions" class="step">
          <header class="step-head">
            <span class="step-num mono">09</span>
            <h2>バージョンと資料</h2>
          </header>
          <dl class="faq">
            <div>
              <dt>vite-devtools-svelte</dt>
              <dd>
                <code>vite-devtools-svelte mcp</code> とこのガイドは ≥ 0.10.0。4 つのリアクティビティツールは
                0.4.0 で追加されました
              </dd>
            </div>
            <div>
              <dt>Vite</dt>
              <dd>≥ 8.3.5</dd>
            </div>
            <div>
              <dt>Svelte</dt>
              <dd>
                ≥ 5.46.4（runes モード）。plain Svelte と SvelteKit 3 を CI でテストしています
              </dd>
            </div>
            <div>
              <dt>MCP</dt>
              <dd>
                Streamable HTTP、ステートレス、JSON 応答。CI はプレーンな HTTP（<code
                  >initialize</code
                >、<code>tools/list</code>、<code>tools/call</code
                >）でエンドポイントを呼んでいます。
              </dd>
            </div>
            <div>
              <dt>資料</dt>
              <dd>
                動画による解説はまだありません。実際の回答例とスクリーンショット（CI で記録）は<a
                  href={resolve('/mcp')}
                  lang="en">英語の MCP ガイド</a
                >にあります。
              </dd>
            </div>
          </dl>
        </section>

        <section class="next">
          <h2 class="content-h2">次に読む</h2>
          <ul>
            <li><a href={resolve('/getting-started')}>プラグインを設定する（英語）</a></li>
            <li><a href={resolve('/mcp#walkthrough')}>実際の回答例（英語）</a></li>
            <li>
              <a href={resolve('/panels/[slug]', { slug: 'reactive' })}>Reactivity パネル（英語）</a
              >
            </li>
          </ul>
        </section>
      </article>
    </div>
  </section>
</div>

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
    transition:
      border-color 150ms var(--ease),
      color 150ms var(--ease);
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
    scroll-margin-top: 88px;
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

  .limits {
    padding-left: 1.25rem;
  }

  .limits li {
    margin-bottom: 0.6rem;
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
