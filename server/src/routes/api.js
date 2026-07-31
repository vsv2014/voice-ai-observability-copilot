import { Router } from 'express';
import { ghl } from '../ghl/adapter.js';
import { store } from '../store/store.js';
import { loadCriteria, criteriaForAgent, persistCriteria } from '../analysis/criteria.js';
import { validateCriteria } from '../analysis/validate.js';
import { runAnalysis } from '../analysis/run.js';
import { accountOverview, agentSummary, useActions } from '../analysis/metrics.js';
import { getLlm } from '../analysis/llm/index.js';
import { config } from '../config.js';

export const api = Router();

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

// Health + which engines are active (surfaced in the UI footer).
api.get('/health', (req, res) => {
  res.json({
    ok: true,
    ghlMode: config.ghl.mode,
    llm: getLlm().name,
    lastRunAt: store.lastRunAt,
  });
});

// ── Agents ──
api.get('/agents', wrap(async (req, res) => {
  const agents = await ghl.listAgents();
  const criteria = loadCriteria(agents);
  res.json(agents.map((a) => agentSummary(a, criteria)));
}));

api.get('/agents/:id', wrap(async (req, res) => {
  const agent = await ghl.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const criteria = loadCriteria(await ghl.listAgents());
  res.json({
    agent,
    criteria: criteriaForAgent(agent.id, criteria),
    summary: agentSummary(agent, criteria),
    recommendations: store.getRecommendations(agent.id),
    useActions: useActions(agent.id),
  });
}));

// ── Calls ──
api.get('/agents/:id/calls', wrap(async (req, res) => {
  const calls = await ghl.listCalls({ agentId: req.params.id });
  res.json(
    calls.map((c) => ({ ...c, analysis: store.getCallAnalysis(c.id) }))
  );
}));

api.get('/calls/:callId', wrap(async (req, res) => {
  const call = await ghl.getCall(req.params.callId);
  if (!call) return res.status(404).json({ error: 'call not found' });
  res.json({ call, analysis: store.getCallAnalysis(call.id) });
}));

// ── Criteria (editable KPIs) ──
api.get('/agents/:id/criteria', wrap(async (req, res) => {
  const criteria = loadCriteria(await ghl.listAgents());
  res.json(criteriaForAgent(req.params.id, criteria));
}));

api.put('/agents/:id/criteria', wrap(async (req, res) => {
  const agent = await ghl.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });

  const result = validateCriteria(req.body?.criteria, req.params.id);
  if (!result.ok) {
    return res.status(400).json({ error: 'invalid criteria', details: result.errors });
  }
  const all = loadCriteria(await ghl.listAgents());
  const others = all.filter((c) => c.agentId !== req.params.id);
  if (!persistCriteria([...others, ...result.criteria])) {
    // Criteria live only on disk, so a failed write means the edit is lost. Say so
    // instead of returning ok:true for a change that didn't stick.
    return res.status(503).json({ error: 'criteria could not be saved — the data directory is not writable' });
  }

  // The stored findings and recommendations were scored against the OLD criteria, so
  // they are now stale — and partly orphaned, since they can reference criteria that no
  // longer exist. Re-score this agent immediately; otherwise the dashboard shows the new
  // criteria at 0% fail beside recommendations about criteria the user just deleted.
  const run = await runAnalysis({ agentId: req.params.id });
  res.json({ ok: true, count: result.criteria.length, reanalyzed: run.callsScored });
}));

// ── Dashboard ──
api.get('/overview', wrap(async (req, res) => {
  const agents = await ghl.listAgents();
  const criteria = loadCriteria(agents);
  res.json(accountOverview(agents, criteria));
}));

api.get('/use-actions', wrap(async (req, res) => {
  res.json(useActions(req.query.agentId));
}));

api.get('/recommendations', wrap(async (req, res) => {
  res.json(store.allRecommendations());
}));

// ── Run the Monitor+Analyze pipeline ──
api.post('/analyze', wrap(async (req, res) => {
  const result = await runAnalysis({ agentId: req.body?.agentId });
  res.json(result);
}));
