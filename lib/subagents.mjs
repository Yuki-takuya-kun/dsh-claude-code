// lib/subagents.mjs — 把 Claude Code 内部子代理（Agent/Task 工具 spawn）映射成独立只读 DSH 子 session。
//
// 检测：以主轨迹里 Agent/Task 工具的 tool_use 块为权威信号，不再依赖 SDK 的 task_started /
// task_notification 等旧 Task 工具生命周期事件（新 Agent 工具可能根本不发）。每个子代理用其
// tool_use 块的 id 作为身份键，SDK 转发消息（带 parent_tool_use_id）据此归位，父线程的
// tool_result 据此收尾。task_* 系统消息仅消费不驱动（存在时作兜底，缺失绝不报错）。
//
// 只读投影：每个子代理建一个 DSH 子 session（origin:'subagent' + parentSession +
// delegationDepth + subagent/descriptor），复用 ClaudeRunTracer 把转发消息写成子轨迹；UI 经
// lineage 树展示（子发现读 origin==='subagent' && parentId===parentSession），与 DSH 原生子代理
// 显示一致。子 session 不挂 Agent、不可续跑，完成后 detach 成 persistence-only（仍可读轨迹）。
//
// 生命周期：spawn（tool_use）建子 session → 转发消息实时写入 → 父 tool_result 收尾（前台当轮、
// 后台跨轮）。后台子代理（run_in_background）不随父 turn 结束而闭合，等它的 tool_result 在后续
// 某轮送达；agent scope 销毁时由 ctx.effect teardown 兜底闭合。映射由 ClaudeCodeAgent 跨轮持有。
import { snapshotSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { ClaudeRunTracer, SUBAGENT_TOOL_NAMES } from "./trace.mjs";

const PROVIDER = "claude-code";

/** 子代理的 durable 标签：Agent 工具的 description 是「3-5 词短描述」，最适合做 label。 */
function childLabel(input) {
  return input?.description ?? input?.subagent_type ?? input?.name ?? "subagent";
}

/** 旧 Task 工具的 task_notification 兜底收尾时，把状态映射成 turn/end 的 reason。 */
function reasonFor(notification) {
  if (notification.status === "failed") {
    return { kind: "error", error: { message: notification.summary || "subagent failed", code: "CLAUDE_CODE_SUBAGENT" } };
  }
  if (notification.status === "stopped") {
    return { kind: "aborted", reason: { kind: "user" } };
  }
  return { kind: "completed" };
}

export class SubagentSessionManager {
  #ctx;
  #sessions;
  #mainSession;
  #cwd;
  #depth;
  #byToolUseId = new Map();
  #closedToolUseIds = new Set();
  #teardown = undefined;

  constructor(ctx, { mainSession, cwd }) {
    this.#ctx = ctx;
    this.#sessions = ctx.get("sessions");
    this.#mainSession = mainSession;
    this.#cwd = cwd;
    this.#depth = (mainSession.header.delegationDepth ?? 0) + 1;
  }

  /**
   * 处理一条 SDK 消息。子代理相关消息被消费（返回 true），其余返回 false 交由主 tracer。
   * @returns {boolean} true = 本消息已作为子代理消息消费
   */
  handleMessage(message) {
    if (message == null || typeof message !== "object") return false;

    if (message.type === "system") {
      switch (message.subtype) {
        // task_* 是旧 Task 工具的生命周期事件：只消费、不驱动主流程（Agent 工具可能不发）。
        case "task_started":
        case "task_progress":
          return true;
        case "task_notification":
          this.#onTaskNotification(message);
          return true;
        case "task_updated":
          return true; // 后台化标记：v1 不驱动，父 tool_result 才是权威收尾信号
        default:
          return false;
      }
    }

    // 转发消息：parent_tool_use_id 命中已跟踪子代理 → 归位到子 session
    if (message.parent_tool_use_id != null) {
      this.#routeForwarded(message);
      return true;
    }

    // 主线程 assistant：Agent/Task 工具的 tool_use 块 = 子代理诞生（仍返回 false 交由主 tracer）
    if (message.type === "assistant") {
      this.#onMainAssistant(message);
      return false;
    }

    // 主线程 user：Agent/Task 工具的 tool_result 块 = 子代理收尾（仍返回 false 交由主 tracer）
    if (message.type === "user") {
      this.#onMainToolResult(message);
      return false;
    }

    return false;
  }

  /**
   * 父 turn 结束：闭合本轮到访的前台子代理；后台子代理保持 open，等后续轮的 tool_result。
   * @param options.aborted 本轮是否被取消（取消时前台子代理以 aborted 收尾）。
   */
  finishRun({ aborted = false } = {}) {
    const reason = aborted
      ? { kind: "aborted", reason: { kind: "user" } }
      : { kind: "completed" };
    for (const child of this.#children()) {
      if (!child.closed && !child.background) this.#closeChild(child, reason);
    }
    this.#pruneClosed();
  }

  #onMainAssistant(message) {
    const blocks = Array.isArray(message?.message?.content) ? message.message.content : [];
    for (const block of blocks) {
      if (!block || block.type !== "tool_use") continue;
      if (!SUBAGENT_TOOL_NAMES.has(block.name)) continue;
      if (typeof block.id !== "string" || this.#byToolUseId.has(block.id)) continue;
      const input = block.input ?? {};
      const child = this.#createChild(childLabel(input));
      child.toolUseId = block.id;
      child.background = input.run_in_background === true;
      this.#byToolUseId.set(block.id, child);
    }
  }

  #onMainToolResult(message) {
    const blocks = Array.isArray(message?.message?.content) ? message.message.content : [];
    for (const block of blocks) {
      if (!block || block.type !== "tool_result") continue;
      const child = this.#byToolUseId.get(block.tool_use_id);
      if (!child || child.closed) continue;
      this.#closeChild(child, block.is_error === true
        ? { kind: "error", error: { message: "subagent tool result reported an error", code: "CLAUDE_CODE_SUBAGENT" } }
        : { kind: "completed" });
    }
  }

  #routeForwarded(message) {
    if (this.#closedToolUseIds.has(message.parent_tool_use_id)) return; // 已收尾子代理的残留消息：忽略
    let child = this.#byToolUseId.get(message.parent_tool_use_id);
    if (!child) {
      // 兜底：转发消息先于 spawn 的 tool_use 到达（或 spawn 检测丢失）时，按 parent_tool_use_id 惰性建子 session。
      child = this.#createChild(message.subagent_type || "subagent");
      child.toolUseId = message.parent_tool_use_id;
      this.#byToolUseId.set(message.parent_tool_use_id, child);
    }
    child.tracer.handleMessage(message);
  }

  #onTaskNotification(message) {
    const child = this.#byToolUseId.get(message.tool_use_id);
    if (!child || child.closed) return;
    this.#closeChild(child, reasonFor(message));
  }

  #createChild(label) {
    this.#ensureTeardown();
    const session = this.#sessions.prepare(undefined, {
      meta: {
        parentSession: this.#mainSession.id,
        origin: "subagent",
        delegationDepth: this.#depth,
        ...(this.#cwd ? { cwd: this.#cwd } : {}),
      },
    });
    const detach = this.#sessions.enter(session);
    this.#sessions.announce(session);
    session.append("subagent/descriptor", snapshotSubagentDescriptor({
      mode: "one-shot",
      provider: PROVIDER,
      label,
    }));
    session.append("turn/start", { turn: 1 });
    const tracer = new ClaudeRunTracer({ append: (type, data, opts) => session.append(type, data, opts) }, 1);
    return {
      session,
      detach,
      tracer,
      toolUseId: undefined,
      background: false,
      closed: false,
    };
  }

  #closeChild(child, reason) {
    if (child.closed) return;
    child.tracer.finish();
    child.session.append("turn/end", { turn: 1, reason });
    child.closed = true;
    // 先落盘再 detach：detach 触发 session/disposed，持久化插件据此做最终 flush；
    // 这里显式 flush 保证一次性写入，detach 幂等（enter 内部 entered 标志去重）。
    void this.#sessions.flush(child.session).then(() => child.detach(), () => child.detach());
    if (typeof child.toolUseId === "string") this.#closedToolUseIds.add(child.toolUseId);
    this.#pruneClosed();
  }

  #ensureTeardown() {
    if (this.#teardown !== undefined) return;
    // agent scope 销毁时，闭合并释放所有仍未收尾的子 session（含后台），避免开放 turn 泄漏。
    this.#teardown = this.#ctx.effect(() => () => {
      for (const child of this.#children()) {
        if (!child.closed) {
          child.tracer.finish();
          child.session.append("turn/end", { turn: 1, reason: { kind: "aborted", reason: { kind: "disposed" } } });
          child.closed = true;
        }
        try {
          child.detach();
        } catch {
          // detach 幂等；已 detach 的忽略。
        }
      }
      this.#byToolUseId.clear();
      this.#closedToolUseIds.clear();
    }, "dsh-claude-code:subagents");
  }

  #children() {
    return [...this.#byToolUseId.values()];
  }

  #pruneClosed() {
    for (const [key, child] of this.#byToolUseId) {
      if (child.closed) this.#byToolUseId.delete(key);
    }
  }
}
