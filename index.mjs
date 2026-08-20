// index.mjs — dsh-claude-code：把 Claude Code 注册成 dsh-engine-switch 的一个引擎。
// 本插件不再自己替换 ctx.agents.factory；它只定义 claude-code 引擎（ClaudeCodeAgent + 预设），
// 交给 dsh-engine-switch 负责 preset → 引擎路由、空白会话内 swap、resume 续接。
import { fileURLToPath } from "node:url";
import { ClaudeCodeAgent } from "./lib/agent.mjs";
import { load as loadClaudeSessionId } from "./lib/store.mjs";
import { ClaudeCodeLlmRoute, CLAUDE_CODE_PROVIDER } from "./lib/llm-route.mjs";

export const name = "dsh-claude-code";
export const inject = ["engineSwitch"];

/** 引擎 id，同时是预设目录名（dsh-engine-switch 按 id 落地预设并做 by-id 路由）。 */
export const CLAUDE_CODE_ENGINE_ID = "claude-code";

const PRESET_DIR = fileURLToPath(new URL("./presets/claude-code/", import.meta.url));

/** 引擎私有配置默认值（覆盖在 dsh-engine-switch 的 config.engines["claude-code"] 之上）。 */
const DEFAULTS = {
  executable: "claude",
  persistSession: true,
  includePartialMessages: true,
  // 追踪 Claude Code 内部子代理（Agent/Task 工具 spawn）为独立 DSH 子 session。
  traceSubagents: true,
  env: {},
  // 可选：手动指定模型上下文窗口（token 数）。result.modelUsage 取不到时兜底。
  contextWindow: undefined,
};

const claudeCodeEngine = {
  id: CLAUDE_CODE_ENGINE_ID,
  name: "Claude Code",
  description: "由本机 Claude Code CLI 驱动会话，工具与沙箱均来自 Claude Code。",
  presetDir: PRESET_DIR,

  makeAgent(loopCtx, id, options, session, engineConfig, resumeState) {
    const config = { ...DEFAULTS, ...(engineConfig ?? {}) };
    const machine = new ClaudeCodeAgent(loopCtx, id, options, session, config);
    // resume 路径：恢复上一进程捕获的 Claude 会话 id，让首轮续接同一 Claude 会话
    if (resumeState?.claudeSessionId) {
      machine.claudeSessionId = resumeState.claudeSessionId;
    }
    return machine;
  },

  async resolveResumeState(_loopCtx, options) {
    const claudeSessionId = await loadClaudeSessionId(options.resumeSessionId);
    return { claudeSessionId };
  },
};

export function apply(ctx) {
  ctx.engineSwitch.register(claudeCodeEngine);

  // 注册休眠的 `claude-code` LLM 路由，让前端模型选择把该 provider 判为「已服务」，
  // 否则 trace.mjs 写进 request/header 的 `provider: "claude-code"` 会触发输入框拦截
  // （routeServed 只查 ctx.llm.listProviders()）。无 llm 注册表时无需注册——routeServed
  // 对「无 llm」本身即判已服务。注册随本插件 fiber 释放。
  const llm = ctx.get("llm");
  if (llm !== undefined) {
    ctx.effect(() => {
      const unregister = llm.registerAdapter([CLAUDE_CODE_PROVIDER], new ClaudeCodeLlmRoute());
      return () => { unregister(); };
    }, "dsh-claude-code: llm route");
  }

  ctx.logger?.info?.(`dsh-claude-code: registered engine "${CLAUDE_CODE_ENGINE_ID}"`);
}
