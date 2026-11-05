import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Profiles, MAX_PROFILE, chatPersonId, excerpt, personRefs, personRel, profileRel, titleOf,
} from "../lib/profiles.js";

function tempProfiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-prof-"));
  return { dir, profiles: new Profiles(dir) };
}

test("profile path is derived from platform + chat_id", () => {
  assert.equal(profileRel("feishu", "oc_abc", "名字"), path.join("profiles", "feishu", "oc_abc.md"));
  assert.match(profileRel("wecom", "", "名字"), /^profiles\/wecom\/.+\.md$/);
});

test("person path is derived from platform + person id only", () => {
  assert.equal(personRel("feishu", "ou_abc"), path.join("profiles", "people", "feishu", "ou_abc.md"));
  assert.equal(personRel("wecom", "zhangsan"), path.join("profiles", "people", "wecom", "zhangsan.md"));
  // 空 ID 不建档：不能拿显示名或 chat_id 兜底，否则同一人会算出不同文件。
  assert.equal(personRel("feishu", ""), "");
  assert.equal(personRel("feishu", "   "), "");
  // sanitize 与 scripts/bootstrap.py 的 _SAFE_RE 规则一致：非法连续段替 _，去首尾 ._-，截断 80。
  assert.equal(personRel("feishu", "ou 张三/一"), path.join("profiles", "people", "feishu", "ou_张三_一.md"));
  assert.equal(personRel("feishu", "._-ou_x-._"), path.join("profiles", "people", "feishu", "ou_x.md"));
  const long = "a".repeat(120);
  assert.equal(personRel("feishu", long).split("/").pop(), `${"a".repeat(80)}.md`);
});

