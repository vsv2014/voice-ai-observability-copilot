<script setup>
import { ref, watchEffect } from 'vue';
import { api } from '../api.js';
import ScoreBadge from '../components/ScoreBadge.vue';

const props = defineProps({ id: String });
const detail = ref(null);
const calls = ref([]);
const loading = ref(true);

watchEffect(async () => {
  loading.value = true;
  [detail.value, calls.value] = await Promise.all([api.agent(props.id), api.agentCalls(props.id)]);
  loading.value = false;
});

const barColor = (rate) => (rate >= 50 ? 'var(--bad)' : rate >= 20 ? 'var(--warn)' : 'var(--good)');
</script>

<template>
  <div v-if="loading" class="loading">Loading agent…</div>
  <div v-else-if="detail">
    <div class="breadcrumb"><RouterLink to="/">Dashboard</RouterLink> / {{ detail.agent.name }}</div>

    <div class="grid cols-2">
      <div class="card">
        <h3>Agent</h3>
        <div class="row" style="margin-bottom:8px">
          <strong style="font-size:16px">{{ detail.agent.name }}</strong>
          <span class="spacer"></span>
          <ScoreBadge :score="detail.summary.avgScore" />
        </div>
        <p class="muted" style="margin:0 0 10px">{{ detail.agent.goal }}</p>
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <span class="pill" v-for="t in detail.agent.tags" :key="t">{{ t }}</span>
        </div>
      </div>

      <div class="card stat">
        <div class="label">Calls scored</div>
        <div class="value">{{ detail.summary.callsScored }}</div>
        <div class="sub">{{ detail.summary.highSeverityOpen }} high-severity open · {{ detail.recommendations.length }} recommendations</div>
      </div>
    </div>

    <!-- Criteria / KPI performance -->
    <h2 class="section">Success criteria (KPIs) — failure rate</h2>
    <div class="card">
      <div v-for="c in detail.summary.topFailures.concat(
             detail.criteria.filter(x => !detail.summary.topFailures.find(t => t.criterionId === x.id))
                            .map(x => ({ criterionId:x.id, label:x.label, type:x.type, severity:x.severity, failRate:0 }))
           )" :key="c.criterionId" style="padding:8px 0; border-bottom:1px solid var(--border)">
        <div class="row">
          <span class="tag" :class="c.severity">{{ c.severity }}</span>
          <strong>{{ c.label }}</strong>
          <span class="muted">· {{ c.type }}</span>
          <span class="spacer"></span>
          <span :style="{ color: barColor(c.failRate), fontWeight: 700 }">{{ c.failRate }}% fail</span>
        </div>
        <div class="bar" style="margin-top:6px"><span :style="{ width: c.failRate + '%', background: barColor(c.failRate) }"></span></div>
      </div>
    </div>

    <!-- Recommendations -->
    <h2 class="section">AI recommendations</h2>
    <div v-if="!detail.recommendations.length" class="empty card">No recommendations — this agent is meeting its criteria.</div>
    <div v-for="r in detail.recommendations" :key="r.id" class="card rec" :class="r.priority" style="margin-bottom:12px">
      <div class="row">
        <span class="tag" :class="r.priority">{{ r.priority }}</span>
        <strong>{{ r.title }}</strong>
        <span class="spacer"></span>
        <span class="pill">target: {{ r.target }}</span>
      </div>
      <p class="muted" style="margin:8px 0 0">{{ r.rationale }}</p>
      <pre>{{ r.suggestedChange }}</pre>
      <div class="row" style="margin-top:8px; font-size:12px" v-if="r.affectedCallIds.length">
        <span class="muted">Would fix {{ r.affectedCallIds.length }} call(s):</span>
        <RouterLink v-for="cid in r.affectedCallIds" :key="cid" class="pill" :to="{ name:'call', params:{ callId: cid } }">{{ cid }}</RouterLink>
      </div>
    </div>

    <!-- Calls -->
    <h2 class="section">Calls</h2>
    <div class="card">
      <table>
        <thead><tr><th>Call</th><th>When</th><th>Duration</th><th>Score</th><th>Issues</th></tr></thead>
        <tbody>
          <tr v-for="c in calls" :key="c.id" class="clickable" @click="$router.push({ name:'call', params:{ callId: c.id } })">
            <td><strong>{{ c.id }}</strong> <span class="muted">{{ c.direction }}</span></td>
            <td>{{ new Date(c.startedAt).toLocaleString() }}</td>
            <td>{{ c.durationSec }}s</td>
            <td><ScoreBadge :score="c.analysis?.score ?? null" /></td>
            <td>
              <span v-if="c.analysis">{{ c.analysis.findings.filter(f => f.status !== 'pass').length }}</span>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
