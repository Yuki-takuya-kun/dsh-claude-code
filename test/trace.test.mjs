// test/trace.test.mjs — trace.mjs 的纯单测（mock sink，不依赖宿主运行时）。
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeRunTracer, mapToolName, mapToolInput, usageFromClaude, contextWindowOf } from "../lib/trace.mjs";

function mockSink() {
  const events = [];
  let seq = 0;
  return {
    events,
    append(type, data, opts) {
      const ev = { seq: ++seq, type, data, ...(opts ?? {}) };
      events.push(ev);
      return ev;
    },
  };
}

test("text-only run maps to one step", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 1);
  t.handleMessage({ type: "system", subtype: "init", model: "claude-sonnet-4-5" });
  t.handleMessage({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  t.handleMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } } });
  t.handleMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } } });
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "Hello world" }], model: "claude-sonnet-4-5" } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "Hello world" });
  t.finish();

  const types = sink.events.map((e) => e.type);
  assert.deepEqual(types, ["step/start", "assistant/chunk", "assistant/chunk", "assistant/chunk", "assistant/message", "step/end"]);

  const msg = sink.events.find((e) => e.type === "assistant/message");
  assert.equal(msg.data.message.source.provider, "claude-code");
  assert.equal(msg.data.message.source.model, "claude-sonnet-4-5");
  assert.deepEqual(msg.data.message.content, [{ type: "text", text: "Hello world" }]);
  assert.equal(msg.surfaceOp, "append");
});

test("tool-call run maps tool/call + tool/result with sourceEventSeqs link", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 3);
  // step 1: assistant with a tool_use
  t.handleMessage({ type: "assistant", message: { content: [
    { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
    { type: "text", text: "Let me list files." },
  ], model: "claude-sonnet-4-5" } });
  // tool result
  t.handleMessage({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "file.txt" }], is_error: false },
  ] } });
  // step 2: final assistant text
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "Done" }], model: "claude-sonnet-4-5" } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "Done" });
  t.finish();

  const types = sink.events.map((e) => e.type);
  assert.deepEqual(types, [
    "step/start", "assistant/message", "tool/call", "tool/result",
    "step/end", "step/start", "assistant/message", "step/end",
  ]);

  const call = sink.events.find((e) => e.type === "tool/call");
  assert.equal(call.data.callId, "toolu_1");
  assert.equal(call.data.name, "bash");
  assert.equal(call.data.arguments, '{"command":"ls"}');

  const result = sink.events.find((e) => e.type === "tool/result");
  assert.deepEqual(result.sourceEventSeqs, [call.seq]);
  assert.equal(result.data.message.content[0].type, "tool-result");
  assert.equal(result.data.message.content[0].toolCallId, "toolu_1");

  // step numbers must advance across the two assistant turns
  const steps = sink.events.filter((e) => e.type === "step/start").map((e) => e.data.step);
  assert.deepEqual(steps, [1, 2]);
});

test("prompt-echo user message (non tool_result) is ignored", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 1);
  t.handleMessage({ type: "user", message: { content: "the original prompt" } });
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "hi" });
  t.finish();
  const types = sink.events.map((e) => e.type);
  assert.deepEqual(types, ["step/start", "assistant/message", "step/end"]);
});

test("Claude tool names map to DSH wire names in tool/call", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 1);
  t.handleMessage({ type: "assistant", message: { content: [
    { type: "tool_use", id: "toolu_a", name: "Bash", input: { command: "ls" } },
    { type: "tool_use", id: "toolu_b", name: "Read", input: { file_path: "a.txt" } },
    { type: "tool_use", id: "toolu_c", name: "WebSearch", input: { query: "q" } },
    { type: "tool_use", id: "toolu_d", name: "TodoWrite", input: { todos: [] } },
  ], model: "claude-sonnet-4-5" } });
  t.finish();

  const calls = sink.events.filter((e) => e.type === "tool/call");
  const names = new Map(calls.map((c) => [c.data.callId, c.data.name]));
  assert.equal(names.get("toolu_a"), "bash");
  assert.equal(names.get("toolu_b"), "read");
  assert.equal(names.get("toolu_c"), "web_search");
  // 未在映射表内的工具保持原名，走通用卡片
  assert.equal(names.get("toolu_d"), "TodoWrite");
});

test("Skill tool input { command } remaps to { name }", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 1);
  t.handleMessage({ type: "assistant", message: { content: [
    { type: "tool_use", id: "toolu_s", name: "Skill", input: { command: "mattpocock-tdd" } },
  ], model: "claude-sonnet-4-5" } });
  t.finish();

  const call = sink.events.find((e) => e.type === "tool/call");
  assert.equal(call.data.name, "skill");
  assert.equal(call.data.arguments, '{"name":"mattpocock-tdd"}');
});

