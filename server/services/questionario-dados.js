'use strict';

// Persistência do questionário familiar (INICIAL/FINAL) e consultas de comparação.
// Regras puras (modelo, validação, comparação) ficam em ./questionario.js.

const { consultar, consultarUm, transacao, tipos } = require('../db');
const { clausulaUnidades, exigirUnidade } = require('../middlewares/auth');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { normalizarData, inteiroPositivo, lancarSeErros } = require('../lib/validacao');
const { TIPO_QUESTIONARIO } = require('../lib/dominios');
const { carregarAcompanhamento, exigirEmAndamento, hojeIso } = require('./familias');
const {
  COLUNAS, validarRespostas, montarRespostas, compararFamilia, consolidarComparacao,
} = require('./questionario');

const CAMPOS_DECIMAIS = new Set(['rendaMensalMedia', 'economiaMensalValor']);

function exigirTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (!TIPO_QUESTIONARIO.includes(t)) throw erros.naoEncontrado('Tipo de questionário inexistente. Use INICIAL ou FINAL.');
  return t;
}

async function carregarLinha(executor, acompanhamentoId, tipo) {
  return executor.consultarUm(
    'SELECT * FROM questionario WHERE acompanhamento_id = @ac AND tipo = @tipo', { ac: acompanhamentoId, tipo });
}

async function carregarSelecoes(executor, questionarioId) {
  if (!questionarioId) return { beneficioIds: [], destinoEconomiaIds: [] };
  // em sequência: dentro de uma transação, duas consultas simultâneas na mesma conexão dão EREQINPROG
  const b = await executor.consultar('SELECT beneficio_id FROM questionario_beneficio WHERE questionario_id = @id ORDER BY beneficio_id', { id: questionarioId });
  const d = await executor.consultar('SELECT destino_economia_id FROM questionario_destino_economia WHERE questionario_id = @id ORDER BY destino_economia_id', { id: questionarioId });
  return { beneficioIds: b.map((x) => x.beneficioId), destinoEconomiaIds: d.map((x) => x.destinoEconomiaId) };
}

// ---------- leitura ----------

async function obter(req, acompanhamentoId, tipoEntrada) {
  const tipo = exigirTipo(tipoEntrada);
  const ac = await carregarAcompanhamento(req, acompanhamentoId);
  const linha = await carregarLinha({ consultarUm }, ac.id, tipo);
  const selecoes = await carregarSelecoes({ consultar }, linha?.id);

  let bloqueio = null;
  if (ac.status !== 'EM_ANDAMENTO') bloqueio = 'Acompanhamento encerrado: o questionário não pode mais ser alterado.';
  else if (tipo === 'FINAL') {
    const inicial = await carregarLinha({ consultarUm }, ac.id, 'INICIAL');
    if (!inicial || !inicial.concluido) bloqueio = 'Conclua o questionário inicial antes de aplicar o final.';
  }

  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM familia_membro WHERE familia_id = @f', { f: ac.familiaId });
  return {
    acompanhamentoId: ac.id,
    tipo,
    existe: !!linha,
    id: linha ? linha.id : null,
    concluido: linha ? !!linha.concluido : false,
    dataAplicacao: linha ? linha.dataAplicacao : null,
    respostas: montarRespostas(linha, selecoes.beneficioIds, selecoes.destinoEconomiaIds),
    sugestoes: { dataAplicacao: hojeIso(), qtdMembrosFamilia: total + 1 },
    podeEditar: bloqueio === null,
    bloqueio,
  };
}

// ---------- gravação ----------

async function conferirOpcoes(tx, tabela, ids, jaSelecionados, campoErro, problemas) {
  if (ids.length === 0) return [];
  const params = {};
  const marcadores = ids.map((id, i) => { params[`i${i}`] = id; return `@i${i}`; });
  const linhas = await tx.consultar(`SELECT id, ativo, exige_texto FROM ${tabela} WHERE id IN (${marcadores.join(', ')})`, params);
  if (linhas.length !== ids.length) problemas[campoErro] = 'Opção inexistente.';
  else if (linhas.some((l) => !l.ativo && !jaSelecionados.includes(l.id))) problemas[campoErro] = 'Há uma opção que não está mais disponível.';
  return linhas;
}

