<script setup>
import { ref, watch, computed } from 'vue';
import { api, dataSource } from '../api.js';
import { useLoader } from '../lib/useLoader.js';
import ScoreBadge from '../components/ScoreBadge.vue';
import GateNote from '../components/GateNote.vue';
import PromptTestResult from '../components/PromptTestResult.vue';

const props = defineProps({ id: String });
const detail = ref(null);
const calls = ref([]);
const draftPrompt = ref('');
const savedPrompt = ref('');
const testResult = ref(null);
const testing = ref(false);
const saving = ref(false);
const configError = ref('');
const configNotice = ref('');
// Editing and testing a prompt both need the API. On the static snapshot deploy there
// isn't one, so the controls say why rather than failing when they're pressed.
const backendLive = ref(true);
const { loading, error, run } = useLoader();

watch(
  () => props.id,
  async (id) => {
    detail.value = null;
    testResult.value = null;
    configError.value = '';
    configNotice.value = '';
    const res = await run(() => Promise.all([api.agent(id), api.agentCalls(id)]));
    if (res) {
      [detail.value, calls.value] = res;
      draftPrompt.value = detail.value.agent.prompt || '';
      savedPrompt.value = draftPrompt.value;
      backendLive.value = dataSource() === 'backend';
    }
  },
  { immediate: true }
);

const promptDirty = computed(() => draftPrompt.value !== savedPrompt.value);

async function savePrompt() {
  configError.value = '';
  configNotice.value = '';
  saving.value = true;
  try {
    const res = await api.savePrompt(props.id, draftPrompt.value);
    savedPrompt.value = draftPrompt.value;
    if (detail.value) detail.value.agent.prompt = res.agent?.prompt ?? draftPrompt.value;
    configNotice.value = 'Prompt saved.';
  } catch (e) {
    configError.value = e?.message || String(e);
  } finally {
    saving.value = false;
  }
}

async function testPrompt() {
  configError.value = '';
  configNotice.value = '';
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await api.testPrompt(props.id, draftPrompt.value);
  } catch (e) {
    configError.value = e?.message || String(e);
  } finally {
    testing.value = false;
  }
}

// The KPI list shown on the page = every criterion for this agent.
// The API only returns the FAILING ones (with a failRate); we append the
// passing ones at 0% so the list is complete. (Kept here as a named computed
// instead of inline in the template so it's easy to read.)
const criteriaRows = computed(() => {
  if (!detail.value) return [];
  const failing = detail.value.summary.topFailures;
  const failingIds = new Set(failing.map((f) => f.criterionId));
  const passing = detail.value.criteria
    .filter((c) => !failingIds.has(c.id))
    .map((c) => ({ criterionId: c.id, label: c.label, type: c.type, severity: c.severity, failRate: 0 }));
  return [...failing, ...passing];
});

const barColor = (rate) => (rate >= 50 ? 'var(--bad)' : rate >= 20 ? 'var(--warn)' : 'var(--good)');
</script>

<template>
  <div v-if="loading && !detail" class="loading">Loading agent…</div>
  <div v-else-if="error && !detail" class="empty card">
    Couldn't load this agent: {{ error }}
    <div style="margin-top:10px"><RouterLink to="/" class="btn">Back to dashboard</RouterLink></div>
  </div>
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
        <!-- Same explanation the call view gives, one level up. -->
        <GateNote
          :gated-by="detail.summary.gatedBy"
          :cap="detail.summary.scoreCap"
          :raw-score="detail.summary.rawAvgScore"
          basis="mean across calls"
        />
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

    <!-- Prompt config + synthetic test -->
    <h2 class="section">Agent prompt</h2>
    <div class="card">
      <p class="muted" style="margin:0 0 10px">
        Edit the prompt below, then test against failing KPIs before saving.
      </p>
      <div v-if="!backendLive" class="gate-note" style="margin-bottom:10px">
        Read-only: this page is served from the pre-computed snapshot, which has no API.
        Run the backend (<code>cd server &amp;&amp; npm start</code>) to test or save a prompt.
      </div>
      <textarea
        v-model="draftPrompt"
        class="prompt-editor"
        rows="8"
        spellcheck="false"
        :readonly="!backendLive"
        placeholder="Agent system prompt / script…"
      ></textarea>
      <div class="row" style="margin-top:12px">
        <button
          class="btn"
          :disabled="!backendLive || testing || !draftPrompt.trim()"
          @click="testPrompt"
        >
          {{ testing ? 'Testing…' : 'Test prompt' }}
        </button>
        <button
          class="btn primary"
          :disabled="!backendLive || saving || !promptDirty"
          @click="savePrompt"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="promptDirty" class="muted" style="font-size:12px">Unsaved changes</span>
      </div>
      <div v-if="configError" class="gate-note" style="margin-top:12px">{{ configError }}</div>
      <div v-if="configNotice" class="muted" style="margin-top:8px">{{ configNotice }}</div>
      <PromptTestResult :test-result="testResult" />
    </div>

    <!-- Criteria / KPI performance -->
    <h2 class="section">Success criteria (KPIs) — failure rate</h2>
    <div class="card">
      <div v-for="c in criteriaRows" :key="c.criterionId" style="padding:8px 0; border-bottom:1px solid var(--border)">
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
