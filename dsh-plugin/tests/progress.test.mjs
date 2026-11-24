import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import {
  ProgressCards, actionCategory, addAction, buildProgressCard, countsLine,
  emptyCounts, isOutboundCommand, parseProgressLine, shellCommandFromArguments,
} from "../lib/progress.js";

function makeState(kind = "p2p") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-progress-"));
  const state = new State(dir);
  state.load();
  const chat = state.ensureChat("feishu", "oc_progress_demo", {
    name: "示例对象", kind,
  });
  chat.watching = true;
  chat.progress_card = null;
  return { state, dir, chat };
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }

function harness(state, { recall = true } = {}) {
  let now = 0;
  const timers = [];
  const sent = [];
  const patched = [];
  const recalled = [];
  const setTimer = (fn, ms) => {
    const t = { fn, at: now + ms, cleared: false };
    timers.push(t);
    return t;
  };
  const clearTimer = (t) => { if (t) t.cleared = true; };
  const im = {
    sendCard: async (_p, _c, card) => { sent.push(card); return { ok: true, message_id: "om_card_1" }; },
    patchCard: async (_p, _id, card) => { patched.push(card); return { ok: true }; },
    recallCard: async (_p, id) => {
      recalled.push(id);
      return recall ? { ok: true } : { ok: false, error: "recall_failed" };
    },
  };
  const manager = new ProgressCards({ state, im, now: () => now, setTimer, clearTimer });
  const advance = async (ms) => {
    now += ms;
    for (const t of timers) {
      if (!t.cleared && t.at <= now) { t.cleared = true; t.fn(); }
    }
    await tick();
  };
  const runDue = async () => {
    for (const t of timers) {
      if (!t.cleared && t.at <= now) { t.cleared = true; t.fn(); }
    }
    await tick();
  };
  return { manager, im, sent, patched, recalled, timers, advance, runDue, get now() { return now; } };
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

test("buildProgressCard always shows action counts; final states drop now/next", () => {
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
  const replied = buildProgressCard({ phase: "replied", counts, marker: { now: "不该出现" }, elapsedMs: 60000 });
  assert.match(replied.header.title.content, /已回复 · 用时 1 分/);
  assert.match(replied.body.elements[0].content, /回复已经发出/);
  assert.equal(replied.body.elements[0].content.includes("现在："), false);
});

test("ProgressCards.enabled honors private/group globals and per-chat tri-state", () => {
  const { state, chat } = makeState();
  const im = { sendCard: async () => ({ ok: true }), patchCard: async () => ({ ok: true }) };
  const manager = new ProgressCards({ state, im });
  assert.equal(manager.enabled(chat), false, "默认全局关、单点跟随");
  chat.progress_card = true;
  assert.equal(manager.enabled(chat), true, "全局关也能给单点开");
  state.data.config.dsh.progress_card = true;
  assert.equal(manager.enabled(chat), true, "私聊跟随私聊全局");
  chat.progress_card = false;
  assert.equal(manager.enabled(chat), false, "全局开也能给单聊关");
  chat.progress_card = null;
  chat.blocked = true;
  assert.equal(manager.enabled(chat), false);
  chat.blocked = false;
  chat.kind = "group";
  assert.equal(manager.enabled(chat), false, "群默认关，不跟私聊全局");
  state.data.config.dsh.progress_card_group = true;
  assert.equal(manager.enabled(chat), true, "群跟随群全局");
  chat.progress_card = false;
  assert.equal(manager.enabled(chat), false, "群单点也能关");
  chat.progress_card = null;
  chat.platform = "wecom";
  assert.equal(manager.enabled(chat), false, "非飞书永远不发");
});

test("shell command detector only closes the current target", () => {
  const chat = {
    platform: "feishu", chat_id: "oc_demo", kind: "p2p",
    recent: [
      { msg_id: "om_1", sender_id: "ou_peer", kind: "dm" },
      { msg_id: "om_2", sender_id: "ou_me", kind: "out" },
    ],
  };
  assert.equal(isOutboundCommand("lark-cli im +messages-send --chat-id oc_demo --text hi", chat), true);
  assert.equal(isOutboundCommand("npx lark-cli im +messages-send --user-id ou_peer --text hi", chat), true);
  assert.equal(isOutboundCommand("lark-cli im +messages-send --chat-id other --text hi", chat), false);
  assert.equal(isOutboundCommand("lark-cli im +messages-send --chat-id oc_demo --dry-run --text hi", chat), false);
  assert.equal(isOutboundCommand("lark-cli im messages patch --message-id om_1", chat), false);
  assert.equal(isOutboundCommand("echo 'lark-cli im +messages-send --chat-id oc_demo'", chat), false);
  assert.equal(isOutboundCommand("lark-cli im +messages-reply --message-id om_1 --text hi", chat), true);
  assert.equal(isOutboundCommand("lark-cli im +messages-reply --message-id om_old --text hi", chat), false);
  const group = { ...chat, chat_id: "oc_group", kind: "group" };
  assert.equal(isOutboundCommand("lark-cli im +messages-send --chat-id oc_group --text hi", group), true);
  assert.equal(isOutboundCommand("lark-cli im +messages-send --user-id ou_peer --text hi", group), false);
  assert.equal(shellCommandFromArguments(JSON.stringify({ command: "lark-cli im +messages-send --chat-id oc_demo" })),
    "lark-cli im +messages-send --chat-id oc_demo");
});

test("waiting period arms only its turn, creates at 2 minutes, and refreshes middle updates", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  const tracker = h.manager.begin({ chat, turnId: "turn-1" });
  assert.ok(tracker);
  // arm 之前不计数、不建卡
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "read" } });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  // 别的 turn 不计
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 2, name: "read" } });
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "read" } });
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "bash" } });
  await h.advance(120000);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].body.elements[0].content, /查资料 1 次 · 执行操作 1 次/);
  assert.equal(chat.progress.state, "running");
  assert.equal(chat.progress.msg_id, "om_card_1");

  h.manager.note("feishu", chat.chat_id, {
    type: "assistant/message",
    data: { turn: 1, content: [{ type: "text", text: "[进度] 2/3 现在：核对数据；接着：整理结论" }] },
  });
  await h.advance(1500);
  const latest = h.patched[h.patched.length - 1];
  assert.match(latest.body.elements[0].content, /现在：核对数据/);
  assert.match(latest.body.elements[0].content, /接着：整理结论/);

  h.manager.finish("feishu", chat.chat_id, "turn-1", { ok: true });
  await tick();
  assert.equal(chat.progress.state, "done");
  h.manager.stopAll();
});

