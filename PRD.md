# PRD — dsh-claude-code

> Claude Code 作为 DeepSeek Harness 主循环，轨迹实时透传到 DSH Web 界面。
>
> 状态：已对齐，待开工 · 文档语言：中文（仓库 README 将提供中英双语）
> 版本：v0.1-draft · 日期：2026-08-14

---

## 1. 概述 / Overview

**dsh-claude-code** 是一个 DeepSeek Harness（DSH）第三方插件（bundle）。它让 **Claude Code 的 agent harness**（规划、工具选择、权限、沙箱）直接作为 DSH 会话的**主循环**运行，并把这个过程中产生的每一步轨迹（文本、思考、工具调用、工具结果）**实时**写成 DSH 会话事件，在 DSH Web 界面的轨迹视图里逐字流式呈现。

一句话：**复用 DSH 的界面与会话体系，用 Claude Code 的 harness 干活，全程看得见轨迹。**

---

## 2. 背景与动机

- DSH 官方已有 @deepseek-ai/dsh-subagent-claude-code：把 Claude Code 作为**子代理**委派任务，但**只回最终答案**，刻意隐藏推理/工具活动/中间消息（其 README 明言）。
- 用户诉求：想要 DSH 的界面 + Claude Code 的 harness + 实时观察 Claude Code 的轨迹。
- 因此需要一个**主循环级**的接入：Claude Code 当主 agent，DSH 只负责界面/会话/编排，轨迹全程可见。

---

## 3. 目标与非目标

### 目标（v1 达成）
1. 在 DSH Web 中，用户像平常一样发消息，由 Claude Code（而非 DeepSeek 模型）执行并回复。
2. Claude Code 的完整轨迹实时可见：文本、思考（thinking）、工具调用、工具结果。
3. Claude Code 使用**它自己的工具与沙箱**（不经 DSH 工具注册表执行）。
4. Claude Code 的权限询问桥接到 DSH 审批 UI。
5. 认证双通道：原生 claude 登录 + ANTHROPIC_API_KEY。
6. 可在「Claude Code 主循环」与「默认 DeepSeek 主循环」之间切换（profile 级）。

### 非目标（明确不做）
- **不做** Route 1（拦截 llm/stream 的"伪模型"方案）——那会丢掉 Claude Code harness，只剩 Claude 模型，与本 PRD 核心目标相悖。
- **不做** 客户端 UI 插件注入轨迹——F4 已证实网关无 session-append RPC，此路不通。
- **不做** 把 Claude Code 的工具路由到 DSH 工具注册表（Q2=A）。
- **不依赖** DeepSeek 模型做任何主循环工作（Q8=A）。

---

## 4. 决策记录（Decision Log）

| ID | 决策点 | 结论 |
|---|---|---|
| Q1 | 集成形态 | **B 主循环替换**（自定义 Agent 接管） |
| Q2 | 工具执行 | **A** Claude Code 自带工具+沙箱 |
| Q3 | 轨迹内容 | **A 全套**（文本 + thinking + 工具调用 + 结果） |
| Q4 | 认证 | **C 双通道**（claude 登录 + ANTHROPIC_API_KEY） |
| Q5 | 会话模型 | **B 持久会话**（persistSession: true，跨 DSH 轮次续聊） |
| Q6 | 交付 | **A 正式 bundle** + GitHub + dsh 目录下新项目 + 中英文档 |
| Q7 | 验收 | **A 端到端**（装进 web profile + 真任务 + 轨迹 UI 可见） |
| Q8 | DeepSeek 角色 | **A 彻底不用** |
| Q9 | 项目名 | **dsh-claude-code** |
| Q10 | 许可证 | **A MIT**（另核查 SDK 分发条款并补 NOTICE） |
| Q11 | 开关 | **B 可切换**（profile 级） |
| Q13 | 权限交互 | **B 桥接 DSH 审批 UI** |
| Q14 | 交付节奏 | **A 分阶段**（v1 核心闭环 → v2 增强） |
| Q15 | 开关粒度 | **A profile 级，重启生效** |
| Q16 | 子代理追踪 | **B 独立只读 DSH 子 session**（origin:'subagent' + subagent/descriptor，lineage 树显示；以 Agent/Task 工具调用为检测信号；前台+后台；可关） |

---

## 5. 需求

### 5.1 功能需求

