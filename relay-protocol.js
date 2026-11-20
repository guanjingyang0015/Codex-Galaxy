import crypto from "node:crypto";

// Only the local gateway translates protocols. Credentials and model output
// stay in this transport's memory; Responses-native requests stay untouched.
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
const MAX_SIGNATURES = 256;

function invalid(message, code = "unsupported_relay_request") {
  return Object.assign(new Error(message), { statusCode: 400, publicMessage: message, code });
}

function urlParts(baseUrl) {
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw invalid("中转地址须为不带账号、查询参数或片段的 HTTP(S) Base URL。");
  }
  const path = url.pathname.replace(/\/+$/, "");
  const native = /\/v1beta(?:\/models(?:\/[^/]+(?::[^/]+)?)?)?$/.test(path);
  const hint = native ? "gemini" : /\/chat\/completions$/.test(path) ? "chat" : /\/messages$/.test(path) ? "anthropic" : /\/responses$/.test(path) ? "responses" : null;
  const root = native
    ? path.replace(/\/v1beta(?:\/models(?:\/[^/]+(?::[^/]+)?)?)?$/, "")
    : path.replace(/\/(?:responses|chat\/completions|messages)$/, "").replace(/\/v1$/, "");
  return { url, root, hint };
}

export function relayEndpoint(baseUrl, protocol, model = "", stream = false) {
  const { url, root } = urlParts(baseUrl);
  url.pathname = protocol === "gemini"
    ? `${root}/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ""))}:${stream ? "streamGenerateContent" : "generateContent"}`
    : `${root}/v1/${protocol === "chat" ? "chat/completions" : protocol === "anthropic" ? "messages" : "responses"}`;
  if (protocol === "gemini" && stream) url.searchParams.set("alt", "sse");
  return url.toString();
}

export function relayModelsUrl(baseUrl) {
  const { url, root, hint } = urlParts(baseUrl);
  url.pathname = hint === "gemini" ? `${root}/v1beta/models` : `${root}/v1/models`;
  return url;
}

export function relayResponsesBase(baseUrl) {
  return relayEndpoint(baseUrl, "responses").replace(/\/responses$/, "");
}

export async function probeDirectResponses(profile, fetcher = globalThis.fetch) {
  try {
    const { hint } = urlParts(profile.baseUrl);
    if (hint && hint !== "responses") return null;
    const baseUrl = relayResponsesBase(profile.baseUrl);
    const signal = AbortSignal.timeout(8000);
    const res = await fetcher(`${baseUrl}/responses`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${profile.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: profile.model, input: "Reply OK.", max_output_tokens: 64, store: false, stream: true }),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
      await res.body?.cancel();
      return null;
    }
    for await (const event of sseJson(res)) {
      if (["error", "response.failed", "response.incomplete"].includes(event.type)) return null;
      if (event.type === "response.completed") return event.response?.status === "completed" ? baseUrl : null;
    }
    return null;
  } catch { return null; }
}

