// Painel do Coordenador: indicadores por unidade/período, evolução, perfil do público e alertas.
import { iniciarPagina } from '../layout.js';
import { api } from '../api.js';
import { h, toast, carregando, formatarData, formatarNumero, comEspera } from '../ui.js';
import { barras, linhas, distribuicao } from '../painel/graficos.js';

const { usuario, conteudo } = await iniciarPagina('painel');

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const p2 = (n) => String(n).padStart(2, '0');
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

const agora = new Date();
const estado = { tipo: 'mes', ano: agora.getFullYear(), mes: agora.getMonth() + 1, semestre: agora.getMonth() < 6 ? 1 : 2, inicio: '', fim: '', unidadeId: '' };

// ---------- período ----------

function periodoAtual() {
  if (estado.tipo === 'mes') {
    return { inicio: `${estado.ano}-${p2(estado.mes)}-01`, fim: `${estado.ano}-${p2(estado.mes)}-${p2(ultimoDia(estado.ano, estado.mes))}` };
  }
  if (estado.tipo === 'semestre') {
    return estado.semestre === 1
      ? { inicio: `${estado.ano}-01-01`, fim: `${estado.ano}-06-30` }
      : { inicio: `${estado.ano}-07-01`, fim: `${estado.ano}-12-31` };
  }
  return { inicio: estado.inicio, fim: estado.fim };
}

// Evolução: para um único mês mostra os 6 meses até ele; senão usa o próprio período.
function periodoEvolucao() {
  const p = periodoAtual();
  if (estado.tipo !== 'mes') return p;
  let ano = estado.ano; let mes = estado.mes - 5;
  if (mes < 1) { mes += 12; ano -= 1; }
  return { inicio: `${ano}-${p2(mes)}-01`, fim: p.fim };
}

const rotuloPeriodo = (p) => `${formatarData(p.inicio)} a ${formatarData(p.fim)}`;

// ---------- filtros ----------

const selTipo = h('select', { class: 'select', id: 'f-tipo', 'aria-label': 'Tipo de período' },
  h('option', { value: 'mes' }, 'Mês'), h('option', { value: 'semestre' }, 'Semestre'), h('option', { value: 'personalizado' }, 'Personalizado'));
const anoAtual = agora.getFullYear();
const selAno = h('select', { class: 'select', id: 'f-ano' },
  ...Array.from({ length: 6 }, (_, i) => anoAtual - 4 + i).map((a) => h('option', { value: a }, a)));
const selMes = h('select', { class: 'select', id: 'f-mes' }, ...MESES.map((m, i) => h('option', { value: i + 1 }, m)));
const selSemestre = h('select', { class: 'select', id: 'f-semestre' }, h('option', { value: 1 }, '1º semestre'), h('option', { value: 2 }, '2º semestre'));
const inInicio = h('input', { class: 'input', type: 'date', id: 'f-inicio' });
const inFim = h('input', { class: 'input', type: 'date', id: 'f-fim' });
const selUnidade = h('select', { class: 'select', id: 'f-unidade' },
  h('option', { value: '' }, 'Todas as unidades'),
  ...usuario.unidades.map((u) => h('option', { value: u.id }, `${u.sigla} — ${u.nome}`)));
const btnAplicar = h('button', { type: 'button', class: 'btn' }, 'Atualizar');

const campo = (rotulo, el, id, classe = '') => h('div', { class: `campo ${classe}`.trim() }, h('label', { for: id }, rotulo), el);
const campoMes = campo('Mês', selMes, 'f-mes');
const campoSem = campo('Semestre', selSemestre, 'f-semestre');
const campoAno = campo('Ano', selAno, 'f-ano');
const campoIni = campo('De', inInicio, 'f-inicio');
const campoFim = campo('Até', inFim, 'f-fim');

selTipo.value = estado.tipo; selAno.value = estado.ano; selMes.value = estado.mes; selSemestre.value = estado.semestre;

