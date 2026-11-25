#!/usr/bin/env node
/**
 * 载荷读数：一行命令打印各类载荷的行数与字数（spec 0062 §3.3）。
 *
 * 劣化是曲线不是断崖：发版时把这几个数字抄进当日 log，下次变长能先看到趋势。
 * 只读 fixture + 纯函数，不碰 state、不发消息。用法：
 *   node scripts/prompt-stats.mjs          # 人读表格
 *   node scripts/prompt-stats.mjs --json   # 机器读
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDeskPrompt, buildOpenPrompt, buildWakePrompt, buildWarmPrompt } from "../lib/prompt.js";
import { CASES } from "../tests/fixtures/prompt/cases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;

const BUILDERS = {
  open: (a) => buildOpenPrompt(...a),
  wake: (a) => buildWakePrompt(...a),
  warm: (a) => buildWarmPrompt(...a),
  desk: (a) => buildDeskPrompt(...a),
};

const isMeta = (line) => !/^- \[/.test(line) && !/^ {2}↪/.test(line);

const rows = [];
for (const [name, c] of Object.entries(CASES)) {
  const text = BUILDERS[c.kind](c.args);
  const lines = text.split("\n");
  const meta = lines.filter(isMeta);
  rows.push({
    name,
    lines: lines.length,
    chars: text.length,
    metaLines: meta.length,
    metaChars: meta.join("\n").length,
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad("载荷", 14)}${pad("行", 6)}${pad("字", 8)}${pad("口径行", 8)}口径字`);
  for (const r of rows) {
    console.log(`${pad(r.name, 14)}${pad(r.lines, 6)}${pad(r.chars, 8)}${pad(r.metaLines, 8)}${r.metaChars}`);
  }
}