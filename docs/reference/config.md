---
type: Config
title: 配置
description: dsh-claude-code 引擎私有配置（在 dsh-engine-switch 的 config.engines["claude-code"]）。
resource: index.mjs
tags: [config, engine]
timestamp: 2026-08-14
---

# 配置

`dsh-claude-code` 自身**无 Config**——它只是一个引擎提供者，`apply()` 里把 `claude-code` 引擎注册给 `dsh-engine-switch`。

引擎的私有配置放在 **dsh-engine-switch 的 `config.engines["claude-code"]`**（框架原样转发给引擎的 `makeAgent`，引擎自行校验 + 给默认值）：

| 键 | 默认 | 含义 |
|---|---|---|
| executable | "claude" | Claude Code 可执行（路径或 PATH 名） |
| persistSession | true | 跨轮复用 Claude 会话 |
| includePartialMessages | true | token 级流式 |
| env | {} | 额外环境变量（如 ANTHROPIC_API_KEY） |
| contextWindow | 未配置 | 手动指定模型上下文窗口（token 数），`result.modelUsage` 取不到时兜底 |

# 启用示例

~/.dsh/profiles/web/cordis.patch.yml：

    - id: dsh-engine-switch
      config:
        enabled: true
        engines:
          claude-code:
            executable: claude

装齐 `dsh-engine-switch` + `dsh-claude-code` 两个插件并重启后，预设列表新增「Claude Code」预设；选中它 → Claude Code，选其它 → DeepSeek。

# 注意

- executable 含路径分隔符时按绝对/相对路径直接使用，否则按 PATH 解析。
- env 是「整体替换」子进程环境，插件会合并 scrubbedParentEnv() 后再补回父环境的 `ANTHROPIC_*`（凭据/端点），最后叠加 env——`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 等代理认证变量无需手动写在 env 里。
- Claude 会话 id 持久化在 `~/.dsh/dsh-claude-code/sessions.json`（可用 `DSH_CLAUDE_CODE_STORE` 覆盖根目录），因 DSH session header 是白名单 schema，塞不进自定义字段。
