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

    node --test test/trace.test.mjs

# 语法检查

    for f in index.mjs lib/*.mjs; do node --check $f; done

# 目录结构

- index.mjs —— 插件入口（工厂替换）
- lib/agent.mjs —— ClaudeCodeAgent（Agent 接口 + Claude 驱动）
- lib/driver.mjs —— Claude Code query() 生命周期
- lib/trace.mjs —— SDK 事件 → DSH 会话事件映射（纯函数）
- lib/approval.mjs —— 审批桥
- lib/auth.mjs —— 可执行解析 + env 合成
- test/trace.test.mjs —— 映射单测
