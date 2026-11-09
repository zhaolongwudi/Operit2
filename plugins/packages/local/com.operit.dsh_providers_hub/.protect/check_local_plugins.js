#!/usr/bin/env node
"use strict";
/**
 * 本机插件保护区校验（不依赖 git，纯 Node）。
 *
 * 用法：
 *   node plugins/packages/local/com.operit.dsh_providers_hub/.protect/check_local_plugins.js          # 校验
 *   node plugins/packages/local/com.operit.dsh_providers_hub/.protect/check_local_plugins.js --update   # 更新基线
 *
 * 退出码：0 = 全部一致；1 = 有新增/修改/丢失，需人工确认。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROTECT_ROOT = "plugins/packages/local/com.operit.dsh_providers_hub";
const BASELINE = path.join(PROTECT_ROOT, ".protect", "baseline.json");
// 基线自身与校验脚本不参与比对，否则每次 --update 都会自我失效
const SKIP = new Set([".protect/baseline.json"]);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walk(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (name === ".protect") continue;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out;
}

const isUpdate = process.argv.includes("--update");
const files = walk(PROTECT_ROOT, PROTECT_ROOT).sort();

if (isUpdate) {
  const map = {};
  for (const f of files) map[f] = sha256(path.join(PROTECT_ROOT, f));
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  baseline.files = map;
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`已更新基线，共 ${Object.keys(map).length} 个文件`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).files;
const current = new Map(files.map((f) => [f, sha256(path.join(PROTECT_ROOT, f))]));

const missing = Object.keys(baseline).filter((f) => !current.has(f));
const added = [...current.keys()].filter((f) => !(f in baseline));
const changed = [...current.keys()].filter(
  (f) => f in baseline && baseline[f] && baseline[f] !== current.get(f)
);
const emptyBaseline = Object.entries(baseline).filter(([, v]) => !v).length;

let bad = false;
if (emptyBaseline > 0) {
  console.log(`! 基线尚未生成（${emptyBaseline} 项为空），请运行 --update`);
  bad = true;
}
if (missing.length) {
  console.log("✗ 丢失文件:");
  missing.forEach((f) => console.log("   -", f));
  bad = true;
}
if (changed.length) {
  console.log("✗ 内容被改动:");
  changed.forEach((f) => console.log("   *", f));
  bad = true;
}
if (added.length) {
  console.log("! 新增未登记文件:");
  added.forEach((f) => console.log("   +", f));
  bad = true;
}

if (bad) {
  console.log("\n保护区校验未通过。确认这些改动是你有意为之后，运行 --update 重新登记。");
  process.exit(1);
}
console.log(`✓ 保护区完好：${current.size} 个文件与基线一致`);
