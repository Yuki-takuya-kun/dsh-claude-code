// lib/auth.mjs — claude 可执行解析 + 子进程 env 合成（双通道认证）。
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";

/**
 * 从父环境取回 Anthropic 专属环境变量（`ANTHROPIC_*`）。
 * scrubbedParentEnv() 会剥掉名字含 KEY/TOKEN/SECRET/PASSWORD 的变量（如
 * `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`），但 claude 子进程恰恰需要这些凭据才能
 * 认证代理端点，并回报 token 用量 / modelUsage（缺了它们，兼容端点会把 usage 全报 0）。
 * 因此在 scrub 之后再补回父环境的 `ANTHROPIC_*`，最后仍由 config.env 覆盖。
 */
export function anthropicEnvFromParent() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.startsWith("ANTHROPIC_")) env[key] = value;
  }
  return env;
}

/**
 * 解析原生 claude 可执行，并合成传给 Claude Agent SDK 的 env。
 * SDK 的 env 是「整体替换」子进程环境：先合并 scrubbedParentEnv()（清除无关凭据后的父环境），
 * 再补回 claude 必需的 `ANTHROPIC_*` 凭据（见 {@link anthropicEnvFromParent}），
 * 最后叠加显式配置（如覆盖 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN）。
 */
export async function resolveClaude({ ctx, config, signal }) {
  const target = config.executable ?? "claude";
  // 含路径分隔符视为直接可执行路径（shim/绝对路径），否则按 PATH 解析
  // 用 ctx.get("subprocess")（通用访问）而非 ctx.subprocess：engine 的 loopCtx 来自路由层，
  // 未必 inject subprocess，直接属性访问会抛「without inject」。
  const subprocess = ctx.get("subprocess");
  const executable = target.includes("/")
    ? target
    : await subprocess.resolveExecutable(target, config.env ?? {}, signal);
  const env = { ...scrubbedParentEnv(), ...anthropicEnvFromParent(), ...(config.env ?? {}) };
  return { executable, env };
}
