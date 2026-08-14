---
type: Reference
title: SDK 事件映射
description: Claude Agent SDK 事件到 DSH 会话事件的映射表。
resource: lib/trace.mjs
tags: [event-mapping, trajectory, sdk]
timestamp: 2026-08-14
---

# 映射表

| Claude SDK 事件/块 | DSH 会话事件 |
|---|---|
| system/init | request/header + turn/start（由上层 agent 处理） |
| stream_event · content_block_delta(text) | assistant/chunk (text-delta) |
| stream_event · content_block_delta(thinking) | assistant/chunk (reasoning-delta) |
| stream_event · content_block_delta(input_json) | assistant/chunk (tool-call-delta) |
| assistant（完整一轮） | assistant/message |
| assistant 内 tool_use 块 | tool/call |
| user 内 tool_result 块 | tool/result |
| result · success | turn/end (completed) |
| result · error | turn/end (error) |

# step 边界

Claude Code 一次 API 轮（一个 assistant 消息）≈ DSH 一个 step（step/start → … → step/end）。

# 关键选项

- includePartialMessages: true 才有 token 级流式（默认关闭时只能看到完整消息）。
- 官方 dsh-subagent-claude-code 未开启该选项，故看不到流式。
