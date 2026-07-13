// Quick non-HTTP smoke test of the analysis pipeline. Run: node src/smoke.js
import { runAnalysis } from './analysis/run.js';
import { ghl } from './ghl/adapter.js';
import { loadCriteria } from './analysis/criteria.js';
import { accountOverview, useActions } from './analysis/metrics.js';
import { store } from './store/store.js';

const r = await runAnalysis();
console.log('RUN:', r);

const agents = await ghl.listAgents();
const criteria = loadCriteria(agents);
const ov = accountOverview(agents, criteria);
console.log('\nOVERVIEW totals:', ov.totals);
for (const a of ov.agents) {
  console.log(`  ${a.name}: score=${a.avgScore} calls=${a.callsScored} topFail=${a.topFailures[0]?.label || '-'}`);
}

console.log('\nTOP USE-ACTIONS:');
for (const ua of useActions().slice(0, 4)) {
  console.log(`  [${ua.severity}] ${ua.label} (${ua.status}) call=${ua.callId} turn=${ua.turnIndex}`);
}

console.log('\nRECS for solar:', JSON.stringify(store.getRecommendations('agent_solar_followup'), null, 2));
