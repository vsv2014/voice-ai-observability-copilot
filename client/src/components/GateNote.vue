<script setup>
// Explains a capped score. Without it, a gated score looks arbitrary next to a
// mostly-passing findings list — "why is this 39 when 4 of 5 criteria passed?"
// Used wherever a score is shown as a health summary: one call, or an agent's average.
defineProps({
  gatedBy: { type: String, default: null }, // 'critical' | 'high'
  cap: { type: Number, default: null },     // the ceiling that was applied
  rawScore: { type: Number, default: null }, // the ungated number it replaced
  basis: { type: String, default: 'weighted average' }, // what rawScore was computed from
});
</script>

<template>
  <div v-if="gatedBy" class="gate-note">
    <span class="tag" :class="gatedBy">{{ gatedBy }}</span>
    Score capped at <strong>{{ cap }}</strong> ({{ basis }} was {{ rawScore }}).
    A {{ gatedBy }}-severity failure can't be averaged away.
  </div>
</template>
