#!/usr/bin/env node
/**
 * html2pdf.mjs — HTML 报告一键转 PDF（分页适配 + 背景色 + 无头 Chrome）
 *
 * 用法:
 *   node html2pdf.mjs <input.html> [output.pdf] [--no-inject]
 *
 * 流程:
 *   1. 检查 HTML 是否已有打印分页样式（@media print + print-color-adjust）
 *      缺失则注入沉淀的 CSS（分页规则 + 排版放大 + 背景色强制）
 *   2. 无头 Chrome 生成 PDF（--print-to-pdf，等价于手动"另存为 PDF"+勾选背景图形）
 *
 * 幂等: 重复运行不会重复注入。
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const args = process.argv.slice(2).filter(a => a !== '--no-inject');
const noInject = process.argv.includes('--no-inject');

if (args.length < 1) {
  console.error('用法: node html2pdf.mjs <input.html> [output.pdf] [--no-inject]');
  process.exit(1);
}

const input = resolve(args[0]);
const output = resolve(args[1] || input.replace(/\.html?$/i, '.pdf'));
if (!existsSync(input)) {
  console.error(`输入文件不存在: ${input}`);
  process.exit(1);
}

let html = readFileSync(input, 'utf-8');
let injected = [];

/* ---------- 第一步: 注入打印 CSS（幂等） ---------- */
const PRINT_CSS = `
<style>
/* ===== html2pdf skill 注入: 打印分页规则 v1.0 ===== */
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .page-break { border-bottom: none; margin: 0; height: 0; page-break-after: always; break-after: page; }
  table, figure, .chart-container, .explain-box, .card, .summary, svg, img {
    break-inside: avoid; page-break-inside: avoid;
  }
  tr { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  h2, h3, h4 { break-after: avoid; page-break-after: avoid; break-inside: avoid; }
  p, li { break-inside: avoid; }
}
@page { size: A4; margin: 12mm; }
/* ===== 注入结束 ===== */
</style>
`;

const ENLARGE_CSS = `
<style>
/* ===== html2pdf skill 注入: 打印排版放大 v1.0 ===== */
@media print {
  body { line-height: 1.75; font-size: 13px; }
  .section h2 { font-size: 21px; padding-bottom: 10px; margin-bottom: 18px; }
  .section h3 { font-size: 16.5px; margin: 20px 0 12px; }
  .section h4 { font-size: 15px; margin: 16px 0 10px; }
  .section { margin-bottom: 28px; }
  table { font-size: 13px; }
  th, td { padding: 11px 13px; }
  table.compact th, table.compact td { padding: 9px 10px; font-size: 12px; }
  ul, ol { font-size: 13px; margin: 10px 0 10px 24px; }
  li { margin: 5px 0; }
  .summary { padding: 18px; margin: 18px 0; }
  .summary p { font-size: 13px; margin: 7px 0; line-height: 1.85; }
  p.note { font-size: 13px; line-height: 2.0; margin: 12px 0; }
  .explain-box { padding: 16px 18px; margin: 14px 0; }
  .card { padding: 15px; margin: 13px 0; }
  figcaption { font-size: 12px; margin-top: 8px; }
}
/* ===== 注入结束 ===== */
</style>
`;

if (!noInject) {
  if (!/print-color-adjust/i.test(html)) {
    html = html.replace(/<\/head>/i, PRINT_CSS + '</head>');
    injected.push('分页规则+背景色');
  }
  // 排版放大只在没有任何 @media print 时注入（避免覆盖用户已有调优）
  if (!/@media\s+print/i.test(html.replace(PRINT_CSS, ''))) {
    html = html.replace(/<\/head>/i, ENLARGE_CSS + '</head>');
    injected.push('排版放大');
  }
  // chart 容器宽度自适应检查
  if (/echarts/i.test(html) && !/\.chart-container[^}]*width:\s*100%/.test(html)) {
    html = html.replace('</head>',
      '<style>.chart-container { width: 100% !important; }</style></head>');
    injected.push('图表容器宽度');
  }
  if (injected.length) {
    writeFileSync(input, html);
    console.log(`[inject] 已注入: ${injected.join(', ')} → ${basename(input)}`);
  } else {
    console.log('[inject] 打印样式已存在，跳过注入');
  }
}

/* ---------- 第二步: 探测 Chrome ---------- */
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);
const chrome = candidates.find(p => existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Chromium。可设置环境变量 CHROME_PATH 指定路径。');
  process.exit(1);
}

/* ---------- 第三步: 无头输出 PDF ---------- */
const fileUrl = 'file://' + input.replace(/\s/g, '%20');
console.log(`[chrome] ${chrome}`);
console.log(`[render] ${fileUrl}`);
try {
  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--virtual-time-budget=10000',
    '--no-pdf-header-footer',
    `--print-to-pdf=${output}`,
    fileUrl,
  ], { stdio: 'pipe', timeout: 60000 });
} catch (e) {
  console.error('Chrome 渲染失败:', e.message);
  process.exit(1);
}

if (!existsSync(output)) {
  console.error('PDF 未生成（Chrome 静默失败），请检查 HTML 是否能正常打开。');
  process.exit(1);
}
console.log(`[done] ${output}`);
