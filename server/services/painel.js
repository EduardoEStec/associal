'use strict';

// Agregações do Painel do Coordenador (e resumo da tela inicial).
// Todas as consultas passam por clausulaUnidades — inclusive para COORDENADOR/ADMIN.
//
// Fórmulas (equivalentes à aba BS_ATENDIMENTO do Excel de controle):
//   TOTAL ATENDIMENTO   = atendimentos + participantes das ações realizadas   (Excel: =SUM(E;G))
//   % ENCAMINHAMENTOS   = atendimentos / TOTAL ATENDIMENTO                       (Excel: =E/I; decisão do gerente:
//   manter a conta do Excel, igual ao histórico). "atendimentosComEncaminhamento" é informativo.

const { consultar } = require('../db');
const { tipos } = require('../db');
const { clausulaUnidades, unidadesPermitidas } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { normalizarData, inteiroPositivo } = require('../lib/validacao');
const contato = require('./acompanhamento-contato');

const MAX_DIAS_PERIODO = 366 * 5;
const MAX_MESES_EVOLUCAO = 60;

// ---------- datas ----------

const p2 = (n) => String(n).padStart(2, '0');

// Data de hoje no fuso de São Paulo, 'AAAA-MM-DD' (o servidor pode rodar em UTC).
function hojeBrasil(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
  return partes; // en-CA => AAAA-MM-DD
}

function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function limitesDoMes(ano, mes) {
  return { inicio: `${ano}-${p2(mes)}-01`, fim: `${ano}-${p2(mes)}-${p2(ultimoDiaDoMes(ano, mes))}` };
}

// Lê ?ano=&mes= ou ?inicio=&fim= (padrão: mês corrente). Valida e devolve { inicio, fim }.
function lerPeriodo(query, hoje = hojeBrasil()) {
  const problemas = {};
  let inicio;
  let fim;

  if (query.inicio || query.fim) {
    inicio = normalizarData(query.inicio);
    fim = normalizarData(query.fim);
    if (!inicio) problemas.inicio = 'Informe uma data inicial válida.';
    if (!fim) problemas.fim = 'Informe uma data final válida.';
  } else if (query.ano || query.mes) {
    const ano = Number(query.ano || hoje.slice(0, 4));
    const mes = Number(query.mes || hoje.slice(5, 7));
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) problemas.ano = 'Ano inválido.';
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) problemas.mes = 'Mês inválido.';
    if (!problemas.ano && !problemas.mes) ({ inicio, fim } = limitesDoMes(ano, mes));
  } else {
    ({ inicio, fim } = limitesDoMes(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))));
  }

  if (!Object.keys(problemas).length) {
    if (inicio > fim) problemas.fim = 'A data final deve ser igual ou posterior à inicial.';
    else if ((Date.parse(fim) - Date.parse(inicio)) / 86400000 > MAX_DIAS_PERIODO) {
      problemas.fim = 'Período muito longo (máximo de 5 anos).';
    }
  }
  if (Object.keys(problemas).length) throw erros.validacao(problemas);
  return { inicio, fim };
}

// Filtro opcional ?unidadeId= : precisa estar entre as unidades permitidas (senão 403).
function lerUnidadeFiltro(req) {
  const bruto = req.query.unidadeId;
  if (bruto === undefined || bruto === null || bruto === '') return null;
  const id = inteiroPositivo(bruto);
  if (!id) throw erros.validacao({ unidadeId: 'Unidade inválida.' });
  if (!unidadesPermitidas(req).includes(id)) throw erros.proibido('Você não tem acesso a esta unidade.');
  return id;
}

// Monta WHERE de unidade (+ filtro opcional) para uma coluna.
function filtroUnidade(req, coluna, params, unidadeId) {
  let where = clausulaUnidades(req, coluna, params);
  if (unidadeId) {
    where += ` AND ${coluna} = @unidadeFiltro`;
    params.unidadeFiltro = unidadeId;
  }
  return where;
}

