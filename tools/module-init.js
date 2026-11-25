#!/usr/bin/env node
/**
 * module-init.js —— 生成一个**能直接加载**的最小战役模块。
 *
 * 为什么要有它：手册里那四个 JSON 手抄一遍要十几分钟，而且第一次抄的人
 * 一定会在某个字段上踩坑（id 不连续、邻接单向、忘了 supply_source）。
 * 这个脚本生成的东西是校验通过的，作者从这里改，比从零写好得多。
 *
 * 用法：
 *   node tools/module-init.js --id org.you.demo --name "演示战役" --out .\mymod.imod
 *   node tools/module-init.js --id org.you.demo --name "演示战役" --provinces 20
 *
 * 生成之后（在本仓库根目录）：
 *   node imdev.mjs --module .\mymod.imod
 *
 * 格式规范在引擎仓库的 content/README.md——那是唯一真相，这里只负责起个头。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : dflt;
}

const id = arg("id", "org.example.mymod");
const name = arg("name", "我的战役");
// 默认 12 个省：theater 尺度的校验下限就是 12，生成出来零警告。
// 少于 12 会得到 scale.too_few_provinces 警告（不是错误，但第一眼就报红不好看）。
const provinces = Math.max(3, Math.min(40, Number(arg("provinces", 12))));
const out = arg("out", id.split(".").pop() + ".imod");
const days = Number(arg("days", 30));

// ---- 一条线的省份：首尾各一方，中间归己方 ----
// 为什么是一条线：最小可玩的拓扑。真实战役请用引擎仓库的 tools/mapgen/gen.js
// 从经纬度生成（Delaunay 算邻接，和前端画出来的边一致）。
const provs = [];
for (let i = 0; i < provinces; i++) {
  const isJp = i === 0;
  const nb = [];
  if (i > 0) nb.push(i - 1);
  if (i + 1 < provinces) nb.push(i + 1);
  provs.push({
    id: i,
    name: `第${i + 1}省`,
    terrain: i === 0 ? "plain" : i === provinces - 1 ? "urban" : i % 2 ? "hill" : "plain",
    owner: isJp ? "jp" : "cn",
    supply_source: i === 0 || i === provinces - 1,
    rail: i === Math.floor(provinces / 2) - 1 || i === Math.floor(provinces / 2),
    neighbors: nb,
    lon: 116 + i * 0.1,
    lat: 29.5 - i * 0.08,
    note: "由 module-init.js 生成，请换成真实地名与出处",
  });
}

const mapJson = {
  bbox: [116, 29.5 - provinces * 0.08, 116 + provinces * 0.1, 29.5],
  projection: "wgs84",
  provinces: provs,
};

const mid = Math.floor(provinces / 2);
const oobJson = {
  _comment: "每个单位一行。strength 单位是千人；position 是 map.json 里的省份 id。",
  units: [
    {
      id: "jp.1",
      name: "第1联队",
      side: "jp",
      strength: 3,
      position: 0,
      stance: "attack",
      effectiveness: 1.4,
      supply_reach: 0.45,
      estimated: true,
      commander: {
        name: "某联队长",
        title: "第1联队长",
        obedience: 0.8,
        initiative: 0.5,
        aggression: 0.7,
        caution: 0.4,
        persona: "写他是怎么打仗的人：出身、经历、用兵习惯。",
        agenda: "写他为什么可能不听上级的：他图什么、怕什么。",
      },
      note: "演示数据，请换成史实番号与兵力",
    },
    {
      id: "cn.1",
      name: "第1师",
      side: "cn",
      strength: 9,
      position: provinces - 1,
      stance: "defend",
      effectiveness: 1.0,
      supply_reach: 0.12,
      estimated: true,
      commander: {
        name: "某师长",
        title: "第1师长",
        obedience: 0.7,
        initiative: 0.4,
        aggression: 0.5,
        caution: 0.6,
        persona: "写他是怎么打仗的人。",
        agenda: "写他为什么可能保存实力。",
      },
      note: "演示数据，请换成史实番号与兵力",
    },
  ],
};

const scenarioJson = {
  id: "scen." + id.split(".").pop(),
  name: name,
  start_date: "1938-07-26",
  days: days,
  seed: 1,
  comms: {
    _comment: "无线电时代：传输秒级，瓶颈在参谋汇总。字段含义见引擎 content/README.md 第 8 节。",
    preset: "radio",
  },
  rules: [],
  endings: [
    {
      id: "hold",
      name: "守住了",
      text: "写一段给玩家看的历史评价，不是比分。",
      priority: 10,
      at_end_only: true,
      require: [
        { metric: "provinces", side: "cn", cmp: "ge", value: Math.max(1, mid) },
        { metric: "holds_province", side: "cn", province: provs[provinces - 1].name },
      ],
    },
    {
      id: "lost",
      name: "退了",
      text: "写另一条走向。",
      priority: 5,
      at_end_only: false,
      require: [
        { metric: "holds_province", side: "jp", province: provs[provinces - 1].name },
      ],
    },
  ],
};

const moduleJson = {
  id,
  name,
  version: "0.1.0",
  author: "你的名字",
  description: "由 module-init.js 生成的演示模块。改 map.json / oob.json 里的占位数据即可开始。",
  engine: { min: "1.1.0" },
  content_schema: 1,
  // 阵营是内容：这两个名字随便起，引擎内部只认 A/B。
  // 第 1 个 = A 方，第 2 个 = B 方；map/oob 里引用的是这里的 id。
  sides: [
    { id: "cn", name: "守军" },
    { id: "jp", name: "进攻军" },
  ],
  playable_side: "cn",
  // 想两边都能玩就打开这一行：首页会多出一个"作为…"按钮，AI 替你对面指挥。
  // playable_sides: ["cn", "jp"],
  scale: "theater",
  domains: ["land"],
  hq: {
    name: "某军司令官",
    title: "军司令官",
    persona: "写他是什么人、怎么打仗。留空则敌方只有师团长各自为战。",
    agenda: "写他想打通什么、怕什么。",
    objectives: ["沿道路推进，夺取对方要点", "保护己方补给线"],
  },
};

const files = {
  "module.json": moduleJson,
  "scenario.json": scenarioJson,
  "map.json": mapJson,
  "oob.json": oobJson,
};

if (fs.existsSync(out)) {
  console.error(`目标已存在：${out}（换个 --out，或先删掉）`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
for (const [f, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, f), JSON.stringify(data, null, 2), "utf8");
}

console.log(`已生成 ${out}`);
console.log(`  省份 ${provinces} 个 · 单位 2 个 · 战役 ${days} 天 · 结局 2 条`);
console.log("");
console.log("下一步：");
console.log(`  node imdev.mjs --module ${out}`);
