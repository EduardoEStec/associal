'use strict';

// Consultas dos relatórios. Lê direto do banco (schema 001) — NÃO depende das rotas dos outros módulos.
// TODA consulta passa por clausulaUnidades (escopo do usuário) + o filtro de unidades escolhido na tela.

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { consultar, consultarUm, tipos } = require('../db');
const { clausulaUnidades, unidadesPermitidas } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { QUESTIONARIO } = require('../lib/dominios');
const { numero, moeda, percentual } = require('./relatorios-textos');
const indice = require('./indice-dados');

// ---------- escopo de unidades ----------

// Converte "1,2,3" / [1,2] em ids inteiros únicos; vazio => null (= todas as permitidas).
function lerIds(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const lista = Array.isArray(valor) ? valor : String(valor).split(',');
  const ids = [...new Set(lista.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? ids : null;
}

// Unidades efetivamente usadas no relatório: as pedidas (todas precisam estar entre as permitidas) ou todas as permitidas.
function resolverEscopo(req, idsPedidos) {
  const permitidas = unidadesPermitidas(req);
  const ids = lerIds(idsPedidos);
  if (ids) {
    if (ids.some((id) => !permitidas.includes(id))) throw erros.proibido('Você não tem acesso a uma das unidades selecionadas.');
    return ids;
  }
  if (permitidas.length === 0) throw erros.proibido('Você não está vinculado a nenhuma unidade.');
  return permitidas;
}

// "coluna IN (permitidas) AND coluna IN (selecionadas)" — defesa em profundidade.
function filtroUnidades(req, coluna, selecionadas, params) {
  const base = clausulaUnidades(req, coluna, params);
  const nomes = selecionadas.map((id, i) => {
    params[`sel${i}`] = id;
    return `@sel${i}`;
  });
  return `${base} AND ${coluna} IN (${nomes.join(', ')})`;
}

async function unidadesPorId(selecionadas) {
  const params = {};
  const nomes = selecionadas.map((id, i) => {
    params[`u${i}`] = id;
    return `@u${i}`;
  });
  return consultar(`SELECT id, sigla, nome FROM unidade WHERE id IN (${nomes.join(', ')}) ORDER BY ordem, nome`, params);
}

// ---------- Relatório Individual ----------

async function listarAcompanhamentos(req, { unidadeId, busca }) {
  const params = {};
  const filtros = [clausulaUnidades(req, 'ac.unidade_id', params)];
  if (unidadeId) {
    if (!unidadesPermitidas(req).includes(unidadeId)) throw erros.proibido('Você não tem acesso a esta unidade.');
    filtros.push('ac.unidade_id = @unidadeFiltro');
    params.unidadeFiltro = unidadeId;
  }
  if (busca) {
    filtros.push('p.nome LIKE @busca');
    params.busca = `%${busca.replace(/[%_[]/g, '')}%`;
  }
  return consultar(
    `SELECT TOP 200 ac.id, ac.data_inicio, ac.status, un.sigla AS unidade_sigla, p.nome AS responsavel_nome,
            (SELECT COUNT(*) FROM questionario q WHERE q.acompanhamento_id = ac.id AND q.tipo = 'INICIAL' AND q.concluido = 1) AS tem_inicial,
            (SELECT COUNT(*) FROM questionario q WHERE q.acompanhamento_id = ac.id AND q.tipo = 'FINAL' AND q.concluido = 1) AS tem_final
       FROM acompanhamento ac
       JOIN familia f ON f.id = ac.familia_id
       JOIN pessoa p ON p.id = f.responsavel_pessoa_id
       JOIN unidade un ON un.id = ac.unidade_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY p.nome`,
    params,
  );
}

// Índice de progresso + contatos registrados (seção "Evolução durante o acompanhamento")
async function carregarEvolucao(req, acompanhamentoId) {
  const indicadores = await indice.obterIndicadores(req, acompanhamentoId);
  const [c] = await consultar(
    `SELECT COUNT(*) AS total, MIN(data_registro) AS primeiro, MAX(data_registro) AS ultimo
       FROM acompanhamento_registro WHERE acompanhamento_id = @id AND houve_contato = 1 AND anulado_em IS NULL`,
    { id: acompanhamentoId });
  const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  const total = c ? c.total : 0;
  const intervaloMedioDias = total > 1
    ? Math.round((new Date(`${dia(c.ultimo)}T00:00:00Z`) - new Date(`${dia(c.primeiro)}T00:00:00Z`)) / 86400000 / (total - 1))
    : null;
  // metas combinadas com a família (F4), na ordem em que foram definidas
  const metas = await consultar(
    `SELECT dimensao, descricao, prazo, status, concluida_em FROM acompanhamento_meta WHERE acompanhamento_id = @id ORDER BY criado_em, id`,
    { id: acompanhamentoId });
  return { ...indicadores, metas, contatos: { total, primeiro: dia(c?.primeiro), ultimo: dia(c?.ultimo), intervaloMedioDias } };
}

async function carregarIndividual(req, acompanhamentoId) {
  const params = { id: acompanhamentoId };
  const where = clausulaUnidades(req, 'ac.unidade_id', params);
  const acompanhamento = await consultarUm(
    `SELECT ac.id, ac.familia_id, ac.unidade_id, ac.data_inicio, ac.status,
            un.sigla AS unidade_sigla, un.nome AS unidade_nome
       FROM acompanhamento ac JOIN unidade un ON un.id = ac.unidade_id
      WHERE ac.id = @id AND ${where}`,
    params,
  );
  if (!acompanhamento) throw erros.naoEncontrado();

  const responsavel = await consultarUm(
    `SELECT p.nome, p.cpf, p.nis, p.telefone, p.telefone2, p.endereco, p.cep, p.bairro, p.trabalho_atual
       FROM familia f JOIN pessoa p ON p.id = f.responsavel_pessoa_id
      WHERE f.id = @familiaId`,
    { familiaId: acompanhamento.familiaId },
  );
  const membros = await consultar(
    `SELECT m.id, m.nome, m.data_nascimento, m.idade, m.parentesco, m.trabalha
       FROM familia_membro m WHERE m.familia_id = @familiaId ORDER BY m.id`,
    { familiaId: acompanhamento.familiaId },
  );
  const questionarios = await consultar(
    'SELECT * FROM questionario WHERE acompanhamento_id = @id',
    { id: acompanhamentoId },
  );
  const inicial = questionarios.find((q) => q.tipo === 'INICIAL') || null;
  const final = questionarios.find((q) => q.tipo === 'FINAL') || null;

  const beneficiosInicial = inicial
    ? (await consultar(
      `SELECT b.nome FROM questionario_beneficio qb JOIN beneficio b ON b.id = qb.beneficio_id
        WHERE qb.questionario_id = @q ORDER BY b.ordem, b.nome`,
      { q: inicial.id },
    )).map((l) => l.nome)
    : [];
  const destinosFinal = final
    ? (await consultar(
      `SELECT d.nome FROM questionario_destino_economia qd JOIN destino_economia d ON d.id = qd.destino_economia_id
        WHERE qd.questionario_id = @q ORDER BY d.ordem, d.nome`,
      { q: final.id },
    )).map((l) => l.nome)
    : [];

  const evolucao = await carregarEvolucao(req, acompanhamentoId);
  return { acompanhamento, responsavel, membros, inicial, final, beneficiosInicial, destinosFinal, evolucao };
}

// ---------- Relatório Semestral ----------

const PERGUNTAS_ABERTAS = [
  ['principalBeneficio', 'Principal benefício percebido'],
  ['contribuicaoAutonomia', 'Contribuição para a autonomia financeira'],
  ['impactoComunidade', 'Impacto na comunidade'],
  ['oQueMelhorar', 'O que pode melhorar'],
];

const PERGUNTAS_FECHADAS = [
  ['acessoAlimentosInNatura', 'Acesso a alimentos in natura'],
  ['frequenciaFrutasVerduras', 'Consumo de frutas, verduras e legumes'],
  ['qualidadeAlimentacao', 'Qualidade da alimentação'],
  ['saudeNutricional', 'Saúde e bem-estar nutricional'],
  ['economiaMensalFaixa', 'Economia mensal no armazém'],
  ['capacidadePoupanca', 'Capacidade de poupança'],
  ['gestaoFinanceira', 'Dívidas e gestão financeira'],
  ['avaliacaoArmazem', 'Avaliação do armazém'],
];

const PERGUNTAS_SIM_NAO = [
  ['recebeAuxilio', 'Recebe auxílio governamental'],
  ['conseguePoupar', 'Consegue poupar'],
  ['empoderadaDecisoes', 'Sente-se mais empoderada para decisões'],
  ['melhoriaPlanejamento', 'Melhoria no planejamento financeiro'],
  ['recomendaria', 'Recomendaria o armazém'],
];

const media = (valores) => {
  const v = valores.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + Number(b), 0) / v.length : null;
};

// Consolida os pares inicial × final (listas de questionários concluídos por acompanhamento).
function consolidar(pares) {
  const indicadores = [];
  const fmtMoeda = (v) => (v === null ? '—' : moeda(v));
  const iniciais = pares.map((p) => p.inicial);
  const finais = pares.map((p) => p.final);

  indicadores.push({ rotulo: 'Renda mensal média da família', inicial: fmtMoeda(media(iniciais.map((q) => q.rendaMensalMedia))), final: fmtMoeda(media(finais.map((q) => q.rendaMensalMedia))) });
  indicadores.push({ rotulo: 'Economia mensal média no armazém (R$)', inicial: fmtMoeda(media(iniciais.map((q) => q.economiaMensalValor))), final: fmtMoeda(media(finais.map((q) => q.economiaMensalValor))) });

  for (const [campo, nome] of PERGUNTAS_SIM_NAO) {
    const conta = (lista) => {
      const respondidas = lista.filter((q) => q[campo] !== null && q[campo] !== undefined);
      const sim = respondidas.filter((q) => q[campo] === true).length;
      return respondidas.length ? `${percentual(sim, respondidas.length)} (${numero(sim)} de ${numero(respondidas.length)})` : '—';
    };
    indicadores.push({ rotulo: `${nome} (sim)`, inicial: conta(iniciais), final: conta(finais) });
  }

  const distribuicoes = [];
  for (const [campo, nome] of PERGUNTAS_FECHADAS) {
    for (const [codigo, texto] of Object.entries(QUESTIONARIO[campo])) {
      const ini = iniciais.filter((q) => q[campo] === codigo).length;
      const fin = finais.filter((q) => q[campo] === codigo).length;
      if (ini === 0 && fin === 0) continue;
      distribuicoes.push({ pergunta: nome, resposta: texto, inicial: numero(ini), final: numero(fin) });
    }
  }
  return { pares: pares.length, indicadores, distribuicoes };
}

async function coletarSemestral(req, { dataInicio, dataFim, unidadeIds }) {
  const selecionadas = resolverEscopo(req, unidadeIds);
  const unidades = await unidadesPorId(selecionadas);
  const periodo = { dataInicio, dataFim };
  const datas = (p) => {
    p.ini = [tipos.Date, dataInicio];
    p.fim = [tipos.Date, dataFim];
    return p;
  };

  // --- atendimentos ---
  let p = datas({});
  let w = filtroUnidades(req, 'a.unidade_id', selecionadas, p);
  const atendPorUnidade = await consultar(
    `SELECT a.unidade_id, COUNT(*) AS atendimentos
       FROM atendimento a WHERE ${w} AND a.data_atendimento BETWEEN @ini AND @fim GROUP BY a.unidade_id`, p);

  p = datas({});
  w = filtroUnidades(req, 'a.unidade_id', selecionadas, p);
  const encPorUnidade = await consultar(
    `SELECT a.unidade_id, COUNT(*) AS encaminhamentos, COUNT(DISTINCT a.id) AS atendimentos_com_encaminhamento
       FROM atendimento a JOIN atendimento_encaminhamento ae ON ae.atendimento_id = a.id
      WHERE ${w} AND a.data_atendimento BETWEEN @ini AND @fim GROUP BY a.unidade_id`, p);

  p = datas({});
  w = filtroUnidades(req, 'a.unidade_id', selecionadas, p);
  const encPorInstituicao = await consultar(
    `SELECT e.nome, COUNT(*) AS quantidade
       FROM atendimento a
       JOIN atendimento_encaminhamento ae ON ae.atendimento_id = a.id
       JOIN encaminhamento e ON e.id = ae.encaminhamento_id
      WHERE ${w} AND a.data_atendimento BETWEEN @ini AND @fim
      GROUP BY e.id, e.nome ORDER BY COUNT(*) DESC, e.nome`, p);

  const porUnidade = unidades.map((u) => {
    const a = atendPorUnidade.find((x) => x.unidadeId === u.id);
    const e = encPorUnidade.find((x) => x.unidadeId === u.id);
    return {
      unidadeId: u.id, sigla: u.sigla, nome: u.nome,
      atendimentos: a?.atendimentos || 0,
      encaminhamentos: e?.encaminhamentos || 0,
      atendimentosComEncaminhamento: e?.atendimentosComEncaminhamento || 0,
    };
  });
  const soma = (campo) => porUnidade.reduce((t, u) => t + u[campo], 0);

  // --- ações e visitas realizadas ---
  p = datas({});
  w = filtroUnidades(req, 'av.unidade_id', selecionadas, p);
  const acoes = await consultar(
    `SELECT av.id, av.unidade_id, av.data_acao, av.instituicao_local, av.endereco, av.qtd_participantes, ta.nome AS tipo
       FROM acao_visita av JOIN tipo_acao ta ON ta.id = av.tipo_acao_id
      WHERE ${w} AND av.status = 'REALIZADA' AND av.data_acao BETWEEN @ini AND @fim
      ORDER BY av.data_acao, av.id`, p);

  p = datas({});
  w = filtroUnidades(req, 'av.unidade_id', selecionadas, p);
  const temasLinhas = await consultar(
    `SELECT t.acao_visita_id, tm.nome
       FROM acao_visita_tema t
       JOIN tema tm ON tm.id = t.tema_id
       JOIN acao_visita av ON av.id = t.acao_visita_id
      WHERE ${w} AND av.status = 'REALIZADA' AND av.data_acao BETWEEN @ini AND @fim
      ORDER BY t.acao_visita_id, t.ordem`, p);
  const temasPorAcao = new Map();
  for (const t of temasLinhas) {
    if (!temasPorAcao.has(t.acaoVisitaId)) temasPorAcao.set(t.acaoVisitaId, []);
    temasPorAcao.get(t.acaoVisitaId).push(t.nome);
  }
  const unidadePorId = new Map(unidades.map((u) => [u.id, u]));
  const itemAcao = (a) => ({
    id: a.id,
    unidadeId: a.unidadeId,
    sigla: unidadePorId.get(a.unidadeId)?.sigla || '',
    data: a.dataAcao,
    local: a.instituicaoLocal || '',
    endereco: a.endereco || '',
    tipo: a.tipo,
    temas: (temasPorAcao.get(a.id) || []).join(', '),
    participantes: a.qtdParticipantes,
  });
  const ehVisita = (a) => /^visita/i.test(a.tipo);
  const visitasPorUnidade = unidades.map((u) => {
    const itens = acoes.filter((a) => a.unidadeId === u.id && ehVisita(a)).map(itemAcao);
    return { unidadeId: u.id, sigla: u.sigla, nome: u.nome, quantidade: itens.length, itens };
  });
  const outrasAcoes = acoes.filter((a) => !ehVisita(a)).map(itemAcao);

  // --- famílias acompanhadas (acompanhamentos que cobrem algum dia do período) ---
  p = datas({});
  w = filtroUnidades(req, 'ac.unidade_id', selecionadas, p);
  const familiasPorUnidade = await consultar(
    `SELECT ac.unidade_id, COUNT(*) AS familias
       FROM acompanhamento ac
      WHERE ${w} AND ac.data_inicio <= @fim AND (ac.data_encerramento IS NULL OR ac.data_encerramento >= @ini)
      GROUP BY ac.unidade_id`, p);
  const familiasTotal = familiasPorUnidade.reduce((t, l) => t + l.familias, 0);

  // --- comparação inicial × final (acompanhamentos com os dois concluídos; FINAL aplicado no período) ---
  p = datas({});
  w = filtroUnidades(req, 'ac.unidade_id', selecionadas, p);
  const questionarios = await consultar(
    `SELECT q.*, ac.unidade_id
       FROM questionario q JOIN acompanhamento ac ON ac.id = q.acompanhamento_id
      WHERE ${w} AND q.concluido = 1
        AND EXISTS (SELECT 1 FROM questionario qf WHERE qf.acompanhamento_id = ac.id AND qf.tipo = 'FINAL'
                       AND qf.concluido = 1 AND qf.data_aplicacao BETWEEN @ini AND @fim)
        AND EXISTS (SELECT 1 FROM questionario qi WHERE qi.acompanhamento_id = ac.id AND qi.tipo = 'INICIAL' AND qi.concluido = 1)`, p);
  const porAcomp = new Map();
  for (const q of questionarios) {
    if (!porAcomp.has(q.acompanhamentoId)) porAcomp.set(q.acompanhamentoId, {});
    porAcomp.get(q.acompanhamentoId)[q.tipo === 'INICIAL' ? 'inicial' : 'final'] = q;
  }
  const pares = [...porAcomp.values()].filter((x) => x.inicial && x.final);
  const comparacao = consolidar(pares);

  // --- relatos (respostas abertas do questionário FINAL; anônimos: só a unidade) ---
  const relatos = [];
  for (const par of pares) {
    const q = par.final;
    for (const [campo, pergunta] of PERGUNTAS_ABERTAS) {
      const texto = (q[campo] || '').trim();
      if (!texto) continue;
      relatos.push({
        id: `${q.id}.${campo}`,
        unidadeId: q.unidadeId,
        sigla: unidadePorId.get(q.unidadeId)?.sigla || '',
        pergunta,
        texto,
      });
    }
  }

  // --- fotos das ações realizadas ---
  p = datas({});
  w = filtroUnidades(req, 'av.unidade_id', selecionadas, p);
  const fotos = await consultar(
    `SELECT TOP 500 f.id, f.arquivo, f.mime_type, f.legenda, av.unidade_id, av.data_acao, av.instituicao_local
       FROM acao_visita_foto f JOIN acao_visita av ON av.id = f.acao_visita_id
      WHERE ${w} AND av.status = 'REALIZADA' AND av.data_acao BETWEEN @ini AND @fim
      ORDER BY av.unidade_id, av.data_acao, f.ordem, f.id`, p);

  return {
    periodo,
    unidades,
    totais: {
      atendimentos: soma('atendimentos'),
      encaminhamentos: soma('encaminhamentos'),
      atendimentosComEncaminhamento: soma('atendimentosComEncaminhamento'),
      visitas: visitasPorUnidade.reduce((t, u) => t + u.quantidade, 0),
      outrasAcoes: outrasAcoes.length,
      participantes: acoes.reduce((t, a) => t + (a.qtdParticipantes || 0), 0),
      familias: familiasTotal,
      pares: pares.length,
    },
    atendimentosPorUnidade: porUnidade,
    encaminhamentosPorInstituicao: encPorInstituicao,
    visitasPorUnidade,
    outrasAcoes,
    familiasPorUnidade: unidades.map((u) => ({
      unidadeId: u.id, sigla: u.sigla, nome: u.nome,
      familias: familiasPorUnidade.find((x) => x.unidadeId === u.id)?.familias || 0,
    })),
    comparacao,
    relatos,
    fotos: fotos.map((f) => ({
      id: f.id,
      arquivo: f.arquivo,
      mime: f.mimeType,
      legenda: f.legenda || '',
      unidadeId: f.unidadeId,
      sigla: unidadePorId.get(f.unidadeId)?.sigla || '',
      data: f.dataAcao,
      local: f.instituicaoLocal || '',
    })),
  };
}

// ---------- fotos ----------

// Caminho físico seguro da foto (T3 grava em uploads/acoes/<arquivo>; aceita também direto em uploads/).
function caminhoFoto(arquivo) {
  const nome = path.basename(String(arquivo || ''));
  if (!nome || nome !== arquivo) return null;
  for (const dir of [path.join(config.uploadDir, 'acoes'), config.uploadDir]) {
    const completo = path.join(dir, nome);
    if (completo.startsWith(dir + path.sep) && fs.existsSync(completo)) return completo;
  }
  return null;
}

async function carregarFotoDoUsuario(req, fotoId) {
  const params = { id: fotoId };
  const w = clausulaUnidades(req, 'av.unidade_id', params);
  const foto = await consultarUm(
    `SELECT f.id, f.arquivo, f.mime_type FROM acao_visita_foto f JOIN acao_visita av ON av.id = f.acao_visita_id
      WHERE f.id = @id AND ${w}`, params);
  if (!foto) return null;
  const caminho = caminhoFoto(foto.arquivo);
  return caminho ? { ...foto, caminho } : null;
}

// ---------- exportação CSV (transição das planilhas) ----------

// Equivalente à aba BS_ATENDIMENTO: uma linha por unidade e mês.
async function resumoMensal(req, { dataInicio, dataFim, unidadeIds }) {
  const selecionadas = resolverEscopo(req, unidadeIds);
  const datas = (p) => { p.ini = [tipos.Date, dataInicio]; p.fim = [tipos.Date, dataFim]; return p; };

  let p = datas({});
  let w = filtroUnidades(req, 'a.unidade_id', selecionadas, p);
  const atend = await consultar(
    `SELECT a.unidade_id, YEAR(a.data_atendimento) AS ano, MONTH(a.data_atendimento) AS mes, COUNT(*) AS atendimentos
       FROM atendimento a WHERE ${w} AND a.data_atendimento BETWEEN @ini AND @fim
      GROUP BY a.unidade_id, YEAR(a.data_atendimento), MONTH(a.data_atendimento)`, p);

  p = datas({});
  w = filtroUnidades(req, 'av.unidade_id', selecionadas, p);
  const acoes = await consultar(
    `SELECT av.unidade_id, YEAR(av.data_acao) AS ano, MONTH(av.data_acao) AS mes, COUNT(*) AS acoes,
            COALESCE(SUM(av.qtd_participantes), 0) AS participantes
       FROM acao_visita av WHERE ${w} AND av.status = 'REALIZADA' AND av.data_acao BETWEEN @ini AND @fim
      GROUP BY av.unidade_id, YEAR(av.data_acao), MONTH(av.data_acao)`, p);

  // famílias acompanhadas no mês: acompanhamentos ativos em algum dia do mês (contagem em JS)
  p = datas({});
  w = filtroUnidades(req, 'ac.unidade_id', selecionadas, p);
  const acomps = await consultar(
    `SELECT ac.unidade_id, ac.data_inicio, ac.data_encerramento
       FROM acompanhamento ac
      WHERE ${w} AND ac.data_inicio <= @fim AND (ac.data_encerramento IS NULL OR ac.data_encerramento >= @ini)`, p);
  const iso = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  const familias = [];
  const [anoIni, mesIni] = dataInicio.split('-').map(Number);
  const [anoFim, mesFim] = dataFim.split('-').map(Number);
  for (let ano = anoIni, mes = mesIni; ano < anoFim || (ano === anoFim && mes <= mesFim); mes += 1) {
    if (mes > 12) { mes = 1; ano += 1; }
    const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimo = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
    const porUnidade = new Map();
    for (const c of acomps) {
      if (iso(c.dataInicio) <= ultimo && (!c.dataEncerramento || iso(c.dataEncerramento) >= primeiro)) {
        porUnidade.set(c.unidadeId, (porUnidade.get(c.unidadeId) || 0) + 1);
      }
    }
    for (const [unidadeId, n] of porUnidade) familias.push({ unidadeId, ano, mes, familias: n });
    if (mes === 12 && ano === anoFim && mesFim === 12) break;
  }

  const unidades = await unidadesPorId(selecionadas);
  const chaves = new Set();
  for (const l of [...atend, ...acoes, ...familias]) chaves.add(`${l.unidadeId}|${l.ano}|${l.mes}`);
  const linhas = [...chaves].map((chave) => {
    const [unidadeId, ano, mes] = chave.split('|').map(Number);
    const a = atend.find((x) => x.unidadeId === unidadeId && x.ano === ano && x.mes === mes);
    const c = acoes.find((x) => x.unidadeId === unidadeId && x.ano === ano && x.mes === mes);
    const f = familias.find((x) => x.unidadeId === unidadeId && x.ano === ano && x.mes === mes);
    const atendimentos = a?.atendimentos || 0;
    const participantes = Number(c?.participantes || 0);
    const total = atendimentos + participantes;
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
    return {
      ano, mes, data: ultimoDia, unidade: unidades.find((u) => u.id === unidadeId)?.sigla || '',
      atendimentos, acoes: c?.acoes || 0, participantes, familias: f?.familias || 0, total,
      percentual: total > 0 ? atendimentos / total : 0,
    };
  });
  linhas.sort((x, y) => x.ano - y.ano || x.mes - y.mes || x.unidade.localeCompare(y.unidade));
  return linhas;
}

// Equivalente à aba BASE_UNICA_ACOES: uma linha por ação/visita.
async function listaAcoes(req, { dataInicio, dataFim, unidadeIds }) {
  const selecionadas = resolverEscopo(req, unidadeIds);
  let p = { ini: [tipos.Date, dataInicio], fim: [tipos.Date, dataFim] };
  let w = filtroUnidades(req, 'av.unidade_id', selecionadas, p);
  const acoes = await consultar(
    `SELECT av.id, av.data_acao, un.sigla, av.instituicao_local, av.endereco, av.status, av.qtd_participantes, ta.nome AS tipo
       FROM acao_visita av JOIN unidade un ON un.id = av.unidade_id JOIN tipo_acao ta ON ta.id = av.tipo_acao_id
      WHERE ${w} AND av.data_acao BETWEEN @ini AND @fim
      ORDER BY av.data_acao, av.id`, p);
  p = { ini: [tipos.Date, dataInicio], fim: [tipos.Date, dataFim] };
  w = filtroUnidades(req, 'av.unidade_id', selecionadas, p);
  const temas = await consultar(
    `SELECT t.acao_visita_id, tm.nome FROM acao_visita_tema t
       JOIN tema tm ON tm.id = t.tema_id JOIN acao_visita av ON av.id = t.acao_visita_id
      WHERE ${w} AND av.data_acao BETWEEN @ini AND @fim ORDER BY t.acao_visita_id, t.ordem`, p);
  return acoes.map((a) => ({
    ...a,
    temas: temas.filter((t) => t.acaoVisitaId === a.id).map((t) => t.nome),
  }));
}

module.exports = {
  lerIds, resolverEscopo, filtroUnidades,
  listarAcompanhamentos, carregarIndividual,
  coletarSemestral, consolidar,
  carregarFotoDoUsuario, caminhoFoto,
  resumoMensal, listaAcoes,
};
