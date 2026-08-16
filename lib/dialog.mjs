// lib/dialog.mjs — 桥接 Claude Code 的 request_user_dialog（AskUserQuestion 等）→ DSH userQuestions.ask。
//
// 机制：Claude Code 调用 AskUserQuestion 工具时，发 request_user_dialog control request，
// 由 onUserDialog 回调渲染对话框并返回用户选择。
//
// result 结构（从 SDK binary 反推，permission_ask_user_question dialog）：
//   { behavior: 'allow' | 'deny', answers: { [问题文本]: 答案字符串 }, custom? }
//   - behavior 是权限决定；
//   - answers 是「问题文本 → 答案」的映射（record），multi-select 答案用逗号分隔；
//   - custom 是用户键入的自由文本（代替选结构化选项）。

/** 候选 dialogKind（实测后按真实值收敛）。 */
export const SUPPORTED_DIALOG_KINDS = [
  "ask_user_question",
  "askUserQuestion",
  "permission_ask_user_question",
];

/** 从 payload 提取 questions 数组（payload 可能是 { questions: [...] }，也可能是直接数组）。 */
function extractQuestions(payload) {
  if (!payload || typeof payload !== "object") return [];
  const raw = Array.isArray(payload) ? payload : payload.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((q) => q && typeof q === "object" && ("question" in q || "header" in q));
}

/** 把一个 Claude 问题转成 DSH userQuestions.ask 的问题（保留 question 文本用于回填 answers 键）。 */
function toDshQuestion(q, index) {
  return {
    id: q.id ?? q.header ?? q.question ?? `q${index}`,
    question: typeof q.question === "string" ? q.question : "",
    ...(typeof q.header === "string" ? { header: q.header } : {}),
    ...(Array.isArray(q.options) && q.options.length
      ? { options: q.options.map((o) => ({ label: String(o?.label ?? ""), ...(o?.description ? { description: o.description } : {}) })) }
      : {}),
    ...(q.multiSelect ? { multiSelect: true } : {}),
  };
}

/** 把 DSH 答案转成 Claude 期望的 result（permission dialog result：{ behavior, answers }）。 */
function buildResult(dshAnswer, dshQuestions) {
  const answers = {};
  let custom;
  for (const q of dshQuestions) {
    const ans = dshAnswer?.answers?.find((a) => a.id === q.id);
    if (!ans) continue;
    if (ans.custom) {
      custom = ans.custom;
    } else if (Array.isArray(ans.selected) && ans.selected.length) {
      answers[q.question] = ans.selected.join(", ");
    }
  }
  return {
    behavior: "allow",
    answers,
    ...(custom ? { custom } : {}),
  };
}

/**
 * 生成 onUserDialog 回调。
 * @param ctx 主 cordis context（取 userQuestions 服务）
 * @param agent 当前 ClaudeCodeAgent（agent 归属，web provider 要求 agent-owned session）
 */
export function makeOnUserDialog(ctx, agent) {
  return async function onUserDialog(request, { signal } = {}) {
    ctx.logger?.info?.(`dsh-claude-code: onUserDialog kind=${request?.dialogKind} payloadKeys=${JSON.stringify(Object.keys(request?.payload ?? {}))}`);
    const rawQuestions = extractQuestions(request?.payload);
    if (!rawQuestions.length) return { behavior: "cancelled" };
    const dshQuestions = rawQuestions.map(toDshQuestion);
    let userQuestions;
    try {
      userQuestions = ctx.get("userQuestions");
    } catch {
      userQuestions = undefined;
    }
    if (!userQuestions) return { behavior: "cancelled" };
    try {
      const answer = await userQuestions.ask({ questions: dshQuestions, agent, ...(signal ? { signal } : {}) });
      ctx.logger?.info?.(`dsh-claude-code: onUserDialog answered=${JSON.stringify(answer)}`);
      return { behavior: "completed", result: buildResult(answer, dshQuestions) };
    } catch (error) {
      // NO_PROVIDER / CALLER_NOT_LIVE / 用户取消等 → cancelled，让 CLI 走默认行为
      ctx.logger?.warn?.(`dsh-claude-code: onUserDialog ask failed: ${String(error?.message ?? error)} code=${error?.code ?? ""}`);
      return { behavior: "cancelled" };
    }
  };
}
