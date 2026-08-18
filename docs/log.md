# Documentation Update Log

## 2026-08-18

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
