// lib/permission.mjs — 读 DSH 会话权限状态（sandbox/mode + approval/policy），
// 并把它们映射成 canUseTool 策略。纯 fold + 纯判断，零新增依赖，可单测。
//
// 事件结构（与官方 effectiveSandboxMode / effectiveApprovalPolicy 语义等价）：
//   "sandbox/mode"    → data.mode   : 'read-only' | 'workspace-write' | 'danger-full-access'
//   "approval/policy" → data.policy : 'ask' | 'never'
// 这两个事件在 DSH 会话创建时由 permission-presets 钉进事件流，运行中不变。
import path from "node:path";

/** 读会话最后的 sandbox/mode 与 approval/policy 事件；无事件时为 undefined。 */
export function readPermission(session) {
  let mode;
  let policy;
  for (const event of session?.events ?? []) {
    if (event.type === "sandbox/mode") mode = event.data?.mode;
    else if (event.type === "approval/policy") policy = event.data?.policy;
  }
  return { mode, policy };
}

/** 判断路径 p 是否落在工作区根目录 cwd 内（含 cwd 本身）。 */
export function isWithinWorkspace(cwd, p) {
  if (!cwd || !p) return false;
  const rel = path.relative(path.resolve(cwd), path.resolve(p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 把 DSH 权限映射成 SDK 策略：
 *  - "bypass"      danger-full-access → permissionMode=bypassPermissions，完全跳过权限/沙箱
 *  - "no-prompt"   approval policy=never → 无交互：区内放行、区外拒绝
 *  - "ask"         其余（workspace-write/read-only + ask，或缺省）→ 弹 DSH 审批
 */
export function permissionStrategy({ mode, policy }) {
  if (mode === "danger-full-access") return "bypass";
  if (policy === "never") return "no-prompt";
  return "ask";
}
