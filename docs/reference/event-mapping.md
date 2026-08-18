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
| stream_event · message_start | 记录主模型 + 输入侧 usage（input/cache） |
| stream_event · message_delta | 定稿输出 usage |
| assistant（完整一轮） | assistant/message（含该步 usage） |
| assistant 内 tool_use 块 | tool/call |
| user 内 tool_result 块 | tool/result |
| result · modelUsage | request/context（provider/model/contextWindow） |
| result · success | turn/end (completed) |
| result · error | turn/end (error) |

# 上下文长度监控

DSH 原生靠 `ctx.tokenMeter` 从会话日志折叠出 `tokenUsage` / `contextPressure` 投影，Web 界面据此显示上下文占用比例（`projectedTokens / contextWindow`）。dsh-claude-code 的驱动换成了 Claude Code，不经过 `ctx.llm.stream()`，所以由 `lib/trace.mjs` 把 Claude SDK 的用量信息补进同一批会话事件：

- **用量（分子）**：优先用 `message_start`（输入侧 `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`）与 `message_delta`（定稿 `output_tokens`）合成每步的 DSH `TokenUsage`（`cache_creation_input_tokens` → `cacheWriteTokens`、`cache_read_input_tokens` → `cacheReadTokens`），随该步的 `assistant/message` 入账。某些后端（如经 Anthropic 兼容端点接入的非 Claude 模型）流式消息不带用量，此时退回 `result` 消息的权威总用量 `result.usage`，补一个 `assistant/chunk`（`usage` 类型）兜底，保证 `pressureTokens` / `projectedTokens` 有值。
- **容量（分母）**：`result` 消息的 `modelUsage`（`Record<model, ModelUsage>`）带有 `contextWindow`，映射成 `request/context` 事件（`{ provider: "claude-code", model, contextWindow }`），且仅在 provider/model/contextWindow 变化时写入（经 sink 的 `requestContext()` 去重）。取不到时退回引擎配置 `config.contextWindow`。因为 Claude 的容量要等第一次 query 结束才可知，所以首轮结束前没有占用比例，之后每个回合末尾刷新一次。

用法与 DSH 原生一致：占用比例是面向用户的参考数字，不是计费记录；token-meter 会像折叠原生日志一样折叠这些事件。

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
