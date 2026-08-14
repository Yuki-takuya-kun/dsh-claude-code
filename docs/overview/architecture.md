---
type: Architecture
title: 架构
description: 工厂槽位替换 + ClaudeCodeAgent 驱动 + SDK 事件到 DSH 会话事件的实时映射。
resource: index.mjs
tags: [architecture, factory, trajectory, agent]
timestamp: 2026-08-14
---

# 数据流

用户消息 → session.prompt → ctx.agents.get(sessionId) → ClaudeCodeAgent → Claude Code query() → SDK 事件 → trace.mjs 映射 → DSH 会话事件 → 轨迹视图实时渲染

# 关键机制

- 工厂槽位替换：apply() 里把 ctx.agents.factory 替换成 ClaudeCodeFactory。
- ClaudeCodeAgent：实现 dsh-agent 公开 Agent 接口（Inbox、状态、取消），每轮跑 Claude Code。
- 轨迹透传（lib/trace.mjs）：ClaudeRunTracer 把 SDK 消息流映射成 DSH 会话事件。
- 审批桥（lib/approval.mjs）：canUseTool → ctx.userQuestions.ask。
- 双通道认证（lib/auth.mjs）：原生 claude 登录 + ANTHROPIC_API_KEY。

# 事件映射

详见 [Event mapping](/reference/event-mapping.md)。

# 已知限制

- 恢复（resume）的会话回落到 DeepSeek 循环（v1）。
- 每会话驱动在 agent 创建时定死，无法在运行中切换（DSH 预设 recompose 只换工具、不换驱动）。
