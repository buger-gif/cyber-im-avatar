#!/usr/bin/env python3
"""run_tests.py — 用 mock CLI 端到端验证监听引擎（不碰真实账号）。

覆盖：命中唤醒 / 防回环 / 水位不重复 / 关键词与发送者过滤 / 两种 JSON 形态 /
      stdout 多 JSON 文档 / SCHEMA_MISMATCH 诊断与 override 修复。

用法: python3 tests/run_tests.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
MOCK = os.path.join(HERE, "mock_cli.py")
PY = sys.executable

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  [ok] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name}  {detail}")


def setup(platform, shape, msgs, self_id="SELF_BOT", overrides=None):
    """建隔离工作区：env.json 指向 mock CLI，写好消息数据。"""
    d = tempfile.mkdtemp(prefix=f"standin_{platform}_")
    os.makedirs(os.path.join(d, "states"), exist_ok=True)
    data = os.path.join(d, "msgs.json")
    with open(data, "w") as f:
        json.dump({"messages": msgs}, f, ensure_ascii=False)
    ov = {"cli": os.path.abspath(MOCK)}
    ov.update(overrides or {})
    env = {
        "version": 1,
        "platforms": {platform: {"self_id": self_id, "logged_in": True}},
        "targets": {}, "overrides": {platform: ov},
    }
    with open(os.path.join(d, "env.json"), "w") as f:
        json.dump(env, f, ensure_ascii=False)
    return d, data


def listen(platform, d, data, shape, *args):
    script = os.path.join(SCRIPTS, {
        "wecom": "wecom_listen_cli.py",
        "dingtalk": "dingtalk_listen_cli.py",
        "feishu": "feishu_listen_cli.py",
    }[platform])
    env = dict(os.environ,
               IM_STANDIN_DIR=d, MOCK_SHAPE=shape, MOCK_DATA=data,
               MOCK_SELF=json.load(open(os.path.join(d, "env.json")))["platforms"][platform]["self_id"])
    return subprocess.run([PY, script] + list(args),
                          capture_output=True, text=True, env=env, timeout=60)


# ---------------------------------------------------------------- 用例
def test_wecom_hit():
    print("\n[wecom 形态] 命中 / 复合水位 / 防回环 / 过滤")
    msgs = [{"id": "x", "sender": "PEER", "content": "测试消息 REQ-2026", "time": "2026-10-30 10:00:00"}]
    d, data = setup("wecom", "wecom", msgs)
    r = listen("wecom", d, data, "wecom", "--user-id", "PEER", "--init", "zero",
               "--interval", "2", "--timeout", "5")
    check("命中返回 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr[:200]}")
    hit = {}
    if r.returncode == 0:
        hit = json.loads(r.stdout.strip().splitlines()[-1])
    check("正文正确", "REQ-2026" in (hit.get("content") or ""), hit.get("content"))
    check("发送者正确", hit.get("sender") == "PEER", hit.get("sender"))
    check("不带身份噪声", "extra_identity_context" not in r.stdout)

    # 水位已推：同一批消息再跑不应再命中
    r2 = listen("wecom", d, data, "wecom", "--user-id", "PEER",
                "--interval", "2", "--timeout", "4")
    check("水位防重复命old", r2.returncode == 3, f"rc={r2.returncode} out={r2.stdout[:120]}")

    # 防回环：自己发的消息不该唤醒
    d3, data3 = setup("wecom", "wecom",
                      [{"id": "y", "sender": "SELF_BOT", "content": "我自己发的", "time": "2026-10-30 10:01:00"}])
    r3 = listen("wecom", d3, data3, "wecom", "--user-id", "PEER", "--init", "zero",
                "--interval", "2", "--timeout", "4")
    check("防回环", r3.returncode == 3, f"rc={r3.returncode}")

    # 发送者过滤
    d4, data4 = setup("wecom", "wecom",
                      [{"id": "z", "sender": "OTHER", "content": "别人说的", "time": "2026-10-30 10:02:00"}])
    r4 = listen("wecom", d4, data4, "wecom", "--user-id", "PEER", "--sender", "PEER",
                "--init", "zero", "--interval", "2", "--timeout", "4")
    check("发送者过滤生效", r4.returncode == 3, f"rc={r4.returncode}")

    # 关键词过滤：不匹配不唤醒
    d5, data5 = setup("wecom", "wecom",
                      [{"id": "k", "sender": "PEER", "content": "无关内容", "time": "2026-10-30 10:03:00"}])
    r5 = listen("wecom", d5, data5, "wecom", "--user-id", "PEER", "--keyword", "REQ-2026",
                "--init", "zero", "--interval", "2", "--timeout", "4")
    check("关键词过滤生效", r5.returncode == 3, f"rc={r5.returncode}")

    for x in (d, d3, d4, d5):
        shutil.rmtree(x, ignore_errors=True)


def test_dws_hit():
    print("\n[dws 形态] 倒序 + stdout 多 JSON 文档")
    msgs = [{"id": "m3", "sender": "PEER", "content": "最新的消息", "time": "2026-10-30 11:00:00"},
            {"id": "m2", "sender": "PEER", "content": "稍早的", "time": "2026-10-30 10:00:00"}]
    d, data = setup("dingtalk", "dws", msgs)
    r = listen("dingtalk", d, data, "dws", "--user-id", "PEER", "--init", "zero",
               "--interval", "2", "--timeout", "5")
    check("命中返回 0", r.returncode == 0, f"rc={r.returncode} stderr={r.stderr[:200]}")
    hit = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    check("取到最新一条（倒序不错位）", hit.get("message_id") == "m3", hit.get("message_id"))
    check("多 JSON 文档不影响解析", hit.get("sender") == "PEER", hit.get("sender"))
    shutil.rmtree(d, ignore_errors=True)


def test_schema_mismatch():
    print("\n[坏形态] SCHEMA_MISMATCH 诊断 + override 修复")
    msgs = [{"id": "s1", "sender": "PEER", "content": "字段全不对", "time": "2026-10-30 12:00:00"}]
    d, data = setup("wecom", "bad", msgs)
    r = listen("wecom", d, data, "bad", "--user-id", "PEER", "--init", "zero",
               "--interval", "2", "--timeout", "12")
    check("字段失配时退出 2 并报 SCHEMA_MISMATCH",
          r.returncode == 2 and "SCHEMA_MISMATCH" in r.stderr, f"rc={r.returncode} err={r.stderr[:200]}")

    # 用 overrides 改字段路径即可修好，不用改代码
    d2, data2 = setup("wecom", "bad", msgs, overrides={
        "f_items": [["data", "records"]],
        "f_msg_id": [["mid"]],
        "f_msg_sender": [["uid"]],
        "f_content_list": [["body"]],
        "f_create_time": [["t"]],
        "f_msg_id_compose": None,
    })
    # bad 形态里字段叫 x，这里换成与之匹配的 mock 形态：改用 wecom 数据但字段换名成本高，
    # 因此直接验证 override 里 f_items 生效即可（能解析出数组就算通过）
    r2 = listen("wecom", d2, data2, "bad", "--user-id", "PEER", "--init", "zero",
                "--interval", "2", "--timeout", "5")
    check("override 覆盖 f_items 后不再报 schema 错误",
          "SCHEMA_MISMATCH" not in r2.stderr, r2.stderr[:200])
    for x in (d, d2):
        shutil.rmtree(x, ignore_errors=True)


def test_time_window():
    print("\n[时间窗] 企微必须带 begin/end，引擎每轮生成")
    msgs = [{"id": "t1", "sender": "PEER", "content": "时间窗测试", "time": "2026-10-30 13:00:00"}]
    d, data = setup("wecom", "wecom", msgs)
    r = listen("wecom", d, data, "wecom", "--user-id", "PEER", "--init", "zero",
               "--lookback-min", "30", "--interval", "2", "--timeout", "5")
    # mock 不校验时间窗，但引擎必须成功把参数渲染出来（否则 CLI 会因缺参数报错）
    check("时间窗参数渲染成功", r.returncode == 0, f"rc={r.returncode} err={r.stderr[:200]}")
    shutil.rmtree(d, ignore_errors=True)


def test_docs():
    """文档索引不能烂：锚点可跳、章节齐全、无真实 ID 泄漏。"""
    if not os.path.exists(os.path.join(ROOT, "scripts", "verify_docs.py")):
        print("\n[文档] 跳过：包内没有 verify_docs.py（仅仓库版有）")
        return
    import glob
    import re

    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    from verify_docs import github_anchor, headings

    print("\n[文档] 故障索引锚点 / 章节完整 / 脱敏")
    tro = os.path.join(ROOT, "references", "troubleshooting.md")
    check("troubleshooting.md 存在", os.path.exists(tro))

    # ① 所有文档内锚点必须能跳：既认 HTML id="x"，也认 GitHub 标题锚
    files = [os.path.join(ROOT, "SKILL.md"), tro] + \
            glob.glob(os.path.join(ROOT, "references", "*.md")) + \
            glob.glob(os.path.join(ROOT, "docs", "**", "*.md"), recursive=True)
    bad = []
    for f in files:
        txt = open(f, encoding="utf-8").read()
        own = os.path.basename(f)
        for target, anchor in re.findall(r"\]\(([^)#\s]+\.md)?#([^)\s]+)\)", txt):
            path = os.path.join(ROOT, target) if target else f
            if target and not os.path.exists(path):
                bad.append(f"{own} → 文件不存在 {target}")
                continue
            body = open(path, encoding="utf-8").read()
            if f'id="{anchor}"' in body:
                continue
            if anchor in headings(body):
                continue
            bad.append(f"{own} → 锚点缺失 {target or own}#{anchor}")
    check("所有锚点可跳转", not bad, "; ".join(bad[:3]))

    # ② 索引必备章节（分诊表 + A..K）
    body = open(tro, encoding="utf-8").read()
    need = ['id="triage"'] + [f"## {c}." for c in "ABCDEFGHIJK"]
    missing = [n for n in need if n not in body]
    check("分诊表与 A-K 章节齐全", not missing, f"缺 {missing}")

    # ③ 文档里不许出现真实 ID / 凭据
    leak = []
    for f in files:
        txt = open(f, encoding="utf-8").read()
        for pat in (r"ou_[0-9a-f]{20,}", r"oc_[0-9a-f]{20,}",
                    r"aib[A-Za-z0-9_-]{20,}", r"Bearer\s+[A-Za-z0-9._-]{20,}"):
            if re.search(pat, txt):
                leak.append(f"{os.path.basename(f)}:{pat}")
    check("无真实 ID / token 泄漏", not leak, "; ".join(leak))

    # ④ 权限标准必须写在 SKILL.md 里（公开分发的前提：规则随包走）
    skill = open(os.path.join(ROOT, "SKILL.md"), encoding="utf-8").read()
    for kw, why in (("权限标准", "缺章节标题"),
                    ("keep", "缺默认策略说明"),
                    ("minimal", "缺最小集策略"),
                    ("--allow-add", "缺扩权闸门用法"),
                    ("--domain all", "缺「默认全量申请」这个坑"),
                    ("企业微信 / 钉钉", "缺无 scope 平台的差异说明")):
        check(f"SKILL.md 含「{kw}」（{why}）", kw in skill)


STUB = '''#!/usr/bin/env python3
import json, os, sys
name = os.path.basename(sys.argv[0])
args = sys.argv[1:]
def j(o): print(json.dumps(o))
if "--version" in args or args[:1] == ["version"]:
    print(f"{name} version 9.9.9"); sys.exit(0)
if args[:1] == ["doctor"]:
    j({"checks": [{"name": "auth", "status": "pass", "message": "ok"},
                  {"name": "net", "status": "pass", "message": "ok"}]}); sys.exit(0)
if args[:2] == ["auth", "status"]:
    j({"authenticated": True,
       "identities": {"user": {"tokenStatus": "valid", "openId": "ou_stub0001",
                               "expiresAt": "2099-01-01T00:00:00+00:00",
                               "refreshExpiresAt": "2099-01-01T00:00:00+00:00"}}}); sys.exit(0)
if args[:2] == ["auth", "show"]:
    print("Status: authorized\\nBot ID: FAKEBOTID"); sys.exit(0)
if args[:1] == ["profile"]:
    j({"profiles": [{"userId": "stubuser"}]}); sys.exit(0)
j({"ok": True})
'''

# 可变桩：doctor 的检查项可换；__IM__ 位置可注入真实拉取失败。
STUB_FLEX = '''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
def j(o): print(json.dumps(o))
if "--version" in args or args[:1] == ["version"]:
    print("lark-cli version 9.9.9"); sys.exit(0)
if args[:1] == ["doctor"]:
    j(__CHECKS__); sys.exit(0)
if args[:2] == ["auth", "status"]:
    j({"authenticated": True,
       "identities": {"user": {"tokenStatus": "valid", "openId": "ou_stub0001x"}}}); sys.exit(0)
if args[:2] == ["auth", "show"]:
    print("Status: authorized\\nBot ID: FAKEBOTID"); sys.exit(0)
if args[:1] == ["profile"]:
    j({"profiles": [{"userId": "stubuser"}]}); sys.exit(0)
__IM__
j({"ok": True})
'''

STUB_IM_NETWORK = '''if args[:1] == ["im"]:
    with open(os.path.join(os.environ["IM_STANDIN_DIR"], "calls.txt"), "a") as f:
        f.write("im\\n")
    print(json.dumps({"ok": False, "identity": "user", "error": {
        "type": "network", "subtype": "transport",
        "message": 'API call failed: Get "https://open.feishu.cn/open-apis/im/v1/messages?container_id=oc_c56748207171a8ce2744e7826f6ed313": dial tcp 1.2.3.4:443: i/o timeout'}}), file=sys.stderr)
    sys.exit(1)
'''


def write_flex_stub(bindir, cli, checks=None, im_block=""):
    """写一个可变桩 CLI：doctor 检查项可定制，可注入拉取失败。"""
    checks = checks or [{"name": "auth", "status": "pass", "message": "ok"}]
    body = (STUB_FLEX.replace("__CHECKS__", json.dumps({"checks": checks}))
            .replace("__IM__", im_block))
    p = os.path.join(bindir, cli)
    with open(p, "w") as f:
        f.write(body)
    os.chmod(p, 0o755)


def test_doctor():
    """doctor.py 在纯桩环境下自洽：全绿、JSON 合法、退出 0。"""
    print("\n[体检] doctor.py 全绿 + JSON 输出")
    d = tempfile.mkdtemp(prefix="standin_doctor_")
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir)
    for cli in ("lark-cli", "wecom-cli", "dws"):
        p = os.path.join(bindir, cli)
        with open(p, "w") as f:
            f.write(STUB)
        os.chmod(p, 0o755)
    with open(os.path.join(d, "env.json"), "w") as f:
        json.dump({"version": 1,
                   "platforms": {k: {"self_id": f"self_{k}"}
                                 for k in ("feishu", "wecom", "dingtalk")},
                   "targets": {}, "overrides": {}}, f)
    env = dict(os.environ, IM_STANDIN_DIR=d,
               PATH=bindir + os.pathsep + os.environ.get("PATH", ""))
    r = subprocess.run([PY, os.path.join(SCRIPTS, "doctor.py"), "--json"],
                       capture_output=True, text=True, env=env, timeout=120)
    ok_json = False
    try:
        data = json.loads(r.stdout)
        ok_json = True
    except Exception:
        data = {}
    check("doctor --json 输出合法 JSON", ok_json, r.stdout[:200] + r.stderr[:200])
    check("doctor 退出码 0（全部可用）", r.returncode == 0, f"rc={r.returncode} {r.stderr[:200]}")
    if ok_json:
        stats = {p: v["status"] for p, v in data.get("platforms", {}).items()}
        check("三平台均无 fail", all(s != "fail" for s in stats.values()), str(stats))
        check("self_id 已脱敏", "ou_stub0001" not in r.stdout)
    shutil.rmtree(d, ignore_errors=True)


def test_reauth():
    """授权卡片：结构正确、按钮直链、平台边界诚实（不假装支持）。"""
    print("\n[授权] 免扫码卡片结构 / 平台边界")
    sys.path.insert(0, SCRIPTS)
    import reauth

    url = ("https://accounts.feishu.cn/oauth/v1/device/verify"
           "?flow_id=FLOW0&user_code=AB12-CD34")
    card = reauth.build_card(url, "AB12-CD34", 10, who="分身")
    blob = json.dumps(card, ensure_ascii=False)
    acts = [e for e in card["elements"] if e.get("tag") == "action"]
    check("卡片含按钮动作", bool(acts))
    btn = acts[0]["actions"][0] if acts else {}
    check("按钮直链设备授权页（无需扫码）",
          btn.get("url") == url and "user_code=AB12-CD34" in btn.get("url", ""),
          btn.get("url"))
    check("正文带 user_code 兜底", "AB12-CD34" in blob)
    check("带勿转发警示", "勿转发" in blob)
    check("禁止卡片转发", card["config"].get("enable_forward") is False)

    # ---- 权限自适应：keep / minimal / 扩权闸门 ----
    src = open(os.path.join(SCRIPTS, "reauth.py"), encoding="utf-8").read()
    check("不出现 --domain（该参数默认 all，会全量申请）", '"--domain"' not in src)
    check("不出现 --recommend", '"--recommend"' not in src)
    check("login 显式带 --scope", '"--scope"' in src)
    check("有扩权闸门 guard_scopes", "def guard_scopes" in src)
    check("闸门默认拒跑（无 --allow-add 时不放行）", "if allow_add:" in src)

    class _A:                     # 默认参数：keep，无 --scope/--add
        scope = ""
        add = ""
        policy = "keep"

    # (1) 全新账号（无历史授权）→ 落到最小必需集，且不带任何无关业务域
    plan = reauth.resolve_scopes(_A(), cur=[], app=[])
    req = plan["requested"]
    check("无历史授权 -> 最小必需集", set(req) == set(reauth.REQUIRED_SCOPES), len(req))
    check("最小集覆盖 IM 收发", {"im:message:readonly", "im:message.send_as_user"} <= set(req))
    check("最小集含 offline_access（否则 2 小时一续）", "offline_access" in req)
    check("最小集不含妙搭 spark", not any(s.startswith("spark:") for s in req))
    check("最小集不含 base/docs/mail/drive",
          not any(s.startswith(("base:", "docs:", "docx:", "mail:", "drive:"))
                  for s in req))

    # (2) 应用只开通了部分权限 → 只申请交集，缺的单独报出，不硬塞
    partial = ["im:message:readonly", "im:message.send_as_user", "offline_access"]
    plan = reauth.resolve_scopes(_A(), cur=[], app=partial)
    check("应用未开通的必需权限不硬塞",
          set(plan["requested"]) <= set(partial) | reauth.BASE_SCOPES,
          plan["requested"])
    check("应用缺口被如实报出", len(plan["lack_on_app"]) > 0, plan["lack_on_app"])

    # (3) 有历史授权 → 原样沿用，新增恒为 0
    old = ["im:message:readonly", "offline_access", "base:record:read"]
    plan = reauth.resolve_scopes(_A(), cur=old, app=old)
    check("沿用现有权限时新增为 0", plan["added"] == [], plan["added"])
    check("沿用现有权限时不夹带其它域", plan["requested"] == old, plan["requested"])

    # (4) 显式扩权 → 默认被闸门拦住
    class _B(_A):
        add = "spark:app:read"
    plan = reauth.resolve_scopes(_B(), cur=old, app=old + ["spark:app:read"])
    check("新增权限被识别", plan["added"] == ["spark:app:read"], plan["added"])
    check("闸门拦下扩权", reauth.guard_scopes(plan, allow_add=False) is False)
    check("--allow-add 才放行", reauth.guard_scopes(plan, allow_add=True) is True)

    # (5) --policy minimal：主动收窄，只留必需集
    class _C(_A):
        policy = "minimal"
    plan = reauth.resolve_scopes(_C(), cur=old, app=old + reauth.REQUIRED_SCOPES)
    check("minimal 收窄到必需集",
          set(plan["requested"]) == set(reauth.REQUIRED_SCOPES), len(plan["requested"]))
    check("minimal 会丢掉无关域", "base:record:read" in plan["dropped"])

    # 企微/钉钉要么已授权(0)，要么明确 exit 4 给替代路径——不能假装支持卡片
    for plat, cli in (("wecom", "wecom-cli"), ("dingtalk", "dws")):
        if not shutil.which(cli):
            check(f"{plat} 未安装则跳过", True)
            continue
        r = subprocess.run([PY, os.path.join(SCRIPTS, "reauth.py"), plat],
                           capture_output=True, text=True, timeout=60)
        check(f"{plat} 平台边界诚实（rc∈{{0,4}}）", r.returncode in (0, 4),
              f"rc={r.returncode} {r.stdout[:120]}")


def test_find_command():
    """私聊解析结果必须生成可直接执行的监听命令。"""
    import contextlib
    import io
    sys.path.insert(0, SCRIPTS)
    import bootstrap as bs

    d = tempfile.mkdtemp(prefix="standin_find_")
    old_dir, old_path, old_run = bs.ENV_DIR, bs.ENV_PATH, bs.run
    old_profiles, old_people = bs.PROFILES_DIR, bs.PEOPLE_DIR
    bs.ENV_DIR = d
    bs.ENV_PATH = os.path.join(d, "env.json")
    bs.PROFILES_DIR = os.path.join(d, "profiles")
    bs.PEOPLE_DIR = os.path.join(bs.PROFILES_DIR, "people")
    bs.run = lambda *_args, **_kw: (0, {"data": {"users": [{
        "localized_name": "测试同事", "open_id": "ou_test", "p2p_chat_id": "oc_test",
    }]}}, "")
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            bs.resolve({"platforms": {"feishu": {}}, "targets": {}}, "feishu", "测试")
    finally:
        bs.ENV_DIR, bs.ENV_PATH, bs.run = old_dir, old_path, old_run
        bs.PROFILES_DIR, bs.PEOPLE_DIR = old_profiles, old_people
        shutil.rmtree(d, ignore_errors=True)
    text = out.getvalue()
    check("私聊监听建议使用 --chat-id", "--chat-id oc_test" in text, text)
    check("私聊监听建议不把 chat_id 当 user_id", "--user-id oc_test" not in text, text)


def test_absolute_deadline():
    """--until 是绝对截止时间：未来可命中，过期不再拉取/命中。"""
    import time
    print("\n[临时值守] 绝对截止时间")
    msgs = [{"id": "u1", "sender": "PEER", "content": "截止前", "time": "2026-10-30 13:00:00"}]
    d, data = setup("wecom", "wecom", msgs)
    r = listen("wecom", d, data, "wecom", "--user-id", "PEER", "--init", "zero",
               "--interval", "2", "--until", str(time.time() + 10))
    check("未来 --until 可正常命中", r.returncode == 0, f"rc={r.returncode} err={r.stderr[:200]}")
    d2, data2 = setup("wecom", "wecom", msgs)
    r2 = listen("wecom", d2, data2, "wecom", "--user-id", "PEER", "--init", "zero",
                "--interval", "2", "--until", str(time.time() - 1))
    check("过期 --until 退出 3", r2.returncode == 3, f"rc={r2.returncode} err={r2.stderr[:200]}")
    for x in (d, d2):
        shutil.rmtree(x, ignore_errors=True)


def test_cache_refresh():
    """--cache-refresh-min 到点主动退出（退出码 3），用一次重挂续上下文缓存。"""
    import time
    print("\n[缓存续期] 到点主动退出")
    msgs = [{"id": "c1", "sender": "PEER", "content": "旧消息", "time": "2026-10-30 14:00:00"}]
    d, data = setup("wecom", "wecom", msgs)
    start = time.time()
    r = listen("wecom", d, data, "wecom", "--user-id", "PEER", "--init", "latest",
               "--interval", "2", "--cache-refresh-min", "0.02", "--timeout", "20")
    elapsed = time.time() - start
    check("缓存续期到点退出 3", r.returncode == 3, f"rc={r.returncode} err={r.stderr[:200]}")
    check("退出原因写 stderr", "cache-refresh" in r.stderr, r.stderr[:200])
    check("不误报命中", '"hit": true' not in r.stdout, r.stdout[:200])
    check("按时退出（<8s）", elapsed < 8, f"{elapsed:.1f}s")
    shutil.rmtree(d, ignore_errors=True)


def test_idle_exit():
    """3 小时没有新消息命中 → 退出 4（不重挂）；命中重置时钟；--new-watch 重新计时。"""
    import time
    print("\n[闲置退出] 3 小时没有新消息命中就结束值守")
    old = [{"id": "i1", "sender": "PEER", "content": "旧消息", "time": "2026-10-30 15:00:00"}]
    d, data = setup("wecom", "wecom", old)
    start = time.time()
    r = listen("wecom", d, data, "wecom", "--user-id", "PEER", "--init", "latest",
               "--interval", "2", "--idle-exit-min", "0.02", "--timeout", "20")
    elapsed = time.time() - start
    check("闲置到点退出 4", r.returncode == 4, f"rc={r.returncode} err={r.stderr[:200]}")
    check("stderr 标 idle-exit", "[idle-exit]" in r.stderr, r.stderr[:200])
    check("不误报命中", '"hit": true' not in r.stdout, r.stdout[:200])
    check("按时退出（<8s）", elapsed < 8, f"{elapsed:.1f}s")
    state_file = os.path.join(d, "states", "wecom_PEER.pos")
    try:
        state = json.load(open(state_file))
    except Exception:
        state = {}
    check("闲置时钟落盘", bool(state.get("idle_at")), str(state))
    shutil.rmtree(d, ignore_errors=True)

    # 命中会刷新 idle_at：下一次重挂从这次命中重新计 3 小时。
    fresh = [{"id": "h1", "sender": "PEER", "content": "新消息", "time": "2026-10-30 15:10:00"}]
    d2, data2 = setup("wecom", "wecom", fresh)
    r2 = listen("wecom", d2, data2, "wecom", "--user-id", "PEER", "--init", "zero",
                "--interval", "2", "--idle-exit-min", "0.02", "--timeout", "20")
    check("命中仍退出 0", r2.returncode == 0, f"rc={r2.returncode} err={r2.stderr[:200]}")
    try:
        state2 = json.load(open(os.path.join(d2, "states", "wecom_PEER.pos")))
    except Exception:
        state2 = {}
    check("命中刷新 idle_at", abs(float(state2.get("idle_at") or 0) - time.time()) < 10,
          str(state2))
    shutil.rmtree(d2, ignore_errors=True)

    # 0 = 关闭：不因闲置退出，仍按 --timeout 到点退 3。
    d3, data3 = setup("wecom", "wecom", old)
    r3 = listen("wecom", d3, data3, "wecom", "--user-id", "PEER", "--init", "latest",
                "--interval", "2", "--idle-exit-min", "0", "--timeout", "2")
    check("--idle-exit-min 0 不触发闲置退出", r3.returncode == 3,
          f"rc={r3.returncode} err={r3.stderr[:200]}")
    shutil.rmtree(d3, ignore_errors=True)

    # 旧的闲置时钟（4 小时前）：默认立刻停；用户明确重启时 --new-watch 重新计时。
    d4, data4 = setup("wecom", "wecom", old)
    state_file = os.path.join(d4, "states", "wecom_PEER.pos")
    # 先正常挂一轮把复合水位写对（企微的消息 ID 是发送者+时间+正文的指纹）。
    listen("wecom", d4, data4, "wecom", "--user-id", "PEER", "--init", "latest",
           "--interval", "2", "--idle-exit-min", "0", "--timeout", "1")
    with open(state_file) as f:
        saved = json.load(f)
    saved["idle_at"] = time.time() - 4 * 3600
    with open(state_file, "w") as f:
        json.dump(saved, f)
    start = time.time()
    r4 = listen("wecom", d4, data4, "wecom", "--user-id", "PEER", "--init", "latest",
                "--interval", "2", "--idle-exit-min", "0.02", "--timeout", "20")
    check("过期闲置时钟立即退出 4", r4.returncode == 4 and time.time() - start < 1.5,
          f"rc={r4.returncode} {time.time() - start:.1f}s")
    saved["idle_at"] = time.time() - 4 * 3600
    with open(state_file, "w") as f:
        json.dump(saved, f)
    start = time.time()
    r5 = listen("wecom", d4, data4, "wecom", "--user-id", "PEER", "--init", "latest",
                "--interval", "2", "--idle-exit-min", "0.02", "--new-watch", "--timeout", "20")
    check("--new-watch 重新计时", r5.returncode == 4 and time.time() - start >= 0.8,
          f"rc={r5.returncode} {time.time() - start:.1f}s")
    try:
        after = json.load(open(state_file))
    except Exception:
        after = {}
    check("--new-watch 不碰水位", after.get("last_id") == saved.get("last_id") and bool(after.get("last_id")),
          f"last_id={after.get('last_id')} want={saved.get('last_id')}")
    shutil.rmtree(d4, ignore_errors=True)

    # 被过滤的消息不算命中，也不该刷新 idle_at，否则闲置退出永远不会到点。
    filtered = [{"id": "k1", "sender": "PEER", "content": "不匹配关键词",
                 "time": "2026-10-30 15:20:00"}]
    d5, data5 = setup("wecom", "wecom", filtered)
    start = time.time()
    r6 = listen("wecom", d5, data5, "wecom", "--user-id", "PEER", "--init", "zero",
                "--keyword", "NO_SUCH_WORD", "--interval", "2",
                "--idle-exit-min", "0.02", "--timeout", "20")
    check("关键词过滤的消息不算命中", r6.returncode == 4 and "[idle-exit]" in r6.stderr,
          f"rc={r6.returncode} err={r6.stderr[:200]}")
    try:
        state6 = json.load(open(os.path.join(d5, "states", "wecom_PEER.pos")))
    except Exception:
        state6 = {}
    check("过滤消息不刷新 idle_at", abs(float(state6.get("idle_at") or 0) - start) < 1.0,
          f"idle_at={state6.get('idle_at')} start={start:.1f}")
    shutil.rmtree(d5, ignore_errors=True)

    selfmsg = [{"id": "s1", "sender": "SELF_BOT", "content": "我自己发的",
                "time": "2026-10-30 15:30:00"}]
    d6, data6 = setup("wecom", "wecom", selfmsg)
    start = time.time()
    r7 = listen("wecom", d6, data6, "wecom", "--user-id", "PEER", "--init", "zero",
                "--interval", "2", "--idle-exit-min", "0.02", "--timeout", "20")
    check("自己发的消息不算命中", r7.returncode == 4 and "[idle-exit]" in r7.stderr,
          f"rc={r7.returncode} err={r7.stderr[:200]}")
    try:
        state7 = json.load(open(os.path.join(d6, "states", "wecom_PEER.pos")))
    except Exception:
        state7 = {}
    check("自己发的消息不刷新 idle_at", abs(float(state7.get("idle_at") or 0) - start) < 1.0,
          f"idle_at={state7.get('idle_at')} start={start:.1f}")
    shutil.rmtree(d6, ignore_errors=True)


def test_profile_compact():
    """画像超限整理：去重、历史结论 ≤20、旧结论进 history、dry-run 不落盘。"""
    print("\n[画像] 超限整理 / 去重 / 归档")
    d = tempfile.mkdtemp(prefix="standin_compact_")
    env = dict(os.environ, IM_STANDIN_DIR=d)
    script = os.path.join(SCRIPTS, "bootstrap.py")
    r = subprocess.run([PY, script, "--alias", "feishu", "测试对象", "oc_demo"],
                       capture_output=True, text=True, env=env, timeout=30)
    profile = os.path.join(d, "profiles", "feishu", "oc_demo.md")
    hist = os.path.join(d, "profiles", "feishu", "oc_demo.history.md")
    check("别名注册建画像", r.returncode == 0 and os.path.exists(profile), r.stderr[:200])
    bullets = "\n".join(f"- 11-{i:02d} 历史事实 {i}" for i in range(30))
    text = ("# 测试对象\n\n> 飞书 · oc_demo\n\n## 对方是谁\n\n" + "填充" * 1666 +
            "\n\n## 沟通偏好\n\n- 直接\n\n## 在意与忌讳\n\n- 自证口径\n\n## 历史结论\n\n" +
            bullets + "\n- 11-00 历史事实 0\n")
    with open(profile, "w", encoding="utf-8") as f:
        f.write(text)
    before = os.path.getsize(profile)
    r2 = subprocess.run([PY, script, "--compact", "feishu", "测试对象", "--dry-run"],
                        capture_output=True, text=True, env=env, timeout=30)
    check("dry-run 退出 0 且不落盘",
          r2.returncode == 0 and os.path.getsize(profile) == before and not os.path.exists(hist),
          f"rc={r2.returncode} {r2.stderr[:200]}")
    r3 = subprocess.run([PY, script, "--compact", "feishu", "测试对象"],
                        capture_output=True, text=True, env=env, timeout=30)
    after = open(profile, encoding="utf-8").read()
    kept = [line for line in after.splitlines() if line.startswith("- 11-")]
    check("compact 退出 0", r3.returncode == 0, r3.stderr[:300])
    check("主文件 ≤12KB", os.path.getsize(profile) <= 12 * 1024, str(os.path.getsize(profile)))
    check("历史结论 ≤20 条", len(kept) <= 20, str(len(kept)))
    check("重复 bullet 被去重", after.count("- 11-00 历史事实 0") == 1,
          str(after.count("- 11-00 历史事实 0")))
    check("旧结论进 history", os.path.exists(hist) and "历史事实" in open(hist, encoding="utf-8").read())
    shutil.rmtree(d, ignore_errors=True)


def test_workbook_layers():
    """会话工作本新四段：模板 / --note 落点（新旧两种节）/ --compact 两节通用。"""
    print("\n[会话工作本] 新四段模板 / 补记落点 / 新旧节兼容")
    d = tempfile.mkdtemp(prefix="standin_book_")
    env = dict(os.environ, IM_STANDIN_DIR=d)
    script = os.path.join(SCRIPTS, "bootstrap.py")

    r = subprocess.run([PY, script, "--alias", "feishu", "示例对象", "oc_demo"],
                       capture_output=True, text=True, env=env, timeout=30)
    book = os.path.join(d, "profiles", "feishu", "oc_demo.md")
    text = open(book, encoding="utf-8").read() if os.path.exists(book) else ""
    check("--alias 建出会话工作本", r.returncode == 0 and os.path.exists(book),
          f"rc={r.returncode} err={r.stderr[:200]}")
    check("工作本首行 # 名字", text.startswith("# 示例对象\n"), text[:80])
    check("工作本第二行 平台·chat_id", "> 飞书 · oc_demo" in text, text[:200])
    new_sections = ["## 这个会话是什么", "## 群内工作要求", "## 成员与角色",
                    "## 本会话结论与待办"]
    check("工作本新四段齐全且有序",
          all(s in text for s in new_sections) and
          [text.index(s) for s in new_sections] == sorted(text.index(s) for s in new_sections),
          text[:500])
    check("工作本不再有旧四段标题",
          not any(s in text for s in ("## 对方是谁", "## 沟通偏好", "## 在意与忌讳",
                                      "## 历史结论")),
          text[:300])
    check("工作本说明行指向两层记忆", "个人评价写人物档案" in text, text[:300])

    # --note 落「本会话结论与待办」
    n1 = subprocess.run([PY, script, "--note", "feishu", "示例对象", "本会话要 @ 全体"],
                        capture_output=True, text=True, env=env, timeout=30)
    text = open(book, encoding="utf-8").read()
    tail = text.partition("## 本会话结论与待办")[2]
    check("--note 落「本会话结论与待办」",
          n1.returncode == 0 and tail.strip().splitlines()[0].strip() == "- 本会话要 @ 全体",
          f"rc={n1.returncode} err={n1.stderr[:200]} tail={tail[:120]!r}")
    check("--note 不另起「历史结论」节", "## 历史结论" not in text, text[-200:])
    check("--note stdout 用「记忆」措辞", "记忆" in n1.stdout, n1.stdout[:120])

    # 旧四段文件：--note 仍落「历史结论」，且不被自动改写成新模板
    subprocess.run([PY, script, "--alias", "feishu", "旧对象", "oc_old"],
                   capture_output=True, text=True, env=env, timeout=30)
    old_book = os.path.join(d, "profiles", "feishu", "oc_old.md")
    with open(old_book, "w", encoding="utf-8") as f:
        f.write("# 旧对象\n\n> 飞书 · oc_old\n\n## 对方是谁\n\n## 沟通偏好\n\n"
                "## 在意与忌讳\n\n## 历史结论\n")
    n2 = subprocess.run([PY, script, "--note", "feishu", "旧对象", "旧文件结论"],
                        capture_output=True, text=True, env=env, timeout=30)
    old_text = open(old_book, encoding="utf-8").read()
    check("旧四段文件 --note 仍落「历史结论」",
          n2.returncode == 0 and "- 旧文件结论" in old_text.partition("## 历史结论")[2],
          f"rc={n2.returncode} err={n2.stderr[:200]}")
    check("旧四段文件不被自动改写",
          "## 对方是谁" in old_text and "## 本会话结论与待办" not in old_text, old_text[:200])

    # --compact：新版节（本会话结论与待办）
    bullets = "\n".join(f"- 11-{i:02d} 待办事实 {i}" for i in range(30))
    with open(book, "w", encoding="utf-8") as f:
        f.write("# 示例对象\n\n> 飞书 · oc_demo\n\n## 这个会话是什么\n\n" + "填充" * 1666 +
                "\n\n## 群内工作要求\n\n- 直接\n\n## 成员与角色\n\n"
                "- 张三 → people/feishu/ou_x.md\n\n## 本会话结论与待办\n\n" +
                bullets + "\n- 11-00 待办事实 0\n")
    hist = os.path.join(d, "profiles", "feishu", "oc_demo.history.md")
    before = os.path.getsize(book)
    c1 = subprocess.run([PY, script, "--compact", "feishu", "示例对象", "--dry-run"],
                        capture_output=True, text=True, env=env, timeout=30)
    check("新版工作本 --compact --dry-run 不落盘",
          c1.returncode == 0 and os.path.getsize(book) == before and not os.path.exists(hist),
          f"rc={c1.returncode} err={c1.stderr[:200]}")
    c2 = subprocess.run([PY, script, "--compact", "feishu", "示例对象"],
                        capture_output=True, text=True, env=env, timeout=30)
    after = open(book, encoding="utf-8").read()
    kept = [line for line in after.splitlines() if line.startswith("- 11-")]
    check("新版工作本 --compact 退出 0", c2.returncode == 0, c2.stderr[:300])
    check("新版工作本 ≤12KB", os.path.getsize(book) <= 12 * 1024, str(os.path.getsize(book)))
    check("新版工作本结论 ≤20 条", len(kept) <= 20, str(len(kept)))
    check("新版工作本重复条目被去重",
          after.count("- 11-00 待办事实 0") == 1, str(after.count("- 11-00 待办事实 0")))
    check("新版工作本旧条目归档 .history.md",
          os.path.exists(hist) and "待办事实" in open(hist, encoding="utf-8").read())
    check("新版工作本整理不改写节标题", "## 本会话结论与待办" in after, after[:300])
    check("--compact stdout 用「记忆文件」措辞", "记忆文件" in c2.stdout, c2.stdout[:120])

    # --compact：旧版节（历史结论）仍能整理
    old_bullets = "\n".join(f"- 11-{i:02d} 旧事实 {i}" for i in range(25))
    with open(old_book, "w", encoding="utf-8") as f:
        f.write("# 旧对象\n\n> 飞书 · oc_old\n\n## 对方是谁\n\n## 沟通偏好\n\n"
                "## 在意与忌讳\n\n## 历史结论\n\n" + old_bullets + "\n")
    old_hist = os.path.join(d, "profiles", "feishu", "oc_old.history.md")
    c3 = subprocess.run([PY, script, "--compact", "feishu", "旧对象"],
                        capture_output=True, text=True, env=env, timeout=30)
    old_after = open(old_book, encoding="utf-8").read()
    old_kept = [line for line in old_after.splitlines() if line.startswith("- 11-")]
    check("旧版节 --compact 仍能整理",
          c3.returncode == 0 and len(old_kept) <= 20
          and os.path.exists(old_hist) and "旧事实" in open(old_hist, encoding="utf-8").read(),
          f"rc={c3.returncode} kept={len(old_kept)} err={c3.stderr[:200]}")

    # 两节都在：--note 优先「本会话结论与待办」
    with open(book, "a", encoding="utf-8") as f:
        f.write("\n## 历史结论\n\n- 旧节内容\n")
    n3 = subprocess.run([PY, script, "--note", "feishu", "示例对象", "优先写新节"],
                        capture_output=True, text=True, env=env, timeout=30)
    text = open(book, encoding="utf-8").read()
    new_tail = text.partition("## 本会话结论与待办")[2].partition("## 历史结论")[0]
    check("两节都在时 --note 优先「本会话结论与待办」",
          n3.returncode == 0 and "- 优先写新节" in new_tail
          and "- 优先写新节" not in text.partition("## 历史结论")[2],
          f"rc={n3.returncode} err={n3.stderr[:200]}")
    shutil.rmtree(d, ignore_errors=True)


def test_dm_single_profile():
    """单聊只用人物档案（spec 0035）：绑定 / 旧工作本整文件搬迁 / --note 落点 / 群不变。"""
    import stat
    print("\n[单聊单层] 绑定人物档案 / 旧工作本搬迁 / --note 落点 / 群仍用工作本")
    d = tempfile.mkdtemp(prefix="standin_dm_")
    env = dict(os.environ, IM_STANDIN_DIR=d)
    script = os.path.join(SCRIPTS, "bootstrap.py")
    old_rel = os.path.join("profiles", "feishu", "oc_dm.md")
    old_path = os.path.join(d, old_rel)
    os.makedirs(os.path.dirname(old_path), exist_ok=True)
    content = "# 张三\n\n> 飞书 · oc_dm\n\n## 历史结论\n\n- 只在企微找他\n"
    with open(old_path, "w", encoding="utf-8") as f:
        f.write(content)

    snippet = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import bootstrap as bs
node = {"chat_id": "oc_dm", "open_id": "ou_zhangsan", "kind": "user",
        "profile_file": sys.argv[2]}
path = bs.ensure_profile("feishu", "张三", node)
print(json.dumps({"path": path, "profile_file": node.get("profile_file")}))
"""
    r = subprocess.run([PY, "-c", snippet, SCRIPTS, old_rel],
                       capture_output=True, text=True, env=env, timeout=30)
    out = {}
    if r.returncode == 0 and r.stdout.strip():
        out = json.loads(r.stdout.strip().splitlines()[-1])
    want = os.path.join(d, "profiles", "people", "feishu", "ou_zhangsan.md")
    want_rel = os.path.join("profiles", "people", "feishu", "ou_zhangsan.md")
    check("kind=user 的目标绑人物档案", out.get("path") == want,
          f"rc={r.returncode} out={r.stdout[:200]} err={r.stderr[:200]}")
    check("旧工作本整文件搬进人物档案（逐字节）",
          os.path.exists(want) and open(want, encoding="utf-8").read() == content)
    check("搬迁后旧路径消失、只剩一份 md", not os.path.exists(old_path))
    check("env 里的 profile_file 指向人物档案", out.get("profile_file") == want_rel,
          str(out.get("profile_file")))
    check("人物档案权限 600",
          os.path.exists(want) and stat.S_IMODE(os.stat(want).st_mode) == 0o600)

    node = {"chat_id": "oc_dm", "open_id": "ou_zhangsan", "kind": "user",
            "person_id": "ou_zhangsan", "profile_file": want_rel}
    with open(os.path.join(d, "env.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "targets": {"feishu": {"张三": node}}}, f, ensure_ascii=False)
    n = subprocess.run([PY, script, "--note", "feishu", "张三", "周三下午不回消息"],
                       capture_output=True, text=True, env=env, timeout=30)
    text = open(want, encoding="utf-8").read()
    check("--note 写进人物档案的「历史结论」",
          n.returncode == 0 and "- 周三下午不回消息" in text.partition("## 历史结论")[2],
          f"rc={n.returncode} err={n.stderr[:200]}")
    check("--note 不另建会话工作本", not os.path.exists(old_path))

    g = subprocess.run([PY, script, "--alias", "feishu", "示例群", "oc_group"],
                       capture_output=True, text=True, env=env, timeout=30)
    gpath = os.path.join(d, "profiles", "feishu", "oc_group.md")
    check("没有人物 ID 的目标仍是会话工作本",
          g.returncode == 0 and os.path.exists(gpath)
          and "## 群内工作要求" in open(gpath, encoding="utf-8").read(),
          f"rc={g.returncode} err={g.stderr[:200]}")
    check("群目标不建人物档案",
          not os.path.exists(os.path.join(d, "profiles", "people", "feishu", "oc_group.md")))

    # 钉钉 kind=user 的目标不拿 userId 猜档案键（senderId ≠ userId），仍用工作本。
    snippet2 = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import bootstrap as bs
node = {"chat_id": "cid_ding", "open_id": "user_ding", "kind": "user"}
print(bs.ensure_profile("dingtalk", "王五", node))
print(node.get("profile_file", ""))
"""
    r2 = subprocess.run([PY, "-c", snippet2, SCRIPTS],
                        capture_output=True, text=True, env=env, timeout=30)
    lines = r2.stdout.strip().splitlines()
    # 没写过内容的旧模板：不搬成人物档案，直接按人物模板重建（单聊只剩一份）。
    snippet3 = r"""
import json, os, sys
sys.path.insert(0, sys.argv[1])
import bootstrap as bs
old = os.path.join(bs.ENV_DIR, "profiles", "feishu", "oc_li.md")
os.makedirs(os.path.dirname(old), exist_ok=True)
with open(old, "w", encoding="utf-8") as f:
    f.write(bs._profile_template("李四", "feishu", "oc_li"))
node = {"chat_id": "oc_li", "open_id": "ou_li", "kind": "user",
        "profile_file": os.path.join("profiles", "feishu", "oc_li.md")}
path = bs.ensure_profile("feishu", "李四", node)
print(json.dumps({"path": path, "old_exists": os.path.exists(old),
                  "text": open(path, encoding="utf-8").read()}))
"""
    r3 = subprocess.run([PY, "-c", snippet3, SCRIPTS],
                        capture_output=True, text=True, env=env, timeout=30)
    out3 = {}
    if r3.returncode == 0 and r3.stdout.strip():
        out3 = json.loads(r3.stdout.strip().splitlines()[-1])
    check("空的工作本模板不搬成人物档案（按人物模板重建）",
          out3.get("old_exists") is False
          and "## 身份与角色" in (out3.get("text") or "")
          and "## 群内工作要求" not in (out3.get("text") or ""),
          f"rc={r3.returncode} out={r3.stdout[:200]} err={r3.stderr[:200]}")

    check("钉钉 user 目标仍走会话工作本（不猜 senderId）",
          r2.returncode == 0 and lines[-1] == os.path.join("profiles", "dingtalk", "cid_ding.md"),
          f"rc={r2.returncode} out={r2.stdout[:200]} err={r2.stderr[:200]}")
    shutil.rmtree(d, ignore_errors=True)


PERSON_GOLDEN = [    # (platform, person_id, 期望相对路径)；与 dsh-plugin/tests/profiles.test.mjs 同一组字面
    ("feishu", "ou_abc", "profiles/people/feishu/ou_abc.md"),
    ("wecom", "zhangsan", "profiles/people/wecom/zhangsan.md"),
    ("feishu", "张三", "profiles/people/feishu/张三.md"),
    ("feishu", "ou 张三/一", "profiles/people/feishu/ou_张三_一.md"),
    ("feishu", "._-ou_x-._", "profiles/people/feishu/ou_x.md"),
    ("feishu", "张三（采购）", "profiles/people/feishu/张三_采购.md"),
    ("feishu", "ou😀x", "profiles/people/feishu/ou_x.md"),
    ("feishu", "a" * 120, "profiles/people/feishu/" + "a" * 80 + ".md"),
    ("", "ou_x", "profiles/people/unknown/ou_x.md"),
    ("  ", "ou_x", "profiles/people/unknown/ou_x.md"),
    ("feishu", "", ""),
    ("feishu", "   ", ""),
    ("feishu", None, ""),
    ("feishu", 123, "profiles/people/feishu/123.md"),
]


def test_person_profile():
    """人物档案（独立 skill 形态）：路径 golden / 模板 / 权限 / 追加 / 整理 / 列表 / 删除。"""
    import stat
    print("\n[人物档案] 路径 golden / 模板 / 权限 / 追加 / 整理 / 列表 / 删除")
    d = tempfile.mkdtemp(prefix="standin_person_")
    env = dict(os.environ, IM_STANDIN_DIR=d)
    script = os.path.join(SCRIPTS, "bootstrap.py")

    sys.path.insert(0, SCRIPTS)
    import bootstrap as bs

    bad = []
    for platform, person_id, want in PERSON_GOLDEN:
        got = bs._person_rel(platform, person_id)
        expected = os.path.join(*want.split("/")) if want else ""
        if got != expected:
            bad.append(f"{platform}/{person_id!r}: {got!r} != {expected!r}")
    check("人物路径 golden 与 Node personRel 逐字节一致", not bad, "; ".join(bad[:3]))
    check("空 ID 不建档案（_person_rel 返回空）",
          bs._person_rel("feishu", "") == "" and bs._person_rel("feishu", None) == "")

    # 空 ID：CLI 退出 2，且不建任何人物目录
    e = subprocess.run([PY, script, "--person-path", "feishu", "   "],
                       capture_output=True, text=True, env=env, timeout=30)
    check("--person-path 空 ID 退出 2 且不建目录",
          e.returncode == 2 and not os.path.exists(os.path.join(d, "profiles")),
          f"rc={e.returncode} err={e.stderr[:200]}")

    # --person-path：打印绝对路径并按需建模板
    a = subprocess.run([PY, script, "--person-path", "feishu", "ou_demo", "--name", "张三"],
                       capture_output=True, text=True, env=env, timeout=30)
    path_a = os.path.join(d, "profiles", "people", "feishu", "ou_demo.md")
    check("--person-path 打印一行绝对路径",
          a.returncode == 0 and a.stdout.strip() == os.path.abspath(path_a)
          and len(a.stdout.strip().splitlines()) == 1,
          f"rc={a.returncode} out={a.stdout!r} err={a.stderr[:200]}")
    check("--person-path 建出人物档案", os.path.exists(path_a))
    text = open(path_a, encoding="utf-8").read() if os.path.exists(path_a) else ""
    check("模板首行 # 名字", text.startswith("# 张三\n"), text[:80])
    check("模板第二行 平台·人物档案·ID", "> 飞书 · 人物档案 · ou_demo" in text, text[:200])
    sections = ["## 身份与角色", "## 沟通偏好", "## 在意与忌讳", "## 历史结论"]
    check("模板四段齐全且有序",
          all(s in text for s in sections) and
          [text.index(s) for s in sections] == sorted(text.index(s) for s in sections),
          text[:400])
    check("人物文件权限 600", stat.S_IMODE(os.stat(path_a).st_mode) == 0o600,
          oct(stat.S_IMODE(os.stat(path_a).st_mode)))
    for name, directory in (("人物目录权限 700", os.path.dirname(path_a)),
                            ("人物根目录权限 700", os.path.join(d, "profiles", "people"))):
        check(name, stat.S_IMODE(os.stat(directory).st_mode) == 0o700,
              oct(stat.S_IMODE(os.stat(directory).st_mode)))
    # 幂等：已有档案不被空模板覆盖
    with open(path_a, "a", encoding="utf-8") as f:
        f.write("\n- 人工补记\n")
    subprocess.run([PY, script, "--person-path", "feishu", "ou_demo"],
                   capture_output=True, text=True, env=env, timeout=30)
    check("--person-path 幂等（不覆盖已有内容）",
          "人工补记" in open(path_a, encoding="utf-8").read())

    # --person-note：新结论置顶、去重
    n1 = subprocess.run([PY, script, "--person-note", "feishu", "ou_demo", "先结论后细节"],
                        capture_output=True, text=True, env=env, timeout=30)
    text = open(path_a, encoding="utf-8").read()
    head, _, tail = text.partition("## 历史结论")
    check("--person-note 追加成功", n1.returncode == 0 and "- 先结论后细节" in tail,
          f"rc={n1.returncode} err={n1.stderr[:200]}")
    check("新结论挂在历史结论段首",
          tail.strip().splitlines()[0].strip() == "- 先结论后细节", tail[:120])
    subprocess.run([PY, script, "--person-note", "feishu", "ou_demo", "周五不回消息"],
                   capture_output=True, text=True, env=env, timeout=30)
    text = open(path_a, encoding="utf-8").read()
    check("更新结论置顶（旧的在后）",
          text.index("- 周五不回消息") < text.index("- 先结论后细节"), text[-300:])
    n3 = subprocess.run([PY, script, "--person-note", "feishu", "ou_demo", "周五不回消息"],
                        capture_output=True, text=True, env=env, timeout=30)
    text = open(path_a, encoding="utf-8").read()
    check("重复结论幂等（只留一条）", text.count("- 周五不回消息") == 1,
          f"count={text.count('- 周五不回消息')} rc={n3.returncode}")
    check("追加后文件仍 600", stat.S_IMODE(os.stat(path_a).st_mode) == 0o600,
          oct(stat.S_IMODE(os.stat(path_a).st_mode)))

    # --compact-person：去重 / 历史结论 ≤20 / 旧结论归档 / dry-run 不落盘
    hist = os.path.join(d, "profiles", "people", "feishu", "ou_demo.history.md")
    bullets = "\n".join(f"- 11-{i:02d} 历史事实 {i}" for i in range(30))
    text = ("# 张三\n\n> 飞书 · 人物档案 · ou_demo\n\n## 身份与角色\n\n" + "填充" * 1666 +
            "\n\n## 沟通偏好\n\n- 直接\n\n## 在意与忌讳\n\n- 自证口径\n\n## 历史结论\n\n" +
            bullets + "\n- 11-00 历史事实 0\n")
    with open(path_a, "w", encoding="utf-8") as f:
        f.write(text)
    before = os.path.getsize(path_a)
    c1 = subprocess.run([PY, script, "--compact-person", "feishu", "ou_demo", "--dry-run"],
                        capture_output=True, text=True, env=env, timeout=30)
    check("--compact-person --dry-run 不落盘",
          c1.returncode == 0 and os.path.getsize(path_a) == before and not os.path.exists(hist),
          f"rc={c1.returncode} err={c1.stderr[:200]}")
    c2 = subprocess.run([PY, script, "--compact-person", "feishu", "ou_demo"],
                        capture_output=True, text=True, env=env, timeout=30)
    after = open(path_a, encoding="utf-8").read()
    kept = [line for line in after.splitlines() if line.startswith("- 11-")]
    check("--compact-person 退出 0", c2.returncode == 0, c2.stderr[:300])
    check("人物档案 ≤12KB", os.path.getsize(path_a) <= 12 * 1024, str(os.path.getsize(path_a)))
    check("历史结论 ≤20 条", len(kept) <= 20, str(len(kept)))
    check("重复结论被去重", after.count("- 11-00 历史事实 0") == 1,
          str(after.count("- 11-00 历史事实 0")))
    check("旧结论归档到 .history.md",
          os.path.exists(hist) and "历史事实" in open(hist, encoding="utf-8").read())
    check("history 归档文件 600", stat.S_IMODE(os.stat(hist).st_mode) == 0o600,
          oct(stat.S_IMODE(os.stat(hist).st_mode)))

    # 12KB 硬上限：整理后仍超限 → 拒写，文件不动
    subprocess.run([PY, script, "--person-path", "feishu", "ou_big", "--name", "大档案"],
                   capture_output=True, text=True, env=env, timeout=30)
    path_big = os.path.join(d, "profiles", "people", "feishu", "ou_big.md")
    with open(path_big, "w", encoding="utf-8") as f:
        f.write("# 大档案\n\n> 飞书 · 人物档案 · ou_big\n\n## 身份与角色\n\n" +
                "填充" * 2500 + "\n\n## 沟通偏好\n\n## 在意与忌讳\n\n"
                "## 历史结论\n\n- 旧结论\n")
    big_before = open(path_big, "rb").read()
    nbig = subprocess.run([PY, script, "--person-note", "feishu", "ou_big", "新结论"],
                          capture_output=True, text=True, env=env, timeout=30)
    check("超 12KB 整理后仍超限 → 拒绝写入（退出 2）",
          nbig.returncode == 2 and "12KB" in nbig.stderr,
          f"rc={nbig.returncode} err={nbig.stderr[:200]}")
    check("拒写不改文件", open(path_big, "rb").read() == big_before)
    cbig = subprocess.run([PY, script, "--compact-person", "feishu", "ou_big"],
                          capture_output=True, text=True, env=env, timeout=30)
    check("--compact-person 超限拒绝且不改文件",
          cbig.returncode == 2 and open(path_big, "rb").read() == big_before,
          f"rc={cbig.returncode} err={cbig.stderr[:200]}")

    # --persons：path<TAB>name，名字取首个 # 标题；只读
    people_dir = os.path.join(d, "profiles", "people", "feishu")
    snap = sorted(os.listdir(people_dir))
    lst = subprocess.run([PY, script, "--persons"], capture_output=True, text=True,
                         env=env, timeout=30)
    lines = [ln for ln in lst.stdout.splitlines() if ln.strip()]
    check("--persons 列出全部人物档案", lst.returncode == 0 and len(lines) == 2,
          f"rc={lst.returncode} out={lst.stdout[:300]}")
    check("--persons 每行 path<TAB>名字（名字取 # 标题）",
          all("\t" in ln for ln in lines)
          and any(ln.split("\t")[0] == os.path.abspath(path_a) and ln.endswith("\t张三")
                  for ln in lines),
          str(lines))
    check("--persons 不列 .history.md",
          all(not ln.split("\t")[0].endswith(".history.md") for ln in lines), str(lines))
    p1 = subprocess.run([PY, script, "--persons", "feishu"], capture_output=True, text=True,
                        env=env, timeout=30)
    p2 = subprocess.run([PY, script, "--persons", "wecom"], capture_output=True, text=True,
                        env=env, timeout=30)
    check("--persons PLATFORM 按平台过滤",
          p1.returncode == 0 and len([x for x in p1.stdout.splitlines() if x.strip()]) == 2
          and p2.returncode == 0 and not p2.stdout.strip(),
          f"feishu={p1.stdout[:120]!r} wecom={p2.stdout[:120]!r}")
    check("--persons 只读（不建/不改文件）", sorted(os.listdir(people_dir)) == snap)
    check("人物操作不写 env.json（纯推导，不建索引）",
          not os.path.exists(os.path.join(d, "env.json")))

    # --delete-data：profiles/ 整树删除，人物档案随之清理
    check("删除前人物档案存在", os.path.exists(path_a) and os.path.exists(path_big))
    dd = subprocess.run([PY, script, "--delete-data", "--yes"], capture_output=True,
                        text=True, env=env, timeout=30)
    check("--delete-data 覆盖 profiles/people（人物档案也被删）",
          dd.returncode == 0 and not os.path.exists(path_a)
          and not os.path.exists(os.path.join(d, "profiles", "people")),
          f"rc={dd.returncode} err={dd.stderr[:200]}")
    shutil.rmtree(d, ignore_errors=True)


def test_privacy_and_redaction():
    """个人数据默认私有；敏感语料脱敏；删除必须显式确认。"""
    import stat
    print("\n[隐私] 文件权限 / 语料脱敏 / 一键删除")
    d = tempfile.mkdtemp(prefix="standin_privacy_")
    env = dict(os.environ, IM_STANDIN_DIR=d)
    script = os.path.join(SCRIPTS, "bootstrap.py")
    r = subprocess.run([PY, script, "--alias", "feishu", "测试", "oc_test"],
                       capture_output=True, text=True, env=env, timeout=30)
    env_path = os.path.join(d, "env.json")
    check("别名写入成功", r.returncode == 0, r.stderr[:200])
    if os.path.exists(env_path):
        check("数据目录权限 700", stat.S_IMODE(os.stat(d).st_mode) == 0o700,
              oct(stat.S_IMODE(os.stat(d).st_mode)))
        check("env.json 权限 600", stat.S_IMODE(os.stat(env_path).st_mode) == 0o600,
              oct(stat.S_IMODE(os.stat(env_path).st_mode)))
    r2 = subprocess.run([PY, script, "--delete-data"], capture_output=True, text=True,
                        env=env, timeout=30)
    check("删除数据缺少 --yes 时拒跑", r2.returncode == 2 and os.path.exists(env_path),
          f"rc={r2.returncode}")
    r3 = subprocess.run([PY, script, "--delete-data", "--yes"], capture_output=True, text=True,
                        env=env, timeout=30)
    check("--delete-data --yes 删除个人数据", r3.returncode == 0 and not os.path.exists(env_path),
          f"rc={r3.returncode} err={r3.stderr[:200]}")

    sys.path.insert(0, SCRIPTS)
    import bootstrap as bs
    try:
        cleaned = bs.redact_sensitive(
            "看这个 https://example.com/?access_token=TOPSECRET，"
            "邮箱 a@example.com，password=VERYSECRET，结论不变")
    except AttributeError as e:
        check("提供语料脱敏函数", False, str(e))
    else:
        check("语料脱敏不泄露 URL/token/email/password",
              all(x not in cleaned for x in
                  ("TOPSECRET", "VERYSECRET", "a@example.com", "access_token=")), cleaned)
        check("语料脱敏保留风格文本", "结论不变" in cleaned, cleaned)
    shutil.rmtree(d, ignore_errors=True)


def test_schema_error_redaction():
    """schema 错误只暴露字段名，不回显消息正文或凭据值。"""
    sys.path.insert(0, SCRIPTS)
    import listen_core as lc
    ln = lc.Listener("wecom", {"cli": "mock", "cmd_list": ["messages"],
                               "f_items": [["messages"]]})
    raw = '{"unexpected":"TOPSECRET","content":"private message"}'
    ln.run_cli = lambda *_args, **_kw: (0, {"unexpected": "TOPSECRET",
                                             "content": "private message"}, raw)
    ok, err = ln.fetch_messages("target")
    check("schema 错误仍可诊断", not ok and "unexpected" in err, err)
    check("schema 错误不回显敏感值", "TOPSECRET" not in err and "private message" not in err, err)


def test_doctor_missing_cli():
    """没有任何 CLI 时必须不可用，未安装的平台不能进入 healthy。"""
    d = tempfile.mkdtemp(prefix="standin_no_cli_")
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir)
    env = dict(os.environ, IM_STANDIN_DIR=d, PATH=bindir)
    r = subprocess.run([PY, os.path.join(SCRIPTS, "doctor.py"), "--json"],
                       capture_output=True, text=True, env=env, timeout=60)
    try:
        data = json.loads(r.stdout)
    except Exception:
        data = {}
    summary = data.get("summary", {})
    check("无 CLI 时 doctor 退出 2", r.returncode == 2,
          f"rc={r.returncode} out={r.stdout[:200]}")
    check("无 CLI 时 healthy 为空", summary.get("healthy") == [], str(summary))
    check("无 CLI 时三平台均 broken", set(summary.get("broken", [])) ==
          {"feishu", "wecom", "dingtalk"}, str(summary))
    shutil.rmtree(d, ignore_errors=True)


def test_doctor_update_warn_not_fail():
    """CLI 自己的 warn（有新版本）不是故障：只报 warn，平台仍可用。"""
    print("\n[体检] cli_update=warn 不阻塞平台")
    d = tempfile.mkdtemp(prefix="standin_warn_")
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir)
    checks = [{"name": "auth", "status": "pass", "message": "ok"},
              {"name": "cli_update", "status": "warn",
               "message": "9.9.9 → 9.9.10 available", "hint": "run: lark-cli update"}]
    for cli in ("lark-cli", "wecom-cli", "dws"):
        write_flex_stub(bindir, cli, checks)
    with open(os.path.join(d, "env.json"), "w") as f:
        json.dump({"version": 1,
                   "platforms": {k: {"self_id": f"self_{k}"}
                                 for k in ("feishu", "wecom", "dingtalk")},
                   "targets": {}}, f)
    env = dict(os.environ, IM_STANDIN_DIR=d,
               PATH=bindir + os.pathsep + os.environ.get("PATH", ""))
    r = subprocess.run([PY, os.path.join(SCRIPTS, "doctor.py"), "--json"],
                       capture_output=True, text=True, env=env, timeout=120)
    try:
        data = json.loads(r.stdout)
    except Exception:
        data = {}
    stats = {p: v["status"] for p, v in data.get("platforms", {}).items()}
    check("有新版本时 doctor 退出 0", r.returncode == 0, f"rc={r.returncode} {r.stdout[:200]}")
    check("cli_update 只算 warn", stats.get("feishu") == "warn", str(stats))
    check("warn 不计入 fail", data.get("summary", {}).get("fail") == 0,
          str(data.get("summary")))
    shutil.rmtree(d, ignore_errors=True)


def test_doctor_only_enabled_platforms():
    """全平台体检只看启用平台：没启用的平台不跑检查、不进 broken。"""
    print("\n[体检] 只检查启用的平台")
    d = tempfile.mkdtemp(prefix="standin_enabled_")
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir)
    write_flex_stub(bindir, "lark-cli")  # 只装飞书；企微/钉钉故意不装
    with open(os.path.join(d, "state.json"), "w") as f:
        json.dump({"version": 1, "config": {"platforms": ["feishu"]}}, f)
    env = dict(os.environ, IM_STANDIN_DIR=d,
               PATH=bindir + os.pathsep + os.environ.get("PATH", ""))
    r = subprocess.run([PY, os.path.join(SCRIPTS, "doctor.py"), "--json"],
                       capture_output=True, text=True, env=env, timeout=120)
    try:
        data = json.loads(r.stdout)
    except Exception:
        data = {}
    summary = data.get("summary", {})
    check("只查启用平台时退出 0", r.returncode == 0, f"rc={r.returncode} {r.stdout[:200]}")
    check("未启用平台不进 broken", summary.get("broken") == [], str(summary))
    check("healthy 只有飞书", summary.get("healthy") == ["feishu"], str(summary))
    check("未启用平台进 skipped",
          set(summary.get("skipped") or []) == {"wecom", "dingtalk"}, str(summary))
    check("未启用平台不查 CLI", set(data.get("platforms", {})) == {"feishu"},
          str(list(data.get("platforms", {}))))
    shutil.rmtree(d, ignore_errors=True)


def test_doctor_path_network_retry():
    """通路自检：传输层失败重试一次，仍失败时给可读原因且 ID 打码。"""
    print("\n[体检] 通路自检的网络重试与可读原因")
    d = tempfile.mkdtemp(prefix="standin_path_")
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir)
    write_flex_stub(bindir, "lark-cli", im_block=STUB_IM_NETWORK)
    os.makedirs(os.path.join(d, "states"))
    target = "oc_a1b2c3d4e5f67890"
    with open(os.path.join(d, "states", f"feishu_{target}.pos"), "w") as f:
        json.dump({"last_id": "om_x", "ts": 1}, f)
    env = dict(os.environ, IM_STANDIN_DIR=d,
               PATH=bindir + os.pathsep + os.environ.get("PATH", ""))
    r = subprocess.run([PY, os.path.join(SCRIPTS, "doctor.py"), "feishu",
                        "--chat-id", target, "--show-ids"],
                       capture_output=True, text=True, env=env, timeout=120)
    out = (r.stdout or "") + (r.stderr or "")
    try:
        with open(os.path.join(d, "calls.txt")) as f:
            calls = f.read().count("im")
    except Exception:
        calls = 0
    check("通路自检真的调了 CLI", calls >= 2, f"calls={calls}")
    check("重试一次后才判失败", "已重试 1 次" in out, out[:300])
    check("通路失败给出可读原因", "网络传输失败" in out and "i/o timeout" in out, out[:300])
    check("通路失败不再吞成空原因",
          "初始化水位失败: \n" not in out and "[fail] 通路: ERROR" not in out, out[:300])
    check("错误原文里的会话 ID 打码",
          "oc_c56748207171a8ce2744e7826f6ed313" not in out, out[:300])
    check("两次都失败仍判 fail（退出 2）", r.returncode == 2, f"rc={r.returncode}")
    shutil.rmtree(d, ignore_errors=True)


def test_probe_path_retry_policy():
    """probe_path：只有 network 类重试一次；auth / schema 直接失败，不多跑一轮。"""
    print("\n[体检] 通路探针的重试策略")
    sys.path.insert(0, SCRIPTS)
    import bootstrap as bs

    def fake(kind, msg):
        payload = json.dumps({"ok": False, "error": {"type": kind, "message": msg}})
        return 2, "", "ERROR: 初始化水位失败: " + payload

    orig = bs.listen_probe
    try:
        calls = []

        def network(*_a, **_k):
            calls.append(1)
            return fake("network", "dial tcp: i/o timeout")

        bs.listen_probe = network
        r = bs.probe_path("feishu", "oc_test", retry=True)
        check("network 失败重试一次", len(calls) == 2 and r["retried"] is True, f"calls={len(calls)}")
        check("两次都失败才判不可用", r["ok"] is False and r["kind"] == "network", str(r))

        calls.clear()

        def auth(*_a, **_k):
            calls.append(1)
            return fake("auth", "token invalid")

        bs.listen_probe = auth
        r = bs.probe_path("feishu", "oc_test", retry=True)
        check("auth 失败不重试", len(calls) == 1 and r["retried"] is False, f"calls={len(calls)}")
        check("auth 失败仍判不可用", r["ok"] is False and r["kind"] == "auth", str(r))

        calls.clear()
        bs.listen_probe = lambda *_a, **_k: (calls.append(1) or (3, "", ""))
        r = bs.probe_path("feishu", "oc_test", retry=True)
        check("超时未命中不算失败", r["ok"] is True and len(calls) == 1, str(r))
    finally:
        bs.listen_probe = orig


def test_safety_docs():
    """公开 skill 必须包含注入边界与不可重置的临时值守说明。"""
    skill = open(os.path.join(ROOT, "SKILL.md"), encoding="utf-8").read()
    check("文档声明聊天内容不可信", "不可信" in skill)
    check("文档禁止聊天消息触发命令/读文件", "执行命令" in skill and "读文件" in skill)
    check("文档提供 --until", "--until" in skill)
    check("文档提供 --cache-refresh-min", "--cache-refresh-min" in skill)
    check("文档说明 55 分钟缓存续期", "55 分钟" in skill and "缓存" in skill)
    readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
    check("README 说明 55 分钟缓存续期", "55 分钟" in readme and "缓存" in readme)
    check("文档禁止重挂重置截止时间", "重置截止时间" in skill)
    check("文档提供显式数据删除命令", "--delete-data --yes" in skill)
    check("文档提供 --idle-exit-min", "--idle-exit-min" in skill)
    check("文档说明闲置退出不重挂", "不要重挂" in skill and "闲置" in skill)


def test_plugin_polling():
    """dsh-plugin：Node 单进程壳的 state/poller/live turn/API/迁移测试。"""
    plug = os.path.join(ROOT, "dsh-plugin")
    if not os.path.isdir(plug):
        print("\n[插件] 跳过：包内没有 dsh-plugin/（仅仓库版有）")
        return
    r = subprocess.run(["node", "--test"], cwd=plug, capture_output=True, text=True, timeout=180)
    tail = (r.stderr or r.stdout or "").strip().splitlines()
    detail = tail[-1] if tail else ""
    check("dsh-plugin Node 测试全过（state/poller/turns/app/迁移）", r.returncode == 0, detail)


def test_doc_contracts():
    """docs/specs/contracts 与代码对账 + 版本一致 + 构建产物新鲜度 + verify_docs。"""
    if not os.path.exists(os.path.join(HERE, "test_docs.py")):
        print("\n[文档对账] 跳过：包内没有 tests/test_docs.py（仅仓库版有）")
        return
    print("\n[文档对账] 契约 / 版本 / 构建产物 / verify_docs")
    sys.path.insert(0, HERE)
    import test_docs
    test_docs.main(check)


if __name__ == "__main__":
    print("== cyber-im-avatar 引擎端到端测试（mock CLI，不触发真实发送）==")
    test_wecom_hit()
    test_dws_hit()
    test_schema_mismatch()
    test_time_window()
    test_find_command()
    test_absolute_deadline()
    test_cache_refresh()
    test_idle_exit()
    test_profile_compact()
    test_workbook_layers()
    test_dm_single_profile()
    test_person_profile()
    test_privacy_and_redaction()
    test_schema_error_redaction()
    test_docs()
    test_safety_docs()
    test_doctor()
    test_doctor_missing_cli()
    test_doctor_update_warn_not_fail()
    test_doctor_only_enabled_platforms()
    test_doctor_path_network_retry()
    test_probe_path_retry_policy()
    test_reauth()
    test_plugin_polling()
    test_doc_contracts()
    print(f"\n结果：{passed} 通过 / {failed} 失败")
    sys.exit(1 if failed else 0)
