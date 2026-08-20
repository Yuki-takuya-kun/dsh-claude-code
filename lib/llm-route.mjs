// lib/llm-route.mjs — 把 `claude-code` 注册成一个「休眠」的 LLM provider 路由。
//
// 背景：DSH 前端的模型选择/输入框拦截（ui-model-selection 的 `routeServed`）只认
// `ctx.llm.listProviders()`，把它当作「当前 provider 是否有 adapter 服务」的唯一事实。
// 而 Claude Code 是走 dsh-engine-switch 注册的**引擎**，从不进 `ctx.llm`。trace.mjs 会
// 把 `provider: "claude-code"` 写进会话的 request/header（用于用量归因），于是首轮之后
// `session.models` 读到该 provider → `routeServed("claude-code")` 返回 false → 前端锁死
// 输入框，显示「当前模型不可用，请先选择模型」。
//
// 本路由只为了让 `listProviders()` 包含 `claude-code`，从而 `routeServed` 判定为已服务；
// 它**从不真正转发请求**——claude-code 会话由 Claude Code CLI 驱动，不经 ctx.llm。
// 因此 stream() 直接抛错，作为「误入此路由」的显式兜底，而不是静默吞掉。
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

/** 与 dsh-claude-code 引擎 id、以及 trace.mjs 写入 header 的 provider 一致。 */
export const CLAUDE_CODE_PROVIDER = "claude-code";

/**
 * 休眠的 Claude Code LLM 路由：只贡献 provider 目录，不承载任何流式调用。
 * listModels 沿用默认空列表（空组会被目录层剔除，不影响 routeServed），
 * resolveModel 沿用默认透传，只有 stream 是显式禁用。
 */
export class ClaudeCodeLlmRoute extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: "Claude Code" };
  }

  stream() {
    throw new Error(
      "dsh-claude-code: claude-code sessions are driven by the Claude Code CLI, not the dsh llm adapter",
    );
  }
}