function ajustarCampos() {
  const t = selTipo.value;
  campoMes.hidden = t !== 'mes';
  campoSem.hidden = t !== 'semestre';
  campoAno.hidden = t === 'personalizado';
  campoIni.hidden = campoFim.hidden = t !== 'personalizado';
}
selTipo.addEventListener('change', ajustarCampos);
ajustarCampos();

const filtros = h('section', { class: 'card painel-filtros' },
  h('div', { class: 'grade grade-4' },
    campo('Período', selTipo, 'f-tipo'), campoAno, campoMes, campoSem, campoIni, campoFim,
    campo('Unidade', selUnidade, 'f-unidade')),
  h('div', { class: 'barra-acoes' }, btnAplicar));

function lerFiltros() {
  estado.tipo = selTipo.value;
  estado.ano = Number(selAno.value); estado.mes = Number(selMes.value); estado.semestre = Number(selSemestre.value);
  estado.inicio = inInicio.value; estado.fim = inFim.value; estado.unidadeId = selUnidade.value;
  if (estado.tipo === 'personalizado' && (!estado.inicio || !estado.fim)) {
    toast.aviso('Informe a data inicial e a final.');
    return false;
  }
  return true;
}

// ---------- seções ----------

const secKpi = h('section', { 'aria-live': 'polite' });
const secTabela = h('section', { class: 'card' });
const secGraficos = h('section', { class: 'grade grade-2' });
const secPerfil = h('section');
const secAlertas = h('section', { class: 'card' });

conteudo.replaceChildren(
  h('div', { class: 'pagina-titulo' }, h('h1', {}, 'Painel do Coordenador')),
  filtros, secKpi, secTabela, secGraficos,
  h('h2', {}, 'Perfil do público atendido'), secPerfil,
  h('h2', {}, 'Alertas'), secAlertas,
);

function kpi(rotulo, valor, ajuda) {
  return h('div', { class: 'card kpi' },
    h('span', { class: 'kpi-rotulo' }, rotulo),
    h('strong', { class: 'kpi-valor' }, valor),
    ajuda ? h('span', { class: 'kpi-ajuda' }, ajuda) : null);
}

function renderKpis(dados) {
  const t = dados.total;
  secKpi.replaceChildren(
    h('p', { class: 'texto-suave texto-pequeno' }, `Período: ${rotuloPeriodo(dados.periodo)}`),
    h('div', { class: 'grade grade-4 kpis' },
      kpi('Atendimentos', formatarNumero(t.atendimentos)),
      kpi('Ações realizadas', formatarNumero(t.acoes)),
      kpi('Participantes', formatarNumero(t.participantes)),
      kpi('Famílias acompanhadas', formatarNumero(t.familiasAcompanhadas)),
      kpi('Total de atendimento', formatarNumero(t.totalAtendimento), 'atendimentos + participantes'),
      kpi('Com encaminhamento', formatarNumero(t.atendimentosComEncaminhamento)),
      kpi('% encaminhamentos', pct(t.pctEncaminhamentos), 'atendimentos ÷ total de atendimento (como no Excel)')));
}

const COLUNAS = [
  ['Unidade', (l) => l.sigla, 'texto'],
  ['Atendimentos', (l) => l.atendimentos, 'num'],
  ['Atend. com encaminhamento', (l) => l.atendimentosComEncaminhamento, 'num'],
  ['Ações', (l) => l.acoes, 'num'],
  ['Participantes', (l) => l.participantes, 'num'],
  ['Famílias acompanhadas', (l) => l.familiasAcompanhadas, 'num'],
  ['Total atendimento', (l) => l.totalAtendimento, 'num'],
  ['% encaminhamentos', (l) => l.pctEncaminhamentos, 'pct'],
];

function celula(valor, tipo) {
  if (tipo === 'pct') return pct(valor);
  return tipo === 'num' ? formatarNumero(valor) : valor;
}

