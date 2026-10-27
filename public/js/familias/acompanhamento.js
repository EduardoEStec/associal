// Aba "Acompanhamento" da ficha: resumo de contato, formulário curto de registro e lista de registros.
import { api, ErroApi } from '../api.js';
import { icone } from '../layout.js';
import { h, toast, abrirModal, formatarData, mostrarErrosCampos } from '../ui.js';
import { campo, textoOuTraco, ehCoordenacao } from './util.js';
import { abrirFormularioRegistro, ROTULO_SITUACAO } from './registro-form.js';
import { galeriaRegistro } from './registro-fotos.js';
import { abrirRegistroPeriodico } from './registro-periodico.js';
import { ROTULO_MOMENTO, ROTULO_LIKERT, ROTULO_MODO } from './pesquisa.js';
import { cartaoMetas, blocoMetasDoRegistro, seloAvanco } from './metas.js';

export { ROTULO_SITUACAO };
const CLASSE_SITUACAO = { MELHORANDO: 'badge-sucesso', IGUAL: 'badge-info', PIORANDO: 'badge-perigo', NAO_SEI: 'badge' };
const ICONE_SITUACAO = { MELHORANDO: 'subir', IGUAL: 'igual', PIORANDO: 'descer', NAO_SEI: null };

const pluralDias = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

// Ícone + palavra: o significado não depende só da cor.
export function seloSituacao(situacao) {
  if (!situacao) return null;
  const nome = ICONE_SITUACAO[situacao];
  return h('span', { class: `badge ${CLASSE_SITUACAO[situacao] || 'badge'}` }, nome ? icone(nome) : null, ROTULO_SITUACAO[situacao] || situacao);
}

function dadoResumo(rotulo, ...conteudo) {
  return h('div', { class: 'fam-dado' }, h('dt', {}, rotulo), h('dd', {}, ...conteudo));
}

function cartaoResumo(r, encerrado) {
  const s = r.resumo;
  let ultimo;
  if (!s.ultimoContatoEm) ultimo = ['—'];
  else {
    ultimo = [formatarData(s.ultimoContatoEm)];
    if (s.diasSemContato !== null) {
      ultimo.push(h('div', { class: 'texto-pequeno texto-suave' }, s.diasSemContato === 0 ? 'hoje' : `há ${pluralDias(s.diasSemContato)}`));
      if (s.semContato) ultimo.push(h('span', { class: 'badge badge-aviso' }, icone('alerta'), `Sem contato há mais de ${pluralDias(r.semContatoDias)}`));
    }
  }
  const proximo = s.proximoContatoEm
    ? [formatarData(s.proximoContatoEm), s.proximoContatoAtrasado ? h('div', {}, h('span', { class: 'badge badge-aviso' }, icone('relogio'), 'Atrasado')) : null]
    : ['—'];
  return h('div', { class: 'card' },
    h('dl', { class: 'fam-dados' },
      dadoResumo('Último contato', ...ultimo),
      dadoResumo('Como a família está', s.ultimaSituacao
        ? [seloSituacao(s.ultimaSituacao.situacao), h('div', { class: 'texto-pequeno texto-suave' }, `em ${formatarData(s.ultimaSituacao.data)}`)]
        : '—'),
      dadoResumo('Próximo contato', ...proximo)),
    encerrado ? null : h('p', { class: 'texto-pequeno texto-suave fam-nota' },
      'Conta como contato: registro com contato, atendimento no Armazém e questionário concluído. Tentativa sem sucesso não conta.'));
}

