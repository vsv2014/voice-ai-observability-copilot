<script setup>
import { ref, watchEffect, computed } from 'vue';
import { api } from '../api.js';
import ScoreBadge from '../components/ScoreBadge.vue';

const props = defineProps({ callId: String });
const call = ref(null);
const analysis = ref(null);
const loading = ref(true);

watchEffect(async () => {
  loading.value = true;
  const res = await api.call(props.callId);
  call.value = res.call;
  analysis.value = res.analysis;
  loading.value = false;
});

// Map turnIndex -> the finding flagged on it (fail/missed only), for highlighting.
const flagByTurn = computed(() => {
  const m = {};
  for (const f of analysis.value?.findings || []) {
    if (f.status !== 'pass' && f.turnIndex != null) m[f.turnIndex] = f;
  }
  return m;
});

const fmt = (ms) => `${Math.floor(ms / 1000)}s`;
</script>

<template>
  <div v-if="loading" class="loading">Loading call…</div>
  <div v-else-if="call">
    <div class="breadcrumb">
      <RouterLink to="/">Dashboard</RouterLink> /
      <RouterLink :to="{ name:'agent', params:{ id: call.agentId } }">{{ call.agentId }}</RouterLink> /
      {{ call.id }}
    </div>

    <div class="grid cols-2">
      <!-- Transcript -->
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0">Transcript</h3>
          <span class="spacer"></span>
          <span class="muted">{{ call.direction }} · {{ call.durationSec }}s</span>
        </div>
        <div v-if="call.transcript">
          <div v-for="(t, i) in call.transcript.turns" :key="i"
               class="turn" :class="[t.role, flagByTurn[i] ? 'flag ' + flagByTurn[i].status : '']">
            <div class="who">{{ t.role }}</div>
            <div style="flex:1">
              <div class="bubble">
                {{ t.text }}
                <div v-if="flagByTurn[i]" style="margin-top:6px">
                  <span class="tag" :class="flagByTurn[i].status">{{ flagByTurn[i].status }}</span>
                  <span class="muted" style="font-size:12px"> {{ flagByTurn[i].label }} — {{ flagByTurn[i].explanation }}</span>
                </div>
              </div>
              <div class="ts">{{ fmt(t.startMs) }}</div>
            </div>
          </div>
        </div>
        <div v-else class="empty">No transcript available.</div>
      </div>

      <!-- Findings -->
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <h3 style="margin:0">Findings</h3>
          <span class="spacer"></span>
          <ScoreBadge :score="analysis?.score ?? null" />
        </div>
        <div v-if="analysis">
          <div v-for="f in analysis.findings" :key="f.criterionId" class="row" style="padding:9px 0; border-bottom:1px solid var(--border)">
            <span class="tag" :class="f.status">{{ f.status }}</span>
            <div style="flex:1">
              <div><strong>{{ f.label }}</strong></div>
              <div class="muted" style="font-size:12px">{{ f.explanation }}</div>
              <div v-if="f.evidence" class="muted" style="font-size:12px; font-style:italic">“{{ f.evidence }}”</div>
            </div>
            <span class="tag" :class="f.severity">{{ f.severity }}</span>
          </div>
          <p class="muted" style="font-size:12px; margin-top:10px">Scored by <strong>{{ analysis.engine }}</strong> engine.</p>
        </div>
        <div v-else class="empty">Not yet analyzed. Run analysis from the dashboard.</div>
      </div>
    </div>
  </div>
</template>
