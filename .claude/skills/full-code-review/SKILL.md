---
name: full-code-review
description: PR 提出前に、vite-devtools-svelte リポジトリのオーナー視点でフルレビューする。WHY の理解 → 全体設計 → 実装（チャンク分割 → 順次 Agent → 対話 → 再レビュー）の順に、各フェーズでユーザーと対話しながら指摘を修正し、品質に問題がなくなるまで繰り返す。「/full-code-review」「フルレビュー」「レビューして」などの依頼時に使用。
---

# Full Code Review - vite-devtools-svelte 用フルレビュー

PR を提出する前に、リポジトリ全体のコードオーナー視点でフルレビューするスキル。
各フェーズでレビュー結果をユーザーに提示し、対話を通じて指摘事項を修正し、品質に問題がなくなるまで繰り返す。

## このリポジトリの構造（前提）

```
packages/vite-devtools-svelte/
  src/                    Vite プラグイン本体（plugin.ts / runtime.ts / analyzers / types.ts）
  src/__tests__/          vp test 用テスト
  client/src/             DevTools UI（Svelte 5 SPA）
    panels/               各パネル（Components, Routes, Reactive, ...）
    components/           共通 UI（Card, ListItem, ScrollList, ...）
    lib/                  rpc.ts, types.ts, design-system.css
playground/               開発用 SvelteKit デモアプリ
site/                     公開サイト（SvelteKit）
```

主要な技術的特徴（レビュー時に必ず意識する）：

- **デュアルトランスポート RPC**：Vite DevTools Kit の RPC を優先、失敗時は `/__svelte-devtools/rpc` HTTP fallback。新しい RPC を追加する時は **`getRpcHandlers()` 内に登録すれば両方に自動配線される**。
- **仮想モジュール**：`virtual:svelte-devtools/runtime` と `svelte/internal/client` のラッパー。`resolveId` / `load` フックで処理。
- **HMR チャネル**：`server.hot.send` / `server.hot.on` でブラウザ↔サーバー間のリアルタイム送受信。送信側と受信側はペアで存在する必要がある。
- **dev only**：プラグインは `config.command !== 'serve'` ではほぼ no-op。production ビルドを汚染してはいけない。

## 前提

- レビュー対象の PR があること（ブランチ上の変更 or PR 番号）
- ユーザーはコードオーナーであり、最終的な判断権限を持つ
- 修正はユーザーの承認を得てから行う

## 実行手順

### Step 0: 変更差分の把握

まずレビュー対象の全体像を把握する。

**ベースブランチの決定（優先順位）**:

1. **ユーザーから明示的に比較ブランチが指定されている場合** → 指定をそのまま使う
2. **PR 番号が指定されている場合** → `gh pr view <PR番号> --json baseRefName` で取得し `origin/<baseRefName>`
3. **上記以外（デフォルト）** → `origin/main` を使う（このリポジトリの本流）

```bash
if [ -n "${USER_SPECIFIED_BASE:-}" ]; then
  BASE_BRANCH="${USER_SPECIFIED_BASE}"
elif [ -n "${PR_NUMBER:-}" ]; then
  BASE_BRANCH="origin/$(gh pr view "${PR_NUMBER}" --json baseRefName -q '.baseRefName')"
else
  BASE_BRANCH="origin/main"
fi

git diff --name-only ${BASE_BRANCH}...HEAD
git diff --stat ${BASE_BRANCH}...HEAD
git log --oneline ${BASE_BRANCH}...HEAD
```

決定したベースブランチを必ずユーザーに報告する。

変更ファイルを以下のカテゴリに分類する（`scripts/plan-review-chunks.mjs` と同じ規則）：

- **plugin**: `packages/vite-devtools-svelte/src/` 配下（`__tests__/` を除く）
- **runtime**: `packages/vite-devtools-svelte/src/runtime.ts`（browser-injected コードは独立してレビュー）
- **client**: `packages/vite-devtools-svelte/client/` 配下
- **tests**: `packages/vite-devtools-svelte/src/__tests__/` 配下
- **playground**: `playground/` 配下
- **site**: `site/` 配下
- **config**: ルート直下（`package.json` / `pnpm-workspace.yaml` / `tsconfig*.json` / `*.config.*`）
- **docs**: `README.md` / `ROADMAP.md` / `docs/`
- **other**: 上記に該当しないファイル

