import assert from "node:assert/strict";
import test from "node:test";

import { requestAuthorized } from "../lib/panel-auth.js";

const TOKEN = "a".repeat(48);

function req(headers = {}) {
  return { headers };
}

test("token 命中时放行，来源是 token", () => {
  assert.equal(requestAuthorized(req({ "x-im-token": TOKEN }), TOKEN, null), "token");
});

test("token 不对但 DSH 会话放行时仍通过", () => {
  const connection = { requestRejection: () => undefined };
  assert.equal(requestAuthorized(req({ "x-im-token": TOKEN.slice(1) }), TOKEN, connection), "dsh");
});

test("没有 token、DSH 也拒绝时返回 null", () => {
  const connection = { requestRejection: () => 401 };
  assert.equal(requestAuthorized(req(), TOKEN, connection), null);
});

test("DSH 返回 403 同样拒绝", () => {
  const connection = { requestRejection: () => 403 };
  assert.equal(requestAuthorized(req(), TOKEN, connection), null);
});

test("connection 缺失 / 没有 requestRejection 时只认 token", () => {
  assert.equal(requestAuthorized(req(), TOKEN, null), null);
  assert.equal(requestAuthorized(req(), TOKEN, {}), null);
});

test("requestRejection 抛错时不放行，也不把异常抛给请求线程", () => {
  const connection = { requestRejection: () => { throw new Error("boom"); } };
  assert.equal(requestAuthorized(req(), TOKEN, connection), null);
});

test("token 必须完全相等，不做前后缀匹配", () => {
  assert.equal(requestAuthorized(req({ "x-im-token": `${TOKEN}0` }), TOKEN, null), null);
  assert.equal(requestAuthorized(req({ "x-im-token": TOKEN.slice(0, -1) }), TOKEN, null), null);
});