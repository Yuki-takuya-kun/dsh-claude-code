// test/approval.test.mjs — makeCanUseTool 的纯单测：每次调用重读会话权限。
import test from "node:test";
import assert from "node:assert/strict";
import { makeCanUseTool } from "../lib/approval.mjs";

/** 最小 ctx：只提供 makeCanUseTool 用到的 approval 服务。 */
function makeCtx(approval) {
  return {
    get(name) {
      return name === "approval" ? approval : undefined;
    },
  };
}

test("canUseTool: workspace-write + ask 时 Bash 走审批，拒绝则返回 approval rejected", async () => {
  const events = [
    { type: "sandbox/mode", data: { mode: "workspace-write" } },
    { type: "approval/policy", data: { policy: "ask" } },
  ];
  const asked = [];
  const approval = {
    request: async (req) => {
      asked.push(req.toolName);
      return "rejected";
    },
  };
  const canUseTool = makeCanUseTool(makeCtx(approval), {
    cwd: "/tmp/ws",
    session: { events },
    agent: { id: "a" },
  });

  const result = await canUseTool("Bash", { command: "cat /etc/hostname" }, {});
  assert.equal(result.behavior, "deny");
  assert.match(result.message, /approval rejected/);
  assert.deepEqual(asked, ["Bash"]);
});

test("canUseTool: 回合中切到 danger-full-access 后，后续调用直接放行且不再问审批", async () => {
  const events = [
    { type: "sandbox/mode", data: { mode: "workspace-write" } },
    { type: "approval/policy", data: { policy: "ask" } },
  ];
  const asked = [];
  const approval = {
    request: async (req) => {
      asked.push(req.toolName);
      return "rejected";
    },
  };
  const canUseTool = makeCanUseTool(makeCtx(approval), {
    cwd: "/tmp/ws",
    session: { events },
    agent: { id: "a" },
  });

  // 首次仍走审批并拒绝
  await canUseTool("Bash", { command: "cat /etc/hostname" }, {});

  // 回合中用户切到 Full access
  events.push({ type: "sandbox/mode", data: { mode: "danger-full-access" } });

  const result = await canUseTool("Bash", { command: "cat /etc/hostname" }, {});
  assert.equal(result.behavior, "allow");
  assert.deepEqual(asked, ["Bash"], "切换后不应再发起审批请求");
});

test("canUseTool: 回合中切到 never 后，区外调用按 no-prompt 拒绝", async () => {
  const events = [
    { type: "sandbox/mode", data: { mode: "workspace-write" } },
    { type: "approval/policy", data: { policy: "ask" } },
  ];
  const approval = { request: async () => "allowed-once" };
  const canUseTool = makeCanUseTool(makeCtx(approval), {
    cwd: "/tmp/ws",
    session: { events },
    agent: { id: "a" },
  });

  events.push({ type: "approval/policy", data: { policy: "never" } });

  const result = await canUseTool("Bash", { command: "cat /etc/hostname" }, {});
  assert.equal(result.behavior, "deny");
  assert.match(result.message, /denied by approval policy \(never\)/);
});

test("canUseTool: 工作区内的路径在 workspace-write 下直接放行", async () => {
  const events = [{ type: "sandbox/mode", data: { mode: "workspace-write" } }];
  const approval = { request: async () => "rejected" };
  const canUseTool = makeCanUseTool(makeCtx(approval), {
    cwd: "/tmp/ws",
    session: { events },
    agent: { id: "a" },
  });

  const result = await canUseTool("Read", { file_path: "/tmp/ws/a.txt" }, { blockedPath: "/tmp/ws/a.txt" });
  assert.equal(result.behavior, "allow");
});
