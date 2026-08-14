---
type: Config
title: 配置
description: dsh-claude-code 的配置键与默认值。
resource: index.mjs
tags: [config, cordis]
timestamp: 2026-08-14
---

# 配置键

| 键 | 默认 | 含义 |
|---|---|---|
| enabled | false | 是否用 Claude Code 驱动新会话 |
| executable | "claude" | Claude Code 可执行（路径或 PATH 名） |
| persistSession | true | 跨轮复用 Claude 会话 |
| includePartialMessages | true | token 级流式 |
| env | {} | 额外环境变量（如 ANTHROPIC_API_KEY） |

# 启用示例

~/.dsh/profiles/web/cordis.patch.yml：

    - id: dsh-claude-code
      config:
        enabled: true

# 注意

- executable 含路径分隔符时按绝对/相对路径直接使用，否则按 PATH 解析。
- env 是「整体替换」子进程环境，插件会合并 scrubbedParentEnv() 后再叠加 env。
