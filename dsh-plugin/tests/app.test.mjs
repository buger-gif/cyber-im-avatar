import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { State } from "../lib/state.js";
import { Profiles } from "../lib/profiles.js";
import { App } from "../lib/app.js";

function msg(id, epoch, extra = {}) {
  return {
    msg_id: id, sender_id: "ou_other", sender_name: "客户",
    content: `正文-${id}`, ts: `t-${epoch}`, ts_epoch: epoch,
    kind: "dm", state: "new", ...extra,
  };
}

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-app-"));
  const state = new State(dir);
  state.load();
  const profiles = new Profiles(dir);
  const calls = { send: [], wake: [], open: [], cancel: [], poll: [], fetchThread: [] };
  const turns = {
    hostReady: () => true,
    isActive: () => false,
    busy: () => false,
    snapshot: () => ({}),
    async wake(chat) { calls.wake.push(chat.chat_id); return { ok: true, turn_id: "turn-1" }; },
    async open(chat) { calls.open.push(chat.chat_id); return { ok: true, started: true }; },
    cancel(platform, chatId) { calls.cancel.push(chatId); return false; },
  };
  const im = {
    adapter: () => ({
      async sendText(chatId, text) { calls.send.push({ chatId, text }); return { ok: true, message_id: "om_sent" }; },
      async search(q) { return { ok: true, items: [{ id: "oc_x", name: q }] }; },
      async searchChats(q) { return { ok: true, items: [{ chat_id: "oc_g", name: q, kind: "group" }] }; },
      async fetchMessages() { return { ok: true, messages: [] }; },
      async whoami() { return { ok: true, self_id: "ou_me", name: "我" }; },
      async listChats() { return { ok: true, items: [] }; },
    }),
  };
  const poller = {
    identity: { feishu: { ok: true, self_id: "ou_me", name: "我" } },
    errors: [],
    cycles: 3,
    started: true,
    lastCycleAt: 120,
    lastCycleMs: 12,
    async status() {
      return {
        running: true, paused: false, cycles: 3, last_cycle_at: 120, last_cycle_ms: 12,
        counts: state.counts(), platforms: [], errors: [], dsh: { configured: true },
        instances: [], turns: {}, poll: this.pollInfo(),
      };
    },
    pollInfo() {
      return { interval_min: 10, interval_sec: 600, last_result: { at: 1, chats: 1, new: 0, targets: 1 }, timer_group: 0 };
    },
    reload() {},
    turnInfo() { return { state: "idle", since: 0, last_ok: null, last_reason: "", last_at: 0 }; },
    canMention(platform) { return platform !== "wecom"; },
    candidates() { return []; },
    async pollChat(platform, chatId, opts = {}) {
      calls.poll.push({ platform, chatId, opts });
      return { fetched: true, new: 0, woke: false, items: [] };
    },
    async fetchThread() {
      calls.fetchThread.push(1);
      return {
        ok: true,
        items: [
          { msg_id: "m2", sender_id: "ou_other", sender_name: "客户", content: "在线 2", ts: "t2", ts_epoch: 102 },
          { msg_id: "m1", sender_id: "ou_me", sender_name: "我", content: "在线 1", ts: "t1", ts_epoch: 101 },
        ],
        error: "",
      };
    },
    async doctor() { return { checked_at: 1, checks: [] }; },
  };
  const app = new App({ state, im, poller, turns, profiles, logger: { error() {}, warn() {}, info() {} } });
  return { dir, state, profiles, app, calls, poller };
}

test("GET /api/status exposes panel fields and clamps config", async () => {
  const { app } = makeApp();
  const out = await app.handle("/api/status", "GET");
  assert.equal(out.status, 200);
  assert.equal(out.body.running, true);
  assert.equal(out.body.poll.interval_min, 10);
  assert.equal(out.body.config.poll.min_interval_min, 10);
  assert.equal(out.body.config.dsh.timeout, 600);
  assert.equal(out.body.config.ui, undefined);
});

test("watch creates target + profile; unwatch cancels without deleting the target", async () => {
  const { app, state, profiles, calls } = makeApp();
  let out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_abc", name: "示例对象 A", kind: "p2p", watching: true,
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("feishu", "oc_abc");
  assert.equal(chat.watching, true);
  assert.equal(chat.target, true);
  assert.ok(fs.existsSync(profiles.pathFor("feishu", "oc_abc", "示例对象 A")));
  assert.deepEqual(calls.open, ["oc_abc"], "加入值守立刻起一次开场会话");
  assert.equal(out.body.open.ok, true);
  assert.deepEqual(calls.poll.at(-1).opts, { name: "示例对象 A", kind: "p2p", force: true, wake: false });

  out = await app.handle("/api/unwatch", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(out.body.ok, true);
  assert.equal(chat.watching, false);
  assert.equal(chat.target, true);
  assert.deepEqual(calls.cancel, ["oc_abc"]);
});

test("inbox groups derive previews from recent only", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m2", 102), msg("m1", 101, { state: "opened" })]);
  const out = await app.handle("/api/inbox", "GET", new URLSearchParams("filter=todo&limit=40"));
  assert.equal(out.body.grouped, true);
  assert.equal(out.body.items.length, 1);
  assert.equal(out.body.items[0].chat_name, "示例对象 A");
  assert.equal(out.body.items[0].count, 2);
  assert.equal(out.body.items[0].preview[0].msg_id, "m2");
  assert.equal(out.body.counts.todo, 2);
});

