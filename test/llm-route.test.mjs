// test/llm-route.test.mjs — lib/llm-route.mjs 的纯单测。
// 验证休眠的 `claude-code` LLM 路由只贡献 provider 目录、不承载流式调用，
// 从而让前端模型选择的 routeServed 把它判为「已服务」、不再锁输入框。
import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeLlmRoute, CLAUDE_CODE_PROVIDER } from "../lib/llm-route.mjs";

test("provider id matches the engine id and header provider", () => {
  assert.equal(CLAUDE_CODE_PROVIDER, "claude-code");
});

test("providerInfo preserves the id and gives a display name", () => {
  const route = new ClaudeCodeLlmRoute();
  assert.deepEqual(route.providerInfo(CLAUDE_CODE_PROVIDER), {
    id: "claude-code",
    name: "Claude Code",
  });
});

test("listModels advertises nothing (empty group is dropped, route still served)", async () => {
  const route = new ClaudeCodeLlmRoute();
  assert.deepEqual(await route.listModels(CLAUDE_CODE_PROVIDER), []);
});

test("resolveModel passes through the exact model identity", async () => {
  const route = new ClaudeCodeLlmRoute();
  assert.deepEqual(await route.resolveModel(CLAUDE_CODE_PROVIDER, "claude-opus-4-6"), {
    provider: "claude-code",
    id: "claude-opus-4-6",
    name: "claude-opus-4-6",
  });
});

test("stream refuses to route: the engine never dispatches through ctx.llm", () => {
  const route = new ClaudeCodeLlmRoute();
  assert.throws(() => route.stream({}), /driven by the Claude Code CLI/);
});
