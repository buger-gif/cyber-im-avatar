import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Adapter, IM, dig, parseTs, redact, isMention, feishuResources,
  describeCliError, isTransientError,
} from "../lib/im.js";
import { MediaStore } from "../lib/media.js";

test("dig follows candidate paths and falls back", () => {
  const obj = { data: { messages: [{ id: 1 }] }, sender: { name: "客户" } };
  assert.deepEqual(dig(obj, [["data", "messages"], ["messages"]]), [{ id: 1 }]);
  assert.equal(dig(obj, [["data", "items"], ["sender", "name"]]), "客户");
  assert.equal(dig(obj, [["nope"]]), undefined);
});

test("redact never returns credential-looking values", () => {
  assert.equal(redact('{"api_key":"sk-abcdefghijklmnop","ok":1}').includes("abcdefghij"), false);
  assert.equal(redact("token=abcdefghijklmnop", 30), "token=***");
});

test("parseTs handles seconds, milliseconds and local date strings", () => {
  assert.equal(parseTs("2026-11-02 20:57:00"), new Date(2026, 10, 2, 20, 57, 0).getTime() / 1000);
  assert.equal(parseTs("1793624220"), 1793624220);
  assert.equal(parseTs("1793624220000"), 1793624220);
  assert.equal(parseTs(""), 0);
});

test("isMention recognizes open_id mentions and self names", () => {
  const me = "ou_me";
  assert.equal(isMention({ mentions: [{ id: { open_id: me } }] }, me, ["我"]), true);
  assert.equal(isMention({ content: "@我 看下" }, me, ["我"]), true);
  assert.equal(isMention({ content: "@_user_1 看下", mentions: [] }, me, ["我"]), false);
  assert.equal(isMention({ content: "普通消息" }, me, ["我"]), false);
});

test("isMention never treats @张三丰 or other people's mentions as @me", () => {
  const me = "ou_zhangsan";
  assert.equal(isMention({
    content: "@张三丰 看下", mentions: [{ id: { open_id: "ou_zhangsanfeng" }, name: "张三丰" }],
  }, me, ["张三"]), false);
  assert.equal(isMention({
    content: "@张三 看下", mentions: [{ id: { open_id: "ou_other" }, name: "张三" }],
  }, me, ["张三"]), false);
  assert.equal(isMention({
    content: "@张三丰 看下", mentions: [{ id: { open_id: "ou_other" }, name: "张三丰" }],
  }), false);
  assert.equal(isMention({
    content: "@张三 看下", mentions: [{ name: "张三" }],
  }, "", ["张三"]), true);
  assert.equal(isMention({
    content: "@张三丰 看下", mentions: [{ name: "张三丰" }],
  }, "", ["张三"]), false);
  assert.equal(isMention({ content: "@张三，看下" }, me, ["张三"]), true);
  assert.equal(isMention({ content: "邮箱a@张三.com" }, me, ["张三"]), false);
});

test("canMention follows the adapter's ability to see @ info", () => {
  assert.equal(new Adapter("feishu", { dir: "/nonexistent-im-test" }).canMention, true);
  assert.equal(new Adapter("dingtalk", { dir: "/nonexistent-im-test" }).canMention, true);
  // 企微没有 mentions、auth show 也只给 Bot ID：只认 @ 会永远不触发。
  assert.equal(new Adapter("wecom", { dir: "/nonexistent-im-test" }).canMention, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-canmention-"));
  fs.writeFileSync(path.join(dir, "env.json"), JSON.stringify({
    overrides: { wecom: { f_mentions: [["mentions"]] } },
  }));
  assert.equal(new Adapter("wecom", { dir }).canMention, true, "用户用 overrides 补了字段就该放开");
});

test("search maps localized_name and p2p_chat_id into readable results", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  a.run = async () => ({
    rc: 0, raw: "",
    json: { data: { users: [
      { open_id: "ou_1", localized_name: "张三", p2p_chat_id: "oc_1", department: "研发" },
      { open_id: "ou_2", name: "李四" },
    ] } },
  });
  const r = await a.search("张");
  assert.deepEqual(r.items[0], { id: "ou_1", chat_id: "oc_1", name: "张三", department: "研发" });
  assert.equal(r.items[1].name, "李四");
});