async function salvar(req, acompanhamentoId, tipoEntrada, corpo) {
  const tipo = exigirTipo(tipoEntrada);
  const concluirPedido = corpo?.concluir === true;
  const hoje = hojeIso();

  await transacao(async (tx) => {
    const ac = await carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    exigirEmAndamento(ac);

    let inicial = null;
    if (tipo === 'FINAL') {
      inicial = await carregarLinha(tx, ac.id, 'INICIAL');
      if (!inicial || !inicial.concluido) {
        throw erros.conflito('Conclua o questionário inicial antes de aplicar o final.');
      }
    }
    const existente = await carregarLinha(tx, ac.id, tipo);
    const selecaoAtual = await carregarSelecoes(tx, existente?.id);

    // Questionário já concluído continua válido: só aceita nova versão completa.
    const concluir = concluirPedido || !!(existente && existente.concluido);
    const { valores: v, beneficioIds, destinoEconomiaIds, erros: problemas } = validarRespostas(corpo, { concluir, hoje });

    if (inicial && v.dataAplicacao && v.dataAplicacao < new Date(inicial.dataAplicacao).toISOString().slice(0, 10)) {
      problemas.dataAplicacao = 'A data do questionário final não pode ser anterior à do inicial.';
    }

    // Auxílio só faz sentido quando a família recebe
    const idsBeneficio = v.recebeAuxilio === false ? [] : beneficioIds;
    const beneficios = await conferirOpcoes(tx, 'beneficio', idsBeneficio, selecaoAtual.beneficioIds, 'beneficioIds', problemas);
    const destinos = await conferirOpcoes(tx, 'destino_economia', destinoEconomiaIds, selecaoAtual.destinoEconomiaIds, 'destinoEconomiaIds', problemas);

    const pedeOutroAuxilio = beneficios.some((b) => b.exigeTexto);
    if (!pedeOutroAuxilio) v.auxilioOutro = null;
    else if (concluir && !v.auxilioOutro && !problemas.auxilioOutro) problemas.auxilioOutro = 'Informe qual é o outro auxílio.';
    const pedeOutroDestino = destinos.some((d) => d.exigeTexto);
    if (!pedeOutroDestino) v.destinoEconomiaOutro = null;
    else if (concluir && !v.destinoEconomiaOutro && !problemas.destinoEconomiaOutro) problemas.destinoEconomiaOutro = 'Informe qual é o outro destino da economia.';

    lancarSeErros(problemas);

    // Colunas escalares (nomes vêm da constante COLUNAS, nunca da entrada)
    const params = { ac: ac.id, tipo, usuario: req.usuario.id, dataAplicacao: [tipos.Date, v.dataAplicacao], concluido: concluir };
    const campos = Object.keys(COLUNAS);
    for (const campo of campos) {
      params[campo] = CAMPOS_DECIMAIS.has(campo) ? [tipos.Decimal(10, 2), v[campo]] : v[campo];
    }

    let questionarioId;
    if (existente) {
      questionarioId = existente.id;
      const sets = campos.map((c) => `${COLUNAS[c]} = @${c}`).join(', ');
      await tx.consultar(
        `UPDATE questionario SET data_aplicacao = @dataAplicacao, concluido = @concluido, ${sets},
                alterado_por = @usuario, alterado_em = SYSUTCDATETIME()
          WHERE id = @id`,
        { ...params, id: existente.id });
    } else {
      const colunas = campos.map((c) => COLUNAS[c]).join(', ');
      const valores = campos.map((c) => `@${c}`).join(', ');
      const [novo] = await tx.consultar(
        `INSERT INTO questionario (acompanhamento_id, tipo, data_aplicacao, concluido, ${colunas}, criado_por)
         OUTPUT INSERTED.id
         VALUES (@ac, @tipo, @dataAplicacao, @concluido, ${valores}, @usuario)`,
        params);
      questionarioId = novo.id;
    }

    await tx.consultar('DELETE FROM questionario_beneficio WHERE questionario_id = @id', { id: questionarioId });
    for (const id of idsBeneficio) {
      await tx.consultar('INSERT INTO questionario_beneficio (questionario_id, beneficio_id) VALUES (@q, @b)', { q: questionarioId, b: id });
    }
    await tx.consultar('DELETE FROM questionario_destino_economia WHERE questionario_id = @id', { id: questionarioId });
    for (const id of destinoEconomiaIds) {
      await tx.consultar('INSERT INTO questionario_destino_economia (questionario_id, destino_economia_id) VALUES (@q, @d)', { q: questionarioId, d: id });
    }

    await registrarAuditoria(req, existente ? 'ALTERAR' : 'CRIAR', 'questionario', questionarioId,
      { acompanhamentoId: ac.id, tipo, concluido: concluir }, tx);
  });

  return obter(req, acompanhamentoId, tipo);
}