async function boundedText(response, maximum = MAX_UPSTREAM_BYTES) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximum) throw invalid("上游响应超过兼容网关的大小限制。", "relay_response_too_large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) throw invalid("上游响应超过兼容网关的大小限制。", "relay_response_too_large");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    // A cloned response is a tee: awaiting cancellation can deadlock until
    // the original branch is read. Start cancellation without blocking it.
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function toolSpecs(body) {
  const specs = new Map();
  const add = (tool, prefix = "") => {
    if (["web_search", "web_search_preview"].includes(tool.type)) {
      // Codex includes optional hosted-search declarations even for ordinary
      // text turns. These upstream protocols cannot execute OpenAI search.
      // Drop only the optional declaration, never a requested search action.
      const required = body.tool_choice === "required" && (body.tools || []).every((entry) => ["web_search", "web_search_preview"].includes(entry.type));
      const chosen = typeof body.tool_choice === "object" && ["web_search", "web_search_preview"].includes(body.tool_choice.type);
      if (required || chosen) throw invalid("当前中转协议不支持指定的联网搜索，请使用原生 Responses 搜索服务。");
      return;
    }
    if (tool.type === "namespace") {
      for (const entry of tool.tools || []) add(entry, `${prefix}${tool.name}.`);
      return;
    }
    if (!["function", "custom"].includes(tool.type)) throw invalid(`此中转协议无法转换工具类型 ${String(tool.type || "unknown")}；请使用 Responses 接口或关闭该服务端工具。`);
    const originalName = `${prefix}${tool.name}`;
    if (!tool.name || specs.has(originalName)) throw invalid("工具名称缺失或重复。");
    const wireName = /^[a-zA-Z0-9_-]{1,64}$/.test(originalName) ? originalName : `galaxy_tool_${specs.size}`;
    if ([...specs.values()].some((item) => item.wireName === wireName)) throw invalid("工具转换后名称冲突。");
    specs.set(originalName, {
      originalName, name: tool.name, namespace: prefix.replace(/\.$/, ""), wireName, custom: tool.type === "custom",
      description: tool.description || "",
      parameters: tool.type === "custom"
        ? { type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false }
        : tool.parameters || { type: "object", properties: {} },
    });
  };
  for (const tool of body.tools || []) add(tool);
  return specs;
}

function parseArguments(value) {
  try { return typeof value === "string" ? JSON.parse(value || "{}") : value || {}; }
  catch { throw invalid("历史工具参数不是有效 JSON，无法转换到该中转协议。"); }
}

function normalizedInput(body, specs) {
  // Server-side stored response chains cannot be reconstructed on a different
  // protocol. Codex normally sends the complete local input history.
  if (body.previous_response_id) throw invalid("协议转换需要完整的本地输入历史，不支持 previous_response_id 服务端会话引用。");
  const messages = [];
  if (body.instructions) messages.push({ role: "system", content: [{ type: "text", text: String(body.instructions) }] });
  const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input || [];
  if (!Array.isArray(input)) throw invalid("Responses input 必须是文本或数组。");
  for (const item of input) {
    if (item.type === "reasoning") continue; // provider-local opaque reasoning is not portable
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const spec = specs.get(item.namespace ? `${item.namespace}.${item.name}` : item.name);
      messages.push({ role: "assistant", call: {
        id: item.call_id, name: spec?.wireName || item.name,
        args: item.type === "custom_tool_call" ? { input: item.input || "" } : parseArguments(item.arguments),
      } });
      continue;
    }
    if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
      messages.push({ role: "tool", callId: item.call_id, output: typeof item.output === "string" ? item.output : JSON.stringify(item.output) });
      continue;
    }
    if (item.type && item.type !== "message") throw invalid(`此中转协议不支持输入项 ${item.type}；请使用原生 Responses 接口。`);
    const role = ["system", "developer", "user", "assistant"].includes(item.role) ? item.role : null;
    if (!role) throw invalid("输入消息的角色无效。");
    const content = typeof item.content === "string" ? [{ type: "text", text: item.content }] : (item.content || []).map((part) => {
      if (["text", "input_text", "output_text"].includes(part.type)) return { type: "text", text: part.text || "" };
      if (part.type === "input_image" && typeof part.image_url === "string") return { type: "image", url: part.image_url, detail: part.detail };
      throw invalid(`此中转协议不支持内容块 ${String(part.type || "unknown")}，不会丢弃该内容继续生成。`);
    });
    messages.push({ role: role === "developer" ? "system" : role, content });
  }
  return messages;
}

function imagePart(url, protocol) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (protocol === "anthropic") return { type: "image", source: match ? { type: "base64", media_type: match[1], data: match[2] } : { type: "url", url } };
  if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
  throw invalid("Gemini 原生适配目前仅接受内嵌 base64 图片；请先转换图片或使用 Responses 图像接口。");
}

