---
name: code-card
display_name: 代码卡片
display_name_en: Code Card
description: >
  将代码渲染为 Carbon 风格的高清代码卡片图片（PNG）。macOS 窗口圆点 + 行号 + 语法高亮 + 3x Retina + 中文清晰。
  双模式：单段代码 → 一张图；Markdown 文章 → 所有代码块批量转图并就地替换。
  自包含设计：本地内嵌 highlight.js（离线可用）、三级浏览器自动探测（playwright 缓存 / 系统 Chrome / 引导安装）、
  确定性文件名（重跑幂等）。当用户说「代码块转图片」「代码截图」「代码卡片」「carbon 图」「代码视图转图片」
  「把代码渲染成图」「把这段代码变成图片」或需要把代码变成美观图片时使用。
description_zh: 把代码渲染成 Carbon 风格的高清代码卡片图。支持单段代码出图与 Markdown 文章批量转换，6 个内置主题加自定义主题，离线可用。
description_en: Render code into Carbon-style retina code card images. Single snippet or batch Markdown conversion, 6 built-in themes plus custom themes, offline-capable.
examples_zh:
  - "把这段代码变成图片"
  - "把这篇文章的代码块转成代码卡片"
  - "代码块转图片，用 nord 主题"
examples_en:
  - "Turn this code snippet into an image"
  - "Convert the code blocks in this article to code cards"
  - "Render my README code blocks as cards with the nord theme"
version: 2.2.0
author: "Microlab（microlab.top）"
---

# Code Card — 代码渲染为 Carbon 风格代码卡片

> **Microlab 出品** · 更多工具与文章：[microlab.top](https://microlab.top)

把 Markdown 文章里的 ` ```代码块``` ` 渲染成 Carbon 风格 PNG，并就地替换为图片引用。ASCII 框线图（`┌─┐└─┘`）自动保持原样。

**两种模式**：
- **文章模式**：输入 `.md` → 所有代码块转图 + 就地替换，输出 `-cards.md`
- **单代码模式**：输入任意代码文件（`.py`/`.js`/`.rs`/...）→ 整个文件渲染成一张 PNG。用户说「把这段代码变成图片」时，agent 把代码存成临时文件（带正确扩展名）再走此模式

**自包含 v2**：highlight.js 已内嵌本地（无 CDN 依赖，离线可用）；不再需要 tsx（纯 node 可跑）；浏览器三级自动探测（通常零下载）。

## 执行工序（AI 按此顺序执行，用户零操作）

### Step 1 — 渲染

```bash
cd <装了 playwright 的目录>   # 没有就先做 Step 2
node <skill目录>/scripts/code-card.mjs <文章绝对路径> --theme dracula
```

脚本自动完成：解析 playwright → 三级浏览器探测启动 → 渲染 → 就地替换。

### Step 2 — 补齐依赖（仅在脚本报「无法解析 playwright」时）

**浏览器通常不需要下载**（系统 Chrome 即可驱动）：

```bash
npm install playwright   # 仅 npm 包，约 5 秒，不下载浏览器；然后在该目录重跑 Step 1
```

| 环境层级 | 条件 | 动作 |
|---|---|---|
| L1 | playwright 自带 chromium 缓存 | 直接用 |
| L2 | 系统装了 Chrome/Edge/Chromium | 直接用（**最常见，零下载**） |
| L3 | 都没有 | `npx playwright install chromium-headless-shell`（约 92MB，一次性） |

### Step 3 — 验证与回写（文章模式）

1. 读输出的 `<原名>-cards.md`：确认框图保留为 ```text、代码块已变 `![]()` 引用
2. 用 `-cards.md` 覆盖原文章，删除中间文件
3. 向用户报告：转了几张图、跳过几个框图、图片目录路径

**单代码模式**：脚本直接打印 PNG 路径，agent 展示该图片给用户即可。

**脚本不覆盖原文件**（文章模式输出到 `-cards.md`），回写由 AI 显式执行，安全可控。

参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `<input>` | 是 | `.md` 文章（文章模式）或任意代码文件（单代码模式） |
| `--theme <name>` | 否 | `dracula`（默认）/ `one-dark` / `monokai` / `paraiso` / `vscode` / `nord` |
| `--theme-file <json>` | 否 | 自定义主题文件（JSON，见下） |
| `--include-box-art` | 否 | 强制转换 ASCII 框图（默认跳过，仅文章模式） |
| `--out <png>` | 否 | 输出路径（仅单代码模式，默认 `<原文件名>-carbon.png`） |
| `--lang <lang>` | 否 | 覆盖语言推断（仅单代码模式，默认按扩展名：py→python、rs→rust 等） |

## 自定义主题

`--theme-file` 接受 JSON 文件，两种格式皆可：

```json
// 格式一：命名主题表
{ "my-theme": { "background": "#0b2545", "text": "#e8f1f8", "keyword": "#7fdbff", "...": "共 13 个颜色字段" } }

// 格式二：单主题对象直接给（配合 --theme 任意名）
{ "background": "#0b2545", "text": "#e8f1f8", "comment": "...", "keyword": "...", "string": "...",
  "number": "...", "property": "...", "variable": "...", "operator": "...", "function": "...",
  "meta": "...", "titleBar": "...", "lineNumber": "..." }
```

13 个字段缺一不可。macOS 三圆点颜色固定，不随主题变。

## 代码块分类（AI 需判断）

| 类型 | 特征 | 处理 |
|------|------|------|
| 真正的代码 | python/js/bash 等语言块；目录树（`├──`）；流程（`→`） | 转图 |
| ASCII 框图 | `┌───┐` 顶边 + `└───┘` 底边同时出现 | 保持原样 |

含 ≥2 行 `→` 的 text 块自动启用 dual-color 模式（箭头左彩右白，适合「接口-说明」映射）。
mermaid/plantuml/graphviz/dot 语言块自动跳过。

## 输出

- 图片目录：文章同级 `<前缀>-code-images/`，文件名 `code-N-<lang>-<hash8>.png`（**内容哈希，重跑幂等，不堆重复图**）
- 新文章：`<原名>-cards.md`
- 文章移动时图片目录要一起移；如需发布到公众号，可配合 CDN 上传脚本替换为 CDN URL

## 故障排查

| 症状 | 原因 | 修复 |
|---|---|---|
| `无法解析 playwright` | 运行目录没有 playwright | `npm install playwright` 后在该目录运行 |
| `无可用浏览器` | 三级链全空 | `npx playwright install chromium-headless-shell` 或安装 Chrome |
| 中文乱码 | 系统缺中文字体 | 安装系统中文字体（桌面环境默认都有） |
| `theme not found` | --theme-file 里没有该键名 | 检查 JSON 键名，或改用单主题对象格式 |

## 浏览器链自测（可选，排查用）

```bash
node <skill目录>/scripts/launch-browser.mjs --selftest
```

---

*Microlab 出品 · 官网 [microlab.top](https://microlab.top) · 公众号 MicroLabV*
