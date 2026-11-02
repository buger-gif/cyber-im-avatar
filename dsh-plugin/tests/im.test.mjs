import assert from "node:assert/strict";
import test from "node:test";

import { dig, parseTs, redact, isMention } from "../lib/im.js";

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
