import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { api } from './routes/api.js';
import { runAnalysis } from './analysis/run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '..', '..', 'client', 'dist');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api', api);

// In production (single-service deploy), serve the built Vue app so one URL
// hosts both the API and the dashboard. In local dev the Vite server handles
// the frontend, so this block is simply inactive (no dist/ present).
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({ service: 'voice-ai-observability-copilot', status: 'ok' });
  });
}

// Turn malformed JSON bodies into a clean 400 instead of an unhandled 500.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: err?.message || 'internal error' });
});

app.listen(config.port, async () => {
  console.log(`\n  Voice AI Observability Copilot — backend`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ GHL mode: ${config.ghl.mode}   LLM: ${config.llm.provider}`);

  // Warm the flywheel once on boot so the dashboard has data immediately.
  try {
    const r = await runAnalysis();
    console.log(`  ▸ Initial analysis: ${r.callsScored} calls across ${r.agents} agents\n`);
  } catch (e) {
    console.warn(`  ! Initial analysis skipped: ${e.message}\n`);
  }
});