test("thread reads online messages and overlays cached states", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  state.mergeRecent(chat, [msg("m2", 102, { state: "opened" })]);
  const out = await app.handle("/api/thread", "GET", new URLSearchParams("platform=feishu&chat_id=oc_abc&limit=30"));
  assert.equal(out.status, 200);
  assert.equal(out.body.online, true);
  assert.equal(out.body.items.length, 2);
  assert.equal(out.body.items[0].msg_id, "m1");
  assert.equal(out.body.items[1].msg_id, "m2");
  assert.equal(out.body.items[1].state, "opened");
  assert.equal(out.body.items[0].is_self, true);
  assert.equal(out.body.chat.recent, undefined);
});

test("/api/state only affects cached messages and reports not_cached otherwise", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", {});
  state.mergeRecent(chat, [msg("m1", 101)]);
  let out = await app.handle("/api/state", "POST", null, { platform: "feishu", msg_id: "m1", state: "ignored" });
  assert.equal(out.body.ok, true);
  assert.equal(chat.recent[0].state, "ignored");
  out = await app.handle("/api/state", "POST", null, { platform: "feishu", msg_id: "old", state: "ignored" });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "not_cached");
});

test("targets page reads workbooks and saves by chat_id before legacy display name", async () => {
  const { app, state, profiles } = makeApp();
  state.ensureChat("feishu", "oc_a", { name: "同名", kind: "p2p", target: true });
  state.ensureChat("feishu", "oc_b", { name: "同名", kind: "p2p", target: true });
  let out = await app.handle("/api/targets", "GET");
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.items.map((t) => t.name).sort(), ["同名", "同名 (2)"]);
  const target = out.body.items.find((t) => t.name === "同名 (2)");
  assert.equal(target.chat_id, "oc_b");
  assert.match(target.profile, /^# 同名/m);

  // 旧面板只给 platform+name：兼容，写到「同名 (2)」那个会话。
  out = await app.handle("/api/targets/profile", "POST", null, {
    platform: "feishu", name: "同名 (2)", text: "# 同名\n\n- 第二个对象\n",
  });
  assert.equal(out.body.ok, true);
  assert.match(fs.readFileSync(profiles.pathFor("feishu", "oc_b", "同名"), "utf8"), /第二个对象/);

  // 新面板给 chat_id：即使带了会歧义的 name，也只写 chat_id 指向的会话，同名不串。
  out = await app.handle("/api/targets/profile", "POST", null, {
    platform: "feishu", chat_id: "oc_a", name: "同名 (2)", text: "# 同名\n\n- 按 chat_id 写\n",
  });
  assert.equal(out.body.ok, true);
  assert.match(fs.readFileSync(profiles.pathFor("feishu", "oc_a", "同名"), "utf8"), /按 chat_id 写/);
  assert.doesNotMatch(
    fs.readFileSync(profiles.pathFor("feishu", "oc_b", "同名"), "utf8"),
    /按 chat_id 写/,
  );

  // chat_id 不存在、name 也不匹配：not_found，不新造文件。
  out = await app.handle("/api/targets/profile", "POST", null, {
    platform: "feishu", chat_id: "oc_missing", text: "x",
  });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "not_found");
});

test("GET /api/persons lists person files without creating anything", async () => {
  const { app, profiles } = makeApp();
  let out = await app.handle("/api/persons", "GET");
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.items, []);
  assert.equal(fs.existsSync(profiles.peopleRoot), false, "列表只读：不建 people/ 目录");

  profiles.writePerson("feishu", "ou_zhang", "张三", "# 张三\n\n- 采购负责人，先结论后细节\n");
  profiles.writePerson("wecom", "user_li", "李四", "# 李四\n\n- 财务\n");
  out = await app.handle("/api/persons", "GET");
  assert.equal(out.body.ok, true);
  assert.deepEqual(
    out.body.items.map((p) => `${p.platform}:${p.person_id}`).sort(),
    ["feishu:ou_zhang", "wecom:user_li"],
  );
  const zhang = out.body.items.find((p) => p.person_id === "ou_zhang");
  assert.equal(zhang.name, "张三");
  assert.match(zhang.profile, /先结论后细节/);
  assert.match(zhang.profile_excerpt, /采购负责人/);
  assert.equal(zhang.profile_path, profiles.personPathFor("feishu", "ou_zhang"));
  assert.ok(zhang.profile_updated_at > 0);
  assert.equal(zhang.bytes, Buffer.byteLength(zhang.profile, "utf8"));
  assert.deepEqual(zhang.chat_ids, []);

  out = await app.handle("/api/persons", "GET", new URLSearchParams("platform=wecom"));
  assert.deepEqual(out.body.items.map((p) => p.person_id), ["user_li"]);
});