- **FR-1 主循环接管**：开关开启时，注册自定义 Agent（实现 dsh-agent 公开 Agent 接口 + Inbox 纪律），接管目标会话的 prompt 处理；关闭时回退默认 DeepSeek 循环。
- **FR-2 Claude Code 驱动**：收到用户消息 → 通过 @anthropic-ai/claude-agent-sdk 的 query() 启动/续接一个持久 Claude Code 会话（persistSession: true），cwd = 会话工作区。
- **FR-3 实时轨迹透传**：开启 includePartialMessages: true，把 SDK 流式事件逐条映射成 DSH 会话事件实时 append（见 §7 映射表）。
- **FR-4 审批桥接**：SDK canUseTool 回调 → ctx.userQuestions.ask()（不带 agent 的程序化路径）→ DSH Web 审批弹窗 → 依回答 allow/deny。
- **FR-5 认证**：优先用原生 claude（ctx.subprocess.resolveExecutable('claude') + 原生登录态）；配置 env.ANTHROPIC_API_KEY 时经 env 注入（注意 SDK 的 env 是**整体替换**子进程环境，需合并 scrubbedParentEnv()）。
- **FR-6 开关与配置**：profile 级配置项 enabled（默认 false），读取/切换后**重启生效**；通过 cordis.patch.yml 的 insert 行挂载。
- **FR-7 终止与取消**：用户 cancel → abortController.abort() → 终止 Claude Code 进程树 → 会话 turn/end {kind:'aborted'}。

### 5.2 非功能需求

- **NFR-1 可安装性**：标准 bundle，dsh plugin --profile web add 一键装（package.json 声明 dsh.bundle.patch）。
- **NFR-2 可回退性**：卸载（dsh plugin remove）或关闭开关即回到默认循环，无残留。
- **NFR-3 可观测性**：Claude Code 启动失败/认证失败/工具错误都映射为轨迹事件或 turn/end 的 error reason，不静默吞掉。
- **NFR-4 资源安全**：取消/结算时等待进程树完全停稳（复用官方 disposeClaudeCodeChild 的语义）。
- **NFR-5 文档**：README（zh/en）、安装/配置/回滚说明、最小使用示例。
- **NFR-6 许可证**：MIT + THIRD_PARTY_NOTICES.md（声明 @anthropic-ai/claude-agent-sdk 及其分发条款）。

---

## 6. 架构设计

### 6.1 组件

    dsh-claude-code/                 # GitHub 仓库（/Users/huangjiahao/projects/dsh/dsh-claude-code）
    ├─ index.mjs                     # 插件入口：export { name, inject, Config, apply }
    ├─ lib/
    │   ├─ agent.mjs                 # 自定义 Agent（实现 dsh-agent Agent 接口 + Inbox 纪律）
    │   ├─ driver.mjs                # Claude Code 驱动：query() 生命周期 + 取消 + 进程树清理
    │   ├─ trace.mjs                 # SDK 事件 → DSH 会话事件映射（纯函数，可单测）
    │   ├─ approval.mjs              # canUseTool → ctx.userQuestions.ask 桥
    │   └─ auth.mjs                  # claude 可执行解析 + env 合成（双通道）
    ├─ cordis.patch.yml              # bundle patch：insert 本插件行
    ├─ package.json                  # dsh.bundle.patch 指向 cordis.patch.yml
    ├─ README.md / README.zh.md
    ├─ PRD.md                        # 本文档
    └─ test/                         # trace 映射等纯函数单测

### 6.2 数据流（一次用户消息）

    用户消息
      └─ session.prompt RPC ──▶ host: ctx.agents.get(sessionId) ──▶ 自定义 Agent
            ├─ session.append turn/start
            ├─ query({ prompt, options: { persistSession:true, includePartialMessages:true,
            │                             canUseTool: approvalBridge, cwd, pathToClaudeCodeExecutable, env } })
            ├─ for await (msg of query):
            │     ├─ system/init        → request/header + turn/start
            │     ├─ stream_event       → assistant/chunk（text/reasoning/tool-call delta）
            │     ├─ assistant          → assistant/message；含 tool_use → tool/call
            │     ├─ user(tool_result)  → tool/result
            │     └─ result             → turn/end（success→completed / error→error）
            └─ abort/cancel → 终止进程树 → turn/end{aborted}

### 6.3 关键实现注意（来自勘察）

- **Agent 注册**：用 ctx.agents.register(agent) 直接注入，无需替换 factory；需保持 Inbox + agentEvents(ctx, agent) 纪律（队列 UI 依赖 agent/inbox/spliced 与 agent/status）。
- **会话抢占**：session.prompt 经 fencedLiveAgent → ctx.agents.get(sessionId) 解析——需确保开关开启时，目标会话先注册好自定义 Agent，避免落入 factory 创建默认 ReactLoopAgent。（**v1 需先做一次技术 spike 验证此路径**，见 §13 风险 R-1。）
- **轨迹写主会话**：session.append(type, data, {surfaceOp:'append'})；消息类事件（user/message、assistant/message、tool/result）必须带 surfaceOp:'append'，tool/result 还需 sourceEventSeqs 关联其 tool/call 的 seq。
- **turn 边界所有权**：自定义驱动自己开/闭 turn/step；一旦接管，默认循环不得同时写同一会话（所有权纪律，见 F4 §5）。

