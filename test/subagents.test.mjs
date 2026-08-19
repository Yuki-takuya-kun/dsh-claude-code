// test/subagents.test.mjs — SubagentSessionManager 与 isSubagentMessage 的单测。
// mock 掉 sessions store / ctx，只验证「Agent/Task 工具调用 → 独立子 session 的事件序列」。
import test from "node:test";
import assert from "node:assert/strict";
import { isSubagentMessage, SUBAGENT_TOOL_NAMES } from "../lib/trace.mjs";
import { SubagentSessionManager } from "../lib/subagents.mjs";

function mockSession(meta) {
  const events = [];
  let seq = 0;
  return {
    id: meta?.id ?? "session-child",
    header: meta ?? {},
    events,
    detached: false,
    append(type, data, opts) {
      const ev = { seq: seq++, type, data, ...(opts ?? {}) };
      events.push(ev);
      return ev;
    },
  };
}

function mockCtx() {
  const created = [];
  const sessions = {
    created,
    prepare(_id, { meta }) {
      const session = mockSession(meta);
      created.push(session);
      return session;
    },
    enter(session) {
      return () => { session.detached = true; };
    },
    announce() {},
    flush() { return Promise.resolve(true); },
  };
  return {
    ctx: { get: (name) => (name === "sessions" ? sessions : undefined), effect: (cb) => cb },
    sessions,
    created,
  };
}

const MAIN = { id: "main", header: { cwd: "/work" } };

function typesOf(session) {
  return session.events.map((e) => e.type);
}

function spawnMsg(toolUseId, input = {}) {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id: toolUseId, name: "Agent", input }] },
  };
}

function forwardedMsg(toolUseId, content) {
  return {
    type: "assistant",
    parent_tool_use_id: toolUseId,
    message: { content, model: "claude-sonnet-4-5" },
  };
}

function resultMsg(toolUseId, isError = false) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text: "ok" }], is_error: isError }] },
  };
}

test("SUBAGENT_TOOL_NAMES covers Agent and Task", () => {
  assert.equal(SUBAGENT_TOOL_NAMES.has("Agent"), true);
  assert.equal(SUBAGENT_TOOL_NAMES.has("Task"), true);
  assert.equal(SUBAGENT_TOOL_NAMES.has("Bash"), false);
});

test("isSubagentMessage classifies task lifecycle + forwarded messages", () => {
  assert.equal(isSubagentMessage({ type: "system", subtype: "task_started" }), true);
  assert.equal(isSubagentMessage({ type: "system", subtype: "task_notification" }), true);
  assert.equal(isSubagentMessage({ type: "system", subtype: "task_progress" }), true);
  assert.equal(isSubagentMessage({ type: "system", subtype: "task_updated" }), true);
  assert.equal(isSubagentMessage({ type: "system", subtype: "init" }), false);
  assert.equal(isSubagentMessage({ type: "assistant", parent_tool_use_id: "tu_1" }), true);
  assert.equal(isSubagentMessage({ type: "user", parent_tool_use_id: "tu_1" }), true);
  assert.equal(isSubagentMessage({ type: "stream_event", parent_tool_use_id: "tu_1" }), true);
  assert.equal(isSubagentMessage({ type: "assistant", parent_tool_use_id: null }), false);
  assert.equal(isSubagentMessage({ type: "assistant" }), false);
});

test("Agent tool_use spawn + forwarded + tool_result writes a child session trajectory", () => {
  const { ctx, created } = mockCtx();
  const mgr = new SubagentSessionManager(ctx, { mainSession: MAIN, cwd: "/work" });

  // 主线程 Agent 工具调用（无任何 task_* 系统消息）
  assert.equal(mgr.handleMessage(spawnMsg("tu_1", { description: "research", subagent_type: "general-purpose" })), false);
  assert.equal(mgr.handleMessage(forwardedMsg("tu_1", [{ type: "text", text: "hi" }])), true);
  // 主线程 tool_result 收尾（仍返回 false 交由主 tracer 处理）
  assert.equal(mgr.handleMessage(resultMsg("tu_1")), false);
  mgr.finishRun();

  assert.equal(created.length, 1);
  const child = created[0];
  assert.equal(child.header.parentSession, "main");
  assert.equal(child.header.origin, "subagent");
  assert.equal(child.header.delegationDepth, 1);
  assert.equal(child.header.cwd, "/work");

  assert.deepEqual(typesOf(child), [
    "subagent/descriptor", "turn/start",
    "step/start", "assistant/message", "step/end",
    "turn/end",
  ]);
  const descriptor = child.events.find((e) => e.type === "subagent/descriptor");
  assert.equal(descriptor.data.mode, "one-shot");
  assert.equal(descriptor.data.provider, "claude-code");
  assert.equal(descriptor.data.label, "research");
  const end = child.events.find((e) => e.type === "turn/end");
  assert.deepEqual(end.data.reason, { kind: "completed" });
});

test("Task tool name (legacy) also spawns a child", () => {
  const { ctx, created } = mockCtx();
  const mgr = new SubagentSessionManager(ctx, { mainSession: MAIN, cwd: "/work" });
  mgr.handleMessage({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id: "tu_2", name: "Task", input: { description: "legacy" } }] },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].events.find((e) => e.type === "subagent/descriptor").data.label, "legacy");
});

test("background subagent stays open across finishRun and closes on later tool_result", () => {
  const { ctx, created } = mockCtx();
  const mgr = new SubagentSessionManager(ctx, { mainSession: MAIN, cwd: "/work" });

  mgr.handleMessage(spawnMsg("tu_1", { description: "bg", run_in_background: true }));
  mgr.finishRun();
  // 后台：finishRun 后仍未闭合
  assert.ok(!typesOf(created[0]).includes("turn/end"));
  // 后续轮送达父 tool_result → 收尾
  mgr.handleMessage(resultMsg("tu_1"));
  assert.ok(typesOf(created[0]).includes("turn/end"));
  assert.deepEqual(created[0].events.find((e) => e.type === "turn/end").data.reason, { kind: "completed" });
});

test("missing spawn lazily creates child keyed by parent_tool_use_id", () => {
  const { ctx, created } = mockCtx();
  const mgr = new SubagentSessionManager(ctx, { mainSession: MAIN, cwd: "/work" });
  mgr.handleMessage(forwardedMsg("tu_x", [{ type: "text", text: "x" }]));
  assert.equal(created.length, 1);
  assert.equal(created[0].header.origin, "subagent");
});

test("tool_result error marks the child turn end as error", () => {
  const { ctx, created } = mockCtx();
  const mgr = new SubagentSessionManager(ctx, { mainSession: MAIN, cwd: "/work" });
  mgr.handleMessage(spawnMsg("tu_1", { description: "err" }));
  mgr.handleMessage(resultMsg("tu_1", true));
  assert.deepEqual(created[0].events.find((e) => e.type === "turn/end").data.reason, {
    kind: "error",
    error: { message: "subagent tool result reported an error", code: "CLAUDE_CODE_SUBAGENT" },
  });
});

test("residual forwarded messages after close do not reopen a duplicate session", () => {
  const { ctx, created } = mockCtx();
  const mgr = new SubagentSessionManager(ctx, { mainSession: MAIN, cwd: "/work" });
  mgr.handleMessage(spawnMsg("tu_1", { description: "once" }));
  mgr.handleMessage(resultMsg("tu_1"));
  mgr.handleMessage(forwardedMsg("tu_1", [{ type: "text", text: "late" }]));
  assert.equal(created.length, 1);
});
