import assert from "node:assert/strict";
import test from "node:test";

import {
  installReasoningGuard,
  REASONING_GUARD_BLOCK_TEXT,
  REASONING_GUARD_TEXT,
} from "../lib/guard.js";

function quietLogger() {
  const lines = [];
  return {
    lines,
    log(...args) { lines.push(args.join(" ")); },
    warn(...args) { lines.push(args.join(" ")); },
  };
}

function fakeSession(id = "s1", impl) {
  const calls = [];
  const session = {
    id,
    calls,
    append(type, data, ...opts) {
      calls.push({ type, data, opts });
      return impl ? impl(type, data, ...opts) : { type, data, seq: calls.length };
    },
  };
  return session;
}

function fakeCtx(sessions) {
  const handlers = new Map();
  const injects = [];
  return {
    handlers,
    injects,
    on(event, fn) { handlers.set(event, fn); },
    inject(names, fn) { injects.push({ names, fn }); fn({ sessions }); },
    emit(event, arg) { handlers.get(event)?.(arg); },
  };
}

function install(sessions, options = {}) {
  const ctx = fakeCtx(sessions);
  const logger = options.logger ?? quietLogger();
  installReasoningGuard(ctx, { logger });
  return { ctx, logger };
}

function frozenData(content, extra = {}) {
  return Object.freeze({
    interrupted: true,
    ...extra,
    message: Object.freeze({
      role: "assistant",
      content: Object.freeze(content.map((block) => Object.freeze(block))),
    }),
  });
}

const opts = Object.freeze({ surfaceOp: "append" });

test("interrupted + 只有 reasoning：浅拷贝后末尾补一个仅模型可见的 text 块", () => {
  const session = fakeSession();
  const data = frozenData([{ type: "reasoning", text: "只想了半句" }]);
  install({ list: () => [session] });

  const result = session.append("assistant/message", data, opts);

  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].type, "assistant/message");
  assert.equal(session.calls[0].opts[0], opts);
  assert.notEqual(session.calls[0].data, data, "不应原地修改 frozen data");
  assert.equal(data.message.content.length, 1, "原对象不能被改");
  const content = session.calls[0].data.message.content;
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: "reasoning", text: "只想了半句" });
  assert.deepEqual(content[1], { type: "text", text: REASONING_GUARD_BLOCK_TEXT });
  assert.ok(content[1].text.includes(REASONING_GUARD_TEXT));
  assert.equal(result.seq, 1);
});

test("interrupted + 有正文 / tool-call / image：原样透传同一个 data", () => {
  const cases = [
    ["正文", [{ type: "reasoning", text: "想" }, { type: "text", text: "答案" }]],
    ["tool-call", [{ type: "reasoning", text: "想" }, { type: "tool-call", id: "t1", name: "read" }]],
    ["image", [{ type: "reasoning", text: "想" }, { type: "image", attachment: { attachmentId: "a1" } }]],
  ];
  for (const [name, content] of cases) {
    const session = fakeSession();
    const data = frozenData(content);
    install({ list: () => [session] });
    session.append("assistant/message", data, opts);
    assert.equal(session.calls.length, 1, name);
    assert.equal(session.calls[0].data, data, name);
  }

  const session = fakeSession();
  const data = frozenData([{ type: "text", text: "  \n\t " }, { type: "reasoning", text: "想" }]);
  install({ list: () => [session] });
  session.append("assistant/message", data, opts);
  assert.equal(session.calls[0].data.message.content.length, 3, "空白正文不算正文");
});

test("非 interrupted / 非 assistant/message / content 不是数组：原样透传", () => {
  const session = fakeSession();
  install({ list: () => [session] });

  const nonInterrupted = frozenData([{ type: "reasoning", text: "想" }], { interrupted: false });
  session.append("assistant/message", nonInterrupted, opts);
  assert.equal(session.calls.at(-1).data, nonInterrupted);

  const otherType = frozenData([{ type: "reasoning", text: "想" }]);
  session.append("user/message", otherType, opts);
  assert.equal(session.calls.at(-1).data, otherType);

  const noArray = { interrupted: true, message: { role: "assistant", content: "not-an-array" } };
  session.append("assistant/message", noArray, opts);
  assert.equal(session.calls.at(-1).data, noArray);

  assert.equal(session.calls.length, 3);
});

