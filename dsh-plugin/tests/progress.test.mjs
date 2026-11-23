import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import {
  ProgressCards, actionCategory, addAction, buildProgressCard, countsLine,
  emptyCounts, parseProgressLine,
} from "../lib/progress.js";

function makeState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-progress-"));
  const state = new State(dir);
  state.load();
  const chat = state.ensureChat("feishu", "oc_progress_demo", {
    name: "示例对象", kind: "p2p",
  });
  chat.watching = true;
  chat.progress_card = null;
  return { state, dir, chat };
}

test("actionCategory only uses tool names and counts fixed buckets", () => {
  assert.equal(actionCategory("read"), "research");
  assert.equal(actionCategory("web_search"), "research");
  assert.equal(actionCategory("edit"), "files");
  assert.equal(actionCategory("bash"), "ops");
  assert.equal(actionCategory("subagent"), "parallel");
  assert.equal(actionCategory("todo_write"), "");
  assert.equal(actionCategory("unknown_tool"), "ops");
  const c = emptyCounts();
  addAction(c, "read"); addAction(c, "bash"); addAction(c, "bash"); addAction(c, "todo_write");
  assert.deepEqual(c, { research: 1, files: 0, ops: 2, parallel: 0 });
  assert.equal(countsLine(c), "已做：查资料 1 次 · 执行操作 2 次");
  assert.equal(countsLine(emptyCounts()), "已做：正在准备");
});

test("parseProgressLine parses now/next/step, keeps the last valid marker", () => {
  assert.deepEqual(parseProgressLine("[进度] 2/5 现在：核对数据；接着：整理结论"), {
    now: "核对数据", next: "整理结论", step: { n: 2, total: 5 },
  });
  assert.deepEqual(parseProgressLine("[进度] 现在：核对数据"), {
    now: "核对数据", next: "", step: null,
  });
  assert.deepEqual(parseProgressLine("[进度] 下一步：整理结论"), {
    now: "", next: "整理结论", step: null,
  });
  assert.deepEqual(parseProgressLine("[进度] 2/1 现在：核对数据"), {
    now: "核对数据", next: "", step: null,
  });
  assert.deepEqual(parseProgressLine("[进度] 1/2 现在：旧\n普通行\n[进度] 2/2 现在：新"), {
    now: "新", next: "", step: { n: 2, total: 2 },
  });
  assert.equal(parseProgressLine("普通 assistant 正文"), null);
  assert.equal(parseProgressLine("[进度] 现在：https://example.com/secret"), null);
  assert.equal(parseProgressLine("[进度] 现在：/Users/me/secret"), null);
});

test("buildProgressCard always shows action counts; marker is optional", () => {
  const counts = { research: 3, files: 1, ops: 26, parallel: 0 };
  const card = buildProgressCard({ counts, marker: { now: "核对数据", next: "整理结论", step: { n: 2, total: 5 } }, elapsedMs: 130000 });
  assert.equal(card.schema, "2.0");
  assert.equal(card.config.update_multi, true);
  assert.match(card.header.title.content, /处理中 · 已用时 2 分 10 秒 · 第 2\/5 步/);
  const body = card.body.elements[0].content;
  assert.match(body, /已做：查资料 3 次 · 改文件 1 次 · 执行操作 26 次/);
  assert.match(body, /现在：核对数据/);
  assert.match(body, /接着：整理结论/);
  assert.equal(JSON.stringify(card).includes('"note"'), false);
});

test("no marker still keeps counts; final drops now/next", () => {
  const counts = { research: 5, files: 1, ops: 233, parallel: 0 };
  const running = buildProgressCard({ counts, marker: null, elapsedMs: 60000 });
  assert.match(running.body.elements[0].content, /已做：查资料 5 次 · 改文件 1 次 · 执行操作 233 次/);
  assert.equal(running.body.elements[0].content.includes("现在："), false);
  const done = buildProgressCard({ phase: "done", counts, marker: { now: "不该出现", next: "也不该" }, elapsedMs: 60000 });
  assert.match(done.header.title.content, /处理完成 · 用时 1 分/);
  assert.equal(done.body.elements[0].content.includes("现在："), false);
  assert.match(done.body.elements[0].content, /已经处理完/);
});

test("ProgressCards.enabled honors global and per-chat tri-state", () => {
  const { state, chat } = makeState();
  const im = { sendCard: async () => ({ ok: true }), patchCard: async () => ({ ok: true }) };
  const manager = new ProgressCards({ state, im });
  assert.equal(manager.enabled(chat), false, "默认全局关、单点跟随");
  chat.progress_card = true;
  assert.equal(manager.enabled(chat), true, "全局关也能给单点开");
  state.data.config.dsh.progress_card = true;
  assert.equal(manager.enabled(chat), true, "单点跟随全局开");
  chat.progress_card = false;
  assert.equal(manager.enabled(chat), false, "全局开也能给单点关");
  chat.progress_card = null;
  chat.blocked = true;
  assert.equal(manager.enabled(chat), false);
  chat.blocked = false;
  chat.kind = "group";
  assert.equal(manager.enabled(chat), false, "群聊永远不发");
});

test("tracker creates at 2 minutes with counts, patches marker, finalizes", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  let now = 0;
  const timers = [];
  const setTimer = (fn, ms) => {
    const t = { fn, at: now + ms, cleared: false };
    timers.push(t);
    return t;
  };
  const clearTimer = (t) => { if (t) t.cleared = true; };
  const sent = [];
  const patched = [];
  const im = {
    sendCard: async (_p, _c, card) => { sent.push(card); return { ok: true, message_id: "om_card_1" }; },
    patchCard: async (_p, _id, card) => { patched.push(card); return { ok: true }; },
  };
  const manager = new ProgressCards({ state, im, now: () => now, setTimer, clearTimer });
  const tracker = manager.begin({ chat, turnId: "turn-1" });
  assert.ok(tracker);
  tracker.note({ type: "tool/call", data: { turn: 1, name: "read" } });
  tracker.note({ type: "tool/call", data: { turn: 1, name: "bash" } });
  now = 120000;
  for (const t of timers) if (!t.cleared && t.at <= now) t.fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.elements[0].content, /查资料 1 次 · 执行操作 1 次/);
  assert.equal(chat.progress.state, "running");
  assert.equal(chat.progress.msg_id, "om_card_1");

  tracker.note({ type: "tool/call", data: { turn: 1, name: "bash" } });
  tracker.note({ type: "assistant/message", data: { turn: 1, content: [{ type: "text", text: "[进度] 2/3 现在：核对数据；接着：整理结论" }] } });
  now += 1500;
  for (const t of timers) if (!t.cleared && t.at <= now) t.fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(patched.length >= 1);
  const latest = patched[patched.length - 1];
  assert.match(latest.body.elements[0].content, /现在：核对数据/);
  assert.match(latest.body.elements[0].content, /接着：整理结论/);

  manager.finish("feishu", chat.chat_id, "turn-1", { ok: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(chat.progress.state, "done");
  manager.stopAll();
});
