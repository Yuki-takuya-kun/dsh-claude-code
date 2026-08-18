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

test("canUseTool: approval policy 从 ask 切到 never 后，区外调用改为 no-prompt 拒绝且不再发起审批", async () => {
  const events = [
    { type: "sandbox/mode", data: { mode: "workspace-write" } },
    { type: "approval/policy", data: { policy: "ask" } },
  ];
  const asked = [];
  const approval = {
    request: async (req) => {
      asked.push(req.toolName);
      return "allowed-once";
    },
  };
  const canUseTool = makeCanUseTool(makeCtx(approval), {
    cwd: "/tmp/ws",
    session: { events },
    agent: { id: "a" },
  });

  // 仍是 ask：区外调用走审批 seam
  const before = await canUseTool("Bash", { command: "cat /etc/hostname" }, {});
  assert.equal(before.behavior, "allow");
  assert.deepEqual(asked, ["Bash"]);

  // 用户把 approval policy 从 ask 改为 never
  events.push({ type: "approval/policy", data: { policy: "never" } });

  const after = await canUseTool("Bash", { command: "cat /etc/hostname" }, {});
  assert.equal(after.behavior, "deny");
  assert.match(after.message, /denied by approval policy \(never\)/);
  assert.deepEqual(asked, ["Bash"], "切到 never 后不应再发起审批请求");
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
