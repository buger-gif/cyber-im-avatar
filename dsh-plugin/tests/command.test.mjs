import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_KEYWORD_CHARS, commandEnabled, commandRow, isStartCommand,
  keywordTooLong, normalizeKeyword, stripMentions,
} from "../lib/command.js";

test("normalizeKeyword trims, compresses whitespace, drops control chars and caps length", () => {
  assert.equal(normalizeKeyword("  启动 值班 "), "启动 值班");
  assert.equal(normalizeKeyword("a\u0000  b"), "a b");
  assert.equal(normalizeKeyword("   "), "");
  assert.equal(normalizeKeyword(null), "");
  const long = "一".repeat(MAX_KEYWORD_CHARS + 5);
  assert.equal(normalizeKeyword(long), "一".repeat(MAX_KEYWORD_CHARS));
  assert.equal(keywordTooLong(long), true);
  assert.equal(keywordTooLong("启动"), false);
});

test("commandEnabled requires the switch and a non-empty keyword", () => {
  assert.equal(commandEnabled({ enabled: true, start_keyword: "启动" }), true);
  assert.equal(commandEnabled({ enabled: false, start_keyword: "启动" }), false);
  assert.equal(commandEnabled({ enabled: true, start_keyword: "  " }), false);
  assert.equal(commandEnabled({ command: { enabled: true, start_keyword: "go" } }), true);
  assert.equal(commandEnabled({}), false, "空对象没有关键词，不能启用");
});

test("stripMentions removes placeholders and the self display name without touching the body", () => {
  assert.equal(stripMentions("@_user_1 启动值班", ["我"]), "启动值班");
  assert.equal(stripMentions("@我 启动 值班", ["我"]), "启动 值班");
  assert.equal(stripMentions("请 @我 看下", ["我"]), "请 看下");
  assert.equal(stripMentions("邮箱 a@我.com", ["我"]), "邮箱 a@我.com",
    "只去 @ 显示名，不碰邮箱这类子串");
});

test("isStartCommand requires the owner, a self mention and the keyword", () => {
  const me = "ou_me";
  const mention = [{ id: { open_id: me } }];
  const base = {
    msg_id: "m1", sender_id: me, sender_name: "我", content: "@我 启动值班",
    mentions: mention, ts: "t1", ts_epoch: 100,
  };
  assert.equal(isStartCommand(base, { selfId: me, selfNames: ["我"], keyword: "启动" }), true);
  assert.equal(isStartCommand({ ...base, content: "@我 启动" }, {
    selfId: "ou_other", selfNames: ["我"], keyword: "启动",
  }), false, "别人发的不算");
  assert.equal(isStartCommand({ ...base, content: "@_user_1 启动", mentions: [] }, {
    selfId: me, selfNames: ["我"], keyword: "启动",
  }), false, "缺结构化 mentions 且只剩占位符不算 @我");
  assert.equal(isStartCommand({ ...base, content: "@我 随便说说" }, {
    selfId: me, selfNames: ["我"], keyword: "启动",
  }), false);
  assert.equal(isStartCommand({ ...base, content: "@我 GO live" }, {
    selfId: me, selfNames: ["我"], keyword: "go",
  }), true, "ASCII 关键词大小写不敏感");
  assert.equal(isStartCommand(base, { selfId: me, selfNames: ["我"], keyword: "" }), false);
});

test("commandRow keeps only the pointer fields the opening context needs", () => {
  const row = commandRow({
    msg_id: "m1", sender_id: "ou_me", sender_name: "我", content: "@我 启动",
    ts: "t1", ts_epoch: 100, msg_type: "text", app_link: "link", media_id: "mid",
    media_paths: ["/tmp/a.png"], kind: "mention", state: "ignored",
  });
  assert.deepEqual(row, {
    msg_id: "m1", sender_id: "ou_me", sender_name: "我", content: "@我 启动",
    ts: "t1", ts_epoch: 100, kind: "cmd", state: "new", msg_type: "text",
    app_link: "link", media_id: "mid", media_paths: ["/tmp/a.png"],
  });
});
