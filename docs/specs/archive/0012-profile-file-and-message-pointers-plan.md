# 0012 画像文件与消息指针 — 实施计划

> 关联 spec：`docs/specs/archive/0012-profile-file-and-message-pointers.md`
> 原则：先存储层与接口，再面板；每步保持单测可跑。

## 1. 画像文件模块（targets.py）

- [x] 新增 `profiles/<platform>/<file_id>.md` 路径与模板；`file_id` 用 chat_id，
      无 chat_id 时用名称清洗 + 哈希。
- [x] `_ensure_profile()`：创建目录/文件、迁移旧 `profile` 笔记、写
      `env.json.profile_file` 并删除 `profile` 键。
- [x] `list_targets()` 返回 `profile` / `profile_path` / `profile_updated_at` /
      `profile_excerpt`；`chat` 合并逻辑不变。
- [x] `save_profile()`、`profile_for_chat()`、`upsert_target()` 走同一份路径逻辑。
- 验证：临时 `IM_STANDIN_DIR` 下建目标、写笔记、读画像、改画像；重复调用不重复迁移。

## 2. 消息指针（store.py）

- [x] `put_message()`：`fyi` / `out` 不存正文。
- [x] `set_state()` / `mark_replied_before()` / `set_blocked()` /
      `ignore_unwatched()`：标 `replied` / `ignored` 时清正文。
- [x] 新增 `trim_content()`；服务启动与每轮轮询结束时调用。
- [x] 保留指针行，不按时间删。
- 验证：新增/调整 `test_polling.py` 用例——待回保留正文、处理完为空、指针仍在。

## 3. 在线会话正文（poller / server）

- [x] `Poller.fetch_thread()` 直接读平台，不写库、不推水位；企微用 7 天窗口。
- [x] `poll_chat()` / `fetch_once()` 返回本次拉到的 `items`，供 `/api/thread` 复用。
- [x] `api_thread` 在线优先，失败回退 `store.thread()` 并带 `offline` / `error`。
- 验证：FakeAdapter 下打开会话拿到在线消息；让 fetch 失败后仍返回本地指针。

## 4. 接口与契约

- [x] `POST /api/targets/profile`；删除两条 note 路由。
- [x] `/api/targets` 新字段；`/api/thread` 语义更新。
- [x] 同步 `docs/specs/contracts/01-api.md`、`02-storage.md`、
      `docs/architecture/02-data.md`。
- 验证：`tests/test_docs.py` 路由对账；`rpc.py /api/targets` 能看到画像字段。

## 5. 唤醒与 skill

- [x] `turns.build_prompt()` 增加画像路径与「只读画像、不记聊天原文」提示；
      `_spawn` 调 `targets.profile_for_chat()`。
- [x] `SKILL.md` 起草步骤从 `env.json profile` 改为画像文件；记忆段写清新位置。
- [x] `bootstrap.py --note` 追加到画像文件；`--delete-data` 删除 `profiles/`。
- 验证：`test_turns` 的 prompt 含画像路径；手工跑 `bootstrap.py --note` 后文件有内容。

## 6. 面板

- [x] 服务对象卡片改为画像浏览 + 编辑（textarea + 保存），去掉笔记列表、
      笔记输入框、删除按钮与「打会话」。
- [x] 「分身」页与收件箱详情的 `notes` 引用改为画像摘要 / 「看画像」入口。
- [x] 收件箱预览遇到空正文显示「历史消息，点开在线查看」。
- [x] `python3 scripts/build_client.py` 重建 `lib/client.js`。
- 验证：`node --check`、gate 构建产物对账；3080 面板点一遍。

## 7. 收尾

- [x] `CHANGELOG.md` 0.8.0 补一条。
- [x] `PROGRESS.md` 断点 + `docs/implementation/log/2026-11-02.md`。
- [x] `python3 -m unittest discover -s tests`、`python3 tests/run_tests.py`、
      `bash scripts/gate.sh --quick` 全绿。