test("searchChats leaves empty names empty instead of showing chat_id", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  a.run = async () => ({
    rc: 0, raw: "",
    json: { data: { chats: [
      { chat_id: "oc_g", chat_mode: "group", name: "" },
      { chat_id: "oc_h", chat_mode: "group", name: "告警群" },
    ] } },
  });
  const r = await a.searchChats("群");
  assert.equal(r.items[0].name, "");
  assert.equal(r.items[1].name, "告警群");
});

test("feishuResources parses JSON, flattened markers and post images", () => {
  assert.deepEqual(feishuResources({
    msg_type: "image", content: '{"image_key":"img_v3_1"}',
  }), [{ key: "img_v3_1", type: "image", name: "" }]);
  assert.deepEqual(feishuResources({
    msg_type: "file", content: "[file: 报价单.pdf] file_v3_abcdef",
  }), [{ key: "file_v3_abcdef", type: "file", name: "" }]);
  const post = feishuResources({
    msg_type: "post",
    content: JSON.stringify({ title: "t", content: [[
      { tag: "img", image_key: "img_a" }, { tag: "img", image_key: "img_b" },
    ]] }),
  });
  assert.deepEqual(post.map((r) => r.key), ["img_a", "img_b"]);
  assert.deepEqual(feishuResources({ msg_type: "interactive", content: "{}" }), []);
});

test("norm turns structured media content into readable labels without losing media_id", () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  const image = a.norm({
    message_id: "om_1", msg_type: "image", content: '{"image_key":"img_v3_abcdef"}',
    sender: { id: "ou_1" }, create_time: "2026-11-03 10:00:00",
  });
  assert.equal(image.content, "[图片]");
  assert.equal(image.media_id, "img_v3_abcdef");
  const file = a.norm({
    message_id: "om_2", msg_type: "file",
    content: '{"file_key":"file_v3_abcdef","file_name":"报价单.pdf"}',
    sender: { id: "ou_1" }, create_time: "2026-11-03 10:00:01",
  });
  assert.equal(file.content, "[文件: 报价单.pdf]");
  assert.equal(file.media_id, "file_v3_abcdef");
  const card = a.norm({
    message_id: "om_3", msg_type: "interactive", content: '{"title":"x"}',
    sender: { id: "ou_1" }, create_time: "2026-11-03 10:00:02",
  });
  assert.equal(card.content, "[卡片]");
});

test("feishu image downloads into the media dir with cwd-relative output", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-im-"));
  const media = new MediaStore(dir);
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  const calls = [];
  a.run = async (args, timeout, opts = {}) => {
    calls.push({ args, timeout, cwd: opts.cwd });
    fs.writeFileSync(path.join(opts.cwd, "dl-1.png"), "png");
    return { rc: 0, raw: "", json: { data: { saved_path: "dl-1.png" } } };
  };
  const msgDir = media.ensureMessageDir("feishu", "oc_chat", "om_1");
  const r = await a.downloadMedia({
    msg_id: "om_1", msg_type: "image", content: '{"image_key":"img_v3_1"}',
  }, { dir: msgDir, timeoutMs: 1000, media });
  assert.equal(r.ok, true);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].kind, "image");
  assert.equal(path.dirname(r.files[0].path), msgDir);
  assert.equal(fs.statSync(r.files[0].path).mode & 0o777, 0o600);
  assert.equal(calls[0].cwd, msgDir);
  assert.ok(calls[0].args.includes("img_v3_1"));
  assert.ok(calls[0].args.includes("dl-1"));
});

test("IM only downloads adapted types; sticker needs no download", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-im-"));
  const media = new MediaStore(dir);
  const im = new IM({ dir, media });
  const sticker = await im.downloadMedia("feishu", "oc_chat", { msg_id: "om_s", msg_type: "sticker" });
  assert.equal(sticker.sticker, true);
  const card = await im.downloadMedia("feishu", "oc_chat", { msg_id: "om_c", msg_type: "interactive" });
  assert.equal(card.unsupported, true);
  const ding = await im.downloadMedia("dingtalk", "cid", { msg_id: "m", msg_type: "image" });
  assert.equal(ding.unsupported, true);
});

