import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Adapter, IM, dig, parseTs, redact, isMention, feishuResources } from "../lib/im.js";
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
