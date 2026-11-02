import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import { Profiles } from "../lib/profiles.js";
import { Turns, buildPrompt } from "../lib/turns.js";

function recent(n = 2) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push({
      msg_id: `m${i}`, sender_id: "ou_other", sender_name: "客户",
      content: `消息 ${i}`, ts: `t${i}`, ts_epoch: 100 + i, kind: "dm", state: "new",
    });
  }
  return out;
}

test("prompt carries skill entry, chat, profile, recent 10 and shell marker", () => {
  const prompt = buildPrompt("feishu", "示例对象 A", "oc_abc", recent(3), {
    profilePath: "/tmp/profile.md", profileText: "# 示例对象 A\n\n审核同学\n",
  });
  assert.match(prompt, /^\/cyber-im-avatar/);
  assert.match(prompt, /运行形态：DSH 插件壳/);
  assert.match(prompt, /不要运行 listen_cli\/bootstrap\.py/);
  assert.match(prompt, /chat_id：oc_abc/);
  assert.match(prompt, /审核同学/);
  assert.match(prompt, /最近 10 条/);
  assert.match(prompt, /消息 2/);
  assert.match(prompt, /im-profile-update/);
  assert.doesNotMatch(prompt, /阻塞轮询|零 token|启动监听/);
});

class FakeHost {
  constructor({ reply = "收到" } = {}) {
    this.reply = reply;
    this.events = [];
    this.listeners = new Set();
    this.followups = [];
    this.created = [];
    this.flushed = 0;
    this.agent = {
      id: "session-1",
      session: { id: "session-1", header: { cwd: "" } },
      inbox: { removed: [], remove(id) { this.removed.push(id); } },
      cancel: () => { this.cancelled = true; },
      followup: (message) => {
        this.followups.push(message);
        queueMicrotask(() => {
          this.emit({ type: "turn/start", seq: 1, data: { turn: 1 } });
          this.emit({ type: "user/message", seq: 2, data: { id: message.id } });
          this.emit({ type: "assistant/message", seq: 3, data: {
            turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: this.reply }] },
          } });
          this.emit({ type: "turn/end", seq: 4, data: { turn: 1, reason: { kind: "completed" } } });
        });
      },
    };
    this.sessionController = {
      resolveAgent: async (sid) => (sid === "session-1" ? { agent: this.agent } : null),
      create: async (req) => {
        this.created.push(req);
        if (req.cwd) this.agent.session.header.cwd = req.cwd;
        return { sessionId: "session-1" };
      },
    };
    this.sessions = { flush: async () => { this.flushed += 1; return true; } };
    this.ctx = {
      on: (name, cb) => {
        assert.equal(name, "session/event");
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
      },
    };
  }
  emit(event) {
    for (const cb of this.listeners) cb(this.agent.session, event);
  }
}

function setup(hostOpts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-turn-"));
  const state = new State(dir);
  state.load();
  state.data.config.dsh.timeout = 30;
  const profiles = new Profiles(dir);
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A" });
  chat.watching = true;
  chat.workspace = dir;
  const host = new FakeHost(hostOpts);
  const turns = new Turns({ state, profiles, logger: { warn() {}, info() {}, error() {} } });
  turns.setHost(host, host.ctx);
  return { dir, state, profiles, chat, host, turns };
}

test("live turn follows up, waits for turn/end, stores session and counts the turn", async () => {
  const { state, chat, host, turns } = setup({ reply: "好的，我看下。" });
  const r = await turns.wake(chat);
  assert.equal(r.ok, true);
  assert.equal(r.started, true);
  assert.equal(host.followups.length, 1);
  assert.match(host.followups[0].content[0].text, /^\/cyber-im-avatar/);
  assert.equal(host.flushed, 1);
  assert.equal(chat.dsh_session, "session-1");
  assert.equal(chat.session_turns, 1);
  assert.equal(chat.last_turn.ok, true);
  assert.equal(chat.wake.active, false);
  assert.equal(chat.last_error, "");
  await new Promise((r2) => setTimeout(r2, 5));
  assert.equal(turns.isActive("feishu", "oc_abc"), false);
});

test("second wake reuses the bound session instead of creating another", async () => {
  const { chat, host, turns } = setup({ reply: "第一轮" });
  await turns.wake(chat);
  assert.equal(host.created.length, 1);
  assert.equal(chat.dsh_session, "session-1");
  await new Promise((r) => setTimeout(r, 5));

  host.reply = "第二轮";
  const r = await turns.wake(chat);
  assert.equal(r.ok, true);
  assert.equal(host.created.length, 1);
  assert.equal(host.followups.length, 2);
  assert.equal(chat.session_turns, 2);
});

test("successful turn applies an im-profile-update block through mtime CAS", async () => {
  const { dir, profiles, chat, host, turns } = setup({
    reply: "已处理。\n\n<!-- im-profile-update\n# 示例对象 A\n\n- 负责审核\n-->\n",
  });
  const before = profiles.ensure("feishu", "oc_abc", "示例对象 A");
  await turns.wake(chat);
  await new Promise((r) => setTimeout(r, 5));
  const text = fs.readFileSync(before.path, "utf8");
  assert.match(text, /负责审核/);
  assert.ok(text.endsWith("\n"));
  assert.equal(host.followups.length, 1);
});

test("agent profile block is dropped when the user edited the profile during the turn", async () => {
  const { profiles, chat, host, turns } = setup({
    reply: "<!-- im-profile-update\n# agent\n-->\n",
  });
  const before = profiles.ensure("feishu", "oc_abc", "示例对象 A");
  const slow = host.agent.followup;
  host.agent.followup = (message) => {
    profiles.write("feishu", "oc_abc", "示例对象 A", "# 用户手改\n");
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(before.path, future, future);
    slow(message);
  };
  await turns.wake(chat);
  await new Promise((r) => setTimeout(r, 10));
  assert.match(fs.readFileSync(before.path, "utf8"), /用户手改/);
});

test("explicit missing workspace fails before creating any session", async () => {
  const { chat, host, turns } = setup();
  chat.workspace = path.join(os.tmpdir(), "definitely-not-here-" + Date.now());
  const r = await turns.wake(chat);
  assert.equal(r.ok, false);
  assert.match(r.reason, /workspace_missing/);
  assert.equal(host.created.length, 0);
  assert.equal(chat.wake.active, false);
  assert.equal(chat.wake.failed, true);
});

test("host unavailable reports a reason instead of pretending to start", async () => {
  const { chat, turns } = setup();
  turns.sessionController = null;
  turns.sessions = null;
  const r = await turns.wake(chat);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "host_unavailable");
});

test("a writer held by another DSH host fails as session_locked_other_host", async () => {
  const { chat, host, turns } = setup();
  chat.dsh_session = "session-other";
  host.sessionController.resolveAgent = async () => ({
    error: { code: "session/writer-held", message: "held" },
  });
  const r = await turns.wake(chat);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "session_locked_other_host");
  assert.equal(host.created.length, 0);
});

test("cancelling a turn clears its active flag and does not count a turn", async () => {
  const { chat, host, turns } = setup();
  host.agent.followup = (message) => {
    host.followups.push(message);
    // 永不产生 turn/end：模拟 agent 卡住。
  };
  const started = await turns.wake(chat);
  assert.equal(started.started, true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(turns.cancel("feishu", "oc_abc"), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(turns.isActive("feishu", "oc_abc"), false);
  assert.equal(chat.wake.active, false);
  assert.equal(chat.session_turns, 0);
  assert.equal(chat.last_turn.ok, null);
});
