/**
 * 截图用的假数据。
 *
 * 为什么不用真数据：真实会话里会有同事姓名、群名、甚至告警正文（AK/SK、内部域名）。
 * 这些进了 README 就是事故。所以截图时在页面里拦掉 /api/*，换成下面这份编好的
 * 办公场景——布局、状态、字段全是真的，只有内容是假的。
 */

const now = Math.floor(Date.now() / 1000);
const day = 86400;

/** 生成「今天/昨天 HH:MM」的展示文本，跟面板里的格式对齐。 */
function stamp(secAgo) {
  const d = new Date((now - secAgo) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const hm = p(d.getHours()) + ":" + p(d.getMinutes());
  const today = new Date().toDateString() === d.toDateString();
  return (today ? "今天 " : "昨天 ") + hm;
}

const W1 = "/Users/demo/work/agent-hub";
const W2 = "/Users/demo/work/im-standin";

const chats = [
  {
    platform: "feishu", chat_id: "oc_demo_lin", name: "林一帆", kind: "p2p",
    tracked: 0, watching: 1, turn_state: "running", blocked: 0, pending: 3,
    dsh_session: "session-demo-lin", session_turns: 12, session_bound_at: now - day * 3,
    last_warm_at: now - 120, last_warm_ok: true,
    last_ts: stamp(1800), last_epoch: now - 1800, last_sync: now - 20,
    last_error: "", added_at: now - day * 3, workspace: W1,
    workspace_in_dsh: 1, workspace_effective: W1,
  },
  {
    platform: "wecom", chat_id: "wm_demo_zhou", name: "周敏", kind: "p2p",
    tracked: 0, watching: 1, turn_state: "warm", blocked: 0, pending: 0,
    dsh_session: "session-demo-zhou", session_turns: 5, session_bound_at: now - day * 2,
    last_warm_at: now - 30, last_warm_ok: true,
    last_reset: { at: now - day * 2, reason: "idle" },
    last_ts: stamp(5400), last_epoch: now - 5400, last_sync: now - 20,
    last_error: "", added_at: now - day * 2, workspace: W2,
    workspace_in_dsh: 1, workspace_effective: W2,
  },
  {
    platform: "feishu", chat_id: "oc_demo_unwatched", name: "未值守示例", kind: "p2p",
    tracked: 0, watching: 0, turn_state: "idle", blocked: 0, pending: 0,
    dsh_session: "", session_turns: 0, session_bound_at: 0,
    last_ts: "", last_epoch: 0, last_sync: 0,
    last_error: "", added_at: now - day * 4, workspace: "",
    workspace_effective: W1,
  },
  {
    platform: "feishu", chat_id: "oc_demo_grp", name: "云雀项目 · 交付群", kind: "group",
    tracked: 0, watching: 1, timer: 1, wake_mode: "mention", turn_state: "idle", blocked: 0, pending: 3,
    last_ts: stamp(60000), last_epoch: now - 60000, last_sync: now - 20,
    last_error: "", added_at: now - day, workspace: "",
    workspace_effective: W1,
  },
];

const thread = [
  { msg_id: "om_m1", platform: "feishu", chat_id: "oc_demo_lin", sender_id: "me",
    sender_name: "我", content: "上午那版接口文档发你了，有空过一下。", is_self: true,
    ts: stamp(5200), ts_epoch: now - 5200, kind: "dm", state: "replied" },
  { msg_id: "om_m2", platform: "feishu", chat_id: "oc_demo_lin", sender_id: "u_lin",
    sender_name: "林一帆", content: "在看，等我十分钟。", is_self: false,
    ts: stamp(4800), ts_epoch: now - 4800, kind: "dm", state: "opened" },
  { msg_id: "om_d0", platform: "feishu", chat_id: "oc_demo_lin", sender_id: "me",
    sender_name: "我", content: "文档我先过一遍，有问题直接在这儿说。", is_self: true,
    ts: stamp(3000), ts_epoch: now - 3000, kind: "dm", state: "replied" },
  { msg_id: "om_d1", platform: "feishu", chat_id: "oc_demo_lin", sender_id: "u_lin",
    sender_name: "林一帆", content: "好，那我一条条提。", is_self: false,
    ts: stamp(2900), ts_epoch: now - 2900, kind: "dm", state: "opened" },
  { msg_id: "om_d2", platform: "feishu", chat_id: "oc_demo_lin", sender_id: "u_lin",
    sender_name: "林一帆", content: "接口文档我看了，鉴权那节能不能补个示例？现在只有字段说明。", is_self: false,
    ts: stamp(2400), ts_epoch: now - 2400, kind: "dm", state: "new" },
  { msg_id: "om_d3", platform: "feishu", chat_id: "oc_demo_lin", sender_id: "u_lin",
    sender_name: "林一帆", content: "另外周五前能给个联调的时间点吗", is_self: false,
    ts: stamp(1800), ts_epoch: now - 1800, kind: "dm", state: "new" },
];

const inboxMessages = [
  { id: "feishu:om_d3", platform: "feishu", chat_id: "oc_demo_lin", msg_id: "om_d3",
    sender_id: "u_lin", sender_name: "林一帆", content: "另外周五前能给个联调的时间点吗",
    ts: stamp(1800), ts_epoch: now - 1800, kind: "dm", state: "new", is_self: false,
    chat_name: "林一帆", chat_kind: "p2p", chat_mode: "service" },
  { id: "feishu:om_d2", platform: "feishu", chat_id: "oc_demo_lin", msg_id: "om_d2",
    sender_id: "u_lin", sender_name: "林一帆", content: "接口文档我看了，鉴权那节能不能补个示例？现在只有字段说明。",
    ts: stamp(2400), ts_epoch: now - 2400, kind: "dm", state: "new", is_self: false,
    chat_name: "林一帆", chat_kind: "p2p", chat_mode: "service" },
  { id: "feishu:om_d1", platform: "feishu", chat_id: "oc_demo_lin", msg_id: "om_d1",
    sender_id: "u_lin", sender_name: "林一帆", content: "好，那我一条条提。",
    ts: stamp(2900), ts_epoch: now - 2900, kind: "dm", state: "opened", is_self: false,
    chat_name: "林一帆", chat_kind: "p2p", chat_mode: "service" },
  { id: "wecom:wm_1", platform: "wecom", chat_id: "wm_demo_zhou", msg_id: "wm_1",
    sender_id: "u_zhou", sender_name: "周敏", content: "合同附件我发你邮箱了，金额那栏麻烦帮我确认下",
    ts: stamp(5400), ts_epoch: now - 5400, kind: "dm", state: "new", is_self: false,
    chat_name: "周敏", chat_kind: "p2p", chat_mode: "service" },
  { id: "wecom:wm_3", platform: "wecom", chat_id: "wm_demo_zhou", msg_id: "wm_3",
    sender_id: "u_zhou", sender_name: "周敏", content: "晚上方便电话聊两句吗，五分钟就够",
    ts: stamp(9000), ts_epoch: now - 9000, kind: "dm", state: "new", is_self: false,
    chat_name: "周敏", chat_kind: "p2p", chat_mode: "service" },
  { id: "feishu:om_g1", platform: "feishu", chat_id: "oc_demo_grp", msg_id: "om_g1",
    sender_id: "u_wang", sender_name: "王珂", content: "周会纪要已上传，@你 有空看下排期那节",
    ts: stamp(60000), ts_epoch: now - 60000, kind: "mention", state: "new", is_self: false,
    chat_name: "云雀项目 · 交付群", chat_kind: "group", chat_mode: "monitor" },
  { id: "wecom:wm_2", platform: "wecom", chat_id: "wm_demo_zhou", msg_id: "wm_2",
    sender_id: "u_zhou", sender_name: "周敏", content: "另外周五的周例会要提前到两点，你看能不能来",
    ts: stamp(70000), ts_epoch: now - 70000, kind: "dm", state: "new", is_self: false,
    chat_name: "周敏", chat_kind: "p2p", chat_mode: "service" },
  { id: "feishu:om_g2", platform: "feishu", chat_id: "oc_demo_grp", msg_id: "om_g2",
    sender_id: "u_wang", sender_name: "王珂", content: "排期我按上次说的往后挪了一周，你那边能接受吗",
    ts: stamp(74000), ts_epoch: now - 74000, kind: "mention", state: "new", is_self: false,
    chat_name: "云雀项目 · 交付群", chat_kind: "group", chat_mode: "monitor" },
  { id: "feishu:om_g3", platform: "feishu", chat_id: "oc_demo_grp", msg_id: "om_g3",
    sender_id: "u_li", sender_name: "李工", content: "CI 今天下午挂了两次，是不是我们这边改的",
    ts: stamp(80000), ts_epoch: now - 80000, kind: "mention", state: "new", is_self: false,
    chat_name: "云雀项目 · 交付群", chat_kind: "group", chat_mode: "monitor" },
];

/**
 * 真实 /api/inbox 默认返回按会话聚合的形状（state.inboxGroups）。
 * 夹具按同样的字段摊出来，预览页才不会被同一个群的 3 条消息拆成 3 行。
 */
function groupInbox(rows) {
  const by = new Map();
  for (const m of rows) {
    const key = m.platform + ":" + m.chat_id;
    let g = by.get(key);
    if (!g) {
      g = {
        key, platform: m.platform, chat_id: m.chat_id,
        chat_name: m.chat_name, chat_kind: m.chat_kind, chat_mode: m.chat_mode,
        count: 0, unread: 0, last_epoch: 0, ts: "",
        msg_id: "", sender_name: "", content: "", msg_type: "", app_link: "",
        kinds: [], preview: [],
      };
      by.set(key, g);
    }
    g.count += 1;
    if (m.state === "new") g.unread += 1;
    if (!g.kinds.includes(m.kind)) g.kinds.push(m.kind);
    if ((m.ts_epoch || 0) >= g.last_epoch) {
      g.last_epoch = m.ts_epoch || 0;
      g.ts = m.ts || "";
      g.msg_id = m.msg_id || "";
      g.sender_name = m.sender_name || "";
      g.content = m.content || "";
      g.msg_type = m.msg_type || "";
      g.app_link = m.app_link || "";
    }
    g.preview.push(m);
  }
  const items = [...by.values()].map((g) => ({
    ...g,
    preview: g.preview
      .slice()
      .sort((a, b) => b.ts_epoch - a.ts_epoch)
      .slice(0, 3)
      .map((m) => ({ ...m })),
  }));
  items.sort((a, b) => b.last_epoch - a.last_epoch);
  return {
    filter: "todo", grouped: true, items,
    chats: items.length,
    total: items.reduce((n, g) => n + g.count, 0),
  };
}

const inboxGroups = groupInbox(inboxMessages);

const searchUsers = [
  { id: "ou_demo_lin", chat_id: "oc_demo_lin", name: "林一帆", department: "产品部" },
  { id: "ou_demo_wang", chat_id: "", name: "王珂", department: "研发部 / 平台组" },
  { id: "ou_demo_chen", chat_id: "", name: "陈语", department: "财务部" },
];

const searchChats = [
  { chat_id: "oc_demo_grp", name: "云雀项目 · 交付群", kind: "group" },
  { chat_id: "oc_demo_ops", name: "线上告警 · 值班群", kind: "group" },
];

const targets = [
  {
    platform: "feishu", name: "林一帆", chat_id: "oc_demo_lin", open_id: "ou_demo_lin",
    kind: "p2p", in_env: true,
    profile: "# 林一帆\n\n> 飞书 · oc_demo_lin\n> 画像由值守 agent 与面板共同维护：只写下次值守还会用到的信息，不保存聊天原文。\n\n## 对方是谁\n\n- 产品部，云雀项目交付负责人。\n\n## 沟通偏好\n\n- 先要结论，再要细节；大段铺垫会被跳过。\n\n## 在意与忌讳\n\n- 不接受「我催一下」这种没有时间点的回复。\n\n## 历史结论\n\n- 说「马上」≈ 两天；催第三次才会真的动。\n- 会上不表态的事，会后私聊才是他的真意见。\n- 报价先给区间和口径，别先解释成本。\n",
    profile_excerpt: "产品部，负责云雀项目交付。",
    profile_path: "profiles/feishu/oc_demo_lin.md",
    profile_updated_at: now - 3600,
    notes: [
      { index: 0, note: "先要结论，再要细节；大段铺垫会被跳过", at: "2026-10-28" },
      { index: 1, note: "周五下午固定开会，那个点找他大概率不回", at: "2026-10-30" },
    ],
    chat: { watching: true, mode: "service", auto_send: false, workspace: W1,
            last_sync: now - 20, last_error: "" },
  },
  {
    platform: "wecom", name: "周敏", chat_id: "wm_demo_zhou", open_id: "ou_demo_zhou",
    kind: "p2p", in_env: true,
    profile: "# 周敏\n\n> 企业微信 · wm_demo_zhou\n> 画像由值守 agent 与面板共同维护：只写下次值守还会用到的信息，不保存聊天原文。\n\n## 对方是谁\n\n- 财务部，合同与付款对接人。\n\n## 在意与忌讳\n\n- 金额、合同、对外承诺一律先问她本人。\n",
    profile_excerpt: "财务部，合同与付款对接人。",
    profile_path: "profiles/wecom/wm_demo_zhou.md",
    profile_updated_at: now - 7200,
    notes: [
      { index: 0, note: "只在企业微信找她，别发邮件", at: "2026-10-29" },
      { index: 1, note: "金额、合同、对外承诺一律先问她本人", at: "2026-10-30" },
    ],
    chat: { watching: true, mode: "service", auto_send: true, workspace: W2,
            last_sync: now - 20, last_error: "" },
  },
];

const status = {
  running: true, paused: false,
  started_at: now - 7200, uptime: 7200, cycles: 96,
  last_cycle_at: now - 18, last_cycle_ms: 1240, next_cycle_at: now + 27,
  poll_interval: 45,
  poll: {
    interval_min: 10, interval_sec: 600, fast_sec: 60, fast_at: now - 20,
    min_interval_min: 10, dm_scope: "recent", dm_recent: 20, cooldown_sec: 20,
    next_cycle_at: now + 582, due_in: 582,
    timer_dm: 3, timer_group: 1, groups: 1, blocked: 0,
    last_fast: { at: now - 20, chats: 2, new: 0, skipped: 1, targets: 2, ms: 420 },
    last_result: { at: now - 300, chats: 2, new: 1, skipped: 0, targets: 2, ms: 980 },
  },
  platforms: [
    { platform: "feishu", logged_in: true, watched: 2, service: 1, chats: 2,
      self_name: "示例本人", self_id: "ou_demo_self_0123456789", cli: "lark-cli" },
    { platform: "wecom", logged_in: true, watched: 1, service: 1, chats: 1,
      self_name: "示例本人", self_id: "wm_demo_self_9876543210", cli: "wecom-cli" },
  ],
  counts: { todo: inboxGroups.total, unread: 8, mention: 3, dm: 5, service: 2, replied: 12 },
  errors: [],
  dsh: { engine: "dsh", configured: true, dsh_ready: true, label: "跟随 DSH 配置" },
  instances: [
    { platform: "feishu", chat_id: "oc_demo_lin", name: "林一帆", kind: "p2p",
      workspace: W1, dsh_session: "session-demo-lin", session_bound_at: now - day * 3,
      session_turns: 12, turn_state: "running", watching: true,
      last_warm_at: now - 120, last_warm_ok: true },
    { platform: "wecom", chat_id: "wm_demo_zhou", name: "周敏", kind: "p2p",
      workspace: W2, dsh_session: "session-demo-zhou", session_bound_at: now - day * 2,
      session_turns: 5, turn_state: "warm", watching: true,
      last_warm_at: now - 30, last_warm_ok: true,
      last_reset: { at: now - day * 2, reason: "idle" } },
  ],
};

const config = {
  poll: { interval_min: 10, dm_scope: "recent", dm_recent: 20, cooldown_sec: 20,
          min_interval_min: 10, max_interval_min: 240, interval_sec: 600, fast_sec: 60 },
  platforms: ["feishu", "wecom"],
  dsh: { timeout: 600, full_access: true, idle_reset_min: 180, warm_min: 55 },
  resolved: { dsh_ready: true, label: "跟随 DSH 配置" },
};
// 面板的设置页从 /api/status 的 config 字段读配置（真实 server 也是这么给的）
status.config = config;

const workspaces = {
  items: [
    { id: "ws-1", path: W1, title: "agent-hub", is_default: true, exists: true,
      sessions: 3, updated_at: "2026-10-31T09:12:00.000Z" },
    { id: "ws-2", path: W2, title: "im-standin", is_default: false, exists: true,
      sessions: 1, updated_at: "2026-10-30T20:40:00.000Z" },
  ],
  default: W1,
};

// 每日关注摘要：面板只显示原文，这里给一份虚构的（人物仍来自本文件的示例）。
const _d = new Date();
const _p = (n) => (n < 10 ? "0" + n : "" + n);
const TODAY = `${_d.getFullYear()}-${_p(_d.getMonth() + 1)}-${_p(_d.getDate())}`;
const digest = {
  ok: true, date: TODAY, exists: true,
  mtime: Math.floor(_d.getTime() / 1000) - 3600,
  text: [
    `# ${TODAY} · 今日关注`,
    "",
    "> agent 整理；覆盖写，不是日志。最新更新 14:30。",
    "",
    "## P1 · 等你拍板",
    "- [P1] 周明 · 飞书私聊 · 问报价能否下周交 · 首次 " + TODAY + " 10:20 · 最近 13:05 · 待回 2",
    "",
    "## P2 · 在等回复（超过 4 小时）",
    "- [P2] 示例客户 · 企业微信私聊 · 在等回复 · 首次 11-01 21:10 · 最近 11-01 21:10 · 待回 3",
    "",
    "## 今日已处理",
    "- 14:30 示例对象 · 已回复",
    "",
  ].join("\n"),
};

/** 按路径返回夹具；没覆盖的接口回落到真实服务。 */
export function resolve(path) {
  const p = path.split("?")[0];
  if (p === "/api/status") return status;
  if (p === "/api/chats") return { items: chats };
  if (p === "/api/inbox") return { ...inboxGroups, counts: status.counts };
  if (p === "/api/digest") return digest;
  if (p === "/api/thread") return { chat: chats[0], items: thread };
  if (p === "/api/search") return { ok: true, items: searchUsers };
  if (p === "/api/search/chats") return { ok: true, items: searchChats };
  if (p === "/api/targets") return { items: targets };
  if (p === "/api/workspaces") return workspaces;
  if (p === "/api/config") return config;
  if (p === "/api/doctor") return { checks: [] };
  return null;
}

/** 注入到页面里的拦截器源码（字符串，走 addScriptToEvaluateOnNewDocument）。 */
export const intercept = `(() => {
  const FIX = ${JSON.stringify({ chats, inbox: inboxGroups, thread, targets, workspaces, status, config, searchUsers, searchChats, digest })};
  const chatFor = (path) => {
    const q = new URLSearchParams(path.split("?")[1] || "");
    return FIX.chats.find((c) => c.platform === q.get("platform") && c.chat_id === q.get("chat_id")) || FIX.chats[0];
  };
  const emptyMode = () => {
    const m = /(?:^|[#&])empty=([^&]+)/.exec(location.hash || "");
    return m ? decodeURIComponent(m[1]) : "";
  };
  const zeroCounts = () => ({ todo: 0, unread: 0, unread_dm: 0, unread_mention: 0 });
  const pick = (path) => {
    const p = path.split("?")[0];
    if (p === "/api/status") {
      return emptyMode() ? { ...FIX.status, counts: zeroCounts() } : FIX.status;
    }
    if (p === "/api/chats") return { items: FIX.chats };
    if (p === "/api/inbox") {
      if (emptyMode()) {
        return { ...FIX.inbox, items: [], chats: 0, total: 0, counts: zeroCounts() };
      }
      const blocked = new Set(FIX.chats.filter((c) => c.blocked).map((c) => c.platform + ":" + c.chat_id));
      const items = FIX.inbox.items.filter((g) => !blocked.has(g.key));
      return { ...FIX.inbox, items, chats: items.length,
               total: items.reduce((n, g) => n + g.count, 0), counts: FIX.status.counts };
    }
    if (p === "/api/digest") return FIX.digest;
    if (p === "/api/thread") {
      const c = chatFor(path);
      return { chat: c, items: FIX.thread.filter((m) => m.chat_id === c.chat_id) };
    }
    if (p === "/api/search") return { ok: true, items: FIX.searchUsers };
    if (p === "/api/search/chats") return { ok: true, items: FIX.searchChats };
    if (p === "/api/targets") return { items: FIX.targets };
    if (p === "/api/workspaces") return FIX.workspaces;
    if (p === "/api/config") return FIX.config;
    if (p === "/api/doctor") return { checks: [] };
    return null;
  };

  // 仅演示页：在 hash 里写 #fail=inbox / #fail=status / #fail=chats，
  // 对应 GET 一律回 500，用来复现「失败不装空」。不进入运行时。
  const failed = () => {
    const m = /(?:^|[#&])fail=([^&]+)/.exec(location.hash || "");
    return new Set((m ? decodeURIComponent(m[1]) : "").split(",").filter(Boolean));
  };
  const FAIL_KEY = {
    "/api/inbox": "inbox", "/api/status": "status", "/api/chats": "chats",
    "/api/targets": "targets", "/api/thread": "thread", "/api/digest": "digest",
  };

  // 仅演示页：让确认类操作也有可观察的结果，不影响真实服务。
  const mutate = (p, body) => {
    body = body || {};
    window.__imDemoMutations = window.__imDemoMutations || [];
    window.__imDemoMutations.push({ p, at: Date.now(), body });
    if (p === "/api/chat/block") {
      for (const c of FIX.chats) {
        if (c.platform === body.platform && c.chat_id === body.chat_id) c.blocked = body.blocked ? 1 : 0;
      }
      FIX.status.poll.blocked = FIX.chats.filter((c) => c.blocked).length;
      return { ok: true, blocked: !!body.blocked, ignored: body.blocked ? FIX.inbox.items[0]?.count || 0 : 0 };
    }
    if (p === "/api/inbox/cleanup") {
      const ignored = FIX.inbox.total || 0;
      FIX.inbox = { ...FIX.inbox, items: [], chats: 0, total: 0, counts: zeroCounts() };
      FIX.status.counts = zeroCounts();
      return { ok: true, ignored };
    }
    if (p === "/api/send") return { ok: true };
    if (p === "/api/state") return { ok: true };
    if (p === "/api/watch" || p === "/api/unwatch") {
      const c = FIX.chats.find((x) => x.platform === body.platform && x.chat_id === body.chat_id);
      if (c) c.watching = p === "/api/unwatch" ? 0 : (body.watching === false ? 0 : 1);
      return { ok: true, open: { ok: true } };
    }
    if (p === "/api/chat/mode") {
      const row = FIX.chats.find((x) => x.platform === body.platform && x.chat_id === body.chat_id) || {};
      row.watching = body.mode === "off" ? 0 : 1;
      row.timer = body.mode === "off" ? -1 : 1;
      row.wake_mode = body.mode === "all" ? "all" : "mention";
      return { ok: true, chat: row, open: { ok: body.mode !== "off" } };
    }
    if (p === "/api/chat/timer") {
      const c = FIX.chats.find((x) => x.platform === body.platform && x.chat_id === body.chat_id);
      if (c) c.timer = body.timer;
      return { ok: true };
    }
    if (p === "/api/chat/workspace") {
      const c = FIX.chats.find((x) => x.platform === body.platform && x.chat_id === body.chat_id);
      if (c) c.workspace = body.workspace || "";
      return { ok: true };
    }
    if (p === "/api/chat/wake" || p === "/api/pause") return { ok: true };
    if (p === "/api/chat/session/reset") {
      const c = FIX.chats.find((x) => x.platform === body.platform && x.chat_id === body.chat_id);
      if (c) { c.dsh_session = ""; c.session_turns = 0; c.turn_state = "idle"; }
      return { ok: true };
    }
    if (p === "/api/config") {
      const merge = (dst, src) => {
        for (const [k, v] of Object.entries(src || {})) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            dst[k] = merge(dst[k] || {}, v);
          } else dst[k] = v;
        }
        return dst;
      };
      merge(FIX.config, body);
      merge(FIX.status.config || (FIX.status.config = {}), body);
      if (body.poll) merge(FIX.status.poll || (FIX.status.poll = {}), body.poll);
      return FIX.config;
    }
    if (p === "/api/poll") return { ok: true, busy: false };
    return null;
  };

  const real = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = typeof u === "string" ? u : (u && u.url) || "";
    const PREFIX = "/plugins/im-standin";
    const i = url.indexOf(PREFIX + "/api/");
    // 只拦值守服务的同源前缀，别碰到 DSH 自己的 /api/*
    if (i >= 0) {
      const path = url.slice(i + PREFIX.length);
      const p = path.split("?")[0];
      const method = String((o && o.method) || "GET").toUpperCase();
      let body = null;
      try { body = o && o.body ? JSON.parse(o.body) : null; } catch (e) { body = null; }
      // #fail=auth：所有请求回 401，用来验证「只自动刷新一次、之后明确提示凭据过期」。
      if (failed().has("auth")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "会话凭据过期" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        }));
      }
      if (method === "GET" && FAIL_KEY[p] && failed().has(FAIL_KEY[p])) {
        return Promise.resolve(new Response(JSON.stringify({ error: "演示故障：这个接口被 #fail=" + FAIL_KEY[p] + " 关掉了" }), {
          status: 500, headers: { "Content-Type": "application/json" },
        }));
      }
      if (method !== "GET" && failed().has("mutate")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "演示故障：写操作被 #fail=mutate 关掉了" }), {
          status: 500, headers: { "Content-Type": "application/json" },
        }));
      }
      const hit = method === "GET" ? pick(path) : mutate(p, body);
      if (hit) return Promise.resolve(new Response(JSON.stringify(hit), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    return real(u, o);
  };
})();`;