test("wecom media command unavailable degrades as unsupported", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-im-"));
  const media = new MediaStore(dir);
  const im = new IM({ dir, media });
  const a = im.adapter("wecom");
  a.run = async () => ({ rc: 127, raw: "unknown command: media", json: null });
  const r = await im.downloadMedia("wecom", "user-1", {
    msg_id: "fp_1", msg_type: "image", media_id: "media_1",
  });
  assert.equal(r.unsupported, true);
  const missing = await im.downloadMedia("wecom", "user-1", {
    msg_id: "fp_2", msg_type: "image", media_id: "",
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /missing_media_id/);
});

test("feishu reactions use lark-cli as the user; other platforms skip without spawning", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-react-"));
  const im = new IM({ dir });
  const a = im.adapter("feishu");
  let seen = null;
  a.run = async (args, timeout) => {
    seen = { args, timeout };
    return { rc: 0, raw: "", json: { data: { reaction_id: "rx_1" } } };
  };
  const r = await im.react("feishu", "om_1");
  assert.equal(r.ok, true);
  assert.equal(r.reaction_id, "rx_1");
  assert.equal(seen.timeout, 15);
  assert.deepEqual(seen.args, [
    "im", "reactions", "create",
    "--params", '{"message_id":"om_1"}',
    "--data", '{"reaction_type":{"emoji_type":"Get"}}',
    "--as", "user",
  ]);
  // 企微没有反应命令：不 spawn，直接 unsupported。
  let spawned = false;
  im.adapter("wecom").run = async () => { spawned = true; return { rc: 0, raw: "", json: {} }; };
  const skip = await im.react("wecom", "msg-1");
  assert.equal(skip.unsupported, true);
  assert.equal(spawned, false);
  // 失败只回错误，不抛；错误文本会过 redact。
  a.run = async () => ({ rc: 1, raw: "permission denied", json: null });
  const bad = await im.react("feishu", "om_2");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /permission denied/);
});

test("feishu at-me search normalizes chat/sender/content and returns messages", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { data: { messages: [{
      chat_id: "oc_g", chat_name: "项目群",
      message_id: "om_1", msg_type: "text", content: "@我 排期",
      create_time: "2026-11-09 12:00", mentions: [],
      sender: { id: "ou_x", name: "同事" },
    }] } } };
  };
  const r = await a.searchAtMe();
  assert.equal(r.ok, true);
  assert.equal(r.items[0].chat_id, "oc_g");
  assert.equal(r.items[0].chat_name, "项目群");
  assert.equal(r.items[0].sender_id, "ou_x");
  assert.equal(r.items[0].content, "@我 排期");
  assert.ok(r.items[0].ts_epoch > 0);
  assert.ok(seen.includes("--is-at-me"));
  assert.ok(seen.includes("--chat-type"));
  assert.ok(seen.includes("group"));
});

test("feishu self-mention search filters sender and at-chatter-ids and keeps chat_type", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { data: { messages: [{
      chat_id: "oc_dm", chat_type: "p2p", chat_partner: { open_id: "ou_other" },
      message_id: "om_dm", msg_type: "text", content: "@我 启动",
      create_time: "2026-11-12 22:00", mentions: [{ id: { open_id: "ou_me" } }],
      sender: { id: "ou_me", name: "我" },
    }, {
      chat_id: "oc_g", chat_type: "group", chat_name: "项目群",
      message_id: "om_g", msg_type: "text", content: "@我 启动值班",
      create_time: "2026-11-12 22:01", mentions: [{ id: { open_id: "ou_me" } }],
      sender: { id: "ou_me", name: "我" },
    }] } } };
  };
  const r = await a.searchSelfMentions({
    selfId: "ou_me",
    start: new Date("2026-11-12T22:00:00+08:00"),
    end: new Date("2026-11-12T23:00:00+08:00"),
  });
  assert.equal(r.ok, true);
  assert.equal(a.supportsSelfMentions, true);
  assert.equal(r.items[0].chat_id, "oc_dm");
  assert.equal(r.items[0].chat_type, "p2p");
  assert.equal(r.items[0].chat_name, "", "p2p 搜索不硬造名字");
  assert.equal(r.items[0].sender_id, "ou_me");
  assert.equal(r.items[0].content, "@我 启动");
  assert.equal(r.items[1].chat_type, "group");
  assert.equal(r.items[1].chat_name, "项目群");
  assert.ok(seen.includes("--sender"));
  assert.ok(seen.includes("ou_me"));
  assert.ok(seen.includes("--at-chatter-ids"));
  assert.equal(seen.includes("--query"), false, "不把关键词交给服务端分词，本地过滤更稳");
  assert.equal(seen.includes("--chat-type"), false, "搜索要同时覆盖 p2p 与 group");
  assert.equal(seen.includes("--page-all"), false, "每分钟一跳只取一页，不翻页");
  assert.ok(seen.includes("--page-size"));
  assert.ok(seen.includes("50"));
  assert.ok(r.items[0].ts_epoch > 0);

  const ding = new Adapter("dingtalk", { dir: "/nonexistent-im-test" });
  assert.equal(ding.supportsSelfMentions, false);
  const unsupported = await ding.searchSelfMentions({ selfId: "u" });
  assert.equal(unsupported.unsupported, true);
});

