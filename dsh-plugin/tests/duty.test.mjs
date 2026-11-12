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