test("mapToolName / mapToolInput map tables", () => {
  assert.equal(mapToolName("Bash"), "bash");
  assert.equal(mapToolName("Skill"), "skill");
  assert.equal(mapToolName("MultiEdit"), "edit");
  assert.equal(mapToolName("UnknownTool"), "UnknownTool");
  assert.deepEqual(mapToolInput("Skill", { command: "x" }), { name: "x" });
  // 非 { command } 入参原样返回
  assert.deepEqual(mapToolInput("Skill", { name: "already" }), { name: "already" });
  assert.deepEqual(mapToolInput("Bash", { command: "ls" }), { command: "ls" });
});

test("usage from message_start + message_delta lands on assistant/message", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 1);
  t.handleMessage({ type: "stream_event", event: { type: "message_start", message: {
    model: "claude-sonnet-4-5",
    usage: { input_tokens: 120, output_tokens: 0, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
  } } });
  t.handleMessage({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  t.handleMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } } });
  t.handleMessage({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 55 } } });
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }], model: "claude-sonnet-4-5" } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "Hi" });
  t.finish();

  const msg = sink.events.find((e) => e.type === "assistant/message");
  // 输入/缓存来自 message_start，输出在 message_delta 定稿
  assert.deepEqual(msg.data.usage, {
    inputTokens: 120,
    outputTokens: 55,
    cacheReadTokens: 40,
    cacheWriteTokens: 30,
  });
});

test("result.modelUsage emits request/context with the context window", () => {
  const sink = mockSink();
  const t = new ClaudeRunTracer(sink, 2);
  t.handleMessage({ type: "system", subtype: "init", model: "claude-sonnet-4-5" });
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "hi",
    modelUsage: { "claude-sonnet-4-5": { contextWindow: 200000 } } });
  t.finish();

  const ctx = sink.events.find((e) => e.type === "request/context");
  assert.ok(ctx);
  assert.deepEqual(ctx.data, { provider: "claude-code", model: "claude-sonnet-4-5", contextWindow: 200000 });
});

test("request/context is skipped when the route metadata is unchanged", () => {
  const sink = mockSink();
  sink.requestContext = () => ({ provider: "claude-code", model: "claude-sonnet-4-5", contextWindow: 200000 });
  const t = new ClaudeRunTracer(sink, 3);
  t.handleMessage({ type: "system", subtype: "init", model: "claude-sonnet-4-5" });
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "hi",
    modelUsage: { "claude-sonnet-4-5": { contextWindow: 200000 } } });
  t.finish();

  assert.equal(sink.events.filter((e) => e.type === "request/context").length, 0);
});

test("request/context re-emits when the context window changes", () => {
  const sink = mockSink();
  sink.requestContext = () => ({ provider: "claude-code", model: "claude-sonnet-4-5", contextWindow: 200000 });
  const t = new ClaudeRunTracer(sink, 4);
  t.handleMessage({ type: "system", subtype: "init", model: "claude-opus-4-5" });
  t.handleMessage({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
  t.handleMessage({ type: "result", subtype: "success", is_error: false, result: "hi",
    modelUsage: { "claude-opus-4-5": { contextWindow: 400000 } } });
  t.finish();

  const ctx = sink.events.find((e) => e.type === "request/context");
  assert.ok(ctx);
  assert.equal(ctx.data.contextWindow, 400000);
});

test("usageFromClaude maps Claude usage fields, null on non-object", () => {
  assert.deepEqual(usageFromClaude({
    input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10,
  }), { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 });
  // 缺失字段按 0 计
  assert.deepEqual(usageFromClaude({}), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(usageFromClaude(null), null);
  assert.equal(usageFromClaude("nope"), null);
});

test("contextWindowOf picks primary model then sole entry, positive only", () => {
  assert.equal(contextWindowOf({ "claude-sonnet-4-5": { contextWindow: 200000 } }, "claude-sonnet-4-5"), 200000);
  // 主模型不在表内但只有一条 → 退回唯一条目
  assert.equal(contextWindowOf({ "claude-sonnet-4-5": { contextWindow: 200000 } }, "claude-opus-4-5"), 200000);
  // 非正数不返回（token-meter 投影 schema 要求 contextWindow 为正）
  assert.equal(contextWindowOf({ m: { contextWindow: 0 } }, "m"), undefined);
  assert.equal(contextWindowOf({ m: { contextWindow: -1 } }, "m"), undefined);
  assert.equal(contextWindowOf(undefined, "m"), undefined);
  assert.equal(contextWindowOf({}, "m"), undefined);
});
