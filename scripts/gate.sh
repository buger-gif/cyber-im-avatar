#!/usr/bin/env bash
# gate — 本仓库的收尾闸门。
#
# 用法:
#   bash scripts/gate.sh            # 全量：静态层 + 全部测试（发版前口径）
#   bash scripts/gate.sh --quick    # 静态层 only（秒级，提交前口径；pre-commit 调的就是它）
#
# 设计:
# - 静态层全部秒级、无第三方依赖：py_compile / node --check / verify_docs / 契约对账。
# - 契约对账（tests/test_docs.py）拦四类漂移：路由、state.json 字段、配置键、构建产物 + 版本一致。
# - 全量层复用 tests/run_tests.py（它包含 skill 引擎测试、插件 Node 测试与文档对账）。
# - 一步失败不中断其余步骤，末尾汇总统一判结果；任何一步红都算 gate 红。
set -u
cd "$(dirname "$0")/.."

MODE="full"
[[ "${1:-}" == "--quick" ]] && MODE="quick"

declare -a NAMES=() RESULTS=() DETAILS=()
GATE_PASS=true

run_step() {
  local name="$1"; shift
  local out rc
  out=$("$@" 2>&1); rc=$?
  NAMES+=("$name")
  if [ $rc -eq 0 ]; then
    RESULTS+=("PASS")
    printf 'PASS  %s\n' "$name"
  else
    GATE_PASS=false
    RESULTS+=("FAIL")
    DETAILS+=("$name")
    printf 'FAIL  %s\n' "$name"
    printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
  fi
}

echo "== gate ($MODE) =="

# ---- 静态层（秒级）----
run_step "py-compile"      python3 -m compileall -q scripts tests probe
if command -v node >/dev/null 2>&1; then
  run_step "js-check"      bash -c 'for f in dsh-plugin/lib/*.js dsh-plugin/web/panel.js; do node --check "$f" || exit 1; done'
else
  echo "SKIP  js-check（无 node）"
  NAMES+=("js-check"); RESULTS+=("SKIP")
fi
run_step "docs"            python3 scripts/verify_docs.py
run_step "contracts"       python3 tests/test_docs.py
run_step "secrets"         bash scripts/scan-secrets.sh

if [ "$MODE" = "full" ]; then
  # ---- 套件层（含插件测试，都在 tests/run_tests.py 里）----
  run_step "tests"         python3 tests/run_tests.py
fi

echo
echo "== 汇总 =="
for i in "${!NAMES[@]}"; do
  printf '%-6s %s\n' "${RESULTS[$i]}" "${NAMES[$i]}"
done
if $GATE_PASS; then
  echo "gate: 通过"
  exit 0
fi
echo "gate: 未通过（${DETAILS[*]:-}）——按上面各步输出修，不要 --no-verify 绕过"
exit 1
