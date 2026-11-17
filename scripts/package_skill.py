#!/usr/bin/env python3
"""package_skill.py — 把仓库根目录的 skill 打成可直接分发的文件夹（附同名 zip）。

只带装到 agent skills 目录后真正要用的文件，不带仓库自己的 docs/、dsh-plugin/ 与开发脚本：

    SKILL.md  README.md  CHANGELOG.md  LICENSE
    references/*.md
    scripts/*.py（仅运行时脚本，不含 gate.sh / verify_docs.py 等仓库工具）
    tests/run_tests.py  tests/mock_cli.py

打包前按常见技能市场的上传校验预检 SKILL.md frontmatter：
根目录必须有 SKILL.md，frontmatter 的 name 只能是小写字母 / 数字 / - / _，description 非空。

用法:
    python3 scripts/package_skill.py                # 生成 dist/cyber-im-avatar/ 与同名 zip
    python3 scripts/package_skill.py --no-zip       # 只要文件夹
    python3 scripts/package_skill.py --out /tmp/p   # 换输出目录
"""
import argparse
import re
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = "cyber-im-avatar"
ROOT_FILES = ("SKILL.md", "README.md", "CHANGELOG.md", "LICENSE")
RUNTIME_SCRIPTS = (
    "bootstrap.py", "data_guard.py", "doctor.py", "reauth.py", "listen_core.py",
    "feishu_listen_cli.py", "wecom_listen_cli.py", "dingtalk_listen_cli.py",
)
TEST_FILES = ("run_tests.py", "mock_cli.py")
MANAGED = set(ROOT_FILES) | {"references", "scripts", "tests"}
NAME_RE = re.compile(r"^[a-z0-9_-]+$")
SKIP = re.compile(r"__pycache__|\.pyc$|\.DS_Store$")


def parse_frontmatter(path):
    """极简 frontmatter 读取：只取顶层 key: value，够校验 name / description。"""
    text = path.read_text(encoding="utf-8").lstrip("\ufeff").replace("\r\n", "\n")
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, "SKILL.md 必须以 --- 开头的 YAML frontmatter 开头"
    end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"), -1)
    if end < 0:
        return None, "SKILL.md frontmatter 缺少结束的 ---"
    meta = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith(("#", "-")):
            continue
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, None


def check_frontmatter():
    meta, err = parse_frontmatter(ROOT / "SKILL.md")
    if err:
        return False, err
    name = (meta.get("name") or "").strip()
    desc = (meta.get("description") or "").strip()
    if not name:
        return False, "SKILL.md frontmatter 缺少 name"
    if not NAME_RE.match(name):
        return False, f"name 只能取小写字母、数字、连字符和下划线：{name!r}"
    if not desc:
        return False, "SKILL.md frontmatter 缺少 description"
    return True, f"name={name}，description={desc[:40]}…"


def prepare(out):
    """只覆盖空目录或上一次生成的包，避免 --out 指错时误删别的东西。"""
    if out.exists():
        entries = {p.name for p in out.iterdir()}
        if entries and not entries <= MANAGED:
            raise SystemExit(
                f"目标已存在且不是 skill 包，拒绝覆盖：{out}\n换 --out，或先手动删掉它。"
            )
        shutil.rmtree(out)
    out.mkdir(parents=True)


def build(out):
    for name in ROOT_FILES:
        src = ROOT / name
        if not src.exists():
            raise SystemExit(f"缺少 {name}")
        shutil.copy2(src, out / name)
    for sub, names in (("references", None), ("scripts", RUNTIME_SCRIPTS),
                       ("tests", TEST_FILES)):
        src_dir = ROOT / sub
        if names is None:
            names = tuple(sorted(p.name for p in src_dir.glob("*.md")))
        (out / sub).mkdir(parents=True, exist_ok=True)
        for name in names:
            src = src_dir / name
            if not src.exists():
                raise SystemExit(f"缺少 {sub}/{name}")
            shutil.copy2(src, out / sub / name)
    return sorted(p for p in out.rglob("*") if p.is_file() and not SKIP.search(str(p)))


def make_zip(out):
    zip_path = out.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(p for p in out.rglob("*") if p.is_file()):
            if SKIP.search(str(path)):
                continue
            arc = Path(out.name) / path.relative_to(out)
            zf.write(path, arcname=str(arc).replace("\\", "/"))
    return zip_path


def human(size):
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size / 1024 / 1024:.1f} MB"


def main():
    parser = argparse.ArgumentParser(description="打包可分发 skill 文件夹")
    parser.add_argument("--out", default=str(ROOT / "dist" / SKILL),
                        help=f"输出目录（默认 dist/{SKILL}）")
    parser.add_argument("--no-zip", action="store_true", help="不生成同名 zip")
    args = parser.parse_args()

    ok, info = check_frontmatter()
    if not ok:
        raise SystemExit(f"frontmatter 校验失败：{info}")

    out = Path(args.out).expanduser().resolve()
    if out.name != SKILL:
        raise SystemExit(f"输出目录名固定为 {SKILL}（解压后直接放进 skills 目录）：{out}")
    prepare(out)
    files = build(out)
    print(f"skill 包 -> {out}")
    print(f"  frontmatter  {info}")
    print(f"  {len(files)} 个文件，共 {human(sum(p.stat().st_size for p in files))}")
    for path in files:
        print(f"    {path.relative_to(out)}")
    if not args.no_zip:
        zip_path = make_zip(out)
        print(f"  zip -> {zip_path}（{human(zip_path.stat().st_size)}）")
    print("上传：技能市场 → 上传 / 更新技能 → 选择整个文件夹（根目录含 SKILL.md）")
    print(f"生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
