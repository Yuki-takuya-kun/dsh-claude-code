# Documentation Update Log

## 2026-08-20

* **Fix**: 使用 Claude Code 预设跑过一轮后输入框被锁死、显示「当前模型不可用，请先选择模型」。根因是 DSH 前端模型选择的 `routeServed` 只查 `ctx.llm.listProviders()`，而 trace.mjs 把 `provider: "claude-code"` 写进会话 `request/header` 做用量归因——`claude-code` 是引擎、从不进 `ctx.llm`，于是 `session.models` 报 `routable:false`。改为新增 `lib/llm-route.mjs`，把 `claude-code` 注册成一个「休眠」LLM provider 路由（仅贡献目录、`stream()` 显式抛错，随插件 fiber 释放）。新增 `test/llm-route.test.mjs`。同步 [架构](/overview/architecture.md)。

## 2026-08-19

* **Feature**: 子代理追踪——Claude Code 内部子代理（Agent/Task 工具 spawn）以前只能看到父轨迹里一个通用工具调用，看不到子代理干了什么。改为：以主轨迹里 Agent/Task 工具的 `tool_use` 块为权威信号（不再依赖 SDK 的 `task_started`/`task_notification` 等旧 Task 工具生命周期事件，新 Agent 工具可能不发），每个子代理建一个独立只读 DSH 子 session（`origin:'subagent'` + `parentSession` + `delegationDepth` + `subagent/descriptor`）；SDK 转发消息（带 `parent_tool_use_id`）经 `ClaudeRunTracer` 归位成子轨迹，父线程 `tool_result` 收尾（前台当轮、后台跨轮）；主轨迹里 Agent/Task 工具调用映射成 wire 名 `subagent`。新增 `lib/subagents.mjs` 与 `test/subagents.test.mjs`，配置新增 `traceSubagents`（默认 true）。同步 [事件映射](/reference/event-mapping.md)、[架构](/overview/architecture.md)、[配置](/reference/config.md) 与单测 `test/trace.test.mjs`。

## 2026-08-18

* **Feature**: 上下文构成拆解——界面此前只显示 `messageTokens`（对话），`systemTokens`/`toolsTokens` 恒 0，因为 dsh-claude-code 没写 `request/header`。改为在 `system/init` 时写一条 `request/header`：`config` 用 provider + model，`tools` 由 SDK 的 `system/init.tools` 映射成占位 schema，`system` 写一句占位说明（Claude Code 系统提示词由 CLI 内部生成、SDK 不暴露原文）。经 sink 的 `requestHeader()` 跨轮去重。同步 [事件映射](/reference/event-mapping.md)、[架构](/overview/architecture.md) 与单测 `test/trace.test.mjs`。

* **Fix**: 切到 Full access 会触发模型抢跑——DSH 的 `user-approval.setPolicy` 在审批策略变化时 `agent.inject()` 一条「approval policy changed」上下文消息（进 `next-step`），而 `ClaudeCodeAgent.drive()` 用 `hasPending`（`next-turn` **或** `next-step`）作为开回合条件，导致这条注入消息被当成一条新用户消息喂给 Claude Code，模型以为用户回复了、没等真实回复就执行下一步。改为只按 `nextTurn.length > 0` 开回合：注入消息留在 `next-step`，等下一个真实用户回合 `claim("next-turn")` 时一起排空、作为前缀并入提示词。同步 [架构](/overview/architecture.md)。

* **Fix**: 用量仍为 0 的另一半原因在子进程 env——`lib/auth.mjs` 的 `scrubbedParentEnv()` 会剥掉名字含 KEY/TOKEN 的 `ANTHROPIC_*`（`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`），代理端点缺了凭据就把 usage 全报 0、`modelUsage` 也给不出 `contextWindow`。改为 scrub 后补回父环境的 `ANTHROPIC_*`，再由 `config.env` 覆盖。新增 `test/auth.test.mjs`。同步 [配置](/reference/config.md)。

* **Fix**: 用量仍然不显示——实测 SDK 的流式事件里 `message_start` 的 usage 全为 0、且 `message.model` 是去后缀短名（与 `system/init` 和 `modelUsage` 的 key 不符），权威用量在 `message_delta`，而它排在 `assistant` 消息之后。改为：忽略 `message_start`（不再污染 `#usage` 与 `#model`），`message_delta` 的完整 `TokenUsage` 写成 `assistant/chunk`（`usage` 类型）而非挂在 `assistant/message` 上；`request/context` 的 model 用 `system/init` 的全名。同步 [事件映射](/reference/event-mapping.md)、[架构](/overview/architecture.md) 与单测 `test/trace.test.mjs`。

