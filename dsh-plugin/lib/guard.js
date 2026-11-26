/**
 * guard.js — 中断收尾保护：给只有 reasoning 的 interrupted assistant 消息补一个正文块。
 *
 * 上游事实（DSH 0.2.2-rc.5，Discussion #14340）：
 *   1. 流式回答在思考阶段被停止时，agent loop 会落一条 interrupted: true 的
 *      assistant/message，内容可能只有 reasoning（见 agent.ts 的 interruptedBlocks()）。
 *   2. 下一轮请求把它序列化成只含 thinking 块的 assistant 消息；严格按 Anthropic
 *      Messages 协议的网关直接 400（The content field is a required field）。
 *   3. 这条消息常驻历史，之后每轮都失败，会话永久卡死。
 *
 * 我们不改 DSH 安装目录，也不改事件类型 / seq / 已有历史，只在当前进程内包一层
 * session.append：命中时用浅拷贝构造新 data，在 content 末尾补一个 text 块。
 * 占位文案用 Markdown 链接定义包住——GFM 把 definition 节点渲染为 null，聊天转录
 * 看不到；序列化时它仍是普通 text，模型请求因此合法。
 */

const LOG = "[im-standin]";
const MARK = Symbol.for("dsh-cyber-im-avatar.reasoning-guard");
const installed = new WeakSet();

/** 占位文案。改这里即可换文案。 */
export const REASONING_GUARD_TEXT = "（上一轮在思考阶段被中断，未产生内容）";

/**
 * 实际写进 content 的 text。
 *
 * 不能直接写裸文案：interrupted assistant 的 content 会原样进聊天渲染，用户会看到
 * 一行并不存在的「正文」。`[//]: # (...)` 是 Markdown 链接定义，只参与解析、不产出
 * DOM；模型请求里仍是一段非空 text，能满足网关要求。
 */
export const REASONING_GUARD_BLOCK_TEXT = `[//]: # (${REASONING_GUARD_TEXT})`;

/** 环境变量 IM_REASONING_GUARD=0 关闭；默认开启。 */
function guardEnabled() {
  return String(process.env.IM_REASONING_GUARD ?? "").trim() !== "0";
}

/**
 * 是否需要补块。
 *
 * 条件全部满足：assistant/message、interrupted、content 是数组，且没有非空白 text、
 * 没有 tool-call、没有 image。未知块类型不改变判断——只要正文类内容为空就补。
 */
function needsStandinBlock(data) {
  if (!data || typeof data !== "object") return false;
  if (data.interrupted !== true) return false;
  const message = data.message;
  if (!message || typeof message !== "object") return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool-call" || block.type === "image") return false;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      return false;
    }
  }
  return true;
}

/** 浅拷贝 data/message，追加占位块；不改原对象（data/message 可能是 frozen）。 */
function withStandinBlock(data) {
  return {
    ...data,
    message: {
      ...data.message,
      content: [...data.message.content, { type: "text", text: REASONING_GUARD_BLOCK_TEXT }],
    },
  };
}

function warn(logger, message, error) {
  try {
    logger?.warn?.(LOG, message, error && error.message ? error.message : error);
  } catch {
    /* 日志失败不能影响主流程 */
  }
}

/** 包装一个 session；返回 true 表示本次确实安装（已装过 / 不可包装返回 false）。 */
function installOne(session, logger) {
  if (!session || typeof session !== "object") return false;
  if (installed.has(session)) return false;
  try {
    if (session[MARK] === true) return false;
  } catch {
    /* 取标记失败时按未安装继续，下面会再兜一次 */
  }
  const original = session.append;
  if (typeof original !== "function") return false;

  const guarded = function guardedAppend(type, data, ...opts) {
    let nextData = data;
    let hit = false;
    try {
      if (type === "assistant/message" && needsStandinBlock(data)) {
        nextData = withStandinBlock(data);
        hit = true;
      }
    } catch (error) {
      // 守护逻辑自己出错：宁可少补一块，也要按原参数把事件写进去。
      nextData = data;
      hit = false;
      warn(logger, "reasoning guard inspect failed:", error);
    }

    // 原 append 的错误必须原样抛出（agent loop 依赖异常结束本轮），不在这里兜底重试。
    const event = original.call(session, type, nextData, ...opts);

    if (hit) {
      try {
        const seq = event && typeof event === "object" ? event.seq : undefined;
        logger?.log?.(LOG, `reasoning guard: stand-in text appended (session=${session.id || "?"}, seq=${seq ?? "?"})`);
      } catch {
        /* 日志失败不能影响已成功的事件 */
      }
    }
    return event;
  };

  try {
    session.append = guarded;
    try {
      Object.defineProperty(session, MARK, { value: true, configurable: true, enumerable: false });
    } catch {
      /* 不可扩展时靠 WeakSet 防重复 */
    }
    installed.add(session);
    try {
      logger?.log?.(LOG, `reasoning guard installed (session=${session.id || "?"})`);
    } catch {
      /* 日志失败不能影响安装 */
    }
    return true;
  } catch (error) {
    warn(logger, "reasoning guard install failed:", error);
    return false;
  }
}

/**
 * 安装中断收尾保护。apply() 里调用一次。
 *
 * 先挂 session/created 覆盖新会话，再扫 sessions.list() 覆盖已有会话；两边都靠
 * session 上的标记 / WeakSet 保证同一个实例只包一次。所有回调内部自行 try/catch，
 * 不向 DSH 的创建流程抛错（同步抛错会否决会话创建）。
 *
 * @param ctx - 插件根 Context（提供 sessions 服务与 session/created 事件）。
 * @param [options] - 可选 `logger`，默认 console；测试可传静默 logger。
 */
export function installReasoningGuard(ctx, options = {}) {
  const logger = options.logger ?? console;
  if (!guardEnabled()) {
    try {
      logger?.log?.(LOG, "reasoning guard disabled by IM_REASONING_GUARD=0");
    } catch {
      /* noop */
    }
    return;
  }

  try {
    ctx.on("session/created", (session) => {
      try {
        installOne(session, logger);
      } catch (error) {
        warn(logger, "reasoning guard install failed:", error);
      }
    });
  } catch (error) {
    warn(logger, "reasoning guard cannot listen session/created:", error);
  }

  try {
    ctx.inject(["sessions"], (hostCtx) => {
      try {
        const store = hostCtx && hostCtx.sessions;
        if (!store || typeof store.list !== "function") return;
        for (const session of store.list()) {
          try {
            installOne(session, logger);
          } catch (error) {
            warn(logger, "reasoning guard install failed:", error);
          }
        }
      } catch (error) {
        warn(logger, "reasoning guard scan failed:", error);
      }
    });
  } catch (error) {
    warn(logger, "reasoning guard cannot inject sessions:", error);
  }
}