test("feishu chatMembers counts users and reports truncation/unsupported", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  a.run = async () => ({
    rc: 0, raw: "",
    json: { data: { users: [{ id: "ou_1" }, { id: "ou_2" }], bots: [], truncations: [] } },
  });
  let r = await a.chatMembers("oc_g");
  assert.equal(r.ok, true);
  assert.equal(r.known, true);
  assert.equal(r.count, 2);

  a.run = async () => ({ rc: 0, raw: "", json: { data: { users: [{ id: "ou_1" }], truncations: [{}] } } });
  r = await a.chatMembers("oc_g");
  assert.equal(r.ok, true);
  assert.equal(r.known, false);
  assert.equal(r.count, 1);

  const d = new Adapter("dingtalk", { dir: "/nonexistent-im-test" });
  assert.equal(d.supportsAtMe, false);
  assert.equal(d.supportsMembers, false);
  r = await d.chatMembers("cid");
  assert.equal(r.ok, false);
  assert.equal(r.known, false);
});

test("feishu full baseline list uses page-all and page-size 100", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { data: { chats: [{ chat_id: "oc_g", name: "群", chat_mode: "group" }] } } };
  };
  const r = await a.listChats(100, { all: true });
  assert.equal(r.ok, true);
  assert.equal(r.items[0].chat_id, "oc_g");
  assert.ok(seen.includes("--page-all"));
  assert.equal(seen[seen.indexOf("--types") + 1], "group");
  assert.ok(seen.includes("--page-limit"));
  assert.ok(seen.includes("100"));
});

test("describeCliError classifies transport failures and masks IDs", () => {
  const raw = [
    "ERROR: 初始化水位失败:",
    JSON.stringify({
      ok: false, identity: "user",
      error: {
        type: "network", subtype: "transport",
        message: 'API call failed: Get "https://open.feishu.cn/open-apis/im/v1/messages'
          + '?container_id=oc_c56748207171a8ce2744e7826f6ed313": dial tcp 1.2.3.4:443: i/o timeout',
      },
    }),
  ].join("\n");
  const r = describeCliError(raw);
  assert.equal(r.kind, "network");
  assert.equal(isTransientError(r.kind), true);
  assert.match(r.summary, /^网络传输失败：/);
  assert.equal(r.summary.includes("\n"), false);
  assert.equal(r.summary.includes("oc_c56748207171a8ce2744e7826f6ed313"), false);
  assert.equal(r.summary.includes("https://open.feishu.cn"), false);
});

test("describeCliError keeps API codes and does not retry them", () => {
  const r = describeCliError(JSON.stringify({
    ok: false,
    error: { type: "api", code: 230001, message: "invalid container_id: oc_abc123def4567890" },
  }));
  assert.equal(r.kind, "api");
  assert.equal(isTransientError(r.kind), false);
  assert.match(r.summary, /接口报错 230001/);
  assert.equal(r.summary.includes("oc_abc123def4567890"), false);
});

