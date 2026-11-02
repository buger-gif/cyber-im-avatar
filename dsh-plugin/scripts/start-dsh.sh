#!/usr/bin/env bash
# 以「脱离当前 shell 会话」的方式启动 DSH web：关掉终端 DSH 也不退；
# 启动时清掉代理变量与 NODE_OPTIONS 注入项。token 落到 ~/.dsh/web-token。
#
#   ./scripts/start-dsh.sh            启动（已在跑则只打印地址）
#   ./scripts/start-dsh.sh --restart  先停再起
set -euo pipefail

RUNTIME="${DSH_RUNTIME:-$HOME/.dsh/runtime}"
LOG="${DSH_LOG:-$HOME/.dsh/web.log}"
TOKEN_FILE="$HOME/.dsh/web-token"

if lsof -nP -iTCP:3080 -sTCP:LISTEN >/dev/null 2>&1; then
  if [ "${1:-}" != "--restart" ]; then
    echo "DSH 已在 3080 运行："
    [ -f "$TOKEN_FILE" ] && echo "http://127.0.0.1:3080/?token=$(cat "$TOKEN_FILE")"
    exit 0
  fi
  echo "停止现有实例…"
  for p in $(lsof -ti:3080); do kill "$p" 2>/dev/null || true; done
  sleep 2
fi

DSH_RUNTIME="$RUNTIME" DSH_LOG="$LOG" DSH_TOKEN_FILE="$TOKEN_FILE" python3 - <<'PY'
import os, re, subprocess, sys, time

runtime = os.environ["DSH_RUNTIME"]
log_path = os.environ["DSH_LOG"]
token_file = os.environ["DSH_TOKEN_FILE"]
entry = os.path.join(runtime, "node_modules/@deepseek-ai/dsh/lib/bin.js")

if not os.path.exists(entry):
    sys.exit(f"找不到 DSH 入口：{entry}\n先装运行时：npm i @deepseek-ai/dsh --prefix {runtime}")

drop = {"NODE_OPTIONS", "PYTHONPATH", "PYTHONIOENCODING", "PYTHONUTF8",
        "PYTHONDONTWRITEBYTECODE", "BASH_ENV", "HTTP_PROXY", "HTTPS_PROXY",
        "http_proxy", "https_proxy"}
env = {k: v for k, v in os.environ.items() if k not in drop}

log = open(log_path, "w")
proc = subprocess.Popen(
    ["node", entry, "web", "--no-open"],
    cwd=runtime, env=env,
    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
    start_new_session=True,
)

# 等它把地址与 token 打出来
token = ""
for _ in range(40):
    time.sleep(0.5)
    if proc.poll() is not None:
        print(open(log_path).read().strip(), file=sys.stderr)
        sys.exit(f"DSH 启动失败，退出码 {proc.returncode}")
    try:
        text = open(log_path).read()
    except OSError:
        continue
    found = re.search(r"token=([A-Za-z0-9_-]+)", text)
    if found:
        token = found.group(1)
        break

if token:
    with open(token_file, "w") as fh:
        fh.write(token + "\n")
    os.chmod(token_file, 0o600)
    print(f"pid {proc.pid}")
    print(f"http://127.0.0.1:3080/?token={token}")
    print(f"token 存到 {token_file}（600）")
else:
    print(f"pid {proc.pid}，但没抓到 token；看 {log_path}", file=sys.stderr)
    sys.exit(1)
PY
