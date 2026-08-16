// lib/auth.mjs — claude 可执行解析 + 子进程 env 合成（双通道认证）。
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";

/**
 * 解析原生 claude 可执行，并合成传给 Claude Agent SDK 的 env。
 * SDK 的 env 是「整体替换」子进程环境，故必须合并 scrubbedParentEnv()（清除凭据后的父环境）
 * 再叠加显式配置（如 ANTHROPIC_API_KEY）。
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
  const env = { ...scrubbedParentEnv(), ...(config.env ?? {}) };
  return { executable, env };
}
