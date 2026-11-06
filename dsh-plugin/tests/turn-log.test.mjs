import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TurnLog } from "../lib/turn-log.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "im-turn-log-"));
}

test("append writes json lines and recent returns newest first", () => {
  const dir = tmp();
  const log = new TurnLog(dir, { logger: { warn() {} } });
  log.append("wake", { platform: "feishu", chat_id: "oc_x", turn_id: "t1", count: 2 });
  log.append("prompt_seen", { platform: "feishu", chat_id: "oc_x", turn_id: "t1", wait_ms: 12 });

  const rows = log.recent(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, "prompt_seen");
  assert.equal(rows[0].turn_id, "t1");
  assert.equal(rows[1].event, "wake");
  assert.equal(rows[1].count, 2);
  assert.ok(rows[0].ts > 1e9, "epoch 秒");

  const onDisk = fs.readFileSync(path.join(dir, "logs", "turns.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(onDisk.length, 2);
  assert.equal(onDisk[1].event, "prompt_seen");
});

test("fields outside the whitelist never reach the log (no message body)", () => {
  const dir = tmp();
  const log = new TurnLog(dir);
  log.append("wake", {
    platform: "feishu", chat_id: "oc_x", content: "客户原话", sender_name: "张三",
    sender_id: "ou_1", text: "x", name: "群名",
  });
  const row = log.recent(1)[0];
  assert.equal(row.chat_id, "oc_x");
  for (const key of ["content", "sender_name", "sender_id", "text", "name"]) {
    assert.equal(row[key], undefined, `${key} 不该落盘`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "logs", "turns.jsonl"), "utf8"), /客户原话/);
});

test("rotation keeps exactly the current and one previous file", () => {
  const dir = tmp();
  const log = new TurnLog(dir, { maxBytes: 1024 });
  for (let i = 0; i < 40; i += 1) {
    log.append("wake", { platform: "feishu", chat_id: "oc_x", turn_id: `t${i}`, count: i });
  }
  const base = path.join(dir, "logs", "turns.jsonl");
  const prev = path.join(dir, "logs", "turns.1.jsonl");
  assert.ok(fs.existsSync(base));
  assert.ok(fs.existsSync(prev), "超过上限后应有轮转文件");
  assert.ok(fs.statSync(base).size < 1024 + 400, "当前文件不应无限增长");
  // 内存环仍是最近 40 条，最新在前。
  assert.equal(log.recent(200).length, 40);
  assert.equal(log.recent(1)[0].count, 39);
});

test("recent preloads the tail after a restart", () => {
  const dir = tmp();
  const first = new TurnLog(dir);
  first.append("wake", { platform: "wecom", chat_id: "u1", turn_id: "a" });
  first.append("turn_end", { platform: "wecom", chat_id: "u1", turn_id: "a", ok: true });

  const second = new TurnLog(dir);
  const rows = second.recent(5);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, "turn_end");
  assert.equal(rows[1].event, "wake");
});

test("a bad directory degrades to memory-only without throwing", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "logs"));
  fs.writeFileSync(path.join(dir, "logs", "turns.jsonl"), "not-a-file", { mode: 0o600 });
  // 让 logs/turns.jsonl 变成目录再追加：写文件必定失败。
  fs.rmSync(path.join(dir, "logs", "turns.jsonl"));
  fs.mkdirSync(path.join(dir, "logs", "turns.jsonl"));
  const log = new TurnLog(dir, { logger: { warn() {} } });
  const row = log.append("wake", { platform: "feishu", chat_id: "oc_x" });
  assert.equal(row.event, "wake");
  assert.equal(log.failed, true);
  assert.equal(log.recent(1).length, 1, "内存里仍然可读，不影响面板");
});