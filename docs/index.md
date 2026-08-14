---
okf_version: "0.1"
auto_docs: true
split_threshold: 500
last_synced_commit: ""
---

# dsh-claude-code

让 Claude Code 的 harness 作为 DeepSeek Harness（DSH）主循环运行，并把完整轨迹（文本、思考、工具调用与结果）实时流式写入 DSH Web 界面。本包是 OKF v0.1 文档包，描述这个 DSH 插件的概念、配置与用法。

# Overview

* [Project overview](/overview/project-overview.md) - 项目是什么、解决什么问题
* [Architecture](/overview/architecture.md) - 工厂替换、agent 驱动、轨迹映射

# Reference

* [Configuration](/reference/config.md) - 配置键与默认值
* [Event mapping](/reference/event-mapping.md) - SDK 事件到 DSH 会话事件的映射

# Guides

* [Setup](/guides/setup.md) - 安装与启用
* [Development](/guides/development.md) - 开发、测试与构建
