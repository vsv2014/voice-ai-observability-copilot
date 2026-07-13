<script setup>
import { computed } from 'vue';
const props = defineProps({ score: { type: Number, default: null } });
const cls = computed(() => {
  if (props.score == null) return 'muted';
  if (props.score >= 80) return 'good';
  if (props.score >= 60) return 'warn';
  return 'bad';
});
</script>

<template>
  <span v-if="score != null" class="score" :class="cls">{{ score }}</span>
  <span v-else class="muted">—</span>
</template>
