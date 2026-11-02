#!/usr/bin/env python3
"""verify_docs.py — 文档一致性 gate（只依赖标准库）。

检查项：
  1. 链接与锚点：文档内所有相对链接的文件必须存在，锚点必须能在目标文件里对上标题。
  2. 活文档行数预算：每份活文档必须在 scripts/doc_budgets.json 登记上限且不超（无预算=无界增长入口）。
  3. 反流水账：活文档禁「追加」式标题、禁「此前：/原先：」状态链——活文档就地改写，不做沿革。
  4. spec 编号：active/ 与 archive/ 的编号连续不重复，「下一个号」指针必须等于最大号 + 1。
  5. 归档登记：archive/ 里每个 spec 必须在 archive/README.md 登记表里有一行。
  6. spec / decision 结构：必备小节与状态行，decision 的状态必须与所在目录一致。
  7. 契约文件格式：三份契约的表格列头必须保持可被 tests/test_docs.py 解析的形状。

冻结区（docs/implementation/log/**、docs/specs/archive/**、docs/decisions/{implemented,rejected,proposed}/**、
docs/audits/**、CHANGELOG.md）不做预算与反流水账检查——历史不改写；但指向它们的链接仍会校验。

用法：
    python3 scripts/verify_docs.py                 # 全量检查，违规退出码非 0
    python3 scripts/verify_docs.py --budgets-only  # 只查行数预算（快，适合频繁跑）
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUDGETS = REPO / "scripts" / "doc_budgets.json"

SKIP_DIRS = {".git", ".workbuddy", ".zcode", "node_modules", "__pycache__",
             "market", "dist", "screenshots", "cordis.patch.yml"}

# 活文档：随代码演进、必须就地改写的文件。这些必须登记预算，且禁追加式残留。
LIVING_EXACT = ("AGENTS.md", "README.md", "SKILL.md", "dsh-plugin/README.md",
                "docs/AGENTS.md", "docs/README.md",
                "docs/specs/README.md", "docs/decisions/README.md",
                "docs/implementation/PROGRESS.md")
LIVING_PREFIXES = ("docs/architecture/", "docs/specs/contracts/",
                   "docs/implementation/runbooks/")
LIVING_EXCLUDED = ("docs/implementation/log/",)
APPEND_HEADING_RE = re.compile(r"^#{1,6}\s+.*追加")
STALE_CHAIN_RE = re.compile(r"此前[:：]|原先[:：]")
QUOTED_SPAN_RE = re.compile(r"「[^」]*」|`[^`]*`|「[^」]*$")

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
SPEC_FILE_RE = re.compile(r"^(\d{4})-.+\.md$")
SPEC_STATUS = ("待实施", "实施中", "已验收", "已放弃")
NEXT_NO_RE = re.compile(r"^\*\*下一个号[：:]\s*(\d{4})\*\*", re.M)
CONTRACT_HEADERS = {
    "docs/specs/contracts/01-api.md": ("| 方法 |", "## 读接口（GET）", "## 写接口（POST 覆盖）", "## 删除接口（DELETE）"),
    "docs/specs/contracts/02-storage.md": ("| 键 |", "## 顶层", "## chats 里的会话对象", "## recent 里的一条消息"),
    "docs/specs/contracts/03-config.md": ("| 键 |", "## 键与默认值", "## 取值范围", "## 老键迁移"),
}
DECISION_SECTIONS = ("## 背景", "## 决策", "## 备选", "## 后果")
SPEC_SECTIONS = ("## 背景", "## 方案", "## 验收")
DECISION_STATUS = {"proposed": "proposed", "implemented": "implemented", "rejected": "rejected"}


def md_files():
    out = []
    for p in sorted(REPO.rglob("*.md")):
        rel = p.relative_to(REPO).as_posix()
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        out.append((rel, p))
    return out


def is_living(rel):
    if any(rel.startswith(x) for x in LIVING_EXCLUDED):
        return False
    if rel.endswith("_template.md") or Path(rel).name.startswith("_"):
        return False
    return rel in LIVING_EXACT or any(rel.startswith(x) for x in LIVING_PREFIXES)


def github_anchor(heading_text):
    """GitHub 风格锚点：小写、去格式符与标点、空格换连字符。CJK 保留。"""
    t = heading_text.strip()
    t = re.sub(r"[`*_~]", "", t)
    t = re.sub(r"[^\w\s\u4e00-\u9fff-]", "", t)   # 去掉中英文标点，保留字母数字下划线空格与 CJK
    t = re.sub(r"\s+", "-", t.strip()).lower()
    return t


def headings(text):
    out = []
    for line in text.splitlines():
        m = HEADING_RE.match(line)
        if m:
            out.append(github_anchor(m.group(2)))
    return out


def check_links(rel, p, errs):
    text = p.read_text(encoding="utf-8")
    own = set(headings(text))
    for m in LINK_RE.finditer(text):
        target = m.group(1)
        if target.startswith(("http://", "https://", "mailto:", "data:")):
            continue
        path, _, anchor = target.partition("#")
        if path:
            fp = (p.parent / path).resolve()
            if not fp.exists():
                errs.append(f"{rel}: 死链 -> {target}")
                continue
            if fp.suffix == ".md" and anchor:
                t = set(headings(fp.read_text(encoding="utf-8")))
                if anchor not in t:
                    errs.append(f"{rel}: 死锚 -> {target}（目标文件没有这个标题）")
        elif anchor:
            if anchor not in own:
                errs.append(f"{rel}: 死锚 -> #{anchor}")


def load_budgets():
    if not BUDGETS.exists():
        return {}
    return json.loads(BUDGETS.read_text(encoding="utf-8"))


def check_budgets(files, errs, warns):
    budgets = load_budgets()
    covered = set()
    for path, limit in budgets.items():
        if path.startswith("#") or path == "_comment":
            continue
        p = REPO / path
        if not p.exists():
            errs.append(f"doc_budgets.json: 登记的文件不存在 -> {path}")
            continue
        covered.add(path)
        n = len(p.read_text(encoding="utf-8").splitlines())
        if n > int(limit):
            errs.append(f"{path}: {n} 行 > 预算 {limit} 行——就地精简，或说明理由后调预算")
    for rel, _ in files:
        if is_living(rel) and rel not in covered:
            errs.append(f"{rel}: 活文档未登记行数预算（scripts/doc_budgets.json）")
    return budgets


def check_append_residue(rel, p, errs):
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        stripped = QUOTED_SPAN_RE.sub("", line)
        if APPEND_HEADING_RE.match(stripped.strip() or line) and APPEND_HEADING_RE.match(line):
            errs.append(f"{rel}:{i}: 活文档禁「追加」式标题，就地改写正文（docs/AGENTS.md §3）")
        elif STALE_CHAIN_RE.search(stripped):
            errs.append(f"{rel}:{i}: 活文档禁「此前：/原先：」状态链，直接写成当前事实")


def check_specs(files, errs):
    specs = []
    for rel, p in files:
        base = Path(rel).name
        if rel.startswith(("docs/specs/active/", "docs/specs/archive/")) and SPEC_FILE_RE.match(base):
            if base.endswith("-plan.md"):
                continue    # 实施计划与 spec 同号，不参与编号与结构检查
            num = SPEC_FILE_RE.match(base).group(1)
            specs.append((rel, p, int(num), base))
    nums = [n for _, _, n, _ in specs]
    if len(nums) != len(set(nums)):
        for n in sorted({x for x in nums if nums.count(x) > 1}):
            errs.append(f"spec 编号 {n:04d} 重复")
    readme = REPO / "docs" / "specs" / "README.md"
    m = NEXT_NO_RE.search(readme.read_text(encoding="utf-8"))
    if not m:
        errs.append("docs/specs/README.md: 找不到「**下一个号：NNNN**」指针")
    else:
        nxt = int(m.group(1))
        if nums and nxt != max(nums) + 1:
            errs.append(f"docs/specs/README.md: 下一个号 {nxt:04d} 与最大已用号 {max(nums):04d} 不接续")
        if nxt in nums:
            errs.append(f"docs/specs/README.md: 下一个号 {nxt:04d} 已被占用")
    for rel, p, _, base in specs:
        text = p.read_text(encoding="utf-8")
        if not re.search(r"^>\s*状态[：:]\s*\S+", text, re.M):
            errs.append(f"{rel}: 缺「> 状态:」行")
        else:
            st = re.search(r"^>\s*状态[：:]\s*(\S+)", text, re.M).group(1).rstrip("。")
            if st not in SPEC_STATUS:
                errs.append(f"{rel}: 状态「{st}」不在 {SPEC_STATUS}")
        for sec in SPEC_SECTIONS:
            if sec not in text:
                errs.append(f"{rel}: 缺小节 {sec}")
        if rel.startswith("docs/specs/archive/"):
            arch = (REPO / "docs" / "specs" / "archive" / "README.md").read_text(encoding="utf-8")
            if base.split("-")[0] not in arch:
                errs.append(f"{rel}: 未在 docs/specs/archive/README.md 登记")


def check_decisions(files, errs):
    for rel, p in files:
        m = re.match(r"^docs/decisions/(proposed|implemented|rejected)/(\d{4})-.+\.md$", rel)
        if not m or Path(rel).name.startswith("_"):
            continue
        status_dir = m.group(1)
        text = p.read_text(encoding="utf-8")
        for sec in DECISION_SECTIONS:
            if sec not in text:
                errs.append(f"{rel}: 决策记录缺小节 {sec}")
        dm = re.search(r"^>\s*状态[：:]\s*(\S+)", text, re.M)
        if not dm:
            errs.append(f"{rel}: 缺「> 状态:」行")
        elif dm.group(1) != DECISION_STATUS[status_dir]:
            errs.append(f"{rel}: 状态「{dm.group(1)}」与目录 docs/decisions/{status_dir}/ 不符")
        idx = (REPO / "docs" / "decisions" / "README.md").read_text(encoding="utf-8")
        num = rel.split("/")[-1].split("-")[0]
        if num not in idx:
            errs.append(f"{rel}: 未在 docs/decisions/README.md 索引表登记")


def check_contracts(errs):
    for rel, markers in CONTRACT_HEADERS.items():
        p = REPO / rel
        if not p.exists():
            errs.append(f"{rel}: 契约文件缺失")
            continue
        text = p.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                errs.append(f"{rel}: 缺「{marker}」——tests/test_docs.py 依赖这个可解析形状")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budgets-only", action="store_true")
    args = ap.parse_args()
    files = md_files()
    errs, warns = [], []

    if args.budgets_only:
        check_budgets(files, errs, warns)
    else:
        for rel, p in files:
            check_links(rel, p, errs)
        check_budgets(files, errs, warns)
        for rel, p in files:
            if is_living(rel):
                check_append_residue(rel, p, errs)
        check_specs(files, errs)
        check_decisions(files, errs)
        check_contracts(errs)

    for w in warns:
        print(f"WARN  {w}")
    for e in errs:
        print(f"FAIL  {e}")
    if not errs and not warns:
        print("verify_docs: 全部通过")
    n = len(files)
    print(f"检查 {n} 份文档，{len(errs)} 处违规，{len(warns)} 条提醒")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
