#!/usr/bin/env node
/**
 * launch-browser.mjs — 三级浏览器启动链（renderer-base 核心模块）
 *
 * L1: playwright 缓存的 chromium（完整版优先，headless shell 次之，revision 新者优先）
 * L2: 系统已装 Chrome/Edge/Chromium（executablePath 直连，零下载）
 * L3: 全部失败 → 抛出带修复指引的错误
 *
 * 关键设计：**文件存在 ≠ 能启动**（revision 与 playwright 版本错位是常态），
 * 所以逐个候选真实 launch 探活，失败自动降级下一级。
 *
 * 导出：
 *   resolveBrowser(playwrightModule)  → { tier, kind, executable, launchArgs, tried[] }
 *   launchBest(playwrightModule, opts) → 成功的 browser 实例（headless）
 *
 * 自测：node launch-browser.mjs --selftest   （用本机 playwright 跑通三级链并出一张验证截图）
 */

import { existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform, tmpdir } from "node:os";
import { createRequire } from "node:module";

/**
 * 动态解析 playwright 模块。注意：ESM import 不认 NODE_PATH，
 * 所以用 CJS createRequire 按多个基点依次尝试：
 *   1. cwd（agent 在装了依赖的目录里运行 —— 推荐姿势）
 *   2. RENDERER_NODE_MODULES 环境变量
 *   3. NODE_PATH 各段
 *   4. 脚本自身位置向上找
 */
export function resolvePlaywright() {
  const bases = [process.cwd()];
  if (process.env.RENDERER_NODE_MODULES) bases.push(process.env.RENDERER_NODE_MODULES);
  if (process.env.NODE_PATH) bases.push(...process.env.NODE_PATH.split(":").filter(Boolean));
  // 脚本位置向上 4 层
  let p = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 4; i++) { bases.push(p); p = dirname(p); }

  for (const base of bases) {
    try {
      const req = createRequire(join(base, "noop.js"));
      return req("playwright");
    } catch { /* try next */ }
  }
  return null;
}

const IS_MAC = platform() === "darwin";
const IS_WIN = platform() === "win32";

// ── 候选收集（与 check-env.mjs 同逻辑，保持单一事实时以此文件为准）──

function playwrightCacheDirs() {
  if (IS_MAC) return [join(homedir(), "Library", "Caches", "ms-playwright")];
  if (IS_WIN) return [join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "ms-playwright")];
  return [join(homedir(), ".cache", "ms-playwright"), "/ms-playwright"];
}

function collectCandidates() {
  const cands = [];
  // L1：playwright 缓存
  for (const dir of playwrightCacheDirs()) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!/^chromium/.test(entry)) continue;
      const base = join(dir, entry);
      if (!statSync(base).isDirectory()) continue;
      const paths = IS_MAC
        ? [
            join(base, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
            join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
            join(base, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
            join(base, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
          ]
        : IS_WIN
          ? [join(base, "chrome-win", "chrome.exe"), join(base, "chrome-headless-shell-win64", "chrome-headless-shell.exe")]
          : [join(base, "chrome-linux", "chrome"), join(base, "chrome-headless-shell-linux64", "chrome-headless-shell")];
      for (const p of paths) {
        if (existsSync(p)) {
          cands.push({
            tier: "L1",
            kind: entry.includes("headless_shell") ? "playwright-headless-shell" : "playwright-chromium",
            executable: p,
            headlessOnly: entry.includes("headless_shell"),
          });
        }
      }
    }
  }
  // L2：系统浏览器
  const sysPaths = IS_MAC
    ? [
        ["system-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        ["system-edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        ["system-chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
      ]
    : IS_WIN
      ? [
          ["system-chrome", join(process.env["ProgramFiles"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe")],
          ["system-edge", join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe")],
        ]
      : [
          ["system-chrome", "/opt/google/chrome/chrome"],
          ["system-chromium", "/usr/bin/chromium"],
          ["system-chromium", "/usr/bin/chromium-browser"],
        ];
  for (const [kind, p] of sysPaths) {
    if (existsSync(p)) cands.push({ tier: "L2", kind, executable: p, headlessOnly: false });
  }

  // 排序：完整版 > headless shell；同级 revision 新者优先（完整版 rev 号大）
  cands.sort((a, b) => {
    if (a.headlessOnly !== b.headlessOnly) return a.headlessOnly ? 1 : -1;
    return b.executable.localeCompare(a.executable);
  });
  return cands;
}

// ── 启动链：逐候选真实探活 ──

export async function launchBest(pw, { headless = true, timeoutMs = 20000 } = {}) {  const cands = collectCandidates();
  const tried = [];

  for (const c of cands) {
    tried.push(`${c.tier}:${c.kind}:${c.executable}`);
    try {
      const browser = await pw.chromium.launch({
        headless: c.headlessOnly ? true : headless,
        executablePath: c.executable,
        timeout: timeoutMs,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      // 探活：真开一个页面，别只信 launch 返回
      const page = await browser.newPage();
      await page.setContent("<h1>probe</h1>");
      await page.close();
      return { browser, tier: c.tier, kind: c.kind, executable: c.executable, tried };
    } catch (e) {
      // 该候选不可用（revision 错位 / 损坏 / 权限），降级下一个
      continue;
    }
  }
  throw new Error(
    `[renderer-base] 无可用浏览器。已尝试:\n  ${tried.join("\n  ")}` +
      `\n修复: npx playwright install chromium-headless-shell，或安装 Google Chrome`,
  );
}

// ── 自测 ──

async function selftest() {
  const pw = resolvePlaywright();
  if (!pw) {
    console.error("❌ 无法解析 playwright（cd 到有 node_modules 的目录运行，或设 RENDERER_NODE_MODULES / NODE_PATH）");
    process.exit(1);
  }

  console.log("\n🚀 三级浏览器启动链自测");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const { browser, tier, kind, executable, tried } = await launchBest(pw);
  console.log(`  中标: ${tier} · ${kind}`);
  console.log(`  路径: ${executable}`);
  console.log(`  尝试序列:`);
  for (const t of tried) console.log(`    ${t === tried[tried.length - 1] ? "  ✅" : "  ✗ "} ${t}`);

  // 真渲染验证：出一张 HTML 截图
  const page = await browser.newPage({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 2 });
  await page.setContent(`
    <body style="margin:0;font-family:-apple-system,sans-serif;background:#282a36;color:#f8f8f2;
                 display:flex;align-items:center;justify-content:center;height:200px">
      <div style="text-align:center">
        <div style="font-size:28px;font-weight:700">${tier} · ${kind}</div>
        <div style="color:#6272a4;margin-top:8px">renderer-base launch-chain OK · 中文渲染验证</div>
      </div>
    </body>`);
  const out = join(tmpdir(), `renderer-base-selftest-${Date.now()}.png`);
  await page.screenshot({ path: out });
  await browser.close();

  const kb = (statSync(out).size / 1024).toFixed(1);
  console.log(`  截图: ${out} (${kb} KB)`);
  console.log("\n✅ 自测通过\n");
}

if (process.argv.includes("--selftest")) {
  selftest().catch(e => {
    console.error("❌ 自测失败:", e.message);
    process.exit(1);
  });
}
