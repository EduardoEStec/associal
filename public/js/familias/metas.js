// Plano de metas da família (F4): cartão da aba Acompanhamento, formulário da meta e o bloco "Metas tratadas" do registro de contato.
import { api, ErroApi } from '../api.js';
import { icone } from '../layout.js';
import { h, toast, abrirModal, formatarData, mostrarErrosCampos, hojeIso } from '../ui.js';
import { campo } from './util.js';

export const ROTULO_STATUS_META = { EM_ANDAMENTO: 'Em andamento', ATINGIDA: 'Atingida', NAO_ATINGIDA: 'Não atingida', CANCELADA: 'Cancelada' };
const CLASSE_STATUS_META = { EM_ANDAMENTO: 'badge-info', ATINGIDA: 'badge-sucesso', NAO_ATINGIDA: 'badge-perigo', CANCELADA: 'badge' };
const ICONE_STATUS_META = { EM_ANDAMENTO: 'alvo', ATINGIDA: 'check', NAO_ATINGIDA: 'x', CANCELADA: 'x' };
export const ROTULO_AVANCO = { AVANCOU: 'Avançou', SEM_MUDANCA: 'Sem mudança', RETROCEDEU: 'Retrocedeu' };
const CLASSE_AVANCO = { AVANCOU: 'badge-sucesso', SEM_MUDANCA: 'badge-info', RETROCEDEU: 'badge-perigo' };
const ICONE_AVANCO = { AVANCOU: 'subir', SEM_MUDANCA: 'igual', RETROCEDEU: 'descer' };

const pluralDias = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

export function seloAvanco(avanco) {
  if (!avanco) return null;
  return h('span', { class: `badge ${CLASSE_AVANCO[avanco] || 'badge'}` }, icone(ICONE_AVANCO[avanco]), ROTULO_AVANCO[avanco]);
}

// ---- cartão da aba ----

function cartaoMeta(m, { escrita, encerrado, editar, marcarAtingida }) {
  const aberta = m.status === 'EM_ANDAMENTO';
  const ultimo = m.historico[0];
  const acoes = escrita && !encerrado
    ? h('div', { class: 'fam-registro-acoes' },
      h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => editar(m) }, icone('editar'), 'Editar'),
      aberta ? h('button', { type: 'button', class: 'btn btn-texto btn-pequeno', onclick: () => marcarAtingida(m) }, icone('check'), 'Marcar como atingida') : null)
    : null;
  return h('li', { class: `meta-item${aberta ? '' : ' meta-item-encerrada'}` },
    h('div', { class: 'fam-registro-topo' },
      h('span', { class: 'badge' }, m.dimensaoNome),
      h('span', { class: `badge ${CLASSE_STATUS_META[m.status]}` }, icone(ICONE_STATUS_META[m.status]), ROTULO_STATUS_META[m.status]),
      m.vencida ? h('span', { class: 'badge badge-aviso' }, icone('relogio'), 'Prazo vencido') : null),
    h('p', { class: 'meta-descricao' }, m.descricao),
    h('div', { class: 'meta-rodape texto-pequeno texto-suave' },
      m.prazo ? h('span', {}, `Prazo: ${formatarData(m.prazo)}`) : h('span', {}, 'Sem prazo'),
      !aberta && m.concluidaEm ? h('span', {}, `Encerrada em ${formatarData(m.concluidaEm)}`) : null,
      ultimo
        ? h('span', { class: 'meta-avanco' }, 'Último avanço: ', seloAvanco(ultimo.avanco), ` em ${formatarData(ultimo.data)}`)
        : (aberta ? h('span', {}, 'Nenhum avanço registrado ainda') : null),
      m.historico.length > 1 ? h('span', {}, `${m.historico.length} registros de avanço`) : null),
    acoes);
}