test("fetchMessages retries one transport failure and succeeds", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let calls = 0;
  a.run = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        rc: 1, json: null,
        raw: JSON.stringify({
          ok: false,
          error: { type: "network", subtype: "transport", message: "dial tcp: i/o timeout" },
        }),
      };
    }
    return {
      rc: 0, raw: "",
      json: { data: { messages: [{ message_id: "om_1", sender: { id: "ou_a" }, content: "hi", create_time: "2026-11-13 15:00" }] } },
    };
  };
  const r = await a.fetchMessages("oc_chat", { limit: 3 });
  assert.equal(calls, 2);
  assert.equal(r.ok, true);
  assert.equal(r.messages.length, 1);
  assert.equal(r.error, "");
});

test("fetchMessages does not retry API errors and returns a readable cause", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let calls = 0;
  a.run = async () => {
    calls += 1;
    return {
      rc: 1, json: null,
      raw: JSON.stringify({
        ok: false,
        error: { type: "api", code: 230001, message: "invalid container_id: oc_abc123def4567890" },
      }),
    };
  };
  const r = await a.fetchMessages("oc_chat", { limit: 3 });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /接口报错 230001/);
  assert.equal(r.error.includes("\n"), false);
  assert.equal(r.error.includes("oc_abc123def4567890"), false);
  assert.match(r.error_detail, /oc_abc123…7890/);
});

test("fetchMessages does not retry our own timeout kill (rc 124)", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let calls = 0;
  a.run = async () => {
    calls += 1;
    return { rc: 124, json: null, raw: "\ntimeout" };
  };
  const r = await a.fetchMessages("oc_chat", { limit: 3 });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /网络传输失败/);
});

test("sendCard sends a user interactive card and requires a message id", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { ok: true, data: { message_id: "om_card" } } };
  };
  const r = await a.sendCard("oc_dm", { schema: "2.0" }, { idempotencyKey: "progress:x" });
  assert.equal(r.ok, true);
  assert.equal(r.message_id, "om_card");
  assert.ok(seen.includes("interactive"));
  assert.equal(seen[seen.indexOf("--as") + 1], "user");
  assert.equal(seen[seen.indexOf("--idempotency-key") + 1], "progress:x");
});

test("sendCard without message id fails; patchCard wraps card JSON in content", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  a.run = async () => ({ rc: 0, raw: "", json: { ok: true, data: {} } });
  const r = await a.sendCard("oc_dm", { schema: "2.0" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "missing_message_id");

  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { ok: true, data: {} } };
  };
  const p = await a.patchCard("om_card", { schema: "2.0", body: {} });
  assert.equal(p.ok, true);
  const data = JSON.parse(seen[seen.indexOf("--data") + 1]);
  assert.equal(typeof data.content, "string");
  assert.deepEqual(JSON.parse(data.content), { schema: "2.0", body: {} });

  const recalled = await a.recallCard("om_card");
  assert.equal(recalled.ok, true);
  assert.ok(seen.includes("delete"));
  assert.equal(seen[seen.indexOf("--message-id") + 1], "om_card");
  assert.equal(seen[seen.indexOf("--as") + 1], "user");
  assert.ok(seen.includes("--yes"));
});

test("IM.sendCard/patchCard/recallCard are feishu-only", async () => {
  const im = new IM({ dir: "/nonexistent-im-test" });
  assert.equal((await im.sendCard("wecom", "oc_dm", {})).unsupported, true);
  assert.equal((await im.patchCard("wecom", "om_card", {})).unsupported, true);
  assert.equal((await im.recallCard("wecom", "om_card")).unsupported, true);
});

test("norm keeps feishu reply_to, including object-shaped parent ids", () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  const m = a.norm({
    message_id: "om_1", msg_type: "text", content: "回复",
    sender: { id: "ou_a" }, create_time: "2026-11-23 14:51", reply_to: "om_0",
  });
  assert.equal(m.reply_to, "om_0");
  assert.equal(a.norm({
    message_id: "om_2", content: "x", reply_to: { message_id: "om_9" },
  }).reply_to, "om_9");
  assert.equal(a.norm({ message_id: "om_3", content: "x" }).reply_to, "");
  assert.equal(new Adapter("wecom", { dir: "/nonexistent-im-test" }).norm({
    content: "x", reply_to: "m0",
  }).reply_to, "", "企微没有实测字段，不给候选路径");
});

