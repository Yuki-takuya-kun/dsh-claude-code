# dsh-claude-code

把 **Claude Code** 作为 DeepSeek Harness（DSH）顶层会话的一个**可插拔引擎**注册给 [dsh-engine-switch](https://github.com/Yuki-takuya-kun/dsh-engine-switch)，并把它的完整轨迹——文本、思考、工具调用与结果——实时流式写入 DSH Web 界面。

> 🚧 **预发布版 —— 暂不可用。** 早期开发版。鉴权等尚未端到端验证，请勿用于生产。

## 它做什么

本插件**不自己替换主循环**。它只定义一个 `claude-code` 引擎（`ClaudeCodeAgent` + `presets/claude-code/`），通过 `ctx.engineSwitch` 注册给 `dsh-engine-switch`。后者负责「预设 → 引擎」路由、空白会话内切换、resume 续接。

装齐两个插件后，预设列表会新增「Claude Code」预设：**选中它 → Claude Code，选其它 → DeepSeek**。Claude Code 保留自己的工具与沙箱；DSH 保留会话日志与界面，轨迹实时可见。

## 安装

**必须先装 `dsh-engine-switch`** —— 它提供本插件 peer 依赖的 `ctx.engineSwitch` 服务（peer 依赖不会被自动安装）：

    # 一行命令：先装 engine-switch，再装本插件
    dsh plugin --profile web add github:Yuki-takuya-kun/dsh-engine-switch \
      && dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code

要求：PATH 里有 pnpm；本机有可用 claude CLI（已登录）或 ANTHROPIC_API_KEY。

## 启用

编辑 ~/.dsh/profiles/web/cordis.patch.yml：

    - id: dsh-engine-switch
      config:
        enabled: true
        # 引擎私有配置（可选）：
        engines:
          claude-code:
            executable: claude
            # env: { ANTHROPIC_API_KEY: sk-... }  # 未登录时用

重启 web 应用。预设列表出现「Claude Code」：选中它 → Claude Code，选其它 → DeepSeek。子代理始终 DeepSeek；resume 按日志当前预设反推引擎。

## 工作原理

- `dsh-claude-code` 定义 `claude-code` 引擎，`apply()` 里 `ctx.engineSwitch.register(claudeCodeEngine)` 注册（`inject: ["engineSwitch"]`）。
- `dsh-engine-switch` 做路由：`engineByPreset` 命中 > 引擎自带预设（id 即引擎 id）> `defaultEngine`；空白会话内切预设即 swap 引擎；resume 按 `resolveSessionPreset`（读日志）反推。
- `ClaudeCodeAgent`：实现 dsh-agent 的 Agent 接口（Inbox/状态/取消），每轮跑 Claude Code。
- SDK 事件 → DSH 会话事件（turn/start → step/start → assistant/chunk → assistant/message → tool/call → tool/result → step/end → turn/end），实时流式。
- 权限桥接到 DSH：会话的 `sandbox/mode` + `approval/policy` 预设映射到 SDK `canUseTool` 回调（`workspace-write` 区内放行、区外弹审批，`danger-full-access` 跳过 Claude 权限）；`AskUserQuestion` 经 DSH 选择题 UI 作答。Claude 会话 id 旁路持久化（精确续接）。

## 引擎私有配置（在 dsh-engine-switch 的 `config.engines["claude-code"]`）

| 键 | 默认 | 含义 |
|---|---|---|
| executable | "claude" | Claude Code 可执行（路径或 PATH 名） |
| persistSession | true | 跨轮复用 Claude 会话 |
| includePartialMessages | true | token 级流式 |
| env | {} | 额外环境变量（如 ANTHROPIC_API_KEY） |

## 已知限制

- 预发布：鉴权等尚未端到端验证。
- preset 只当路由键：切到 Claude 的 preset，其 DSH 工具与人设（persona）不透传给 Claude Code。
- `AskUserQuestion` 经 DSH 选择题 UI 作答（不走 SDK 的 headless dialog 路径）。
- 需要可用的 claude CLI。

## 许可证

MIT。第三方组件见 THIRD_PARTY_NOTICES.md。
