<p align="center">
  <img src="https://raw.githubusercontent.com/KobayashiRui/vibe-svg-editor/main/docs/images/app-icon.svg" alt="VibeSVG" width="72" height="72" />
</p>

<h1 align="center">VibeSVG</h1>

<p align="center">
  Geometry AST と patch-based editing で動く、agent-native な SVG エディタ。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vibesvg"><img src="https://img.shields.io/npm/v/vibesvg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/vibesvg"><img src="https://img.shields.io/npm/dm/vibesvg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/KobayashiRui/vibe-svg-editor/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/vibesvg?style=flat-square" alt="license" /></a>
  <img src="https://img.shields.io/node/v/vibesvg?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/pnpm-9.0.0-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 9.0.0" />
</p>

<p align="center">
  <a href="https://github.com/KobayashiRui/vibe-svg-editor/blob/main/README.md">English</a> | 日本語
</p>

VibeSVG は、手作業での編集と AI エージェントによる編集の両方を前提にした SVG エディタです。
エージェントに SVG 文字列全体を書き換えさせるのではなく、SVG を Geometry AST に import し、
対象を絞った patch operation を適用し、境界部分でだけ SVG として export します。

![VibeSVG editor](https://raw.githubusercontent.com/KobayashiRui/vibe-svg-editor/main/docs/images/editor.png)

```txt
SVG
↓ Import
Geometry AST
↓ Patch Operations
Geometry AST
↓ Export
SVG
```

## Demo

![VibeSVG demo](https://raw.githubusercontent.com/KobayashiRui/vibe-svg-editor/main/docs/images/vibesvg-demo.gif)

## Status

VibeSVG は開発初期段階です。現在のリリースは CLI-first で、ローカルの editor session、project file、SVG export、MCP ベースの agent workflow にフォーカスしています。

## SVG Feature Support

VibeSVG は編集可能な SVG の概念を構造化された Geometry AST として保持し、SVG XML は import / export 境界で生成・解析します。

現時点では、geometry node と正規化された path、solid fill / stroke、linear / radial gradient、translate / rotate / scale transform、geometry node を参照する clip path と alpha mask、blur / drop shadow をサポートしています。

次の優先事項は、inner shadow、blend mode、追加の high-level effect、pattern paint / marker、再利用可能な symbol / instance、rich text run、外部 SVG の transform / filter / mask 構文との互換性強化です。Boolean Union / Subtract は、通常の SVG path の import・編集には不要な geometry authoring 操作のため、意図的に後回しにしています。

## Quick Start

VibeSVG をインストールします。

```sh
npm install -g vibesvg
```

新規プロジェクトを開始します。

```sh
vibesvg my-logo
```

これは `./my-logo.vsvg.json` を開きます。ファイルが存在しない場合、VibeSVG が自動で作成します。

global install せずに実行することもできます。

```sh
npx vibesvg my-logo
```

## Agent Workflow

VibeSVG では Geometry AST が source of truth です。AI エージェントは SVG ファイル全体を再生成するのではなく、patch operation または MCP tool を通じて project を変更します。

デフォルトのローカル MCP endpoint:

```txt
http://127.0.0.1:6202/mcp
```

ローカル MCP endpoint を登録します。

```sh
vibesvg mcp install codex --url http://127.0.0.1:6202/mcp
vibesvg mcp install claude --url http://127.0.0.1:6202/mcp
```

VibeSVG skill をインストールします。

```sh
vibesvg skills install codex
vibesvg skills install claude
```

## Project Files

VibeSVG の project file は `.vsvg.json` 拡張子を使い、複数ページを含められます。1ページは1つの SVG-equivalent な Geometry AST document に対応します。

Examples:

```txt
examples/playground.vsvg.json
examples/vibesvg.vsvg.json
```

CLI の path resolution は決定的です。

```txt
vibesvg              -> ./vibesvg.vsvg.json
vibesvg logo         -> ./logo.vsvg.json
vibesvg logo.vsvg.json -> ./logo.vsvg.json
```

解決された project file が存在しない場合、CLI はそのファイルを作成して処理を続行します。

## Repository Layout

```txt
apps/
├ cli/  Local host, CLI entrypoint, MCP coordination
└ web/  SvelteKit editor UI

packages/
├ ast/     Geometry AST definitions
├ editor/  Reusable editor interaction logic
├ kernel/  Geometry operations
├ mcp/     MCP server implementation
└ svg/     SVG import/export
```

## README Assets

README 用の画像は `docs/images` に置きます。アプリ実行時の asset は `apps/web/static` に置きます。

現在の README assets:

```txt
docs/images/app-icon.svg
docs/images/vibesvg-demo.gif
docs/images/editor.png
```

## Developer Workflow

依存関係をインストールします。

```sh
pnpm install
```

このリポジトリから VibeSVG を実行します。

```sh
pnpm run build:cli
node apps/cli/dist/index.js my-logo
```

デフォルトの開発用プロジェクトを起動します。

```sh
pnpm run dev
```

開発時のデフォルト:

```txt
Project: examples/playground.vsvg.json
UI:      http://localhost:6201
Host:    ws://localhost:6202/ws
MCP:     http://localhost:6202/mcp
```

公式 VibeSVG icon project を起動します。

```sh
pnpm run dev:icons
```

### Export Icons

icon project を web app の static directory に export します。

```sh
pnpm run export:icons
```

生成された SVG ファイルはここに出力されます。

```txt
apps/web/static/icons
```

同じコマンドを再実行すると、生成済みの icon output は上書きされます。

### Package

公開用の CLI package を build します。

```sh
pnpm run build:cli
```

確認用の npm tarball を作成します。

```sh
pnpm run pack:cli
```

package は `artifacts/npm` に出力され、bundle 済み CLI、build 済み web UI、VibeSVG skills を含みます。