test("GET /api/persons derives chat_ids from recent senders and p2p chat ids", async () => {
  const { app, state, profiles } = makeApp();
  profiles.writePerson("feishu", "ou_zhang", "张三", "# 张三\n\n- 采购\n");
  profiles.writePerson("feishu", "ou_li", "李四", "# 李四\n\n- 财务\n");
  profiles.writePerson("feishu", "ou_wang", "王五", "# 王五\n\n- 客服\n");
  profiles.writePerson("wecom", "ou_zhang", "张三", "# 张三\n\n- 企微同名\n");

  const group = state.ensureChat("feishu", "oc_group", { name: "示例项目群", kind: "group" });
  state.mergeRecent(group, [
    msg("g2", 102, { sender_id: "ou_li", sender_name: "李四" }),
    msg("g1", 101, { sender_id: "ou_zhang", sender_name: "张三" }),
  ]);
  const dm = state.ensureChat("feishu", "oc_dm", { name: "张三", kind: "p2p" });
  state.mergeRecent(dm, [msg("d1", 103, { sender_id: "ou_zhang", sender_name: "张三" })]);
  // 没有消息的私聊：飞书 ou_ 形态的 chat_id 就是对方 open_id，按平台形态兜底。
  state.ensureChat("feishu", "ou_wang", { name: "王五", kind: "p2p" });
  const wecomGroup = state.ensureChat("wecom", "wr_1", { name: "企微群", kind: "group" });
  state.mergeRecent(wecomGroup, [msg("w1", 104, { sender_id: "ou_zhang", sender_name: "张三" })]);

  const out = await app.handle("/api/persons", "GET");
  const forPerson = (platform, id) =>
    out.body.items.find((p) => p.platform === platform && p.person_id === id);

  const zhang = forPerson("feishu", "ou_zhang");
  assert.deepEqual(zhang.chat_ids.map((c) => c.chat_id).sort(), ["oc_dm", "oc_group"]);
  assert.equal(zhang.chat_ids.find((c) => c.chat_id === "oc_group").name, "示例项目群");

  assert.deepEqual(forPerson("feishu", "ou_li").chat_ids.map((c) => c.chat_id), ["oc_group"]);
  assert.deepEqual(
    forPerson("feishu", "ou_wang").chat_ids.map((c) => c.chat_id),
    ["ou_wang"],
    "无消息私聊按 chat_id 兜底",
  );
  // 平台不串：企微同名人物只看企微会话。
  assert.deepEqual(
    forPerson("wecom", "ou_zhang").chat_ids.map((c) => `${c.platform}:${c.chat_id}`),
    ["wecom:wr_1"],
  );
});

test("POST /api/persons/profile honours base_mtime and the 12KB hard limit", async () => {
  const { app, profiles } = makeApp();
  let out = await app.handle("/api/persons/profile", "POST", null, {
    platform: "feishu", person_id: "ou_zhang", name: "张三",
    text: "# 张三\n\n- 先结论后细节\n",
  });
  assert.equal(out.body.ok, true);
  const file = profiles.personPathFor("feishu", "ou_zhang");
  assert.equal(out.body.profile_path, file);
  assert.match(out.body.profile, /先结论后细节/);
  assert.equal(out.body.profile, fs.readFileSync(file, "utf8"));
  const base = out.body.profile_updated_at;
  assert.ok(base > 0);

  // 面板拿到的 base_mtime 与磁盘一致：正常覆盖。
  out = await app.handle("/api/persons/profile", "POST", null, {
    platform: "feishu", person_id: "ou_zhang", text: "# 张三\n\n- 只看结论\n", base_mtime: base,
  });
  assert.equal(out.body.ok, true);

  // 磁盘比 base_mtime 新（agent 刚写过）：回 stale，且不覆盖。
  out = await app.handle("/api/persons/profile", "POST", null, {
    platform: "feishu", person_id: "ou_zhang", text: "# 张三\n\n- 面板旧草稿\n", base_mtime: base - 5,
  });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "stale");
  assert.match(fs.readFileSync(file, "utf8"), /只看结论/);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /面板旧草稿/);

  // 12KB 硬上限：按 UTF-8 字节拒写，不截断。
  out = await app.handle("/api/persons/profile", "POST", null, {
    platform: "feishu", person_id: "ou_zhang", text: "字".repeat(4097),
  });
  assert.equal(out.body.ok, false);
  assert.match(out.body.reason, /12KB/);
  assert.equal(fs.readFileSync(file, "utf8"), "# 张三\n\n- 只看结论\n");

  // 缺 platform / person_id：bad_request。
  out = await app.handle("/api/persons/profile", "POST", null, { text: "x" });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "bad_request");
});