const dataParam = (iso) => [tipos.Date, iso];

// ---------- indicadores ----------

const razao = (a, b) => (b > 0 ? a / b : null);

function completarLinha(l) {
  const atendimentos = l.atendimentos || 0;
  const participantes = l.participantes || 0;
  const totalAtendimento = atendimentos + participantes;
  return {
    ...l,
    atendimentos,
    atendimentosComEncaminhamento: l.atendimentosComEncaminhamento || 0,
    acoes: l.acoes || 0,
    participantes,
    familiasAcompanhadas: l.familiasAcompanhadas || 0,
    totalAtendimento,
    pctEncaminhamentos: razao(atendimentos, totalAtendimento), // igual ao Excel: =E/I (E = atendimentos)
  };
}

// Indicadores por unidade no período + total. `unidadeId` opcional restringe a uma unidade.
async function indicadoresPorUnidade(req, { inicio, fim }, unidadeId = null) {
  const base = { inicio: dataParam(inicio), fim: dataParam(fim) };

  const pUn = {};
  const whereUn = filtroUnidade(req, 'u.id', pUn, unidadeId);
  const unidades = await consultar(
    `SELECT u.id AS unidade_id, u.sigla, u.nome FROM unidade u WHERE u.ativo = 1 AND ${whereUn} ORDER BY u.ordem, u.nome`,
    pUn,
  );

  const pAt = { ...base };
  const whereAt = filtroUnidade(req, 'a.unidade_id', pAt, unidadeId);
  const atendimentos = await consultar(
    `SELECT a.unidade_id,
            COUNT(*) AS atendimentos,
            SUM(enc.tem) AS atendimentos_com_encaminhamento
       FROM atendimento a
      -- SQL Server não aceita subconsulta dentro de SUM(): calcula o indicador por linha antes
      OUTER APPLY (SELECT CASE WHEN EXISTS (SELECT 1 FROM atendimento_encaminhamento ae WHERE ae.atendimento_id = a.id)
                               THEN 1 ELSE 0 END AS tem) enc
      WHERE a.data_atendimento BETWEEN @inicio AND @fim AND ${whereAt}
      GROUP BY a.unidade_id`,
    pAt,
  );

  const pAc = { ...base };
  const whereAc = filtroUnidade(req, 'v.unidade_id', pAc, unidadeId);
  const acoes = await consultar(
    `SELECT v.unidade_id, COUNT(*) AS acoes, SUM(ISNULL(v.qtd_participantes, 0)) AS participantes
       FROM acao_visita v
      WHERE v.status = 'REALIZADA' AND v.data_acao BETWEEN @inicio AND @fim AND ${whereAc}
      GROUP BY v.unidade_id`,
    pAc,
  );

  // Família acompanhada = acompanhamento ativo em algum momento do período.
  const pFa = { ...base };
  const whereFa = filtroUnidade(req, 'ac.unidade_id', pFa, unidadeId);
  const familias = await consultar(
    `SELECT ac.unidade_id, COUNT(DISTINCT ac.familia_id) AS familias_acompanhadas
       FROM acompanhamento ac
      WHERE ac.data_inicio <= @fim
        AND (ac.status = 'EM_ANDAMENTO' OR ac.data_encerramento >= @inicio)
        AND ${whereFa}
      GROUP BY ac.unidade_id`,
    pFa,
  );

  const mapa = new Map(unidades.map((u) => [u.unidadeId, { ...u }]));
  const somar = (linhas) => {
    for (const l of linhas) {
      const alvo = mapa.get(l.unidadeId);
      if (!alvo) continue;
      for (const [k, v] of Object.entries(l)) if (k !== 'unidadeId') alvo[k] = Number(v) || 0;
    }
  };
  somar(atendimentos); somar(acoes); somar(familias);

  const linhas = [...mapa.values()].map(completarLinha);
  const soma = (campo) => linhas.reduce((s, l) => s + l[campo], 0);
  const total = completarLinha({
    atendimentos: soma('atendimentos'),
    atendimentosComEncaminhamento: soma('atendimentosComEncaminhamento'),
    acoes: soma('acoes'),
    participantes: soma('participantes'),
    familiasAcompanhadas: soma('familiasAcompanhadas'), // soma por unidade (famílias não se repetem entre unidades ativas)
  });
  return { periodo: { inicio, fim }, unidades: linhas, total };
}

