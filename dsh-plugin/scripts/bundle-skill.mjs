/**
 * 把仓库根目录的 skill 打包进插件 npm 包（prepack 时跑）。
 * 只带 SKILL.md、references/ 和运行时要用的 Python 脚本，不带仓库自己的
 * gate/verify_docs/tests。产物 dsh-plugin/skill/ 不进 git（见 .gitignore）。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const OUT = resolve(HERE, "..", "skill");
const SCRIPTS = [
  "bootstrap.py", "data_guard.py", "doctor.py", "reauth.py", "listen_core.py",
  "feishu_listen_cli.py", "wecom_listen_cli.py", "dingtalk_listen_cli.py",
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "scripts"), { recursive: true });
cpSync(join(ROOT, "SKILL.md"), join(OUT, "SKILL.md"));
cpSync(join(ROOT, "references"), join(OUT, "references"), {
  recursive: true,
  filter: (p) => !/__pycache__|\.pyc$|\.DS_Store$/.test(p),
});
for (const name of SCRIPTS) {
  const from = join(ROOT, "scripts", name);
  if (existsSync(from)) cpSync(from, join(OUT, "scripts", name));
}
console.log("bundled skill ->", OUT);