test("a matching send recalls the card and freezes all later updates", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "read" } });
  await h.advance(120000);
  assert.equal(h.sent.length, 1);
  const command = "lark-cli im +messages-send --chat-id oc_progress_demo --text 'reply body'";
  h.manager.note("feishu", chat.chat_id, {
    type: "tool/call",
    data: { turn: 1, name: "bash", arguments: JSON.stringify({ command }) },
  });
  await tick();
  assert.deepEqual(h.recalled, ["om_card_1"]);
  assert.equal(chat.progress.state, "replied");
  const before = JSON.stringify(chat.progress);
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "bash" } });
  h.manager.note("feishu", chat.chat_id, {
    type: "assistant/message", data: { turn: 1, content: [{ type: "text", text: "[进度] 3/3 现在：不该出现" }] },
  });
  h.manager.finish("feishu", chat.chat_id, "turn-1", { ok: true });
  await tick();
  assert.equal(JSON.stringify(chat.progress), before, "发信后事件不再改 state");
  assert.equal(h.recalled.length, 1);
  assert.equal(h.patched.length, 0, "撤回成功不再 patch");
});

test("send before 2 minutes never creates a card; recall failure falls back to replied card", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  let h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  h.manager.note("feishu", chat.chat_id, {
    type: "tool/call",
    data: { turn: 1, name: "bash", arguments: JSON.stringify({
      command: "lark-cli im +messages-send --chat-id oc_progress_demo --text hi",
    }) },
  });
  await h.advance(60000);
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(60000);
  assert.equal(h.sent.length, 0, "发信后不再建卡");
  assert.equal(chat.progress.msg_id, "");

  const h2 = harness(state, { recall: false });
  h2.manager.begin({ chat, turnId: "turn-2" });
  h2.manager.arm("feishu", chat.chat_id, "turn-2", 2);
  h2.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 2, name: "read" } });
  await h2.advance(120000);
  assert.equal(h2.sent.length, 1);
  h2.manager.note("feishu", chat.chat_id, {
    type: "tool/call",
    data: { turn: 2, name: "bash", arguments: JSON.stringify({
      command: "lark-cli im +messages-send --chat-id oc_progress_demo --text hi",
    }) },
  });
  await tick();
  assert.equal(chat.progress.state, "replied");
  assert.equal(h2.patched.length, 1);
  assert.match(h2.patched[0].header.title.content, /已回复/);
});