export function convertRelayRequest(body, protocol, signatures = new Map()) {
  const specs = toolSpecs(body);
  const messages = normalizedInput(body, specs);
  const tools = [...specs.values()];
  const choiceName = typeof body.tool_choice === "object" ? `${body.tool_choice.namespace ? `${body.tool_choice.namespace}.` : ""}${body.tool_choice.name}` : null;
  const chosen = specs.size ? choiceName ? specs.get(choiceName)?.wireName || body.tool_choice.name : body.tool_choice : null;
  const maxTokens = Number(body.max_output_tokens) > 0 ? Math.floor(body.max_output_tokens) : 8192;
  if (body.text?.format && body.text.format.type !== "text") throw invalid("该转换通道不支持 Responses 结构化输出约束，请使用原生 Responses。");
  if (protocol === "chat") {
    const chatMessages = [];
    for (const message of messages) {
      if (message.call) {
        const call = { id: message.call.id, type: "function", function: { name: message.call.name, arguments: JSON.stringify(message.call.args) } };
        if (chatMessages.at(-1)?.role === "assistant" && chatMessages.at(-1).tool_calls) chatMessages.at(-1).tool_calls.push(call);
        else chatMessages.push({ role: "assistant", content: null, tool_calls: [call] });
      } else if (message.role === "tool") chatMessages.push({ role: "tool", tool_call_id: message.callId, content: message.output });
      else chatMessages.push({ role: message.role, content: message.content.map((part) => part.type === "text" ? part : { type: "image_url", image_url: { url: part.url, ...(part.detail ? { detail: part.detail } : {}) } }) });
    }
    return { specs, body: {
      model: body.model, stream: body.stream === true,
      messages: chatMessages,
      max_tokens: maxTokens,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: { name: tool.wireName, description: tool.description, parameters: tool.parameters } })) } : {}),
      ...(chosen ? { tool_choice: typeof body.tool_choice === "object" ? { type: "function", function: { name: chosen } } : chosen } : {}),
    } };
  }
  if (protocol === "anthropic") {
    const system = [];
    const converted = [];
    for (const message of messages) {
      if (message.role === "system") { system.push(...message.content.filter((part) => part.type === "text")); continue; }
      const role = message.role === "assistant" ? "assistant" : "user";
      const parts = message.call ? [{ type: "tool_use", id: message.call.id, name: message.call.name, input: message.call.args }]
        : message.role === "tool" ? [{ type: "tool_result", tool_use_id: message.callId, content: message.output }]
          : message.content.map((part) => part.type === "text" ? part : imagePart(part.url, protocol));
      if (converted.at(-1)?.role === role) converted.at(-1).content.push(...parts);
      else converted.push({ role, content: parts });
    }
    return { specs, body: {
      model: body.model, stream: body.stream === true, max_tokens: maxTokens, messages: converted,
      ...(system.length ? { system } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.wireName, description: tool.description, input_schema: tool.parameters })) } : {}),
      ...(chosen ? { tool_choice: typeof body.tool_choice === "object" ? { type: "tool", name: chosen } : { type: chosen === "required" ? "any" : chosen } } : {}),
    } };
  }
  const system = [];
  const contents = [];
  const callNames = new Map();
  for (const message of messages) {
    if (message.role === "system") { system.push(...message.content.filter((part) => part.type === "text").map(({ text }) => ({ text }))); continue; }
    const role = message.role === "assistant" ? "model" : "user";
    let parts;
    if (message.call) {
      callNames.set(message.call.id, message.call.name);
      const signature = signatures.get(message.call.id);
      parts = [{ functionCall: { name: message.call.name, args: message.call.args }, ...(signature ? { thoughtSignature: signature } : {}) }];
    } else if (message.role === "tool") {
      const name = callNames.get(message.callId);
      if (!name) throw invalid("Gemini 工具结果缺少对应的历史工具调用。");
      parts = [{ functionResponse: { name, response: { result: message.output } } }];
    } else parts = message.content.map((part) => part.type === "text" ? { text: part.text } : imagePart(part.url, protocol));
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
    else contents.push({ role, parts });
  }
  return { specs, body: {
    contents,
    ...(system.length ? { systemInstruction: { parts: system } } : {}),
    generationConfig: { maxOutputTokens: maxTokens, ...(body.temperature !== undefined ? { temperature: body.temperature } : {}) },
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.wireName, description: tool.description, parameters: tool.parameters })) }] } : {}),
    ...(chosen ? { toolConfig: { functionCallingConfig: { mode: typeof body.tool_choice === "object" || chosen === "required" ? "ANY" : chosen === "none" ? "NONE" : "AUTO", ...(typeof body.tool_choice === "object" ? { allowedFunctionNames: [chosen] } : {}) } } } : {}),
  } };
}

