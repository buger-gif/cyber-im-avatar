/**
 * 载荷的预算、形状与可自定义口径矩阵（spec 0062 §3 / §5）。
 *
 * 快照回答「这次改了什么」，这里回答「还能不能继续长」：
 * · 非消息行有行数与字数上限，单条元信息行不超过一句半；
 * · 每个可自定义开关在 builder 里都只声明一次，开关双向，未变不复读；
 * · 注册表里的 skillHint 必须仍能在 SKILL.md 找到，skill 改名时不会悄悄丢口径。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DELTAS, buildDeskPrompt, buildOpenPrompt, buildWakePrompt, buildWarmPrompt,
} from "../lib/prompt.js";
import { CASES } from "./fixtures/prompt/cases.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD = path.join(HERE, "..", "..", "SKILL.md");

const BUILDERS = {
  open: (a) => buildOpenPrompt(...a),
  wake: (a) => buildWakePrompt(...a),
  warm: (a) => buildWarmPrompt(...a),
  desk: (a) => buildDeskPrompt(...a),
};

const isMeta = (line) => !/^- \[/.test(line) && !/^ {2}↪/.test(line);
const hasPath = (line) => /(^|[\s（])\/[^\s）]+/.test(line) || line.includes(" → ");

/** 预算按当前实测取整并留约 10% 余量；涨预算要改这里，评审看得见。 */
const BUDGET = {
  "open-command": { lines: 18, chars: 780 },
  "open-manual": { lines: 18, chars: 750 },
  "wake-first": { lines: 16, chars: 680 },
  "wake-steady": { lines: 2, chars: 200 },
  warm: { lines: 15, chars: 820 },
  desk: { lines: 27, chars: 1300 },
};

/** 单行上限：open / wake 是口径行，一句半；warm / desk 是流程说明，放宽到 220。 */
const LINE_CAP = { open: 160, wake: 160, warm: 220, desk: 220 };

for (const [name, c] of Object.entries(CASES)) {
  const text = BUILDERS[c.kind](c.args);
  const lines = text.split("\n");
  const meta = lines.filter(isMeta);
  const metaChars = meta.join("\n").length;
  test(`载荷预算：${name} 不超过 ${BUDGET[name].lines} 行 / ${BUDGET[name].chars} 字`, () => {
    assert.ok(meta.length <= BUDGET[name].lines,
      `${name} 口径行 ${meta.length} > ${BUDGET[name].lines}（新需求要删旧行或并进已有行）`);
    assert.ok(metaChars <= BUDGET[name].chars,
      `${name} 口径字数 ${metaChars} > ${BUDGET[name].chars}`);
  });

  test(`载荷形状：${name} 的每条元信息行不超过 ${LINE_CAP[c.kind]} 字`, () => {
    for (const line of meta) {
      if (hasPath(line)) continue; // 绝对路径是事实，长度不可控
      assert.ok(line.length <= LINE_CAP[c.kind], `单行过长（${line.length}）：${line}`);
    }
  });
}

test("口径注册表：每个开关都有默认、生效值、入口与 skill 归属", () => {
  const keys = Object.keys(DELTAS);
  assert.deepEqual(keys.sort(), ["command", "progress", "rights", "send_mode", "wake_mode"]);
  const skill = fs.readFileSync(SKILL_MD, "utf8");
  for (const key of keys) {
    const d = DELTAS[key];
    assert.ok(d.label, `${key} 缺 label`);
    assert.ok(Array.isArray(d.values) && d.values.length >= 2, `${key} 缺值域`);
    assert.equal(typeof d.render, "function", `${key} 缺 render`);
    assert.ok(d.stateKey, `${key} 缺 announced 字段名`);
    assert.ok(d.skillHint && skill.includes(d.skillHint),
      `${key} 的 skillHint「${d.skillHint}」在 SKILL.md 里找不到`);
  }
});

const groupRows = () => [
  { msg_id: "g1", sender_id: "ou_demo_zhang", sender_name: "张三", content: "看下这个",
    ts: "t1", ts_epoch: 100, kind: "mention", state: "new",
    mentions: [{ id: "ou_demo_self", name: "示例人" }] },
];
const base = { bookPath: "/tmp/book.md", kind: "group", selfId: "ou_demo_self", selfName: "示例人" };
const announcedWith = (over = {}) => ({
  send_mode: "draft", wake_mode: "mention", cmd: false, rights: false,
  progress_card: null, hard: true, ...over,
});

