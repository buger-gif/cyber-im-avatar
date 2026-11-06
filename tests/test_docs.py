#!/usr/bin/env python3
"""test_docs.py — 文档-代码对账（防劣化的主体）。

三份冻结契约（docs/specs/contracts/）声称是「路由 / state.json / 配置的确切形状」，
这里逐条与 Node 代码对账：漂了就是红，谁改代码谁同 commit 改契约。

另查：版本三处一致、构建产物新鲜度、verify_docs 全量通过。

被 tests/run_tests.py 调用：import test_docs; test_docs.main(run_tests.check)
也可单跑：python3 tests/test_docs.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PLUG = os.path.join(ROOT, "dsh-plugin")
CONTRACTS = os.path.join(ROOT, "docs", "specs", "contracts")

CHECK = None            # 由 run_tests.py 注入；单跑时用内置实现
_passed = _failed = 0

NODE_PROBE = r"""
import { ROUTES, POST_ROUTES, DELETE_ROUTES } from "./lib/app.js";
import { State, DEFAULT_CONFIG, RETIRED_KEYS, normalizeConfig } from "./lib/state.js";

const dir = process.env.IM_DOC_TMP;
const state = new State(dir);
state.load();
const chat = state.ensureChat("feishu", "oc_doc", { name: "文档对象", kind: "p2p", target: true });
state.mergeRecent(chat, [{
  msg_id: "m1", sender_id: "ou_doc", sender_name: "文档", content: "正文",
  ts: "2026-11-02 12:00:00", ts_epoch: 1793601600, kind: "dm", state: "new",
}]);

const flat = {};
for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k2, v2] of Object.entries(v)) flat[`${k}.${k2}`] = v2;
  } else flat[k] = v;
}
const RANGE_KEYS = ["poll.interval_min", "poll.fast_sec", "poll.dm_recent", "poll.per_chat_limit",
  "poll.backfill_hours", "poll.cooldown_sec", "poll.group_wake_sec", "dsh.timeout",
  "dsh.turn_cap_sec", "dsh.warm_min"];
function extreme(value) {
  const cfg = { poll: {}, dsh: {} };
  for (const key of RANGE_KEYS) {
    const parts = key.split(".");
    const node = parts[0] === "dsh" ? cfg.dsh : cfg.poll;
    node[parts[1]] = value;
  }
  const out = normalizeConfig(cfg);
  const got = {};
  for (const key of RANGE_KEYS) {
    const parts = key.split(".");
    got[key] = parts[0] === "dsh" ? out.dsh[parts[1]] : out.poll[parts[1]];
  }
  return got;
}
const legacyInput = {
  poll_interval: 600, recent_chats: 12, per_chat_limit: 8, backfill_hours: 24,
  poll_watched_only: true, chatlist_interval: 300, port: 8765,
};
const legacy = normalizeConfig(legacyInput);

