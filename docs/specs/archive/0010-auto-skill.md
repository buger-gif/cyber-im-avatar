# 0010 自动装 skill + 唤醒自动注入

> 状态: 实施中
> 编号: 0010
> 版本: 0.8.0
> 关联: `docs/specs/archive/0009-shell-sandbox-fixes.md`、`SKILL.md`

## 背景

唤醒 prompt 之前把 skill 的闭环、平台文档路径、五条铁律整段抄了一遍：
既难看，又和 skill 本体漂移；装了插件还要用户自己把 skill clone 到
`~/.agents/skills/` 才能跑。

DSH 本身有 skill 机制：

- `dsh-skill-filesystem` 扫描 `~/.agents/skills/<name>/SKILL.md`，自动进会话目录；
- `dsh-tool-skill` 在任务文本里识别 `/name`，把该 skill 的完整正文注入这一步，
  不需要模型再调 `skill` 工具；
- 没有 `/name` 时，模型也能从目录里按名字加载。

所以正确分工：**插件装 skill，并把 `/cyber-im-avatar` 放进任务文本**；prompt 只留
命中载荷，skill 负责闭环、平台差异、铁律。

## 目标与非目标

- 目标：
  - 插件首次启动把 skill 装到 `~/.agents/skills/cyber-im-avatar/`；
  - 发布包自带 skill 副本（prepack 生成），本地 link 安装读仓库根目录；
  - 唤醒任务以 `/cyber-im-avatar` 开头，prompt 只剩命中载荷 + 一句壳内说明；
  - 已有手装 skill 不覆盖（无插件标记时只提示）。
- 非目标：
  - 不把 skill 做成内存注册（references/scripts 需要真实文件路径）；
  - 不覆盖用户改过的 skill；不删除旧目录；
  - 不改 DSH 的 skill 发现逻辑；
  - 不改值守节奏、发送确认与铁律。

## 方案

### 1. 安装

`lib/skill-install.js`：

- 源：优先 `dsh-plugin/skill/`（npm prepack 生成），否则仓库根目录
  `SKILL.md + references/ + scripts/*.py`（link/开发形态）；
- 目标：`$DSH_AGENTS_HOME`（默认 `~/.agents`）/`skills/cyber-im-avatar`；
- 目标不存在 → 复制并写 `.installed-by-dsh-cyber-im-avatar.json`（版本/来源/时间）；
- 目标存在且有本插件标记 → 版本不同才更新；
- 目标存在但无标记（用户手装）→ **不动**，日志说明；
- 在宿主半 `apply()` 首次启动时执行，失败只 warn，不影响服务。

`scripts/bundle-skill.mjs` 在 `prepack` 时把 SKILL.md、references、运行脚本复制到
`dsh-plugin/skill/`；`files` 加 `skill`，`.gitignore` 排除生成目录。

### 2. 自动注入

`build_prompt` 改为：

```
/cyber-im-avatar

值守命中 · 飞书 · 示例对象 A
chat_id：oc_…
新消息：
- [时间] 发送者: 正文

按 skill 处理这通会话。监听、水位、唤醒由插件负责，不要挂监听。
```

`/cyber-im-avatar` 由 DSH 的 user-invocation 注入 skill 正文；agent 不再需要
读路径、拼铁律。`IM_STANDIN_SHELL=1` 仍在环境里，skill 的壳内分支据此跳过监听。

## 取舍

| 备选 | 否掉的理由 |
| --- | --- |
| 用 `ctx.skills.register` 内存注册 | skill 的 references/scripts 是真实文件，内存注册拿不到资源目录 |
| 继续在 prompt 里抄铁律/路径 | 与 skill 漂移，且每次唤醒重复几百字 |
| 覆盖 `~/.agents/skills/cyber-im-avatar` 的所有旧副本 | 用户可能手改过；只接管无标记/自己装的那份 |
| 让 agent 每次先调 `skill` 工具 | 多一步工具调用；`/name` 是 DSH 原生注入，更短更稳 |

## 影响面

- 新增 `lib/skill-install.js`、`scripts/bundle-skill.mjs`；
- `lib/index.js`：`apply()` 调 `ensureSkill`；
- `service/turns.py`：prompt 缩减、以 `/cyber-im-avatar` 开头；
- `SKILL.md`：壳内分支（已在 0009 加，保留）；
- `package.json` / `.gitignore` / README / CHANGELOG / PROGRESS / log。

## 验收

- [x] 空 `DSH_AGENTS_HOME` 启动 → skill 装好，第二次启动返回 current；
- [x] 已有手装 skill（无标记）→ 不覆盖，日志提示；
- [x] npm pack 包内包含 `skill/SKILL.md`、references、scripts；
- [x] 唤醒 prompt 首行 `/cyber-im-avatar`，不再含 SKILL.md 路径/铁律长文；
- [x] headless 探针 `printf '/cyber-im-avatar\\n\\n只回复 OK' | dsh headless --json -`
      输入 token 明显包含 skill 正文（实测 13.3k），回复 OK；
- [x] 测试全过 + gate 全绿；
- [ ] 下一条真实命中经插件唤醒 → 任务以 `/cyber-im-avatar` 开头、skill 正文注入、
      不尝试挂监听。

## 风险与回滚

- `/cyber-im-avatar` 在旧 DSH 上可能不触发注入；此时 skill 仍在目录里，模型可按
  目录加载，只是多一步工具调用。
- 自动安装写 `~/.agents/skills`（用户明确要求）：只在缺失或本插件管理时写；
  手装副本不动。
- 回滚：删掉 `ensureSkill` 调用与 prompt 首行即可；已安装的 skill 可手动删。