分類結果と変更規模をユーザーに報告し、PR 番号があれば PR の説明欄も取得して提示する。

---

### Phase 1: WHY の理解と妥当性の判断

**目的**: この PR がなぜ必要なのか、背景を理解する。コードベースだけでは判断できない文脈（ユースケース・解決したい問題・優先度）を明確にし、この PR の存在意義が妥当かを判断する。

**進め方**:

1. **入手可能な情報をすべて集める**
   - PR がある場合: `gh pr view` で PR のタイトル・説明欄・コメント・リンクされた Issue を取得する
   - コミットメッセージから意図を読み取る
   - `ROADMAP.md` に該当機能（Phase 1〜4 のどれか）が記載されているか確認
   - 変更の性質（新パネル追加 / 既存パネル改善 / バグ修正 / リファクタリング / 依存更新 など）を分類する

2. **ユーザーに WHY を確認する**
   PR 説明欄や ROADMAP.md から WHY が十分に読み取れる場合は、質問せずに理解した内容を提示して確認を求める。読み取れない場合のみ以下を質問する:
   - **背景**: なぜ今この変更が必要なのか？何がきっかけか？
   - **対象ユーザー**: SvelteKit アプリの開発者にどんな価値をもたらすか？
   - **既存パネル/機能との関係**: 既存の何を置き換える / 補完するのか？

3. **妥当性を判断する**
   - 変更がプラグインの目的（Svelte/SvelteKit 開発の理解・最適化・デバッグ支援）に沿っているか
   - 過剰実装になっていないか、逆に不足していないか
   - **dev mode only 原則**を守っているか（production ビルドに影響を与えない）
   - **runtime overhead** が ROADMAP.md の目標（< 5%）に収まりそうか

**ユーザーへの報告フォーマット**（PR から WHY が読み取れる場合）:

```
## Phase 1: WHY の理解と妥当性

### コードと PR から読み取った概要
[変更内容の要約]

### WHY の理解
- **背景**: ...
- **対象ユーザー**: ...
- **既存機能との関係**: ...
- **この PR による価値**: ...

### 妥当性の判断
- **判定**: 妥当 / 懸念あり / 要議論
- **理由**: ...

### 懸念事項（あれば）
1. ...
```

**妥当と判断した場合**: そのまま Phase 2 へ進む（明示的な承認は不要）。
**懸念がある場合**: 懸念事項を提示し、ユーザーの回答を待ってから判断する。

---

### Phase 2: 全体設計のレビュー

**目的**: 変更全体の設計を理解し、その妥当性を判断する。

**確認事項**（このプロジェクト固有の観点を含む）:

1. **既存パターンとの整合性**
   - 新しい RPC を追加する場合、`plugin.ts` の `getRpcHandlers()` に登録しているか
   - 新しい型定義は `src/types.ts` に追加し、client 側 `client/src/lib/types.ts` と整合性が取れているか
   - 新しい RPC のクライアント関数は `client/src/lib/rpc.ts` に追加しているか
   - 新しいパネルは `client/src/panels/` に追加し、`App.svelte` の `tabs` 配列とアイコン CSS に登録しているか
   - 新しい HMR チャネル（`server.hot.send` / `server.hot.on`）を追加する場合、送信側と受信側のペアが揃っているか

2. **dev only 原則**
   - production ビルド (`config.command !== 'serve'`) でユーザーアプリに副作用を与えない
   - `transformIndexHtml` / `transform` フック内で `command === 'serve'` のガードがあるか
   - 注入されるランタイムコードが production バンドルに混入していないか

3. **設計の複雑性**
   - 不必要に複雑な抽象化（過剰な型階層、不要なディスパッチパターン）になっていないか
   - YAGNI 原則に従っているか（将来の仮説的な要件のために複雑化していない）
   - 既存の Card / ListItem / ScrollList / PanelContainer 等の共通コンポーネントを再利用しているか（新規 UI で同じ責務のものを再実装していない）

