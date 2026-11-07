import { pipeline, TextStreamer } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
const EMPTY_RESPONSE_MESSAGE = "I couldn't generate a reply that time. Please try again or rephrase your message.";
const MAX_EMPTY_RESPONSE_RETRIES = 1;
let generator = null;
let generatorPromise = null;
let activeDevice = "";

function reportProgress(requestId, progress) {
  self.postMessage({
    type: "progress",
    requestId,
    status: progress.status,
    progress: progress.progress,
    message: progress.message
  });
}

async function createGenerator(device, dtype, requestId) {
  return pipeline("text-generation", MODEL_ID, {
    device,
    dtype,
    progress_callback: progress => reportProgress(requestId, progress)
  });
}

async function loadGenerator(requestId, forceCpu = false) {
  if (generator && (!forceCpu || activeDevice === "wasm")) return generator;
  if (generatorPromise) return generatorPromise;

  generatorPromise = (async () => {
    if (!forceCpu && self.navigator?.gpu) {
      try {
        const adapter = await self.navigator.gpu.requestAdapter();
        if (adapter) {
          reportProgress(requestId, { status: "initiate", message: "Preparing Qwen with WebGPU..." });
          generator = await createGenerator("webgpu", "q4f16", requestId);
          activeDevice = "webgpu";
          return generator;
        }
      } catch (error) {
        console.warn("Smiley WebGPU initialization failed; falling back to WASM.", error);
        reportProgress(requestId, { status: "initiate", message: "WebGPU unavailable; switching to CPU mode..." });
      }
    }

    reportProgress(requestId, { status: "initiate", message: "Preparing Qwen with CPU acceleration..." });
    generator = await createGenerator("wasm", "q4", requestId);
    activeDevice = "wasm";
    return generator;
  })().catch(error => {
    generator = null;
    activeDevice = "";
    throw error;
  }).finally(() => {
    generatorPromise = null;
  });

  return generatorPromise;
}

function getAssistantText(output) {
  const generated = output[0]?.generated_text;
  const text = Array.isArray(generated)
    ? generated.at(-1)?.content
    : generated;
  if (typeof text !== "string") throw new Error("Qwen returned an empty response.");
  const reply = text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
  if (!reply) throw new Error("Qwen returned an empty response.");
  return reply;
}

async function generate(messages, requestId) {
  for (let attempt = 0; attempt <= MAX_EMPTY_RESPONSE_RETRIES; attempt += 1) {
    const attemptMessages = attempt === 0
      ? messages
      : [
        {
          ...messages[0],
          content: `${messages[0].content}\n\nThe previous attempt returned no visible answer. Do not reason aloud or use <think> tags. Reply directly with a concise, complete answer.`
        },
        ...messages.slice(1)
      ];

    if (attempt > 0) self.postMessage({ type: "clear", requestId });
    let activeGenerator = await loadGenerator(requestId);
    let output;
    try {
      output = await runGeneration(activeGenerator, attemptMessages, requestId);
    } catch (error) {
      if (activeDevice !== "webgpu") throw error;
      console.warn("Smiley WebGPU generation failed; retrying with WASM.", error);
      reportProgress(requestId, { status: "initiate", message: "GPU generation failed; switching to CPU mode..." });
      generator = null;
      activeDevice = "";
      activeGenerator = await loadGenerator(requestId, true);
      self.postMessage({ type: "clear", requestId });
      output = await runGeneration(activeGenerator, attemptMessages, requestId);
    }

    try {
      return { text: getAssistantText(output), usedFallback: false };
    } catch (error) {
      if (error.message !== "Qwen returned an empty response.") throw error;
      if (attempt === MAX_EMPTY_RESPONSE_RETRIES) {
        console.warn("Qwen returned an empty response after retrying; showing a retry message.");
        return { text: EMPTY_RESPONSE_MESSAGE, usedFallback: true };
      }
      console.warn("Qwen returned an empty response; retrying with final-answer-only guidance.");
    }
  }
  throw new Error("Qwen response retry limit was exceeded.");
}

async function runGeneration(activeGenerator, messages, requestId) {
  const streamer = new TextStreamer(activeGenerator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: text => self.postMessage({ type: "chunk", requestId, text })
  });
  return activeGenerator(messages, {
    max_new_tokens: 220,
    do_sample: true,
    temperature: 0.4,
    top_p: 0.9,
    repetition_penalty: 1.1,
    streamer
  });
}

self.addEventListener("message", async ({ data }) => {
  const { requestId } = data;
  try {
    if (data.type === "initialize") {
      await loadGenerator(requestId);
      self.postMessage({ type: "ready", requestId });
      return;
    }
    if (data.type === "generate") {
      const result = await generate(data.messages, requestId);
      self.postMessage({ type: "result", requestId, result });
    }
  } catch (error) {
    console.error("Smiley model worker request failed.", error);
    self.postMessage({ type: "error", requestId, message: error.message || "Unknown model worker error." });
  }
});
