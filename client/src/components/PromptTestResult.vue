<script setup>
defineProps({
  testResult: { type: Object, default: null },
});
</script>

<template>
  <div v-if="testResult" class="test-results">
    <div v-if="testResult.engine === 'templated'" class="gate-note" style="margin-bottom:12px">
      Using keyword-based demo scenarios (no LLM key). Set <code>LLM_PROVIDER=gemini</code> and
      <code>GEMINI_API_KEY</code> for prompt-aware synthetic transcripts.
    </div>

    <div v-for="(r, idx) in testResult.results" :key="idx" class="test-scenario card" style="margin-bottom:12px">
      <div class="row" style="margin-bottom:10px">
        <strong>{{ r.scenario }}</strong>
        <span class="spacer"></span>
        <span class="muted">Scenario {{ idx + 1 }}</span>
      </div>

      <div class="transcript-block">
        <div v-for="(t, ti) in r.transcript" :key="ti" class="turn" :class="t.speaker">
          <div class="who">{{ t.speaker }}</div>
          <div class="bubble">{{ t.text }}</div>
        </div>
      </div>

      <table class="criteria-table" style="margin-top:12px">
        <thead>
          <tr><th>Criterion</th><th>Severity</th><th>Result</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in r.criteria" :key="c.id">
            <td>{{ c.label }}</td>
            <td><span class="tag" :class="c.severity">{{ c.severity }}</span></td>
            <td><span class="tag" :class="c.pass ? 'pass' : 'fail'">{{ c.pass ? 'pass' : 'fail' }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
