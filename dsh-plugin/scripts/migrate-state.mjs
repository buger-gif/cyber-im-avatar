#!/usr/bin/env node
/**
 * 一次性迁移：panel.db + panel.json + env.json 目标索引 → state.json。
 *
 * 运行期完全不读 SQLite；这个脚本只用 Node 内置的 node:sqlite（Node 22+）。
 * 每个会话只搬最新 10 条消息，更早的丢弃（线上 IM 还能查）。搬完把旧库改名
 * 为 panel.db.migrated 保留证据；画像文件原样不动。
 *
 *   node scripts/migrate-state.mjs [--fresh] [--dry-run] [--force] [--dir DIR]
 *
 * --fresh    不读旧库，直接建空 state（画像保留）
 * --dry-run  只打印将写入的内容，不落盘、不改名
 * --force    已存在 state.json 时覆盖（默认拒绝，避免把新状态洗掉）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

import { State, normalizeConfig } from "../lib/state.js";

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const valueOf = (k, fallback = "") => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const DIR = path.resolve(valueOf("--dir", process.env.IM_STANDIN_DIR || path.join(os.homedir(), ".im-standin")));
const STATE = path.join(DIR, "state.json");
const DB = path.join(DIR, "panel.db");
const MIGRATED = path.join(DIR, "panel.db.migrated");
const fresh = has("--fresh");
const dry = has("--dry-run");
const force = has("--force");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function log(...a) {
  console.log(...a);
}

if (fs.existsSync(STATE) && !force) {
  console.error(`state.json 已存在：${STATE}`);
  console.error("如果确认要用旧库覆盖，请加 --force（建议先备份/移走现在的 state.json）。");
  process.exit(2);
}
if (!fresh && !fs.existsSync(DB)) {
  console.error(`找不到旧库：${DB}`);
  console.error("如果是全新安装，用 --fresh 建空 state。");
  process.exit(2);
}

const state = new State(DIR);
const panel = readJson(path.join(DIR, "panel.json"), {});
const env = readJson(path.join(DIR, "env.json"), {});
state.data.config = normalizeConfig(panel);
state.data.paused = false;
state.data.runtime = { cycles: 0, last_cycle_at: 0, last_cycle_ms: 0, last_result: {} };
state.data.chats = {};

/** env.json 的目标索引：platform -> name -> {chat_id,...} */
const envTargets = new Map(); // `${platform}:${chat_id}` => name
for (const [platform, nodes] of Object.entries(env.targets || {})) {
  for (const [name, node] of Object.entries(nodes || {})) {
    const chatId = String(node?.chat_id || "");
    if (chatId && !envTargets.has(`${platform}:${chatId}`)) {
      envTargets.set(`${platform}:${chatId}`, name);
    }
  }
}

let rows = [];
let latest = new Map(); // `${platform}:${chat_id}` => messages[]
if (!fresh) {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    rows = db.prepare("SELECT * FROM chats").all();
    const msgs = db.prepare(
      "SELECT platform, chat_id, msg_id, sender_id, sender_name, content, ts, ts_epoch, kind, state " +
      "FROM messages ORDER BY ts_epoch DESC",
    ).all();
    for (const m of msgs) {
      const key = `${m.platform}:${m.chat_id}`;
      const list = latest.get(key) || [];
      if (list.length >= 10) continue;
      if (list.some((x) => x.msg_id === m.msg_id)) continue;
      list.push(m);
      latest.set(key, list);
    }
  } finally {
    db.close();
  }
}

