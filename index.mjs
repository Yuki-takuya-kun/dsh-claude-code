// index.mjs — dsh-claude-code 插件入口：enabled 时把顶层会话主循环交给 Claude Code。
// 子代理与 resume 委托回原 AgentLoop（DeepSeek）。
import z from "@deepseek-ai/schemastery";
import { SessionPreparation } from "@deepseek-ai/dsh-session";
import { emitAgentEvent } from "@deepseek-ai/dsh-agent";
import { ClaudeCodeAgent } from "./lib/agent.mjs";

export const name = "dsh-claude-code";
export const inject = ["agents", "sessions", "subprocess"];

export const Config = z.object({
  enabled: z.boolean().default(false),
  // Claude Code 可执行：默认从 PATH 解析 claude。
  executable: z.string().default("claude"),
  persistSession: z.boolean().default(true),
  includePartialMessages: z.boolean().default(true),
  env: z.dict(z.string()).default({}),
});

/** 工厂：createAgent/resume 与 AgentLoop 同契约，但驱动换成 Claude Code。 */
class ClaudeCodeFactory {
  constructor(ctx, config, originalFactory) {
    this.loopCtx = ctx;
    this.config = config;
    this.original = originalFactory;
  }

  // ── 工厂契约 ──────────────────────────────────────────────
  async createAgent(ownerCtx, options) {
    // 子代理会话始终委托回原循环（DeepSeek），与顶层开关无关
    if (options?.meta?.origin === "subagent" && this.original) {
      return this.original.createAgent(ownerCtx, options);
    }
    // 全局 Claude：enabled 时，所有新顶层会话由 Claude Code 驱动
    if (this.config.enabled) {
      const preparation = SessionPreparation.create(
        this.loopCtx.sessions.prepare(options.sessionId, {
          ...(options.seed === undefined ? {} : { seed: options.seed }),
          ...(options.meta === undefined ? {} : { meta: options.meta }),
        })
      );
      return this.setupAndPublish(ownerCtx, options.sessionId, preparation, options.agentOptions ?? {}, undefined, options.signal, "startup");
    }
    // disabled：委托回原循环（DeepSeek）
    if (this.original) {
      return this.original.createAgent(ownerCtx, options);
    }
    throw new Error("dsh-claude-code: no original factory to delegate");
  }

  async resume(ownerCtx, options) {
    // v1：持久化会话的 resume 委托回原循环（DeepSeek）
    if (this.original) return this.original.resume(ownerCtx, options);
    throw new Error("dsh-claude-code: no original factory to delegate resume");
  }

  // ── 复刻 AgentLoop.prepare/setupAndPublish（用 ClaudeCodeAgent 代替 ReactLoopAgent） ──
  prepare(ownerCtx, id, agentOptions, session, callerSignal) {
    const loopCtx = this.loopCtx;
    const abort = new AbortController();
    const onCallerAbort = () => abort.abort(callerSignal?.reason instanceof Error ? callerSignal.reason : new Error(`agent "${id}" creation aborted`));
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    let machine;
    let detachSession;
    let detachAgent;
    let disposing;
    const machineReady = Promise.withResolvers();
    const dispose = () => disposing ??= (async () => {
      abort.abort(new Error(`agent "${id}" lifecycle disposed`));
      callerSignal?.removeEventListener("abort", onCallerAbort);
      try {
        if (machine === undefined) await machineReady.promise;
        if (machine !== undefined) {
          machine.cancel({ kind: "disposed" });
          await machine.whenIdle();
          await machine.scope.dispose();
        }
      } finally {
        try {
          detachAgent?.();
          detachSession?.();
        } catch {
          /* 忽略 detach 失败 */
        }
      }
    })();
    try {
      machine = new ClaudeCodeAgent(loopCtx, id, agentOptions, session, this.config);
      machineReady.resolve();
      return {
        agent: machine,
        signal: abort.signal,
        publish: (source) => {
          detachSession = machine.ctx.sessions.enter(session);
          detachAgent = loopCtx.agents.enter(machine, ownerCtx.agent);
          machine.ctx.sessions.announce(session);
          loopCtx.agents.announce(machine);
          emitAgentEvent(loopCtx, machine, "agent/session-start", { source });
          return { agent: machine, dispose };
        },
        dispose,
      };
    } catch (error) {
      machineReady.resolve();
      void dispose();
      throw error;
    }
  }

  async setupAndPublish(ownerCtx, id, preparation, agentOptions, setup, signal, source) {
    const session = preparation.session;
    const prepared = this.prepare(ownerCtx, id, agentOptions, session, signal);
    try {
      const committed = await setup?.(prepared.agent.ctx);
      committed?.commit?.();
      return prepared.publish(source);
    } catch (error) {
      await prepared.dispose();
      throw error;
    }
  }
}

export function apply(ctx, config) {
  if (!config.enabled) {
    ctx.logger?.info?.("dsh-claude-code: disabled (enabled=false) — DeepSeek loop unchanged");
    return;
  }
  const original = ctx.agents.factory?.target;
  if (original === undefined) {
    ctx.logger?.warn?.("dsh-claude-code: no agent factory registered to replace");
    return;
  }
  const claudeFactory = new ClaudeCodeFactory(ctx, config, original);
  ctx.agents.factory = { target: claudeFactory };
  ctx.logger?.info?.(`dsh-claude-code: enabled — replaced agent factory (executable: ${config.executable ?? "claude"})`);
  return () => {
    if (ctx.agents.factory?.target === claudeFactory) {
      ctx.agents.factory = original === undefined ? undefined : { target: original };
    }
  };
}
