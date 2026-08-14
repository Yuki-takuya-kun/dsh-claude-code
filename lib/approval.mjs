// lib/approval.mjs — Claude SDK canUseTool → DSH 审批 UI（ctx.userQuestions.ask）。
// 无应答者 / 异常时 fail-closed（deny）。

export function makeCanUseTool(ctx) {
  return async function canUseTool(toolName, input, { signal } = {}) {
    let questions;
    try {
      questions = ctx.get("userQuestions");
    } catch {
      questions = undefined;
    }
    if (!questions) return "deny";
    try {
      const detail = JSON.stringify(input ?? {}).slice(0, 500);
      const result = await questions.ask({
        questions: [{
          id: "allow-tool",
          header: "Claude Code 请求执行工具：" + toolName,
          question: "是否允许 Claude Code 执行工具 " + toolName + "？\n输入：" + detail,
          options: [
            { label: "允许" },
            { label: "拒绝" },
          ],
        }],
        ...(signal ? { signal } : {}),
      });
      const selected = result?.answers?.[0]?.selected?.[0];
      return selected === "允许" ? "allow" : "deny";
    } catch {
      return "deny"; // NO_PROVIDER / aborted 等 → fail closed
    }
  };
}
