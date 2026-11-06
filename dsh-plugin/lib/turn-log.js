/**
 * turn-log.js — 值守的排障流水（本地、只记事件与 ID）。
 *
 * 为什么独立成文件而不写进 state.json：
 * - state 是快照契约（一次全量原子写），turn 事件是流水（每个 turn 5–8 行）；
 * - 面板要能看「上一次为什么没打断」，重启后不能为空；
 * - 日志不能拖垮值守：写失败只降级，不影响 turn。
 *
 * 红线：不写消息正文、发送者 ID / 名字、聊天名。字段白名单见 FIELDS。
 */
import fs from "node:fs";
import path from "node:path";

/** 单个文件上限；超过就把当前文件轮转成 turns.1.jsonl。 */
export const TURN_LOG_MAX_BYTES = 512 * 1024;
/** 内存里保留的最近事件数（面板读 /api/logs 用）。 */
export const TURN_LOG_RING = 200;

const FIELDS = new Set([
  "platform", "chat_id", "turn_id", "owner", "reason", "count",
  "interrupted", "first_turn", "wait_ms", "ms", "ok", "adopted", "state",
]);

function clean(fields) {
  const out = {};
  if (!fields || typeof fields !== "object") return out;
  for (const [k, v] of Object.entries(fields)) {
    if (!FIELDS.has(k)) continue;
    if (v === undefined || v === null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 160);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export class TurnLog {
  constructor(dir, { maxBytes = TURN_LOG_MAX_BYTES, logger = console } = {}) {
    this.dir = path.join(String(dir), "logs");
    this.file = path.join(this.dir, "turns.jsonl");
    this.rotated = path.join(this.dir, "turns.1.jsonl");
    this.maxBytes = Math.max(1, Number(maxBytes) || TURN_LOG_MAX_BYTES);
    this.logger = logger;
    this.ring = [];
    this.loaded = false;
    this.failed = false;
  }

  ensure() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      this.fail(e);
      return;
    }
    try {
      const text = fs.readFileSync(this.file, "utf8");
      for (const line of text.split("\n").filter(Boolean).slice(-TURN_LOG_RING)) {
        try { this.ring.push(JSON.parse(line)); } catch { /* 半行/坏行跳过 */ }
      }
    } catch { /* 首次没有文件 */ }
  }

  fail(e) {
    if (this.failed) return;
    this.failed = true;
    try { this.logger?.warn?.(`[im-standin] turn log: ${e?.message || e}`); } catch { /* noop */ }
  }

  /**
   * 追加一条事件。允许的字段见 FIELDS；其它字段直接丢弃。
   * @returns {object} 实际写入（或进内存）的那一行
   */
  append(event, fields = {}) {
    this.ensure();
    const row = {
      ts: Math.round(Date.now() / 100) / 10,
      event: String(event || "").slice(0, 32),
      ...clean(fields),
    };
    this.ring.push(row);
    if (this.ring.length > TURN_LOG_RING) {
      this.ring.splice(0, this.ring.length - TURN_LOG_RING);
    }
    if (this.failed) return row;
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.file, JSON.stringify(row) + "\n", { mode: 0o600 });
    } catch (e) {
      this.fail(e);
    }
    return row;
  }

  rotateIfNeeded() {
    let size = 0;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (size < this.maxBytes) return;
    try { fs.renameSync(this.file, this.rotated); } catch { /* 保留原文件继续追加 */ }
  }

  /** 最新在前，最多 n 条。启动时已从文件尾部预载。 */
  recent(n = 50) {
    this.ensure();
    const k = Math.max(1, Math.min(Number(n) || 50, TURN_LOG_RING));
    return this.ring.slice(-k).reverse();
  }
}