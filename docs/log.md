# Documentation Update Log

## 2026-08-16

* **Update**: DSH 权限映射（`sandbox/mode` + `approval/policy` → `canUseTool` 策略，新增 `lib/permission.mjs`）+ `AskUserQuestion` 桥接（`canUseTool` 内弹 DSH 选择题作答）+ 安装说明改为「先装 dsh-engine-switch」。同步 [架构](/overview/architecture.md)、[开发](/guides/development.md)。

## 2026-08-14

* **Initialization**: 创建 docs/ OKF v0.1 文档包（overview/reference/guides 三槽位）。
* **Creation**: 新增 [项目总览](/overview/project-overview.md)、[架构](/overview/architecture.md)、[配置](/reference/config.md)、[事件映射](/reference/event-mapping.md)、[安装启用](/guides/setup.md)、[开发](/guides/development.md)。
* **Update**: 按预设切换引擎（per-preset engine routing）——插件自带 `claude-code` 预设（落到 `~/.dsh/.agent-presets/`）；[配置](/reference/config.md) 新增 `defaultEngine` / `engineByPreset`；[架构](/overview/architecture.md) 改写「已知限制」并补充引擎路由、预设落地与 resume 续接机制。
* **Refactor**: 改为**引擎提供者**——不再替换 `ctx.agents.factory`，而是定义 `claude-code` 引擎、经 `ctx.engineSwitch.register()` 注册给 `dsh-engine-switch`（纯路由层）。[配置](/reference/config.md) 改为引擎私有配置（`config.engines["claude-code"]`）；[架构](/overview/architecture.md) 改为引擎注册 + 路由分工。
