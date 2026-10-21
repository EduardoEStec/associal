// Aba "Acompanhamento" da ficha: resumo de contato, formulário curto de registro e lista de registros.
import { api, ErroApi } from '../api.js';
import { icone } from '../layout.js';
import { h, toast, abrirModal, formatarData, mostrarErrosCampos, hojeIso } from '../ui.js';
import { campo, textoOuTraco } from './util.js';

export const ROTULO_SITUACAO = { MELHORANDO: 'Melhorando', IGUAL: 'Igual', PIORANDO: 'Piorando', NAO_SEI: 'Sem avaliação' };
const CLASSE_SITUACAO = { MELHORANDO: 'badge-sucesso', IGUAL: 'badge-info', PIORANDO: 'badge-perigo', NAO_SEI: 'badge' };
const ICONE_SITUACAO = { MELHORANDO: 'subir', IGUAL: 'igual', PIORANDO: 'descer', NAO_SEI: null };

const pluralDias = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

function somarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

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
      h('span', { class: 'badge' }, quem),
      reg.houveContato
        ? seloSituacao(reg.situacao)
        : h('span', { class: 'badge badge-aviso' }, icone('alerta'), 'Não conseguiu falar')),
    reg.resumo ? h('p', { class: 'fam-registro-texto' }, reg.resumo) : null,
    h('div', { class: 'fam-registro-rodape texto-pequeno texto-suave' },
      h('span', {}, `Registrado por ${textoOuTraco(reg.autor?.nome)}`),
      reg.proximoContatoEm ? h('span', {}, `Próximo contato: ${formatarData(reg.proximoContatoEm)}`) : null),
    acoes);
}

// ---- formulário (criar e editar) ----

function opcaoRadio(nome, valor, rotulo, marcado) {
  const entrada = h('input', { type: 'radio', name: nome, value: valor, checked: marcado });
  return h('label', { class: 'opcao' }, entrada, h('span', {}, rotulo));
}

