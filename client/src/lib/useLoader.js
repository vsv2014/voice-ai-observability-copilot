import { ref } from 'vue';

/**
 * Async loader with a request-sequence guard and error capture.
 *
 * - `loading`/`error` refs drive the UI.
 * - Each `run(fn)` bumps a sequence number; if a newer run starts before an older
 *   one resolves, the stale result is discarded (returns undefined) so a slow
 *   response can't overwrite the current view (the route-change race).
 * - A rejected `fn` sets `error` instead of leaving the view stuck on "loading".
 */
export function useLoader() {
  const loading = ref(false);
  const error = ref(null);
  let seq = 0;

  async function run(fn) {
    const id = ++seq;
    loading.value = true;
    error.value = null;
    try {
      const result = await fn();
      return id === seq ? result : undefined; // drop stale result
    } catch (e) {
      if (id === seq) error.value = e?.message || String(e);
      return undefined;
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  return { loading, error, run };
}