// Série mensal dos indicadores (todas as unidades permitidas ou uma só).
async function evolucaoMensal(req, { inicio, fim }, unidadeId = null) {
  const meses = [];
  let [a, m] = inicio.split('-').map(Number);
  const [af, mf] = fim.split('-').map(Number);
  while (a < af || (a === af && m <= mf)) {
    meses.push({ ano: a, mes: m, ...limitesDoMes(a, m) });
    m += 1; if (m > 12) { m = 1; a += 1; }
    if (meses.length > MAX_MESES_EVOLUCAO) throw erros.validacao({ fim: 'Período muito longo para a evolução (máximo de 60 meses).' });
  }
  const base = { inicio: dataParam(inicio), fim: dataParam(fim) };

  const pAt = { ...base };
  const whereAt = filtroUnidade(req, 'a.unidade_id', pAt, unidadeId);
  const atendimentos = await consultar(
    `SELECT YEAR(a.data_atendimento) AS ano, MONTH(a.data_atendimento) AS mes, COUNT(*) AS atendimentos,
            SUM(enc.tem) AS atendimentos_com_encaminhamento
       FROM atendimento a
      OUTER APPLY (SELECT CASE WHEN EXISTS (SELECT 1 FROM atendimento_encaminhamento ae WHERE ae.atendimento_id = a.id)
                               THEN 1 ELSE 0 END AS tem) enc
      WHERE a.data_atendimento BETWEEN @inicio AND @fim AND ${whereAt}
      GROUP BY YEAR(a.data_atendimento), MONTH(a.data_atendimento)`,
    pAt,
  );
  const pAc = { ...base };
  const whereAc = filtroUnidade(req, 'v.unidade_id', pAc, unidadeId);
  const acoes = await consultar(
    `SELECT YEAR(v.data_acao) AS ano, MONTH(v.data_acao) AS mes, COUNT(*) AS acoes,
            SUM(ISNULL(v.qtd_participantes, 0)) AS participantes
       FROM acao_visita v
      WHERE v.status = 'REALIZADA' AND v.data_acao BETWEEN @inicio AND @fim AND ${whereAc}
      GROUP BY YEAR(v.data_acao), MONTH(v.data_acao)`,
    pAc,
  );
  // Famílias: uma consulta por mês seria cara; contamos famílias com acompanhamento ativo no mês via
  // um único SELECT sobre os meses do período (tabela de meses em VALUES, parametrizada).
  const pFa = {};
  const whereFa = filtroUnidade(req, 'ac.unidade_id', pFa, unidadeId);
  const valores = meses.map((x, i) => {
    pFa[`mi${i}`] = dataParam(x.inicio); pFa[`mf${i}`] = dataParam(x.fim);
    return `(@mi${i}, @mf${i})`;
  }).join(', ');
  const familias = await consultar(
    `SELECT YEAR(mes.ini) AS ano, MONTH(mes.ini) AS mes, COUNT(DISTINCT ac.familia_id) AS familias_acompanhadas
       FROM (VALUES ${valores}) AS mes(ini, fim)
       JOIN acompanhamento ac ON ac.data_inicio <= mes.fim
        AND (ac.status = 'EM_ANDAMENTO' OR ac.data_encerramento >= mes.ini)
      WHERE ${whereFa}
      GROUP BY YEAR(mes.ini), MONTH(mes.ini)`,
    pFa,
  );

  const chave = (x) => `${x.ano}-${x.mes}`;
  const idx = new Map(meses.map((x) => [chave(x), { ano: x.ano, mes: x.mes }]));
  for (const conjunto of [atendimentos, acoes, familias]) {
    for (const l of conjunto) {
      const alvo = idx.get(chave(l));
      if (!alvo) continue;
      for (const [k, v] of Object.entries(l)) if (k !== 'ano' && k !== 'mes') alvo[k] = Number(v) || 0;
    }
  }
  return { periodo: { inicio, fim }, meses: [...idx.values()].map(completarLinha) };
}