// ---------- comparação ----------

async function nomesApoio() {
  const [b, d] = await Promise.all([
    consultar('SELECT id, nome FROM beneficio'),
    consultar('SELECT id, nome FROM destino_economia'),
  ]);
  return {
    beneficio: Object.fromEntries(b.map((x) => [x.id, x.nome])),
    destino_economia: Object.fromEntries(d.map((x) => [x.id, x.nome])),
  };
}

async function comparacaoFamilia(req, acompanhamentoId) {
  const ac = await carregarAcompanhamento(req, acompanhamentoId);
  const familia = await consultarUm(
    'SELECT p.nome FROM familia f JOIN pessoa p ON p.id = f.responsavel_pessoa_id WHERE f.id = @f', { f: ac.familiaId });
  const [linhaI, linhaF] = await Promise.all([
    carregarLinha({ consultarUm }, ac.id, 'INICIAL'),
    carregarLinha({ consultarUm }, ac.id, 'FINAL'),
  ]);
  const resumoQ = (l) => ({ existe: !!l, concluido: !!(l && l.concluido), dataAplicacao: l ? l.dataAplicacao : null });
  const base = {
    acompanhamentoId: ac.id,
    status: ac.status,
    responsavel: { nome: familia ? familia.nome : null },
    inicial: resumoQ(linhaI),
    final: resumoQ(linhaF),
  };
  if (!linhaI?.concluido || !linhaF?.concluido) {
    return {
      ...base,
      completo: false,
      motivo: !linhaI?.concluido
        ? 'O questionário inicial ainda não foi concluído.'
        : 'O questionário final ainda não foi concluído.',
    };
  }
  const [si, sf, apoio] = await Promise.all([
    carregarSelecoes({ consultar }, linhaI.id), carregarSelecoes({ consultar }, linhaF.id), nomesApoio(),
  ]);
  const inicial = montarRespostas(linhaI, si.beneficioIds, si.destinoEconomiaIds);
  const final = montarRespostas(linhaF, sf.beneficioIds, sf.destinoEconomiaIds);
  return { ...base, completo: true, ...compararFamilia(inicial, final, apoio) };
}

