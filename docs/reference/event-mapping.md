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

# 工具名归一化

DSH 前端按 **wire 工具名** 分类渲染工具卡片（`bash`/`skill`/`read`/`write`/`edit`/`grep`/`glob`/`web_fetch`/`web_search`…），名字对不上就落进通用 "Tool call" 卡片。Claude Code 内建工具名是 PascalCase（`Bash`、`Skill`、`Read`…），所以转写 `tool/call` 时做一次性映射（见 `lib/trace.mjs` 的 `TOOL_NAME_MAP`）：

| Claude Code 工具名 | DSH wire 工具名 |
|---|---|
| Bash | bash |
| Skill | skill |
| Read | read |
| Write | write |
| Edit / MultiEdit | edit |
| Glob | glob |
| Grep | grep |
| WebFetch | web_fetch |
| WebSearch / WebSearch2 | web_search |

不在表内的工具保持原名（走通用卡片）。此外 `Skill` 的入参由 Claude 的 `{ command }` 改写为 DSH skill 行读取的 `{ name }`（`TOOL_INPUT_REMAP`），否则 skill 卡片只能显示原始 JSON 而非 skill 名。

# step 边界

Claude Code 一次 API 轮（一个 assistant 消息）≈ DSH 一个 step（step/start → … → step/end）。

# 关键选项

- includePartialMessages: true 才有 token 级流式（默认关闭时只能看到完整消息）。
- 官方 dsh-subagent-claude-code 未开启该选项，故看不到流式。