test("resolveQuotes takes the quoted message from the batch without mget", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let calls = 0;
  a.run = async () => { calls += 1; throw new Error("should not spawn"); };
  const msgs = [
    { msg_id: "om_2", sender_id: "ou_b", sender_name: "李四", content: "回复",
      ts: "2026-11-23 14:51", ts_epoch: 200, msg_type: "text", reply_to: "om_1" },
    { msg_id: "om_1", sender_id: "ou_a", sender_name: "张三", content: "原文",
      ts: "2026-11-23 14:49", ts_epoch: 100, msg_type: "text" },
  ];
  await a.resolveQuotes(msgs);
  assert.equal(calls, 0);
  assert.equal(msgs[0].quote.content, "原文");
  assert.equal(msgs[0].quote.sender_name, "张三");
  assert.equal(msgs[0].quote.ts, "2026-11-23 14:49");
});

test("resolveQuotes mgets quoted messages missing from the batch and caches them", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  const calls = [];
  a.run = async (args) => {
    calls.push(args);
    assert.ok(args.includes("+messages-mget"));
    assert.ok(!args.includes("--download-resources"), "取引用不该顺带下载媒体");
    const ids = args[args.indexOf("--message-ids") + 1].split(",");
    return {
      rc: 0, raw: "",
      json: { data: { messages: ids.map((id) => ({
        message_id: id, msg_type: "text", content: `原文-${id}`,
        create_time: "2026-11-23 14:49", sender: { id: "ou_a", name: "张三" },
      })) } },
    };
  };
  const msgs = [
    { msg_id: "om_3", content: "回复", ts_epoch: 300, reply_to: "om_1" },
    { msg_id: "om_4", content: "另一条", ts_epoch: 300, reply_to: "om_2" },
  ];
  await a.resolveQuotes(msgs, { since: 200 });
  assert.equal(calls.length, 2, "两个 ID 逐个查，避免一个失效拖累另一个");
  assert.equal(msgs[0].quote.content, "原文-om_1");
  assert.equal(msgs[0].quote.sender_name, "张三");
  assert.equal(msgs[1].quote.content, "原文-om_2");

  const again = [{ msg_id: "om_5", content: "再回", ts_epoch: 400, reply_to: "om_1" }];
  await a.resolveQuotes(again, { since: 300 });
  assert.equal(calls.length, 2, "同一引用走缓存，不重复 spawn");
  assert.equal(again[0].quote.content, "原文-om_1");
});

test("resolveQuotes degrades without throwing when mget fails", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let calls = 0;
  a.run = async () => {
    calls += 1;
    return {
      rc: 1, json: null,
      raw: JSON.stringify({ ok: false, error: { type: "api", code: 99992354, message: "not exists" } }),
    };
  };
  const msgs = [{ msg_id: "om_2", content: "回复", ts_epoch: 300, reply_to: "om_1" }];
  await a.resolveQuotes(msgs);
  assert.equal(msgs[0].quote, undefined);
  assert.equal(calls, 1);
  await a.resolveQuotes([{ msg_id: "om_3", content: "又回", ts_epoch: 300, reply_to: "om_1" }]);
  assert.equal(calls, 1, "失败也缓存 2 分钟，不每轮重试");
});

test("resolveQuotes skips replies at or below the watermark and platforms without the hook", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let calls = 0;
  a.run = async () => { calls += 1; return { rc: 0, raw: "", json: { data: { messages: [] } } }; };
  const old = [{ msg_id: "om_2", content: "回复", ts_epoch: 100, reply_to: "om_1" }];
  await a.resolveQuotes(old, { since: 200 });
  assert.equal(calls, 0, "水位之前的老消息不重复 mget");
  const baseline = [{ msg_id: "om_3", content: "回复", ts_epoch: 300, reply_to: "om_1" }];
  await a.resolveQuotes(baseline, { since: Number.POSITIVE_INFINITY });
  assert.equal(calls, 0, "首次基线不取引用");

  const w = new Adapter("wecom", { dir: "/nonexistent-im-test" });
  w.run = async () => { calls += 1; return { rc: 0, raw: "", json: {} }; };
  await w.resolveQuotes([{ msg_id: "m1", content: "回复", ts_epoch: 1, reply_to: "m0" }]);
  assert.equal(calls, 0, "没有 cmd_mget_quote 的平台直接跳过");
});