4. **データフローの整合性**
   - サーバー側で収集 → HMR で送信 → クライアントが受信 / クライアントが RPC で取得 のどちらか一貫しているか
   - 双方向で情報が流れる設計になっていないか（refresh / poll の起点が不明瞭になりやすい）
   - 大量データを扱うチャネル（render profiles / state timeline / fps）に **長さ上限のキャッピング** が入っているか（`if (xx.length > N) xx = xx.slice(-N)`）

5. **API サーフェス**
   - 公開 API（`SvelteDevtoolsOptions` の追加項目など）を増やしていないか。増やすなら `README.md` の "Options" セクションに追記しているか
   - 破壊的変更が含まれていないか（v0.0.x なので許容はされるが、明示は必要）

**ユーザーへの報告フォーマット**:

```
## Phase 2: 全体設計レビュー

### 設計の概要
[変更の設計を図示・説明。新パネル追加なら「追加されるレイヤー（types/RPC handler/RPC client/Panel/App.svelte 登録）」が網羅されているかを表で]

### 評価
| 観点 | 判定 | コメント |
|------|------|----------|
| 既存パターンとの整合性 | OK / 要改善 | ... |
| dev only 原則 | OK / 要改善 | ... |
| 複雑性 | OK / 要改善 | ... |
| データフロー | OK / 要改善 | ... |
| API サーフェス | OK / 要改善 | ... |

### 指摘事項（あれば）
1. **[Critical/Major/Minor]** [指摘内容] → [改善案]
2. ...

→ 指摘事項を対応しますか？それとも Phase 3 に進みますか？
```

**ユーザーの承認を待ってから Phase 3 へ進む。**

---

### Phase 3: 実装レビュー（チャンク分割 → 順次 Agent → 対話 → 再レビューの反復）

**目的**: 実装品質を複数の観点から検証し、指摘事項を修正し、品質に問題がなくなるまで繰り返す。

**前提となる考え方**:

PR が大規模になると、PR 全体を一括でレビューする AI ツール（CodeRabbit / Codex / simplify / security-review など）は、入力が大きすぎて検知漏れ・指摘の薄さ・出力の打ち切りが起きやすい。
そこで Phase 3 では、変更を **チャンク（小さな単位）** に分割し、ツールごとに **チャンク単位で繰り返し実行** する。各チャンクは「指摘がゼロになるまで」修正と再レビューのループを回す。

#### Step 3-0: チャンク計画（スクリプトで機械的に分割）

```bash
# Markdown 形式でユーザーに提示
node .claude/skills/full-code-review/scripts/plan-review-chunks.mjs --format=md ${BASE_BRANCH}

# 後続ステップで内部的に使う JSON
node .claude/skills/full-code-review/scripts/plan-review-chunks.mjs ${BASE_BRANCH} > /tmp/review-chunks.json
```

スクリプトのロジック:

- `git diff --numstat ${BASE_BRANCH}...HEAD` から変更ファイルと行数を取得
- ファイルをカテゴリに分類（plugin / runtime / client / tests / playground / site / config / docs / other）
- 各カテゴリ内でパス順に並べ、ディレクトリ境界 + 上限値（500 行 / 10 ファイル）で貪欲法分割
- カテゴリの優先順位: plugin → runtime → client → tests → playground → site → config → docs → other

**ユーザーへの報告**:

```
## Phase 3 チャンク計画

[スクリプト出力の Markdown テーブル]

→ このチャンク分割で進めてよいですか？分割方針に変更があれば（特定ファイルを別チャンクに、または同一チャンクにまとめるなど）お知らせください。
```

ユーザーの指示で分割を変更した場合は、変更後の最終チャンク一覧を再提示してから Step 3-1 に進む。

#### Step 3-1: チャンク × ツールのレビュー実行

各チャンクに対して、以下の Agent を **チャンク内で 1 つずつ順番に** 起動する。1 つのチャンク × 1 つの Agent の結果が出たら、Step 3-2 で対話・修正、Step 3-3 で再レビューを完了させてから次の Agent に進む。

**全体ループ構造**:

```
for chunk in /tmp/review-chunks.json.chunks:
    for agent in [security, implementation, simplify, coderabbit, codex]:
        if agent 対象外（チャンクに該当ファイルが含まれない、CLI 未インストール 等）: continue
        loop:
            agent をチャンク範囲に限定して実行
            指摘ゼロ ⇒ break
            Step 3-2 で対話・修正
            ⇒ 同じチャンク・同じ agent を再実行（ループ先頭へ）
        次の agent へ
    次のチャンクへ
```