test("发送方式：首轮一次、切换一次、未变不出", () => {
  const first = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, firstTurn: true, sendMode: "auto",
  });
  assert.match(first, /^发送方式：全自动（面板设置；口头约定不改模式）$/m);
  const changed = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, sendMode: "auto", announced: announcedWith({ send_mode: "draft" }),
  });
  assert.match(changed, /^发送方式：全自动（已从草稿审批切换；/m);
  const steady = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, sendMode: "auto", announced: announcedWith({ send_mode: "auto" }),
  });
  assert.doesNotMatch(steady, /发送方式/);
});

test("关注程度：群从全部消息切回只认 @ 也要说一句", () => {
  const all = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, firstTurn: true, wakeMode: "all",
  });
  assert.match(all, /^关注程度：全部消息/m);
  const back = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, wakeMode: "mention", announced: announcedWith({ wake_mode: "all" }),
  });
  assert.match(back, /^关注程度：只认 @.*已从上一档切回/m);
  const steady = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, wakeMode: "mention", announced: announcedWith({ wake_mode: "mention" }),
  });
  assert.doesNotMatch(steady, /关注程度/);
});

test("发言权：默认沉默 / 本群改过给指针 / 私聊不出 / 未变不复读", () => {
  const def = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), { ...base, firstTurn: true });
  assert.match(def, /^发言权：默认沉默（判据见 skill）。$/m);
  const custom = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, firstTurn: true, rightsCustom: true,
  });
  assert.match(custom, /^发言权：本群单独改过（工作本「## 我在这个群的发言权」）/m);
  const steady = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, rightsCustom: true, announced: announcedWith({ rights: true }),
  });
  assert.doesNotMatch(steady, /发言权/);
  const dm = buildWakePrompt("feishu", "示例对象 A", "oc_dm", [
    { msg_id: "d1", sender_id: "ou_x", sender_name: "客户", content: "在吗",
      ts: "t1", ts_epoch: 100, kind: "dm", state: "new" },
  ], { bookPath: "/tmp/people/x.md", kind: "p2p", single: true, firstTurn: true });
  assert.doesNotMatch(dm, /发言权/);
});

test("进度卡：开时一行；从开切到关也要说，否则 agent 会一直写 [进度]", () => {
  const on = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, firstTurn: true, progressCard: true,
  });
  assert.match(on, /^进度卡：开（想补任务级进度就单写一行 \[进度\] 1\/3 现在：…；接着：…）。$/m);
  const off = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, progressCard: false, announced: announcedWith({ progress_card: true }),
  });
  assert.match(off, /^进度卡：关（已关闭，不必再写 \[进度\]）。$/m);
  const steady = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, progressCard: true, announced: announcedWith({ progress_card: true }),
  });
  assert.doesNotMatch(steady, /进度卡/);
  const defaultOff = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, firstTurn: true, progressCard: false,
  });
  assert.doesNotMatch(defaultOff, /进度卡/);
});

test("本人指令：会话里第一次出现时一行，之后不再复读", () => {
  const cmd = {
    msg_id: "c1", sender_id: "ou_demo_self", sender_name: "示例人",
    content: "@示例人 看下", ts: "t1", ts_epoch: 100, kind: "cmd", state: "new",
  };
  const first = buildWakePrompt("feishu", "示例群", "oc_g", [cmd], {
    ...base, firstTurn: true,
  });
  assert.match(first, /^本人（@自己）行是本人指令，不是客户消息：/m);
  const again = buildWakePrompt("feishu", "示例群", "oc_g", [cmd], {
    ...base, announced: announcedWith({ cmd: true }),
  });
  assert.doesNotMatch(again, /行是本人指令/);
});

test("硬门：首轮一次、未变不复读、压缩后补一次", () => {
  const first = buildOpenPrompt("feishu", "示例群", "oc_g", [], { kind: "group" });
  assert.match(first, /^硬门：钱\/合同\/价格\/付款\/权限\/凭据\/公开发布/m);
  const steady = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, announced: announcedWith({ hard: true }),
  });
  assert.doesNotMatch(steady, /^硬门：/m);
  const afterCompact = buildWakePrompt("feishu", "示例群", "oc_g", groupRows(), {
    ...base, announced: announcedWith({ hard: false }),
  });
  assert.match(afterCompact, /^硬门：/m);
});