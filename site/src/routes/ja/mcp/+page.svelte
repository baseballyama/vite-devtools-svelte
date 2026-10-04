<script lang="ts">
  // Japanese quickstart for the MCP guide. The English page (/mcp) is the
  // source of truth: keep facts, limits and versions in step with it.
  import { base } from '$app/paths'
  import CodeBlock from '$lib/CodeBlock.svelte'
  import { MCP_TOOL_COUNT } from '$lib/mcp-tools'
  import { mcpToolsJa } from '$lib/mcp-tools.ja'

  const groups = mcpToolsJa()

  const printedCode = `  svelte-devtools MCP ready — register with Claude Code:
    claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:<token>`

  const reRegisterCode = `claude mcp remove svelte
claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:<新しいトークン>`

  const mcpJsonCode = `{
  "mcpServers": {
    "svelte": {
      "type": "http",
      "url": "http://localhost:5173/__svelte-devtools/mcp",
      "headers": { "x-svelte-devtools-token": "\${SVELTE_DEVTOOLS_TOKEN}" }
    }
  }
}`

  const envCode = `export SVELTE_DEVTOOLS_TOKEN=<表示された行のトークン>
claude`

  const curlCode = `curl -s http://localhost:5173/__svelte-devtools/mcp \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'x-svelte-devtools-token: <token>' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`

  const promptCode = `/cart で税率を変えるとカートの合計がおかしい。
svelte MCP サーバーを使って、活発なコンポーネントを探し、
ReactivePriceChart のインスタンスを見て、grandTotal に影響しうる state と、
税率を編集したときに何が変わったかを教えて。`

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
  ]

  const flow = [
    {
      tool: 'get_reactive_summary',
      text: 'まず全体の活発さを見ます。グラフは取得しないので、大きなアプリでも回答は小さく収まります。回答には対象期間とサンプリングされた時間（sampledActiveMs）が含まれます。',
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
  ]
</script>

<svelte:head>
  <title>MCP クイックスタート（日本語） — vite-devtools-svelte</title>
  <meta
    name="description"
    content="Claude Code などの MCP クライアントを Svelte の開発サーバーに接続する日本語クイックスタート: 接続と認証、基本の流れ、20 のツール、制約、トラブルシューティング。"
  />
  <link rel="alternate" hreflang="en" href="{base}/mcp" />
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
        このページは <strong>vite-devtools-svelte ≥ 0.4.0</strong> を対象にした、<a
          href="{base}/mcp"
          lang="en">英語の MCP ガイド</a
        >の要約です。内容が食い違う場合は英語版が正です。実際の回答例（JSON）とスクリーンショットは英語版にあります。先に
        <a href="{base}/getting-started">Getting Started</a> でプラグインを設定してください。
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
            HTTP）を提供します。エージェントはそこでツールを呼び、パネルに表示される内容を読みます:
            活発なコンポーネント、1 つのインスタンスのリアクティブグラフ、サンプリングされた state
            の変化、レンダープロファイル、load 関数、フレームレート。変更の前後を比べる計測セッションも実行できます。
          </p>
          <p>
            アプリのコードや state を変更するツールはありません。起きることは 2 つです:
            呼び出しのたびにページ内のランタイムが約 1 分間サンプリングを続けること、そしてセッション系のツールが計測セッションを保持すること（メモリ内。ディスクには指定したときだけ書き込み、<code
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
            開発サーバーを起動すると、待ち受けを始めた時点で、Claude Code
            にサーバーを登録するコマンドがポートとトークンつきで表示されます:
          </p>
          <CodeBlock code={printedCode} lang="text" filename="terminal (npm run dev)" />
          <p>
            表示された行をそのまま実行します。すべてのリクエストは
            <code>x-svelte-devtools-token</code> ヘッダーにトークンが必要で、ない場合は
            <code>403</code> が返ります。
          </p>

          <h3 class="content-h2">トークンは起動のたびに変わる</h3>
          <p>
            トークンは開発サーバーの起動ごとにランダムに生成されます（設定変更で Vite
            が再起動した場合も同じです）。再起動したら、新しく表示された行で登録し直します:
          </p>
          <CodeBlock code={reRegisterCode} lang="bash" />

          <h3 class="content-h2">コマンドの代わりにプロジェクトのファイルを使う</h3>
          <p>
            <code>claude mcp add</code> は自分だけにサーバーを登録します（local スコープ）。プロジェクトの
            <code>.mcp.json</code> はプロジェクトを開く全員と共有されるので（project
            スコープ）、トークンを書き込まないでください。Claude Code
            はこのファイル内の環境変数を展開するので、トークンは環境変数から読み込みます:
          </p>
          <CodeBlock code={mcpJsonCode} lang="json" filename=".mcp.json" />
          <p>開発サーバーが表示した行からトークンを設定し、Claude Code を起動します:</p>
          <CodeBlock code={envCode} lang="bash" />
          <p>URL のポートは開発サーバーのポートと一致させてください。</p>

          <h3 class="content-h2">他の MCP クライアント</h3>
          <p>
            カスタムヘッダー付きの Streamable HTTP に対応したクライアントなら接続できます。必要なのは
            URL（<code>http://localhost:&lt;port&gt;/__svelte-devtools/mcp</code>）とヘッダー（<code
              >x-svelte-devtools-token: &lt;token&gt;</code
            >）の 2 つです。開発サーバーが表示するのは Claude Code
            のコマンドだけなので、他のクライアントではそれぞれの設定形式でこの 2
            つを指定します。サーバーはステートレスで JSON で応答します。手動で確認するには:
          </p>
          <CodeBlock code={curlCode} lang="bash" />

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
          <p>大きなアプリでも回答を小さく保つ順序です。各ステップの実際の回答は<a
              href="{base}/mcp#walkthrough"
              lang="en">英語版の Walkthrough</a
            >にあります（合成データのサンプルアプリ <code>examples/sample-app</code> で CI
            が記録したもの）。</p>
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
              <strong>サンプリング。</strong> state は 200 ms ごとに確認され、1
              回のサンプル内の複数回の書き込みは 1 回と数えます。回数は総数や発生率ではありません。
            </li>
            <li>
              <strong>コンポーネントの state のみ。</strong> コンポーネントの初期化中に作られた state
              を追跡します。<code>.svelte.ts</code> ファイルのモジュールレベルの state は対象外です。
            </li>
            <li>
              <strong>「影響しうる」であって「原因」ではない。</strong> エッジは現在の依存関係です。どの書き込みが値を変えたかは記録しません。
            </li>
            <li>
              <strong>一部の依存関係は欠けます。</strong> <code>$effect</code> は state
              を読んでいても入ってくるエッジが表示されないことがあります。
            </li>
            <li>
              <strong>グラフ内の値は要約。</strong> オブジェクトや配列は <code>(object)</code>、<code
                >[n]</code
              >、<code>{'{n}'}</code> と表示されます。タイムラインには
              <code>maxValueChars</code> までの値が含まれます。
            </li>
            <li>
              <strong>signal ごとの履歴はありません。</strong> タイムラインはすべての signal
              をまとめて、サンプリングされた最新 500 件の変化を保持します。
            </li>
            <li>
              <strong>上限。</strong> グラフは 5000 ノード・20000 エッジで打ち切られ、そのことを明示します（<code
                >truncated</code
              >、<code>total</code>、<code>edgesOmitted</code>）。<code>get_capture_info</code>
              が何をなぜ落としたかを報告します。
            </li>
            <li>
              <strong>1 回のページ読み込み。</strong> コンポーネント id は 1 つの epoch
              の中でだけ有効です。回答は最大 1 秒間キャッシュから返ることがあり、<code
                >computedAt</code
              > と <code>window.until</code> が計算時刻を示します。
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
                トークンがないか、以前の起動のものです。開発サーバーが最後に表示した行で登録し直してください。
              </dd>
            </div>
            <div>
              <dt><code>staleReason: "no-runtime"</code> の空の回答</dt>
              <dd>アプリのページが接続されていません。ブラウザでアプリを開いてから呼び直してください。</dd>
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
              <dd>同じ <code>get_live_components</code> の回答に含まれる epoch を渡してください。</dd>
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
              すべてのリクエストにトークンが必要です。トークンは起動ごとにランダムで、ターミナルにだけ表示されます。パスワードと同じように扱い、コミットしないでください。
            </li>
            <li>
              トークンはパネルのブラウザでのサインイン（ワンタイムコード）とは別物です。MCP
              クライアントはローカルのプロセスなのでブラウザの origin は確認されず、トークンだけが関門です。
            </li>
            <li>
              <code>get_state_timeline</code> は実行中のアプリの実際の state
              の値を返すので、エージェントにも見えます。開発中の state に秘密情報を入れないか、このツールを使わないでください。
            </li>
            <li>
              開発サーバーがネットワークで待ち受けている場合（<code>--host</code>）、エンドポイントも同様です。localhost
              を推奨します。
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
              <dd>≥ 0.4.0（このガイドと 4 つのリアクティビティツール）</dd>
            </div>
            <div>
              <dt>Vite</dt>
              <dd>≥ 8.3.2</dd>
            </div>
            <div>
              <dt>Svelte</dt>
              <dd>5（runes モード）。plain Svelte、SvelteKit 2、Kit 3 を CI でテストしています</dd>
            </div>
            <div>
              <dt>MCP</dt>
              <dd>
                Streamable HTTP、ステートレス、JSON 応答。CI はプレーンな HTTP（<code
                  >initialize</code
                >、<code>tools/list</code>、<code>tools/call</code>）でエンドポイントを呼んでいます。
              </dd>
            </div>
            <div>
              <dt>資料</dt>
              <dd>
                動画による解説はまだありません。実際の回答例とスクリーンショット（CI
                で記録）は<a href="{base}/mcp" lang="en">英語の MCP ガイド</a>にあります。
              </dd>
            </div>
          </dl>
        </section>

        <section class="next">
          <h2 class="content-h2">次に読む</h2>
          <ul>
            <li><a href="{base}/getting-started">プラグインを設定する（英語）</a></li>
            <li><a href="{base}/mcp#walkthrough">実際の回答例（英語）</a></li>
            <li><a href="{base}/panels/reactive">Reactivity パネル（英語）</a></li>
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
