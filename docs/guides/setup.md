---
type: Guide
title: 安装与启用
description: 安装、启用、切回 DeepSeek 的步骤。
tags: [setup, install]
timestamp: 2026-08-14
---

# 前置

- pnpm 在 PATH 上
- 本机有可用的 claude CLI（已安装并登录），或 ANTHROPIC_API_KEY

# 安装

    dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code

# 启用

编辑 ~/.dsh/profiles/web/cordis.patch.yml：

    - id: dsh-claude-code
      config:
        enabled: true

重启 web 应用。预设列表会新增「Claude Code」预设（插件写到 ~/.dsh/.agent-presets/claude-code/）。

# 切回 DeepSeek

- 全部切回：把 enabled 改成 false，重启（插件完全不介入；已写入的 claude-code 预设会保留，但选中它也走 DeepSeek）。
- 彻底删掉「Claude Code」预设：`rm -rf ~/.dsh/.agent-presets/claude-code/`

# 验证

在预设列表选「Claude Code」新建会话发消息：轨迹视图应出现 Claude Code 的工具调用/结果实时流式。工具名为 Bash/Edit/Read（Claude Code），而非 bash/read/write（DSH）；选其它预设（如标准/极简）应是 DSH 工具。