// ---------- perfil do público ----------

// Dimensões de 1 valor por atendimento (nome da tabela de apoio vem de whitelist, nunca do usuário).
const DIMENSOES_SIMPLES = {
  faixaEtaria: { tabela: 'faixa_etaria', fk: 'a.faixa_etaria_id' },
  nivelVulnerabilidade: { tabela: 'nivel_vulnerabilidade', fk: 'a.nivel_vulnerabilidade_id' },
  genero: { tabela: 'genero', fk: 'p.genero_id' },
  escolaridade: { tabela: 'escolaridade', fk: 'p.escolaridade_id' },
  raca: { tabela: 'raca', fk: 'p.raca_id' },
};
// Dimensões múltiplas (N:N).
const DIMENSOES_MULTIPLAS = {
  vulnerabilidades: { tabela: 'vulnerabilidade', juncao: 'atendimento_vulnerabilidade', colJuncao: 'vulnerabilidade_id' },
  demandas: { tabela: 'demanda', juncao: 'atendimento_demanda', colJuncao: 'demanda_id' },
  encaminhamentos: { tabela: 'encaminhamento', juncao: 'atendimento_encaminhamento', colJuncao: 'encaminhamento_id' },
};

// Distribuição do público atendido no período. Unidade de contagem: ATENDIMENTOS (não pessoas distintas).
async function perfilPublico(req, { inicio, fim }, unidadeId = null) {
  const base = { inicio: dataParam(inicio), fim: dataParam(fim) };
  const resultado = { periodo: { inicio, fim } };

  const p0 = { ...base };
  const where0 = filtroUnidade(req, 'a.unidade_id', p0, unidadeId);
  const [tot] = await consultar(
    `SELECT COUNT(*) AS total FROM atendimento a WHERE a.data_atendimento BETWEEN @inicio AND @fim AND ${where0}`, p0,
  );
  resultado.totalAtendimentos = Number(tot?.total) || 0;

  for (const [chave, d] of Object.entries(DIMENSOES_SIMPLES)) {
    const params = { ...base };
    const where = filtroUnidade(req, 'a.unidade_id', params, unidadeId);
    const linhas = await consultar(
      `SELECT t.id AS id, ISNULL(t.nome, N'Não informado') AS nome, COUNT(*) AS quantidade, MIN(t.ordem) AS ordem
         FROM atendimento a
         JOIN pessoa p ON p.id = a.pessoa_id
         LEFT JOIN ${d.tabela} t ON t.id = ${d.fk}
        WHERE a.data_atendimento BETWEEN @inicio AND @fim AND ${where}
        GROUP BY t.id, t.nome
        ORDER BY CASE WHEN t.id IS NULL THEN 1 ELSE 0 END, MIN(t.ordem), t.nome`,
      params,
    );
    resultado[chave] = linhas.map((l) => ({ id: l.id, nome: l.nome, quantidade: Number(l.quantidade) || 0 }));
  }

  for (const [chave, d] of Object.entries(DIMENSOES_MULTIPLAS)) {
    const params = { ...base };
    const where = filtroUnidade(req, 'a.unidade_id', params, unidadeId);
    const linhas = await consultar(
      `SELECT t.id AS id, t.nome AS nome, COUNT(*) AS quantidade
         FROM atendimento a
         JOIN ${d.juncao} j ON j.atendimento_id = a.id
         JOIN ${d.tabela} t ON t.id = j.${d.colJuncao}
        WHERE a.data_atendimento BETWEEN @inicio AND @fim AND ${where}
        GROUP BY t.id, t.nome, t.ordem
        ORDER BY COUNT(*) DESC, t.ordem, t.nome`,
      params,
    );
    resultado[chave] = linhas.map((l) => ({ id: l.id, nome: l.nome, quantidade: Number(l.quantidade) || 0 }));
  }
  return resultado;
}