function renderTabela(dados) {
  const todas = [...dados.unidades, { ...dados.total, sigla: 'TOTAL' }];
  const tabela = h('table', { class: 'tabela tabela-responsiva' },
    h('thead', {}, h('tr', {}, COLUNAS.map(([r]) => h('th', { scope: 'col' }, r)))),
    h('tbody', {}, todas.map((l) => h('tr', { class: l.sigla === 'TOTAL' ? 'linha-total' : null },
      COLUNAS.map(([r, f, tipo]) => h('td', { 'data-rotulo': r, class: tipo === 'texto' ? null : 'num' }, celula(f(l), tipo)))))));
  const btn = h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', onclick: () => exportarCsv(dados) }, 'Exportar CSV');
  secTabela.replaceChildren(
    h('div', { class: 'pagina-titulo' }, h('h2', {}, 'Indicadores por unidade'), btn),
    h('div', { class: 'tabela-wrap' }, tabela));
}

// CSV para Excel brasileiro: separador ';', decimal ',', BOM UTF-8.
function exportarCsv(dados) {
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita interpretação como fórmula
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v, tipo) => (tipo === 'pct' ? (v === null ? '' : (v * 100).toFixed(1).replace('.', ',') + '%') : tipo === 'num' ? String(v) : v);
  const linhasCsv = [COLUNAS.map(([r]) => r)];
  for (const l of [...dados.unidades, { ...dados.total, sigla: 'TOTAL' }]) linhasCsv.push(COLUNAS.map(([, f, tipo]) => num(f(l), tipo)));
  const csv = `﻿${linhasCsv.map((l) => l.map(esc).join(';')).join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `painel_${dados.periodo.inicio}_${dados.periodo.fim}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderGraficos(mensal, evolucao) {
  const un = mensal.unidades;
  const cartaoUnidades = h('div', { class: 'card' }, h('h3', {}, 'Por unidade'),
    barras({
      titulo: 'Atendimentos e participantes por unidade',
      categorias: un.map((u) => u.sigla),
      series: [{ nome: 'Atendimentos', valores: un.map((u) => u.atendimentos) }, { nome: 'Participantes', valores: un.map((u) => u.participantes) }],
    }));
  const cats = evolucao.meses.map((m) => `${MESES_CURTOS[m.mes - 1]}/${String(m.ano).slice(2)}`);
  const cartaoEvolucao = h('div', { class: 'card' }, h('h3', {}, 'Evolução mensal'),
    linhas({
      titulo: 'Evolução mensal de atendimentos e participantes',
      categorias: cats,
      series: [{ nome: 'Atendimentos', valores: evolucao.meses.map((m) => m.atendimentos) }, { nome: 'Participantes', valores: evolucao.meses.map((m) => m.participantes) }],
    }),
    h('p', { class: 'texto-suave texto-pequeno' }, `Período do gráfico: ${rotuloPeriodo(evolucao.periodo)}`));
  secGraficos.replaceChildren(cartaoUnidades, cartaoEvolucao);
}

function renderPerfil(p) {
  const total = p.totalAtendimentos;
  const dim = (titulo, itens) => distribuicao({ titulo, itens, total });
  secPerfil.replaceChildren(
    h('p', { class: 'texto-suave texto-pequeno' }, `Base: ${formatarNumero(total)} atendimento(s) no período. Perguntas de múltipla escolha podem somar mais de 100%.`),
    h('div', { class: 'grade grade-2' },
      dim('Faixa etária', p.faixaEtaria), dim('Gênero', p.genero), dim('Escolaridade', p.escolaridade),
      dim('Raça/etnia', p.raca), dim('Nível de vulnerabilidade', p.nivelVulnerabilidade), dim('Vulnerabilidades e riscos', p.vulnerabilidades),
      dim('Demandas', p.demandas), dim('Encaminhamentos', p.encaminhamentos)));
}

