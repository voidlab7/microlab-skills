---
name: html2pdf
description: 把任意 HTML 报告改造成分页友好版本并用无头 Chrome 一键导出 PDF（自动含背景图形、表格不截断、无留白）。触发词：html 转 pdf、导出 pdf、生成 pdf、打印成 pdf、pdf 分页、pdf 截断、打印样式、打印适配。
---

# html2pdf — HTML 适配 PDF 分页输出 Skill

将任意 HTML 报告转化为分页友好、可直接输出 PDF 的版本，并用无头 Chrome 一键生成 PDF（自动含背景图形，无需手动打开浏览器勾选）。

## 触发条件

当用户提到以下关键词或场景时使用此 Skill：
- `html 转 pdf` / `导出 pdf` / `生成 pdf` / `打印成 pdf`
- `pdf 分页` / `pdf 留白` / `pdf 截断` / `分页不截断`
- `打印样式` / `打印适配` / `html 适配 pdf`
- 用户拿着一个 HTML 报告说"要输出成 PDF"或抱怨"用浏览器打印有留白/表格被切断"
- 用户提到 GoFullPage / 长截图转 PDF 类工具的问题

## 使用方法

```bash
node <skill目录>/scripts/html2pdf.mjs <input.html> [output.pdf]
```

- `input.html`：源 HTML 文件路径（必填）
- `output.pdf`：输出 PDF 路径（可选，默认与输入同名的 .pdf）

脚本会自动完成：检查/注入打印分页 CSS → 无头 Chrome 渲染 → 输出 PDF。幂等：已注入过的不重复注入。

快捷调用（skill 在项目 AIAgent 内）：

```bash
node <技能目录>/scripts/html2pdf.mjs 报告.html
```

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| input.html | 路径 | 是 | 源 HTML |
| output.pdf | 路径 | 否 | 输出路径，默认同名 .pdf |
| --no-inject | 开关 | 否 | 跳过 CSS 注入，直接转 PDF（HTML 已有打印样式时用） |

## 核心逻辑

### 第一步：CSS 适配（脚本自动注入）

注入的打印样式包含三层（沉淀自先进封装报告调优实践）：

1. **分页规则**（防截断）
   - `@page { size: A4; margin: 12mm }`
   - 块级元素 `break-inside: avoid`：table / figure / .card / .summary / svg / img 等整块不跨页
   - `tr { break-inside: avoid }` + `thead { display: table-header-group }`：大表格逐行保护、表头每页重复
   - `h2/h3/h4 { break-after: avoid }`：标题不孤行
   - **`* { print-color-adjust: exact }`：强制输出背景色**——这是无头 Chrome 免勾选"背景图形"的关键
2. **排版放大**（防空白，目标每页 80%+）
   - `@media print` 下整体字号 11→13px、单元格 padding 加大、行距 1.75
   - 源文件已有的 `@media print` 块不会被覆盖（注入只补缺失部分）
3. **不注入强制分页点**——`.page-break` 类留给用户自己按需添加，默认让内容自然流动（强制分页是留白元凶）

### 第二步：ECharts / JS 图表自适应（若源文件含 ECharts）

检查三点，缺则修复：
- `.chart-container` 或图表容器是否有 `width: 100%`（防 canvas 默认 800px 溢出）
- 每个 `echarts.init` 后是否紧跟 `chart.resize()`
- 文件末尾是否有 `window.addEventListener('resize', ...)`

无头打印场景下 canvas 按初始布局渲染，`resize()` 保证渲染尺寸 = 容器尺寸。

### 第三步：无头 Chrome 输出 PDF

```bash
"$CHROME" --headless --disable-gpu --virtual-time-budget=10000 \
  --no-pdf-header-footer --print-to-pdf="$OUTPUT" "file://$INPUT"
```

- `--virtual-time-budget=10000`：快进页面 JS（等 ECharts 渲染完成）
- `--no-pdf-header-footer`：去掉页眉页脚
- Chrome 路径按序探测：环境变量 `CHROME_PATH` → `/Applications/Google Chrome.app/...` → `chromium` → `google-chrome`
- 背景/底色由第一步注入的 `print-color-adjust: exact` 保证，无需浏览器勾选

## 输出格式

- 输出 PDF 文件（A4、含背景色、分页不截断）
- 若发生了 CSS/JS 注入，会同时保存修改后的 HTML（源文件就地更新，PDF 基于更新后的版本）
- 控制台输出：注入了什么、Chrome 路径、PDF 输出路径

## AI 分析提示

- 执行后**必须实际检查产物**：用 `ls -la` 确认 PDF 生成、文件大小合理（几百 KB 以上说明图表渲染成功）
- 用户反馈"某页留白多/被截断"时，定位该页对应的 HTML 区块，针对性调整 `@media print` 里该区块的字号/间距，而不是全局重调
- 若 HTML 是在线文章或含远程图片，提醒用户网络需可访问；`--virtual-time-budget` 已给 10 秒预算
- 若用户还需要"某章独立起页"，指导其在章节间插入 `<div style="page-break-after: always"></div>`，不要全局加

## 关联资源

- `scripts/html2pdf.mjs`：一键转换脚本（CSS 注入 + Chrome 调用）
- 实战场景：含 ECharts 图表的多页分析报告（分页 CSS + 图表自适应已完整落地）
- 建议自建一份含分页 CSS 的空白模板，随项目沉淀复用
