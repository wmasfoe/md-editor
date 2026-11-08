# @md-editor/ai

The AI writing layer. It talks to a model, cleans up the answer and returns plain data: a continuation, or an edit with an exact range. It does not draw anything in the editor. `@md-editor/renderer-codemirror` shows suggestions, and the host decides what to do with them.

It speaks three cloud protocols, and any OpenAI-compatible endpoint works through a custom base URL. On the desktop app it can also run a local model.

| Provider | Client | Notes |
| :--- | :--- | :--- |
| OpenAI and compatible (DeepSeek, Ollama, LM Studio, vLLM and others) | `OpenAIClient` | Ollama needs no API key. |
| Anthropic | `AnthropicClient` | Sends the headers needed for direct browser calls. |
| Google Gemini | `GoogleClient` | Uses `systemInstruction`. For `gemini-2.5-flash` it sets `thinkingBudget: 0` to cut latency. |
| Local model | `LocalSlmClient` | Desktop only. The host supplies a `LocalInferenceBridge` that does the actual inference. |

`AI_URL_PRESETS` lists the built-in presets and their default models: OpenAI, DeepSeek, Anthropic, Google and Ollama.

## Layers

```
adapters/  -->  domain/  <--  app/
```

- `domain/`: types, the `ModelClient` contract, settings, URL presets and migration of older saved settings. It knows nothing about networks or the platform.
- `app/`: `AiWritingService` and the pipeline around the model call.
  - **Before the call**: guardrails skip code blocks, tables, formulas and bare URLs; prompt builders produce the text input and, for local models, the ChatML or fill-in-the-middle context and the GBNF grammar.
  - **After the call**: strips `<think>` blocks and similar reasoning tags, removes text repeated at the cursor boundary, and locates each edit in the document. Models report edits as `[start, end, original, replacement]` with code point offsets. Location checks that exact range first, then a window of ±5 characters around it, then the nearest place where `original` occurs, and drops the edit if `original` is not in the text, so a wrong answer cannot change unrelated text.
  - A request scheduler, a result cache, and a document-context manager that summarizes the whole document in the background.
- `adapters/`: one client per provider, each implementing `ModelClient`.

Dependencies point inward, so `domain/` can be tested without a network.

## Local models

The local models run through llama.cpp on the desktop app. The catalog is `BUILTIN_LOCAL_MODELS`:

| Tier | Model | Size | Status |
| :--- | :--- | :--- | :--- |
| `lite` | Qwen 3 0.6B (Q8_0) with a grammar-fix LoRA | about 640 MB | available |
| `standard` | Google Gemma 4 E2B (Q4_K_M) | about 1.7 GB | available |
| `pro` | not defined yet | none | not available |

`lite` uses the `/completion` endpoint for fill-in-the-middle continuation. Everything else goes through chat completions.

## Creating the service

```typescript
import { createAiWritingService } from "@md-editor/ai";

// Desktop: allow the local model and pass in the host's inference bridge.
export const desktopAiService = createAiWritingService({
  allowLocal: true,
  localBridge: desktopLocalAiBridge,
});

// Web playground and uTools: cloud providers only.
export const webAiService = createAiWritingService({ allowLocal: false });
```

## Using it

`settings` is an `AiSettings` object (`DEFAULT_AI_SETTINGS` is the starting point). `snapshot` is an `AiContextSnapshot`: the text before and after the cursor, the selected text and the editor mode.

```typescript
const snapshot = {
  before: "The weather is nice today, ",
  after: "",
  selectedText: "",
  mode: "wysiwyg" as const,
};

// Continue writing at the cursor. Returns { hasContinuation, continuation }.
const continuation = await service.continueWriting(settings, snapshot, { isGhostText: true });

// Fix grammar, typos and punctuation in the selection. Returns { hasEdit, edit }.
const fix = await service.fixGrammar(settings, {
  ...snapshot,
  before: "Here is a ",
  after: " sentence.",
  selectedText: "sentance",
});

// Check the connection from the settings panel.
const test = await service.testConnection(settings);
console.log(test.ok ? `connected in ${test.latencyMs} ms` : test.message);
```

Other methods: `predictUnifiedEdit` makes one model call that decides between an edit and a continuation, `distillDocument` and `scheduleDistillation` summarize the document in the background, `checkReadiness` reports why a feature is unavailable, and `abort` cancels a request. The calls reject with an abort error when you pass an aborted `signal`.

## Development

```bash
pnpm test
pnpm typecheck
```
