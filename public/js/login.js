import { api } from './api.js';
import { comEspera } from './ui.js';
import { registrarServiceWorker } from './pwa.js';

registrarServiceWorker();

const form = document.getElementById('form-login');
const erro = document.getElementById('erro-login');

// Só aceita voltar para caminhos internos (evita redirecionamento para sites externos)
function destino() {
  const proximo = new URLSearchParams(location.search).get('proximo');
  return proximo && proximo.startsWith('/') && !proximo.startsWith('//') ? proximo : '/index.html';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erro.classList.add('oculto');
  await comEspera(document.getElementById('botao-entrar'), async () => {
    try {
      await api.post('/api/auth/login', { login: form.login.value, senha: form.senha.value });
      location.href = destino();
    } catch (err) {
      const detalhe = err.detalhes ? Object.values(err.detalhes)[0] : null;
      erro.textContent = detalhe || err.message;
      erro.classList.remove('oculto');
      form.senha.select();
    }
  });
});

// Já logado? Vai direto ao sistema.
api.get('/api/auth/me').then(() => { location.replace(destino()); }).catch(() => {});
