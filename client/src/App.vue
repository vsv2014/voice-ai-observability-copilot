<script setup>
import { ref, onMounted } from 'vue';
import { api } from './api.js';
import { requestGhlContext } from './lib/ghlContext.js';

const health = ref(null);
const ctx = ref(null);

onMounted(async () => {
  ctx.value = await requestGhlContext();
  try {
    health.value = await api.health();
  } catch {
    health.value = { ok: false };
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo">◑</div>
        <div>
          <h1>Voice AI Observability Copilot</h1>
          <p>Monitor · Analyze · Recommend — the validation flywheel for HighLevel Voice AI</p>
        </div>
      </div>
      <RouterLink to="/" class="btn">Dashboard</RouterLink>
    </header>

    <RouterView />

    <!-- The footer is the app's honesty surface, so it must distinguish a live backend
         from the precomputed snapshot a static deploy falls back to. Reading `health.ok`
         alone claimed "Backend connected · engine: groq" with no backend running. -->
    <footer class="footer" v-if="health">
      <span v-if="health.source === 'snapshot'">
        <span class="dot off"></span>No backend — <strong>precomputed snapshot</strong>
      </span>
      <span v-else><span class="dot" :class="health.ok ? 'on' : 'off'"></span>Backend {{ health.ok ? 'connected' : 'offline' }}</span>
      <span v-if="health.ghlMode">GHL source: <strong>{{ health.ghlMode }}</strong></span>
      <span v-if="health.llm">
        Analysis engine: <strong>{{ health.llm }}</strong>
        <span v-if="health.source === 'snapshot'" class="muted"> (recorded, not running)</span>
      </span>
      <span v-if="ctx">Embed: <strong>{{ ctx.embedded ? ctx.source : 'standalone' }}</strong></span>
    </footer>
  </div>
</template>