let targets = 0;
for (const row of rows) {
  const platform = String(row.platform || "");
  const chatId = String(row.chat_id || "");
  if (!platform || !chatId) continue;
  const key = `${platform}:${chatId}`;
  const isTarget = envTargets.has(key);
  if (isTarget) targets += 1;
  const kind = row.kind === "group" ? "group" : "p2p";
  let timer = Number.isFinite(Number(row.timer)) ? Number(row.timer) : (kind === "group" ? -1 : 0);
  // 群默认不拉：旧库里 0 和 -1 都不进轮询，迁移时统一成 -1；只有显式 1 保留。
  if (kind === "group" && timer !== 1) timer = -1;
  const recent = (latest.get(key) || []).map((m) => {
    const msgKind = ["dm", "mention", "service", "fyi", "out"].includes(m.kind) ? m.kind : "fyi";
    const msgState = ["new", "opened", "replied", "ignored"].includes(m.state) ? m.state : "new";
    return {
      msg_id: String(m.msg_id || ""),
      sender_id: String(m.sender_id || ""),
      sender_name: String(m.sender_name || ""),
      content: String(m.content || ""),
      ts: String(m.ts || ""),
      ts_epoch: Number(m.ts_epoch) || 0,
      kind: msgKind,
      state: msgState,
    };
  }).filter((m) => m.msg_id);

  const chat = state.normalizeChat({
    platform,
    chat_id: chatId,
    name: row.name || envTargets.get(key) || chatId,
    kind,
    target: isTarget,
    watching: !!row.watching,
    blocked: !!row.blocked,
    blocked_at: Number(row.blocked_at) || 0,
    timer,
    workspace: row.workspace || "",
    dsh_session: row.dsh_session || "",
    session_turns: row.session_turns || 0,
    session_bound_at: row.session_bound_at || 0,
    last_epoch: Number(row.last_epoch) || (recent[0]?.ts_epoch ?? 0),
    last_ts: row.last_ts || recent[0]?.ts || "",
    last_sync: row.last_sync || row.poll_at || 0,
    last_error: row.last_error || "",
    last_turn: { ok: null, reason: "", at: 0 },
    wake: { at: 0, failed: false, turn_id: "", active: false },
    added_at: row.added_at || 0,
    recent,
  });
  if (chat) state.data.chats[key] = chat;
}

// env targets 里若有旧库没有的会话，也补一条（画像不能因为库缺失而消失）。
// --fresh 明确要空状态，不补。
if (!fresh) {
  for (const [key, name] of envTargets) {
    if (state.data.chats[key]) continue;
    const at = key.indexOf(":");
    const platform = key.slice(0, at);
    const chatId = key.slice(at + 1);
    const chat = state.normalizeChat({
      platform, chat_id: chatId, name, kind: "p2p", target: true, watching: false,
      timer: 0, added_at: Date.now() / 1000,
    });
    if (chat) {
      state.data.chats[key] = chat;
      targets += 1;
    }
  }
}

state.loaded = true;
const summary = {
  dir: DIR,
  state: STATE,
  chats: Object.keys(state.data.chats).length,
  watchers: Object.values(state.data.chats).filter((c) => c.watching).length,
  targets,
  recent: Object.values(state.data.chats).reduce((n, c) => n + c.recent.length, 0),
  db: fresh ? "(fresh)" : DB,
  migrated_to: fresh || dry ? "" : MIGRATED,
};
log(JSON.stringify(summary, null, 2));

if (dry) {
  log("dry-run：没有写文件。");
  process.exit(0);
}

state.save();
if (!fresh) {
  try {
    if (fs.existsSync(MIGRATED)) {
      const alt = `${MIGRATED}.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.renameSync(DB, alt);
      summary.migrated_to = alt;
      log(`panel.db.migrated 已存在，旧库改名为 ${alt}`);
    } else {
      fs.renameSync(DB, MIGRATED);
    }
    // WAL 模式读一次会留下 -wal/-shm；跟着旧库一起改名，避免下次误以为还在用。
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(DB + suffix)) {
        try { fs.renameSync(DB + suffix, summary.migrated_to + suffix); } catch { /* 空文件，忽略 */ }
      }
    }
  } catch (e) {
    console.error(`state.json 已写入，但旧库改名失败：${e.message}`);
    console.error(`运行期不会再读 ${DB}；可手动改名。`);
    process.exitCode = 1;
  }
}
log(`已写入 ${STATE}`);
