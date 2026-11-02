# 0010 自动装 skill + 唤醒自动注入 · 实施计划

1. **安装器**：`lib/skill-install.js`（bundled/repo 源、marker、不覆盖手装）；
   `lib/index.js` apply 调用；临时 `DSH_AGENTS_HOME` 验证 install/current。
2. **打包**：`scripts/bundle-skill.mjs` + `prepack` + `files` + `.gitignore`；
   `npm pack --dry-run` 确认 `skill/` 在包里。
3. **Prompt**：`build_prompt` 以 `/cyber-im-avatar` 开头，只留命中载荷 +
   壳内不挂监听；更新测试断言。
4. **注入探针**：headless 跑 `/cyber-im-avatar` + 只回复 OK，确认 skill 正文被注入。
5. **文档**：spec 归档、README/CHANGELOG/PROGRESS/log；测试 + gate。

回滚：删 apply 调用与 prompt 首行；已装 skill 保留可用。
