// Service worker mínimo (instalação PWA + abertura rápida do "casco" do app).
// NUNCA guarda respostas de /api (dados sensíveis, LGPD) — só arquivos estáticos.
// Ao alterar CSS/JS de forma que precise invalidar o cache, incremente VERSAO.
const VERSAO = 'associal-v12';

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) =>
      cache.addAll([
        '/login.html', '/css/app.css', '/css/fontes.css', '/css/tokens.css', '/css/base.css', '/css/componentes.css', '/css/layout.css',
        '/fonts/inter-latin.woff2', '/fonts/inter-latin-ext.woff2', '/img/logo-associal.png', '/icons/icon-192.png', '/js/select-bonito.js', '/js/data-bonita.js', '/js/painel-unico.js',
      ]),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas e scripts: rede primeiro (sempre a versão nova), cache como reserva offline.
  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(req, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(req).then((emCache) => emCache || caches.match('/login.html'))),
  );
});
