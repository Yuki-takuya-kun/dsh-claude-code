// lib/approval.mjs — Claude SDK canUseTool → DSH 审批 seam（ctx.approval.request）。
// 无应答者 / 异常时 fail-closed（deny）。
//
// 契约（@anthropic-ai/claude-agent-sdk@0.3.220 的 CanUseTool）：
//   回调必须返回 PermissionResult 对象，而非字符串：
//     { behavior: 'allow', updatedInput?, updatedPermissions?, toolUseID? }
//     { behavior: 'deny', message: string, interrupt?, toolUseID? }
import { isWithinWorkspace, readPermission, permissionStrategy } from "./permission.mjs";

/** 从工具 input 里提取最可读的「要干什么」摘要（bash 命令 / 文件路径 / url 等）。 */
function inputSummary(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input !== "object") return String(input);
  for (const key of ["command", "file_path", "path", "url", "pattern", "query"]) {
    const value = input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return JSON.stringify(input);
}

/**
 * 桥接 AskUserQuestion：SDK 的 request_user_dialog 机制在 headless 下未能可靠触发
 * （无论 canUseTool 返回 allow 还是 null，都得到 "did not answer"），故直接在 canUseTool
 * 里弹 DSH 选择题，把答案作为 deny 的 message 返回——Claude 能从 message 读到用户选择。
 */
async function bridgeAskUserQuestion(ctx, agent, input, signal) {
  let userQuestions;
  try {
    userQuestions = ctx.get("userQuestions");
  } catch {
    userQuestions = undefined;
  }
  if (!userQuestions || !agent) {
    return { behavior: "deny", message: "dsh-claude-code: no user-questions provider or agent for AskUserQuestion" };
  }
  try {
    const dshQuestions = (input?.questions ?? []).map((q, i) => ({
      id: q?.header ?? q?.question ?? `q${i}`,
      question: typeof q?.question === "string" ? q.question : "",
      ...(typeof q?.header === "string" ? { header: q.header } : {}),
      ...(Array.isArray(q?.options) && q.options.length
        ? { options: q.options.map((o) => ({ label: String(o?.label ?? ""), ...(o?.description ? { description: o.description } : {}) })) }
        : {}),
      ...(q?.multiSelect ? { multiSelect: true } : {}),
    }));
    if (!dshQuestions.length) {
      return { behavior: "deny", message: "dsh-claude-code: AskUserQuestion without questions" };
    }
    const answer = await userQuestions.ask({ questions: dshQuestions, agent, ...(signal ? { signal } : {}) });
    const summary = (answer?.answers ?? [])
      .map((a) => {
        const value = a?.custom ?? (Array.isArray(a?.selected) ? a.selected.join(", ") : "");
        return value ? `${a.id ?? "?"}: ${value}` : "";
      })
      .filter(Boolean)
      .join("; ");
    return { behavior: "deny", message: summary || "（未选择）" };
  } catch (error) {
    return { behavior: "deny", message: String(error?.message ?? error) };
  }
}

/**
 * 生成 canUseTool 回调。每次工具调用都重读会话最新权限（readPermission），
 * 因此回合中把 preset 切成 Full access（danger-full-access）或 never 时，
 * 后续工具调用立即按新策略判定，而不是沿用回合开始时的快照。
 * @param ctx 主 cordis context（取 approval / userQuestions 服务）
 * @param {cwd, session, agent} cwd 会话工作区根目录；session 供每次调用重读权限；
 *   agent 为当前 ClaudeCodeAgent，供 approval.request / userQuestions.ask 定位所属会话
 * @returns canUseTool 回调（strategy 每次现算；driver 在回合起点已是 bypass 时改用 permissionMode=bypassPermissions，不挂本回调）
 */
export function makeCanUseTool(ctx, { cwd, session, agent } = {}) {
  return async function canUseTool(toolName, input, { signal, title, displayName, blockedPath, decisionReason } = {}) {
    // 每次重读：回合中切 Full access / never 立即生效
    const strategy = permissionStrategy(readPermission(session));
    // danger-full-access：完全放行（回合起点已 bypass 时不走这里，见 driver）
    if (strategy === "bypass") {
      return { behavior: "allow" };
    }
    // AskUserQuestion：直接在 canUseTool 里弹 DSH 选择题，答案经 deny message 返回给 Claude。
    if (toolName === "AskUserQuestion") {
      return await bridgeAskUserQuestion(ctx, agent, input, signal);
    }
    // 区内放行：有明确路径且落在工作区内（workspace-write / no-prompt 共用）
    if (blockedPath && isWithinWorkspace(cwd, blockedPath)) {
      return { behavior: "allow" };
    }
    // no-prompt（approval policy=never）：不弹窗，区外一律拒绝
    if (strategy === "no-prompt") {
      return { behavior: "deny", message: `dsh-claude-code: denied by approval policy (never) for tool ${toolName}` };
    }
    // ask：DSH 原生审批 seam → 等待审批，允许一次 / 拒绝
    if (!agent) {
      return { behavior: "deny", message: "dsh-claude-code: no live agent for approval" };
    }
    let approval;
    try {
      approval = ctx.get("approval");
    } catch {
      approval = undefined;
    }
    if (!approval) {
      return { behavior: "deny", message: "dsh-claude-code: no approval service (dsh-user-approval not composed)" };
    }
    try {
      // 审批 UI 只显示 toolName + reason，故把「具体命令/路径/为什么」都拼进 reason，避免只显示 "Bash"。
      const reason = [
        inputSummary(input),
        decisionReason ?? title ?? displayName,
        blockedPath ? `path: ${blockedPath}` : "",
      ].filter(Boolean).join(" · ");
      const outcome = await approval.request({
        agent,
        toolName,
        ...(reason ? { reason } : {}),
        ...(signal ? { signal } : {}),
      });
      return outcome === "allowed-once"
        ? { behavior: "allow" }
        : { behavior: "deny", message: `dsh-claude-code: approval ${outcome}` };
    } catch (error) {
      // open-turn 缺失 / 审计 append 失败 / answerer 异常 → fail closed
      return { behavior: "deny", message: String(error?.message ?? error) };
    }
  };
}