---

## 7. 事件映射表（SDK → DSH 会话事件）

| Claude SDK 事件/块 | DSH 会话事件 | payload 要点 |
|---|---|---|
| system/init | request/header（reason: initial）+ turn/start | header.config = {provider:'claude-code', model} |
| stream_event · content_block_delta(text) | assistant/chunk | chunk = {type:'text-delta', index, text} |
| stream_event · content_block_delta(thinking) | assistant/chunk | chunk = {type:'reasoning-delta', index, text} |
| stream_event · content_block_delta(input_json) | assistant/chunk | chunk = {type:'tool-call-delta', index, id, name, argumentsDelta} |
| stream_event · content_block_start | assistant/chunk | chunk = {type:'block-start', index, blockType} |
| stream_event · content_block_stop | assistant/chunk | chunk = {type:'block-end', index, block} |
| stream_event · message_delta | assistant/chunk | chunk = {type:'usage', usage} |
| assistant（完整一轮） | assistant/message（surfaceOp:append） | message = {id, role:'assistant', content: blocks, source:{kind:'model', provider:'claude-code', model}} |
| assistant 内 tool_use 块 | tool/call | {turn, step, callId, name, arguments} |
| user 内 tool_result 块 | tool/result（surfaceOp:append, sourceEventSeqs:[callSeq]） | message = {id, role:'user', content:[{type:'tool-result', toolCallId, content, isError?}], source:{kind:'tool', callId}} |
| tool_progress | （可选）忽略或进度标记 | — |
| result · success | turn/end | reason {kind:'completed'} |
| result · error_* | turn/end | reason {kind:'error', error} |
| 用户 cancel | turn/end | reason {kind:'aborted'} |

**step 边界**：Claude Code 一次 API 轮（一个 assistant 消息）≈ DSH 一个 step（step/start → ... → step/end）；含多个工具调用时，tool/call 与 tool/result 落在同一步内。

---

## 8. 认证与权限

- **双通道（Q4=C）**：
  1. 原生：resolveExecutable('claude') + 不设 settingSources，让 SDK 读宿主 ~/.claude / ~/.claude.json 的登录态与产品配置（与官方插件同策略）。
  2. API Key：配置 env.ANTHROPIC_API_KEY，经 env 覆盖注入（与 scrubbedParentEnv() 合并后传给 SDK）。
- **权限（Q13=B）**：SDK canUseTool(toolName, input, {...}) → ctx.userQuestions.ask({questions:[{...允许/拒绝...}]}) → 依回答返回 allow/deny。缺省/无应答者时 fail-closed（deny）。
- **已知待验证**：B 方案下无 DSH agent 轮次在跑，UI 应答端是否随时在线需实测（若不行，v1 降级为 Q13-A 非交互，权限询问记入轨迹并 deny）。

---

## 9. 配置与开关（Q11/Q15）

    # cordis.patch.yml（bundle patch 会 insert 本插件）
    - insert:
        - id: dsh-claude-code
          name: dsh-claude-code
          config:
            enabled: false          # true = 接管主循环（重启生效）
            persistSession: true
            includePartialMessages: true
            env: {}                 # 例如 { ANTHROPIC_API_KEY: '...' }（建议走 credentials，不落明文）

---

## 10. 交付物（Q6/Q9/Q10）

- 仓库：github.com/<user>/dsh-claude-code（npm 包名 dsh-claude-code）
- 目录：/Users/huangjiahao/projects/dsh/dsh-claude-code
- 许可证：MIT + THIRD_PARTY_NOTICES.md
- 文档：README.md（en）+ README.zh.md（zh）、安装/配置/回滚、最小示例
- bundle：package.json（dsh.bundle.patch）→ cordis.patch.yml

---

## 11. 分阶段计划（Q14=A）

### Milestone 0 — Spike（可行性验证）
1. ctx.agents.register 自定义 Agent 接管一个会话的 prompt 路径是否成立（R-1）。
2. ctx.userQuestions.ask 无 agent 程序化路径在 B 方案下能否弹窗（R-2）。
3. includePartialMessages:true 流式事件能否实时写主会话并渲染。