**Agent 実行順序（チャンク内）**:

1. セキュリティレビュー（最も重要度が高い）
2. 実装レビュー（チャンクのカテゴリに応じて plugin / client / runtime / tests のチェック観点を切り替える）
3. コード簡素化レビュー（`simplify`）
4. CodeRabbit レビュー（`coderabbit:review`）
5. Codex レビュー（Codex CLI がインストールされている場合のみ）

**重要**: 各 Agent への指示には **必ず「対象チャンクのファイルパス一覧」を明示** し、チャンク外のファイルはレビュー対象から除外させる。

##### Agent 1: セキュリティレビュー（チャンク版）

```
セキュリティ観点でのコードレビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル（このリストに含まれるファイルのみレビュー対象。それ以外は無視）
- <file1>
- <file2>
- ...

Skill ツールを使って `security-review` を呼び出してください。
ただし、上記の対象ファイル一覧の範囲に絞ってレビューするように指示し、結果をそのまま報告してください。
チャンク外のファイルへの指摘は出力に含めないでください。

## このプロジェクト固有の重点観点
- 外部 URL fetch（OG preview / API playground）に SSRF 防御（private IP block / loopback block / localhost block）が入っているか
- ファイルサーブ（/__svelte-devtools/asset 等）でパストラバーサル防御（`fs.realpathSync` で symlink 解決 + 許可ディレクトリ prefix チェック）が入っているか
- ユーザー入力由来のパスを `path.join` ではなく `path.resolve` で扱っているか（絶対パスがリテラルに連結されて壊れる罠）
- `execFile` / `spawn` の引数にユーザー入力を直接渡していないか（コマンドインジェクション）
- ユーザー入力 RegExp の `g`/`y` フラグを剥がしているか（`RegExp.test()` がステートフルになる罠）
- 注入される runtime コード（runtime.ts / wrapper） に XSS / プロトタイプ汚染リスクがないか
```

##### Agent 2: 実装レビュー（チャンクのカテゴリに応じて切り替え）

チャンクの主カテゴリ（最も多くのファイルが属するカテゴリ）に応じて、以下のいずれかを使う:

**plugin / runtime チャンク向け**:

```
Vite プラグイン / runtime 実装のコードレビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル
- <file1>
- ...

## 手順
1. `.claude/skills/full-code-review/implementation-checklist.md` を読み込み、レビュー観点を把握する
2. `git diff <ベースブランチ>...HEAD -- <対象ファイル一覧>` で対象ファイルの変更差分のみを確認する
3. 対象ファイルを読み込み、レビューする

## 特に重視する観点
- 既存実装との一貫性（plugin.ts の `getRpcHandlers()` / `configureServer` パターン）
- dev only 原則（`config.command === 'serve'` ガード、production への副作用なし）
- HMR チャネル（`server.hot.send` / `server.hot.on`）の送受信ペアの整合性
- 大量データを扱うバッファに長さ上限のキャッピングがあるか
- Promise resolver の漏れ（タイムアウト時に `splice` で resolver 配列から取り除く）
- Vite v8 の environments API への対応（moduleGraph 取得時のフォールバック）
- runtime.ts: postMessage / window グローバルへの書き込みが既存の `window.__SVELTE_DEVTOOLS__` 名前空間に集約されているか
- runtime.ts: 注入されるコードがユーザーのコードを破壊しないか（global 衝突、prototype 拡張禁止）

## 出力フォーマット
ファイルごとに指摘事項を報告。各指摘に **[Critical/Major/Minor]** [ファイル:行番号] [指摘内容] → [改善案] を含める。
指摘がない場合は「指摘なし」と報告。チャンク外のファイルへの指摘は出さないこと。コードの修正は行わず、レビュー結果の報告のみ行ってください。
```

**client チャンク向け**:

