# dsh-claude-code

让 **Claude Code 的 harness** 作为 **DeepSeek Harness（DSH）主循环**运行，并把它的完整轨迹——文本、思考、工具调用与结果——实时流式写入 DSH Web 界面。

> 🚧 **预发布版 —— 暂不可用。** 这是早期开发版。鉴权以及若干其它功能**尚未实现或验证**，也未做过端到端验证。**请勿用于生产环境。** 未做额外配置时可能无法直接跑通。

## 它做什么

DSH 默认用自己的 DeepSeek agent 循环驱动每个会话。本插件替换这个驱动：启用后，**新建的顶层会话**改由本机 **Claude Code** CLI（走官方 Claude Agent SDK）驱动。Claude Code 保留自己的工具与沙箱；DSH 保留会话日志与界面，并把 Claude Code 的每一步写成 DSH 会话事件，轨迹视图实时可见。

## 安装

    dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code
    # 或本地目录安装：
    dsh plugin --profile web add /path/to/dsh-claude-code

要求：PATH 里有 pnpm；本机有可用 claude CLI（已安装并登录）或 ANTHROPIC_API_KEY。

## 启用

编辑 ~/.dsh/profiles/web/cordis.patch.yml：

    - id: dsh-claude-code
      config:
        enabled: true
        # executable: /path/to/claude   # 默认从 PATH 解析 claude
        # env: { ANTHROPIC_API_KEY: sk-... }  # 可选，未登录时用

重启 web 应用。新建会话即由 Claude Code 驱动；改回 enabled: false + 重启即回到 DeepSeek。

## 工作原理

- 启用时替换 agent 工厂。
- 新顶层会话 → ClaudeCodeAgent（每轮运行 Claude Code）。
- 子代理与恢复会话 → 委托回 DeepSeek 循环（v1）。
- SDK 事件 → DSH 会话事件（turn/start → step/start → assistant/chunk → assistant/message → tool/call → tool/result → step/end → turn/end），实时流式。
- 权限询问桥接到 DSH 审批 UI。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| enabled | false | 是否用 Claude Code 驱动新会话 |
| executable | "claude" | Claude Code 可执行（路径或 PATH 名） |
| persistSession | true | 跨轮复用 Claude 会话 |
| includePartialMessages | true | token 级流式 |
| env | {} | 额外环境变量（如 ANTHROPIC_API_KEY） |

## 已知限制

- 预发布：恢复 Claude 会话会回落到 DeepSeek。
- AskUserQuestion 已禁用；权限询问走 DSH 审批 UI。
- 需要可用的 claude CLI。

## 许可证

MIT。第三方组件见 THIRD_PARTY_NOTICES.md。