### Milestone 1 — v1 核心闭环（对应 Q7=A 验收）
1. bundle 骨架 + package.json + cordis.patch.yml。
2. 自定义 Agent + Claude Code 驱动（persistSession + includePartialMessages + 取消/清理）。
3. trace.mjs 事件映射（§7）+ 实时 append。
4. 认证双通道 + 审批桥（canUseTool → userQuestions）。
5. 开关（enabled）+ 文档（zh/en）。
6. 端到端验收：装进 web profile → 真实 Claude Code 任务跑通 → 轨迹 UI 实时可见 → 审批弹窗可用 → 关闭开关回退正常。

### Milestone 2 — v2 增强（后续）
- 运行中切换（Q15 的 B 形态）。
- 长任务进度（tool_progress → 轨迹内进度）。
- 会话级开关/多会话共存。
- 发布到 awesome-dsh-plugins 目录。

---

## 12. 验收标准（Q7=A）

1. dsh plugin --profile web add 安装成功，dsh.profile.bundles 出现本包。
2. 开关开启 + 重启后，DSH Web 会话由 Claude Code 驱动（DeepSeek 零调用）。
3. 一个真实任务（如"读文件并回答"）跑通，轨迹视图中文本/思考/工具调用/结果**实时流式**出现。
4. 需要审批的工具触发 DSH 弹窗，允许/拒绝均正确生效。
5. 取消能终止进程树，轨迹以 aborted 收尾。
6. 关闭开关 + 重启，回到默认 DeepSeek 循环，无残留。

---

## 13. 风险与依赖

| ID | 风险 | 缓解 |
|---|---|---|
| R-1 | 自定义 register Agent 是否真能抢占 session.prompt 解析（vs factory 创建默认 loop） | M0 spike 先行；若不行改用 setFactory（需从 composition 移除 agent-loop 行） |
| R-2 | B 方案下无活跃 agent 轮次，userQuestions.ask 无 agent 路径能否弹窗 | M0 spike；不行则 v1 降级 Q13-A（非交互） |
| R-3 | SDK env 整体替换子进程环境，漏传关键变量 | 合并 scrubbedParentEnv() + 显式 env，单测覆盖 |
| R-4 | thinking 内容可能很长/敏感（Q3=A 全套） | 默认透传；预留配置项按需关闭 |
| R-5 | 与默认循环同会话并发写 → 边界损坏 | 接管即独占总有边界；关闭开关时不注册自定义 Agent |
| R-6 | claude 未登录/无 key → 认证失败 | 失败映射为 turn/end error + 轨迹内可读错误，指引登录 |

**依赖**：@anthropic-ai/claude-agent-sdk@0.3.220、@anthropic-ai/sdk@0.93.0、DSH 0.1.0-rc.6（peerDeps：@deepseek-ai/dsh-agent、dsh-session、dsh-subprocess、dsh-user-questions、cordis、schemastery）。

---

## 14. 附录：勘察结论摘要（均已核实）

| 勘察 | 关键结论 |
|---|---|
| F1 UI 渲染 | 轨迹视图事件流驱动、实时渲染；无"完成才显示"门槛；事件 payload 形状齐 |
| F2 子会话配方 | 会话级直写轨迹可行（子代理回退方案） |
| F3 SDK 事件 | includePartialMessages:true 可逐 token 流式；映射源齐全；canUseTool 可桥审批 |
| F4 主循环 seam | 无 loop-driver 抽象；Route 2（自定义 Agent / setFactory）是唯一符合本目标的官方路径；UI 免费兼容 |

---

*本文档冻结上述 15 项决策；开工后如需变更，走决策记录增量，不静默假设。*

---

## 15. 技术实现决议（M0 Spike 结论）

**R-1 接管机制（已决）**：采用「工厂槽位替换」。
- 依据：dsh-agent 的 AgentRegistry.factory 是唯一工厂槽（形如 { target }），create/resume 都经 target.createAgent/target.resume；dsh-agent-loop 的 AgentLoop 在构造时 setFactory(this) 独占。
- 做法：插件 apply 时，若 config.enabled，捕获原 factory（AgentLoop 实例），再写 ctx.agents.factory = { target: myFactory }；myFactory 对 origin:'subagent' 的 create/resume **委托回原 factory**（保证子代理仍走 DSH 循环），对顶层会话创建 Claude-Code 自定义 Agent。enabled=false 时不替换。
- 关闭开关 = 不替换 + 重启，回到默认 DeepSeek 循环。此方案不动 composition、不 disable agent-loop 行。

**R-2 审批桥（代码已证，运行时待验）**：dsh-user-questions.ask() 支持不带 agent 的程序化路径（README 明言），故 canUseTool → ctx.userQuestions.ask 成立；M1 端到端验证 B 方案下 UI 应答端在线可答。

**R-3 流式轨迹（代码已证，运行时待验）**：F1 证实轨迹视图实时渲染、无完成门槛；F3 证实 includePartialMessages:true 可逐 token 流式；M1 端到端验证。