test("two people with the same display name never cross-write", async () => {
  const { app, profiles } = makeApp();
  const a = profiles.writePerson("feishu", "ou_a1", "张三", "# 张三\n\n- A 的结论\n");
  const b = profiles.writePerson("feishu", "ou_b1", "张三", "# 张三\n\n- B 的结论\n");
  assert.notEqual(a.path, b.path);

  const out = await app.handle("/api/persons/profile", "POST", null, {
    platform: "feishu", person_id: "ou_a1", name: "张三", text: "# 张三\n\n- A 更新\n",
  });
  assert.equal(out.body.ok, true);
  assert.match(fs.readFileSync(a.path, "utf8"), /A 更新/);
  assert.match(fs.readFileSync(b.path, "utf8"), /B 的结论/);
  assert.doesNotMatch(fs.readFileSync(b.path, "utf8"), /A 更新/);

  const list = (await app.handle("/api/persons", "GET")).body.items
    .filter((p) => p.name === "张三").map((p) => p.person_id).sort();
  assert.deepEqual(list, ["ou_a1", "ou_b1"], "同名不同 ID 各自一份");
});

test("DELETE /api/persons deletes one file and reports whether it existed", async () => {
  const { app, profiles } = makeApp();
  const a = profiles.writePerson("feishu", "ou_a1", "张三", "# 张三\n");
  const b = profiles.writePerson("feishu", "ou_b1", "李四", "# 李四\n");

  let out = await app.handle("/api/persons", "DELETE", null,
    { platform: "feishu", person_id: "ou_a1" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.deleted, true);
  assert.equal(fs.existsSync(a.path), false);
  assert.equal(fs.existsSync(b.path), true, "只删指定那份");

  out = await app.handle("/api/persons", "DELETE", null,
    { platform: "feishu", person_id: "ou_a1" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.deleted, false, "文件本来不存在也回 ok");

  out = await app.handle("/api/persons", "DELETE", null, { platform: "feishu" });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "bad_request");
  assert.equal((await app.handle("/api/persons/profile", "DELETE")).status, 404);
});

test("/api/targets gives p2p rows the person file as their one memory file", async () => {
  const { app, state, profiles } = makeApp();
  state.ensureChat("feishu", "ou_zhang", { name: "张三", kind: "p2p", target: true });
  state.ensureChat("feishu", "oc_group", { name: "示例项目群", kind: "group", target: true });
  state.ensureChat("wecom", "zhangsan", { name: "企微张三", kind: "p2p", target: true });
  const known = profiles.writePerson("feishu", "ou_zhang", "张三", "# 张三\n\n- 采购负责人\n");

  const out = await app.handle("/api/targets", "GET");
  assert.equal(out.status, 200);
  const row = (platform, chatId) =>
    out.body.items.find((t) => t.platform === platform && t.chat_id === chatId);

  const zhang = row("feishu", "ou_zhang");
  assert.match(zhang.profile, /^# 张三/m, "单聊 profile* 就是人物档案");
  assert.equal(zhang.profile_path, known.path);
  assert.equal(zhang.person.person_id, "ou_zhang");
  assert.equal(zhang.person.path, known.path);
  assert.match(zhang.person.excerpt, /采购负责人/);
  assert.ok(zhang.person.updated_at > 0);
  assert.equal(zhang.person.exists, true);
  assert.equal(fs.existsSync(profiles.pathFor("feishu", "ou_zhang", "张三")), false,
    "单聊不再生成会话工作本");

  const wecom = row("wecom", "zhangsan");
  assert.equal(wecom.person.person_id, "zhangsan");
  assert.equal(wecom.profile_path, profiles.personPathFor("wecom", "zhangsan"));
  assert.equal(wecom.person.exists, true, "targets 会 ensure 这个会话的记忆文件");
  assert.equal(fs.existsSync(wecom.profile_path), true);
  assert.equal(fs.existsSync(profiles.pathFor("wecom", "zhangsan", "企微张三")), false);

  const group = row("feishu", "oc_group");
  assert.equal(group.person, undefined, "群不挂 person");
  assert.equal(group.profile_path, profiles.pathFor("feishu", "oc_group", "示例项目群"));
  assert.match(group.profile, /## 群内工作要求/, "群仍是会话工作本");
});

test("watch on a DM with a known sender creates the person file only", async () => {
  const { app, state, profiles } = makeApp();
  const chat = state.ensureChat("feishu", "oc_dm", { name: "张三", kind: "p2p" });
  state.mergeRecent(chat, [msg("m1", 101, { sender_id: "ou_zhang", sender_name: "张三" })]);
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_dm", name: "张三", kind: "p2p", watching: true,
  });
  assert.equal(out.body.ok, true);
  assert.equal(fs.existsSync(profiles.personPathFor("feishu", "ou_zhang")), true);
  assert.equal(fs.existsSync(profiles.pathFor("feishu", "oc_dm", "张三")), false,
    "单聊加入值守不再生成第二份 md");
});

test("/api/targets adopts a legacy DM workbook on first sight", async () => {
  const { app, state, profiles } = makeApp();
  state.ensureChat("feishu", "ou_zhang", { name: "张三", kind: "p2p", target: true });
  const legacy = profiles.ensure("feishu", "ou_zhang", "张三");
  profiles.write("feishu", "ou_zhang", "张三",
    "# 张三\n\n## 历史结论\n\n- 旧结论：只在企微找他\n");
  const before = fs.readFileSync(legacy.path);

  const out = await app.handle("/api/targets", "GET");
  const row = out.body.items.find((t) => t.chat_id === "ou_zhang");
  const person = profiles.personPathFor("feishu", "ou_zhang");
  assert.equal(row.profile_path, person);
  assert.deepEqual(fs.readFileSync(person), before, "整文件搬运，内容逐字节不变");
  assert.equal(fs.existsSync(legacy.path), false, "旧路径消失，私聊只剩一份");
  assert.match(row.profile, /只在企微找他/);
  assert.equal(row.person.exists, true);

  // 再拉一次不会重复搬、也不会把人物档案写回工作本。
  const again = await app.handle("/api/targets", "GET");
  assert.equal(again.body.items.find((t) => t.chat_id === "ou_zhang").profile_path, person);
  assert.equal(fs.existsSync(legacy.path), false);
});

test("POST /api/targets/profile writes the DM person file, never a workbook", async () => {
  const { app, state, profiles } = makeApp();
  const chat = state.ensureChat("feishu", "ou_zhang", { name: "张三", kind: "p2p", target: true });
  state.mergeRecent(chat, [msg("m1", 101, { sender_id: "ou_zhang", sender_name: "张三" })]);

  const out = await app.handle("/api/targets/profile", "POST", null, {
    platform: "feishu", chat_id: "ou_zhang", name: "张三", text: "# 张三\n\n- 先结论后细节\n",
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.profile_path, profiles.personPathFor("feishu", "ou_zhang"));
  assert.match(fs.readFileSync(out.body.profile_path, "utf8"), /先结论后细节/);
  assert.equal(fs.existsSync(profiles.pathFor("feishu", "ou_zhang", "张三")), false);
});

test("forget removes the workbook and chat but keeps person files", async () => {
  const { app, state, profiles } = makeApp();
  const chat = state.ensureChat("feishu", "ou_zhang", { name: "张三", kind: "p2p", target: true });
  chat.watching = true;
  const book = profiles.ensure("feishu", "ou_zhang", "张三");
  const person = profiles.writePerson("feishu", "ou_zhang", "张三", "# 张三\n\n- 跨会话保留\n");

  const out = await app.handle("/api/forget", "DELETE", null, {
    platform: "feishu", chat_id: "ou_zhang",
  });
  assert.equal(out.body.ok, true);
  assert.equal(state.getChat("feishu", "ou_zhang"), null);
  assert.equal(fs.existsSync(book.path), false, "会话工作本随会话删除");
  assert.equal(fs.existsSync(person.path), true, "人物档案不随会话删除");
  assert.match(fs.readFileSync(person.path, "utf8"), /跨会话保留/);
});

test("chatWake refuses blocked/unwatched and starts a real turn for pending", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  state.mergeRecent(chat, [msg("m1", 101)]);

  let out = await app.handle("/api/chat/wake", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "not_watching");

  chat.watching = true;
  out = await app.handle("/api/chat/wake", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.pending, 1);
  assert.deepEqual(calls.wake, ["oc_abc"]);
});

test("chatWake refuses when there is nothing pending", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m1", 101, { state: "replied" })]);
  const out = await app.handle("/api/chat/wake", "POST", null, {
    platform: "feishu", chat_id: "oc_abc",
  });
  assert.equal(out.body.ok, false);
  assert.equal(out.body.reason, "no_pending");
  assert.equal(out.body.pending, 0);
  assert.deepEqual(calls.wake, []);
});

