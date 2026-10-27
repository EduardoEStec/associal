// Ficha da família acompanhada: dados, questionários, comparação e encerramento.
import { api, ErroApi } from '../api.js';
import { icone } from '../layout.js';
import { formatarTelefone } from '../telefone.js';
import { h, toast, carregando, abrirModal, formatarData, formatarCpf, mostrarErrosCampos, hojeIso } from '../ui.js';
import { renderAbaAcompanhamento } from './acompanhamento.js';
import { renderLinhaTempo } from './linha-tempo.js';
import { renderIndicadores } from './indicadores.js';
import {
  carregarApoio, cabecalhoPagina, podeEscrever, seloStatus, seloFinal, rotuloSimNao, textoOuTraco, campo, montar,
} from './util.js';

function dado(rotulo, valor) {
  return h('div', { class: 'fam-dado' }, h('dt', {}, rotulo), h('dd', {}, textoOuTraco(valor)));
}

function cartaoQuestionario({ titulo, tipo, resumo, acId, escrita, bloqueado, textoBloqueio, encerrado }) {
  let situacao;
  if (resumo.concluido) situacao = h('span', { class: 'badge badge-sucesso' }, icone('check'), `Concluído em ${formatarData(resumo.dataAplicacao)}`);
  else if (resumo.existe) situacao = h('span', { class: 'badge badge-aviso' }, icone('editar'), 'Rascunho salvo');
  else situacao = h('span', { class: 'badge' }, 'Não iniciado');

  const legado = resumo.modelo === 'LEGADO';
  if (legado) situacao = h('span', {}, situacao, ' ', h('span', { class: 'badge' }, 'Formato anterior'));

  let acao;
  if (bloqueado) acao = h('p', { class: 'texto-pequeno texto-suave' }, textoBloqueio);
  else {
    const editar = escrita && !encerrado && !(legado && resumo.concluido); // formato anterior concluído é só leitura
    const texto = resumo.concluido ? (editar ? 'Revisar / corrigir' : 'Ver respostas') : (editar ? (resumo.existe ? 'Continuar' : 'Iniciar questionário') : 'Ver respostas');
    acao = h('a', { class: `btn ${resumo.concluido ? 'btn-secundario' : ''}`, href: `#/a/${acId}/q/${tipo}` }, texto);
  }
  // modelos oficiais 1 e 3 em .docx (preenchido, ou em branco se ainda não aplicado) para impressão e assinatura
  const imprimir = !legado && !bloqueado
    ? h('a', { class: 'btn btn-secundario btn-pequeno', href: `/api/relatorios/formulario/${acId}/${tipo}`, download: '' }, resumo.concluido ? 'Documento para imprimir (.docx)' : 'Formulário em branco (.docx)')
    : null;
  return h('div', { class: 'card fam-q-card' },
    h('h3', {}, titulo), h('div', {}, situacao), acao, imprimir);
}

