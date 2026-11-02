#!/usr/bin/env bash
# scan-secrets.sh — 密钥扫描：tracked 文件里不许出现真实凭据形状。
# 规则刻意「宁漏勿误」的程度：只抓高置信度的 token 形状；误报改这里。
set -u
cd "$(dirname "$0")/.."

PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'AKIA[0-9A-Z]{16}'
  'xox[bap]-[A-Za-z0-9-]{10,}'
  'npm_[A-Za-z0-9]{30,}'
  'BEGIN [A-Z ]*PRIVATE KEY'
)

hits=$(git ls-files -z | xargs -0 grep -nE -i "$(IFS='|'; echo "${PATTERNS[*]}")" 2>/dev/null \
  | grep -v 'scan-secrets.sh' || true)

if [ -n "$hits" ]; then
  echo "发现疑似凭据（确认是误报就改 scan-secrets.sh 的规则）："
  printf '%s\n' "$hits" | head -20
  exit 1
fi
echo "secrets: 干净"
