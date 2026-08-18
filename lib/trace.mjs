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

/**
 * Claude Code 内建工具名 → DSH 原生 wire 工具名。
 * DSH 前端按 wire 工具名分类渲染（bash / skill / read / write / edit / search …），
 * 名字对不上会全部落进通用 "Tool call" 卡片。这里做一次性映射，让 Claude Code
 * 的工具调用在 DSH 里显示成与原生一致的类别。不在表里的保持原名，走通用卡片。
 */
const TOOL_NAME_MAP = {
  Bash: "bash",
  Skill: "skill",
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  WebSearch2: "web_search",
};

/**
 * 需要改写入参键、DSH 前端才能读出摘要/名称的工具。
 * 目前只有 Skill：Claude Code 用 { command }，DSH skill 行读 { name }。
 * 返回改写后的 input（不原地修改原对象）。
 */
const TOOL_INPUT_REMAP = {
  Skill: (input) => (typeof input?.command === "string" ? { name: input.command } : input),
};

/** 把 Claude Code 工具名映射成 DSH wire 工具名（未命中保持原名）。 */
export function mapToolName(claudeName) {
  return TOOL_NAME_MAP[claudeName] ?? claudeName;
}

/** 把 Claude Code 工具入参改写为 DSH 前端可读的形状（无改写规则时原样返回）。 */
export function mapToolInput(claudeName, input) {
  const remap = TOOL_INPUT_REMAP[claudeName];
  return remap ? remap(input) : input;
}

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
        name: mapToolName(block.name ?? ""),
        arguments: JSON.stringify(mapToolInput(block.name ?? "", block.input ?? {})),
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
 * 把一个 Claude usage 对象（`input_tokens` / `output_tokens` / `cache_read_input_tokens` /
 * `cache_creation_input_tokens`）映射成 DSH TokenUsage。字段缺失按 0 计；非对象返回 null。
 */
export function usageFromClaude(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0,
    cacheWriteTokens: typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0,
  };
}

/**
 * 从 result 的 `modelUsage`（`Record<model, ModelUsage>`）取主模型的 `contextWindow`。
 * 只返回正整数——token-meter 的投影 schema 要求 `contextWindow` 为正，非正数会污染
 * 检查点校验。匹配顺序：主模型 key → canonicalModel 命中 → 任意带正 contextWindow
 * 的条目；取不到时返回 undefined。
 */
export function contextWindowOf(modelUsage, model) {
  if (!modelUsage || typeof modelUsage !== "object") return undefined;
  const positive = (value) => Number.isInteger(value) && value > 0 ? value : undefined;
  const direct = positive(modelUsage[model]?.contextWindow);
  if (direct !== undefined) return direct;
  const entries = Object.values(modelUsage);
  for (const entry of entries) {
    if (entry && entry.canonicalModel === model) {
      const value = positive(entry.contextWindow);
      if (value !== undefined) return value;
    }
  }
  for (const entry of entries) {
    const value = positive(entry?.contextWindow);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** 判断一份 DSH TokenUsage 是否「空」（null 或四个 bucket 全为 0）。 */
export function isZeroUsage(usage) {
  return !usage
    || (usage.inputTokens === 0
      && usage.outputTokens === 0
      && usage.cacheReadTokens === 0
      && usage.cacheWriteTokens === 0);
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
  /** 最近一个 step 经 message_delta 得到的用量（无则为 null），供 result 兜底判断。 */
  #lastStepUsage = null;
  /** 引擎配置的 contextWindow 兜底值（result.modelUsage 取不到时用），非正整数视为未配置。 */
  #configContextWindow;
  #ended = false;

  constructor(sink, turn, options = {}) {
    this.#sink = sink;
    this.#turn = turn;
    this.#configContextWindow = options.contextWindow;
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
      // message_start 不处理：经 Anthropic 兼容端点接入的后端，其 message_start.usage
      // 全为 0 且 message.model 是去后缀的短名（与 system/init 和 modelUsage 的 key 不符），
      // 处理它只会污染 #model。权威用量在 message_delta / result 里。
      case "content_block_start": {
        const block = event.content_block;
        const blockType = block?.type === "thinking" ? "reasoning" : block?.type === "tool_use" ? "tool-call" : "text";
        this.#ensureStepOpen();
        this.#appendChunk({ type: "block-start", index: event.index, blockType });
        if (block?.type === "tool_use") {
          this.#appendChunk({ type: "tool-call-delta", index: event.index, id: block.id ?? "", name: mapToolName(block.name ?? ""), argumentsDelta: "" });
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
      case "message_delta": {
        const usage = usageFromClaude(event.usage);
        if (!usage) break;
        // message_delta 是这条消息的权威定稿用量（input + output + cache），但它在
        // assistant 消息之后才到，所以不能挂到 assistant/message 上，而是写成 usage chunk。
        this.#sink.append("assistant/chunk", {
          turn: this.#turn,
          step: this.#step,
          chunk: { type: "usage", usage },
        });
        this.#lastStepUsage = usage;
        break;
      }
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
    // 用量不挂在 assistant/message 上：权威用量在随后的 message_delta 才到，见 #onStreamEvent
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

  #onResult(msg) {
    this.#emitRequestContext(msg);
    this.#emitResultUsage(msg);
    this.#closeStep();
    this.#ended = true;
  }

  /** 从 result 的 modelUsage 取主模型上下文窗口（配置兜底），变更时写入 `request/context`。 */
  #emitRequestContext(msg) {
    let contextWindow = contextWindowOf(msg?.modelUsage, this.#model);
    if (contextWindow === undefined
      && Number.isInteger(this.#configContextWindow)
      && this.#configContextWindow > 0) {
      contextWindow = this.#configContextWindow;
    }
    if (contextWindow === undefined) return;
    const context = { provider: PROVIDER, model: this.#model, contextWindow };
    const previous = this.#sink.requestContext?.();
    if (previous
      && previous.provider === context.provider
      && previous.model === context.model
      && previous.contextWindow === context.contextWindow) return;
    this.#sink.append("request/context", context);
  }

  /**
   * 当最后一个 step 没从 message_delta 得到有效用量时，用 result 的总用量兜底写一个
   * `usage` chunk（token-meter 按 (turn, step) 后者胜，会替换掉同一步的空样本）。
   */
  #emitResultUsage(msg) {
    if (!isZeroUsage(this.#lastStepUsage) || this.#step <= 0) return;
    const usage = usageFromClaude(msg?.usage);
    if (!usage || isZeroUsage(usage)) return;
    this.#sink.append("assistant/chunk", {
      turn: this.#turn,
      step: this.#step,
      chunk: { type: "usage", usage },
    });
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
    this.#lastStepUsage = null;
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
