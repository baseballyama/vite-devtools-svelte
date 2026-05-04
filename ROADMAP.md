# Svelte DevTools for Vite DevTools — ロードマップ

## エグゼクティブサマリー

Svelte/SvelteKit エコシステムには、Vue DevTools や React DevTools に匹敵する統合的な開発者ツールが存在しない。既存ツールは断片的で、多くが Svelte 5 未対応またはメンテナンス停止状態にある。本プロジェクトは、新しい **Vite DevTools Plugin Kit** (`@vitejs/devtools-kit`) を活用し、Svelte/SvelteKit 向けの包括的な DevTools プラグインを構築する。**Vite DevTools のフレームワーク固有プラグインとしては世界初の実装**となる。

---

## 1. 調査結果サマリー

### 1.1 既存 Svelte DevTools の現状

| ツール | 状態 | Svelte 5 | 主要機能 | 課題 |
|--------|------|----------|----------|------|
| [svelte-devtools](https://github.com/sveltejs/svelte-devtools) (公式) | 活発 | ✅ (v2.2.1) | コンポーネントツリー、状態編集 | 機能が限定的、パフォーマンス分析なし |
| [@sveltejs/vite-plugin-svelte-inspector](https://github.com/sveltejs/vite-plugin-svelte) | 活発 | ✅ | クリック→ソースコード | 単機能（ファイル位置表示のみ） |
| [Svelte DevTools+](https://github.com/oslabs-beta/Svelte-DevTools-Plus) | 低活動 | ❓ | タイムトラベルデバッグ | Svelte 5 対応不明 |
| [Svelcro](https://github.com/oslabs-beta/Svelcro) | 放棄 | ❌ | レンダリング時間計測 | 2022年以降更新なし |
| [ikun-svelte-devtools](https://github.com/ikun-svelte/ikun-svelte-devtools) | 低活動 | ❓ | ページ/ルート/アセット表示 | プロトタイプ段階 |
| [svelte-grab](https://github.com/HeiCg/svelte-grab) | 新規 | ✅ | コンポーネント検査、a11y監査 | AI 特化、ユーザー少 |
| Svelte 組み込み `$inspect` rune | 公式 | ✅ | リアクティブログ | コンソール出力のみ、視覚化なし |

### 1.2 他フレームワーク DevTools との機能比較

| 機能カテゴリ | Vue DevTools | React DevTools | Angular DevTools | Svelte (現状) |
|-------------|-------------|----------------|-----------------|--------------|
| コンポーネントツリー | ✅ 強力 | ✅ 強力 | ✅ 強力 | ⚠️ 基本的 |
| 状態編集 | ✅ 強力 | ✅ 強力 | ⚠️ 中程度 | ⚠️ 基本的 |
| パフォーマンスプロファイラ | ⚠️ Timeline | ✅ Profiler + Performance Tracks | ✅ Profiler + Chrome統合 | ❌ なし |
| ルーティング | ✅ 組み込み | ❌ 外部 | ⚠️ 実験的 | ❌ なし |
| 状態管理 | ✅ Pinia統合 | ❌ 外部(Redux DevTools) | ❌ 外部 | ❌ なし |
| リアクティビティ追跡 | ✅ Graph + Timeline | ⚠️ Changed props | ✅ Signal Graph | ❌ なし |
| 拡張性API | ✅ 最良 | ❌ | ❌ | ❌ なし |
| ブラウザ統合 | ⚠️ 中程度 | ✅ 最良 | ✅ 強力 | ❌ なし |

### 1.3 Vite DevTools Plugin Kit の技術仕様

- **パッケージ**: `@vitejs/devtools-kit` (v0.1.2, 実験的)
- **アーキテクチャ**: birpc over WebSocket (ポート 7812)
- **プラグイン構造**: Vite Plugin に `devtools.setup(ctx)` フックを追加
- **API**: docks（UI パネル）、views（静的ファイル）、rpc（双方向通信）、sharedState（同期状態）、logs、terminals
- **ドックタイプ**: `iframe` / `action` / `custom-render` / `json-render` / `launcher`
- **UI構築**: iframe パネル（任意のフレームワーク）または JSON Render（サーバーサイドで宣言的 UI）
- **現状**: フレームワーク固有プラグインはまだ存在しない → **先行者利益**

### 1.4 Svelte 固有の技術的機会

Svelte 5 の Rune システム (`$state`, `$derived`, `$effect`) はコンパイル時に変換されるため、以下のユニークな機会がある:

1. **リアクティブグラフの可視化** — `$state` → `$derived` → `$effect` の依存関係チェーンを DAG として可視化
2. **コンパイル時最適化の可視化** — Svelte コンパイラがどのように最適化したかを表示
3. **コンポーネントレベルのレンダリング負荷** — Svelte の細粒度リアクティビティを活かしたピンポイント計測
4. **SvelteKit 統合** — ルート/レイアウト/load 関数/フォームアクションの統合的な可視化
5. **OpenTelemetry 統合** — SvelteKit の実験的 Observability 機能との連携

---

## 2. プロダクトビジョン

### コンセプト: "Svelte を深く理解するための開発者体験"

Svelte DevTools for Vite DevTools は、以下の 3 つの柱を中心に構築する:

1. **理解 (Understand)** — アプリの構造、データフロー、依存関係を直感的に把握
2. **最適化 (Optimize)** — パフォーマンスのボトルネックを特定し、改善を導く
3. **デバッグ (Debug)** — 問題の原因を迅速に特定し、修正を支援

---

## 3. 機能ロードマップ

### Phase 1: 基盤構築 + コア機能 (MVP)

> 目標: 最小限の実用的な DevTools を公開し、コミュニティからフィードバックを得る

#### 1.1 プラグイン基盤
- Vite DevTools Plugin Kit との統合
- Svelte コンパイラプラグイン（計装コード挿入）
- サーバー ↔ クライアント RPC 通信基盤
- Svelte でビルドした DevTools UI パネル（iframe ドック）

#### 1.2 コンポーネントインスペクター
- **コンポーネントツリー表示** — 階層構造をツリービューで表示
  - コンポーネント名、ファイルパス、行番号
  - 検索/フィルタリング機能
  - コンポーネントをクリック → エディタでソースを開く
- **Props/State 表示・編集** — コンポーネントの `$state`, `$derived`, `$props` をリアルタイム表示
  - 値の直接編集（`$state` のみ）
  - Deep object/array のドリルダウン
- **DOM ハイライト** — コンポーネント選択時に対応する DOM 要素をハイライト
- **逆引きインスペクター** — ページ上の要素をクリック → 対応コンポーネントを特定

#### 1.3 SvelteKit ページ & ルーティング
- **ルート一覧** — ファイルベースルーティングの全ルート表示
  - `+page.svelte`, `+layout.svelte`, `+server.ts` の関係性表示
  - 動的パラメータ、レストパラメータの表示
  - 現在のアクティブルートのハイライト
- **ルートマッチングテスター** — URL を入力してどのルートにマッチするか確認
- **ナビゲーション履歴** — ページ遷移の履歴をタイムライン表示

#### 1.4 アセットビューア
- プロジェクトの静的アセット（`static/` ディレクトリ）を一覧表示
- 画像/フォント/動画のプレビュー
- ファイルサイズ・メタデータ表示

---

### Phase 2: パフォーマンス分析

> 目標: Svelte アプリの性能改善を支援するツール群

#### 2.1 コンポーネントレンダリングプロファイラ
- **レンダリング回数カウンター** — 各コンポーネントの再レンダリング回数を表示
- **レンダリング時間計測** — マウント/更新にかかった時間をコンポーネントごとに表示
- **再レンダリングハイライト** — 再レンダリングが発生したコンポーネントをページ上でリアルタイムハイライト（React DevTools の "Highlight updates" 相当）
- **不要な再レンダリング検出** — Props/State が変化していないのに再レンダリングされたケースを警告
- **フレームグラフ** — コンポーネント階層に沿ったレンダリング時間のフレームグラフ表示

#### 2.2 リアクティブグラフ ⭐ (差別化機能)
- **依存関係グラフ (DAG)** — `$state` → `$derived` → `$effect` の依存関係をインタラクティブな有向グラフとして可視化
  - ノード: 各リアクティブプリミティブ（色分け: state=青, derived=緑, effect=赤）
  - エッジ: 依存関係の方向
  - コンポーネント境界の表示
- **カスケード更新追跡** — ある `$state` の変更がどの `$derived` → `$effect` に伝播するかをアニメーション表示
- **ホットスポット検出** — 多くの依存先を持つ state や、頻繁に再計算される derived を警告
- **$effect 実行履歴** — 各 `$effect` の実行回数、実行タイミング、所要時間のログ

#### 2.3 Load 関数プロファイラ
- **サーバー load 関数の実行時間** — 各 `+page.server.ts` / `+layout.server.ts` の load 関数の所要時間
- **ユニバーサル load 関数の実行時間** — `+page.ts` / `+layout.ts` の所要時間
- **ウォーターフォール表示** — load 関数の実行順序と並列/直列の関係を可視化
- **データサイズ表示** — load 関数が返すデータのサイズを表示し、過大なペイロードを警告

---

### Phase 3: デバッグ & 開発体験向上

> 目標: 開発ワークフローを加速する高度なツール群

#### 3.1 状態タイムライン
- **状態変更履歴** — `$state` の変更をタイムラインで記録
  - 変更前/後の値
  - 変更元のコンポーネント/関数
  - スタックトレース
- **タイムトラベルデバッグ** — タイムライン上の任意の時点に状態を巻き戻し
- **スナップショット** — 現在の全 state をスナップショットとして保存/復元

#### 3.2 SvelteKit サーバー API プレイグラウンド
- **API ルート一覧** — `+server.ts` エンドポイントの一覧表示
- **リクエストテスター** — Postman ライクな API テスト UI（メソッド、ヘッダー、ボディ指定）
- **フォームアクション テスター** — Form Actions のテスト UI

#### 3.3 エラー & 警告ダッシュボード
- **コンパイラ警告の集約** — Svelte コンパイラが出す警告をカテゴリ別に集約表示
- **アクセシビリティ警告** — a11y 関連の警告を専用パネルで表示
  - 重要度別（error / warning / info）のフィルタリング
  - 該当コンポーネントへのリンク
- **ランタイムエラー履歴** — `<svelte:boundary>` で捕捉されたエラーのログ

#### 3.4 Inspect (コンパイル結果)
- **コンパイル前後の比較** — `.svelte` ファイルのソースとコンパイル後の JS を並べて表示
- **Vite 変換パイプライン** — 各プラグインがファイルをどう変換したかを表示（vite-plugin-inspect 相当）

---

### Phase 4: 高度な機能 & エコシステム統合

> 目標: プロダクション対応と高度な分析機能

#### 4.1 モジュールグラフ
- **依存関係グラフ** — プロジェクト内の JS/Svelte モジュールの依存関係をインタラクティブグラフで表示
- **循環依存の検出** — 循環 import を検出して警告
- **バンドルサイズ影響分析** — 各モジュールがバンドルサイズに与える影響を可視化

#### 4.2 Stores / Context ビューア
- **Svelte Stores 一覧** — アクティブな writable/readable/derived ストアの一覧と現在値
- **Context 一覧** — `setContext` / `getContext` で共有されているデータの一覧
- **Store 購読グラフ** — どのコンポーネントがどの Store を購読しているかを可視化

#### 4.3 OpenTelemetry 統合
- SvelteKit の Observability 機能と連携
- サーバーサイドのトレーススパンを DevTools 内で表示
- `handle` フック → `load` 関数 → フォームアクションの実行フローを可視化

#### 4.4 プロダクションビルド分析
- チャンク/アセット/パッケージのサイズ分析（treemap/sunburst 表示）
- Tree-shaking の効果を可視化
- ビルド間の比較

#### 4.5 Open Graph プレビュー
- 各ページの OG タグのプレビュー
- Twitter/Facebook/LinkedIn での表示シミュレーション
- メタタグの問題検出と修正提案

---

## 4. 技術アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Vite DevTools UI                          │
│  ┌───────────────────────────────────────────────────────┐  │
│  │          Svelte DevTools Panel (iframe)                │  │
│  │  ┌──────────┬──────────┬──────────┬──────────┐       │  │
│  │  │Components│  Routes  │Reactive  │Profiler  │ ...   │  │
│  │  │ Tree     │          │ Graph    │          │       │  │
│  │  └──────────┴──────────┴──────────┴──────────┘       │  │
│  │                  Svelte 5 SPA                         │  │
│  └───────────────────────────────┬───────────────────────┘  │
│                                  │ RPC (birpc/WebSocket)    │
│  ┌───────────────────────────────┴───────────────────────┐  │
│  │              Vite DevTools Server                      │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │     vite-devtools-svelte (server)        │  │  │
│  │  │  ┌──────────┬──────────┬──────────┬──────────┐  │  │  │
│  │  │  │Component │Route     │Compile   │Profile   │  │  │  │
│  │  │  │Analyzer  │Resolver  │Analyzer  │Collector │  │  │  │
│  │  │  └──────────┴──────────┴──────────┴──────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    User's Svelte App                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Instrumentation Runtime (injected by compiler plugin)  ││
│  │  - Component mount/update/destroy hooks                 ││
│  │  - $state/$derived/$effect tracking                     ││
│  │  - Render timing                                        ││
│  │  - DOM highlight overlay                                ││
│  └───────────────────────────────┬─────────────────────────┘│
│                                  │ postMessage / WebSocket  │
└──────────────────────────────────┴──────────────────────────┘
```

### 主要コンポーネント

| コンポーネント | 役割 | 技術 |
|---------------|------|------|
| **Vite Plugin** | Vite DevTools Kit との統合、RPC 登録 | `@vitejs/devtools-kit` |
| **Svelte Compiler Plugin** | 計装コードの挿入（レンダリング計測、状態追跡） | Svelte preprocessor / compiler API |
| **DevTools UI** | 各パネルの UI | Svelte 5 SPA |
| **Runtime Agent** | ユーザーアプリ内で動作する軽量ランタイム | Vanilla JS (バンドルサイズ最小化) |
| **Server Analyzer** | ルート解析、コンパイル結果分析、静的解析 | Node.js |

### パッケージ構成

```
packages/
├── vite-devtools-svelte/     # メイン Vite プラグイン
│   ├── src/
│   │   ├── plugin.ts                # Vite plugin + devtools.setup()
│   │   ├── rpc/                     # RPC 関数定義
│   │   ├── analyzers/               # サーバーサイド解析ロジック
│   │   └── compiler/                # Svelte コンパイラプラグイン
│   └── client/                      # DevTools UI (Svelte 5 SPA)
│       ├── src/
│       │   ├── panels/              # 各パネル (Components, Routes, etc.)
│       │   ├── components/          # 共通 UI コンポーネント
│       │   └── lib/                 # ユーティリティ、RPC クライアント
│       └── ...
├── runtime/                         # ユーザーアプリに注入されるランタイム
│   ├── src/
│   │   ├── instrumentation.ts       # コンポーネントフック
│   │   ├── reactive-tracker.ts      # リアクティビティ追跡
│   │   └── overlay.ts              # DOM ハイライトオーバーレイ
│   └── ...
└── shared/                          # 共有型定義・ユーティリティ
```

---

## 5. 差別化ポイント

### 他フレームワークの DevTools にない、Svelte 固有の価値

| 機能 | なぜ Svelte で可能/有用か | 競合状況 |
|------|--------------------------|----------|
| **リアクティブグラフ** | Svelte 5 の Rune (`$state`→`$derived`→`$effect`) は明確な依存関係を持つ。Angular の Signal Graph に相当するが、コンパイル時情報も活用可能 | Angular に Signal Graph あり、Vue/React にはなし |
| **コンパイル最適化ビュー** | Svelte はコンパイラベースのフレームワーク。コンパイル前後を比較して最適化を理解できるのは Svelte 特有 | 他フレームワークにはなし |
| **Load 関数ウォーターフォール** | SvelteKit の load 関数はファイルベースで宣言的。ウォーターフォール（直列実行）の問題を可視化しやすい | Nuxt DevTools に類似機能あり |
| **細粒度レンダリング追跡** | Svelte の細粒度リアクティビティにより、DOM の個々の更新をピンポイントで追跡できる | React/Vue はコンポーネント単位 |
| **`$inspect` 統合** | `$inspect` rune のカスタムハンドラ (`.with()`) を活用して DevTools に直接データを送信 | Svelte 5 固有 |

---

## 6. 優先度マトリクス

```
                          高インパクト
                              │
         Phase 2              │            Phase 1
   ┌─────────────────────┐    │    ┌─────────────────────┐
   │ リアクティブグラフ    │    │    │ コンポーネントツリー  │
   │ レンダリングプロファイラ│   │    │ Props/State 検査     │
   │ Load 関数プロファイラ  │   │    │ ルーティング表示      │
   │                     │    │    │ アセットビューア       │
   └─────────────────────┘    │    └─────────────────────┘
  ────────────────────────────┼────────────────────────────
         Phase 4              │            Phase 3
   ┌─────────────────────┐    │    ┌─────────────────────┐
   │ OpenTelemetry 統合   │    │    │ タイムトラベルデバッグ │
   │ ビルド分析           │    │    │ API プレイグラウンド   │
   │ OG プレビュー        │    │    │ エラーダッシュボード   │
   │ モジュールグラフ      │    │    │ コンパイル結果表示    │
   └─────────────────────┘    │    │ Stores/Context      │
                              │    └─────────────────────┘
                              │
                          低インパクト
  高コスト ←──────────────────┼──────────────────→ 低コスト
```

---

## 7. 成功指標

| 指標 | Phase 1 目標 | 長期目標 |
|------|-------------|---------|
| npm 週間ダウンロード | 500+ | 10,000+ |
| GitHub Stars | 100+ | 1,000+ |
| コミュニティコントリビュータ | 3+ | 20+ |
| Svelte 公式への採用 | - | 公式推奨ツール化 |
| ユーザーアプリへのパフォーマンス影響 | < 5% overhead (dev mode) | < 2% overhead |

---

## 8. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| Vite DevTools Kit が実験的で API が変わる可能性 | 高 | Kit の変更を追跡、抽象化レイヤーを設ける |
| Svelte コンパイラの内部 API への依存 | 中 | 公開 API のみ使用、compiler API の `walk` 等を活用 |
| ランタイム計装によるユーザーアプリのパフォーマンス低下 | 高 | dev mode のみ有効化、計装の粒度をユーザーが設定可能に |
| Svelte 5 のリアクティビティ追跡の技術的難易度 | 高 | `$inspect` rune のカスタムハンドラを活用、Proxy ベースの追跡 |
| 単独開発者のリソース不足 | 中 | Phase 1 で MVP を公開し、早期にコミュニティを巻き込む |

---

## 9. 参考資料

- [Vite DevTools Plugin Kit ドキュメント](https://devtools.vite.dev/kit/devtools-plugin.html)
- [Vite DevTools リポジトリ](https://github.com/vitejs/devtools)
- [Nuxt DevTools](https://devtools.nuxt.com/)
- [Vue DevTools](https://devtools.vuejs.org/)
- [Svelte DevTools (公式ブラウザ拡張)](https://github.com/sveltejs/svelte-devtools)
- [Svelte 5 Runes ドキュメント](https://svelte.dev/docs/svelte/$state)
- [SvelteKit Observability](https://svelte.dev/docs/kit/observability)
- [Angular Signal Graph](https://blog.angular.dev/angular-summer-update-2025-1987592a0b42)
- [React Performance Tracks](https://react.dev/reference/dev-tools/react-performance-tracks)