test("wrong target and dry-run keep the card running", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(120000);
  for (const command of [
    "lark-cli im +messages-send --chat-id other --text hi",
    "lark-cli im +messages-send --chat-id oc_progress_demo --dry-run --text hi",
    "lark-cli im messages patch --message-id om_card_1",
  ]) {
    h.manager.note("feishu", chat.chat_id, {
      type: "tool/call", data: { turn: 1, name: "bash", arguments: JSON.stringify({ command }) },
    });
  }
  await tick();
  assert.equal(chat.progress.state, "running");
  assert.equal(h.recalled.length, 0);
});

test("a new instruction handoffs the same card and keeps counts/elapsed", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "read" } });
  await h.advance(60000);
  assert.equal(h.manager.handoff("feishu", chat.chat_id, "turn-1"), "handoff");
  assert.equal(chat.progress.state, "", "handoff 不 patch 暂停，也还没建卡");
  assert.equal(h.sent.length, 0);

  h.manager.begin({ chat, turnId: "turn-2" });
  h.manager.arm("feishu", chat.chat_id, "turn-2", 2);
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 2, name: "edit" } });
  await h.advance(60000);
  assert.equal(h.sent.length, 1, "等待期起点没重置，累计 2 分钟出卡");
  assert.match(h.sent[0].body.elements[0].content, /查资料 1 次 · 改文件 1 次/);
  assert.equal(chat.progress.msg_id, "om_card_1");
  h.manager.note("feishu", chat.chat_id, {
    type: "tool/call", data: { turn: 2, name: "bash", arguments: JSON.stringify({
      command: "lark-cli im +messages-send --chat-id oc_progress_demo --text hi",
    }) },
  });
  await tick();
  assert.deepEqual(h.recalled, ["om_card_1"]);
  assert.equal(chat.progress.state, "replied");
});

test("group cards are off by default, can be enabled globally or per group, and recall on group send", async () => {
  const { state, chat } = makeState("group");
  assert.equal(new ProgressCards({ state, im: {} }).enabled(chat), false);
  state.data.config.dsh.progress_card_group = true;
  const h = harness(state);
  assert.equal(h.manager.enabled(chat), true);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(120000);
  assert.equal(h.sent.length, 1);
  h.manager.note("feishu", chat.chat_id, {
    type: "tool/call", data: { turn: 1, name: "bash", arguments: JSON.stringify({
      command: "lark-cli im +messages-send --chat-id oc_progress_demo --text hi",
    }) },
  });
  await tick();
  assert.deepEqual(h.recalled, ["om_card_1"]);
  assert.equal(chat.progress.state, "replied");
});

