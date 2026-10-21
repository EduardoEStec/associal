// Acompanhamento Familiar — roteador por hash dentro da página:
//   #/                       lista de famílias
//   #/nova                   cadastro
//   #/a/<id>                 ficha da família (aba Resumo)
//   #/a/<id>/indicadores     aba Indicadores (índice de progresso)
//   #/a/<id>/acompanhamento  aba Acompanhamento (registros de contato); /novo abre o formulário
//   #/a/<id>/linha-do-tempo  aba Linha do tempo
//   #/a/<id>/pesquisa/<FINAL|SEMESTRAL|AVULSA>  pesquisa de satisfação (passo a passo)
//   #/a/<id>/editar          edição
//   #/a/<id>/q/INICIAL|REAVALIACAO|FINAL questionário em etapas
//   #/a/<id>/comparacao      comparação inicial × final
import { iniciarPagina } from '../layout.js';
import { h, toast } from '../ui.js';
import { podeEscrever, montar } from '../familias/util.js';
import { renderLista } from '../familias/lista.js';
import { renderCadastro } from '../familias/cadastro.js';
import { renderDetalhe } from '../familias/detalhe.js';
import { renderQuestionario } from '../familias/questionario.js';
import { renderComparacao } from '../familias/comparacao.js';
import { renderPesquisa } from '../familias/pesquisa.js';

const { usuario, conteudo } = await iniciarPagina('familias');

const ctx = {
  usuario,
  conteudo,
  aoSair: null,
  // navegar('#/a/3'): muda o hash; com `forcar`, redesenha mesmo que o hash seja o mesmo
  navegar(hash, forcar = false) {
    if (location.hash === hash) { if (forcar) rotear(); } else location.hash = hash;
  },
};

function exigirEscrita() {
  if (!podeEscrever(usuario)) throw new Error('Seu perfil não pode cadastrar ou alterar famílias.');
}

let geracao = 0;
async function rotear() {
  const minha = ++geracao;
  if (ctx.aoSair) {
    const sair = ctx.aoSair;
    ctx.aoSair = null;
    try { await sair(); } catch { /* o salvamento já mostrou o erro */ }
  }
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (partes.length === 0) await renderLista(ctx);
    else if (partes[0] === 'nova') { exigirEscrita(); await renderCadastro(ctx); }
    else if (partes[0] === 'a' && /^\d+$/.test(partes[1] || '')) {
      const id = Number(partes[1]);
      if (partes.length === 2) await renderDetalhe(ctx, id);
      else if (partes[2] === 'editar') { exigirEscrita(); await renderCadastro(ctx, id); }
      else if (partes[2] === 'q' && partes[3]) await renderQuestionario(ctx, id, partes[3]);
      else if (partes[2] === 'comparacao') await renderComparacao(ctx, id);
      else if (partes[2] === 'acompanhamento') await renderDetalhe(ctx, id, 'acompanhamento', { abrirNovo: partes[3] === 'novo' });
      else if (partes[2] === 'linha-do-tempo') await renderDetalhe(ctx, id, 'linha-do-tempo');
      else if (partes[2] === 'indicadores') await renderDetalhe(ctx, id, 'indicadores');
      else if (partes[2] === 'pesquisa') await renderPesquisa(ctx, id, partes[3]);
      else erroRota('Página não encontrada.');
    } else erroRota('Página não encontrada.');
  } catch (e) {
    if (minha !== geracao) return;
    toast.erro(e.message);
    erroRota(e.status === 404 ? 'Registro não encontrado ou sem acesso.' : e.message);
  }
  if (minha === geracao) window.scrollTo(0, 0);
}

function erroRota(mensagem) {
  montar(conteudo, 
    h('div', { class: 'pagina-titulo' }, h('h1', {}, 'Acompanhamento Familiar')),
    h('div', { class: 'aviso aviso-aviso' }, mensagem),
    h('a', { class: 'btn', href: '#/' }, 'Voltar à lista'));
}

window.addEventListener('hashchange', rotear);
await rotear();