function responseEnvelope(model) {
  return { id: `resp_${crypto.randomUUID().replaceAll("-", "")}`, object: "response", created_at: Math.floor(Date.now() / 1000), model, status: "in_progress", output: [], error: null, incomplete_details: null, usage: null };
}

function usageOf(value, protocol) {
  if (!value) return null;
  const input = Number(protocol === "chat" ? value.prompt_tokens : protocol === "gemini" ? value.promptTokenCount : value.input_tokens) || 0;
  const output = Number(protocol === "chat" ? value.completion_tokens : protocol === "gemini" ? value.candidatesTokenCount : value.output_tokens) || 0;
  return { input_tokens: input, output_tokens: output, total_tokens: Number(value.total_tokens || value.totalTokenCount) || input + output };
}

// One state machine serves buffered and SSE upstreams. It never emits a
// completed event unless the upstream supplies its own semantic terminator.
function responseBuilder(body, specs, protocol, signatures) {
  const response = responseEnvelope(body.model);
  response._galaxy_adapter = { protocol, upstream_model_declared: false };
  const slots = new Map();
  let sequence = 0;
  let terminal = false;
  let finishReason = null;
  let outputBytes = 0;
  const event = (type, fields = {}) => ({ type, sequence_number: sequence++, ...fields });
  const events = [];
  const queue = (type, fields) => events.push(event(type, fields));
  queue("response.created", { response: { ...response, output: [] } });
  queue("response.in_progress", { response: { ...response, output: [] } });
  const slot = (key, kind, name = "", callId = null) => {
    if (slots.has(key)) return slots.get(key);
    const spec = [...specs.values()].find((item) => item.wireName === name);
    if (kind === "call" && !spec) throw invalid("上游返回了未声明的工具名称。", "invalid_tool_response");
    if (response.output.length >= 256) throw invalid("上游返回的工具/内容块数量过多。", "relay_response_too_large");
    const item = kind === "text" ? { type: "message", id: `msg_${crypto.randomUUID().replaceAll("-", "")}`, role: "assistant", status: "in_progress", content: [{ type: "output_text", text: "", annotations: [] }] }
      : { type: spec.custom ? "custom_tool_call" : "function_call", id: `fc_${crypto.randomUUID().replaceAll("-", "")}`, call_id: callId || `call_${crypto.randomUUID().replaceAll("-", "")}`, name: spec.name, ...(spec.namespace ? { namespace: spec.namespace } : {}), status: "in_progress", ...(spec.custom ? { input: "" } : { arguments: "" }) };
    const value = { item, spec, index: response.output.length, raw: "" };
    slots.set(key, value);
    response.output.push(item);
    queue("response.output_item.added", { output_index: value.index, item: structuredClone(item) });
    if (kind === "text") queue("response.content_part.added", { output_index: value.index, item_id: item.id, content_index: 0, part: structuredClone(item.content[0]) });
    return value;
  };
  const append = (key, text, kind = "text", name = "", callId = null, signature = null) => {
    outputBytes += Buffer.byteLength(text || "");
    if (outputBytes > MAX_UPSTREAM_BYTES) throw invalid("上游输出超过兼容网关的大小限制。", "relay_response_too_large");
    const value = slot(key, kind, name, callId);
    if (typeof signature === "string" && signature.length <= 65536) {
      signatures.set(value.item.call_id, signature);
      while (signatures.size > MAX_SIGNATURES) signatures.delete(signatures.keys().next().value);
    }
    value.raw += text || "";
    if (kind === "text") {
      value.item.content[0].text = value.raw;
      if (text) queue("response.output_text.delta", { item_id: value.item.id, output_index: value.index, content_index: 0, delta: text });
    } else if (!value.spec.custom) {
      value.item.arguments = value.raw;
      if (text) queue("response.function_call_arguments.delta", { item_id: value.item.id, output_index: value.index, delta: text });
    }
  };
  const consume = (data) => {
    if (data.error || data.type === "error") throw invalid("上游模型返回错误，兼容网关已停止生成。", "upstream_stream_error");
    if (protocol === "chat") {
      if (data.model) { response.model = data.model; response._galaxy_adapter.upstream_model_declared = true; }
      if (data.usage) response.usage = usageOf(data.usage, protocol);
      const choice = data.choices?.[0];
      const delta = choice?.delta || choice?.message;
      if (delta?.content) {
        if (typeof delta.content !== "string") throw invalid("上游返回了无法转换的消息内容。");
        append("text", delta.content);
      }
      if (delta?.refusal) throw invalid("上游模型拒绝了该请求。", "upstream_content_blocked");
      for (const call of delta?.tool_calls || []) {
        const key = `call_${call.index ?? delta.tool_calls.indexOf(call)}`;
        const old = slots.get(key);
        append(key, call.function?.arguments || "", "call", call.function?.name || old?.spec.wireName, call.id || old?.item.call_id);
      }
      if (choice?.finish_reason) { finishReason = choice.finish_reason; terminal = true; }
    } else if (protocol === "anthropic") {
      if (data.type === "message_start") {
        response.model = data.message?.model || response.model;
        response._galaxy_adapter.upstream_model_declared = Boolean(data.message?.model);
        response.usage = usageOf(data.message?.usage, protocol);
      }
      if (data.type === "content_block_start") {
        const part = data.content_block;
        if (part?.type === "text") append(`text_${data.index}`, part.text || "");
        else if (part?.type === "tool_use") append(`call_${data.index}`, Object.keys(part.input || {}).length ? JSON.stringify(part.input) : "", "call", part.name, part.id);
        else if (!["thinking", "redacted_thinking"].includes(part?.type)) throw invalid("上游返回了无法转换的内容块。");
      }
      if (data.type === "content_block_delta") {
        const value = slots.get(`call_${data.index}`);
        if (data.delta?.type === "input_json_delta") append(`call_${data.index}`, data.delta.partial_json || "", "call", value?.spec.wireName, value?.item.call_id);
        if (data.delta?.type === "text_delta") append(`text_${data.index}`, data.delta.text || "");
      }
      if (data.type === "message_delta") {
        finishReason = data.delta?.stop_reason || finishReason;
        if (data.usage) response.usage = { ...(response.usage || { input_tokens: 0 }), output_tokens: Number(data.usage.output_tokens) || 0, total_tokens: (response.usage?.input_tokens || 0) + (Number(data.usage.output_tokens) || 0) };
      }
      if (data.type === "message_stop") terminal = true;
      if (data.type === "message") {
        response.model = data.model || response.model;
        response._galaxy_adapter.upstream_model_declared = Boolean(data.model);
        response.usage = usageOf(data.usage, protocol);
        for (const [index, part] of (data.content || []).entries()) {
          if (part.type === "text") append(`text_${index}`, part.text || "");
          else if (part.type === "tool_use") append(`call_${index}`, JSON.stringify(part.input || {}), "call", part.name, part.id);
          else if (!["thinking", "redacted_thinking"].includes(part.type)) throw invalid("上游返回了无法转换的内容块。");
        }
        finishReason = data.stop_reason;
        terminal = Boolean(finishReason);
      }
    } else {
      const candidate = data.candidates?.[0];
      if (data.modelVersion) { response.model = data.modelVersion; response._galaxy_adapter.upstream_model_declared = true; }
      if (data.usageMetadata) response.usage = usageOf(data.usageMetadata, protocol);
      if (data.promptFeedback?.blockReason) throw invalid("Gemini 上游已拦截该请求。", "upstream_content_blocked");
      for (const part of candidate?.content?.parts || []) {
        if (typeof part.text === "string" && !part.thought) append("text", part.text);
        if (part.functionCall) append(`call_${slots.size}`, JSON.stringify(part.functionCall.args || {}), "call", part.functionCall.name, null, part.thoughtSignature);
        if (part.inlineData || part.fileData || part.executableCode || part.codeExecutionResult) throw invalid("上游返回了当前 Codex 通道无法表达的内容，未提交空回答。");
      }
      if (candidate?.finishReason) { finishReason = candidate.finishReason; terminal = true; }
    }
  };
  const finish = () => {
    if (!terminal) throw invalid("上游流在完成标记之前结束，回复不完整，请重试。", "upstream_stream_incomplete");
    const truncated = ["length", "max_tokens", "MAX_TOKENS"].includes(finishReason);
    const normal = ["stop", "tool_calls", "function_call", "end_turn", "tool_use", "stop_sequence", "STOP"].includes(finishReason);
    if (!truncated && !normal) throw invalid("上游未正常完成回答，未提交兼容响应。", "upstream_finish_error");
    if (truncated && response.output.some((item) => item.type !== "message")) throw invalid("上游工具调用被长度限制截断，未提交执行。", "invalid_tool_arguments");
    for (const value of slots.values()) {
      const { item, index } = value;
      if (item.type === "message") {
        queue("response.output_text.done", { item_id: item.id, output_index: index, content_index: 0, text: value.raw });
        queue("response.content_part.done", { item_id: item.id, output_index: index, content_index: 0, part: structuredClone(item.content[0]) });
      } else {
        let args;
        try { args = JSON.parse(value.raw || "{}"); } catch { throw invalid("上游工具参数 JSON 不完整，未提交该工具调用。", "invalid_tool_arguments"); }
        if (value.spec.custom) {
          if (typeof args.input !== "string") throw invalid("自定义工具缺少字符串 input，未提交该调用。", "invalid_tool_arguments");
          item.input = args.input;
          queue("response.custom_tool_call_input.delta", { item_id: item.id, output_index: index, delta: item.input });
          queue("response.custom_tool_call_input.done", { item_id: item.id, output_index: index, input: item.input });
        } else {
          item.arguments = value.raw || "{}";
          queue("response.function_call_arguments.done", { item_id: item.id, output_index: index, arguments: item.arguments });
        }
      }
      item.status = "completed";
      queue("response.output_item.done", { output_index: index, item: structuredClone(item) });
    }
    response.status = truncated ? "incomplete" : "completed";
    response.incomplete_details = truncated ? { reason: "max_output_tokens" } : null;
    queue(truncated ? "response.incomplete" : "response.completed", { response: structuredClone(response) });
    return response;
  };
  return { response, consume, finish, events };
}

