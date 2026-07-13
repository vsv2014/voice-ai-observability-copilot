import 'dotenv/config';

/**
 * Central config. Everything has a safe default so the app boots with zero setup.
 */
export const config = {
  port: Number(process.env.PORT) || 3001,

  ghl: {
    mode: process.env.GHL_MODE || 'mock', // 'mock' | 'live'
    clientId: process.env.GHL_CLIENT_ID || '',
    clientSecret: process.env.GHL_CLIENT_SECRET || '',
    accessToken: process.env.GHL_ACCESS_TOKEN || '',
    locationId: process.env.GHL_LOCATION_ID || '',
    apiBase: process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com',
    apiVersion: process.env.GHL_API_VERSION || '2021-07-28',
  },

  llm: {
    // 'deterministic' needs no key and always works. 'gemini'/'groq' use free tiers.
    provider: process.env.LLM_PROVIDER || 'deterministic',
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || '',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    },
  },
};

/** True when a real LLM provider is configured with a usable key. */
export function llmEnabled() {
  const p = config.llm.provider;
  if (p === 'gemini') return Boolean(config.llm.gemini.apiKey);
  if (p === 'groq') return Boolean(config.llm.groq.apiKey);
  return false;
}