test("account message stream scopes by chat ids and reports completeness", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { data: {
      messages: [{
        chat_id: "oc_g", chat_type: "group", chat_name: "项目群",
        message_id: "om_1", msg_type: "text", content: "刷屏",
        create_time: "2026-11-27 15:00", sender: { id: "ou_x", name: "同事" },
      }],
      has_more: false, total: 1,
    } } };
  };
  const r = await a.searchMessages({
    chatIds: ["oc_g", "oc_dm"], start: new Date(1000 * 1000), end: new Date(2000 * 1000),
  });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.items[0].chat_id, "oc_g");
  assert.equal(r.items[0].chat_type, "group");
  const i = seen.indexOf("--chat-id");
  assert.ok(i > 0);
  assert.equal(seen[i + 1], "oc_g,oc_dm");
  assert.ok(seen.includes("--start"));
  assert.ok(seen.includes("--end"));
  assert.ok(!seen.includes("--query"));
});

test("account message stream treats has_more as incomplete and surfaces errors", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  a.run = async () => ({ rc: 0, raw: "", json: { data: { messages: [], has_more: true } } });
  const r = await a.searchMessages({ chatIds: ["oc_g"] });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);

  a.run = async () => ({ rc: 1, raw: "permission denied", json: null });
  const bad = await a.searchMessages({ chatIds: ["oc_g"] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /permission denied/);
});

test("fetchSince reads a time window and returns the platform's completeness", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: {
      data: { messages: [{
        message_id: "om_1", msg_type: "text", content: "补一段",
        create_time: "2026-11-27 15:00", sender: { id: "ou_x" },
      }] },
      meta: { pagination: { complete: false, pages: 3, items: 150 } },
    } };
  };
  const r = await a.fetchSince("oc_g", { since: 1_700_000_000, until: 1_700_001_000 });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(r.messages.length, 1);
  const s = seen.indexOf("--start");
  const e = seen.indexOf("--end");
  assert.ok(s > 0 && e > 0);
  assert.match(seen[s + 1], /\+08:00$/);
  assert.ok(seen.includes("--page-all"));
});

test("fetchSince on wecom maps has_more to completeness", async () => {
  const a = new Adapter("wecom", { dir: "/nonexistent-im-test" });
  a.run = async () => ({
    rc: 0, raw: "",
    json: { messages: [{ send_time: "2026-11-27 15:00", userid: "u1", text: { content: "hi" } }],
      has_more: true, messages_count: 1 },
  });
  const r = await a.fetchSince("chat1", { since: 1_700_000_000, until: 1_700_001_000 });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(r.messages.length, 1);

  a.run = async () => ({
    rc: 0, raw: "",
    json: { messages: [{ send_time: "2026-11-27 15:00", userid: "u1", text: { content: "hi" } }],
      has_more: false, messages_count: 1 },
  });
  const ok = await a.fetchSince("chat1", { since: 1_700_000_000, until: 1_700_001_000 });
  assert.equal(ok.complete, true);
});

test("fetchSince on dingtalk reports unsupported instead of pretending", async () => {
  const a = new Adapter("dingtalk", { dir: "/nonexistent-im-test" });
  const r = await a.fetchSince("cid", { since: 1, until: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.unsupported, true);
  assert.equal(r.complete, null);
});

test("at-me search narrows to chat ids when given", async () => {
  const a = new Adapter("feishu", { dir: "/nonexistent-im-test" });
  let seen = null;
  a.run = async (args) => {
    seen = args;
    return { rc: 0, raw: "", json: { data: { messages: [] } } };
  };
  await a.searchAtMe({ chatIds: ["oc_g", "oc_dm"] });
  const i = seen.indexOf("--chat-id");
  assert.ok(i > 0);
  assert.equal(seen[i + 1], "oc_g,oc_dm");
});