async function comparacaoConsolidada(req, consulta) {
  const problemas = {};
  const inicio = normalizarData(consulta.inicio);
  if (inicio === undefined) problemas.inicio = 'Data inválida (use AAAA-MM-DD).';
  const fim = normalizarData(consulta.fim);
  if (fim === undefined) problemas.fim = 'Data inválida (use AAAA-MM-DD).';
  if (inicio && fim && inicio > fim) problemas.fim = 'A data final deve ser igual ou posterior à inicial.';
  lancarSeErros(problemas);

  const params = {};
  const filtros = [clausulaUnidades(req, 'ac.unidade_id', params)];
  let unidadeId = null;
  if (consulta.unidadeId !== undefined && consulta.unidadeId !== '') {
    unidadeId = inteiroPositivo(consulta.unidadeId);
    if (!unidadeId) throw erros.validacao({ unidadeId: 'Unidade inválida.' });
    exigirUnidade(req, unidadeId);
    filtros.push('ac.unidade_id = @unidadeFiltro');
    params.unidadeFiltro = unidadeId;
  }
  // O período refere-se à data de aplicação do questionário FINAL.
  if (inicio) { filtros.push('qf.data_aplicacao >= @inicio'); params.inicio = [tipos.Date, inicio]; }
  if (fim) { filtros.push('qf.data_aplicacao <= @fim'); params.fim = [tipos.Date, fim]; }

  const elegiveis = `
    SELECT ac.id FROM acompanhamento ac
      JOIN questionario qi ON qi.acompanhamento_id = ac.id AND qi.tipo = 'INICIAL' AND qi.concluido = 1
      JOIN questionario qf ON qf.acompanhamento_id = ac.id AND qf.tipo = 'FINAL' AND qf.concluido = 1
     WHERE ${filtros.join(' AND ')}`;

  const [linhas, benef, dest, apoio, unidades] = await Promise.all([
    consultar(
      `SELECT q.*, ac.unidade_id FROM questionario q JOIN acompanhamento ac ON ac.id = q.acompanhamento_id
        WHERE q.concluido = 1 AND q.acompanhamento_id IN (${elegiveis})`, params),
    consultar(`SELECT qb.questionario_id, qb.beneficio_id FROM questionario_beneficio qb
                 JOIN questionario q ON q.id = qb.questionario_id WHERE q.acompanhamento_id IN (${elegiveis})`, params),
    consultar(`SELECT qd.questionario_id, qd.destino_economia_id FROM questionario_destino_economia qd
                 JOIN questionario q ON q.id = qd.questionario_id WHERE q.acompanhamento_id IN (${elegiveis})`, params),
    nomesApoio(),
    consultar('SELECT id, sigla, nome FROM unidade'),
  ]);

  const idsPor = (lista, chave) => {
    const mapa = new Map();
    for (const x of lista) {
      if (!mapa.has(x.questionarioId)) mapa.set(x.questionarioId, []);
      mapa.get(x.questionarioId).push(x[chave]);
    }
    return mapa;
  };
  const mapaB = idsPor(benef, 'beneficioId');
  const mapaD = idsPor(dest, 'destinoEconomiaId');

  const porAcomp = new Map();
  for (const l of linhas) {
    if (!porAcomp.has(l.acompanhamentoId)) porAcomp.set(l.acompanhamentoId, { unidadeId: l.unidadeId });
    porAcomp.get(l.acompanhamentoId)[l.tipo === 'INICIAL' ? 'inicial' : 'final'] =
      montarRespostas(l, mapaB.get(l.id) || [], mapaD.get(l.id) || []);
  }
  const pares = [...porAcomp.values()].filter((p) => p.inicial && p.final);

  const resultado = consolidarComparacao(pares, apoio);

  const porUnidade = [];
  const idsUnidades = [...new Set(pares.map((p) => p.unidadeId))];
  for (const uid of idsUnidades) {
    const un = unidades.find((u) => u.id === uid);
    const parcial = consolidarComparacao(pares.filter((p) => p.unidadeId === uid), apoio);
    porUnidade.push({
      unidadeId: uid, sigla: un ? un.sigla : null, nome: un ? un.nome : null,
      totalFamilias: parcial.totalFamilias, destaques: parcial.destaques,
    });
  }
  porUnidade.sort((a, b) => String(a.sigla).localeCompare(String(b.sigla), 'pt-BR'));

  return { periodo: { inicio, fim }, unidadeId, ...resultado, porUnidade };
}

module.exports = { obter, salvar, comparacaoFamilia, comparacaoConsolidada, exigirTipo };
