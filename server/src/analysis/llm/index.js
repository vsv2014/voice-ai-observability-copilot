import { config, llmEnabled } from '../../config.js';

/**
 * LLM provider abstraction. One function — `complete(prompt)` -> string.
 * Providers use plain fetch (no SDKs) so there are zero extra dependencies and
 * any free-tier key works. If no provider/key is configured, `complete` is null
 * and callers fall back to the deterministic/templated path.
 */
export function getLlm() {
  if (!llmEnabled()) return { available: false, name: 'deterministic', complete: null };
  const p = config.llm.provider;
  if (p === 'gemini') return { available: true, name: 'gemini', complete: geminiComplete };
  if (p === 'groq') return { available: true, name: 'groq', complete: groqComplete };
  return { available: false, name: 'deterministic', complete: null };
}

async function geminiComplete(prompt) {
  const { apiKey, model } = config.llm.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function groqComplete(prompt) {
  const { apiKey, model } = config.llm.groq;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/** Safe JSON parse for LLM output (handles ```json fences). */
export function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
