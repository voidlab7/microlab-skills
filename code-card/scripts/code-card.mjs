#!/usr/bin/env node
/**
 * code-card.mjs — Carbon 风格代码卡片生成器（自包含版，v2）
 *
 * 基于.renderer-base 基座：三级浏览器启动链 + 本地 highlight.js（零 CDN、零 tsx 依赖）。
 *
 * 用法:
 *   node code-card.mjs <input.md> [--theme dracula] [--theme-file <themes.json>] [--include-box-art]
 *
 * 环境要求（agent 会按 SKILL.md 工序自动补齐）:
 *   - node >= 18
 *   - playwright 可解析（在装了 playwright 的目录运行，或设 NODE_PATH/RENDERER_NODE_MODULES）
 *   - 浏览器：playwright 缓存 或 系统 Chrome 任一（launch-browser.mjs 自动逐级探测）
 *
 * 对标 carbon.now.sh：macOS 窗口圆点 + 行号 + highlight.js 语法高亮 + 3x Retina + 中文清晰。
 * 确定性产物：文件名 = code-N-<lang>-<内容hash8>.png，重跑幂等，不堆重复图。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchBest, resolvePlaywright } from "./launch-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 主题 ──

const MACOS_COLORS = { red: "#FF5F56", yellow: "#FFBD2E", green: "#27C93F" };

const THEMES = {
  dracula: {
    background: "#282a36", text: "#f8f8f2", comment: "#6272a4", keyword: "#ff79c6",
    string: "#f1fa8c", number: "#bd93f9", property: "#66d9ef", variable: "#50fa7b",
    operator: "#ff79c6", "function": "#50fa7b", meta: "#f8f8f2", titleBar: "#21222c", lineNumber: "#6272a4",
  },
  "one-dark": {
    background: "#282c34", text: "#abb2bf", comment: "#5c6370", keyword: "#c678dd",
    string: "#98c379", number: "#d19a66", property: "#e06c75", variable: "#e06c75",
    operator: "#56b6c2", "function": "#61afef", meta: "#abb2bf", titleBar: "#21252b", lineNumber: "#636d83",
  },
  monokai: {
    background: "#272822", text: "#f8f8f2", comment: "#75715e", keyword: "#f92672",
    string: "#e6db74", number: "#ae81ff", property: "#a6e22e", variable: "#f8f8f2",
    operator: "#f92672", "function": "#a6e22e", meta: "#66d9ef", titleBar: "#1e1f1c", lineNumber: "#75715e",
  },
  paraiso: {
    background: "#2f1e2e", text: "#b9b6b0", comment: "#e96ba8", keyword: "#ef6155",
    string: "#fec418", number: "#815ba4", property: "#48b685", variable: "#48b685",
    operator: "#ef6155", "function": "#f99b15", meta: "#815ba4", titleBar: "#261827", lineNumber: "#776e71",
  },
  vscode: {
    background: "#1E1E1E", text: "#D4D4D4", comment: "#6A9955", keyword: "#C586C0",
    string: "#CE9178", number: "#B5CEA8", property: "#DCDCAA", variable: "#9CDCFE",
    operator: "#D4D4D4", "function": "#DCDCAA", meta: "#569cd6", titleBar: "#191919", lineNumber: "#858585",
  },
  nord: {
    background: "#2e3440", text: "#d8dee9", comment: "#616e88", keyword: "#81a1c1",
    string: "#a3be8c", number: "#b48ead", property: "#8fbcbb", variable: "#d8dee9",
    operator: "#81a1c1", "function": "#88c0d0", meta: "#5e81ac", titleBar: "#3b4252", lineNumber: "#4c566a",
  },
};

function loadTheme(name, themeFile) {
  if (themeFile) {
    const custom = JSON.parse(fs.readFileSync(themeFile, "utf-8"));
    // 自定义文件可以是 { "my-theme": {...} } 或单个主题对象
    const t = custom[name] || (Object.keys(custom).length === 1 ? custom[Object.keys(custom)[0]] : null);
    if (!t) throw new Error(`theme "${name}" not found in ${themeFile}`);
    return t;
  }
  return THEMES[name] || THEMES.dracula;
}

function generateHighlightCSS(t) {
  return `
    .hljs { color: ${t.text}; background: transparent; }
    .hljs-comment, .hljs-quote { color: ${t.comment}; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-type { color: ${t.keyword}; }
    .hljs-string, .hljs-addition { color: ${t.string}; }
    .hljs-number, .hljs-literal { color: ${t.number}; }
    .hljs-title, .hljs-section { color: ${t.function}; }
    .hljs-built_in, .hljs-attr, .hljs-attribute { color: ${t.property}; }
    .hljs-variable, .hljs-template-variable { color: ${t.variable}; }
    .hljs-operator, .hljs-punctuation { color: ${t.operator}; }
    .hljs-meta, .hljs-tag { color: ${t.meta}; }
    .hljs-regexp, .hljs-link { color: ${t.string}; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: bold; }
    .hljs-name { color: ${t.property}; }
    .hljs-params { color: ${t.variable}; }
    .hljs-selector-class, .hljs-selector-id { color: ${t.variable}; }
    .hljs-bullet, .hljs-symbol { color: ${t.property}; }
  `;
}

// ── HTML 模板（本地 hljs 内嵌，无任何网络请求）──

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(code, language, theme, hljsSource) {
  const langClass = language && language !== "text" ? `language-${language}` : "nohighlight";

  const hasArrowPattern = code.split("\n").filter((l) => l.includes("→")).length >= 2;
  const escaped = hasArrowPattern
    ? code
        .split("\n")
        .map((line) => {
          const arrowIdx = line.indexOf("→");
          if (arrowIdx === -1) return escapeHtml(line);
          return (
            `<span style="color:${theme.variable}">${escapeHtml(line.slice(0, arrowIdx))}</span>` +
            `<span style="color:${theme.lineNumber}">${escapeHtml("→")}</span>` +
            `<span style="color:${theme.text}">${escapeHtml(line.slice(arrowIdx + 1))}</span>`
          );
        })
        .join("\n")
    : escapeHtml(code);

  // 内嵌 hljs：防御 </script> 提前闭合
  const hljsInline = hljsSource.replace(/<\/script/gi, "<\\/script");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 14px; line-height: 1.7; background: transparent;
  -webkit-font-smoothing: antialiased;
}
.card { display: inline-block; background: ${theme.background}; border-radius: 12px; overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2); }
.title-bar { display: flex; align-items: center; height: 44px; padding: 0 16px;
             background: ${theme.titleBar}; border-bottom: 1px solid rgba(255,255,255,0.05); }
.dots { display: flex; gap: 8px; align-items: center; }
.dot { width: 12px; height: 12px; border-radius: 50%; }
.dot-red { background: ${MACOS_COLORS.red}; }
.dot-yellow { background: ${MACOS_COLORS.yellow}; }
.dot-green { background: ${MACOS_COLORS.green}; }
.code-area { display: flex; padding: 20px 16px; min-width: 200px; }
.line-numbers { user-select: none; text-align: right; padding-right: 16px;
                color: ${theme.lineNumber}; opacity: 0.6; min-width: 28px; }
.line-num { line-height: 1.7; font-size: 14px; }
.code-content { flex: 1; overflow: visible; }
.code-content pre { margin: 0; background: transparent !important; white-space: pre; color: ${theme.text}; }
.code-content code { font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Consolas', monospace;
                     font-size: 14px; line-height: 1.7; color: ${theme.text}; }
${generateHighlightCSS(theme)}
</style>
</head>
<body>
<div class="card" id="card">
  <div class="title-bar">
    <div class="dots">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
    </div>
  </div>
  <div class="code-area">
    <div class="line-numbers" id="line-nums"></div>
    <div class="code-content">
      <pre><code class="${langClass}">${escaped}</code></pre>
    </div>
  </div>
</div>
<script>${hljsInline}</script>
<script>
if (${JSON.stringify(language || "")} && ${JSON.stringify(language || "")} !== 'text') {
  hljs.highlightElement(document.querySelector('code'));
}
const codeEl = document.querySelector('code');
const lineCount = (codeEl.textContent || '').split('\\n').length;
const numsEl = document.getElementById('line-nums');
for (let i = 1; i <= lineCount; i++) {
  const num = document.createElement('div');
  num.className = 'line-num';
  num.textContent = String(i);
  numsEl.appendChild(num);
}
</script>
</body>
</html>`;
}

// ── Markdown 扫描 ──

function isBoxArt(source) {
  return /┌[─━]{2,}┐/.test(source) && /└[─━]{2,}┘/.test(source);
}

function scanCodeBlocks(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  const DIAGRAM_LANGS = new Set(["mermaid", "plantuml", "graphviz", "dot"]);
  let inBlock = false, blockStart = -1, blockLines = [], currentLang = "";
  const fenceStart = /^```(\w+)?\s*$/;
  const fenceEnd = /^```\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      const m = line.match(fenceStart);
      if (m) {
        const lang = m[1] || "text";
        if (!DIAGRAM_LANGS.has(lang.toLowerCase())) {
          inBlock = true; blockStart = i; blockLines = []; currentLang = lang;
        }
      }
    } else {
      if (fenceEnd.test(line) && blockLines.length > 0) {
        blocks.push({ language: currentLang, source: blockLines.join("\n"), startLine: blockStart, endLine: i });
        inBlock = false; blockStart = -1; blockLines = [];
      } else if (!fenceEnd.test(line)) {
        blockLines.push(line);
      }
    }
  }
  return blocks;
}

// ── 语言扩展名映射（单代码文件模式用）──

const EXT_LANG = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript",
  tsx: "typescript", jsx: "javascript", rs: "rust", go: "go", sh: "bash", bash: "bash",
  zsh: "bash", json: "json", yaml: "yaml", yml: "yaml", html: "xml", xml: "xml",
  css: "css", scss: "scss", java: "java", c: "c", h: "c", cpp: "cpp", cc: "cpp",
  hpp: "cpp", rb: "ruby", php: "php", sql: "sql", kt: "kotlin", swift: "swift",
  md: "markdown", toml: "ini", ini: "ini", diff: "diff", lua: "lua", r: "r",
};

// ── 单代码文件模式：一个源文件 → 一张 PNG ──

async function renderSingleFile({ inputPath, theme, themeName, pw, outOverride, langOverride }) {
  const code = fs.readFileSync(inputPath, "utf-8").replace(/\n$/, "");
  const ext = path.extname(inputPath).slice(1).toLowerCase();
  const language = langOverride || EXT_LANG[ext] || "text";
  const hljsSource = fs.readFileSync(path.join(__dirname, "highlight.min.js"), "utf-8");

  const { browser, tier, kind } = await launchBest(pw);
  console.log(`🌐 Browser: [${tier}] ${kind}`);

  const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 1200, height: 2000 } });
  const page = await context.newPage();

  const html = buildHtml(code, language, theme, hljsSource);
  const tmpHtml = path.join(path.dirname(outOverride || inputPath), `_tmp_carbon_${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html);

  try {
    await page.goto(`file://${tmpHtml}`, { waitUntil: "load", timeout: 15000 });
    await page.waitForFunction(() => window.hljs && document.querySelectorAll(".line-num").length > 0, { timeout: 5000 }).catch(() => {});
    const card = page.locator("#card");
    if (!(await card.boundingBox())) {
      throw new Error("Failed to locate card element");
    }
    const outPath = path.resolve(outOverride || path.join(path.dirname(inputPath), `${path.basename(inputPath)}-carbon.png`));
    await card.screenshot({ path: outPath, type: "png", omitBackground: true });
    const stat = fs.statSync(outPath);
    console.log(`\n✅ Done!`);
    console.log(`🖼  PNG: ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    console.log(`📝 Code: ${inputPath} [${language}] · Theme: ${themeName}`);
  } finally {
    await page.close();
    await browser.close();
    fs.unlinkSync(tmpHtml);
  }
}

// ── 主流程 ──

async function main() {
  const args = process.argv.slice(2);
  const themeIdx = args.indexOf("--theme");
  const themeName = themeIdx >= 0 ? args[themeIdx + 1] : "dracula";
  const themeFileIdx = args.indexOf("--theme-file");
  const themeFile = themeFileIdx >= 0 ? args[themeFileIdx + 1] : null;
  const includeBoxArt = args.includes("--include-box-art");
  const inputFile = args.find((a) => !a.startsWith("--"));

  if (!inputFile) {
    console.error("Usage: node code-card.mjs <input.md | code.file> [--theme <name>] [--theme-file <json>] [--include-box-art] [--out <png>] [--lang <lang>]");
    process.exit(1);
  }

  // 1. 解析 playwright（给出可执行的修复指引）
  const pw = resolvePlaywright();
  if (!pw) {
    console.error(
      "❌ 无法解析 playwright 模块。修复（任选其一）：\n" +
        "  a) 在装了 playwright 的项目目录下运行本脚本\n" +
        "  b) 新建工作目录并执行: npm install playwright\n" +
        "  c) 设置 RENDERER_NODE_MODULES 指向含 playwright 的 node_modules",
    );
    process.exit(1);
  }
  const theme = loadTheme(themeName, themeFile);

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  // 单代码文件模式：输入不是 .md → 直接把整个文件渲染成一张图
  const outIdx = args.indexOf("--out");
  const outOverride = outIdx >= 0 ? args[outIdx + 1] : null;
  const langIdx = args.indexOf("--lang");
  const langOverride = langIdx >= 0 ? args[langIdx + 1] : null;

  if (path.extname(inputPath).toLowerCase() !== ".md") {
    await renderSingleFile({ inputPath, theme, themeName, pw, outOverride, langOverride, hljsSourceRef: null });
    return;
  }

  const markdown = fs.readFileSync(inputPath, "utf-8");
  const allBlocks = scanCodeBlocks(markdown);
  const boxArtCount = allBlocks.filter((b) => isBoxArt(b.source)).length;
  const blocks = includeBoxArt ? allBlocks : allBlocks.filter((b) => !isBoxArt(b.source));

  console.log(`\n📄 Input: ${inputPath}`);
  console.log(`🎨 Theme: ${themeName}${themeFile ? ` (from ${themeFile})` : ""}`);
  console.log(`📦 Found ${allBlocks.length} code blocks` + (includeBoxArt ? "" : ` (skipping ${boxArtCount} ASCII box-art)`));

  if (blocks.length === 0) {
    console.log("No code blocks to process.");
    return;
  }

  // 2. 三级浏览器启动链
  const { browser, tier, kind, executable } = await launchBest(pw);
  console.log(`🌐 Browser: [${tier}] ${kind}`);
  console.log(`📦 Processing ${blocks.length} blocks\n`);

  // 3. 输出布局（与 v1 兼容：<prefix>-code-images/ + -cards.md）
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const articlePrefix = base.match(/^(\d{2})/)?.[1] || "xx";
  const imagesDirName = `${articlePrefix}-code-images`;
  const imagesDir = path.join(path.dirname(inputPath), imagesDirName);
  fs.mkdirSync(imagesDir, { recursive: true });

  const hljsSource = fs.readFileSync(path.join(__dirname, "highlight.min.js"), "utf-8");
  const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 1200, height: 2000 } });

  const lines = markdown.split("\n");
  const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);

  for (const [idx, block] of sortedBlocks.entries()) {
    const blockNum = blocks.length - idx;
    const langLabel = block.language || "text";
    const lineCount = block.source.split("\n").length;
    console.log(`  [${blockNum}/${blocks.length}] ${langLabel} (${lineCount} lines)`);

    // 确定性文件名：内容 hash，重跑幂等
    const hash = crypto.createHash("sha1").update(`${themeName}\u0000${langLabel}\u0000${block.source}`).digest("hex").slice(0, 8);
    const pngFilename = `code-${blockNum}-${langLabel}-${hash}.png`;
    const pngPath = path.join(imagesDir, pngFilename);

    const html = buildHtml(block.source, block.language, theme, hljsSource);
    const tmpHtml = path.join(imagesDir, `_tmp_${blockNum}.html`);
    fs.writeFileSync(tmpHtml, html);

    const page = await context.newPage();
    try {
      await page.goto(`file://${tmpHtml}`, { waitUntil: "load", timeout: 15000 });
      await page.waitForFunction(() => window.hljs && document.querySelectorAll(".line-num").length > 0, { timeout: 5000 }).catch(() => {});
      const card = page.locator("#card");
      const box = await card.boundingBox();
      if (box) {
        await card.screenshot({ path: pngPath, type: "png", omitBackground: true });
        const stat = fs.statSync(pngPath);
        console.log(`    → PNG: ${pngFilename} (${(stat.size / 1024).toFixed(1)} KB)`);
        const imgTag = `![代码卡片 ${blockNum}](./${imagesDirName}/${pngFilename})`;
        lines.splice(block.startLine, block.endLine - block.startLine + 1, imgTag);
      } else {
        console.log(`    ✗ Failed to locate card element`);
      }
    } finally {
      await page.close();
      fs.unlinkSync(tmpHtml);
    }
  }

  await browser.close();

  const outputPath = path.join(path.dirname(inputPath), `${base}-cards${ext}`);
  fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(`\n✅ Done!`);
  console.log(`📁 PNG: ${imagesDir}/`);
  console.log(`📝 Output: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
