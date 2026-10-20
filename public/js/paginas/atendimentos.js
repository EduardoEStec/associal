// Atendimentos — roteador da página por hash:
//   (vazio) lista · #novo formulário · #<id> detalhe · #<id>/editar edição
import { iniciarPagina } from '../layout.js';
import { api } from '../api.js';
import { h, toast } from '../ui.js';
import { renderLista } from '../atendimentos/lista.js';
import { renderForm } from '../atendimentos/form.js';
import { renderDetalhe } from '../atendimentos/detalhe.js';

const { usuario, conteudo } = await iniciarPagina('atendimentos');

let apoio;
try {
  apoio = await api.get('/api/apoio');
} catch (e) {
  conteudo.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
  throw e;
}
const ctx = { usuario, conteudo, apoio };

async function rotear() {
  const hash = location.hash.replace(/^#/, '');
  window.scrollTo(0, 0);
  try {
    if (hash === 'novo' && usuario.perfil !== 'ADMIN') await renderForm(ctx);
    else if (/^\d+$/.test(hash)) await renderDetalhe(ctx, Number(hash));
    else if (/^\d+\/editar$/.test(hash) && usuario.perfil !== 'ADMIN') await renderForm(ctx, Number(hash.split('/')[0]));
    else await renderLista(ctx);
  } catch (e) {
    conteudo.replaceChildren(
      h('div', { class: 'pagina-titulo' }, h('h1', {}, 'Atendimentos'), h('a', { class: 'btn btn-secundario', href: '#' }, 'Voltar à lista')),
      h('div', { class: 'aviso aviso-perigo' }, e.message || 'Não foi possível carregar.'),
    );
    toast.erro(e.message || 'Não foi possível carregar.');
  }
}

window.addEventListener('hashchange', rotear);
await rotear();
