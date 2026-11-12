import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State, RECENT_LIMIT, STATE_VERSION, isPendingMessage, messageMatches,
  normalizeConfig, publicConfig } from "../lib/state.js";

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
  assert.equal(cfg.dsh.timeout, 120);
  assert.equal(cfg.dsh.turn_cap_sec, 3600);
  assert.equal(cfg.dsh.full_access, false);
  assert.equal(cfg.ui, undefined);
  assert.equal(cfg.seed_targets, undefined);
  assert.equal(cfg.dsh.profile, undefined);
  assert.equal(cfg.send_mode_default, "draft");
  assert.equal(publicConfig(cfg, true).resolved.dsh_ready, true);
});

test("send_mode_default defaults to draft and only accepts draft / auto", () => {
  assert.equal(normalizeConfig({}).send_mode_default, "draft");
  assert.equal(normalizeConfig({ send_mode_default: "auto" }).send_mode_default, "auto");
  assert.equal(normalizeConfig({ send_mode_default: "draft" }).send_mode_default, "draft");
  for (const bad of ["AUTO", "Auto", "manual", "full", "", null, true, 1, {}]) {
    assert.equal(normalizeConfig({ send_mode_default: bad }).send_mode_default, "draft", String(bad));
  }
  assert.equal(publicConfig({ send_mode_default: "auto" }, true).send_mode_default, "auto");
});

test("unreleased global send_mode migrates to send_mode_default and is dropped", () => {
  assert.equal(normalizeConfig({ send_mode: "auto" }).send_mode_default, "auto");
  assert.equal(normalizeConfig({ send_mode: "nonsense" }).send_mode_default, "draft");
  const cfg = normalizeConfig({ send_mode: "auto", send_mode_default: "draft" });
  assert.equal(cfg.send_mode_default, "draft", "新键优先");
  assert.equal(cfg.send_mode, undefined);
});

test("new chats keep send_mode empty until they become watched", () => {
  const { state } = tempState();
  state.data.config.send_mode_default = "auto";
  const chat = state.ensureChat("feishu", "oc_new", { kind: "p2p" });
  assert.equal(chat.send_mode, "");
});

test("loading an old global send_mode fixes watched chats and leaves unwatched empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-state-send-"));
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    version: 2,
    config: { send_mode: "auto" },
    chats: {
      "feishu:oc_watched": {
        platform: "feishu", chat_id: "oc_watched", name: "值守中", kind: "p2p",
        watching: true, timer: 1,
      },
      "feishu:oc_idle": {
        platform: "feishu", chat_id: "oc_idle", name: "没值守", kind: "p2p",
        watching: false, timer: 0,
      },
      "feishu:oc_explicit": {
        platform: "feishu", chat_id: "oc_explicit", name: "显式草稿", kind: "p2p",
        watching: true, timer: 1, send_mode: "draft",
      },
    },
  }, null, 2));
  const state = new State(dir);
  state.load();
  assert.equal(state.data.config.send_mode_default, "auto");
  assert.equal(state.data.config.send_mode, undefined);
  assert.equal(state.getChat("feishu", "oc_watched").send_mode, "auto");
  assert.equal(state.getChat("feishu", "oc_idle").send_mode, "");
  assert.equal(state.getChat("feishu", "oc_explicit").send_mode, "draft");
});

test("dsh.full_access only accepts explicit true", () => {
  assert.equal(normalizeConfig({ dsh: { full_access: true } }).dsh.full_access, true);
  assert.equal(normalizeConfig({ dsh: { full_access: 1 } }).dsh.full_access, true);
  assert.equal(normalizeConfig({ dsh: { full_access: "true" } }).dsh.full_access, true);
  assert.equal(normalizeConfig({ dsh: { full_access: "yes" } }).dsh.full_access, false);
  assert.equal(normalizeConfig({ dsh: { full_access: false } }).dsh.full_access, false);
});

test("dsh.ack_reaction defaults on and only explicit off disables it", () => {
  assert.equal(normalizeConfig({}).dsh.ack_reaction, true);
  assert.equal(normalizeConfig({ dsh: {} }).dsh.ack_reaction, true);
  assert.equal(normalizeConfig({ dsh: { ack_reaction: true } }).dsh.ack_reaction, true);
  assert.equal(normalizeConfig({ dsh: { ack_reaction: "yes" } }).dsh.ack_reaction, true);
  for (const off of [false, 0, "0", "false", "no", "off", ""]) {
    assert.equal(normalizeConfig({ dsh: { ack_reaction: off } }).dsh.ack_reaction, false, String(off));
  }
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

test("plugin platforms whitelist keeps the three supported platforms", () => {
  assert.deepEqual(normalizeConfig({ platforms: ["dingtalk"] }).platforms, ["dingtalk"]);
  assert.deepEqual(normalizeConfig({ platforms: ["dingtalk", "feishu", "slack"] }).platforms,
    ["dingtalk", "feishu"]);
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

test("warm key has default, clamps to 0..1440, and 0 disables", () => {
  const cfg = normalizeConfig({});
  assert.equal(cfg.dsh.warm_min, 55);
  assert.equal(normalizeConfig({ dsh: { warm_min: 0 } }).dsh.warm_min, 0);
  assert.equal(normalizeConfig({ dsh: { warm_min: 99999 } }).dsh.warm_min, 1440);
  assert.equal(normalizeConfig({ dsh: { turn_cap_sec: -5 } }).dsh.turn_cap_sec, 0);
  assert.equal(normalizeConfig({ dsh: { turn_cap_sec: 99999 * 24 } }).dsh.turn_cap_sec, 86400);
});

test("retired idle_reset_min is dropped from old configs", () => {
  const cfg = normalizeConfig({ dsh: { idle_reset_min: 90, warm_min: 55 } });
  assert.equal("idle_reset_min" in cfg.dsh, false);
  assert.equal(cfg.dsh.warm_min, 55);
});

test("old state gets warm/reset defaults; setSession records the reset reason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-state-life-"));
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    version: 1,
    chats: {
      "feishu:oc_life": {
        platform: "feishu", chat_id: "oc_life", name: "旧会话", kind: "p2p",
        watching: true, dsh_session: "session-1", recent: [],
      },
    },
  }, null, 2));
  const state = new State(dir);
  state.load();
  const chat = state.getChat("feishu", "oc_life");
  assert.equal(chat.last_warm_at, 0);
  assert.equal(chat.last_warm_ok, null);
  assert.deepEqual(chat.last_reset, { at: 0, reason: "" });

  chat.last_warm_at = 123;
  chat.last_warm_ok = true;
  state.setSession(chat, "", "idle");
  assert.equal(chat.dsh_session, "");
  assert.equal(chat.session_turns, 0);
  assert.equal(chat.last_reset.reason, "idle");
  assert.ok(chat.last_reset.at > 0);
  // 保温结果属于旧会话：换会话后面板不该显示上一个会话的“上次保温”。
  assert.equal(chat.last_warm_at, 0);
  assert.equal(chat.last_warm_ok, null);

  // 已有空绑定再清一次不覆盖上次原因，也不报错。
  state.setSession(chat, "", "manual");
  assert.equal(chat.last_reset.reason, "idle");
});

