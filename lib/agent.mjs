// lib/agent.mjs — 自定义 Agent：把 DSH 会话的主循环交给 Claude Code。
// 镜像 ReactLoopAgent 的注册/Inbox/状态纪律，但驱动换成 Claude Code（简化：无模型选择/压缩/重试/工具调度）。
import { Inbox, agentEvents } from "@deepseek-ai/dsh-agent";
import { createScope } from "@deepseek-ai/dsh-scope";
import { runClaudeCode } from "./driver.mjs";
import { resolveClaude } from "./auth.mjs";
import { save as saveClaudeSessionId } from "./store.mjs";
import { SubagentSessionManager } from "./subagents.mjs";

function textOf(message) {
  const texts = [];
  for (const block of message?.content ?? []) {
    if (block?.type === "text" && typeof block.text === "string") texts.push(block.text);
  }
  return texts.join("\n");
}

export class ClaudeCodeAgent {
  constructor(loopCtx, id, options, session, pluginConfig) {
    this.loopCtx = loopCtx;
    this.id = id;
    this.options = options ?? {};
    this.session = session;
    this.config = pluginConfig;
    this.dispatch = agentEvents(loopCtx, this);
    this.inbox = new Inbox(session, {
      inserted: (m) => this.dispatch.emit("agent/inbox/inserted", { message: m }),
      discarded: (m) => this.dispatch.emit("agent/inbox/discarded", { message: m }),
      claimed: (m, turn) => this.dispatch.emit("agent/inbox/claimed", { message: m, turn }),
    });
    const lastTurn = session.events.findLast((e) => e.type === "turn/start")?.data.turn ?? 0;
    this.phase = { kind: "idle", lastTurn };
    this.scope = createScope(loopCtx, this);
    this.ctx = this.scope.ctx.extend({ agent: this });
    this.activityDone = Promise.resolve();
    // 跨轮复用：记住本 DSH 会话对应的 Claude Code 会话 id（首轮捕获，之后续接）
    this.claudeSessionId = undefined;
    // 子代理追踪：把 Claude Code 内部子代理（Agent/Task 工具 spawn）映射成独立 DSH 子 session（跨轮存活）。
    this.subagents = pluginConfig.traceSubagents !== false
      ? new SubagentSessionManager(this.ctx, { mainSession: session, cwd: session.header.cwd })
      : null;
  }

  get status() {
    return this.phase.kind === "idle" || this.phase.kind === "maintenance" ? "idle" : "running";
  }

  setPhase(next) {
    const prev = this.status;
    this.phase = next;
    const cur = this.status;
    if (cur !== prev) this.dispatch.emit("agent/status", { status: cur });
  }

  send(message, target, wakeup) {
    const wakingAfterAbort = wakeup && this.phase.kind !== "idle" && this.phase.abort?.signal.aborted;
    this.inbox.splice(wakingAfterAbort ? "next-turn" : target, Infinity, 0, [message]);
    if (wakeup) this.wakeDriver(wakingAfterAbort);
  }

  followup(message) {
    this.send(message, "next-turn", true);
  }

  steer(message) {
    this.send(message, "next-step", true);
  }

  inject(message) {
    this.send(message, "next-step", false);
  }

  cancel(cause, options = {}) {
    if (!options.keepInbox) {
      this.inbox.clear();
      if (this.phase.kind !== "idle") this.phase.wakeRequested = false;
    }
    if (this.phase.kind !== "idle") this.phase.abort.abort(cause);
  }

  whenIdle() {
    return this.activityDone;
  }

  runMaintenance(job) {
    if (this.phase.kind !== "idle") throw new Error(`agent "${this.id}" already has active work`);
    const done = Promise.withResolvers();
    const maintenance = { kind: "maintenance", abort: new AbortController(), lastTurn: this.phase.lastTurn, wakeRequested: false };
    this.setPhase(maintenance);
    this.activityDone = done.promise;
    return (async () => {
      try {
        return await job(maintenance.abort.signal);
      } finally {
        this.setPhase({ kind: "idle", lastTurn: maintenance.lastTurn });
        if (maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver();
        done.resolve();
      }
    })();
  }

  wakeDriver(wakeAfterAbort = false) {
    if (this.phase.kind !== "idle") {
      if (this.phase.abort?.signal.reason?.kind !== "disposed" && (this.phase.kind === "maintenance" || wakeAfterAbort)) this.phase.wakeRequested = true;
      return;
    }
    const driver = Promise.withResolvers();
    this.activityDone = driver.promise;
    this.setPhase({ kind: "running", abort: new AbortController(), turn: this.phase.lastTurn, wakeRequested: false });
    this.drive().then(() => driver.resolve(), (e) => {
      this.dispatch.emit("agent/error", { turn: this.phase.turn ?? 0, step: 0, error: e });
      driver.resolve();
    });
  }

  async drive() {
    const phase = this.phase;
    try {
      // 只按「真实用户回合」(next-turn) 驱动 Claude Code。`hasPending` 会把 next-step
      // 也算作待办，而 next-step 里的注入消息（例如切 Full access 时 user-approval 注入的
      // "The approval policy changed from …"）会因此被当成一条新用户消息喂给 Claude Code，
      // 模型以为用户回复了、没等真实回复就抢跑下一步。这里只认 next-turn：注入消息留在
      // next-step，等下一个真实回合 claim("next-turn") 时一起排空、作为前缀并入提示词
      // （与 DSH 原生循环一致）。
      while (this.inbox.nextTurn.length > 0 && !phase.abort.signal.aborted) {
        const turn = phase.turn + 1;
        phase.turn = turn;
        const messages = this.inbox.claim("next-turn", turn);
        this.session.append("turn/start", { turn });
        for (const m of messages) {
          this.session.append("user/message", m, { surfaceOp: "append" });
        }
        const prompt = messages.map(textOf).join("\n");
        try {
          const cwd = this.session.header.cwd;
          const { executable, env } = await resolveClaude({ ctx: this.loopCtx, config: this.config, signal: phase.abort.signal });
          const r = await runClaudeCode({
            ctx: this.loopCtx,
            config: this.config,
            session: this.session,
            // agent 传入供审批桥（canUseTool → userQuestions.ask）携带 agent 归属，
            // 否则 web provider 因「非 agent-owned session」拒绝弹窗（ASK_MISSING_AGENT）。
            agent: this,
            turn,
            prompt,
            signal: phase.abort.signal,
            cwd,
            executable,
            env,
            resumeSessionId: this.claudeSessionId,
            subagents: this.subagents,
          });
          if (r.claudeSessionId) {
            this.claudeSessionId = r.claudeSessionId;
            // 跨进程持久化，供 resume 精确续接同一 Claude 会话（fire-and-forget，失败静默）
            void saveClaudeSessionId(this.id, r.claudeSessionId);
          }
          this.session.append("turn/end", { turn, reason: this.#endReason(r) });
        } catch (error) {
          this.session.append("turn/end", {
            turn,
            reason: { kind: "error", error: { message: String(error?.message ?? error), code: "UNKNOWN" } },
          });
        }
      }
    } finally {
      this.setPhase({ kind: "idle", lastTurn: this.phase.lastTurn ?? this.phase.turn ?? 0 });
    }
  }

  #endReason(r) {
    if (r.stopReason === "aborted") return { kind: "aborted" };
    if (r.stopReason === "error") {
      const text = (r.output ?? []).map((b) => b.text ?? "").join(" ");
      return { kind: "error", error: { message: text || "Claude Code run failed", code: "CLAUDE_CODE_ERROR" } };
    }
    return { kind: "completed" };
  }
}
