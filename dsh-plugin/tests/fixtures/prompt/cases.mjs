/**
 * 载荷快照的固定 fixture：全部虚构，不含真实人名 / 群名 / ID / 本机路径。
 * 每类载荷一个用例，快照测试（prompt-snapshot.test.mjs）用它生成 golden 文本。
 * 改这里等于改所有快照，必须是有意的。
 */

export const SELF_ID = "ou_demo_self";
export const SELF_NAME = "示例人";

const BOOK = "/tmp/im-standin/profiles/feishu/oc_demo.md";
const PEOPLE = [
  { id: "ou_demo_zhang", name: "张三", path: "/tmp/im-standin/people/feishu/ou_demo_zhang.md" },
  { id: "ou_demo_li", name: "李四", path: "/tmp/im-standin/people/feishu/ou_demo_li.md" },
];

function row(over = {}) {
  return {
    msg_id: "m1", sender_id: "ou_demo_zhang", sender_name: "张三",
    content: "这个报价能下周交吗？", ts: "2026-11-25 10:00", ts_epoch: 1000,
    kind: "mention", state: "new",
    mentions: [{ id: SELF_ID, name: SELF_NAME }],
    ...over,
  };
}

const START_CMD = {
  msg_id: "m2", sender_id: SELF_ID, sender_name: SELF_NAME,
  content: `@${SELF_NAME} 启动`, ts: "2026-11-25 10:01", ts_epoch: 1001,
  kind: "cmd", state: "new", reply_to: "m1",
  quote: {
    sender_id: "ou_demo_zhang", sender_name: "张三",
    content: "这个报价能下周交吗？", ts: "2026-11-25 10:00", msg_id: "m1",
  },
};

const FYI_ROW = row({
  msg_id: "m3", content: "周会改到周四了", kind: "fyi", state: "ignored", mentions: [],
});

const ANNOUNCED = {
  send_mode: "auto", wake_mode: "mention", cmd: true, rights: false, progress_card: null,
};

/** 五类载荷 + 开场两种入口的输入。返回值直接喂给 builder。 */
export const CASES = {
  "open-command": {
    kind: "open",
    args: ["feishu", "示例项目群", "oc_demo", [row(), START_CMD], {
      bookPath: BOOK, people: PEOPLE, sendMode: "auto", kind: "group",
      selfId: SELF_ID, selfName: SELF_NAME, dutyContext: { command: { keyword: "启动" } },
    }],
  },
  "open-manual": {
    kind: "open",
    args: ["feishu", "示例项目群", "oc_demo", [row(), FYI_ROW], {
      bookPath: BOOK, people: PEOPLE, sendMode: "draft", kind: "group",
      selfId: SELF_ID, selfName: SELF_NAME,
    }],
  },
  "wake-first": {
    kind: "wake",
    args: ["feishu", "示例项目群", "oc_demo", [row()], {
      bookPath: BOOK, people: PEOPLE, firstTurn: true, sendMode: "auto", kind: "group",
      selfId: SELF_ID, selfName: SELF_NAME,
    }],
  },
  "wake-steady": {
    kind: "wake",
    args: ["feishu", "示例项目群", "oc_demo", [row()], {
      bookPath: BOOK, firstTurn: false, sendMode: "auto", kind: "group",
      selfId: SELF_ID, selfName: SELF_NAME, announced: ANNOUNCED,
    }],
  },
  warm: {
    kind: "warm",
    args: ["feishu", "示例项目群", "oc_demo", {
      bookPath: BOOK, people: PEOPLE, idleMin: 30, closeAfterDays: 2,
    }],
  },
  desk: {
    kind: "desk",
    args: [{ platform: "feishu", name: "示例项目群", chat_id: "oc_demo", kind: "group" }, {
      facts: {
        event_id: "evt_demo", decision_path: "/tmp/im-standin/decisions/evt_demo.json",
        policy_path: "/tmp/im-standin/policies/oc_demo.md", watch_groups: 2, watch_max: 9,
        quota_used: 1, quota_max: 20, member_count: 12, member_limit: 100,
        self_id: SELF_ID, self_name: SELF_NAME,
      },
      messages: [row()],
    }],
  },
};

export function buildCase(name) {
  const c = CASES[name];
  if (!c) throw new Error(`unknown prompt case: ${name}`);
  return { kind: c.kind, args: c.args };
}