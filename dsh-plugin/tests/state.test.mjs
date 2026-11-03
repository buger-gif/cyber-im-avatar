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
  assert.equal(cfg.dsh.full_access, false);
  assert.equal(cfg.ui, undefined);
  assert.equal(cfg.seed_targets, undefined);
  assert.equal(cfg.dsh.profile, undefined);
  assert.equal(publicConfig(cfg, true).resolved.dsh_ready, true);
});

test("dsh.full_access only accepts explicit true", () => {
  assert.equal(normalizeConfig({ dsh: { full_access: true } }).dsh.full_access, true);
  assert.equal(normalizeConfig({ dsh: { full_access: 1 } }).dsh.full_access, true);
  assert.equal(normalizeConfig({ dsh: { full_access: "true" } }).dsh.full_access, true);
  assert.equal(normalizeConfig({ dsh: { full_access: "yes" } }).dsh.full_access, false);
  assert.equal(normalizeConfig({ dsh: { full_access: false } }).dsh.full_access, false);
});

test("fast lane interval clamps to 0 or 20..interval", () => {
  assert.equal(normalizeConfig({}).poll.fast_sec, 60);
  assert.equal(normalizeConfig({ poll: { fast_sec: 0 } }).poll.fast_sec, 0);
  assert.equal(normalizeConfig({ poll: { fast_sec: 5 } }).poll.fast_sec, 20);
  assert.equal(normalizeConfig({ poll: { fast_sec: 9999 } }).poll.fast_sec, 600);
  // 快车道不能比慢车道还慢
  assert.equal(normalizeConfig({ poll: { fast_sec: 120, interval_min: 10 } }).poll.fast_sec, 120);
  assert.equal(normalizeConfig({ poll: { fast_sec: 900, interval_min: 10 } }).poll.fast_sec, 600);
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

test("plugin platforms whitelist ignores dingtalk but keeps the default otherwise", () => {
  assert.deepEqual(normalizeConfig({ platforms: ["dingtalk"] }).platforms, []);
  assert.deepEqual(normalizeConfig({ platforms: ["dingtalk", "feishu"] }).platforms, ["feishu"]);
  assert.deepEqual(normalizeConfig({}).platforms, ["feishu", "wecom"]);
  assert.deepEqual(normalizeConfig({ platforms: [] }).platforms, ["feishu", "wecom"]);
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

test("old state without last_msg_id / media fields loads with safe defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-state-old-"));
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    version: 1,
    chats: {
      "feishu:oc_old": {
        platform: "feishu", chat_id: "oc_old", name: "旧会话", kind: "p2p",
        watching: true, last_epoch: 100,
        recent: [{ msg_id: "m1", sender_id: "ou_1", sender_name: "客户", content: "旧正文",
                   ts: "t1", ts_epoch: 100, kind: "dm", state: "new" }],
      },
    },
  }, null, 2));
  const state = new State(dir);
  state.load();
  const chat = state.getChat("feishu", "oc_old");
  assert.equal(chat.last_msg_id, "");
  assert.deepEqual(Object.keys(chat.recent[0]), [
    "msg_id", "sender_id", "sender_name", "content", "ts", "ts_epoch", "kind", "state",
    "msg_type", "app_link", "media_id", "media_paths",
  ]);
  assert.equal(chat.recent[0].msg_type, "");
  assert.deepEqual(chat.recent[0].media_paths, []);
});

test("mergeRecent fills media metadata without rolling back state or content", () => {
  const { state } = tempState();
  const chat = state.ensureChat("feishu", "oc_x", {});
  state.mergeRecent(chat, [msg("m1", 100)]);
  state.setMessageState("feishu", "m1", "replied");
  state.mergeRecent(chat, [msg("m1", 100, {
    msg_type: "image", app_link: "https://example.invalid/open", media_id: "img_1",
    media_paths: ["/tmp/media/img.png"], content: "不应覆盖",
  })]);
  const row = chat.recent[0];
  assert.equal(row.msg_type, "image");
  assert.equal(row.app_link, "https://example.invalid/open");
  assert.equal(row.media_id, "img_1");
  assert.deepEqual(row.media_paths, ["/tmp/media/img.png"]);
  assert.equal(row.state, "replied");
  assert.equal(row.content, "");
});

test("pruneMediaPaths removes deleted files and keeps live ones", () => {
  const { state } = tempState();
  const chat = state.ensureChat("feishu", "oc_x", {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-media-prune-"));
  const live = path.join(dir, "a.png");
  fs.writeFileSync(live, "x");
  state.mergeRecent(chat, [msg("m1", 100, {
    media_paths: [live, path.join(dir, "gone.png")],
  })]);
  assert.equal(state.pruneMediaPaths(), true);
  assert.deepEqual(chat.recent[0].media_paths, [live]);
});