test("block marks pending as ignored, clears bodies and cancels the turn", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", { name: "示例对象 A", kind: "p2p" });
  chat.watching = true;
  state.mergeRecent(chat, [msg("m1", 101)]);
  const out = await app.handle("/api/chat/block", "POST", null, {
    platform: "feishu", chat_id: "oc_abc", blocked: true,
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.ignored, 1);
  assert.equal(chat.recent[0].state, "ignored");
  assert.equal(chat.recent[0].content, "");
  assert.ok(chat.blocked_at > 0);
  assert.deepEqual(calls.cancel, ["oc_abc"]);
});

test("manual send uses the platform adapter and closes the pending pointer", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_abc", {});
  state.mergeRecent(chat, [msg("m1", 101)]);
  const out = await app.handle("/api/send", "POST", null, {
    platform: "feishu", chat_id: "oc_abc", text: "我来回", msg_id: "m1",
  });
  assert.equal(out.body.ok, true);
  assert.deepEqual(calls.send, [{ chatId: "oc_abc", text: "我来回" }]);
  assert.equal(chat.recent[0].state, "replied");
  assert.equal(chat.recent[0].content, "");
});

test("GET routes accept query-string params like the contract says", async () => {
  const { app, state } = makeApp();
  const q = new URLSearchParams("platform=feishu&chat_id=oc_q&name=Query&kind=p2p&watching=1");
  const out = await app.handle("/api/watch", "GET", q);
  assert.equal(out.body.ok, true);
  assert.equal(state.getChat("feishu", "oc_q").watching, true);
  const s = await app.handle("/api/chat/session", "GET", new URLSearchParams("platform=feishu&chat_id=oc_q"));
  assert.equal(s.body.ok, true);
  assert.equal(s.body.session_id, "");
});

