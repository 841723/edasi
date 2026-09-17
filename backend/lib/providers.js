// Definición estática de los proveedores de IA (sin dependencias).
// global-settings.js y ai-provider.js importan desde aquí para evitar ciclos.

export const PROVIDERS = {
  gemini: {
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    needsApiKey: true,
    buildEndpoint(baseUrl, model) {
      return `${baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`;
    },
    authHeaders(apiKey) {
      return { "X-goog-api-key": apiKey };
    },
    buildBody({ systemPrompt, userPrompt, model }) {
      return {
        contents: [{ parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      };
    },
    extractText(data) {
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    },
    extractUsage(data) {
      return data?.usageMetadata ?? null;
    },
  },
  mock: {
    name: "Mock (desarrollo)",
    defaultBaseUrl: "",
    defaultModel: "mock-1",
    needsApiKey: false,
    buildEndpoint() {
      return "mock://generateContent";
    },
    authHeaders() {
      return {};
    },
    buildBody() {
      return {};
    },
    extractText(data) {
      return data?.text ?? null;
    },
    extractUsage(data) {
      return data?.usage ?? null;
    },
  },
};

export const PROVIDER_LIST = [
  { id: "gemini", name: "Google Gemini", needsApiKey: true, defaultModel: "gemini-2.0-flash", defaultPricing: { input_per_mtok: 0.1, output_per_mtok: 0.4 } },
  { id: "mock", name: "Mock (desarrollo)", needsApiKey: false, defaultModel: "mock-1", defaultPricing: { input_per_mtok: 0, output_per_mtok: 0 } },
];

export const CHAT_PROVIDERS = {
  gemini: {
    buildEndpoint(baseUrl) {
      return `${baseUrl.replace(/\/+$/, "")}/interactions`;
    },
    extraHeaders() {
      return { "Api-Revision": "2026-05-20" };
    },
    buildBody({ systemPrompt, input, model, previousResponseId }) {
      const body = {
        model,
        input,
        system_instruction: systemPrompt,
      };
      if (previousResponseId) body.previous_interaction_id = previousResponseId;
      return body;
    },
    extractText(data) {
      const text = (data?.steps ?? [])
        .filter((s) => s.type === "model_output")
        .map((s) => (s.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""))
        .join("\n");
      return text || null;
    },
    extractResponseId(data) {
      return data?.id ?? null;
    },
    extractUsage(data) {
      return data?.usageMetadata ?? null;
    },
  },
  mock: {
    buildEndpoint() {
      return "mock://interactions";
    },
    buildBody() {
      return {};
    },
    extractText(data) {
      return data?.text ?? null;
    },
    extractResponseId(data) {
      return data?.responseId ?? null;
    },
    extractUsage(data) {
      return data?.usage ?? null;
    },
  },
};

export const DEFAULT_PRICING = {
  gemini: { input_per_mtok: 0.1, output_per_mtok: 0.4 },
  openai: { input_per_mtok: 2.5, output_per_mtok: 10 },
  anthropic: { input_per_mtok: 3, output_per_mtok: 15 },
  openai_compatible: { input_per_mtok: 0.5, output_per_mtok: 1.5 },
  mock: { input_per_mtok: 0, output_per_mtok: 0 },
};

export function getAiProviderNames() {
  return Object.keys(PROVIDERS);
}

export function getProvider(providerId) {
  return PROVIDERS[providerId] ?? null;
}

export function getProviderById(id) {
  return PROVIDER_LIST.find((p) => p.id === id) ?? null;
}

export function getProviderName(id) {
  return PROVIDER_LIST.find((p) => p.id === id)?.name ?? id;
}
