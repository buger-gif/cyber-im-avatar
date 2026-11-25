/**
 * 载荷快照：五类载荷 + 开场两种入口逐字比对。
 *
 * 为什么是快照而不是一堆 assert.match：载荷是给模型的接口，改动应当是一段可读的
 * diff。改文案必须显式 `UPDATE_PROMPT=1 node --test`，默认运行只读不写。
 * 快照文件大小本身就是趋势数据（git log --stat 能看到增长曲线）。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDeskPrompt, buildOpenPrompt, buildWakePrompt, buildWarmPrompt } from "../lib/prompt.js";
import { CASES } from "./fixtures/prompt/cases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "fixtures", "prompt");
const UPDATE = process.env.UPDATE_PROMPT === "1";

const BUILDERS = {
  open: (a) => buildOpenPrompt(...a),
  wake: (a) => buildWakePrompt(...a),
  warm: (a) => buildWarmPrompt(...a),
  desk: (a) => buildDeskPrompt(...a),
};

for (const [name, c] of Object.entries(CASES)) {
  test(`prompt snapshot: ${name}`, () => {
    const text = `${BUILDERS[c.kind](c.args)}\n`;
    const file = path.join(DIR, `${name}.txt`);
    if (UPDATE) {
      fs.writeFileSync(file, text);
      return;
    }
    assert.ok(fs.existsSync(file), `缺快照 ${name}（首次生成用 UPDATE_PROMPT=1）`);
    assert.equal(fs.readFileSync(file, "utf8"), text,
      `载荷变了：${name}。确认改动是有意的再跑 UPDATE_PROMPT=1`);
  });
}