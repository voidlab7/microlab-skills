---
name: html-to-pdf-chrome
display_name: "HTML 转 PDF（高保真渲染）"
display_name_en: "HTML to PDF (High-Fidelity)"
description: "把本地 HTML 用真实 Chromium 内核打印管线高保真转成 PDF：中文、SVG/Canvas 图表、Grid/Flex 布局、JS 动态图表（ECharts 等）全部所见即所得，输出矢量文字 PDF（可选中可搜索）。不是截图。支持 A4 流式文档与固定画布单页（海报/全景图/大屏卡片）两种模式；零安装依赖，自动探测系统 Chrome/Edge。"
description_zh: "用本机 Chrome 内核把本地 HTML 高保真转成 PDF：真实浏览器渲染，中文、图表、Grid/Flex 布局、JS 动态图表全部所见即所得，输出矢量文字 PDF。支持 A4 多页流式文档和固定画布单页两种模式，零安装依赖。"
description_en: "Convert local HTML to high-fidelity PDF via the real Chrome rendering engine - CJK text, SVG/Canvas charts, Grid/Flex layouts and JS-driven charts render exactly as in a browser. Outputs vector, selectable-text PDF. A4 flowing documents and fixed-canvas single-page mode. Zero-install."
examples_zh:
  - "把这个 HTML 报告转成 PDF"
  - "这张海报导出成单页 PDF"
  - "网页转 PDF，中文别乱码"
examples_en:
  - "Convert this HTML report to PDF"
  - "Export this poster as a single-page PDF"
  - "Turn this page into a PDF without broken CJK glyphs"
version: "2.0.0"
author: "Microlab（microlab.top）"
---

# HTML 转 PDF（高保真渲染）

> **Microlab 出品** · 更多工具与文章：[microlab.top](https://microlab.top)

## Overview

把本地 HTML 转成 PDF，渲染引擎是**本机真实 Chrome**（不是 weasyprint 这类纯 CSS 引擎）。
因此 JS 会执行、字体用系统字体栈（macOS 的 PingFang 等）、Grid/Flex/SVG/Canvas 全部按浏览器语义渲染——
转换结果就是「在浏览器里看到的样子」。

**高保真的含义**：不是截图，是原生矢量 PDF——文字可选中、可搜索、放大不糊，打印不发虚。

脚本零安装依赖：有 puppeteer 用 puppeteer（控制最全），没有则自动退回 Chrome headless CLI，产物等价。
渲染内核自动探测：本机 Chrome/Chromium/Edge（Windows 自带 Edge）→ puppeteer 自带的 chrome-headless-shell（`npm i puppeteer` 即得，无需装浏览器）。

## 快速开始

```bash
node <skill_dir>/scripts/html2pdf.mjs <input.html> <output.pdf>
```

- 默认 A4 多页流式文档，页边距上下 18mm / 左右 15mm。
- 用 `node` 直接跑即可；脚本内自动探测 Chrome（`$CHROME_PATH` → macOS/Windows/Linux 常见安装路径）。

### 两种模式

| 模式 | 触发 | 行为 |
|---|---|---|
| A4 流式文档（默认） | 不传 --size | A4 纸张、自动分页、页边距可调 `--margin "14mm 12mm"` |
| 单页画布 | `--size "2400px 1350px"` | 纸张=画布尺寸、边距 0、只出第 1 页。用于海报/全景图/大屏卡片等固定尺寸 HTML |

判断用哪个模式：HTML 里有固定像素画布（如 `#stage{width:2400px;height:1350px}`）→ 单页模式，尺寸从 CSS 里读；普通流式排版的文章/报告 → 默认 A4。

### 常用示例

```bash
# 报告文档 → A4 PDF
node scripts/html2pdf.mjs report.html report.pdf

# 调页边距
node scripts/html2pdf.mjs report.html report.pdf --margin "20mm 20mm"

# 海报/全景图（固定画布）→ 单页矢量 PDF
node scripts/html2pdf.mjs poster.html poster.pdf --size "1080px 1440px"
```

## 转换后必须目检（勿跳过）

转换完成不代表渲染正确。每次交付前抽查：

```bash
# macOS：渲染首页为图片
sips -s format png <output.pdf> --out /tmp/pdf-p1.png
# 有 pdftoppm 则更灵活（可指定页码范围）
pdftoppm -png -r 60 -f 1 -l 2 <output.pdf> /tmp/chk
```

然后用 Read 工具查看图片，确认：① 中文无豆腐块；② 图表/图形完整渲染；③ 首页无截断、留白正常。
页数校验可用 pypdf 读 `len(PdfReader(p).pages)`。

## 为什么不用 weasyprint（排障参考）

若用户之前用 weasyprint 类工具转出来「中文乱码/豆腐块、数字错位、布局散架」，根因是：

1. **不执行 JS**——ECharts 等 JS 图表直接空白；
2. **Grid/Flex 支持残缺**——现代网页布局被拆散；
3. **字体栈写死 Linux**（如 Noto Sans CJK SC）——macOS/Windows 上没有该字体就 fallback 成豆腐块；
4. 依赖 cairo/pango 原生库，版本组合脆弱。

本 skill 走真实 Chrome 渲染，上述问题全部不存在。不要「修复」weasyprint 路线的产物，直接换本 skill 重转。

## 环境要求与排障

| 情况 | 处理 |
|---|---|
| 找不到 Chrome | 三条路：① 装 Chrome（Windows 一般自带 Edge，已自动探测）；② `export CHROME_PATH=<浏览器路径>`；③ `npm i puppeteer`（安装时自动下载 chrome-headless-shell 无头内核，脚本下次运行自动识别） |
| 有 puppeteer | 自动使用（从当前工作目录的 node_modules 解析）；控制最全 |
| 无 puppeteer | 自动退回 Chrome headless CLI，产物等价 |
| JS 图表渲染不全 | 脚本已等 networkidle0 + 300ms；仍不全则把等待调长（改脚本里 300 为 1000） |
| 中文文件名 | 直接支持，无需特殊处理 |

## Resources

### scripts/
- `html2pdf.mjs`：主转换脚本。A4 流式 + 单页画布双模式，Chrome 自动探测，puppeteer/CLI 双路径兜底。

---

*Microlab 出品 · 官网 [microlab.top](https://microlab.top) · 公众号 MicroLabV*
