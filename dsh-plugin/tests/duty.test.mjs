import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import * as duty from "../lib/duty.js";

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-duty-"));
  const state = new State(dir);
  state.load();
  Object.assign(state.data.config.duty, extra);
  const chat = state.ensureChat("feishu", "oc_group", { name: "项目群", kind: "group" });
  chat.duty.member_count = 8;
  const opened = [];
  const turns = {
    async open(c, opts) { opened.push({ c, opts }); return { ok: true }; },
    cancel() {},
  };
  const profiles = { ensureMemory() {} };
  const im = { adapter: () => ({ canMention: true }) };
  return { dir, state, chat, turns, profiles, im, opened };
}

function writeDecision(dir, event, extra = {}) {
  const file = path.join(dir, "duty", "decisions", `${event.event_id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1, decision_id: event.event_id, platform: "feishu", chat_id: "oc_group",
    action: "watch", reason: "项目群，@ 你排期", confidence: 0.8, ...extra,
  }));
  return file;
}

test("watch applies mention, opens once, and deletes the decision file", async () => {
  const { dir, state, chat, turns, profiles, im, opened } = setup();
  const event = duty.newEvent(chat, "added");
  const file = writeDecision(dir, event);
  const r = await duty.applyDecision({ state, chat, decision: {
    action: "watch", reason: "项目群", confidence: 0.8,
  }, turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.wake_mode, "mention");
  assert.equal(chat.duty.state, "watch");
  assert.equal(fs.existsSync(file), false);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].opts.reason, "duty");
});

test("group over the member cap or with unknown count cannot auto-watch", async () => {
  const { state, chat, turns, profiles, im } = setup();
  chat.duty.member_count = 11;
  let r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "大群" },
    turns, profiles, im });
  assert.equal(r.ok, false);
  assert.equal(r.error, "group_too_large");
  assert.equal(chat.watching, false);
  assert.equal(chat.duty.state, "failed");

  chat.duty.state = "queued";
  chat.duty.member_count = 0;
  r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "未知" },
    turns, profiles, im });
  assert.equal(r.ok, false);
  assert.equal(r.error, "member_unknown");
  assert.equal(chat.watching, false);
});

test("10 people is allowed; 11 is not", async () => {
  const { state, chat, turns, profiles, im } = setup();
  chat.duty.member_count = 10;
  const r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "10 人" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.watching, true);
});

test("trial is rejected while trial_hours=0; enabled it sets review_at", async () => {
  const { state, chat, turns, profiles, im } = setup();
  let r = await duty.applyDecision({ state, chat, decision: { action: "trial", reason: "先看" },
    turns, profiles, im });
  assert.equal(r.ok, false);
  assert.equal(r.error, "trial_disabled");

  state.data.config.duty.trial_hours = 24;
  chat.duty.state = "queued";
  r = await duty.applyDecision({ state, chat, decision: { action: "trial", reason: "先看" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.duty.state, "trial");
  assert.ok(chat.duty.review_at > Date.now() / 1000);
});

test("ignore closes polling and clears pending bodies", async () => {
  const { state, chat, turns, profiles, im } = setup();
  chat.watching = true;
  chat.timer = 1;
  chat.recent = [{ msg_id: "m1", kind: "mention", state: "new", content: "hello" }];
  const r = await duty.applyDecision({ state, chat, decision: { action: "ignore", reason: "噪声" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.watching, false);
  assert.equal(chat.timer, -1);
  assert.equal(chat.recent[0].state, "ignored");
  assert.equal(chat.recent[0].content, "");
});

test("mode=all in a decision file is rejected before apply", () => {
  const { dir, chat } = setup();
  const event = duty.newEvent(chat, "added");
  writeDecision(dir, event, { mode: "all" });
  const r = duty.readDecision(duty.decisionPath({ dir }, event.event_id), {
    event_id: event.event_id, platform: "feishu", chat_id: "oc_group", trigger: "added",
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "all_disabled");
});

test("review watch on an already-watching group bypasses the member first-open gate", async () => {
  const { state, chat, turns, profiles, im } = setup();
  chat.watching = true;
  chat.timer = 1;
  chat.wake_mode = "mention";
  chat.duty.member_count = 99;
  chat.duty.state = "trial";
  const r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "复核转正" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.duty.state, "watch");
  assert.equal(chat.duty.review_at, 0);
});

test("cleanupRecords keeps sweep_epoch/member_count and clears ignore decisions", () => {
  const { state, chat } = setup();
  chat.duty.state = "ignore";
  chat.duty.decided_at = 1;
  chat.duty.reason = "old";
  chat.duty.sweep_epoch = 123;
  chat.duty.member_count = 8;
  state.data.config.duty.record_keep_days = 30;
  const n = duty.cleanupRecords(state);
  assert.equal(n, 1);
  assert.equal(chat.duty.state, "none");
  assert.equal(chat.duty.reason, "");
  assert.equal(chat.duty.sweep_epoch, 123);
  assert.equal(chat.duty.member_count, 8);
});

test("ensureDutyDir seeds a non-empty initial policy and only fills missing/empty files", () => {
  const { dir, state } = setup();
  duty.ensureDutyDir(state);
  const policy = path.join(dir, "duty", "policy.md");
  const first = fs.readFileSync(policy, "utf8");
  assert.match(first, /# 值守方针/);
  assert.match(first, /## 值得值守/);
  assert.match(first, /## 硬约束/);
  assert.ok(first.trim().length > 100);
  assert.equal(fs.statSync(policy).mode & 0o777, 0o600);

  fs.writeFileSync(policy, "# 我的规则\n只看项目群\n");
  duty.ensureDutyDir(state);
  assert.equal(fs.readFileSync(policy, "utf8"), "# 我的规则\n只看项目群\n");

  fs.writeFileSync(policy, "");
  duty.ensureDutyDir(state);
  assert.match(fs.readFileSync(policy, "utf8"), /# 值守方针/);
  assert.ok(fs.statSync(path.join(dir, "duty", "decisions")).isDirectory());
});

test("auto watch binds the configured join workspace", async () => {
  const { dir, state, chat, turns, profiles, im, opened } = setup();
  const ws = fs.realpathSync(dir);
  state.data.config.join_workspace = ws;
  const r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "项目群" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.workspace, ws);
  assert.equal(opened[0].c.workspace, ws, "首个值班会话用同一工作区创建");
});

test("auto watch falls back to the most recently used workspace", async () => {
  const { dir, state, chat, turns, profiles, im } = setup();
  const ws = fs.realpathSync(dir);
  const other = state.ensureChat("feishu", "oc_bound", { name: "已绑群", kind: "group" });
  other.workspace = ws;
  other.session_bound_at = 100;
  state.data.config.join_workspace = "";
  const r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "项目群" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.workspace, ws);
});

test("auto watch leaves workspace unbound when there is no join default", async () => {
  const { state, chat, turns, profiles, im, opened } = setup();
  state.data.config.join_workspace = "";
  const r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "项目群" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.workspace, "");
  assert.equal(opened[0].c.workspace, "");
});

test("auto watch does not overwrite an existing workspace binding", async () => {
  const { dir, state, chat, turns, profiles, im } = setup();
  const bound = fs.realpathSync(dir);
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "im-join-ws-"));
  chat.workspace = bound;
  state.data.config.join_workspace = fs.realpathSync(otherDir);
  const r = await duty.applyDecision({ state, chat, decision: { action: "watch", reason: "项目群" },
    turns, profiles, im });
  assert.equal(r.ok, true);
  assert.equal(chat.workspace, bound);
});

test("retire flips watching/timer and leaves a durable retired record", () => {
  const { chat } = setup();
  chat.watching = true;
  chat.timer = 1;
  chat.last_epoch = 1234;
  chat.duty.state = "watch";
  chat.duty.last_hit_at = 100;
  chat.duty.event_id = "d-stale";
  assert.equal(duty.retire(chat, { days: 7, now: 2000 }), true);
  assert.equal(chat.watching, false);
  assert.equal(chat.timer, -1);
  assert.equal(chat.duty.state, "retired");
  assert.equal(chat.duty.by, "system");
  assert.equal(chat.duty.decided_at, 2000);
  assert.equal(chat.duty.event_id, "");
  assert.equal(chat.duty.last_hit_at, 100, "命中时间保留，供面板解释");
  assert.equal(chat.duty.sweep_epoch, 1234);
  assert.match(chat.duty.reason, /7 天没有新的命中/);
});

test("activityAt prefers hits and never uses group chatter timestamps", () => {
  const { chat } = setup();
  chat.added_at = 100;
  chat.last_epoch = 9999;
  chat.last_turn = { at: 300 };
  chat.duty.decided_at = 200;
  chat.duty.last_hit_at = 400;
  assert.equal(duty.activityAt(chat), 400);
  chat.duty.last_hit_at = 0;
  assert.equal(duty.activityAt(chat), 300);
  chat.last_turn = { at: 0 };
  assert.equal(duty.activityAt(chat), 200);
});

test("markClosing enters a 2-day observation; cancelClosing returns to watch", () => {
  const { chat } = setup();
  chat.watching = true;
  chat.duty.state = "watch";
  assert.equal(duty.markClosing(chat, { reason: "任务已完成：已上线", now: 1000, days: 2 }), true);
  assert.equal(chat.duty.state, "closing");
  assert.equal(chat.duty.trigger, "warm");
  assert.equal(chat.duty.by, "agent");
  assert.equal(chat.duty.decided_at, 1000);
  assert.equal(chat.duty.close_at, 1000 + 2 * 86400);
  assert.match(chat.duty.reason, /已上线/);

  assert.equal(duty.cancelClosing(chat, { now: 2000, reason: "有新消息" }), true);
  assert.equal(chat.duty.state, "watch");
  assert.equal(chat.duty.close_at, 0);
  assert.match(chat.duty.reason, /有新消息/);
});

test("markClosing refuses empty reasons, unwatched chats, and non-watch states", () => {
  const { chat } = setup();
  chat.watching = false;
  assert.equal(duty.markClosing(chat, { reason: "已验收" }), false);
  chat.watching = true;
  assert.equal(duty.markClosing(chat, { reason: "  " }), false);
  chat.duty.state = "trial";
  assert.equal(duty.markClosing(chat, { reason: "已验收" }), false);
});

test("parseClosingMarker only accepts the exact task-done line", () => {
  assert.equal(duty.parseClosingMarker("[值守收尾] 任务已完成：已验收"), "已验收");
  assert.equal(duty.parseClosingMarker("前文\n[值守收尾] 任务已完成: 已关单\n后文"), "已关单");
  assert.equal(duty.parseClosingMarker("[值守收尾] 继续值守：还有待办"), "");
  assert.equal(duty.parseClosingMarker("普通回复 [值守收尾] 任务已完成：不算"), "");
  const long = "一".repeat(80);
  assert.equal(duty.parseClosingMarker(`[值守收尾] 任务已完成：${long}`).length, 40);
});

test("retire accepts a custom reason for task-done closing", () => {
  const { chat } = setup();
  chat.watching = true;
  chat.duty.state = "closing";
  chat.duty.close_at = 1234;
  assert.equal(duty.retire(chat, { days: 2, now: 2000, reason: "任务已完成，2 天无新活" }), true);
  assert.equal(chat.duty.state, "retired");
  assert.equal(chat.duty.close_at, 0);
  assert.equal(chat.duty.reason, "任务已完成，2 天无新活");
});
