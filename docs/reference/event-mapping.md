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
| system/init | request/header（system + tools）+ turn/start（turn/start 由上层 agent 处理） |
| stream_event · content_block_delta(text) | assistant/chunk (text-delta) |
| stream_event · content_block_delta(thinking) | assistant/chunk (reasoning-delta) |
| stream_event · content_block_delta(input_json) | assistant/chunk (tool-call-delta) |
| stream_event · message_start | 忽略（usage 全 0、model 是去后缀短名） |
| stream_event · message_delta | assistant/chunk (usage 类型) —— 权威定稿用量 |
| assistant（完整一轮） | assistant/message（不带 usage） |
| assistant 内 tool_use 块 | tool/call |
| user 内 tool_result 块 | tool/result |
| result · modelUsage | request/context（provider/model/contextWindow） |
| result · success | turn/end (completed) |
| result · error | turn/end (error) |

# 上下文长度监控

DSH 原生靠 `ctx.tokenMeter` 从会话日志折叠出 `tokenUsage` / `contextPressure` 投影，Web 界面据此显示上下文占用比例（`projectedTokens / contextWindow`）。dsh-claude-code 的驱动换成了 Claude Code，不经过 `ctx.llm.stream()`，所以由 `lib/trace.mjs` 把 Claude SDK 的用量信息补进同一批会话事件：

- **用量（分子）**：SDK 的流式事件里，`message_start` 的 usage 全为 0（且其 `message.model` 是去后缀短名，与 `system/init` / `modelUsage` 的 key 不符），所以忽略它；权威用量在 `message_delta`——它在 `assistant` 消息之后才到，携带该次请求的 `input_tokens` + `output_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`，映射成 DSH `TokenUsage`（`cache_creation_input_tokens` → `cacheWriteTokens`、`cache_read_input_tokens` → `cacheReadTokens`）后写成一个 `assistant/chunk`（`usage` 类型）。某些后端流式消息完全不携带用量时，退回 `result.usage`（该次 query 的总用量）补一个 `usage` chunk 兜底，保证 `pressureTokens` / `projectedTokens` 有值。
- **容量（分母）**：`result` 消息的 `modelUsage`（`Record<model, ModelUsage>`）带有 `contextWindow`，映射成 `request/context` 事件（`{ provider: "claude-code", model, contextWindow }`），且仅在 provider/model/contextWindow 变化时写入（经 sink 的 `requestContext()` 去重）。取不到时退回引擎配置 `config.contextWindow`。因为 Claude 的容量要等第一次 query 结束才可知，所以首轮结束前没有占用比例，之后每个回合末尾刷新一次。
- **构成拆解（system / tools / messages）**：token-meter 的 `contextBreakdown` 投影把上下文拆成 `systemTokens`（系统提示词）+ `toolsTokens`（工具 schema）+ `messageTokens`（对话 surface），前两者来自 `request/header` 事件。tracer 在 `system/init` 时写一条 `request/header`：`config` 用 provider + model，`tools` 由 SDK 的 `system/init.tools`（内建工具名）映射成占位 schema（`{ name, description: "", parameters: {} }`），`system` 写一句占位说明——Claude Code 的系统提示词由 `claude` CLI 内部生成、SDK 不暴露原文，故 system 侧的精确数值拿不到（真实总量反映在占用条的 `pressureTokens` 里）。

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

# 子代理映射

Claude Code 内部子代理由 **Agent 工具**（旧名 Task）spawn。开启 `traceSubagents`（默认）时，每个子代理被追踪为独立只读 DSH 子 session，而不是混进主轨迹：

| Claude SDK 事件/块 | 去向 |
|---|---|
| 主线程 assistant 内 `tool_use`（名 `Agent`/`Task`） | 建子 session（`subagent/descriptor` + `turn/start`）；主轨迹里同时映射成 wire 名 `subagent` 的「发起委派」卡片 |
| 带 `parent_tool_use_id` 的 assistant/user/stream_event/tool_progress | 子 session 轨迹（复用 ClaudeRunTracer，按 `parent_tool_use_id` 归位） |
| 主线程 user 内 `tool_result`（`tool_use_id` 命中） | 子 session `turn/end`（`is_error` → error，否则 completed）；前台当轮、后台跨轮 |
| system · task_started / task_progress / task_updated / task_notification | 只消费不驱动（旧 Task 工具的生命周期事件，Agent 工具可能不发；`task_notification` 存在时作后台收尾兜底） |

子 session 以 `origin:'subagent'` + `parentSession` + `delegationDepth` + `subagent/descriptor`（provider `claude-code`、mode `one-shot`、label 取 Agent 工具的 `description`）写入，UI 经 lineage 树展示（子发现读 `origin==='subagent' && parentId===parentSession`），与 DSH 原生子代理显示一致。子 session 只读、不可续跑，完成后 detach 成 persistence-only。

# 关键选项

- includePartialMessages: true 才有 token 级流式（默认关闭时只能看到完整消息）。
- `forwardSubagentText` 由 `traceSubagents` 驱动：开启时才要求 SDK 转发子代理的 text/thinking 全文；关闭时子代理消息被丢弃、不进主轨迹。
- 官方 dsh-subagent-claude-code 未开启该选项，故看不到流式。