test("unknown routes and wrong methods 404 without leaking", async () => {
  const { app } = makeApp();
  assert.equal((await app.handle("/api/nope", "GET")).status, 404);
  assert.equal((await app.handle("/api/watch", "GET")).status, 200); // GET route exists but needs params
  assert.equal((await app.handle("/api/forget", "GET")).status, 404);
});

test("config POST clamps and persists", async () => {
  const { app, state } = makeApp();
  const out = await app.handle("/api/config", "POST", null, { poll: { interval_min: 1, per_chat_limit: 5 } });
  assert.equal(out.body.poll.interval_min, 10);
  assert.equal(state.data.config.poll.per_chat_limit, 5);
  assert.equal((await app.handle("/api/config", "GET")).body.poll.interval_min, 10);

  const life = await app.handle("/api/config", "POST", null,
    { dsh: { idle_reset_min: 0, warm_min: 99999 } });
  assert.equal(life.body.dsh.idle_reset_min, 0);
  assert.equal(life.body.dsh.warm_min, 1440);
  const readback = (await app.handle("/api/config", "GET")).body;
  assert.equal(readback.dsh.idle_reset_min, 0);
  assert.equal(readback.dsh.warm_min, 1440);
  // 只改 dsh 不能把 poll 的已存值带回默认。
  assert.equal(readback.poll.per_chat_limit, 5);
});

test("opening a thread only polls; it never starts a turn", async () => {
  const { app, calls } = makeApp();
  const out = await app.handle("/api/thread", "GET",
    new URLSearchParams("platform=feishu&chat_id=oc_abc&fetch=1&limit=30"));
  assert.equal(out.body.online, true);
  assert.equal(calls.poll.length, 1);
  assert.equal(calls.poll[0].opts.wake, false);
  assert.equal(calls.wake.length, 0);
  assert.equal(calls.fetchThread.length, 0);
});

test("manual poll no longer bypasses the cooldown with force", async () => {
  const { app, calls } = makeApp();
  await app.handle("/api/poll", "POST", null, { platform: "feishu", chat_id: "oc_abc" });
  assert.equal(calls.poll.length, 1);
  assert.notEqual(calls.poll[0].opts.force, true);
});

test("wecom group can be added by display name + chat_id", async () => {
  const { app, state } = makeApp();
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "wecom", chat_id: "wr_group_1", name: "客户群", kind: "group", watching: true,
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("wecom", "wr_group_1");
  assert.equal(chat.kind, "group");
  assert.equal(chat.watching, true);
  assert.equal(chat.name, "客户群");
  assert.ok(out.body.chat);
  assert.equal(out.body.chat.recent, undefined);
});

test("dingtalk joins watch and auto-enables; unknown platforms are rejected", async () => {
  const { app, state } = makeApp();
  const legacy = state.ensureChat("dingtalk", "cid_legacy", { name: "钉钉旧会话", kind: "p2p" });
  legacy.watching = true;
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "dingtalk", chat_id: "cid_new", name: "新会话", kind: "p2p",
  });
  assert.equal(out.body.ok, true);
  assert.ok(state.getChat("dingtalk", "cid_new"));
  assert.ok(state.data.config.platforms.includes("dingtalk"));

  const off = await app.handle("/api/platforms", "POST", null,
    { platform: "dingtalk", enabled: false });
  assert.equal(off.body.ok, true);
  assert.equal(state.data.config.platforms.includes("dingtalk"), false);

  const on = await app.handle("/api/platforms", "POST", null,
    { platform: "dingtalk", enabled: true });
  assert.equal(on.body.ok, true);
  assert.ok(state.data.config.platforms.includes("dingtalk"));

  const bad = await app.handle("/api/watch", "POST", null, { platform: "slack", chat_id: "x" });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.reason, /不支持/);
});

