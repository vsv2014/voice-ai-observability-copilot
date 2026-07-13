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

    <footer class="footer" v-if="health">
      <span><span class="dot" :class="health.ok ? 'on' : 'off'"></span>Backend {{ health.ok ? 'connected' : 'offline' }}</span>
      <span v-if="health.ghlMode">GHL source: <strong>{{ health.ghlMode }}</strong></span>
      <span v-if="health.llm">Analysis engine: <strong>{{ health.llm }}</strong></span>
      <span v-if="ctx">Embed: <strong>{{ ctx.embedded ? ctx.source : 'standalone' }}</strong></span>
    </footer>
  </div>
</template>