function abrirFormulario({ id, dados, registro, aoSalvar }) {
  const editando = !!registro;
  const form = h('form', { class: 'fam-form-registro', novalidate: true });
  const hoje = hojeIso();

  const data = h('input', { class: 'input', type: 'date', id: 'rg-data', name: 'dataRegistro', value: registro?.dataRegistro?.slice(0, 10) || hoje, max: hoje, required: true });
  if (dados.dataInicio) data.min = String(dados.dataInicio).slice(0, 10);

  const tipo = h('select', { class: 'select', id: 'rg-tipo', name: 'tipoContatoId' },
    h('option', { value: '' }, 'Selecione'),
    dados.tiposContato.map((t) => h('option', { value: String(t.id), 'data-exige': t.exigeTexto ? '1' : '' }, t.nome)));
  tipo.value = registro?.tipoContatoId ? String(registro.tipoContatoId) : '';
  if (editando && tipo.value === '') { // tipo desativado depois do registro: mantém visível
    tipo.append(h('option', { value: String(registro.tipoContatoId) }, registro.tipoContato));
    tipo.value = String(registro.tipoContatoId);
  }
  const outro = h('input', { class: 'input', type: 'text', id: 'rg-outro', name: 'tipoContatoOutro', maxlength: 200, value: registro?.tipoContatoOutro || '', placeholder: 'Qual?' });
  const campoOutro = campo({ id: 'rg-outro', rotulo: 'Descreva o tipo de contato', obrigatorio: true, controle: outro });
  const exigeTexto = () => !!dados.tiposContato.find((t) => String(t.id) === tipo.value)?.exigeTexto
    || (editando && tipo.value === String(registro.tipoContatoId) && !!registro.tipoContatoOutro);
  const atualizarOutro = () => { campoOutro.hidden = !exigeTexto(); };

  const houveSim = registro ? registro.houveContato : true;
  const grupoFalou = h('div', { class: 'opcoes fam-opcoes-linha', role: 'radiogroup', 'aria-labelledby': 'rg-falou-rotulo' },
    opcaoRadio('houveContato', 'true', 'Sim', houveSim), opcaoRadio('houveContato', 'false', 'Não', !houveSim));
  const campoFalou = h('div', { class: 'campo' }, h('span', { class: 'rotulo obrigatorio', id: 'rg-falou-rotulo' }, 'Conseguiu falar com a família?'), grupoFalou);

  const grupoSit = h('div', { class: 'opcoes fam-opcoes-linha', role: 'radiogroup', 'aria-labelledby': 'rg-sit-rotulo' },
    ['MELHORANDO', 'IGUAL', 'PIORANDO', 'NAO_SEI'].map((v) => opcaoRadio('situacao', v, ROTULO_SITUACAO[v], registro?.situacao === v)));
  const campoSit = h('div', { class: 'campo' }, h('span', { class: 'rotulo obrigatorio', id: 'rg-sit-rotulo' }, 'Como a família está?'), grupoSit);

  const resumo = h('textarea', { class: 'textarea', id: 'rg-resumo', name: 'resumo', maxlength: 1000, rows: 4, value: registro?.resumo || '' });
  resumo.value = registro?.resumo || '';
  const contador = h('span', { class: 'ajuda' });
  const campoResumo = h('div', { class: 'campo' },
    h('label', { for: 'rg-resumo', class: 'obrigatorio' }, 'Resumo do contato'),
    resumo, contador,
    h('span', { class: 'ajuda' }, 'Seja breve. Não registre detalhes de saúde nem de violência neste campo.'));
  const contar = () => { contador.textContent = `${resumo.value.length} de 1000 caracteres`; };
  resumo.addEventListener('input', contar);

  const proximo = h('input', { class: 'input', type: 'date', id: 'rg-proximo', name: 'proximoContatoEm',
    value: editando ? (registro.proximoContatoEm?.slice(0, 10) || '') : somarDias(hoje, dados.semContatoDias) });
  const campoProximo = campo({ id: 'rg-proximo', rotulo: 'Próximo contato', ajuda: `Sugestão: daqui a ${pluralDias(dados.semContatoDias)}. Deixe em branco se não houver data.`, controle: proximo });

  const atualizarFalou = () => {
    const sim = form.elements.houveContato.value !== 'false';
    campoSit.hidden = !sim;
    campoResumo.querySelector('label').classList.toggle('obrigatorio', sim);
  };

  form.append(
    campo({ id: 'rg-data', rotulo: 'Data do contato', obrigatorio: true, controle: data }),
    campo({ id: 'rg-tipo', rotulo: 'Tipo de contato', obrigatorio: true, controle: tipo }),
    campoOutro, campoFalou, campoSit, campoResumo, campoProximo);
  form.addEventListener('submit', (e) => e.preventDefault());
  tipo.addEventListener('change', atualizarOutro);
  form.addEventListener('change', (e) => { if (e.target.name === 'houveContato') atualizarFalou(); });
  atualizarOutro(); atualizarFalou(); contar();

  const url = `/api/familias/acompanhamentos/${id}/registros`;
  abrirModal({
    titulo: editando ? 'Editar registro de contato' : 'Registrar contato',
    conteudo: form,
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: 'Salvar',
        classe: 'btn',
        acao: async () => {
          const houve = form.elements.houveContato.value !== 'false';
          const corpo = {
            dataRegistro: data.value || undefined,
            tipoContatoId: tipo.value ? Number(tipo.value) : null,
            tipoContatoOutro: exigeTexto() ? outro.value.trim() || null : null,
            houveContato: houve,
            situacao: houve ? form.elements.situacao.value || null : null,
            resumo: resumo.value.trim() || null,
            proximoContatoEm: proximo.value || null,
          };
          try {
            if (editando) await api.put(`${url}/${registro.id}`, corpo); else await api.post(url, corpo);
            toast.sucesso(editando ? 'Registro atualizado.' : 'Contato registrado.');
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

export async function renderAbaAcompanhamento({ id, d, escrita, navegar, abrirNovo }) {
  const r = await api.get(`/api/familias/acompanhamentos/${id}/registros`);
  const encerrado = d.status !== 'EM_ANDAMENTO';
  const recarregar = () => navegar(`#/a/${id}/acompanhamento`, true);
  const dados = { dataInicio: d.dataInicio, tiposContato: r.tiposContato, semContatoDias: r.semContatoDias };
  const novo = () => abrirFormulario({ id, dados, aoSalvar: recarregar });

  const topo = h('div', { class: 'linha-entre fam-aba-topo' },
    h('h2', {}, 'Contatos e visitas'),
    escrita && !encerrado ? h('button', { type: 'button', class: 'btn', onclick: novo }, 'Registrar contato') : null);

  const lista = r.registros.length === 0
    ? h('div', { class: 'card card-vazio' },
      h('p', {}, h('strong', {}, 'Nenhum contato registrado ainda.')),
      h('p', { class: 'texto-pequeno' }, encerrado
        ? 'Este acompanhamento foi encerrado sem registros de contato.'
        : 'Registre cada visita, ligação ou conversa com a família. Leva menos de um minuto.'))
    : h('ul', { class: 'fam-registros' }, r.registros.map((reg) => cartaoRegistro(reg, {
      escrita, encerrado,
      editar: (x) => abrirFormulario({ id, dados, registro: x, aoSalvar: recarregar }),
      anular: (x) => abrirAnulacao({ id, registro: x, aoSalvar: recarregar }),
    })));

  if (abrirNovo && escrita && !encerrado) {
    // troca o hash para a aba "limpa" sem repetir a abertura se o usuário voltar/atualizar
    queueMicrotask(() => { history.replaceState(null, '', `#/a/${id}/acompanhamento`); novo(); });
  }

  return [
    cartaoResumo(r, encerrado),
    r.textoRestrito ? h('div', { class: 'aviso' }, 'Os textos dos registros não são exibidos para o seu perfil.') : null,
    topo,
    lista,
  ];
}
