/**
 * 把 skill 装到 DSH 会扫描的 `~/.agents/skills/cyber-im-avatar/`。
 *
 * 插件驱动会话靠 `/cyber-im-avatar` 自动注入 skill；用户不必再单独 clone 一份。
 * 只安装“不存在”或“由本插件管理”的目录：已有手装副本不覆盖，只打一行日志。
 * 发布包里的 `skill/` 由 scripts/bundle-skill.mjs 在 prepack 生成；本地 link
 * 安装则直接读仓库根目录的 SKILL.md / references / scripts。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..");
const SKILL = "cyber-im-avatar";
const MARK = ".installed-by-dsh-cyber-im-avatar.json";
const SKIP = /__pycache__|\.pyc$|\.DS_Store$/;
const SCRIPTS = [
  "bootstrap.py", "data_guard.py", "doctor.py", "reauth.py", "listen_core.py",
  "feishu_listen_cli.py", "wecom_listen_cli.py", "dingtalk_listen_cli.py",
];

function version() {
  try {
    return JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8")).version || "0";
  } catch (e) {
    return "0";
  }
}

function source() {
  const bundled = join(PLUGIN_ROOT, "skill");
  if (existsSync(join(bundled, "SKILL.md"))) return { kind: "bundled", dir: bundled };
  if (existsSync(join(REPO_ROOT, "SKILL.md")) && existsSync(join(REPO_ROOT, "references"))) {
    return { kind: "repo", dir: REPO_ROOT };
  }
  return null;
}

function copyInto(src, dest) {
  if (src.kind === "bundled") {
    cpSync(src.dir, dest, { recursive: true, filter: (p) => !SKIP.test(p) });
    return;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(join(src.dir, "SKILL.md"), join(dest, "SKILL.md"));
  cpSync(join(src.dir, "references"), join(dest, "references"),
         { recursive: true, filter: (p) => !SKIP.test(p) });
  mkdirSync(join(dest, "scripts"), { recursive: true });
  for (const name of SCRIPTS) {
    const from = join(src.dir, "scripts", name);
    if (existsSync(from)) cpSync(from, join(dest, "scripts", name));
  }
}

/** @returns {"current"|"installed"|"existing"|"missing-source"} */
export function ensureSkill(log = console) {
  const src = source();
  if (!src) {
    (log.warn || log.log).call(log, "[im-standin] skill source not found; skip skill install");
    return "missing-source";
  }
  const agentsHome = process.env.DSH_AGENTS_HOME || join(homedir(), ".agents");
  const target = join(agentsHome, "skills", SKILL);
  const marker = join(target, MARK);
  const v = version();
  if (existsSync(target)) {
    if (!existsSync(marker)) {
      (log.info || log.log).call(log,
        `[im-standin] skill already installed at ${target} (not managed); leave it`);
      return "existing";
    }
    try {
      if (JSON.parse(readFileSync(marker, "utf8")).version === v) return "current";
    } catch (e) { /* 坏标记按受管旧版处理，重装 */ }
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    copyInto(src, tmp);
    writeFileSync(join(tmp, MARK), JSON.stringify({
      name: SKILL, version: v, source: src.kind, installed_at: new Date().toISOString(),
    }, null, 1));
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(tmp, target);
    (log.info || log.log).call(log, `[im-standin] skill installed -> ${target} (${v}, ${src.kind})`);
    return "installed";
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