```
DevTools UI（Svelte 5 SPA）のコードレビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル
- <file1>
- ...

## 手順
1. `.claude/skills/full-code-review/implementation-checklist.md` を読み込み、レビュー観点を把握する
2. `git diff <ベースブランチ>...HEAD -- <対象ファイル一覧>` で対象ファイルの変更差分のみを確認する
3. 対象ファイルを読み込み、レビューする

## 特に重視する観点
- Svelte 5 のリアクティビティ（`$state` / `$derived` / `$effect`）の正しい使い分け
  - 初期化処理を `$effect` 内に置いていない（再実行される）
  - `$effect` のクリーンアップ漏れ（setInterval / setTimeout / addEventListener）
  - 状態の同期は `$derived` を使う（`$effect` で代入しない）
- 共通コンポーネント（PanelContainer, Card, ListItem, ScrollList, ActionButton, Badge, SearchInput）を再利用しているか、独自再実装になっていないか
- design-system.css の CSS 変数（`--color-*` / `--space-*` / `--radius-*` / `--text-*`）を使っているか、ハードコードされた色や px 値が混じっていないか
- RPC 呼び出しが `client/src/lib/rpc.ts` 経由で行われているか（panel から直接 fetch していないか）
- ポーリング（`setInterval` で refresh）に過大な頻度が設定されていないか（最低 500ms 程度）
- 大量データの描画（state timeline / module graph / render profile）に仮想化または件数制限が入っているか

## 出力フォーマット
コンポーネント / panel ごとに指摘事項を報告。各指摘に **[Critical/Major/Minor]** [ファイル:行番号] [指摘内容] → [改善案] を含める。
指摘がない場合は「指摘なし」と報告。チャンク外のファイルへの指摘は出さないこと。コードの修正は行わず、レビュー結果の報告のみ行ってください。
```

**tests チャンク向け**:

```
テストコードのレビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル
- <file1>
- ...

## 特に重視する観点
- 新規追加された RPC ハンドラ / analyzer / runtime ロジックに対応するテストが存在するか
- `vitest run` で動くこと
- フィクスチャ（`src/__tests__/fixtures`）を流用しているか、ad-hoc な fs モックを書きすぎていないか
- 外部 URL fetch を含むテストはモックしているか（実ネットワークアクセスを発生させていない）
- セキュリティ系（SSRF / パストラバーサル）の負例テストが含まれているか
- コメントとアサーションが矛盾していないか（「〜されないことを確認」と書きながら toBeDefined() のようなパターン）

指摘がない場合は「指摘なし」と報告。チャンク外のファイルへの指摘は出さないこと。コードの修正は行わず、レビュー結果の報告のみ行ってください。
```

**playground / site チャンク向け**: 共通コンポーネントの統一性 + Svelte 5 のリアクティビティ観点を中心に、簡易レビュー。

**config / docs / other チャンク向け**: simplify / coderabbit に任せて Agent 2 はスキップして良い。

##### Agent 3: コード簡素化レビュー（チャンク版）

```
コードの簡素化・品質改善レビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル
- <file1>
- ...

Skill ツールを使って `simplify` を呼び出し、上記対象ファイルに限定したレビューを依頼してください。
チャンク外のファイルへの指摘は除外してください。
```

##### Agent 4: CodeRabbit レビュー（チャンク版）

```
CodeRabbit による AI コードレビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル
- <file1>
- ...

Skill ツールを使って `coderabbit:review` を呼び出し、上記対象ファイルに絞った結果のみを報告してください。
チャンク外のファイルへの指摘は除外してください。
```

##### Agent 5: Codex レビュー（チャンク版・Codex CLI がインストールされている場合のみ）

```
Codex CLI を使った包括的コードレビューを、以下の対象ファイルに絞って実行してください。

## 対象チャンク
[チャンク名]

## 対象ファイル
- <file1>
- ...

## ベースブランチ
${BASE_BRANCH}

## 手順
1. `which codex` で Codex CLI のインストール状況を確認
   - 未インストールなら「Codex CLI 未インストールのためスキップ」と報告して終了
2. インストール済みなら、Skill ツールで `codex-review` スキルを呼び出す
   - 対象ファイル一覧と ${BASE_BRANCH} はスキルへの指示文に明示する

チャンク外のファイルへの指摘は除外してください。コードの修正は行わず、レビュー結果の報告のみ行ってください。
```

#### Step 3-2: レビュー結果の個別報告・修正・対話

