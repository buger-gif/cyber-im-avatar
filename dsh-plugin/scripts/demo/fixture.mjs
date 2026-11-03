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
    tracked: 0, watching: 1, turn_state: "running",
    dsh_session: "session-demo-lin", session_turns: 12, session_bound_at: now - day * 3,
    last_ts: stamp(1800), last_epoch: now - 1800, last_sync: now - 20,
    last_error: "", added_at: now - day * 3, workspace: W1,
  },
  {
    platform: "wecom", chat_id: "wm_demo_zhou", name: "周敏", kind: "p2p",
    tracked: 0, watching: 1, turn_state: "idle",
    dsh_session: "session-demo-zhou", session_turns: 5, session_bound_at: now - day * 2,
    last_ts: stamp(5400), last_epoch: now - 5400, last_sync: now - 20,
    last_error: "", added_at: now - day * 2, workspace: W2,
  },
  {
    platform: "feishu", chat_id: "oc_demo_grp", name: "云雀项目 · 交付群", kind: "group",
    tracked: 0, watching: 1, turn_state: "idle",
    last_ts: stamp(60000), last_epoch: now - 60000, last_sync: now - 20,
    last_error: "", added_at: now - day, workspace: "",
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

const inbox = [
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
  platforms: [
    { platform: "feishu", logged_in: true, watched: 2, service: 1 },
    { platform: "wecom", logged_in: true, watched: 1, service: 1 },
  ],
  counts: { todo: inbox.length, unread: 4, mention: 2, dm: 4, service: 2, replied: 12 },
  errors: [],
  dsh: { engine: "dsh", configured: true, dsh_ready: true, label: "跟随 DSH 配置" },
  instances: [
    { platform: "feishu", chat_id: "oc_demo_lin", name: "林一帆", kind: "p2p",
      workspace: W1, dsh_session: "session-demo-lin", session_bound_at: now - day * 3,
      session_turns: 12, turn_state: "running", watching: true },
    { platform: "wecom", chat_id: "wm_demo_zhou", name: "周敏", kind: "p2p",
      workspace: W2, dsh_session: "session-demo-zhou", session_bound_at: now - day * 2,
      session_turns: 5, turn_state: "idle", watching: true },
  ],
};

const config = {
  poll: { interval_min: 10, dm_scope: "recent", dm_recent: 20, cooldown_sec: 20,
          min_interval_min: 10, max_interval_min: 240, interval_sec: 600 },
  platforms: ["feishu", "wecom"],
  dsh: { profile: "headless", timeout: 600 },
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

/** 按路径返回夹具；没覆盖的接口回落到真实服务。 */
export function resolve(path) {
  const p = path.split("?")[0];
  if (p === "/api/status") return status;
  if (p === "/api/chats") return { items: chats };
  if (p === "/api/inbox") return { filter: "todo", items: inbox, counts: status.counts };
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
  const FIX = ${JSON.stringify({ chats, inbox, thread, targets, workspaces, status, config, searchUsers, searchChats })};
  const pick = (path) => {
    const p = path.split("?")[0];
    if (p === "/api/status") return FIX.status;
    if (p === "/api/chats") return { items: FIX.chats };
    if (p === "/api/inbox") return { filter: "todo", items: FIX.inbox, counts: FIX.status.counts };
    if (p === "/api/thread") return { chat: FIX.chats[0], items: FIX.thread };
    if (p === "/api/search") return { ok: true, items: FIX.searchUsers };
    if (p === "/api/search/chats") return { ok: true, items: FIX.searchChats };
    if (p === "/api/targets") return { items: FIX.targets };
    if (p === "/api/workspaces") return FIX.workspaces;
    if (p === "/api/config") return FIX.config;
    if (p === "/api/doctor") return { checks: [] };
    return null;
  };
  const real = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = typeof u === "string" ? u : (u && u.url) || "";
    const PREFIX = "/plugins/im-standin";
    const i = url.indexOf(PREFIX + "/api/");
    // 只拦值守服务的同源前缀，别碰到 DSH 自己的 /api/*
    if (i >= 0) {
      const hit = pick(url.slice(i + PREFIX.length));
      if (hit) return Promise.resolve(new Response(JSON.stringify(hit), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    return real(u, o);
  };
})();`;
