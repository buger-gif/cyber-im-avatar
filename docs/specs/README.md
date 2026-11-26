# spec 流程

> 从 0.6.0 起，**所有非平凡改动先写 spec 再动手**。这里定义编号、目录、流转与数量上限。
> 「什么算非平凡」与写作纪律见 `docs/AGENTS.md §4`。

## 三个位置

| 目录 | 放什么 | 生命周期 |
| --- | --- | --- |
| `docs/specs/active/` | 在办 spec（必要时加 plan），**至多 2 项** | 实现完成即 `git mv` 走 |
| `docs/specs/archive/` | 已实现并归档的 spec，按编号排 | 冻结，只读 |
| `docs/specs/contracts/` | 接口 / 表 / 配置的冻结形状 | 活文档，被测试对账 |

## 编号与命名

- 四位递增，**永不复用**：`0001`、`0002`……
- 文件名 `NNNN-短名.md`（中文短名可以，别超过 12 个字）。
- 默认只写这一份。只有「要跨多个提交 / 有存量迁移 / 做法没定要先探路」才另开
  `NNNN-短名-plan.md`，按「一步一验证」拆成可勾选步骤；其余把 3–6 步写在 spec 的
  「方案」末尾，不重复成两个文件。
- 下一个号写在下面这一行，由 `scripts/verify_docs.py` 校验：编号不能跳、不能重、不能和下一个号撞。

**下一个号：0064**

## 流转

```
想法
 ├─ 写 docs/specs/active/NNNN-短名.md（用 docs/specs/_template.md）
 ├─ 要跨提交 / 要探路？── 是 ──▶ 同编号再写 -plan.md
 │                       └─ 否 ──▶ 3–6 步写进 spec，不另开文件
 ├─ 实施（代码 + 同 commit 改 contracts / architecture）
 ├─ 实现完成 + 自动测试绿 ──▶ git mv 到 archive，登记一行
 │                            真机项写进 PROGRESS 挂账，不在 active 里等
 └─ 发版前：active 里不该再有已实现的 spec（版本闸会拦）
```

## active 上限与清理

- **至多 2 项**（`NNNN-短名.md` 与它的 `-plan.md` 算一项）。`scripts/verify_docs.py` 直接拦：
  - 超过 2 项 → 先归档再开新的；
  - active 里出现 `已验收` / `已放弃` → 搬 archive；
  - 目标版本 ≤ `dsh-plugin/package.json` 的版本 → 已经发了，归档或把版本抬到下一个；
  - 有 `-plan.md` 却没有同名 spec → 删 plan 或补 spec。
- 满了按顺序清：**归档**（做完了）→ **放弃**（不再做，状态写 `已放弃`）→ **合并**
  （并进在办 spec 的「影响面」）→ **降级为挂账**（只是一条待办，写进 `PROGRESS.md`）。
- 真机项不占 active：写进 `docs/implementation/PROGRESS.md` 的挂账，验完划掉；
  验出问题再按新 spec 开。

## 什么必须进 spec

| 触发 | 举例 |
| --- | --- |
| 新增 / 改动接口或路由 | 加 `/api/chat/block` |
| 表结构、配置键变化 | 加 `chats.blocked`、`poll.dm_scope` |
| 用户可见交互变化 | 收件箱改成按会话聚合 |
| 跨两个以上文件的改动 | 轮询节奏重做 |
| 有被否掉的备选方案 | 「为什么不再开一个本地端口」 |

不用写 spec 的：错别字、样式数值、注释、单文件内部重构（但要进当日 log）。

## 已归档

见 `docs/specs/archive/README.md` 的登记表（编号、落地版本、一句话结论都在那里）。
0001 之前的改动只在 `CHANGELOG.md` 与 git 历史里，不回溯补写。

## 为什么不在 issue 里写

这个项目只有一个开发者加若干 AI 会话，没有共享的 issue 面板。spec 放在仓库里才能：
跟代码同一次 commit、被 `git log --follow` 追溯、被下一个会话直接读到、被 gate 校验。
