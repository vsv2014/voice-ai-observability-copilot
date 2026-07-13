import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { api } from './routes/api.js';
import { runAnalysis } from './analysis/run.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api', api);

app.get('/', (req, res) => {
  res.json({ service: 'voice-ai-observability-copilot', status: 'ok' });
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