export function cartaoMetas({ id, m, escrita, aoMudar }) {
  const encerrado = m.status !== 'EM_ANDAMENTO';
  const abertas = m.metas.filter((x) => x.status === 'EM_ANDAMENTO');
  const fechadas = m.metas.filter((x) => x.status !== 'EM_ANDAMENTO');
  const url = `/api/familias/acompanhamentos/${id}/metas`;

  const atingir = async (meta) => {
    try {
      await api.put(`${url}/${meta.id}`, { dimensao: meta.dimensao, descricao: meta.descricao, prazo: meta.prazo ? String(meta.prazo).slice(0, 10) : null, status: 'ATINGIDA' });
      toast.sucesso('Meta marcada como atingida.');
      aoMudar();
    } catch (e) { toast.erro(e.message); }
  };
  const opcoes = {
    escrita, encerrado,
    editar: (meta) => abrirFormularioMeta({ id, dimensoes: m.dimensoes, meta, aoSalvar: aoMudar }),
    marcarAtingida: atingir,
  };

  const selo = m.semMeta
    ? h('span', { class: 'badge badge-aviso' }, icone('alerta'), `Sem meta há ${pluralDias(m.semMeta.dias)}`)
    : (abertas.length ? h('span', { class: 'badge badge-info' }, icone('alvo'), `${abertas.length} em andamento`) : null);

  return h('div', { class: 'card meta-card' },
    h('div', { class: 'linha-entre' }, h('h3', {}, 'Plano de metas'), selo),
    h('p', { class: 'texto-pequeno texto-suave' },
      'Opcional. Combine com a família o que ela quer conquistar (alimentação, renda, economia, autonomia). Cada contato pode registrar se a meta avançou.'),
    m.semMeta && !encerrado
      ? h('p', { class: 'aviso aviso-aviso', role: 'status' }, `Esta família está há ${pluralDias(m.semMeta.dias)} sem nenhuma meta em andamento (alerta a partir de ${pluralDias(m.semMeta.limiteDias)}).`)
      : null,
    escrita && !encerrado
      ? h('div', { class: 'barra-acoes' },
        h('button', { type: 'button', class: `btn ${m.semMeta || abertas.length === 0 ? '' : 'btn-secundario'}`, onclick: () => abrirFormularioMeta({ id, dimensoes: m.dimensoes, meta: null, aoSalvar: aoMudar }) }, 'Nova meta'))
      : null,
    abertas.length ? h('ul', { class: 'meta-lista' }, abertas.map((x) => cartaoMeta(x, opcoes)))
      : h('p', { class: 'texto-pequeno texto-suave' }, m.metas.length ? 'Nenhuma meta em andamento.' : 'Nenhuma meta definida ainda.'),
    fechadas.length
      ? h('details', { class: 'meta-encerradas' },
        h('summary', {}, `Metas encerradas (${fechadas.length})`),
        h('ul', { class: 'meta-lista' }, fechadas.map((x) => cartaoMeta(x, opcoes))))
      : null);
}

// ---- formulário da meta ----

