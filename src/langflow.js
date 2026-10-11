/**
 * src/langflow.js — Langflow API client
 *
 * Runs a flow through POST /api/v1/run/{endpoint} and returns the text of
 * every Chat Output, keyed by component ID. The API key stays on the
 * server; the browser never talks to Langflow directly.
 */

/* ==========================================================
   1. CONFIGURATION
   ========================================================== */

/** Flow endpoint names and fixed component IDs (see langflow/*.json). */
export const FLOW = {
  // Picks one section title; the titles of the citizen's region arrive via {daftar_judul}
  router: {
    endpoint: "tl-router",
    promptId: "Prompt Template-tlRouterPrompt",
    outputId: "ChatOutput-tlRouterOut",
  },
  // Returns the 8 nearest sections from Chroma. Vector search alone mixes up
  // near-identical sections of different regions (42/56 at rank 1), but the
  // right one is always within the top 8, so the server picks it by exact title.
  cari: {
    endpoint: "tl-cari",
    chromaId: "ext:chroma:ChromaVectorStoreComponent@official-tlCariDB",
    outputId: "ChatOutput-tlCariOut",
    pemisah: "<<<BAGIAN>>>",
  },
  // Writes the answer JSON from one section, passed in as {context}
  susun: {
    endpoint: "tl-susun",
    promptId: "Prompt Template-tlSusunPrompt",
    outputId: "ChatOutput-tlSusunOut",
  },
  // Turns a life event ("anak saya baru lahir") into an ordered list of
  // services; every title of Bandung Raya arrives via {daftar_judul}
  rencana: {
    endpoint: "tl-rencana",
    promptId: "Prompt Template-tlRencanaPrompt",
    outputId: "ChatOutput-tlRencanaOut",
  },
  // Writes the wording of the draft proposals for the local governments;
  // the findings and their numbers arrive as JSON via Chat Input (src/usulan.js)
  usulan: {
    endpoint: "tl-usulan",
    outputId: "ChatOutput-tlUsulanOut",
  },
  ingest: {
    endpoint: "tl-ingest",
    chromaId: "ext:chroma:ChromaVectorStoreComponent@official-tlIngestDB",
  },
};

/** Chroma collection holding the Bandung Raya knowledge base (override in .env). */
export function koleksiKb() {
  return process.env.KB_KOLEKSI || "tanya_layanan_v10";
}

/** Two watsonx calls can take a while; give up after 90 seconds. */
const REQUEST_TIMEOUT_MS = 90_000;

/* ==========================================================
   2. ERRORS
   ========================================================== */

/** Raised when Langflow is unreachable or answers with an error. */
export class LangflowError extends Error {
  /**
   * @param {string} message
   * @param {number} [status] — HTTP status from Langflow, if any
   */
  constructor(message, status) {
    super(message);
    this.name = "LangflowError";
    this.status = status;
  }
}

/* ==========================================================
   3. RUN A FLOW
   ========================================================== */

/**
 * Run one Langflow flow and collect its Chat Output texts.
 * @param {string} endpoint — flow endpoint name, e.g. "tl-router"
 * @param {string} inputValue — text for the Chat Input
 * @param {Record<string, Record<string, unknown>>} [tweaks] — per-component overrides
 * @param {{ outputComponent?: string, timeoutMs?: number }} [opsi] — run up to a component
 *   that is not a Chat Output (used by the ingest flow); longer timeout for big runs
 * @returns {Promise<Record<string, string>>} component ID → output text
 */
export async function runFlow(endpoint, inputValue, tweaks = {}, opsi = {}) {
  const baseUrl = process.env.LANGFLOW_URL || "http://127.0.0.1:7860";
  const apiKey = process.env.LANGFLOW_API_KEY;

  if (!apiKey) {
    throw new LangflowError("LANGFLOW_API_KEY belum diisi di file .env");
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/api/v1/run/${endpoint}?stream=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        input_value: inputValue,
        input_type: "chat",
        output_type: opsi.outputComponent ? "any" : "chat",
        ...(opsi.outputComponent && { output_component: opsi.outputComponent }),
        tweaks,
      }),
      signal: AbortSignal.timeout(opsi.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new LangflowError(`Langflow tidak bisa dihubungi (${err.message})`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new LangflowError(
      `Langflow menjawab ${response.status}: ${detail.slice(0, 200)}`,
      response.status
    );
  }

  return collectOutputs(await response.json());
}

/**
 * Flatten a Langflow run response into { componentId: text }.
 * @param {{ outputs?: { outputs?: object[] }[] }} body
 * @returns {Record<string, string>}
 */
function collectOutputs(body) {
  const texts = {};
  const results = body.outputs?.[0]?.outputs ?? [];

  results.forEach((result) => {
    if (!result?.component_id) return;
    texts[result.component_id] = extractText(result);
  });

  return texts;
}

/**
 * Pull the message text out of one result. Langflow nests it differently
 * depending on the output type, so try the known places in order.
 * @param {object} result
 * @returns {string}
 */
function extractText(result) {
  const message = result.results?.message;
  if (typeof message === "string") return message;
  if (typeof message?.text === "string") return message.text;

  const chatMessage = result.messages?.[0]?.message;
  if (typeof chatMessage === "string") return chatMessage;

  return "";
}
