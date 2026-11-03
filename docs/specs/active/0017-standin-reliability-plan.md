# 0017 实施计划

> 一步一验证；每步完成后勾掉再进下一步。P0 先行，富媒体交付随后，最后清理文档。

## Phase 1 · 水位与身份（P0）

1. [ ] 契约 02：`chats` 增加 `last_msg_id`；`recent` 增加 `msg_type` / `app_link` /
   `media_id` / `media_paths`，写默认值与迁移口径。
2. [ ] `state.js`：`normalizeChat()` 接受新字段并补默认；`mergeRecent()` 不丢新字段；
   测试老 state 缺字段仍能加载。
3. [ ] `poller.js`：`process()` 改为按 `last_msg_id` 收口（最新在前遇到水位停止），
   水位掉出窗口时回退 `ts_epoch > last_epoch`；写回 `last_msg_id`。
4. [ ] `poller.js`：`cycle()` 在
   `whoami.ok === false` 或 `self_id` 为空时跳过该平台并记错；`whoami()` 失败不永久缓存。
5. [ ] 测试：同秒两条消息只唤醒一次；`whoami` 失败 + 本人消息不唤醒；恢复授权后恢复；
   `node --test` 全过。

## Phase 2 · @ 判定与提示词安全（P0/P1）

6. [ ] `im.js`：`isMention()` 按“有 mentions 只认 ID；无 mentions 才用精确名字/token”
   改写；补“@张三丰不唤醒张三”“mentions 指向别人不唤醒”测试。
7. [ ] `turns.js`：新增 `sanitizeUntrusted()`；`buildPrompt()` / `buildDeltaPrompt()`
   对 `chatName`、`sender_name`、`content` 做**手势形 `/name`** 与 `<!--` 转义，普通
   URL/路径不动；首行 `/cyber-im-avatar` 不转义。
8. [ ] 测试：客户正文含 ` /lark-doc`、`<!-- im-profile-update` 时 prompt 不产生可触发形状；
   正常 `@`、中文、换行仍可读；`node --test` 全过。

## Phase 3 · 富媒体取回与交付（P1）

9. [ ] `state.js` / 契约 02：`recent` 的 `msg_type`、`app_link`、`media_id`、
   `media_paths` 落库；老消息缺字段按默认；`media_paths` 只存插件生成的绝对路径。
10. [ ] 新增 `lib/media.js`：媒体目录 `~/.im-standin/media/<platform>/<chat>/<msg>/`、
    安全文件名、700/600、7 天/200MB 清理、失效路径回写。
11. [ ] `im.js`：新增 `MEDIA_ADAPTERS` 与 `downloadMedia(platform, chat_id, message)`：
    飞书解析 `[image: ...]` / `[file: name]` + `key` / post 内嵌图片，走
    `+messages-resources-download`；`--output` 的 cwd/根限制用子进程 cwd 或 `/tmp`+move
    规避；企微走 `wecom-cli media`；不可用返回未适配。
12. [ ] `turns.js`：只在 `Turns.wake` 确定本次载荷消息后下载媒体；加 4 张/10MB/
    20 秒上限；已有 `media_paths` 且文件在则复用；失败降级不阻断。
13. [ ] `turns.js`：`makeUserMessage` 改异步；通过注入的 `attachments.admitPromptContent`
    把图片转成 `image` block；检查 `llm.resolveModelInfo(...).inputModalities`，
    不支持/服务缺失/超限时降级为文本+本地路径。
14. [ ] `index.js`：`ctx.inject(["attachments"])` / `["llm"]`，接到 `Turns.setHost()`；
    旧 DSH 缺失时保持文本+路径。
15. [ ] `turns.js`：prompt 形状按 spec §4.5：已附带图片、文件路径、sticker、
    未适配/下载失败分别标注；固定说明“只有标未适配/失败的才走 CLI”。
16. [ ] `SKILL.md` DSH 壳章节增加“富媒体”小节；`references/feishu.md` 补
    `+messages-resources-download` / `--download-resources`；`references/wecom.md`
    补 `wecom-cli media` 与失败兜底；`references/dingtalk.md` 标插件壳不支持。
17. [ ] `panel.js`：`msgText()` 媒体标签；有 `app_link` 时“在飞书打开”，没有时
    “在 IM 客户端查看/已在会话中附带”；重建 `lib/client.js`。
18. [ ] 测试/走查：飞书 image 的 user message 有 `image` block + 本地路径；
    post 两张图按上限 attach；file 有路径；interactive 标未适配；下载失败/模型不支持
    时降级；定时/点开/fyi/out 不下载；媒体目录 700/600 与清理；`node --test` 全过。

## Phase 4 · 调度语义与平台边界（P1）

19. [ ] `app.js` / `poller.js`：`/api/thread` 传 `wake:false`；`pollChat()` 增加 `wake`
    选项；点开只读、不唤醒；`/api/chat/wake` 保持显式唤醒。
20. [ ] 冷却：手动 `/api/poll` 不再用 `force` 绕过 `cooldown_sec`；点开在冷却中直接
    返回 `skipped`，不再回退 `fetchThread()`；post-turn 补拉保留例外。
21. [ ] 契约 01/03：写清 `/api/thread` 只读、`/api/poll` 受冷却、post-turn 例外。
22. [ ] 平台：插件 `platforms` 白名单只允许 `feishu` / `wecom`；存量 `dingtalk`
    保留但不拉取，状态页标“不支持”；面板删除钉钉入口/标签。
23. [ ] 企微群：搜索卡片增加“显示名 + 会话 ID + 私聊/群”表单，走 `/api/watch`；
    显示名只用于面板。
24. [ ] 配置：`refreshChatlist()` 的 `--page-size` 夹 100；`fetchThread()` 的 `limit`
    夹 50；企微客户端侧截断；`backfill_hours` 接企微 `fetchThread()`（上限 7 天）。
25. [ ] 设置页删除“定时拉哪些私聊”控件；契约 03 标 `dm_scope` legacy no-op；
    收件箱删除“客服”筛选；重建 `lib/client.js`。
26. [ ] 测试：thread 不唤醒、手动冷却、`dm_recent=200` 实际 100、`limit=100` 实际 50、
    企微群加入、dingtalk 被拒；`node --test` 全过。

## Phase 5 · 清理与收尾

27. [ ] `skill-install.js`：marker 增加 `content_hash`，版本相同但内容变化时重装受管副本；
    手装无 marker 目录仍不覆盖。
28. [ ] `SKILL.md` / `references/troubleshooting.md`：壳内不要跑 `doctor.py`（会写
    `~/.im-standin/states`），改用面板体检或只读 CLI 命令。
29. [ ] 清理 `postTurn` / `retry` 死参数、`service` 残留、`doctor` 的“私聊 N 个”文案；
    能删的删，不能删的写注释。
30. [ ] 文档：`docs/architecture/02-data.md`、`03-runtime.md`、`dsh-plugin/README.md`、
    `README.md`、`CHANGELOG.md`（发版时）、`PROGRESS.md`、当日 log；跑
    `bash scripts/gate.sh --quick`，发版前跑全量。
