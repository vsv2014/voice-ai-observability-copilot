<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useLoader } from '../lib/useLoader.js';
import ScoreBadge from '../components/ScoreBadge.vue';

const router = useRouter();
const data = ref(null);
const useActions = ref([]);
const running = ref(false);
const { loading, error, run } = useLoader();

async function load() {
  const res = await run(async () => {
    const [overview, actions] = await Promise.all([api.overview(), api.useActions()]);
    return { overview, actions };
  });
  if (res) {
    data.value = res.overview;
    useActions.value = res.actions;
  }
}

async function rerun() {
  running.value = true;
  try {
    await api.analyze();
    await load();
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    running.value = false;
  }
}

function openAgent(id) {
  router.push({ name: 'agent', params: { id } });
}

onMounted(load);
</script>

<template>
  <div v-if="loading && !data" class="loading">Loading observability data…</div>
  <div v-else-if="error && !data" class="empty card">
    Couldn't load data: {{ error }}. Is the backend running on :3001?
    <div style="margin-top:10px"><button class="btn" @click="load">Retry</button></div>
  </div>

  <div v-else-if="data">
    <div class="row" style="margin-bottom:14px">
      <h2 class="section" style="margin:0">Account overview</h2>
      <span class="spacer"></span>
      <span class="muted" v-if="data.lastRunAt">Last analyzed {{ new Date(data.lastRunAt).toLocaleString() }}</span>
      <button class="btn primary" :disabled="running" @click="rerun">
        {{ running ? 'Analyzing…' : 'Re-run analysis' }}
      </button>
    </div>

    <div v-if="error" class="empty card" style="color:var(--bad); padding:12px; text-align:left">{{ error }}</div>

    <!-- KPI tiles -->
    <div class="grid cols-4" style="margin-bottom:8px">
      <div class="card stat">
        <div class="label">Avg call score</div>
        <div class="value"><ScoreBadge :score="data.totals.avgScore" /></div>
        <div class="sub">across {{ data.totals.callsScored }} calls</div>
      </div>
      <div class="card stat">
        <div class="label">Voice agents</div>
        <div class="value">{{ data.totals.agents }}</div>
        <div class="sub">monitored</div>
      </div>
      <div class="card stat">
        <div class="label">Open issues</div>
        <div class="value" style="color:var(--warn)">{{ data.totals.openIssues }}</div>
        <div class="sub">failed / missed criteria</div>
      </div>
      <div class="card stat">
        <div class="label">Use actions</div>
        <div class="value" style="color:var(--bad)">{{ data.totals.useActions }}</div>
        <div class="sub">high-severity, need a human</div>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <!-- Agent health table -->
      <div class="card">
        <h3>Agent health (worst first)</h3>
        <table>
          <thead>
            <tr><th>Agent</th><th>Score</th><th>Calls</th><th>Top failing criterion</th></tr>
          </thead>
          <tbody>
            <tr v-for="a in data.agents" :key="a.id" class="clickable" @click="openAgent(a.id)">
              <td><strong>{{ a.name }}</strong></td>
              <td><ScoreBadge :score="a.avgScore" /></td>
              <td>{{ a.callsScored }}</td>
              <td>
                <span v-if="a.topFailures.length">
                  {{ a.topFailures[0].label }}
                  <span class="muted">({{ a.topFailures[0].failRate }}%)</span>
                </span>
                <span v-else class="muted">none</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Use actions -->
      <div class="card">
        <h3>Use actions — call segments needing a human</h3>
        <div v-if="!useActions.length" class="empty">No actions. Agents are healthy.</div>
        <div v-for="(ua, i) in useActions.slice(0, 6)" :key="i" class="row" style="padding:9px 0; border-bottom:1px solid var(--border)">
          <span class="tag" :class="ua.severity">{{ ua.severity }}</span>
          <div style="flex:1">
            <div>{{ ua.label }} <span class="tag" :class="ua.status">{{ ua.status }}</span></div>
            <div class="muted" style="font-size:12px">{{ ua.explanation }}</div>
          </div>
          <RouterLink class="btn" :to="{ name: 'call', params: { callId: ua.callId } }">Open</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
