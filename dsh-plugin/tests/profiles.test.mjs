import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Profiles, MAX_PROFILE, excerpt, profileRel } from "../lib/profiles.js";

function tempProfiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-prof-"));
  return { dir, profiles: new Profiles(dir) };
}

test("profile path is derived from platform + chat_id", () => {
  assert.equal(profileRel("feishu", "oc_abc", "名字"), path.join("profiles", "feishu", "oc_abc.md"));
  assert.match(profileRel("wecom", "", "名字"), /^profiles\/wecom\/.+\.md$/);
});

test("ensure creates a private template and is idempotent", () => {
  const { profiles } = tempProfiles();
  const first = profiles.ensure("feishu", "oc_abc", "示例对象 A");
  assert.equal(first.created, true);
  assert.match(first.text, /^# 示例对象 A/m);
  assert.equal(fs.statSync(first.path).mode & 0o777, 0o600);
  const second = profiles.ensure("feishu", "oc_abc", "示例对象 A");
  assert.equal(second.created, false);
  assert.equal(second.text, first.text);
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
});

test("mtime CAS skips agent write when the user edited in the meantime", async () => {
  const { profiles } = tempProfiles();
  const first = profiles.write("feishu", "oc_abc", "示例对象 A", "# 旧\n");
  const expected = first.mtime;
  await new Promise((r) => setTimeout(r, 15));
  profiles.write("feishu", "oc_abc", "示例对象 A", "# 用户手改\n");
  const stale = profiles.write("feishu", "oc_abc", "示例对象 A", "# agent 回写\n", expected);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "profile_conflict");
  assert.match(fs.readFileSync(first.path, "utf8"), /用户手改/);
});

test("archive appends the old profile to .history.md with private permissions", () => {
  const { profiles } = tempProfiles();
  const first = profiles.ensure("feishu", "oc_abc", "示例对象 A");
  const dest = profiles.archive(first.path, "# 旧画像\n\n- 旧结论\n");
  assert.equal(dest, first.path.replace(/\.md$/, ".history.md"));
  const text = fs.readFileSync(dest, "utf8");
  assert.match(text, /<!-- archived /);
  assert.match(text, /旧结论/);
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
});

test("delete removes only that profile", () => {
  const { profiles } = tempProfiles();
  const a = profiles.ensure("feishu", "oc_a", "A");
  const b = profiles.ensure("feishu", "oc_b", "B");
  assert.equal(profiles.delete("feishu", "oc_a", "A"), true);
  assert.equal(fs.existsSync(a.path), false);
  assert.equal(fs.existsSync(b.path), true);
});

test("excerpt returns the first non-heading line", () => {
  const text = "# 示例对象 A\n\n> 飞书\n\n- 对方是审核同学\n";
  assert.equal(excerpt(text), "对方是审核同学");
});