// ---------- alertas ----------

async function lerConfigNumero(chave, padrao) {
  const [l] = await consultar('SELECT valor FROM configuracao WHERE chave = @chave', { chave });
  const n = Number(l?.valor);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

// Questionários finais pendentes (acompanhamento em andamento sem FINAL concluído) vencidos ou
// vencendo dentro da janela de aviso. Prazo = data_prevista_final ou data_inicio + prazo configurado.
async function questionariosFinaisPendentes(req, hoje = hojeBrasil(), unidadeId = null) {
  const prazo = await lerConfigNumero('prazo_questionario_final_dias', 90);
  const antes = await lerConfigNumero('alerta_questionario_final_dias_antes', 15);
  const params = { hoje: dataParam(hoje), prazo, antes };
  const where = filtroUnidade(req, 'ac.unidade_id', params, unidadeId);
  const linhas = await consultar(
    `SELECT ac.id AS acompanhamento_id, ac.familia_id, ac.unidade_id, un.sigla AS unidade_sigla,
            pe.nome AS responsavel_nome,
            COALESCE(ac.data_prevista_final, DATEADD(DAY, @prazo, ac.data_inicio)) AS data_limite,
            DATEDIFF(DAY, @hoje, COALESCE(ac.data_prevista_final, DATEADD(DAY, @prazo, ac.data_inicio))) AS dias_restantes
       FROM acompanhamento ac
       JOIN unidade un ON un.id = ac.unidade_id
       JOIN familia f ON f.id = ac.familia_id
       JOIN pessoa pe ON pe.id = f.responsavel_pessoa_id
      WHERE ac.status = 'EM_ANDAMENTO'
        AND NOT EXISTS (SELECT 1 FROM questionario q
                         WHERE q.acompanhamento_id = ac.id AND q.tipo = 'FINAL' AND q.concluido = 1)
        AND DATEDIFF(DAY, @hoje, COALESCE(ac.data_prevista_final, DATEADD(DAY, @prazo, ac.data_inicio))) <= @antes
        AND ${where}
      ORDER BY dias_restantes, un.sigla, pe.nome`,
    params,
  );
  return linhas.map((l) => ({
    ...l,
    diasRestantes: Number(l.diasRestantes),
    situacao: Number(l.diasRestantes) < 0 ? 'VENCIDO' : 'A_VENCER',
  }));
}

// Famílias em acompanhamento sem contato há mais de `alerta_sem_contato_dias` (regra em acompanhamento-contato.js).
async function familiasSemContato(req, hoje = hojeBrasil(), unidadeId = null) {
  const limite = await lerConfigNumero('alerta_sem_contato_dias', contato.LIMITE_PADRAO_DIAS);
  const params = { hoje: dataParam(hoje), semContato: limite };
  const where = filtroUnidade(req, 'ac.unidade_id', params, unidadeId);
  const linhas = await consultar(
    `WITH base AS (
       SELECT ac.id AS acompanhamento_id, ac.unidade_id, un.sigla AS unidade_sigla, pe.nome AS responsavel_nome, ac.status,
              ${contato.sqlUltimoContato('ac', 'f')} AS ultimo_contato
         FROM acompanhamento ac
         JOIN unidade un ON un.id = ac.unidade_id
         JOIN familia f ON f.id = ac.familia_id
         JOIN pessoa pe ON pe.id = f.responsavel_pessoa_id
        WHERE ac.status = 'EM_ANDAMENTO' AND ${where})
     SELECT acompanhamento_id, unidade_id, unidade_sigla, responsavel_nome, ultimo_contato,
            DATEDIFF(DAY, ultimo_contato, @hoje) AS dias_sem_contato
       FROM base
      WHERE ${contato.SQL_SEM_CONTATO}
      ORDER BY dias_sem_contato DESC, unidade_sigla, responsavel_nome`,
    params,
  );
  return linhas.map((l) => ({ ...l, diasSemContato: Number(l.diasSemContato) }));
}

// Ações planejadas cuja data já passou sem atualização de status.
async function acoesDesatualizadas(req, hoje = hojeBrasil(), unidadeId = null) {
  const params = { hoje: dataParam(hoje) };
  const where = filtroUnidade(req, 'v.unidade_id', params, unidadeId);
  return consultar(
    `SELECT TOP (100) v.id AS acao_id, v.unidade_id, un.sigla AS unidade_sigla, v.data_acao,
            v.instituicao_local, DATEDIFF(DAY, v.data_acao, @hoje) AS dias_atraso
       FROM acao_visita v JOIN unidade un ON un.id = v.unidade_id
      WHERE v.status = 'PLANEJADA' AND v.data_acao < @hoje AND ${where}
      ORDER BY v.data_acao, un.sigla`,
    params,
  );
}

async function alertas(req, unidadeId = null) {
  const hoje = hojeBrasil();
  const [questionarios, acoes, semContato] = await Promise.all([
    questionariosFinaisPendentes(req, hoje, unidadeId),
    acoesDesatualizadas(req, hoje, unidadeId),
    familiasSemContato(req, hoje, unidadeId),
  ]);
  const porUnidade = new Map();
  const conta = (sigla, campo) => {
    const o = porUnidade.get(sigla) || { unidadeSigla: sigla, questionariosVencidos: 0, questionariosAVencer: 0, acoesDesatualizadas: 0, familiasSemContato: 0 };
    o[campo] += 1;
    porUnidade.set(sigla, o);
  };
  questionarios.forEach((q) => conta(q.unidadeSigla, q.situacao === 'VENCIDO' ? 'questionariosVencidos' : 'questionariosAVencer'));
  acoes.forEach((a) => conta(a.unidadeSigla, 'acoesDesatualizadas'));
  semContato.forEach((s) => conta(s.unidadeSigla, 'familiasSemContato'));
  return {
    hoje,
    resumoPorUnidade: [...porUnidade.values()].sort((a, b) => a.unidadeSigla.localeCompare(b.unidadeSigla)),
    questionariosFinais: questionarios,
    acoesDesatualizadas: acoes,
    familiasSemContato: semContato,
  };
}

// ---------- resumo da tela inicial (todos os perfis) ----------

async function resumoInicio(req) {
  const hoje = hojeBrasil();
  const periodo = limitesDoMes(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)));
  const [ind, pendentes, semContato] = await Promise.all([
    indicadoresPorUnidade(req, periodo),
    questionariosFinaisPendentes(req, hoje),
    familiasSemContato(req, hoje),
  ]);
  return {
    periodo,
    escopo: req.usuario.perfil === 'ASSISTENTE' ? 'UNIDADES_DO_USUARIO' : 'TODAS_AS_UNIDADES',
    total: ind.total,
    unidades: ind.unidades,
    pendentes: {
      vencidos: pendentes.filter((p) => p.situacao === 'VENCIDO').length,
      aVencer: pendentes.filter((p) => p.situacao === 'A_VENCER').length,
      itens: pendentes.slice(0, 10),
      semContato: semContato.length,
      semContatoItens: semContato.slice(0, 10),
    },
  };
}

module.exports = {
  hojeBrasil, limitesDoMes, lerPeriodo, lerUnidadeFiltro,
  indicadoresPorUnidade, evolucaoMensal, perfilPublico, alertas, resumoInicio,
  questionariosFinaisPendentes, acoesDesatualizadas, familiasSemContato,
};