function renderAlertas(a) {
  const blocos = [];
  const vencidos = a.questionariosFinais.filter((q) => q.situacao === 'VENCIDO');
  const aVencer = a.questionariosFinais.filter((q) => q.situacao === 'A_VENCER');

  const lista = (itens, descreve, classeBadge, textoBadge) => h('ul', { class: 'lista-alertas' },
    itens.map((i) => h('li', {}, h('span', { class: `badge ${classeBadge}` }, textoBadge(i)), ' ', descreve(i))));

  if (a.resumoPorUnidade.length) {
    blocos.push(h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela tabela-responsiva' },
      h('thead', {}, h('tr', {}, ['Unidade', 'Questionários vencidos', 'Questionários a vencer', 'Ações sem atualização', 'Famílias sem contato'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, a.resumoPorUnidade.map((r) => h('tr', {},
        h('td', { 'data-rotulo': 'Unidade' }, r.unidadeSigla),
        h('td', { 'data-rotulo': 'Questionários vencidos', class: 'num' }, r.questionariosVencidos),
        h('td', { 'data-rotulo': 'Questionários a vencer', class: 'num' }, r.questionariosAVencer),
        h('td', { 'data-rotulo': 'Ações sem atualização', class: 'num' }, r.acoesDesatualizadas),
        h('td', { 'data-rotulo': 'Famílias sem contato', class: 'num' }, r.familiasSemContato)))))));
  }
  if (vencidos.length) {
    blocos.push(h('h3', {}, 'Questionários finais vencidos'),
      lista(vencidos, (q) => `${q.unidadeSigla} — ${q.responsavelNome} (limite ${formatarData(q.dataLimite)})`, 'badge-perigo', (q) => `${-q.diasRestantes} d de atraso`));
  }
  if (aVencer.length) {
    blocos.push(h('h3', {}, 'Questionários finais a vencer'),
      lista(aVencer, (q) => `${q.unidadeSigla} — ${q.responsavelNome} (limite ${formatarData(q.dataLimite)})`, 'badge-aviso', (q) => (q.diasRestantes === 0 ? 'vence hoje' : `em ${q.diasRestantes} d`)));
  }
  if (a.familiasSemContato.length) {
    blocos.push(h('h3', {}, 'Famílias sem contato'),
      lista(a.familiasSemContato, (f) => `${f.unidadeSigla} — ${f.responsavelNome} (último contato em ${formatarData(f.ultimoContato)})`,
        'badge-aviso', (f) => `${f.diasSemContato} d`));
  }
  if (a.acoesDesatualizadas.length) {
    blocos.push(h('h3', {}, 'Ações planejadas sem atualização'),
      lista(a.acoesDesatualizadas, (x) => `${x.unidadeSigla} — ${x.instituicaoLocal || 'sem local'} (${formatarData(x.dataAcao)})`, 'badge-aviso', (x) => `${x.diasAtraso} d`));
  }
  if (!blocos.length) blocos.push(h('p', { class: 'texto-suave' }, 'Nenhum alerta no momento.'));
  secAlertas.replaceChildren(...blocos);
}

// ---------- carga ----------

async function carregar() {
  const p = periodoAtual();
  const pe = periodoEvolucao();
  const unidadeId = estado.unidadeId || undefined;
  for (const s of [secKpi, secTabela, secGraficos, secPerfil, secAlertas]) s.replaceChildren(carregando());
  try {
    const [mensal, evolucao, perfil, alertas] = await Promise.all([
      api.get('/api/painel/mensal', { inicio: p.inicio, fim: p.fim, unidadeId }),
      api.get('/api/painel/evolucao', { inicio: pe.inicio, fim: pe.fim, unidadeId }),
      api.get('/api/painel/perfil', { inicio: p.inicio, fim: p.fim, unidadeId }),
      api.get('/api/painel/alertas', { unidadeId }),
    ]);
    renderKpis(mensal); renderTabela(mensal); renderGraficos(mensal, evolucao); renderPerfil(perfil); renderAlertas(alertas);
  } catch (e) {
    for (const s of [secKpi, secTabela, secGraficos, secPerfil, secAlertas]) s.replaceChildren();
    secKpi.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message || 'Não foi possível carregar o painel.'));
  }
}

btnAplicar.addEventListener('click', () => { if (lerFiltros()) comEspera(btnAplicar, carregar); });
await carregar();
