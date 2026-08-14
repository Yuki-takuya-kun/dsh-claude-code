---
type: ProjectOverview
title: dsh-claude-code 项目总览
description: 用 Claude Code 的 harness 作为 DeepSeek Harness 主循环，轨迹实时透传到 DSH Web 界面。
resource: index.mjs
tags: [dsh, claude-code, agent-loop, trajectory]
timestamp: 2026-08-14
---

# 是什么

dsh-claude-code 是一个 DeepSeek Harness（DSH）第三方插件（bundle）。它把 DSH 会话的主循环驱动从内置的 DeepSeek agent loop 换成本机 Claude Code CLI（经官方 Claude Agent SDK 驱动），并把 Claude Code 的每一步——文本、思考、工具调用与结果——实时写成 DSH 会话事件，使轨迹视图实时可见。

# 为什么

DSH 官方已有 dsh-subagent-claude-code，把 Claude Code 作为子代理委派任务，但它只回最终答案、刻意隐藏中间轨迹。本项目要的是：复用 DSH 的界面与会话体系，同时保留 Claude Code 的 harness，并全程看得见轨迹。

# 状态

🚧 预发布 —— 暂不可用。鉴权以及若干其它功能尚未实现或验证，也未做过端到端验证。请勿用于生产。

# 与官方子代理的区别

| | 官方 dsh-subagent-claude-code | 本项目 |
|---|---|---|
| 角色 | 子代理（委派任务） | 主循环（驱动整个会话） |
| 轨迹 | 只回最终答案 | 实时流式（文本/思考/工具/结果） |
| 工具 | Claude Code 自带 | Claude Code 自带 |

# Citations

[1] https://github.com/deepseek-ai/deepseek-harness
[2] https://www.npmjs.com/package/@deepseek-ai/dsh-subagent-claude-code