export async function renderDetalhe({ usuario, conteudo, navegar }, id, aba = 'resumo', opcoes = {}) {
  montar(conteudo, carregando());
  const [d, apoio] = await Promise.all([api.get(`/api/familias/acompanhamentos/${id}`), carregarApoio()]);
  const escrita = podeEscrever(usuario);
  const encerrado = d.status !== 'EM_ANDAMENTO';
  const nomeApoio = (lista, v, outro) => {
    const nome = v ? (lista || []).find((o) => o.id === v)?.nome : null;
    return nome && outro ? `${nome}: ${outro}` : nome;
  };
  const r = d.responsavel;

  const acoes = [];
  if (escrita && !encerrado) {
    acoes.push(h('a', { class: 'btn', href: `#/a/${id}/acompanhamento/novo` }, 'Registrar contato'));
    acoes.push(h('a', { class: 'btn btn-secundario', href: `#/a/${id}/editar` }, 'Editar família'));
    acoes.push(h('button', { type: 'button', class: 'btn btn-secundario', onclick: abrirEncerramento }, 'Encerrar acompanhamento'));
  }

  // Alerta do prazo
  let alerta = null;
  if (d.finalSituacao === 'VENCIDO') alerta = h('div', { class: 'aviso aviso-perigo', role: 'alert' }, `O prazo do questionário final venceu em ${formatarData(d.dataPrevistaFinal)}. Agende a aplicação.`);
  else if (d.finalSituacao === 'VENCENDO') alerta = h('div', { class: 'aviso aviso-aviso' }, `O questionário final vence em ${formatarData(d.dataPrevistaFinal)}.`);

  const c = d.contato;
  const semContato = d.status === 'EM_ANDAMENTO' && c?.semContato
    ? h('div', { class: 'aviso aviso-aviso', role: 'status' },
      `Sem contato há ${c.diasSemContato} dias (último em ${formatarData(c.ultimoContatoEm)}). `,
      h('a', { href: `#/a/${id}/acompanhamento` }, 'Ver acompanhamento'))
    : null;

  const pend = d.pesquisa?.pendencia;
  const pesquisaPendente = pend && escrita
    ? h('div', { class: 'aviso aviso-aviso', role: 'status' },
      `Pesquisa de satisfação pendente (${pend.momento === 'FINAL' ? 'ao encerrar o acompanhamento' : 'semestral'}). `,
      h('a', { href: `#/a/${id}/pesquisa/${pend.momento}` }, 'Aplicar agora'))
    : null;

  const semMeta = d.status === 'EM_ANDAMENTO' && d.metas?.semMeta && escrita
    ? h('div', { class: 'aviso aviso-aviso', role: 'status' },
      `Família sem meta há ${d.metas.semMeta.dias} dias. `,
      h('a', { href: `#/a/${id}/acompanhamento` }, 'Definir meta'))
    : null;

  const membros = d.membros.length === 0
    ? h('p', { class: 'texto-pequeno texto-suave' }, 'Nenhum outro membro cadastrado.')
    : h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela tabela-responsiva' },
      h('thead', {}, h('tr', {}, ['Nome', 'Parentesco', 'Nascimento / idade', 'Gênero', 'Trabalha'].map((t) => h('th', {}, t)))),
      h('tbody', {}, d.membros.map((m) => h('tr', {},
        h('td', { 'data-rotulo': 'Nome' }, m.nome),
        h('td', { 'data-rotulo': 'Parentesco' }, textoOuTraco(m.parentesco)),
        h('td', { 'data-rotulo': 'Nascimento / idade' }, m.dataNascimento ? formatarData(m.dataNascimento) : (m.idade !== null ? `${m.idade} anos` : '—')),
        h('td', { 'data-rotulo': 'Gênero' }, textoOuTraco(nomeApoio(apoio.genero, m.generoId, m.generoOutro))),
        h('td', { 'data-rotulo': 'Trabalha' }, rotuloSimNao(m.trabalha)))))));

  const qI = d.questionarios.inicial;
  const qF = d.questionarios.final;
  const finalBloqueado = !qI.concluido && !qF.existe;

  const corpoResumo = [
    h('h2', {}, 'Questionários'),
    h('div', { class: 'grade grade-3 fam-q-grade' },
      cartaoQuestionario({ titulo: 'Questionário inicial', tipo: 'INICIAL', resumo: qI, acId: id, escrita, encerrado }),
      cartaoQuestionario({
        titulo: 'Questionário final', tipo: 'FINAL', resumo: qF, acId: id, escrita, encerrado,
        bloqueado: finalBloqueado, textoBloqueio: 'Disponível depois de concluir o questionário inicial.',
      }),
      h('div', { class: 'card fam-q-card' }, h('h3', {}, 'Comparação'),
        d.comparacaoDisponivel
          ? [h('p', { class: 'texto-pequeno' }, 'Resultados antes × depois desta família.'), h('a', { class: 'btn', href: `#/a/${id}/comparacao` }, 'Ver comparação')]
          : h('p', { class: 'texto-pequeno texto-suave' }, 'Disponível quando os questionários inicial e final estiverem concluídos.'))),

    h('h2', {}, 'Responsável'),
    h('div', { class: 'card' }, h('dl', { class: 'fam-dados' },
      dado('CPF', r.cpf ? formatarCpf(r.cpf) : null), dado('Nascimento', r.dataNascimento ? formatarData(r.dataNascimento) : null),
      dado('Telefone', [r.telefone && formatarTelefone(r.telefone), r.telefone2 && `${formatarTelefone(r.telefone2)} (recado)`].filter(Boolean).join(' · ')),
      dado('NIS (CadÚnico)', r.nis), dado('Endereço', [r.endereco, r.bairro].filter(Boolean).join(' — ')),
      dado('Trabalho atual', r.trabalhoAtual), dado('Gênero', nomeApoio(apoio.genero, r.generoId, r.generoOutro)),
      dado('Escolaridade', nomeApoio(apoio.escolaridade, r.escolaridadeId, r.escolaridadeOutro)), dado('Raça/etnia', nomeApoio(apoio.raca, r.racaId, r.racaOutro)))),

    h('h2', {}, `Demais membros (${d.membros.length})`),
    membros,
    !encerrado && d.observacoes ? [h('h2', {}, 'Observações'), h('p', {}, d.observacoes)] : null,
    h('p', { class: 'texto-pequeno texto-suave' }, `Assistente responsável: ${d.assistente?.nome || '—'}`),
  ];

  const abas = h('nav', { class: 'fam-abas', 'aria-label': 'Seções da ficha da família' },
    [['resumo', 'Resumo', `#/a/${id}`], ['acompanhamento', 'Acompanhamento', `#/a/${id}/acompanhamento`], ['linha-do-tempo', 'Linha do tempo', `#/a/${id}/linha-do-tempo`], ['indicadores', 'Indicadores', `#/a/${id}/indicadores`]]
      .map(([chave, rotulo, href]) => h('a', { class: 'fam-aba', href, 'aria-current': chave === aba ? 'page' : null }, rotulo)));

  let corpo;
  if (aba === 'acompanhamento') {
    corpo = await renderAbaAcompanhamento({ id, d, escrita, navegar, abrirNovo: !!opcoes.abrirNovo, usuario });
  } else if (aba === 'linha-do-tempo') {
    corpo = await renderLinhaTempo({ id, d });
  } else if (aba === 'indicadores') {
    corpo = await renderIndicadores({ id, d, escrita });
  } else {
    corpo = corpoResumo;
  }

  montar(conteudo, 
    cabecalhoPagina(r.nome, { voltar: { href: '#/', texto: 'Lista de famílias' }, acoes }),
    h('div', { class: 'linha fam-resumo' },
      seloStatus(d.status),
      d.status === 'EM_ANDAMENTO' ? seloFinal(d) : null,
      h('span', { class: 'texto-pequeno texto-suave' }, `${d.unidade?.nome || ''} · início ${formatarData(d.dataInicio)}`
        + (d.dataEncerramento ? ` · encerrado em ${formatarData(d.dataEncerramento)}` : ''))),
    alerta,
    semContato,
    semMeta,
    pesquisaPendente,
    encerrado && d.observacoes ? h('div', { class: 'aviso' }, h('strong', {}, 'Observações: '), d.observacoes) : null,

    abas,
    corpo,
  );

  function abrirEncerramento() {
    const form = h('form', { novalidate: true });
    const status = h('select', { class: 'select', id: 'enc-status', name: 'status' },
      h('option', { value: '' }, 'Selecione'),
      h('option', { value: 'CONCLUIDO' }, 'Concluído — a família completou o acompanhamento'),
      h('option', { value: 'DESLIGADO' }, 'Desligado — saiu do acompanhamento antes do fim'));
    const data = h('input', { class: 'input', type: 'date', id: 'enc-data', name: 'dataEncerramento', value: hojeIso(), max: hojeIso() });
    const obs = h('textarea', { class: 'textarea', id: 'enc-obs', name: 'observacoes', maxlength: 4000 });
    const aviso = h('div', { class: 'aviso aviso-aviso' }, 'Depois de encerrado, o acompanhamento e os questionários não podem mais ser alterados.');
    form.append(aviso,
      campo({ id: 'enc-status', rotulo: 'Situação final', obrigatorio: true, controle: status }),
      campo({ id: 'enc-data', rotulo: 'Data de encerramento', controle: data }),
      campo({ id: 'enc-obs', rotulo: 'Observações', ajuda: 'Obrigatório ao desligar: informe o motivo.', controle: obs }));
    form.addEventListener('submit', (e) => e.preventDefault());
    abrirModal({
      titulo: 'Encerrar acompanhamento',
      conteudo: form,
      botoes: [
        { texto: 'Cancelar', classe: 'btn btn-secundario' },
        {
          texto: 'Encerrar',
          classe: 'btn btn-perigo',
          acao: async () => {
            try {
              await api.post(`/api/familias/acompanhamentos/${id}/encerrar`, {
                status: status.value, dataEncerramento: data.value || undefined, observacoes: obs.value.trim() || null,
              });
              toast.sucesso('Acompanhamento encerrado.');
              navegar(`#/a/${id}`, true);
              return true;
            } catch (e) {
              if (e instanceof ErroApi && e.status === 400) mostrarErrosCampos(form, e.detalhes);
              else toast.erro(e.message);
              return false;
            }
          },
        },
      ],
    });
  }
}
