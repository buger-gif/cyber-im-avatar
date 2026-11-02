#!/usr/bin/env python3
"""build_client.py — 把 web/panel.js 内联进 lib/client.js。

panel.js 是唯一事实源（DSH 插件与浏览器直连预览共用）；改完跑：
    python3 scripts/build_client.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL = os.path.join(ROOT, "web", "panel.js")
TPL = os.path.join(ROOT, "lib", "client.template.js")
OUT = os.path.join(ROOT, "lib", "client.js")


def main():
    with open(PANEL) as f:
        panel = f.read()
    with open(TPL) as f:
        tpl = f.read()
    if "/*__PANEL_JS__*/" not in tpl:
        raise SystemExit("template missing placeholder")
    out = tpl.replace("/*__PANEL_JS__*/", panel)
    with open(OUT, "w") as f:
        f.write(out)
    print(f"wrote {OUT} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
