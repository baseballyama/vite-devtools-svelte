// Japanese text for the MCP tools in mcp-tools.ts. Names and inputs come
// from MCP_TOOL_GROUPS; this file holds only translations. mcpToolsJa()
// throws when a tool is missing or extra, so the prerender fails instead of
// shipping a page that is out of step with the English list.

import { MCP_TOOL_GROUPS, type McpTool } from './mcp-tools'

interface JaText {
  summary: string
  note?: string
}

const GROUPS_JA: Record<string, { title: string; intro: string }> = {
  reactivity: {
    title: 'リアクティビティ（範囲を限定して取得）',
    intro:
      '0.4.0 で追加。どの回答も、対象期間・サンプリング・上限・ページ読み込み（epoch）・古いデータかどうかを明示します。大きなアプリではここから始めてください。',
  },
  issues: {
    title: 'パフォーマンスの問題',
    intro:
      'レンダー、リアクティビティ、load 関数、フレームレートをまたいだ問題を順位付きで返します。',
  },
  context: {
    title: 'プロジェクトの情報',
    intro: '静的解析と実行中のページから、アプリの構成を返します。',
  },
  sessions: {
    title: '計測セッション',
    intro: '変更の前後を計測して比較します。',
  },
}

const TOOLS_JA: Record<string, JaText> = {
  get_reactive_summary: {
    summary:
      '全インスタンスの実行時カウンタから、最も活発なコンポーネントインスタンスを返します（グラフは取得しません）。期間内にサンプリングされた state の変化とレンダーの回数で、`rows` と `other` の合計が総数になります。',
    note: '回数はサンプリング値（1 つの state につき 200 ms ごとに最大 1 回）で、発生率ではありません。追跡するのはコンポーネント初期化中に作られた state だけです。最大 1 秒間はキャッシュから回答します。',
  },
  get_reactive_scope: {
    summary:
      '1 つのコンポーネントインスタンスの $state / $derived / $effect ノードと、その直接の隣接ノード。componentId を省略するとアプリ全体のグラフ（上限あり）。',
    note: 'componentId には取得元の epoch が必要です（includeMeta 付きの get_live_components）。リロード後は staleReason "epoch-changed" の空の回答になります。エッジは「影響しうる」関係で、記録された原因ではありません。',
  },
  get_state_timeline: {
    summary:
      'カーソル以降にサンプリングされた $state の変化を、変更前後の値つきで返します。返された `cursor` を次の呼び出しの `since` に渡します。',
    note: '`reset: true` はカーソルが古く、バッファ全体（最新 500 件）を返したという意味です。大きな値はサイズの要約に置き換わります。時刻は検出した時刻です。',
  },
  get_capture_info: {
    summary:
      'データセットごとに、DevTools が保持している件数とアプリが報告した件数、選択の方針、理由別の破棄件数を返します。',
    note: '上限で切られたデータから結論を出す前に確認してください。',
  },
  list_performance_issues: {
    summary:
      'すべての指標を横断して問題を順位付きで返します。各問題は次に呼ぶツールを `suggestedTool` で示します。',
    note: 'アプリ全体のリアクティブグラフを読みます（上限 5000 ノード / 20000 エッジ）。',
  },
  get_component_hotspots: {
    summary:
      '合計レンダー時間の多いコンポーネントを、レンダー回数と 1 回あたりの平均とともに返します。',
  },
  get_render_profile: {
    summary: 'ファイル名に `file` を含むコンポーネントのレンダープロファイル。',
  },
  get_reactive_graph_problems: {
    summary:
      '依存の多すぎる effect、使われていない derived、孤立したノードを、グラフ全体ではなく分類として返します。',
    note: 'アプリ全体のリアクティブグラフを読みます（上限 5000 ノード / 20000 エッジ）。',
  },
  get_load_waterfall: {
    summary: 'SvelteKit の load プロファイルをルートごとに、時間とデータサイズつきで返します。',
  },
  get_fps_drops: {
    summary: 'しきい値を下回ったフレームレートのサンプル。',
  },
  get_project_info: {
    summary: 'パッケージ名とバージョン、Svelte / SvelteKit / Vite のバージョン、依存関係の一覧。',
  },
  get_routes: {
    summary: '静的解析による SvelteKit のルートツリー。',
  },
  get_live_components: {
    summary:
      'ブラウザにマウントされているコンポーネントインスタンス（親が先）。includeMeta 付きでは `{ epoch, total, captured, truncated, components }` を返し、既定で 1000 件までです。',
    note: 'コンポーネント id はその epoch（1 回のページ読み込み）の中でだけ有効です。',
  },
  get_component_relations: {
    summary: '.svelte コンポーネント間の静的な import 関係。',
  },
  start_session: {
    summary: 'ラベルを付けて指標の記録を始めます。同時に有効なセッションは 1 つです。',
  },
  end_session: {
    summary: '有効なセッションを終了し、その差分を返します。',
    note: '"disk" はプロジェクトの node_modules/.vite-devtools-svelte/sessions/ に書き込みます。',
  },
  compare_sessions: {
    summary:
      '終了した 2 つのセッションのレンダー・load・フレームレートの指標を比較します。各項目に判定（improved / regressed / unchanged）が付きます。',
  },
  list_sessions: {
    summary: 'メモリとディスクにあるセッションを新しい順に返します。',
  },
  load_session: {
    summary: 'セッションの記録全体（終了後は差分を含む）。',
  },
  delete_session: {
    summary: 'セッションをメモリとディスクから削除します。',
  },
}

export interface McpToolGroupJa {
  id: string
  title: string
  intro: string
  tools: (Pick<McpTool, 'name' | 'input'> & JaText)[]
}

export function mcpToolsJa(): McpToolGroupJa[] {
  const names = new Set(MCP_TOOL_GROUPS.flatMap(g => g.tools.map(t => t.name)))
  const extra = Object.keys(TOOLS_JA).filter(n => !names.has(n))
  if (extra.length > 0) throw new Error(`mcp-tools.ja: unknown tools ${extra.join(', ')}`)
  return MCP_TOOL_GROUPS.map(g => {
    const group = GROUPS_JA[g.id]
    if (!group) throw new Error(`mcp-tools.ja: missing group ${g.id}`)
    return {
      id: g.id,
      title: group.title,
      intro: group.intro,
      tools: g.tools.map(t => {
        const ja = TOOLS_JA[t.name]
        if (!ja) throw new Error(`mcp-tools.ja: missing tool ${t.name}`)
        return { name: t.name, input: t.input, ...ja }
      }),
    }
  })
}