* **Fix**: 上下文用量在某些后端（经 Anthropic 兼容端点接入的非 Claude 模型）为全 0、且 `request/context` 取不到——流式 `message_start`/`message_delta` 不带用量、`result.modelUsage` 也不给 `contextWindow`。改为：`result` 消息的权威 `usage` 在每步流式用量为空时补一个 `assistant/chunk`（usage 类型）兜底；`contextWindow` 匹配顺序扩展为 key → `canonicalModel` → 任意正数条目，并新增引擎配置 `contextWindow` 手动兜底。同步 [事件映射](/reference/event-mapping.md)、[配置](/reference/config.md)、README 与单测。

* **Feature**: 添加上下文长度监控——`lib/trace.mjs` 把 Claude SDK 的用量补进 DSH 会话日志：`message_start`/`message_delta` 合成 `TokenUsage` 挂在每步 `assistant/message`，`result.modelUsage` 的 `contextWindow` 映射成 `request/context`（经 sink 的 `requestContext()` 去重），token-meter 据此折叠出 `contextPressure`，Web 界面像 DSH 原生一样显示上下文占用比例。`lib/driver.mjs` 的 sink 补 `requestContext()`。同步 [事件映射](/reference/event-mapping.md)、[架构](/overview/architecture.md)、README 与单测 `test/trace.test.mjs`。

## 2026-08-17

* **Fix**: 权限改为每次工具调用重读会话 `sandbox/mode` + `approval/policy`（`lib/approval.mjs` 的 `canUseTool` 不再闭包回合起点算好的 strategy），回合中切到 Full access（danger-full-access）或 never 立即生效；`lib/driver.mjs` 仅在回合起点已是 danger-full-access 时设 `permissionMode: bypassPermissions`，其余策略统一走 `canUseTool`。新增 `test/approval.test.mjs`。同步 [架构](/overview/architecture.md)。

* **Update**: `lib/trace.mjs` 新增工具名归一化——Claude Code 内建工具名（`Bash`/`Skill`/`Read`/`Write`/`Edit`/`Glob`/`Grep`/`WebFetch`/`WebSearch`…）映射成 DSH wire 工具名（`bash`/`skill`/`read`/…），让 DSH 前端按类别渲染而非全部落进通用 "Tool call"；`Skill` 入参 `{ command }` 改写为 `{ name }`。同步 [事件映射](/reference/event-mapping.md) 与单测 `test/trace.test.mjs`。

## 2026-08-16

* **Update**: README 重构为中英双语——`README.md` 改为中文默认版（Hero + 能干什么 + 一句话），英文迁至 `README_EN.md`，双向互链；删「预发布」警告、术语降噪。删除 [项目总览](/overview/project-overview.md) 的「状态」段。

* **Update**: DSH 权限映射（`sandbox/mode` + `approval/policy` → `canUseTool` 策略，新增 `lib/permission.mjs`）+ `AskUserQuestion` 桥接（`canUseTool` 内弹 DSH 选择题作答）+ 安装说明改为「先装 dsh-engine-switch」。同步 [架构](/overview/architecture.md)、[开发](/guides/development.md)。

## 2026-08-14

* **Initialization**: 创建 docs/ OKF v0.1 文档包（overview/reference/guides 三槽位）。
* **Creation**: 新增 [项目总览](/overview/project-overview.md)、[架构](/overview/architecture.md)、[配置](/reference/config.md)、[事件映射](/reference/event-mapping.md)、[安装启用](/guides/setup.md)、[开发](/guides/development.md)。
* **Update**: 按预设切换引擎（per-preset engine routing）——插件自带 `claude-code` 预设（落到 `~/.dsh/.agent-presets/`）；[配置](/reference/config.md) 新增 `defaultEngine` / `engineByPreset`；[架构](/overview/architecture.md) 改写「已知限制」并补充引擎路由、预设落地与 resume 续接机制。
* **Refactor**: 改为**引擎提供者**——不再替换 `ctx.agents.factory`，而是定义 `claude-code` 引擎、经 `ctx.engineSwitch.register()` 注册给 `dsh-engine-switch`（纯路由层）。[配置](/reference/config.md) 改为引擎私有配置（`config.engines["claude-code"]`）；[架构](/overview/architecture.md) 改为引擎注册 + 路由分工。
