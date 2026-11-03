/**
 * 把 skill 装到 DSH 会扫描的 `~/.agents/skills/cyber-im-avatar/`。
 *
 * 插件驱动会话靠 `/cyber-im-avatar` 自动注入 skill；用户不必再单独 clone 一份。
 * 只安装“不存在”或“由本插件管理”的目录：已有手装副本不覆盖，只打一行日志。
 * 发布包里的 `skill/` 由 scripts/bundle-skill.mjs 在 prepack 生成；本地 link
 * 安装则直接读仓库根目录的 SKILL.md / references / scripts。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
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

function sourceFiles(src) {
  const out = [];
  const walk = (root, dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (SKIP.test(p)) continue;
      if (ent.isDirectory()) walk(root, p);
      else if (ent.isFile()) out.push({ file: p, rel: relative(root, p) });
    }
  };
  if (src.kind === "bundled") {
    walk(src.dir, src.dir);
    return out;
  }
  const skill = join(src.dir, "SKILL.md");
  if (existsSync(skill)) out.push({ file: skill, rel: "SKILL.md" });
  walk(src.dir, join(src.dir, "references"));
  for (const name of SCRIPTS) {
    const p = join(src.dir, "scripts", name);
    if (existsSync(p)) out.push({ file: p, rel: `scripts/${name}` });
  }
  return out;
}

/** 内容指纹：版本号不变但 SKILL.md/references/scripts 变了，也要重装受管副本。 */
function contentHash(src) {
  const h = createHash("sha256");
  const files = sourceFiles(src).sort((a, b) => a.rel.localeCompare(b.rel));
  for (const item of files) {
    h.update(item.rel);
    h.update("\0");
    try {
      if (statSync(item.file).isFile()) h.update(readFileSync(item.file));
    } catch { /* 文件在扫描后消失：跳过，下次装 */ }
    h.update("\0");
  }
  return h.digest("hex");
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
  const hash = contentHash(src);
  if (existsSync(target)) {
    if (!existsSync(marker)) {
      (log.info || log.log).call(log,
        `[im-standin] skill already installed at ${target} (not managed); leave it`);
      return "existing";
    }
    try {
      const old = JSON.parse(readFileSync(marker, "utf8"));
      if (old.version === v && old.content_hash === hash) return "current";
    } catch (e) { /* 坏标记按受管旧版处理，重装 */ }
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    copyInto(src, tmp);
    writeFileSync(join(tmp, MARK), JSON.stringify({
      name: SKILL, version: v, content_hash: hash, source: src.kind,
      installed_at: new Date().toISOString(),
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