test("chat mode writes watching/timer/wake_mode for groups and now for DMs", async () => {
  const { app, state, calls } = makeApp();
  let out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_grp", name: "示例群", kind: "group", mode: "all",
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("feishu", "oc_grp");
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.wake_mode, "all");
  assert.equal(out.body.chat.wake_mode, "all");

  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_grp", mode: "mention",
  });
  assert.equal(chat.wake_mode, "mention");
  assert.equal(chat.timer, 1);

  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_grp", mode: "off",
  });
  assert.equal(chat.watching, false);
  assert.equal(chat.timer, -1);
  assert.deepEqual(calls.cancel, ["oc_grp"]);

  // 私聊：all = 每条都唤醒（默认口径），mention = 只认 @。
  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_dm", name: "示例对象", kind: "p2p", mode: "all",
  });
  assert.equal(out.body.ok, true);
  const dm = state.getChat("feishu", "oc_dm");
  assert.equal(dm.wake_mode, "all");
  assert.equal(dm.watching, true);
  assert.equal(dm.timer, 1);
  assert.equal(out.body.chat.mentionable, true);

  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_dm", mode: "mention",
  });
  assert.equal(out.body.ok, true);
  assert.equal(dm.wake_mode, "mention");

  // 企微读不到 @ 信息：私聊 mention 明确拒绝，all 照常。
  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "wecom", chat_id: "zhangsan", name: "示例对象", kind: "p2p", mode: "mention",
  });
  assert.equal(out.body.ok, false);
  assert.match(out.body.reason, /读不到 @/);
  assert.equal(state.getChat("wecom", "zhangsan").watching, false, "拒绝时不能留下半开状态");
  out = await app.handle("/api/chat/mode", "POST", null, {
    platform: "wecom", chat_id: "zhangsan", kind: "p2p", mode: "all",
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.chat.mentionable, false);
});

test("chat list exposes whether mention mode can work per platform", async () => {
  const { app, state } = makeApp();
  state.ensureChat("feishu", "oc_dm", { name: "飞书对象", kind: "p2p" }).watching = true;
  state.ensureChat("wecom", "wx_dm", { name: "企微对象", kind: "p2p" }).watching = true;
  const out = await app.handle("/api/chats", "GET");
  assert.equal(out.status, 200);
  const byPlatform = Object.fromEntries(out.body.items.map((c) => [c.platform, c]));
  assert.equal(byPlatform.feishu.mentionable, true);
  assert.equal(byPlatform.wecom.mentionable, false);
});

test("session reset opens a new session immediately for watched chats", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_rs", { name: "值守对象", kind: "p2p" });
  chat.watching = true;
  chat.dsh_session = "session-old";
  chat.session_turns = 4;

  let out = await app.handle("/api/chat/session/reset", "POST", null,
    { platform: "feishu", chat_id: "oc_rs" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.previous, "session-old");
  assert.equal(chat.dsh_session, "", "先解绑");
  assert.equal(chat.session_turns, 0);
  assert.deepEqual(calls.open, ["oc_rs"], "值守中要立刻在新会话里开场");
  assert.equal(out.body.open.ok, true);

  // 未值守：只解绑，不起来会话。
  const idle = state.ensureChat("feishu", "oc_rs_idle", { name: "未值守对象", kind: "p2p" });
  idle.dsh_session = "session-idle";
  out = await app.handle("/api/chat/session/reset", "POST", null,
    { platform: "feishu", chat_id: "oc_rs_idle" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open, null);
  assert.deepEqual(calls.open, ["oc_rs"], "未值守不该起 turn");

  // 屏蔽：同样只解绑。
  const blocked = state.ensureChat("feishu", "oc_rs_blocked", { name: "屏蔽对象", kind: "p2p" });
  blocked.watching = true;
  blocked.blocked = true;
  blocked.dsh_session = "session-blocked";
  out = await app.handle("/api/chat/session/reset", "POST", null,
    { platform: "feishu", chat_id: "oc_rs_blocked" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open, null);
  assert.deepEqual(calls.open, ["oc_rs"]);

  // 在飞：先打断，再在新会话开场；两个动作都要发生。
  const running = state.ensureChat("feishu", "oc_rs_running", { name: "在飞对象", kind: "p2p" });
  running.watching = true;
  running.dsh_session = "session-running";
  app.turns.cancel = () => true;
  out = await app.handle("/api/chat/session/reset", "POST", null,
    { platform: "feishu", chat_id: "oc_rs_running" });
  assert.equal(out.body.interrupted, true);
  assert.equal(out.body.open.ok, true);
  assert.deepEqual(calls.open, ["oc_rs", "oc_rs_running"]);
});

test("re-joining a DM that was switched off restores polling and keeps its mode", async () => {
  const { app, state, calls } = makeApp();
  // 先在「全部消息」里盯上，再切到不盯；timer 会变成 -1。
  await app.handle("/api/chat/mode", "POST", null,
    { platform: "feishu", chat_id: "oc_readd", name: "对象", kind: "p2p", mode: "all" });
  const chat = state.getChat("feishu", "oc_readd");
  chat.wake_mode = "all";
  await app.handle("/api/chat/mode", "POST", null,
    { platform: "feishu", chat_id: "oc_readd", mode: "off" });
  assert.equal(chat.watching, false);
  assert.equal(chat.timer, -1);
  assert.equal(chat.wake_mode, "all", "off 不改写关注程度");

  // 重新从搜索里加入值守：timer 要回到 1，否则 candidates 跳过它、看着在盯其实不拉。
  const out = await app.handle("/api/watch", "POST", null,
    { platform: "feishu", chat_id: "oc_readd", name: "对象", kind: "p2p", watching: true });
  assert.equal(out.body.ok, true);
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1);
  assert.equal(chat.wake_mode, "all", "沿用上次的关注程度，不能静默变成只认 @");
  assert.deepEqual(calls.open, ["oc_readd", "oc_readd"], "重新加入也要立刻开会话");
});

test("re-adding an already watching chat with a session does not open another turn", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_dup", { name: "对象", kind: "p2p" });
  chat.watching = true;
  chat.timer = 1;
  chat.dsh_session = "session-dup";
  const out = await app.handle("/api/watch", "POST", null,
    { platform: "feishu", chat_id: "oc_dup", name: "对象", kind: "p2p", watching: true });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open, null, "已经盯上且有会话：不重复开场");
  assert.deepEqual(calls.open, []);

  // 会话丢了（重开/漂移）时补开。
  chat.dsh_session = "";
  const out2 = await app.handle("/api/watch", "POST", null,
    { platform: "feishu", chat_id: "oc_dup", watching: true });
  assert.equal(out2.body.open.ok, true);
  assert.deepEqual(calls.open, ["oc_dup"]);
});

