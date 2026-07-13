/**
 * HighLevel embed context.
 *
 * When this app is loaded as a GHL Custom Page (inside an iframe), it can request
 * the current user/location by posting `REQUEST_USER_DATA` to the parent window.
 * GHL replies with an AES-encrypted payload that the BACKEND decrypts using the
 * app's Shared Secret (never client-side). See docs/ARCHITECTURE.md §3.
 *
 * Outside an iframe (local dev / standalone), we resolve to a mock context so the
 * app runs identically. This is the client half of the mocked-vs-real seam.
 */
export function requestGhlContext(timeoutMs = 1500) {
  const inIframe = window.self !== window.top;
  if (!inIframe) {
    return Promise.resolve({ embedded: false, source: 'mock', locationId: 'mock-location' });
  }

  return new Promise((resolve) => {
    const onMessage = (event) => {
      // Only trust the parent frame that hosts us — ignore forged responses from
      // sibling iframes or the page itself. (Origin isn't pinned here because GHL
      // white-label domains vary; the encrypted blob is still verified server-side
      // by decrypting with the app Shared Secret.)
      if (event.source !== window.parent) return;
      const msg = event.data;
      if (msg && msg.message === 'REQUEST_USER_DATA_RESPONSE') {
        window.removeEventListener('message', onMessage);
        // `msg.payload` is the encrypted blob; hand it to the backend to decrypt.
        resolve({ embedded: true, source: 'ghl', encrypted: msg.payload });
      }
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');

    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ embedded: true, source: 'timeout', locationId: null });
    }, timeoutMs);
  });
}
