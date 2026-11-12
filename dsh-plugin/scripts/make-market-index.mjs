#!/usr/bin/env node
/**
 * 生成 DSH 插件市场索引（format 1）。
 *
 *   node scripts/make-market-index.mjs                  # git 源，commit 固定到当前 HEAD
 *   node scripts/make-market-index.mjs --source npm     # npm 源（发布到 registry 之后用）
 *   node scripts/make-market-index.mjs --out market/index.json
 *
 * 索引是纯静态 JSON：DSH 的「发现」页加它的 URL 就能装，不需要任何服务端。
 * 生成后如果本机装过 DSH，会用 DSH 自带的校验器（dsh-plugin-market-index）跑一遍，
 * 保证字段和规则跟宿主一致——索引格式的官方定义就是那个包里的验证器。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "..");
const REPO_DIR = resolve(PKG_DIR, "..");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SOURCE = arg("source", "git");
const OUT = resolve(PKG_DIR, arg("out", "market/index.json"));

const pkg = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
const git = (...a) => execFileSync("git", a, { cwd: REPO_DIR, encoding: "utf8" }).trim();

const commit = git("rev-parse", "HEAD");
const commitTime = Number(git("show", "-s", "--format=%ct", "HEAD"));
const repoSlug = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(pkg.repository.url);
if (!repoSlug) throw new Error(`repository.url 不是 GitHub 地址：${pkg.repository.url}`);
const [, owner, name] = repoSlug;
const repoUrl = `https://github.com/${owner}/${name}`;

/** 只有 <32KiB 的内联 data URL 图标才允许；这里画一个 64×64 的「收件箱」小图标。 */
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<rect width="64" height="64" rx="14" fill="#1f6f5c"/>
<path d="M14 32h10l4 7h8l4-7h10" fill="none" stroke="#f6f3ec" stroke-width="4"
  stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14 34V20a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v14" fill="none" stroke="#f6f3ec"
  stroke-width="4" stroke-linecap="round"/>
<path d="M14 34v10a4 4 0 0 0 4 4h28a4 4 0 0 0 4-4V34" fill="none" stroke="#f6f3ec"
  stroke-width="4" stroke-linecap="round"/>
</svg>`;
const icon = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG, "utf8").toString("base64")}`;

const source =
  SOURCE === "npm"
    ? { type: "npm" }
    : {
        type: "git",
        url: repoUrl,
        commit,
        // 包在仓库子目录里，pnpm 的 path: 参数就是这个相对目录
        ...(pkg.repository.directory ? { path: pkg.repository.directory } : {}),
      };

const index = {
  format: 1,
  title: { en: "cyber-im-avatar", "zh-cn": "赛博办公 IM 分身" },
  description: {
    en: "Open-source cyber office IM stand-in for DSH: watch Feishu / WeCom / DingTalk, wake the agent only when needed, and handle chats as you. Message bodies stay local.",
    "zh-cn": "开源赛博办公 IM 分身：在 DSH 里替你值守飞书 / 企业微信 / 钉钉，需要你时才唤醒 agent 并以本人身份处理；消息正文只留本机。",
  },
  metadata: {
    categories: {
      communication: { title: { en: "Communication", "zh-cn": "沟通协作" } },
    },
    labels: {
      "local-first": { title: { en: "Local first", "zh-cn": "数据留在本机" } },
      "needs-im-cli": { title: { en: "Needs IM CLI", "zh-cn": "需先登录 IM CLI" } },
    },
    sortKeys: {},
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: "IM Stand-in", "zh-cn": "IM 值守" },
      description: {
        en: "Sidebar stand-in for Feishu / WeCom / DingTalk: wakes the agent only when a chat needs attention, then lets it research and reply in your voice. Watch-level control, automatic triage for new groups, per-seat draft/auto send mode, and local-first message bodies.",
        "zh-cn":
          "在 DSH 侧边栏常驻的赛博办公 IM 分身：盯飞书 / 企业微信 / 钉钉的私聊与群聊，命中 @我 或新消息才唤醒 agent，由它按你的语气起草、调研并回复；支持关注程度三态、新群自动分诊、按值班单点切换草稿审批 / 全自动发送。消息正文只在本机，复用本机 IM CLI 登录态。",
      },
      icon,
      author: pkg.author,
      homepage: pkg.homepage,
      repository: { url: repoUrl, directory: pkg.repository.directory },
      metadata: {
        category: "communication",
        keywords: pkg.keywords,
        labels: ["local-first", "needs-im-cli"],
        sortKeys: {},
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: SOURCE === "npm" ? Math.floor(Date.now() / 1000) : commitTime,
          source,
          engines: pkg.engines?.dsh ? { dsh: pkg.engines.dsh } : {},
        },
      ],
    },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`wrote ${OUT}`);
console.log(`  ${pkg.name}@${pkg.version}  source=${SOURCE}${SOURCE === "git" ? ` commit=${commit.slice(0, 7)}` : ""}`);

// 用 DSH 自带校验器复核（格式的官方定义就是这个包，不是手写规则）
const candidates = [
  process.env.DSH_PLUGIN_MARKET_INDEX,
  join(homedir(), ".dsh/runtime/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js"),
].filter(Boolean);

const validator = candidates.find((p) => existsSync(p));
if (!validator) {
  console.log("  (未找到 DSH 校验器，跳过格式校验)");
} else {
  const { parseMarketIndex } = await import(pathToFileURL(validator).href);
  const url = `https://example.invalid/${pkg.name}/index.json`;
  const parsed = parseMarketIndex(JSON.parse(readFileSync(OUT, "utf8")), url);
  const v = parsed.plugins[0].versions[0];
  console.log(`  ✓ 通过 format-1 校验：${parsed.plugins[0].name}@${v.version} (${v.source.type})`);
  if (v.source.type === "git") console.log(`    安装 spec = git+${v.source.url}.git#${v.source.commit}&path:/${v.source.path}`);
  else console.log(`    安装 spec = ${parsed.plugins[0].name}@${v.version}`);
}
