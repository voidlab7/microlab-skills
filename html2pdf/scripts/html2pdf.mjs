// html2pdf.mjs — 用本机 Chrome 内核把 HTML 高保真打印成 PDF
//
// 用法:
//   node html2pdf.mjs <input.html> <output.pdf> [选项]
//
// 选项:
//   --margin "18mm 15mm"        上下 左右 页边距（默认 "18mm 15mm"）
//   --size "2400px 1350px"      单页画布模式：纸张=该尺寸、页边距 0、只出第 1 页
//                               （用于海报/全景图等固定画布 HTML）
//
// 渲染路径（自动选择）:
//   1. puppeteer 可用（当前目录或上级 node_modules 里装过）→ 完整控制
//   2. 否则退回 Chrome headless CLI --print-to-pdf（功能等价，边距经注入 @page 实现）
//
// Chrome 探测顺序: $CHROME_PATH → macOS 常见路径 → Windows/Linux 常见路径。
import { resolve, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const [html, out] = positional;
if (!html || !out) {
  console.error('用法: node html2pdf.mjs <input.html> <output.pdf> [--margin "18mm 15mm"] [--size "2400px 1350px"]');
  process.exit(1);
}
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const margin = opt('margin', '18mm 15mm');      // "上下 左右"
const size = opt('size', null);                  // 单页画布模式 "2400px 1350px"
const [mTB, mLR] = margin.split(/\s+/);

// ---- 找 Chrome ----
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  // 兜底：puppeteer 自带的 chrome-headless-shell / chrome（npm i puppeteer 时自动下载）
  // 缓存结构为 <root>/<family>/<platform-ver>/<嵌套目录>/<二进制>，按文件名递归浅扫
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const NAMES = new Set(['chrome-headless-shell', 'chrome-headless-shell.exe', 'chrome', 'chrome.exe']);
  const walk = (dir, depth) => {
    if (depth < 0) return null;
    for (const name of readdirSyncSafe(dir)) {
      const p = join(dir, name);
      if (NAMES.has(name) && existsSync(p)) return p;
      const deeper = walk(p, depth - 1);
      if (deeper) return deeper;
    }
    return null;
  };
  for (const root of [process.env.PUPPETEER_CACHE_DIR, join(home, '.cache', 'puppeteer')].filter(Boolean)) {
    for (const fam of ['chrome-headless-shell', 'chrome']) {
      const hit = walk(join(root, fam), 4);
      if (hit) return hit;
    }
  }
  return null;
}
function readdirSyncSafe(p) { try { return readdirSync(p); } catch { return []; } }
const chrome = findChrome();
if (!chrome) {
  console.error(`[html2pdf] 未找到可用的 Chrome 内核。三条路任选其一：
  1) 安装 Chrome / Edge（Windows 通常自带 Edge，已自动探测）
  2) 设环境变量 CHROME_PATH=<浏览器可执行文件路径>
  3) 让 puppeteer 自带无头内核（无需安装浏览器）：
     npm i puppeteer   # 安装时会自动下载 chrome-headless-shell，本脚本下次运行自动识别`);
  process.exit(1);
}

const htmlAbs = resolve(html);
if (!existsSync(htmlAbs)) { console.error('[html2pdf] 输入不存在: ' + htmlAbs); process.exit(1); }

// ---- 路径 1: puppeteer ----
async function tryPuppeteer() {
  let puppeteer;
  try { puppeteer = (await import('puppeteer')).default; }
  catch { return false; }
  const browser = await puppeteer.launch({ headless: 'new', executablePath: chrome, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    if (size) {
      const [w, h] = size.split(/\s+/).map(s => parseInt(s, 10));
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    }
    await page.goto('file://' + htmlAbs, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));   // 等图表/字体收尾
    if (size) {
      const [w, h] = size.split(/\s+/).map(s => parseInt(s, 10));
      await page.addStyleTag({ content: `@page{size:${w}px ${h}px;margin:0} html,body{margin:0!important;padding:0!important}` });
      await new Promise(r => setTimeout(r, 200));
      await page.pdf({ path: out, width: `${w}px`, height: `${h}px`, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 }, pageRanges: '1' });
    } else {
      await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: mTB, bottom: mTB, left: mLR, right: mLR } });
    }
    return true;
  } finally { await browser.close(); }
}

// ---- 路径 2: Chrome headless CLI（无 puppeteer 时的兜底）----
function cliFallback() {
  // 复制一份注入 @page 规则（不改原文件）
  const tmp = join(tmpdir(), `html2pdf-${Date.now()}.html`);
  const inject = size
    ? `<style>@page{size:${size};margin:0} html,body{margin:0!important;padding:0!important}</style>`
    : `<style>@page{size:A4;margin:${mTB} ${mLR}}</style>`;
  const src = readFileSync(htmlAbs, 'utf-8');
  writeFileSync(tmp, src.replace(/<head[^>]*>/i, m => m + inject));
  try {
    execFileSync(chrome, [
      '--headless', '--disable-gpu', '--no-sandbox',
      '--no-pdf-header-footer', '--virtual-time-budget=5000',
      `--print-to-pdf=${resolve(out)}`, 'file://' + tmp,
    ], { stdio: 'pipe', timeout: 60000 });
  } finally { try { unlinkSync(tmp); } catch {} }
  return true;
}

let ok = false;
try { ok = await tryPuppeteer(); } catch (e) { console.error('[html2pdf] puppeteer 路径失败，退回 CLI：' + e.message); }
if (!ok) cliFallback();
if (!existsSync(resolve(out))) { console.error('[html2pdf] 失败：未生成 ' + out); process.exit(1); }
console.log('[html2pdf] OK: ' + resolve(out) + (size ? ` (单页 ${size})` : ` (A4, 边距 ${margin})`));