各 Agent のレビュー結果を受け取るたびに、以下の流れで進める:

1. 指摘事項をユーザーに報告（**チャンク名・Agent 名・反復回数を必ず明示**）
2. Critical/Major の指摘に対して **修正案を提示**
3. ユーザーに確認を取り、承認されたら修正を実施
4. ユーザーがスキップを指示した場合はその旨記録して次へ進む
5. 修正が発生したら **同じチャンク・同じ Agent で再レビュー（Step 3-3）**
6. 指摘がゼロになったら、次の Agent（または次のチャンク）に進む

**報告フォーマット**:

```
## [チャンク #N: チャンク名] / [Agent名] レビュー結果（反復 M 回目）

### 指摘事項
1. **[Critical]** [ファイル:行番号] [指摘内容]
   → 修正案: [具体的な修正内容]
2. **[Major]** [ファイル:行番号] [指摘内容]
   → 修正案: [具体的な修正内容]
3. **[Minor]** [ファイル:行番号] [指摘内容]

（指摘がない場合は「指摘なし。次の Agent に進みます」）

→ 上記の修正案で対応してよいですか？変更点やスキップしたいものがあればお知らせください。
```

#### Step 3-3: 同チャンク・同 Agent での再レビュー（指摘ゼロまで反復）

修正が発生した場合、**修正された同じチャンクに対して、同じ Agent を再実行する**。これにより:

- 修正による副作用や、修正自体に対する新たな指摘を検出する
- 反復回数をカウントしながら、指摘がゼロになるまで Step 3-1 → 3-2 → 3-3 を繰り返す
- 反復が **5 回を超えた場合** は、ユーザーに「反復が長期化しています。残った指摘をスキップして次に進みますか？」と確認する（無限ループ防止）

**1 つのチャンク × 1 つの Agent のループ終了条件**:

- すべての Critical/Major 指摘が解消されている（Minor のみ残）
- Major 指摘が残っているが、ユーザーが明示的にスキップを承認している
- Minor のみが残っている

**1 つのチャンクの完了条件**: そのチャンクに対する全 Agent が上記ループ終了条件を満たしたら次のチャンクへ。

**Phase 3 全体の完了条件**: 全チャンクが完了したら Phase 4 へ。

**進捗表示**:

```
進捗: チャンク 2/4 (client: panels/Reactive*) / Agent 3/5 (simplify) / 反復 2 回目
```

---

### Phase 4: 最終サマリー

すべてのフェーズを完了したら、レビュー全体のサマリーを提示する。

```
## レビュー完了サマリー

### 総合判定: Approve / Request Changes / 要議論

### フェーズ別結果
| フェーズ | 判定 | Critical | Major | Minor |
|----------|------|----------|-------|-------|
| 1. WHY と妥当性 | OK / NG | - | - | - |
| 2. 全体設計 | OK / NG | N件 | N件 | N件 |
| 3. 実装レビュー | OK / NG / Skip | N件 | N件 | N件 |

### Phase 3 チャンク別実装レビュー詳細

| チャンク # | チャンク名 | セキュリティ | 実装 | simplify | CodeRabbit | Codex |
|-----------|-----------|-------------|------|----------|-----------|-------|
| 1 | [チャンク1名] | 指摘なし(1回) | 指摘なし(2回) | 指摘なし(1回) | 指摘なし(1回) | 指摘なし(1回) |
| 2 | [チャンク2名] | 指摘なし(1回) | スキップ承認(N件残, 3回) | 指摘なし(1回) | 指摘なし(1回) | スキップ |

凡例: `指摘なし(N回)` = N 回の反復で指摘ゼロ / `スキップ承認(N件残, M回)` = ユーザー承認のもと N 件残してスキップ / `スキップ` = 対象外（CLI 未インストールなど）/ `N/A` = チャンクに該当ファイルなし

### Phase 3 全体集計
| レビューツール | 総反復回数 | 指摘ゼロ達成チャンク | 残指摘ありチャンク |
|---------------|-----------|---------------------|-------------------|
| セキュリティ | N回 | N/N | N |
| 実装 | N回 | N/N | N |
| simplify | N回 | N/N | N |
| CodeRabbit | N回 | N/N | N |
| Codex | N回 | N/N | N |

### 未対応の指摘事項（あれば）
1. [指摘内容と理由]

### 対応済みの指摘事項
1. [対応内容]

### コードオーナーへの申し送り事項
- [手動確認が必要な事項。例: playground / site / 実プロジェクトでの動作確認、ROADMAP.md の更新要否]
```