function cartaoRegistro(reg, { escrita, encerrado, editar, anular }) {
  const quem = reg.tipoContatoOutro ? `${reg.tipoContato} — ${reg.tipoContatoOutro}` : reg.tipoContato;
  const acoes = escrita && !encerrado && reg.podeAlterar
    ? h('div', { class: 'fam-registro-acoes' },
      h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => editar(reg) }, icone('editar'), 'Editar'),
      h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => anular(reg) }, icone('x'), 'Anular'))
    : null;
  return h('li', { class: 'card fam-registro' },
    h('div', { class: 'fam-registro-topo' },
      h('strong', {}, formatarData(reg.dataRegistro)),
      reg.mesReferencia ? h('span', { class: 'badge badge-info' }, 'Mês ' + new Date(`${reg.mesReferencia.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })) : null,
      h('span', { class: 'badge' }, quem),
      reg.houveContato
        ? seloSituacao(reg.situacao)
        : h('span', { class: 'badge badge-aviso' }, icone('alerta'), 'Não conseguiu falar')),
    reg.houveContato && (reg.usoArmazem || reg.orientacoes.length)
      ? h('dl', { class: 'fam-registro-dados' },
        reg.usoArmazem ? [h('dt', {}, 'Uso do Armazém'), h('dd', {}, reg.usoArmazem.nome)] : null,
        reg.orientacoes.length ? [h('dt', {}, 'Orientações e encaminhamentos'),
          h('dd', {}, [...reg.orientacoes.filter((o) => !o.exigeTexto).map((o) => o.nome), reg.orientacaoOutro ? `Outros: ${reg.orientacaoOutro}` : null].filter(Boolean).join('; '))] : null)
      : null,
    reg.resumo ? h('p', { class: 'fam-registro-texto' }, reg.resumo) : null,
    reg.fotos?.length ? galeriaRegistro(reg.fotos) : null,
    (reg.metas || []).length
      ? h('ul', { class: 'meta-tratadas' }, reg.metas.map((x) => h('li', {}, h('span', { class: 'texto-suave' }, `${x.dimensaoNome}: `), x.descricao, ' ', seloAvanco(x.avanco))))
      : null,
    h('div', { class: 'fam-registro-rodape texto-pequeno texto-suave' },
      h('span', {}, `Registrado por ${textoOuTraco(reg.autor?.nome)}`),
      reg.proximoContatoEm ? h('span', {}, `Próximo contato: ${formatarData(reg.proximoContatoEm)}`) : null),
    acoes);
}

function abrirAnulacao({ id, registro, aoSalvar }) {
  const motivo = h('textarea', { class: 'textarea', id: 'an-motivo', name: 'motivo', maxlength: 200, rows: 3 });
  const form = h('form', { novalidate: true },
    h('p', {}, `O registro de ${formatarData(registro.dataRegistro)} deixa de aparecer na ficha e nos números. A anulação fica registrada na auditoria.`),
    campo({ id: 'an-motivo', rotulo: 'Motivo da anulação', obrigatorio: true, controle: motivo }));
  form.addEventListener('submit', (e) => e.preventDefault());
  abrirModal({
    titulo: 'Anular registro',
    conteudo: form,
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: 'Anular registro',
        classe: 'btn btn-perigo',
        acao: async () => {
          try {
            await api.post(`/api/familias/acompanhamentos/${id}/registros/${registro.id}/anular`, { motivo: motivo.value.trim() });
            toast.sucesso('Registro anulado.');
            aoSalvar();
            return true;
          } catch (e) {
            if (e instanceof ErroApi && e.status === 400) mostrarErrosCampos(form, e.detalhes); else toast.erro(e.message);
            return false;
          }
        },
      },
    ],
  });
}

// ---- pesquisa de satisfação (cartão da aba) ----

const CLASSE_NPS = { PROMOTORA: 'badge-sucesso', NEUTRA: 'badge-info', DETRATORA: 'badge-perigo' };
const ROTULO_NPS = { PROMOTORA: 'Promotora', NEUTRA: 'Neutra', DETRATORA: 'Detratora' };
const ROTULO_PESQ_MOMENTO = { FINAL: 'ao encerrar', SEMESTRAL: 'semestral', AVULSA: 'avulsa' };

async function abrirRespostas({ id, pesquisa, usuario, aoMudar }) {
  let p;
  try { p = await api.get(`/api/familias/acompanhamentos/${id}/pesquisas/${pesquisa.id}`); } catch (e) { toast.erro(e.message); return; }
  const linhas = p.modelo.perguntas.map((q) => {
    const it = p.itens.find((i) => i.codigo === q.codigo);
    let valor;
    if (!it) valor = '—';
    else if (it.preferNaoResponder) valor = 'Prefere não responder';
    else if (q.tipo === 'NPS') valor = `${it.valorNum} de 10`;
    else if (q.tipo === 'LIKERT') valor = ROTULO_LIKERT[it.valorNum] || '—';
    else valor = it.valorTexto || '(sem comentário)';
    return h('li', { class: 'pesq-rev-item' }, h('span', { class: 'pesq-rev-pergunta' }, q.texto), h('strong', { class: 'pesq-rev-valor' }, valor));
  }).concat((p.respostasExtras || []).map((x) => // perguntas adicionais da coordenação
    h('li', { class: 'pesq-rev-item' }, h('span', { class: 'pesq-rev-pergunta' }, x.pergunta), h('strong', { class: 'pesq-rev-valor' }, x.resposta))));
  const r = p.resumo;
  const conteudo = h('div', {},
    h('p', { class: 'texto-pequeno texto-suave' }, `${formatarData(p.dataAplicacao)} · pesquisa ${ROTULO_PESQ_MOMENTO[p.momento]} · aplicada por ${p.autor.nome} · ${ROTULO_MODO[p.modo] || ''}`),
    r ? h('p', {}, h('strong', {}, `Nota geral ${r.nps ?? '—'} de 10`), ` · concordância ${r.concordancia ?? '—'}% · satisfação ${r.indice ?? '—'}%`) : null,
    h('ul', { class: 'pesq-rev' }, linhas),
    ehCoordenacao(usuario)
      ? h('label', { class: 'opcao pesq-oculto' },
        h('input', {
          type: 'checkbox', checked: p.comentarioOculto,
          onchange: async (e) => {
            try { await api.put(`/api/familias/acompanhamentos/${id}/pesquisas/${p.id}/comentario-oculto`, { oculto: e.target.checked }); toast.sucesso(e.target.checked ? 'Comentário ocultado dos relatórios.' : 'Comentário volta a poder aparecer nos relatórios.'); } catch (err) { e.target.checked = !e.target.checked; toast.erro(err.message); }
          },
        }), h('span', {}, 'Ocultar o comentário desta pesquisa nos relatórios'))
      : null);
  abrirModal({ titulo: 'Respostas da pesquisa', conteudo, botoes: [{ texto: 'Fechar', classe: 'btn btn-secundario' }] });
}

function abrirAnularPesquisa({ id, pesquisa, aoMudar, rotulo = 'Anular pesquisa' }) {
  const motivo = h('textarea', { class: 'textarea', id: 'ap-motivo', name: 'motivo', maxlength: 200, rows: 3 });
  const form = h('form', { novalidate: true },
    h('p', {}, 'A pesquisa deixa de aparecer na ficha e nos números. A anulação fica registrada na auditoria.'),
    campo({ id: 'ap-motivo', rotulo: 'Motivo', obrigatorio: true, controle: motivo }));
  form.addEventListener('submit', (e) => e.preventDefault());
  abrirModal({
    titulo: rotulo, conteudo: form,
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: rotulo, classe: 'btn btn-perigo',
        acao: async () => {
          try {
            await api.post(`/api/familias/acompanhamentos/${id}/pesquisas/${pesquisa.id}/anular`, { motivo: motivo.value.trim() });
            toast.sucesso('Pesquisa anulada.'); aoMudar(); return true;
          } catch (e) {
            if (e instanceof ErroApi && e.status === 400) mostrarErrosCampos(form, e.detalhes); else toast.erro(e.message);
            return false;
          }
        },
      },
    ],
  });
}

function cartaoPesquisa({ id, p, escrita, usuario, aoMudar }) {
  const pend = p.pendencia;
  const rascunho = p.pesquisas.find((x) => x.situacao === 'RASCUNHO');
  const momentoBotao = rascunho ? rascunho.momento : (pend ? pend.momento : 'AVULSA');
  const textoBotao = rascunho ? 'Continuar pesquisa' : (pend ? `Aplicar pesquisa ${pend.momento === 'FINAL' ? 'final' : 'semestral'}` : 'Aplicar pesquisa avulsa');
  const feitas = p.pesquisas.filter((x) => x.situacao !== 'RASCUNHO');

  const historico = feitas.map((x) => {
    const r = x.resumo;
    return h('li', { class: 'pesq-hist' },
      h('div', { class: 'fam-registro-topo' },
        h('strong', {}, formatarData(x.dataAplicacao)),
        h('span', { class: 'badge' }, `Pesquisa ${ROTULO_PESQ_MOMENTO[x.momento]}`),
        x.situacao === 'RECUSADA'
          ? h('span', { class: 'badge badge-aviso' }, 'A família preferiu não responder')
          : [r?.nps !== null && r?.nps !== undefined ? h('span', { class: `badge ${CLASSE_NPS[r.categoriaNps] || ''}` }, `Nota ${r.nps} · ${ROTULO_NPS[r.categoriaNps]}`) : null,
            r?.indice !== null && r?.indice !== undefined ? h('span', { class: 'badge badge-info' }, `Satisfação ${r.indice}%`) : null]),
      h('div', { class: 'fam-registro-acoes' },
        x.situacao === 'CONCLUIDA' ? h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => abrirRespostas({ id, pesquisa: x, usuario, aoMudar }) }, 'Ver respostas') : null,
        escrita && x.podeAlterar ? h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => abrirAnularPesquisa({ id, pesquisa: x, aoMudar }) }, icone('x'), 'Anular') : null));
  });

  return h('div', { class: 'card pesq-card' },
    h('div', { class: 'linha-entre' },
      h('h3', {}, 'Pesquisa de satisfação'),
      pend ? h('span', { class: 'badge badge-aviso' }, icone('relogio'), pend.momento === 'FINAL' ? 'Pendente: final' : 'Pendente: semestral') : h('span', { class: 'badge badge-sucesso' }, icone('check'), 'Em dia')),
    h('p', { class: 'texto-pequeno texto-suave' }, 'A assistente aplica pessoalmente: lê as perguntas à família e registra as respostas. Pedida ao concluir o acompanhamento e a cada ' + p.intervaloDias + ' dias.'),
    rascunho ? h('p', {}, h('span', { class: 'badge badge-aviso' }, icone('editar'), `Rascunho de ${formatarData(rascunho.dataAplicacao)} em andamento`)) : null,
    escrita
      ? h('div', { class: 'barra-acoes pesq-barra' },
        rascunho ? h('button', { type: 'button', class: 'btn btn-texto', onclick: () => abrirAnularPesquisa({ id, pesquisa: rascunho, aoMudar, rotulo: 'Descartar rascunho' }) }, 'Descartar rascunho') : null,
        h('a', { class: `btn ${pend || rascunho ? '' : 'btn-secundario'}`, href: `#/a/${id}/pesquisa/${momentoBotao}` }, textoBotao))
      : null,
    historico.length ? h('ul', { class: 'pesq-historico' }, historico) : null);
}

export async function renderAbaAcompanhamento({ id, d, escrita, navegar, abrirNovo, usuario }) {
  const [r, pesq, plano] = await Promise.all([
    api.get(`/api/familias/acompanhamentos/${id}/registros`),
    api.get(`/api/familias/acompanhamentos/${id}/pesquisas`),
    api.get(`/api/familias/acompanhamentos/${id}/metas`),
  ]);
  const encerrado = d.status !== 'EM_ANDAMENTO';
  const recarregar = () => navegar(`#/a/${id}/acompanhamento`, true);
  const dados = {
    dataInicio: d.dataInicio, tiposContato: r.tiposContato, semContatoDias: r.semContatoDias, metas: plano.metas,
    usosArmazem: r.usosArmazem, orientacoes: r.orientacoes, frases: r.frases,
  };
  const novo = () => abrirFormularioRegistro({ id, dados, aoSalvar: recarregar });

  // o botão "Registrar contato" fica só no cabeçalho da ficha (detalhe.js), para não repetir
  const topo = h('div', { class: 'fam-aba-topo' }, h('h2', {}, 'Contatos e visitas'),
    r.registros.length ? h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => abrirRegistroPeriodico({ id }) }, 'Registro periódico (.docx)') : null);

  const lista = r.registros.length === 0
    ? h('div', { class: 'card card-vazio' },
      h('p', {}, h('strong', {}, 'Nenhum contato registrado ainda.')),
      h('p', { class: 'texto-pequeno' }, encerrado
        ? 'Este acompanhamento foi encerrado sem registros de contato.'
        : 'Registre cada visita, ligação ou conversa com a família. Leva menos de um minuto.'))
    : h('ul', { class: 'fam-registros' }, r.registros.map((reg) => cartaoRegistro(reg, {
      escrita, encerrado,
      editar: (x) => abrirFormularioRegistro({ id, dados, registro: x, aoSalvar: recarregar }),
      anular: (x) => abrirAnulacao({ id, registro: x, aoSalvar: recarregar }),
    })));

  if (abrirNovo && escrita && !encerrado) {
    // troca o hash para a aba "limpa" sem repetir a abertura se o usuário voltar/atualizar
    queueMicrotask(() => { history.replaceState(null, '', `#/a/${id}/acompanhamento`); novo(); });
  }

  return [
    cartaoResumo(r, encerrado),
    h('div', { class: 'fam-secao-metas' }, cartaoMetas({ id, m: plano, escrita, aoMudar: recarregar })),
    h('div', { class: 'fam-secao-pesquisa' }, cartaoPesquisa({ id, p: pesq, escrita, usuario, aoMudar: recarregar })),
    topo,
    lista,
  ];
}
