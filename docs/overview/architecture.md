---
type: Architecture
title: 架构
description: 引擎注册（ctx.engineSwitch）+ ClaudeCodeAgent 驱动 + SDK 事件到 DSH 会话事件的实时映射。
resource: index.mjs
tags: [architecture, engine, trajectory, agent]
timestamp: 2026-08-14
---

# 数据流

用户消息 → session.prompt → dsh-engine-switch 按 preset 选引擎 → ClaudeCodeAgent → Claude Code query() → SDK 事件 → trace.mjs 映射 → DSH 会话事件 → 轨迹视图实时渲染

# 关键机制

- 引擎注册（index.mjs）：`dsh-claude-code` 定义 `claude-code` 引擎对象 `{ id, name, description, presetDir, makeAgent, resolveResumeState }`，`apply()` 里 `ctx.engineSwitch.register(...)` 注册（`inject: ["engineSwitch"]`）。
- 模型选择兜底（index.mjs + lib/llm-route.mjs）：额外把 `claude-code` 注册成一个「休眠」LLM provider 路由——只贡献目录、`stream()` 显式抛错，从不转发。DSH 前端模型选择/输入框拦截 `routeServed` 只查 `ctx.llm.listProviders()`，而 trace.mjs 会把 `provider: "claude-code"` 写进会话 `request/header`（用量归因）；不注册该路由，首轮之后 `session.models` 会报 `routable:false`、锁死输入框显示「当前模型不可用，请先选择模型」。注册随插件 fiber 释放（HMR 安全）。
- 路由（dsh-engine-switch 负责）：`engineByPreset` 命中 > 引擎自带预设（id 即引擎 id）> `defaultEngine`；空白会话内切预设即 swap 引擎；resume 按 `resolveSessionPreset`（读日志）反推。`dsh-claude-code` 不替换 `ctx.agents.factory`。
- 预设落地（dsh-engine-switch 的 registry onRegister）：注册引擎时把其 `presetDir` 写到用户 root（`~/.dsh/.agent-presets/claude-code/`），发现过程每次 list() 重扫，即出现在预设列表。
- ClaudeCodeAgent（lib/agent.mjs）：实现 dsh-agent 公开 Agent 接口（Inbox、状态、取消），按 `next-turn` 队列每轮跑一次 Claude Code。注入到 `next-step` 的上下文消息（如切 Full access 时 user-approval 注入的「approval policy changed」提示）不单独开回合，只随下一个真实用户回合一起排空、作为前缀并入提示词。
- 轨迹透传（lib/trace.mjs）：ClaudeRunTracer 把 SDK 消息流映射成 DSH 会话事件。
- 上下文长度监控（lib/trace.mjs + lib/driver.mjs）：把 Claude SDK 的用量补进 DSH 会话日志——`message_delta` 的权威用量写成 `assistant/chunk`（`usage` 类型，`message_start` 因 usage 全 0 被忽略），流式无用量时退回 `result.usage` 兜底；`result.modelUsage` 的 `contextWindow` 映射成 `request/context`（经 sink 的 `requestContext()` 去重）；`system/init` 的 model + tools 写成 `request/header`（经 sink 的 `requestHeader()` 去重）。token-meter 据此折叠出 `contextPressure`（占用比例）与 `contextBreakdown`（system/tools/messages 构成），Web 界面即可像 DSH 原生一样显示上下文占用比例与构成。
- 权限映射与审批桥（lib/permission.mjs + lib/approval.mjs）：每次工具调用都重读会话 `sandbox/mode` + `approval/policy` 映射成 `canUseTool` 策略，回合中切 preset 立即生效（`workspace-write` 区内放行、区外走 `ctx.approval.request` 审批；`danger-full-access` 在回合起点设 `permissionMode: bypassPermissions` 全放行、回合中由 `canUseTool` 直接放行；`approval/policy=never` 无交互区内放行区外拒绝）；`AskUserQuestion` 经 `ctx.userQuestions.ask` 弹 DSH 选择题作答。
- 双通道认证（lib/auth.mjs）：原生 claude 登录 + ANTHROPIC_API_KEY。
- 精确续接（lib/store.mjs）：旁路持久化 Claude 会话 id，`resolveResumeState` 在 resume 时恢复。
- 子代理追踪（lib/subagents.mjs + lib/trace.mjs + lib/driver.mjs）：Claude Code 内部子代理由 Agent/Task 工具 spawn，以主轨迹里的 `tool_use` 块为权威信号（不再依赖 SDK 的 `task_*` 系统消息），每个子代理建成一个独立只读 DSH 子 session（`origin:'subagent'` + `parentSession` + `delegationDepth` + `subagent/descriptor`）；SDK 转发消息（带 `parent_tool_use_id`）经 `ClaudeRunTracer` 归位成子轨迹，父线程 `tool_result` 收尾（前台当轮、后台跨轮）。主轨迹里 Agent/Task 工具调用映射成 wire 名 `subagent`。

# 事件映射

详见 [Event mapping](/reference/event-mapping.md)。

# 已知限制

- preset id 只当路由键：切到 Claude 的 preset，其 DSH 工具与人设（persona）**不透传**给 Claude Code（Claude 自带工具与默认人设）。
- 子代理是「只读投影」：Claude Code 内部子代理（Agent/Task）只映射成 lineage 树里的只读子 session 展示轨迹，不挂 DSH Agent、不可续跑/steer，也不走 `ctx.subagents` 的原生委派 seam。
- 精确续接依赖插件旁路持久化（`~/.dsh/dsh-claude-code/sessions.json`）；若该文件丢失，Claude 会话退化为重放而非精确续接。