test("changing workspace for a watched chat opens a session when the old one was dropped", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_ws", { name: "对象", kind: "p2p" });
  chat.watching = true;
  chat.timer = 1;
  chat.dsh_session = "";
  const out = await app.handle("/api/chat/workspace", "POST", null,
    { platform: "feishu", chat_id: "oc_ws", workspace: "/tmp" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open.ok, true);
  assert.deepEqual(calls.open, ["oc_ws"]);
});

test("reset reports running instead of silently doing nothing when a live turn holds the chat", async () => {
  const { app, state } = makeApp();
  const chat = state.ensureChat("feishu", "oc_busy", { name: "在飞", kind: "p2p" });
  chat.watching = true;
  chat.dsh_session = "session-old";
  app.turns.busy = () => true;
  app.turns.cancel = () => false; // 模拟 cancel 拿不到句柄
  const out = await app.handle("/api/chat/session/reset", "POST", null,
    { platform: "feishu", chat_id: "oc_busy" });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open.ok, true);
  assert.equal(out.body.open.skipped, "running");
  assert.equal(chat.dsh_session, "", "解绑照常生效");
});

test("switching mode on a watched chat with no session opens one", async () => {
  const { app, state, calls } = makeApp();
  const chat = state.ensureChat("feishu", "oc_ns", { name: "没有会话", kind: "p2p" });
  chat.watching = true;
  chat.dsh_session = "";
  const out = await app.handle("/api/chat/mode", "POST", null,
    { platform: "feishu", chat_id: "oc_ns", mode: "mention" });
  assert.equal(out.body.ok, true);
  assert.deepEqual(calls.open, ["oc_ns"], "已值守但没绑会话：切模式要补开会话");
  assert.equal(out.body.open.ok, true);
});

test("joining watch on a group defaults to mention mode and starts polling", async () => {
  const { app, state } = makeApp();
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_g9", name: "示例群", kind: "group", watching: true,
  });
  assert.equal(out.body.ok, true);
  const chat = state.getChat("feishu", "oc_g9");
  assert.equal(chat.watching, true);
  assert.equal(chat.timer, 1, "群加入值守应当真的拉起来");
  assert.equal(chat.wake_mode, "mention", "默认只盯 @我");
  assert.equal(out.body.chat.wake_mode, "mention");
});

test("a failed opening turn never fails the join itself", async () => {
  const { app, state } = makeApp();
  app.turns.open = async () => { throw new Error("session_locked_other_host"); };
  const out = await app.handle("/api/watch", "POST", null, {
    platform: "feishu", chat_id: "oc_half", name: "示例对象 B", kind: "p2p", watching: true,
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.open.ok, false);
  assert.match(out.body.open.reason, /session_locked_other_host/);
  assert.equal(state.getChat("feishu", "oc_half").watching, true, "值守状态已经保存");
});

test("switching a group from off to mention opens a session; re-joining does not", async () => {
  const { app, state, calls } = makeApp();
  await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_g10", name: "示例群", kind: "group", mode: "mention",
  });
  assert.deepEqual(calls.open, ["oc_g10"]);
  const before = state.getChat("feishu", "oc_g10");
  assert.equal(before.watching, true);
  before.dsh_session = "session-g10"; // 真实链路里首次开场会绑定会话；测试夹具替它补上。

  await app.handle("/api/chat/mode", "POST", null, {
    platform: "feishu", chat_id: "oc_g10", mode: "all",
  });
  assert.deepEqual(calls.open, ["oc_g10"], "已有会话的会话再切模式不重复开会话");
});
