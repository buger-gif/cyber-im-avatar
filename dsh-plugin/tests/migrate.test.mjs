import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "migrate-state.mjs");

function buildLegacy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-mig-"));
  const db = new DatabaseSync(path.join(dir, "panel.db"));
  db.exec(`
    CREATE TABLE chats (
      platform TEXT, chat_id TEXT, name TEXT, kind TEXT, tracked INTEGER,
      watching INTEGER, mode TEXT, auto_send INTEGER, last_ts TEXT, last_epoch REAL,
      last_sync REAL, last_error TEXT, added_at REAL, workspace TEXT, dsh_session TEXT,
      dsh_synced REAL, timer INTEGER, poll_at REAL, blocked INTEGER, blocked_at REAL,
      reply_mode TEXT, reply_state TEXT, reply_state_at REAL, session_bound_at REAL,
      session_turns INTEGER, PRIMARY KEY (platform, chat_id)
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, platform TEXT, chat_id TEXT, msg_id TEXT,
      sender_id TEXT, sender_name TEXT, content TEXT, ts TEXT, ts_epoch REAL,
      kind TEXT, state TEXT, created REAL
    );
  `);
  const chat = db.prepare(`INSERT INTO chats VALUES (
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  chat.run("feishu", "oc_a", "示例对象 A", "p2p", 0, 1, "monitor", 0,
    "2026-11-02 20:58", 1793624280, 1793624457, "", 1793451977,
    "/tmp/ws", "session-1", 0, 0, 1793624457, 0, 0, "direct", "", 0, 1793615859, 2);
  chat.run("feishu", "oc_g", "一个群", "group", 1, 1, "monitor", 0,
    "2026-11-02 20:00", 1793620000, 1793620000, "", 1793451977,
    "", "", 0, 0, 1793620000, 0, 0, "direct", "", 0, 0, 0);
  const m = db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 12; i += 1) {
    m.run(`id${i}`, "feishu", "oc_a", `m${i}`, "ou_other", "客户", `正文${i}`,
      `2026-11-02 20:${String(i).padStart(2, "0")}`, 1793620000 + i, "dm",
      i === 11 ? "new" : "replied", 0);
  }
  db.close();
  fs.writeFileSync(path.join(dir, "panel.json"), JSON.stringify({
    poll: { interval_min: 1, per_chat_limit: 5 },
    platforms: ["feishu"],
    dsh: { timeout: 1, profile: "headless" },
    ui: { skin: "studio" },
  }));
  fs.writeFileSync(path.join(dir, "env.json"), JSON.stringify({
    targets: { feishu: { "示例对象 A": { chat_id: "oc_a", open_id: "ou_a" } } },
  }));
  return dir;
}

test("migration keeps latest 10, target markers, group timer=-1 and new config", () => {
  const dir = buildLegacy();
  const out = execFileSync(process.execPath, [SCRIPT, "--dir", dir], { encoding: "utf8" });
  assert.match(out, /已写入/);
  assert.equal(fs.existsSync(path.join(dir, "panel.db")), false);
  assert.equal(fs.existsSync(path.join(dir, "panel.db.migrated")), true);

  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  const a = state.chats["feishu:oc_a"];
  assert.equal(a.target, true);
  assert.equal(a.watching, true);
  assert.equal(a.workspace, "/tmp/ws");
  assert.equal(a.dsh_session, "session-1");
  assert.equal(a.session_turns, 2);
  assert.equal(a.recent.length, 10);
  assert.equal(a.recent[0].msg_id, "m11");
  assert.equal(a.recent[0].content, "正文11");
  assert.equal(a.recent[1].content, ""); // replied -> pointer only
  const g = state.chats["feishu:oc_g"];
  assert.equal(g.timer, -1);
  assert.equal(state.config.poll.interval_min, 10);
  assert.equal(state.config.poll.per_chat_limit, 5);
  assert.equal(state.config.dsh.timeout, 30);
  assert.equal(state.config.ui, undefined);
});

test("migration refuses to overwrite an existing state.json without --force", () => {
  const dir = buildLegacy();
  fs.writeFileSync(path.join(dir, "state.json"), "{}");
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, "--dir", dir], {
    encoding: "utf8", stdio: "pipe",
  }));
  assert.equal(fs.existsSync(path.join(dir, "panel.db")), true);
});

test("--fresh starts an empty shell without reading the legacy DB", () => {
  const dir = buildLegacy();
  execFileSync(process.execPath, [SCRIPT, "--dir", dir, "--fresh"], { encoding: "utf8" });
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(Object.keys(state.chats).length, 0); // --fresh = 不读旧库、不补旧目标
  assert.equal(fs.existsSync(path.join(dir, "panel.db")), true);
});
