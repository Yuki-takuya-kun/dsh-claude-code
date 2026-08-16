---
type: Guide
title: 开发
description: 本地开发、测试与构建步骤。
tags: [development, testing]
timestamp: 2026-08-14
---

# 本地链接依赖

项目 node_modules 里对 @deepseek-ai 与 @anthropic-ai 做了符号链接（指向 profile 的 node_modules），用于本地 import/单测。这些链接在 .gitignore 中忽略。

# 运行单测

    node --test test/*.test.mjs

# 语法检查

    for f in index.mjs lib/*.mjs; do node --check $f; done

# 目录结构

- index.mjs —— 插件入口（注册 `claude-code` 引擎到 `ctx.engineSwitch`）
- lib/agent.mjs —— ClaudeCodeAgent（Agent 接口 + Claude 驱动）
- lib/driver.mjs —— Claude Code query() 生命周期
- lib/trace.mjs —— SDK 事件 → DSH 会话事件映射（纯函数）
- lib/approval.mjs —— canUseTool 桥（审批 seam + AskUserQuestion 选择题）
- lib/permission.mjs —— DSH 权限（sandbox/mode + approval/policy）→ canUseTool 策略（纯函数）
- lib/dialog.mjs —— request_user_dialog 桥（onUserDialog，候选路径）
- lib/store.mjs —— Claude 会话 id 旁路持久化
- lib/auth.mjs —— 可执行解析 + env 合成
- test/trace.test.mjs、test/permission.test.mjs —— 映射/权限单测
