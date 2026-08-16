// lib/trace.mjs — 纯映射：Claude Agent SDK 消息 → DSH 会话事件。
// 不持有任何宿主状态，只依赖一个 sink（形如 { append(type, data, opts?) -> {seq} }）。
// 可独立单测：喂入 mock SDK 消息，断言 sink 收到的事件序列。
//
// 一次 query() 的 Claude 多轮（assistant → tool_use → user(tool_result) → assistant → …）
// 映射为 DSH 的一个 turn 内多个 step：
//   - 每个 Claude assistant 消息 = 一个 DSH step（step/start → assistant/chunk* → assistant/message → tool/call* → tool/result* → step/end）
//   - turn/start 与 turn/end 由上层（agent.mjs）负责，本模块只负责 step 内部。

import { createAssistantMessage, createToolResultMessage } from "@deepseek-ai/dsh-llm";

const PROVIDER = "claude-code";

/** 把一个 Claude content block 映射成 DSH ContentBlock。 */
export function mapClaudeBlock(block) {
  if (!block || typeof block.type !== "string") return null;
  switch (block.type) {
    case "text":
      return { type: "text", text: typeof block.text === "string" ? block.text : "" };
    case "thinking":
      return { type: "reasoning", text: typeof block.thinking === "string" ? block.thinking : "" };
    case "tool_use":
      return {
        type: "tool-call",
        id: block.id ?? "",
        name: block.name ?? "",
        arguments: JSON.stringify(block.input ?? {}),
      };
    default:
      return null; // image / web_search 等块，v1 忽略
  }
}

/** 把 Claude tool_result 的 content（string | block[]）映射成 DSH tool-result content。 */
export function mapClaudeToolResultContent(content) {
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content.map(mapClaudeBlock).filter(Boolean);
  }
  return [];
}

/**
 * 一次 Claude Code query() 的轨迹转写器。
 * 用法：new ClaudeRunTracer(sink, turn) → 逐条 feed handleMessage(msg) → finish()。
 */
export class ClaudeRunTracer {
  #sink;
  #turn;
  #step = 0;
  #stepOpen = false;
  #assistantEmitted = false;
  #chunkSeqs = [];
  #toolCallSeqByCallId = new Map();
  #toolNameByCallId = new Map();
  #model = "claude-code";
  #ended = false;

  constructor(sink, turn) {
    this.#sink = sink;
    this.#turn = turn;
  }

  /** 处理一条 SDK 消息。 */
  handleMessage(message) {
    if (this.#ended) return;
    switch (message.type) {
      case "system":
        if (message.subtype === "init") this.#onInit(message);
        break;
      case "stream_event":
        this.#onStreamEvent(message);
        break;
      case "assistant":
        this.#onAssistant(message);
        break;
      case "user":
        this.#onUser(message);
        break;
      case "result":
        this.#onResult(message);
        break;
      default:
        break; // tool_progress / status / hook_* 等，v1 忽略
    }
  }

  /** 结束转写（安全幂等）：关掉未闭合的 step。 */
  finish() {
    this.#closeStep();
    this.#ended = true;
  }

  get step() {
    return this.#step;
  }

  #onInit(msg) {
    if (typeof msg.model === "string" && msg.model) this.#model = msg.model;
  }

