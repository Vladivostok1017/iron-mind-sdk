#!/usr/bin/env node
/**
 * imdev.mjs —— 模块开发的循环工具（SDK 侧，不在游戏里）。
 *
 * 它做三件事，**一行引擎代码都不包含**：
 *   1. 把引擎的 sim-server 作为子进程拉起来；
 *   2. 盯着模块目录，作者一存盘就给内核发 POST /api/module 让它重载；
 *   3. Ctrl+C 时把子进程一起带走。
 *
 * 为什么放在 SDK 而不是引擎里：
 *   · 热重载是**开发行为**，不该写在出货的二进制里；
 *   · 它需要的全部能力（起服务、切模块、查版本）都已经是引擎的公开 HTTP 接口，
 *     SDK 只是一层壳——所以引擎升级时这里几乎不用改（见 check()）。
 *
 * 用法：
 *   node imdev.mjs --module ..\nanxun-1938\nanxun_1938.imod
 *   node imdev.mjs --module .\mymod.imod --engine ..\iron-mind --port 8900
 *   node imdev.mjs --check            # 只检查引擎兼容性，不起服务
 *
 * 引擎位置：--engine，或环境变量 IRONMIND_ENGINE，或同级目录 ../iron-mind。
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes("--" + name);

const MODULE_FILES = ["module.json", "scenario.json", "map.json", "oob.json", "provinces_geo.json"];

function resolveEngine() {
  const cands = [
    arg("engine", null),
    process.env.IRONMIND_ENGINE,
    resolve(here, "..", "iron-mind"),
    resolve(here, ".."),
  ].filter(Boolean);
  for (const c of cands) {
    const dir = resolve(c);
    if (existsSync(join(dir, "Cargo.toml")) && existsSync(join(dir, "crates", "sim-server"))) {
      return dir;
    }
  }
  return null;
}

function serverExe(engine) {
  const name = process.platform === "win32" ? "sim-server.exe" : "sim-server";
  return join(engine, "target", "release", name);
}

/** 模块目录的指纹：每个文件的 mtime+size。变了就说明作者存过盘。 */
function stamp(dir) {
  const out = [];
  for (const f of MODULE_FILES) {
    const p = join(dir, f);
    try {
      const s = statSync(p);
      out.push(`${f}:${s.mtimeMs}:${s.size}`);
    } catch {
      out.push(`${f}:-`);
    }
  }
  return out.join("|");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** 引擎兼容性自检：SDK 用到的每个接口都在，且世界代号存在。 */
async function check(port) {
  const base = `http://127.0.0.1:${port}`;
  const out = [];
  const v = await getJson(`${base}/api/version`);
  out.push(`引擎 ${v.engine} · ${v.profile}` + (v.built ? ` · 构建 ${new Date(v.built * 1000).toLocaleString("zh-CN", { hour12: false })}` : ""));
  const llm = await getJson(`${base}/api/llm`);
  out.push(`世界代号 generation: ${typeof llm.generation === "number" ? llm.generation : "缺失（页面不会自动换地图）"}`);
  const mods = await getJson(`${base}/api/modules`);
  out.push(`模块根：${(mods.roots || []).join("，") || "—"}`);
  out.push(`可用模块 ${(mods.modules || []).length} 个`);
  console.log(out.join("\n"));
  const ok = typeof v.engine === "string" && Array.isArray(mods.modules);
  if (!ok) {
    console.error("\n[不兼容] 引擎缺少 SDK 依赖的接口，请升级引擎或升级本 SDK。");
    process.exitCode = 2;
  }
  return ok;
}

async function main() {
  const engine = resolveEngine();
  if (!engine) {
    console.error(
      "找不到引擎。用 --engine 指定，或设 IRONMIND_ENGINE，\n" +
        "或者把本仓库和 iron-mind 放在同一个父目录下。"
    );
    process.exit(1);
  }
  const port = Number(arg("port", 8899));

  if (has("check")) {
    const exe = serverExe(engine);
    if (!existsSync(exe)) {
      console.error(`引擎还没编译：${exe}\n先在引擎目录跑：cargo build --release -p sim-server`);
      process.exit(1);
    }
    // cwd 必须是引擎目录：引擎默认的模块根是**相对路径** content/scenarios，
    // 在别处启动会"可用模块 0 个"然后加载失败退出。别指望作者踩一次再学会。
    const child = spawn(exe, ["--port", String(port)], {
      cwd: engine,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let logs = "";
    child.stdout.on("data", (b) => (logs += b.toString()));
    child.stderr.on("data", (b) => (logs += b.toString()));
    try {
      await waitReady(port, 20000);
      await check(port);
    } catch (e) {
      console.error(`\n[自检失败] ${e.message}`);
      if (logs.trim()) console.error("内核输出：\n" + logs.trim());
      process.exitCode = 2;
    } finally {
      child.kill();
    }
    return;
  }

  const moduleArg = arg("module", null);
  if (!moduleArg) {
    console.error(
      "用法：node imdev.mjs --module <模块目录> [--engine <引擎目录>] [--port 8899]\n" +
        "先看有哪些模块：node imdev.mjs --check"
    );
    process.exit(1);
  }
  const moduleDir = resolve(moduleArg);
  if (!existsSync(join(moduleDir, "module.json"))) {
    console.error(`这不是一个模块（缺 module.json）：${moduleDir}`);
    process.exit(1);
  }
  const exe = serverExe(engine);
  if (!existsSync(exe)) {
    console.error(`引擎还没编译：${exe}\n先在引擎目录跑：cargo build --release -p sim-server`);
    process.exit(1);
  }

  // 关键：把模块的**上级目录**设成模块根。
  // 引擎的 POST /api/module 只接受"某个模块根底下的 .imod"，否则会被当成
  // 恶意路径拒掉。设了它，作者放在任何地方的模块都能被热重载。
  const env = { ...process.env, IRONMIND_MODULES: dirname(moduleDir) };

  console.log(`引擎：${engine}`);
  console.log(`模块：${moduleDir}`);
  console.log(`页面：http://127.0.0.1:${port}/`);
  console.log("改完存盘即重载；Ctrl+C 退出。\n");

  // 同上：cwd 一定是引擎目录，否则引擎的默认模块根（相对路径）找不到。
  const child = spawn(exe, ["--module", moduleDir, "--port", String(port)], {
    cwd: engine,
    stdio: "inherit",
    env,
  });
  let killed = false;
  const bye = () => {
    if (killed) return;
    killed = true;
    child.kill();
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
  child.on("exit", (code) => {
    if (!killed) process.exit(code ?? 0);
  });

  try {
    await waitReady(port, 30000);
  } catch {
    console.error("\n内核没在 30 秒内就绪，看上面的输出。");
    bye();
    return;
  }

  let last = stamp(moduleDir);
  for (;;) {
    await sleep(600);
    const now = stamp(moduleDir);
    if (now === last) continue;
    last = now;
    await sleep(300); // 编辑器常常"先清空再写"
    last = stamp(moduleDir);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/module`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: moduleDir.split("\\").join("/") }),
      });
      const j = await r.json();
      if (j.error) {
        // 加载失败时内核保留原世界，这里只要把原因说清楚
        console.error(`[重载失败] ${j.error}（保留原世界，改完再存一次）`);
      } else {
        console.log(`[重载] 第 ${j.tick ?? 0} 日 · ${j.provinces?.length ?? "?"} 省`);
      }
    } catch (e) {
      console.error(`[重载失败] 连不上内核：${e.message}`);
    }
  }
}

async function waitReady(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await getJson(`http://127.0.0.1:${port}/api/version`);
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("timeout");
}

main().catch((e) => {
  console.error("失败：", e.message);
  process.exitCode = 1;
});
