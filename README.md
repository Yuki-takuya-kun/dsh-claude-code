# dsh-claude-code

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">在 DSH 里用 Claude Code 驱动会话，轨迹实时可见</b><br /><br />
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a><br /><br />
  <img alt="轨迹实时流式" src="https://img.shields.io/badge/-轨迹实时流式-4d6bfe" /> <img alt="权限桥接" src="https://img.shields.io/badge/-权限桥接-4d6bfe" /> <img alt="零配置注册" src="https://img.shields.io/badge/-零配置注册-4d6bfe" /><br /><br />
  <b>DSH 默认只用 DeepSeek</b>。装上 <a href="https://github.com/Yuki-takuya-kun/dsh-engine-switch">dsh-engine-switch</a> + 本插件，<br />
  预设列表就多一个「Claude Code」——选中它用 Claude Code 驱动，选其它用 DeepSeek。
</div>

<div align="center">
  🌏 <a href="./README.md"><b>中文</b></a> · <a href="./README_EN.md">English</a>
</div>

## ✨ 能干什么

- **🎯 一键接入 Claude Code**：注册一个 `claude-code` 引擎（`ClaudeCodeAgent` + 预设），交给 [dsh-engine-switch](https://github.com/Yuki-takuya-kun/dsh-engine-switch) 按预设路由，零配置自动对上。
- **📡 轨迹实时可见**：文本、思考、工具调用与结果，每一步都实时流进 DSH 会话。
- **📊 上下文占用可见**：把 Claude Code 的 token 用量与模型上下文窗口写进 DSH 会话日志（`TokenUsage` + `request/context`），像 DSH 原生一样在界面显示上下文占用比例。
- **🔐 权限桥接**：DSH 的沙箱模式 + 审批策略，映射到 Claude 的权限回调（工作区内写放行、区外弹审批）；`AskUserQuestion` 用 DSH 的选择题 UI 作答。
- **🧰 工具与沙箱都来自 Claude Code**：预设只当路由键，不把 DSH 的 persona / 工具透传过去。
- **⏯️ 精确续接**：Claude 会话 id 旁路持久化，续聊接回同一个 Claude 会话。
- **🌐 子代理照旧 DeepSeek**：不管主会话选了谁，子代理都走 DeepSeek。

> 🔌 **一句话**：本插件**不自己替换主循环**——它只定义一个 `claude-code` 引擎，交给 dsh-engine-switch 负责「预设 → 引擎」路由、切换与续接。预设只是路由键：切到它，工具、沙箱、人设都来自 Claude Code，DSH 保留日志与界面。

## 🚀 安装

**先装 [dsh-engine-switch](https://github.com/Yuki-takuya-kun/dsh-engine-switch)**（它提供本插件依赖的 `ctx.engineSwitch` 服务，peer 依赖不会自动装）：

```sh
dsh plugin --profile web add github:Yuki-takuya-kun/dsh-engine-switch \
  && dsh plugin --profile web add github:Yuki-takuya-kun/dsh-claude-code
```

要求：PATH 里有 pnpm；本机有可用的 claude CLI（已登录）或 `ANTHROPIC_API_KEY`。

## ⚙️ 启用

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: dsh-engine-switch
  config:
    enabled: true
    # 可选：claude-code 引擎的选项：
    engines:
      claude-code:
        executable: claude
        # env: { ANTHROPIC_API_KEY: sk-... }  # 未登录时用
```

重启 web 应用。预设列表出现「Claude Code」：选中它 → Claude Code，选其它 → DeepSeek。

## ⚙️ 配置

这些是 claude-code 引擎的选项，写在 dsh-engine-switch 的 `config.engines["claude-code"]` 下：

| 键 | 默认 | 含义 |
|---|---|---|
| executable | "claude" | Claude Code 可执行（路径或 PATH 名） |
| persistSession | true | 跨轮复用同一个 Claude 会话 |
| includePartialMessages | true | token 级流式输出 |
| env | {} | 额外环境变量（如 ANTHROPIC_API_KEY） |
| contextWindow | 未配置 | 手动指定模型上下文窗口（token 数），自动取不到时兜底 |

## 🔍 原理（可选阅读）

- 本插件在 `apply()` 里 `ctx.engineSwitch.register(claudeCodeEngine)` 注册 `claude-code` 引擎（`inject: ["engineSwitch"]`）。
- 每轮跑一次 Claude Code；SDK 事件被转成 DSH 会话事件（turn / step / assistant / tool 等），实时流式。
- 权限经 `canUseTool` 回调桥接：工作区内写放行、区外弹审批；`AskUserQuestion` 用 DSH 选择题 UI 作答。

## 📄 许可证

MIT。第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