export function abrirFormularioMeta({ id, dimensoes, meta, aoSalvar }) {
  const editando = !!meta;
  const form = h('form', { class: 'meta-form', novalidate: true });
  const hoje = hojeIso();

  const dimensao = h('select', { class: 'select', id: 'mt-dimensao', name: 'dimensao' },
    h('option', { value: '' }, 'Selecione'),
    dimensoes.map((d) => h('option', { value: d.codigo }, d.nome)));
  dimensao.value = meta?.dimensao || '';

  const descricao = h('textarea', { class: 'textarea', id: 'mt-descricao', name: 'descricao', maxlength: 300, rows: 3 });
  descricao.value = meta?.descricao || '';
  const contador = h('span', { class: 'ajuda' });
  const contar = () => { contador.textContent = `${descricao.value.length} de 300 caracteres`; };
  descricao.addEventListener('input', contar);

  const prazo = h('input', { class: 'input', type: 'date', id: 'mt-prazo', name: 'prazo', value: meta?.prazo ? String(meta.prazo).slice(0, 10) : '' });

  form.append(
    campo({ id: 'mt-dimensao', rotulo: 'Dimensão', obrigatorio: true, controle: dimensao }),
    h('div', { class: 'campo' },
      h('label', { for: 'mt-descricao', class: 'obrigatorio' }, 'O que a família quer conquistar'),
      descricao, contador,
      h('span', { class: 'ajuda' }, 'Exemplo: passar a comprar frutas e verduras 3 vezes por semana.')),
    campo({ id: 'mt-prazo', rotulo: 'Prazo', ajuda: 'Opcional.', controle: prazo }));

  let status = meta?.status || 'EM_ANDAMENTO';
  let encerramento = null;
  let campoEncerramento = null;
  if (editando) {
    const grupo = h('div', { class: 'opcoes fam-opcoes-linha', role: 'radiogroup', 'aria-labelledby': 'mt-status-rotulo' },
      Object.entries(ROTULO_STATUS_META).map(([valor, rotulo]) => h('label', { class: 'opcao' },
        h('input', { type: 'radio', name: 'status', value: valor, checked: valor === status }), h('span', {}, rotulo))));
    encerramento = h('input', { class: 'input', type: 'date', id: 'mt-concluida', name: 'concluidaEm', max: hoje, value: meta.concluidaEm ? String(meta.concluidaEm).slice(0, 10) : hoje });
    campoEncerramento = campo({ id: 'mt-concluida', rotulo: 'Data de encerramento', controle: encerramento });
    const atualizar = () => { status = form.elements.status.value; campoEncerramento.hidden = status === 'EM_ANDAMENTO'; };
    form.addEventListener('change', (e) => { if (e.target.name === 'status') atualizar(); });
    form.append(h('div', { class: 'campo' }, h('span', { class: 'rotulo', id: 'mt-status-rotulo' }, 'Situação da meta'), grupo), campoEncerramento);
    atualizar();
  }
  form.addEventListener('submit', (e) => e.preventDefault());
  contar();

  const url = `/api/familias/acompanhamentos/${id}/metas`;
  abrirModal({
    titulo: editando ? 'Editar meta' : 'Nova meta',
    conteudo: form,
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: 'Salvar',
        classe: 'btn',
        acao: async () => {
          const corpo = { dimensao: dimensao.value || null, descricao: descricao.value.trim(), prazo: prazo.value || null };
          if (editando) {
            corpo.status = status;
            if (status !== 'EM_ANDAMENTO') corpo.concluidaEm = encerramento.value || null;
          }
          try {
            if (editando) await api.put(`${url}/${meta.id}`, corpo); else await api.post(url, corpo);
            toast.sucesso(editando ? 'Meta atualizada.' : 'Meta criada.');
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

// ---- bloco "Metas tratadas" do registro de contato ----

// `metas`: todas as metas do acompanhamento (GET /metas); `registro`: registro em edição (ou undefined).
// Devolve { elemento, valores(), mostrar(bool) }; `elemento` é null quando não há meta a tratar.
export function blocoMetasDoRegistro(metas, registro) {
  const jaMarcadas = new Map((registro?.metas || []).map((x) => [x.metaId, x.avanco]));
  const lista = (metas || []).filter((x) => x.status === 'EM_ANDAMENTO' || jaMarcadas.has(x.id));
  if (!lista.length) return { elemento: null, valores: () => [], mostrar: () => {} };

  const linhas = lista.map((x) => {
    const nome = `meta-${x.id}`;
    const atual = jaMarcadas.get(x.id) || '';
    const opcao = (valor, rotulo) => h('label', { class: 'opcao' }, h('input', { type: 'radio', name: nome, value: valor, checked: atual === valor }), h('span', {}, rotulo));
    return h('div', { class: 'meta-marcar', 'data-meta': String(x.id) },
      h('p', { class: 'meta-marcar-titulo' }, h('span', { class: 'badge' }, x.dimensaoNome), ` ${x.descricao}`),
      h('div', { class: 'opcoes fam-opcoes-linha', role: 'radiogroup', 'aria-label': `Como a meta "${x.descricao}" evoluiu` },
        opcao('', 'Não tratada'), opcao('AVANCOU', ROTULO_AVANCO.AVANCOU), opcao('SEM_MUDANCA', ROTULO_AVANCO.SEM_MUDANCA), opcao('RETROCEDEU', ROTULO_AVANCO.RETROCEDEU)));
  });
  const elemento = h('div', { class: 'campo meta-marcar-bloco' },
    h('span', { class: 'rotulo' }, 'Metas tratadas neste contato'),
    h('span', { class: 'ajuda' }, 'Opcional. Marque só as metas que foram conversadas.'),
    linhas);
  return {
    elemento,
    valores: () => lista
      .map((x) => ({ metaId: x.id, avanco: elemento.querySelector(`input[name="meta-${x.id}"]:checked`)?.value || '' }))
      .filter((x) => x.avanco),
    mostrar: (sim) => { elemento.hidden = !sim; },
  };
}