  #onStreamEvent(msg) {
    const event = msg?.event;
    if (!event) return;
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        const blockType = block?.type === "thinking" ? "reasoning" : block?.type === "tool_use" ? "tool-call" : "text";
        this.#ensureStepOpen();
        this.#appendChunk({ type: "block-start", index: event.index, blockType });
        if (block?.type === "tool_use") {
          this.#appendChunk({ type: "tool-call-delta", index: event.index, id: block.id ?? "", name: block.name ?? "", argumentsDelta: "" });
        }
        break;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (!delta) break;
        this.#ensureStepOpen();
        if (delta.type === "text_delta") {
          this.#appendChunk({ type: "text-delta", index: event.index, text: delta.text ?? "" });
        } else if (delta.type === "thinking_delta") {
          this.#appendChunk({ type: "reasoning-delta", index: event.index, text: delta.thinking ?? "" });
        } else if (delta.type === "input_json_delta") {
          this.#appendChunk({ type: "tool-call-delta", index: event.index, argumentsDelta: delta.partial_json ?? "" });
        }
        // signature_delta / citations_delta 忽略
        break;
      }
      case "content_block_stop":
        // block-end 可省略：assistant/message 以完整消息为准
        break;
      case "message_delta":
        // usage 可选，v1 忽略
        break;
      default:
        break;
    }
  }

  #onAssistant(msg) {
    const message = msg?.message;
    if (!message) return;
    // 若上一个 step 已发出 assistant 消息，说明这是新一轮 Claude 助手 → 先闭合上一步
    this.#ensureStepOpen();
    const blocks = (Array.isArray(message.content) ? message.content : [])
      .map(mapClaudeBlock)
      .filter(Boolean);
    const assistant = createAssistantMessage({
      content: blocks,
      source: { provider: PROVIDER, model: message.model ?? this.#model },
    });
    const opts = { surfaceOp: "append" };
    if (this.#chunkSeqs.length > 0) opts.sourceEventSeqs = this.#chunkSeqs;
    this.#sink.append("assistant/message", { turn: this.#turn, step: this.#step, message: assistant }, opts);
    // 工具调用：写成 tool/call 事件（Claude Code 已自行执行，这里仅用于轨迹展示）
    for (const block of blocks) {
      if (block.type !== "tool-call") continue;
      const ev = this.#sink.append("tool/call", {
        turn: this.#turn,
        step: this.#step,
        callId: block.id,
        name: block.name,
        arguments: block.arguments,
      });
      this.#toolCallSeqByCallId.set(block.id, ev.seq);
      this.#toolNameByCallId.set(block.id, block.name);
    }
    this.#assistantEmitted = true;
  }

  #onUser(msg) {
    const content = msg?.message?.content;
    if (!Array.isArray(content)) return; // prompt echo（字符串）等非工具结果消息忽略
    for (const block of content) {
      if (!block || block.type !== "tool_result") continue;
      const callId = block.tool_use_id ?? "";
      // AskUserQuestion 的 deny 是「答案」而非错误，故不标记 isError，避免渲染成红色。
      const isAskUserQuestion = this.#toolNameByCallId.get(callId) === "AskUserQuestion";
      const result = createToolResultMessage({
        callId,
        content: mapClaudeToolResultContent(block.content),
        isError: isAskUserQuestion ? false : block.is_error === true,
      });
      const opts = { surfaceOp: "append" };
      const callSeq = this.#toolCallSeqByCallId.get(callId);
      if (callSeq !== undefined) opts.sourceEventSeqs = [callSeq];
      this.#sink.append("tool/result", { turn: this.#turn, step: this.#step, message: result }, opts);
    }
  }

  #onResult() {
    this.#closeStep();
    this.#ended = true;
  }

  #ensureStepOpen() {
    if (this.#assistantEmitted) {
      // 新一轮助手开始 → 闭合上一步
      this.#closeStep();
    }
    if (!this.#stepOpen) this.#openStep();
  }

  #openStep() {
    this.#step += 1;
    this.#stepOpen = true;
    this.#assistantEmitted = false;
    this.#chunkSeqs = [];
    this.#toolCallSeqByCallId = new Map();
    this.#toolNameByCallId = new Map();
    this.#sink.append("step/start", { turn: this.#turn, step: this.#step });
  }

  #closeStep() {
    if (!this.#stepOpen) return;
    this.#sink.append("step/end", { turn: this.#turn, step: this.#step });
    this.#stepOpen = false;
  }

  #appendChunk(chunk) {
    const ev = this.#sink.append("assistant/chunk", { turn: this.#turn, step: this.#step, chunk });
    this.#chunkSeqs.push(ev.seq);
  }
}

export { PROVIDER };
