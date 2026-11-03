import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Adapter, dingtalkIsConversation } from "../lib/im.js";

function adapter(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-dtalk-"));
  fs.writeFileSync(path.join(dir, "env.json"), JSON.stringify(env));
  return new Adapter("dingtalk", { dir });
}

test("dingtalk conversation ids are told apart from user ids", () => {
  assert.equal(dingtalkIsConversation("cidrABC="), true);
  assert.equal(dingtalkIsConversation("user-1234"), false);
  assert.equal(dingtalkIsConversation(""), false);
});

test("dingtalk whoami reads userId and name from profile list", async () => {
  const a = adapter();
  a.run = async () => ({
    rc: 0, raw: "",
    json: { ok: true, profiles: [{ userId: "user-1", name: "示例本人" }] },
  });
  const r = await a.whoami();
  assert.equal(r.ok, true);
  assert.equal(r.self_id, "user-1");
  assert.equal(r.name, "示例本人");
});

test("dingtalk whoami refuses a cached self_id when profile list is empty", async () => {
  const a = adapter({ platforms: { dingtalk: { self_id: "cached-user" } } });
  a.run = async () => ({ rc: 0, raw: "", json: { ok: true, profiles: [] } });
  const r = await a.whoami();
  assert.equal(r.ok, false);
  assert.equal(r.self_id, null);
});

test("dingtalk fetch routes conversation ids to --group and user ids to --user", async () => {
  const a = adapter();
  const seen = [];
  a.run = async (args) => {
    seen.push(args);
    return {
      rc: 0, raw: "",
      json: {
        ok: true,
        messages: [{
          messageId: "m1", senderId: "Dd_other", text: "你好",
          createTime: "2026-11-03 08:56:34", msgType: "text",
        }],
      },
    };
  };

  const r1 = await a.fetchMessages("cidrABC=", { limit: 5 });
  assert.ok(seen[0].includes("--group"));
  assert.equal(seen[0][seen[0].indexOf("--limit") + 1], "5");
  assert.equal(r1.ok, true);
  assert.equal(r1.messages[0].msg_id, "m1");
  assert.equal(r1.messages[0].sender_id, "Dd_other");
  assert.equal(r1.messages[0].content, "你好");
  assert.equal(r1.messages[0].ts_epoch, new Date(2026, 10, 3, 8, 56, 34).getTime() / 1000);

  await a.fetchMessages("user-9", { limit: 5 });
  assert.ok(seen[1].includes("--user"));
  assert.ok(seen[1].includes("user-9"));
});

test("dingtalk recent conversations parse into chat rows", async () => {
  const a = adapter();
  a.run = async () => ({
    rc: 0, raw: "",
    json: {
      ok: true,
      data: {
        conversations: [
          { conversationId: "cidr-dm=", name: "示例对象 A", type: "p2p" },
          { conversationId: "cidr-group=", name: "示例群", type: "group" },
        ],
      },
    },
  });
  const r = await a.listChats(10);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => [x.chat_id, x.name, x.kind]), [
    ["cidr-dm=", "示例对象 A", "p2p"],
    ["cidr-group=", "示例群", "group"],
  ]);
});

test("dingtalk people search maps userId into chat_id and name", async () => {
  const a = adapter();
  a.run = async () => ({
    rc: 0, raw: "",
    json: { result: [{ userId: "user-2", name: "张三", nick: "张三" }] },
  });
  const r = await a.search("张三");
  assert.deepEqual(r.items, [{ id: "user-2", chat_id: "user-2", name: "张三", department: "" }]);
});

test("dingtalk send uses --chat-id for conversations and --user for people", async () => {
  const a = adapter();
  const seen = [];
  a.run = async (args) => {
    seen.push(args);
    return { rc: 0, raw: "", json: { ok: true } };
  };
  await a.sendText("cidr-dm=", "你好");
  assert.ok(seen[0].includes("--chat-id"));
  assert.ok(seen[0].includes("cidr-dm="));
  assert.ok(seen[0].includes("--text"));
  await a.sendText("user-2", "你好");
  assert.ok(seen[1].includes("--user"));
  assert.ok(seen[1].includes("user-2"));
});