test("version 1 DMs migrate to wake_mode=all once and keep an explicit mention afterwards", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-state-wake-"));
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({
    version: 1,
    chats: {
      "feishu:oc_dm": {
        platform: "feishu", chat_id: "oc_dm", name: "旧私聊", kind: "p2p",
        watching: true, wake_mode: "mention", recent: [],
      },
      "feishu:oc_grp": {
        platform: "feishu", chat_id: "oc_grp", name: "旧群", kind: "group",
        watching: true, timer: 1, wake_mode: "all", recent: [],
      },
    },
  }, null, 2));

  const state = new State(dir);
  state.load();
  assert.equal(state.data.version, STATE_VERSION);
  // 老数据里私聊的 mention 只是群策略默认值，私聊当时恒为 dm，按真实行为落成 all。
  assert.equal(state.getChat("feishu", "oc_dm").wake_mode, "all");
  assert.equal(state.getChat("feishu", "oc_grp").wake_mode, "all", "群的选择不受迁移影响");

  state.save();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(saved.version, STATE_VERSION);

  // 迁移只做一次：用户改成只认 @ 后，重新加载不能被改回 all。
  const dm = state.getChat("feishu", "oc_dm");
  dm.wake_mode = "mention";
  state.save();
  const again = new State(dir);
  again.load();
  assert.equal(again.getChat("feishu", "oc_dm").wake_mode, "mention");
});

test("new chats default to group mention / DM all", () => {
  const { state } = tempState();
  assert.equal(state.ensureChat("feishu", "oc_new_dm", { name: "新私聊" }).wake_mode, "all");
  assert.equal(state.ensureChat("feishu", "oc_new_grp", { name: "新群", kind: "group" }).wake_mode, "mention");
});

test("kind correction keeps the chosen wake_mode but keeps watched groups pulling", () => {
  const { state } = tempState();
  const chat = state.ensureChat("feishu", "oc_kind", { name: "先当私聊" });
  assert.equal(chat.wake_mode, "all");
  assert.equal(chat.timer, 0);
  chat.watching = true;
  state.ensureChat("feishu", "oc_kind", { name: "其实是群", kind: "group" });
  assert.equal(chat.kind, "group");
  assert.equal(chat.wake_mode, "all", "用户选的「全部消息」在两种 kind 下同名同义，不该被纠正改写");
  assert.equal(chat.timer, 1, "认成群后仍要 timer=1，否则静默不再拉");

  // 反向：群 → 私聊不动关注程度与 timer。
  const g = state.ensureChat("feishu", "oc_kind2", { name: "群", kind: "group" });
  g.watching = true;
  g.timer = 1;
  state.ensureChat("feishu", "oc_kind2", { kind: "p2p" });
  assert.equal(g.kind, "p2p");
  assert.equal(g.wake_mode, "mention");
  assert.equal(g.timer, 1, "私聊 timer=-1 才表示不盯；1 保持拉取");
});

test("cmd pointers survive normalization and never count as pending", () => {
  const { state } = tempState();
  const chat = state.ensureChat("feishu", "oc_cmd", { name: "对象", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [
    { msg_id: "c1", sender_id: "ou_me", sender_name: "我", content: "@我 帮我回一句",
      ts: "t1", ts_epoch: 100, kind: "cmd", state: "new" },
    { msg_id: "c2", sender_id: "ou_other", sender_name: "对方", content: "在吗",
      ts: "t2", ts_epoch: 101, kind: "dm", state: "new" },
  ]);
  const cmd = chat.recent.find((m) => m.msg_id === "c1");
  assert.equal(cmd.kind, "cmd", "normalize 不能把 cmd 降级成 fyi");
  assert.equal(cmd.content, "@我 帮我回一句");
  assert.equal(isPendingMessage(cmd, chat), false);
  assert.equal(messageMatches(cmd, "todo"), false);
  assert.equal(messageMatches(cmd, "unread"), false);
  assert.equal(messageMatches(cmd, "all"), true, "「全部」筛选里能看到本人指令");
  assert.equal(state.pendingCount(chat), 1, "只有对面那条算待回");
  assert.equal(state.counts().unread, 1);
});
