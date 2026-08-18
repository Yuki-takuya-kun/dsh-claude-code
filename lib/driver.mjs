// lib/driver.mjs — 跑一次 Claude Code query()，把轨迹经 ClaudeRunTracer 实时写进会话。
// 支持跨轮复用：传入 resumeSessionId 续接上一轮；首轮捕获 system/init 的 session_id 返回。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRunTracer } from "./trace.mjs";
import { makeCanUseTool } from "./approval.mjs";
import { readPermission, permissionStrategy } from "./permission.mjs";
import { makeOnUserDialog, SUPPORTED_DIALOG_KINDS } from "./dialog.mjs";

/** 把 session 包装成 tracer 需要的 sink（append 返回带 seq 的事件；requestContext 供 request/context 去重）。 */
function sessionSink(session) {
  return {
    append: (type, data, opts) => session.append(type, data, opts),
    requestContext: () => session.requestContext(),
  };
}

/**
 * 运行一次 Claude Code 并实时转写轨迹。
 * @param resumeSessionId 上一轮捕获的 Claude 会话 id（首轮省略，之后传入以复用）
 * @returns { output, stopReason, claudeSessionId }
 *   stopReason ∈ 'completed' | 'aborted' | 'error'
 */
export async function runClaudeCode({ ctx, config, session, agent, turn, prompt, signal, cwd, executable, env, resumeSessionId }) {
  const tracer = new ClaudeRunTracer(sessionSink(session), turn, { contextWindow: config.contextWindow });
  const controller = new AbortController();
  const requestCancel = () => {
    if (!controller.signal.aborted) controller.abort(new Error("dsh-claude-code: run cancelled locally"));
  };
  const onAbort = () => requestCancel();
  signal.addEventListener("abort", onAbort, { once: true });

  // 回合起点的权限快照，只用于决定是否启用 permissionMode=bypassPermissions；
  // 其余策略统一走 canUseTool，不在此处固化回合内权限
  const strategy = permissionStrategy(readPermission(session));
  // canUseTool 每次调用重读会话权限：回合中切 preset 立即生效（见 makeCanUseTool）
  const canUseTool = makeCanUseTool(ctx, { cwd, session, agent });
  // AskUserQuestion（Claude 多选项）→ 桥接 DSH userQuestions.ask（不再禁用）
  const onUserDialog = makeOnUserDialog(ctx, agent);

  const options = {
    abortController: controller,
    cwd,
    pathToClaudeCodeExecutable: executable,
    env,
    persistSession: config.persistSession !== false,
    includePartialMessages: config.includePartialMessages !== false,
    // danger-full-access（回合起点）：完全跳过 Claude 权限/沙箱（文件写入、Bash 等全放行）
    ...(strategy === "bypass"
      ? { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true }
      : { canUseTool }),
    // 用户对话框（AskUserQuestion）桥接；supportedDialogKinds 是候选值，实测后收敛
    onUserDialog,
    supportedDialogKinds: SUPPORTED_DIALOG_KINDS,
  };
  // 复用上一轮的 Claude 会话
  if (resumeSessionId) options.resume = resumeSessionId;

  let finalResult = "";
  let claudeSessionId = resumeSessionId;
  try {
    const q = query({ prompt, options });
    for await (const message of q) {
      // 首轮从 system/init 捕获会话 id
      if (message.type === "system" && message.subtype === "init" && typeof message.session_id === "string") {
        claudeSessionId = message.session_id;
      }
      tracer.handleMessage(message);
      if (message.type === "result" && message.subtype === "success" && typeof message.result === "string") {
        finalResult = message.result;
      }
      if (controller.signal.aborted) break;
    }
    tracer.finish();
    if (controller.signal.aborted) {
      return { output: [], stopReason: "aborted", claudeSessionId };
    }
    return { output: [{ type: "text", text: finalResult }], stopReason: "completed", claudeSessionId };
  } catch (error) {
    tracer.finish();
    if (controller.signal.aborted || signal.aborted) {
      return { output: [], stopReason: "aborted", claudeSessionId };
    }
    return {
      output: [{ type: "text", text: String(error?.message ?? error) }],
      stopReason: "error",
      claudeSessionId,
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      controller.abort();
    } catch {
      // 已中止则忽略
    }
  }
}

export { query };
