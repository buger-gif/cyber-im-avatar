import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State, RECENT_LIMIT, normalizeConfig, publicConfig } from "../lib/state.js";

function tempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-state-"));
  const state = new State(dir);
  state.load();
  return { dir, state };
}

function msg(id, epoch, extra = {}) {
  return {
    msg_id: id, sender_id: "ou_other", sender_name: "对方",
    content: `正文-${id}`, ts: `t-${epoch}`, ts_epoch: epoch,
    kind: "dm", state: "new", ...extra,
  };
}

test("config clamps poll floor to 10 minutes and drops retired keys", () => {
  const cfg = normalizeConfig({
    poll: { interval_min: 1, per_chat_limit: 999, cooldown_sec: 9999 },
    dsh: { timeout: 1, profile: "headless" },
    ui: { skin: "studio" }, seed_targets: true,
  });
  assert.equal(cfg.poll.interval_min, 10);
  assert.equal(cfg.poll.per_chat_limit, 50);
  assert.equal(cfg.poll.cooldown_sec, 600);
  assert.equal(cfg.dsh.timeout, 30);
  assert.equal(cfg.ui, undefined);
  assert.equal(cfg.seed_targets, undefined);
  assert.equal(cfg.dsh.profile, undefined);
  assert.equal(publicConfig(cfg, true).resolved.dsh_ready, true);
});

test("old 0.3 config keys translate without leaking into runtime config", () => {
  const cfg = normalizeConfig({
    poll_interval: 600, recent_chats: 12, per_chat_limit: 8,
    backfill_hours: 24, poll_watched_only: true, port: 8765,
    chatlist_interval: 300, platforms: ["feishu"],
  });
  assert.equal(cfg.poll.interval_min, 10);
  assert.equal(cfg.poll.dm_recent, 12);
  assert.equal(cfg.poll.per_chat_limit, 8);
  assert.equal(cfg.poll.backfill_hours, 24);
  assert.equal(cfg.poll.dm_scope, "watched");
  for (const k of ["poll_interval", "recent_chats", "per_chat_limit", "backfill_hours",
    "poll_watched_only", "port", "chatlist_interval"]) {
    assert.equal(cfg[k], undefined, k);
  }
});

test("new group defaults to timer=-1, dm defaults to timer=0", () => {
  const { state } = tempState();
  assert.equal(state.ensureChat("feishu", "oc_group", { kind: "group" }).timer, -1);
  assert.equal(state.ensureChat("feishu", "oc_dm", { kind: "p2p" }).timer, 0);
});

test("target display names stay unique without touching existing names", () => {
  const { state } = tempState();
  const a = state.ensureChat("feishu", "oc_a", { name: "同名", kind: "p2p", target: true });
  const b = state.ensureChat("feishu", "oc_b", { name: "同名", kind: "p2p", target: true });
  const c = state.ensureChat("feishu", "oc_c", { name: "同名", kind: "p2p", target: false });
  assert.equal(a.name, "同名");
  assert.equal(b.name, "同名 (2)");
  assert.equal(c.name, "同名");
});

test("recent keeps at most 10 newest and clears bodies when not pending", () => {
  const { state } = tempState();
  const chat = state.ensureChat("feishu", "oc_x", { name: "X", kind: "p2p" });
  const rows = [];
  for (let i = 0; i < 12; i += 1) rows.push(msg(`m${i}`, 100 + i));
  state.mergeRecent(chat, rows);
  assert.equal(chat.recent.length, RECENT_LIMIT);
  assert.equal(chat.recent[0].msg_id, "m11");
  assert.equal(chat.recent.at(-1).msg_id, "m2");
  assert.ok(chat.recent.every((m) => m.content));

  state.setMessageState("feishu", "m11", "replied");
  assert.equal(chat.recent.find((m) => m.msg_id === "m11").content, "");
});

test("mergeRecent dedupes by msg_id and keeps newest first", () => {
  const { state } = tempState();
  const chat = state.ensureChat("feishu", "oc_x", {});
  state.mergeRecent(chat, [msg("a", 100), msg("b", 200)]);
  state.mergeRecent(chat, [msg("b", 200), msg("c", 300)]);
  assert.deepEqual(chat.recent.map((m) => m.msg_id), ["c", "b", "a"]);
});

test("pending counts/ignored cleanup derive from recent only", () => {
  const { state } = tempState();
  const a = state.ensureChat("feishu", "oc_a", {});
  const b = state.ensureChat("feishu", "oc_b", {});
  a.watching = true;
  b.watching = false;
  a.recent = [msg("a1", 3), msg("a2", 2, { state: "opened" })];
  b.recent = [msg("b1", 1)];
  assert.deepEqual(state.counts(), { unread: 2, todo: 3, unread_dm: 2, unread_mention: 0 });
  assert.equal(state.pendingCount(a), 2);
  assert.equal(state.ignoreUnwatched(), 1);
  assert.equal(b.recent[0].state, "ignored");
  assert.equal(b.recent[0].content, "");
});

test("state survives save/reload and stale active wake becomes failed", () => {
  const { dir, state } = tempState();
  const chat = state.ensureChat("feishu", "oc_x", { name: "X" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m1", 10)]);
  chat.wake = { at: 1, failed: false, turn_id: "t", active: true };
  state.save();

  const again = new State(dir);
  again.load();
  const loaded = again.getChat("feishu", "oc_x");
  assert.equal(loaded.recent[0].msg_id, "m1");
  assert.equal(loaded.wake.active, false);
  assert.equal(loaded.wake.failed, true);
  assert.equal(loaded.last_turn.reason, "restarted");
});

test("state.json is private and keeps a backup", () => {
  const { dir, state } = tempState();
  state.ensureChat("feishu", "oc_x", {});
  state.save();
  state.save();
  assert.equal(fs.statSync(path.join(dir, "state.json")).mode & 0o777, 0o600);
  assert.ok(fs.existsSync(path.join(dir, "state.json.bak")));
});
