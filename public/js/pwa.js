// Registro do service worker (PWA). Falhas são silenciosas: o sistema funciona sem ele.
export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