---

### Phase 5: コミット・プッシュ・CI 監視

レビューと修正がすべて完了したら、以下の順に進める。

#### Step 5-1: ブランチの安全確認

現在のブランチ名を確認する。**`main`、`master`、`release` で始まるブランチ**の場合、直接プッシュすると事故になるため、先にユーザーに確認する:

```
現在のブランチは `[ブランチ名]` です。
このブランチに直接プッシュすると影響が大きいため、新しいブランチを切ることを推奨します。
→ 新しいブランチを作成しますか？ブランチ名を指定してください。
```

それ以外のブランチの場合はそのまま Step 5-2 に進む。

#### Step 5-2: コミットとプッシュ

修正内容がある場合、ユーザーに確認する:

```
レビューで修正した内容をコミット・プッシュしますか？
```

ユーザーが承認した場合、変更をコミットしてプッシュする。

#### Step 5-3: CI パス・レビューコメント解決ループ（PR がある場合のみ）

プッシュが完了し、かつ PR が存在する場合、ユーザーに確認した上で:

1. **CI 監視**: GitHub Actions のチェックがパスするまで `gh pr checks <PR>` で確認・修正する（`ci-fix-and-verify` スキルがあれば呼び出し、なければ手動）
2. **レビューコメント対応**: CI がパスしたら、未解決のレビューコメントに 1 つずつ対応する
3. **再度 CI 監視**: コード修正が発生した場合、再度 CI 監視に戻る
4. **ループ終了条件**: CI が全パス かつ 未解決のレビューコメントがゼロになるまで 1〜3 を繰り返す

---

## 指摘の重要度定義

| 重要度       | 定義                                                                | 対応                                   |
| ------------ | ------------------------------------------------------------------- | -------------------------------------- |
| **Critical** | セキュリティ脆弱性、production への副作用、ユーザーアプリ破壊リスク | 必ず修正。Approve 不可                 |
| **Major**    | パフォーマンス問題、設計上の問題、HMR チャネル不整合、テスト不足    | 原則修正。正当な理由があればスキップ可 |
| **Minor**    | 可読性、命名、コメント不足など品質改善                              | 推奨。費用対効果で判断                 |

## レビュー時の心構え

- **コードオーナーの代理** として、プラグイン全体の品質を守る視点でレビューする
- **段階的に進める**: 各フェーズで問題を発見したら、そのフェーズで解決してから次へ
- **対話重視**: 一方的に指摘するのではなく、ユーザーとの対話を通じて最適解を見つける
- **既存パターンとの整合性** を最重視する（`plugin.ts` / `App.svelte` / `rpc.ts` の登録パターンに合わせる）
- **dev only を守る**: production ビルドへの副作用を絶対に持ち込まない
- **テスト実行は package ディレクトリで**: `pnpm -C packages/vite-devtools-svelte test`
- **品質に妥協しない**: Critical/Major 指摘が残っている状態で Approve しない

## 参照ドキュメント

| フェーズ               | 参照先                                                                     |
| ---------------------- | -------------------------------------------------------------------------- |
| Phase 1 (WHY)          | `ROADMAP.md`、PR 本文、関連 Issue                                          |
| Phase 2 (設計)         | `README.md`、`plugin.ts` の既存パターン                                    |
| Phase 3 (実装レビュー) | 各 Agent が以下を読み込んで独立にレビュー:                                 |
|                        | - Agent 1: `security-review` スキル呼び出し（組み込みスキル）              |
|                        | - Agent 2: `implementation-checklist.md`（カテゴリに応じた観点を切り替え） |
|                        | - Agent 3: `simplify` スキル呼び出し                                       |
|                        | - Agent 4: `coderabbit:review` スキル呼び出し                              |
|                        | - Agent 5: `codex-review` スキル呼び出し（CLI インストール時のみ）         |

**`implementation-checklist.md`** は `.claude/skills/full-code-review/implementation-checklist.md` に配置されている。
