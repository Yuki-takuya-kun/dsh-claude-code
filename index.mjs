// index.mjs — dsh-claude-code：把 Claude Code 注册成 dsh-engine-switch 的一个引擎。
// 本插件不再自己替换 ctx.agents.factory；它只定义 claude-code 引擎（ClaudeCodeAgent + 预设），
// 交给 dsh-engine-switch 负责 preset → 引擎路由、空白会话内 swap、resume 续接。
import { fileURLToPath } from "node:url";
import { ClaudeCodeAgent } from "./lib/agent.mjs";
import { load as loadClaudeSessionId } from "./lib/store.mjs";

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
  env: {},
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
  ctx.logger?.info?.(`dsh-claude-code: registered engine "${CLAUDE_CODE_ENGINE_ID}"`);
}
