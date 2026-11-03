import assert from "node:assert/strict";
import test from "node:test";

import { Adapter, dig, parseTs, redact, isMention } from "../lib/im.js";

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