test("workbook template carries chat meta; person template carries person id and four sections", () => {
  const { profiles } = tempProfiles();
  const book = profiles.ensure("feishu", "oc_abc", "示例群");
  assert.equal(book.created, true);
  assert.match(book.text, /^# 示例群/m);
  assert.match(book.text, /## 这个会话是什么/);
  assert.match(book.text, /## 群内工作要求/);
  assert.match(book.text, /## 成员与角色/);
  assert.match(book.text, /## 本会话结论与待办/);
  assert.doesNotMatch(book.text, /## 沟通偏好/);
  const person = profiles.ensurePerson("feishu", "ou_demo", "张三");
  assert.equal(person.created, true);
  assert.match(person.text, /^# 张三/m);
  assert.match(person.text, /人物档案/);
  assert.match(person.text, /ou_demo/);
  assert.match(person.text, /## 身份与角色/);
  assert.match(person.text, /## 沟通偏好/);
  assert.match(person.text, /## 在意与忌讳/);
  assert.match(person.text, /## 历史结论/);
  assert.equal(fs.statSync(person.path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(person.path)).mode & 0o777, 0o700);
  const again = profiles.ensurePerson("feishu", "ou_demo", "张三");
  assert.equal(again.created, false);
  assert.equal(again.text, person.text);
});

test("write rejects over 12KB and accepts ordinary text", () => {
  const { profiles } = tempProfiles();
  const big = "x".repeat(MAX_PROFILE + 1);
  const rejected = profiles.write("feishu", "oc_abc", "示例对象 A", big);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /12KB/);
  const ok = profiles.write("feishu", "oc_abc", "示例对象 A", "# 示例对象 A\n\n只写结论。\n");
  assert.equal(ok.ok, true);
  assert.match(fs.readFileSync(ok.path, "utf8"), /只写结论/);
  // 面板覆盖写不带 CAS；agent 直接改文件，冲突由 skill 的“写前重读”处理。
  const again = profiles.write("feishu", "oc_abc", "示例对象 A", "# 覆盖\n");
  assert.equal(again.ok, true);
  assert.match(fs.readFileSync(again.path, "utf8"), /覆盖/);
});

test("person write: 12KB limit, empty text creates template, base_mtime stale guard", () => {
  const { profiles } = tempProfiles();
  const big = profiles.writePerson("feishu", "ou_demo", "张三", "x".repeat(MAX_PROFILE + 1));
  assert.equal(big.ok, false);
  assert.match(big.reason, /12KB/);
  const created = profiles.writePerson("feishu", "ou_demo", "张三", "");
  assert.equal(created.ok, true);
  assert.match(created.text, /^# 张三/m);
  const firstMtime = created.mtime;
  // baseMtime 落后于磁盘 → stale，不写。
  const stale = profiles.writePerson("feishu", "ou_demo", "张三", "# 旧草稿\n", { baseMtime: firstMtime - 5 });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "stale");
  assert.match(profiles.readPerson("feishu", "ou_demo").text, /^# 张三/m);
  // baseMtime 匹配 → 正常覆盖。
  const fresh = profiles.writePerson("feishu", "ou_demo", "张三", "# 张三\n\n- 先结论后细节\n", { baseMtime: firstMtime });
  assert.equal(fresh.ok, true);
  assert.match(profiles.readPerson("feishu", "ou_demo").text, /先结论后细节/);
});

test("listPeople scans the directory without creating files and skips history", () => {
  const { profiles } = tempProfiles();
  assert.deepEqual(profiles.listPeople(), []);
  profiles.writePerson("feishu", "ou_a", "甲", "# 甲\n\n- 采购\n");
  profiles.writePerson("wecom", "user_b", "乙", "# 乙\n\n- 财务\n");
  fs.writeFileSync(path.join(profiles.peopleRoot, "feishu", "ou_a.history.md"), "# 旧版\n");
  const all = profiles.listPeople();
  assert.equal(all.length, 2);
  const feishu = profiles.listPeople("feishu");
  assert.equal(feishu.length, 1);
  assert.equal(feishu[0].person_id, "ou_a");
  assert.equal(feishu[0].name, "甲");
  assert.match(feishu[0].excerpt, /采购/);
  assert.ok(feishu[0].bytes > 0);
  // 只读：不存在的人物不会被 ensure 出来。
  profiles.readPerson("feishu", "ou_missing");
  assert.equal(fs.existsSync(profiles.personPathFor("feishu", "ou_missing")), false);
});

test("delete removes only that profile; deletePerson only that person", () => {
  const { profiles } = tempProfiles();
  const a = profiles.ensure("feishu", "oc_a", "A");
  const b = profiles.ensure("feishu", "oc_b", "B");
  assert.equal(profiles.delete("feishu", "oc_a", "A"), true);
  assert.equal(fs.existsSync(a.path), false);
  assert.equal(fs.existsSync(b.path), true);
  const p1 = profiles.ensurePerson("feishu", "ou_a", "甲");
  const p2 = profiles.ensurePerson("feishu", "ou_b", "乙");
  assert.equal(profiles.deletePerson("feishu", "ou_a"), true);
  assert.equal(fs.existsSync(p1.path), false);
  assert.equal(fs.existsSync(p2.path), true);
  assert.equal(profiles.deletePerson("feishu", ""), false);
});

test("excerpt and titleOf", () => {
  const text = "# 示例对象 A\n\n> 飞书\n\n- 对方是审核同学\n";
  assert.equal(excerpt(text), "对方是审核同学");
  assert.equal(titleOf(text), "示例对象 A");
  assert.equal(titleOf("没有标题\n", "兜底"), "兜底");
});

test("personRefs dedupes senders, prioritizes addressed messages, skips self and out", () => {
  const msgs = [
    { sender_id: "ou_a", sender_name: "张三", kind: "fyi" },
    { sender_id: "ou_b", sender_name: "李四", kind: "mention" },
    { sender_id: "ou_a", sender_name: "张三", kind: "mention" },
    { sender_id: "ou_self", sender_name: "我", kind: "out" },
    { sender_id: "", sender_name: "系统", kind: "fyi" },
    { sender_id: "ou_c", sender_name: "王五", kind: "fyi" },
  ];
  assert.deepEqual(personRefs(msgs, { selfId: "ou_self" }), [
    { id: "ou_a", name: "张三" },
    { id: "ou_b", name: "李四" },
    { id: "ou_c", name: "王五" },
  ]);
  assert.equal(personRefs(msgs, { selfId: "ou_self", cap: 2 }).length, 2);
  assert.deepEqual(personRefs([{ sender_id: "ou_self", kind: "dm" }], { selfId: "ou_self" }), []);
});

test("chatPersonId derives a p2p counterpart id, never for groups", () => {
  const chat = (kind, chat_id, recent) => ({ kind, chat_id, recent });
  assert.equal(chatPersonId("feishu", chat("group", "oc_g", [{ sender_id: "ou_a", kind: "mention" }])), "");
  assert.equal(chatPersonId("feishu", chat("p2p", "oc_dm", [
    { sender_id: "ou_self", kind: "out" },
    { sender_id: "ou_other", kind: "dm" },
  ]), "ou_self"), "ou_other");
  // 飞书 p2p chat_id 本身是 ou_ 形态时可直接当人物 ID。
  assert.equal(chatPersonId("feishu", chat("p2p", "ou_other", []), "ou_self"), "ou_other");
  // 企微单聊的 chat_id 就是对方 userid。
  assert.equal(chatPersonId("wecom", chat("p2p", "zhangsan", []), "me"), "zhangsan");
  // 钉钉 senderId ≠ userId，没消息时不猜。
  assert.equal(chatPersonId("dingtalk", chat("p2p", "cid_abc", []), "me"), "");
});
