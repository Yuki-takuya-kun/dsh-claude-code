// test/trace.test.mjs — trace.mjs 的纯单测（mock sink，不依赖宿主运行时）。
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeRunTracer } from "../lib/trace.mjs";

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
  assert.equal(call.data.name, "Bash");
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