async function* sseJson(response, onReader = () => {}) {
  const reader = response.body.getReader();
  onReader(reader);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > MAX_UPSTREAM_BYTES) throw invalid("上游流事件过大。", "relay_response_too_large");
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function adaptedResponse(upstream, body, protocol, specs, signatures) {
  if (!upstream.ok) return upstream;
  const builder = responseBuilder(body, specs, protocol, signatures);
  if (!String(upstream.headers.get("content-type") || "").includes("text/event-stream")) {
    const payload = JSON.parse(await boundedText(upstream));
    builder.consume(payload);
    const result = builder.finish();
    if (!body.stream) return Response.json(result);
  } else if (!body.stream) {
    for await (const part of sseJson(upstream)) builder.consume(part);
    return Response.json(builder.finish());
  } else {
    // Demand-driven conversion avoids retaining the whole SSE response and
    // propagates consumer cancellation back to the network body.
    let upstreamReader = null;
    const iterator = (async function* () {
      while (builder.events.length) yield builder.events.shift();
      for await (const part of sseJson(upstream, (reader) => { upstreamReader = reader; })) {
        builder.consume(part);
        while (builder.events.length) yield builder.events.shift();
      }
      builder.finish();
      while (builder.events.length) yield builder.events.shift();
    })();
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(new TextEncoder().encode(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`));
        } catch { controller.error(new Error("上游协议流转换失败或响应不完整。")); }
      },
      async cancel() {
        // The network body may not have been locked yet if the consumer stops
        // after the initial lifecycle event.
        if (upstreamReader) await upstreamReader.cancel().catch(() => {});
        else if (!upstream.body.locked) await upstream.body.cancel().catch(() => {});
        await iterator.return();
      },
    }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }
  return new Response(builder.events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

async function unsupportedRoute(response) {
  if ([405, 501].includes(response.status)) return true;
  if (![400, 404].includes(response.status)) return false;
  try {
    const text = await boundedText(response.clone(), 16384);
    if (/model_not_found|model.*(?:does not exist|not found|not available)|(?:找不到|不存在|未找到).*模型/i.test(text)) return false;
    if (response.status === 404) return true;
    return /unsupported (?:endpoint|path|wire)|unknown (?:endpoint|path)|invalid url|responses.*(?:not supported|unsupported)|(?:not supported|unsupported).*responses/i.test(text);
  } catch { return false; }
}

export function createRelayTransport({ baseUrl, apiKey, fetcher = globalThis.fetch, state = null }) {
  const { hint } = urlParts(baseUrl);
  const routes = new Map();
  const signatures = new Map((Array.isArray(state?.signatures) ? state.signatures : [])
    .filter((entry) => Array.isArray(entry) && entry.length === 2 && entry.every((value) => typeof value === "string" && value.length <= 65536)).slice(-MAX_SIGNATURES));
  const headersFor = (protocol) => ({
    "content-type": "application/json", "accept-encoding": "identity",
    ...(protocol === "gemini" ? { "x-goog-api-key": apiKey } : protocol === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${apiKey}` }),
  });
  return {
    // Used only for in-memory rollback / stdin handoff to the owned local
    // helper. Never place these opaque values in gateway-host.json or logs.
    snapshot: () => ({ signatures: [...signatures.entries()] }),
    async models(options = {}) {
      const native = hint === "gemini";
      const response = await fetcher(relayModelsUrl(baseUrl).toString(), { ...options, method: "GET", redirect: "error", headers: headersFor(native ? "gemini" : hint === "anthropic" ? "anthropic" : "responses") });
      if (!native || !response.ok) return response;
      const payload = JSON.parse(await boundedText(response));
      return Response.json({ data: (payload.models || []).map((entry) => ({ ...entry, id: String(entry.name || entry.id || "").replace(/^models\//, ""), display_name: entry.displayName || entry.name })) });
    },
    async request(body, { endpoint = "/responses", signal, headers = {} } = {}) {
      const cached = routes.get(body.model);
      const fallbacks = /gemini/i.test(body.model) ? ["chat", "gemini", "anthropic"] : /claude|sonnet|opus|haiku/i.test(body.model) ? ["anthropic", "chat", "gemini"] : ["chat", "anthropic", "gemini"];
      const protocols = [...new Set([hint || cached || "responses", ...(hint || cached ? [] : fallbacks)])];
      let last;
      for (const protocol of protocols) {
        if (endpoint === "/responses/compact" && protocol !== "responses") throw invalid("该上游不支持 Responses 远程压缩；请使用 Codex 本地上下文压缩或原生 Responses 服务。", "unsupported_compaction");
        const converted = protocol === "responses" ? null : convertRelayRequest(body, protocol, signatures);
        let url = relayEndpoint(baseUrl, protocol, body.model, body.stream);
        if (endpoint === "/responses/compact") url += "/compact";
        const response = await fetcher(url, {
          method: "POST", redirect: "error", signal,
          headers: { ...(protocol === "responses" ? headers : {}), ...headersFor(protocol) },
          body: JSON.stringify(converted?.body || body),
        });
        if (protocols.indexOf(protocol) < protocols.length - 1 && await unsupportedRoute(response)) {
          await response.body?.cancel().catch(() => {});
          last = response;
          continue;
        }
        if (response.ok) {
          routes.set(body.model, protocol);
          while (routes.size > 512) routes.delete(routes.keys().next().value);
        }
        return converted ? adaptedResponse(response, body, protocol, converted.specs, signatures) : response;
      }
      return last;
    },
  };
}