console.log(JSON.stringify({
  routes: { get: Object.keys(ROUTES), post: Object.keys(POST_ROUTES), del: Object.keys(DELETE_ROUTES) },
  stateKeys: Object.keys(state.data),
  chatKeys: Object.keys(chat),
  msgKeys: Object.keys(chat.recent[0]),
  defaults: flat,
  low: extreme(-1000000000),
  high: extreme(1000000000),
  legacy,
  retired: RETIRED_KEYS,
  retiredDropped: (() => {
    const cfg = normalizeConfig({ llm: { api_key: "x" }, reply: {}, reply_guard: {}, ui: {}, seed_targets: true, dsh: { profile: "headless", pre_draft: true } });
    return { top: Object.keys(cfg), dsh: Object.keys(cfg.dsh) };
  })(),
}));
"""


def check(name, cond, detail=""):
    if CHECK is not None:
        CHECK(name, cond, detail)
        return
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  [ok] {name}")
    else:
        _failed += 1
        print(f"  [FAIL] {name}  {detail}")


def _doc_rows(path, after_header, strip_backtick=False):
    """取指定小节标题之后的表格数据行：[[c1, c2, ...], ...]（跳过分隔行）。"""
    text = open(path, encoding="utf-8").read()
    idx = text.index(after_header)
    rows = []
    for line in text[idx:].splitlines():
        s = line.strip()
        if not s.startswith("|"):
            if rows:
                break
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if all(re.fullmatch(r":?-+:?", c) for c in cells):
            continue
        if strip_backtick:
            cells = [c.strip("`") for c in cells]
        if cells[0] in ("方法", "键", "列", "表", "老键"):
            continue    # 表头行
        rows.append(cells)
    return rows


def _probe(tmp):
    env = dict(os.environ, IM_DOC_TMP=tmp)
    r = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_PROBE],
        cwd=PLUG, env=env, capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[-2000:])
    return json.loads(r.stdout)


def test_api_contract(probe):
    print("\n[契约 01] API 路由与 lib/app.js 的 ROUTES / POST_ROUTES / DELETE_ROUTES 对账")
    path = os.path.join(CONTRACTS, "01-api.md")
    get_doc = {r[1] for r in _doc_rows(path, "## 读接口（GET）", strip_backtick=True)}
    post_doc = {r[1] for r in _doc_rows(path, "## 写接口（POST 覆盖）", strip_backtick=True)}
    del_doc = {r[1] for r in _doc_rows(path, "## 删除接口（DELETE）", strip_backtick=True)}
    routes = probe["routes"]
    check("GET 路由：契约与代码集合一致", get_doc == set(routes["get"]),
          f"文档多 {sorted(get_doc - set(routes['get']))[:4]} / 代码多 {sorted(set(routes['get']) - get_doc)[:4]}")
    check("POST 覆盖：契约与代码集合一致", post_doc == set(routes["post"]),
          f"文档 {sorted(post_doc)} / 代码 {sorted(routes['post'])}")
    check("DELETE 路由：契约与代码集合一致", del_doc == set(routes["del"]),
          f"文档 {sorted(del_doc)} / 代码 {sorted(routes['del'])}")
    bad = [r[1] for r in _doc_rows(path, "## 读接口（GET）", strip_backtick=True)
           if r[0] not in ("GET", "POST")]
    check("方法列只有 GET / POST", not bad, str(bad[:3]))


def test_storage_contract(probe):
    print("\n[契约 02] state.json 字段与 lib/state.js 归一化结果对账")
    path = os.path.join(CONTRACTS, "02-storage.md")
    for section, key in (("## 顶层", "stateKeys"),
                         ("## chats 里的会话对象", "chatKeys"),
                         ("## recent 里的一条消息", "msgKeys")):
        cols_doc = [r[0] for r in _doc_rows(path, section)]
        cols_code = probe[key]
        check(f"{section.lstrip('# ')}：字段集合一致", set(cols_doc) == set(cols_code),
              f"文档多 {sorted(set(cols_doc) - set(cols_code))[:4]} / "
              f"代码多 {sorted(set(cols_code) - set(cols_doc))[:4]}")
        check(f"{section.lstrip('# ')}：字段顺序一致（补字段只能往后追加）",
              cols_doc == cols_code,
              f"文档 {cols_doc[:6]}… / 代码 {cols_code[:6]}…")


def test_config_contract(probe):
    print("\n[契约 03] 配置键 / 默认值 / 夹取范围与 lib/state.js 对账")
    path = os.path.join(CONTRACTS, "03-config.md")
    doc = {r[0]: json.loads(r[1].strip().strip("`"))
           for r in _doc_rows(path, "## 键与默认值", strip_backtick=True)}
    code = probe["defaults"]
    check("配置键集合一致", set(doc) == set(code),
          f"文档多 {sorted(set(doc) - set(code))[:4]} / 代码多 {sorted(set(code) - set(doc))[:4]}")
    diff = {k: (doc[k], code[k]) for k in doc if k in code and doc[k] != code[k]}
    check("默认值逐键一致", not diff, str(diff))

    range_rows = {r[0]: (int(r[1]), int(r[2])) for r in _doc_rows(path, "## 取值范围", strip_backtick=True)}
    bad_clamp = []
    for key, (lo, hi) in range_rows.items():
        if probe["low"].get(key) != lo:
            bad_clamp.append(f"{key}: low got={probe['low'].get(key)} want={lo}")
        if probe["high"].get(key) != hi:
            bad_clamp.append(f"{key}: high got={probe['high'].get(key)} want={hi}")
    check(f"夹取范围与文档一致（{len(range_rows)} 个键 × 两端）", not bad_clamp,
          "; ".join(bad_clamp[:3]))

    legacy_rows = {r[0]: r[1] for r in _doc_rows(path, "## 老键迁移", strip_backtick=True)}
    legacy = probe["legacy"]
    leaked = sorted(k for k in legacy_rows if k != "—" and k in legacy)
    check("老键迁完不残留在运行配置里", not leaked, str(leaked))
    check("老键翻译值符合契约",
          legacy.get("poll", {}).get("interval_min") == 10
          and legacy.get("poll", {}).get("dm_recent") == 12
          and legacy.get("poll", {}).get("dm_scope") == "watched"
          and legacy.get("poll", {}).get("per_chat_limit") == 8,
          json.dumps(legacy.get("poll", {}), ensure_ascii=False)[:300])

    dropped = probe["retiredDropped"]
    check("退役键全部从运行配置消失",
          not (set(probe["retired"]) & set(dropped["top"]))
          and "profile" not in dropped["dsh"] and "pre_draft" not in dropped["dsh"],
          f"top={dropped['top']} dsh={dropped['dsh']}")


def test_version_consistency():
    print("\n[版本] package.json 与 CHANGELOG 顶部一致")
    pkg = json.load(open(os.path.join(PLUG, "package.json")))
    changelog = open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8").read()
    m = re.search(r"^###\s+(\d+\.\d+\.\d+)[：:]", changelog, re.M)
    check("CHANGELOG 顶部有版本小节", bool(m), "找不到 `### X.Y.Z：`")
    if m:
        check(f"package.json ({pkg['version']}) == CHANGELOG 顶部 ({m.group(1)})",
              pkg["version"] == m.group(1))


def test_client_freshness():
    print("\n[构建] lib/client.js 是 web/panel.js 的最新产物")
    panel = open(os.path.join(PLUG, "web", "panel.js"), encoding="utf-8").read()
    tpl = open(os.path.join(PLUG, "lib", "client.template.js"), encoding="utf-8").read()
    out = open(os.path.join(PLUG, "lib", "client.js"), encoding="utf-8").read()
    expected = tpl.replace("/*__PANEL_JS__*/", panel)
    check("client.js 与构建输出一致（改了 panel.js 就要跑 build_client.py）",
          out == expected, "产物过期：python3 scripts/build_client.py 后重新提交")


def test_verify_docs():
    print("\n[文档] verify_docs 全量（链接 / 预算 / 反流水账 / 编号）")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "verify_docs.py")],
                       capture_output=True, text=True, timeout=120)
    tail = (r.stdout or r.stderr).strip().splitlines()
    check("verify_docs 退出码 0", r.returncode == 0,
          tail[-1] if tail else "")


def main(check_fn=None):
    global CHECK
    CHECK = check_fn
    tmp = tempfile.mkdtemp(prefix="im_docscan_")
    try:
        probe = _probe(tmp)
        test_api_contract(probe)
        test_storage_contract(probe)
        test_config_contract(probe)
        test_version_consistency()
        test_client_freshness()
        test_verify_docs()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if CHECK is None:
        print(f"\n文档对账：{_passed} 通过 / {_failed} 失败")
        return _failed
    return 0


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