test("原 append 抛错：异常原样抛出，不吞掉也不重试", () => {
  const boom = new Error("append boom");
  let calls = 0;
  const session = fakeSession("s-throw", () => {
    calls += 1;
    throw boom;
  });
  install({ list: () => [session] });

  assert.throws(
    () => session.append("assistant/message", frozenData([{ type: "reasoning", text: "想" }]), opts),
    (error) => error === boom,
  );
  assert.equal(calls, 1, "只调用一次原 append");
});

test("同一个 session 只包装一次；session/created 覆盖新会话", () => {
  const session = fakeSession("s-new");
  const sessions = { list: () => [] };
  const { ctx, logger } = install(sessions);

  ctx.emit("session/created", session);
  ctx.emit("session/created", session);
  installReasoningGuard(ctx, { logger });

  session.append("assistant/message", frozenData([{ type: "reasoning", text: "想" }]), opts);
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0].data.message.content.length, 2);
  assert.equal(logger.lines.filter((line) => line.includes("reasoning guard installed")).length, 1);
});

test("实例级包装：不改原型，其他实例不受影响", () => {
  class Session {
    constructor() { this.calls = []; }
    append(type, data) {
      this.calls.push({ type, data });
      return { seq: this.calls.length };
    }
  }
  const wrapped = new Session();
  const plain = new Session();
  const originalPrototype = Session.prototype.append;
  install({ list: () => [wrapped] });

  assert.equal(Session.prototype.append, originalPrototype);
  assert.equal(Object.hasOwn(wrapped, "append"), true);
  assert.equal(Object.hasOwn(plain, "append"), false);

  wrapped.append("assistant/message", frozenData([{ type: "reasoning", text: "想" }]), opts);
  plain.append("assistant/message", frozenData([{ type: "reasoning", text: "想" }]), opts);
  assert.equal(wrapped.calls[0].data.message.content.length, 2);
  assert.equal(plain.calls[0].data.message.content.length, 1);
});

test("IM_REASONING_GUARD=0：完全旁路，不挂监听也不包装", () => {
  const old = process.env.IM_REASONING_GUARD;
  process.env.IM_REASONING_GUARD = "0";
  try {
    const session = fakeSession();
    const ctx = fakeCtx({ list: () => [session] });
    const logger = quietLogger();
    installReasoningGuard(ctx, { logger });
    assert.equal(ctx.handlers.size, 0);
    assert.equal(ctx.injects.length, 0);
    const data = frozenData([{ type: "reasoning", text: "想" }]);
    session.append("assistant/message", data, opts);
    assert.equal(session.calls[0].data, data);
    assert.ok(logger.lines.some((line) => line.includes("disabled")));
  } finally {
    if (old === undefined) delete process.env.IM_REASONING_GUARD;
    else process.env.IM_REASONING_GUARD = old;
  }
});

test("安装 / 命中日志带 [im-standin] 前缀，且不打印消息内容", () => {
  const session = fakeSession("s-log");
  const logger = quietLogger();
  install({ list: () => [session] }, { logger });
  session.append("assistant/message", frozenData([{ type: "reasoning", text: "秘密推理内容" }]), opts);

  const installLine = logger.lines.find((line) => line.includes("reasoning guard installed"));
  const hitLine = logger.lines.find((line) => line.includes("stand-in text appended"));
  assert.ok(installLine.startsWith("[im-standin]"), installLine);
  assert.ok(hitLine.startsWith("[im-standin]"), hitLine);
  assert.ok(hitLine.includes("session=s-log"));
  assert.ok(!logger.lines.join("\n").includes("秘密推理内容"));
});