test("recent self message closes via fallback; old card is recalled before a new card", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(120000);
  assert.equal(h.sent.length, 1);
  chat.recent = [{
    msg_id: "om_reply", kind: "out", msg_type: "text", ts_epoch: Math.floor(h.now / 1000), sender_id: "ou_me",
  }];
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "read" } });
  await tick();
  assert.deepEqual(h.recalled, ["om_card_1"]);
  assert.equal(chat.progress.state, "replied");

  // 新等待期：上一张终态卡存在时，建新卡前尽力撤回旧卡。
  chat.recent = [];
  const h2 = harness(state);
  h2.manager.begin({ chat, turnId: "turn-2" });
  h2.manager.arm("feishu", chat.chat_id, "turn-2", 2);
  await h2.advance(120000);
  assert.equal(h2.sent.length, 1);
  assert.equal(h2.recalled[0], "om_card_1");
});

test("disabling the card while a handoff is pending finalizes the old card", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(120000);
  assert.equal(h.manager.handoff("feishu", chat.chat_id, "turn-1"), "handoff");
  state.data.config.dsh.progress_card = false;
  const next = h.manager.begin({ chat, turnId: "turn-2" });
  await tick();
  assert.equal(next, null);
  assert.equal(chat.progress.state, "cancelled");
  assert.equal(h.patched.length, 1);
  assert.match(h.patched[0].header.title.content, /已暂停/);
});

test("a reply that exists before the waiting period does not close the next period", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  await h.advance(300000);
  chat.recent = [{
    msg_id: "om_previous_reply", kind: "out", msg_type: "text",
    ts_epoch: Math.floor(h.now / 1000), sender_id: "ou_me",
  }];
  h.manager.begin({ chat, turnId: "turn-new" });
  h.manager.arm("feishu", chat.chat_id, "turn-new", 1);
  await h.advance(120000);
  assert.equal(h.sent.length, 1, "上一条回复在等待期前，不能当成本轮已发信");
  assert.equal(h.recalled.length, 0);
});

test("a send that lands while the card request is in flight recalls the created card", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  let release;
  h.im.sendCard = () => new Promise((resolve) => { release = resolve; });
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(120000);
  assert.equal(h.sent.length, 0, "建卡请求还挂着");
  h.manager.note("feishu", chat.chat_id, {
    type: "tool/call", data: { turn: 1, name: "bash", arguments: JSON.stringify({
      command: "lark-cli im +messages-send --chat-id oc_progress_demo --text hi",
    }) },
  });
  release({ ok: true, message_id: "om_race" });
  await tick();
  await tick();
  assert.deepEqual(h.recalled, ["om_race"]);
  assert.equal(chat.progress.state, "replied");
  assert.equal(chat.progress.msg_id, "om_race");
  assert.equal(h.patched.length, 0);
});

test("events from the old turn cannot land on the new handoff tracker", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  h.manager.handoff("feishu", chat.chat_id, "turn-1");
  h.manager.begin({ chat, turnId: "turn-2" });
  h.manager.arm("feishu", chat.chat_id, "turn-2", 2);
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 1, name: "bash" } }, "turn-1");
  h.manager.note("feishu", chat.chat_id, { type: "tool/call", data: { turn: 2, name: "edit" } }, "turn-2");
  await h.advance(120000);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].body.elements[0].content, /改文件 1 次/);
  assert.equal(/执行操作/.test(h.sent[0].body.elements[0].content), false);
});

test("command body sentinel never reaches state or card", async () => {
  const { state, chat } = makeState();
  state.data.config.dsh.progress_card = true;
  const h = harness(state);
  h.manager.begin({ chat, turnId: "turn-1" });
  h.manager.arm("feishu", chat.chat_id, "turn-1", 1);
  await h.advance(120000);
  const secret = "SENTINEL_XYZ_123";
  h.manager.note("feishu", chat.chat_id, {
    type: "tool/call", data: { turn: 1, name: "bash", arguments: JSON.stringify({
      command: `lark-cli im +messages-send --chat-id oc_progress_demo --text '${secret}'`,
    }) },
  });
  await tick();
  assert.equal(JSON.stringify(chat.progress).includes(secret), false);
  assert.equal(JSON.stringify(h.sent).includes(secret), false);
  assert.equal(JSON.stringify(h.patched).includes(secret), false);
});
