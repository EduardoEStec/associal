'use strict';

// Persistência do questionário familiar (INICIAL/REAVALIACAO/FINAL) e consultas de comparação.
// Dois formatos convivem: M1 (modelos oficiais; respostas em dbo.resposta_extra, regras em ./questionario-m1.js) e LEGADO
// (formato anterior, colunas fixas de dbo.questionario; regras em ./questionario.js). Questionário LEGADO concluído é só leitura.

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
const indice = require('./indice-dados');
const estado = require('./catalogo-estado');
const extras = require('./extras');
const m1 = require('./modelos-m1');
const qm1 = require('./questionario-m1');

// Campos de escolha fechada com opções configuráveis (colunas de dbo.questionario)
const CAMPOS_ESCOLHA = Object.keys(estado.ESCALAS);

const CAMPOS_DECIMAIS = new Set(['rendaMensalMedia', 'economiaMensalValor']);

function exigirTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (!TIPO_QUESTIONARIO.includes(t)) throw erros.naoEncontrado('Tipo de questionário inexistente. Use INICIAL, REAVALIACAO ou FINAL.');
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

// ---------- cabeçalho e bloqueios (comuns aos dois formatos) ----------

const ehLegado = (linha) => !!linha && linha.modelo !== 'M1';
const AVISO_LEGADO = 'Este questionário foi aplicado no formato anterior e agora é somente leitura.';

// Cabeçalho dos formulários em papel: unidade, assistente responsável, datas, meta e dados do responsável familiar.
async function cabecalhoDoAcompanhamento(ac) {
  const dados = await consultarUm(
    `SELECT un.nome AS unidade_nome, u.nome AS assistente_nome,
            p.nome AS resp_nome, p.cpf AS resp_cpf, p.nis AS resp_nis, p.telefone AS resp_telefone,
            p.endereco AS resp_endereco, p.bairro AS resp_bairro,
            (SELECT valor FROM configuracao WHERE chave = 'meta_projeto') AS meta
       FROM acompanhamento a
       JOIN unidade un ON un.id = a.unidade_id
       JOIN familia f ON f.id = a.familia_id
       JOIN pessoa p ON p.id = f.responsavel_pessoa_id
       LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE a.id = @id`, { id: ac.id });
  return {
    unidade: dados?.unidadeNome || null,
    assistente: dados?.assistenteNome || null,
    dataInicio: ac.dataInicio,
    dataPrevista: ac.dataPrevistaFinal || null,
    meta: dados?.meta || null,
    responsavel: {
      nome: dados?.respNome || null, cpf: dados?.respCpf || null, nis: dados?.respNis || null,
      telefone: dados?.respTelefone || null, endereco: [dados?.respEndereco, dados?.respBairro].filter(Boolean).join(' – ') || null,
    },
  };
}

// Bloqueio de edição por regra de fluxo (null = pode editar)
async function bloqueioDoFluxo(ac, tipo, linha) {
  let bloqueio = null;
  if (ac.status !== 'EM_ANDAMENTO') bloqueio = 'Acompanhamento encerrado: o questionário não pode mais ser alterado.';
  else if (tipo === 'FINAL') {
    const inicial = await carregarLinha({ consultarUm }, ac.id, 'INICIAL');
    if (!inicial || !inicial.concluido) bloqueio = 'Conclua o questionário inicial antes de aplicar o final.';
  } else if (tipo === 'REAVALIACAO') {
    const inicial = await carregarLinha({ consultarUm }, ac.id, 'INICIAL');
    const final = await carregarLinha({ consultarUm }, ac.id, 'FINAL');
    if (!inicial || !inicial.concluido) bloqueio = 'Conclua o questionário inicial antes de aplicar a reavaliação.';
    else if (!linha && final && final.concluido) bloqueio = 'O questionário final já foi concluído: a reavaliação não é mais necessária.';
  }
  if (!bloqueio && ehLegado(linha) && linha.concluido) bloqueio = AVISO_LEGADO;
  return bloqueio;
}

// ---------- leitura ----------

async function obter(req, acompanhamentoId, tipoEntrada) {
  const tipo = exigirTipo(tipoEntrada);
  const ac = await carregarAcompanhamento(req, acompanhamentoId);
  const linha = await carregarLinha({ consultarUm }, ac.id, tipo);
  if (!ehLegado(linha)) return obterM1(req, ac, tipo, linha);
  return obterLegado(req, ac, tipo, linha);
}

// M1: respostas por código de pergunta (oficiais e adicionais), complementos ("Outras: ...") e a lista legível para o detalhe.
async function obterM1(req, ac, tipo, linha) {
  const formulario = m1.formularioDoTipo(tipo);
  const bloqueio = await bloqueioDoFluxo(ac, tipo, linha);
  const lidas = linha ? await extras.carregarRespostas({ consultar }, formulario, linha.id, { tipoQuestionario: tipo }) : { mapa: {}, detalhes: {}, lista: [] };
  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM familia_membro WHERE familia_id = @f', { f: ac.familiaId });
  const codigosDoTipo = new Set(qm1.perguntasDoTipo(tipo).map((p) => p.codigo));
  return {
    acompanhamentoId: ac.id,
    tipo,
    modelo: 'M1',
    existe: !!linha,
    id: linha ? linha.id : null,
    concluido: linha ? !!linha.concluido : false,
    dataAplicacao: linha ? linha.dataAplicacao : null,
    respostas: lidas.mapa,
    detalhes: lidas.detalhes,
    respostasLegiveis: lidas.lista.filter((x) => codigosDoTipo.has(x.codigo) || !x.ativa),
    cabecalho: await cabecalhoDoAcompanhamento(ac),
    sugestoes: { dataAplicacao: hojeIso(), qtdIntegrantes: total + 1 },
    podeEditar: bloqueio === null,
    bloqueio,
  };
}

async function obterLegado(req, ac, tipo, linha) {
  const selecoes = await carregarSelecoes({ consultar }, linha?.id);

  let bloqueio = null;
  if (ac.status !== 'EM_ANDAMENTO') bloqueio = 'Acompanhamento encerrado: o questionário não pode mais ser alterado.';
  else if (tipo === 'FINAL') {
    const inicial = await carregarLinha({ consultarUm }, ac.id, 'INICIAL');
    if (!inicial || !inicial.concluido) bloqueio = 'Conclua o questionário inicial antes de aplicar o final.';
  } else if (tipo === 'REAVALIACAO') {
    const inicial = await carregarLinha({ consultarUm }, ac.id, 'INICIAL');
    const final = await carregarLinha({ consultarUm }, ac.id, 'FINAL');
    if (!inicial || !inicial.concluido) bloqueio = 'Conclua o questionário inicial antes de aplicar a reavaliação.';
    else if (!linha && final && final.concluido) bloqueio = 'O questionário final já foi concluído: a reavaliação não é mais necessária.';
  }

  if (!bloqueio && linha && linha.concluido) bloqueio = AVISO_LEGADO;

  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM familia_membro WHERE familia_id = @f', { f: ac.familiaId });
  // perguntas extras (P2): a reavaliação rápida não tem
  const adicionais = tipo === 'REAVALIACAO' ? { mapa: {}, lista: [] }
    : await extras.carregarRespostas({ consultar }, 'QUESTIONARIO', linha?.id, { tipoQuestionario: tipo });
  return {
    acompanhamentoId: ac.id,
    tipo,
    modelo: 'LEGADO',
    existe: !!linha,
    id: linha ? linha.id : null,
    concluido: linha ? !!linha.concluido : false,
    dataAplicacao: linha ? linha.dataAplicacao : null,
    respostas: montarRespostas(linha, selecoes.beneficioIds, selecoes.destinoEconomiaIds),
    extras: adicionais.mapa,
    respostasExtras: adicionais.lista,
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
  const ac = await carregarAcompanhamento(req, acompanhamentoId);
  const linha = await carregarLinha({ consultarUm }, ac.id, tipo);
  if (ehLegado(linha)) {
    if (linha.concluido) throw erros.conflito(AVISO_LEGADO);
    await salvarLegado(req, acompanhamentoId, tipo, corpo);
  } else {
    await salvarM1(req, acompanhamentoId, tipo, corpo);
  }
  return obter(req, acompanhamentoId, tipo);
}

// M1: valida as respostas contra o catálogo (oficiais e adicionais), grava em resposta_extra e atualiza o índice de progresso.
async function salvarM1(req, acompanhamentoId, tipo, corpo) {
  const concluirPedido = corpo?.concluir === true;
  const hoje = hojeIso();
  const formulario = m1.formularioDoTipo(tipo);

  await transacao(async (tx) => {
    const ac = await carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    exigirEmAndamento(ac);

    let inicial = null;
    if (tipo === 'FINAL' || tipo === 'REAVALIACAO') {
      inicial = await carregarLinha(tx, ac.id, 'INICIAL');
      if (!inicial || !inicial.concluido) {
        throw erros.conflito(tipo === 'FINAL'
          ? 'Conclua o questionário inicial antes de aplicar o final.'
          : 'Conclua o questionário inicial antes de aplicar a reavaliação.');
      }
    }
    const existente = await carregarLinha(tx, ac.id, tipo);
    if (tipo === 'REAVALIACAO' && !existente) {
      const final = await carregarLinha(tx, ac.id, 'FINAL');
      if (final && final.concluido) throw erros.conflito('O questionário final já foi concluído: a reavaliação não é mais necessária.');
    }
    // Questionário já concluído continua válido: só aceita nova versão completa.
    const concluir = concluirPedido || !!(existente && existente.concluido);

    const problemas = {};
    const data = normalizarData(corpo?.dataAplicacao || hoje);
    if (data === undefined) problemas.dataAplicacao = 'Informe uma data válida.';
    else if (data > hoje) problemas.dataAplicacao = 'A data de aplicação não pode ser futura.';
    else if (inicial && data < new Date(inicial.dataAplicacao).toISOString().slice(0, 10)) {
      problemas.dataAplicacao = `A data do questionário ${tipo === 'FINAL' ? 'final' : 'de reavaliação'} não pode ser anterior à do inicial.`;
    }

    // `respostas` ausente = não mexe nas respostas gravadas; para exigir as obrigatórias vale o que já está gravado
    const defs = qm1.perguntasDoTipo(tipo);
    const informado = corpo?.respostas !== undefined;
    const gravadas = await extras.carregarRespostas(tx, formulario, existente?.id);
    const entrada = informado ? corpo.respostas : gravadas.mapa;
    const detalhes = informado ? corpo.detalhes || {} : gravadas.detalhes;
    const atuais = await extras.opcoesAtuais(tx, formulario, existente?.id);
    const validado = extras.validarExtras(defs, entrada, { concluir, atuais, detalhes });
    Object.assign(problemas, validado.erros);
    if (informado && !validado.erros.extras) Object.assign(problemas, qm1.validarRegrasM1(tipo, { ...gravadas.mapa, ...entrada }));
    lancarSeErros(problemas);

    let questionarioId;
    if (existente) {
      questionarioId = existente.id;
      await tx.consultar(
        `UPDATE questionario SET data_aplicacao = @data, concluido = @concluido, alterado_por = @usuario, alterado_em = SYSUTCDATETIME() WHERE id = @id`,
        { id: existente.id, data: [tipos.Date, data], concluido: concluir, usuario: req.usuario.id });
    } else {
      const [novo] = await tx.consultar(
        `INSERT INTO questionario (acompanhamento_id, tipo, data_aplicacao, concluido, modelo, criado_por)
         OUTPUT INSERTED.id VALUES (@ac, @tipo, @data, @concluido, 'M1', @usuario)`,
        { ac: ac.id, tipo, data: [tipos.Date, data], concluido: concluir, usuario: req.usuario.id });
      questionarioId = novo.id;
    }
    if (informado) await extras.gravarExtras(tx, formulario, questionarioId, validado);

    // instantâneo do índice de progresso (F5, regra v2): refeito a cada gravação de um questionário concluído
    if (concluir) {
      const { mapa } = await extras.carregarRespostas(tx, formulario, questionarioId);
      await indice.gravarInstantaneo(tx, { acompanhamentoId: ac.id, questionarioId, tipo, dataRef: data, respostas: { modelo: 'M1', mapa } });
    }
    await registrarAuditoria(req, existente ? 'ALTERAR' : 'CRIAR', 'questionario', questionarioId, { acompanhamentoId: ac.id, tipo, modelo: 'M1', concluido: concluir }, tx);
  });
}

async function salvarLegado(req, acompanhamentoId, tipo, corpo) {
  const concluirPedido = corpo?.concluir === true;
  const hoje = hojeIso();

  await transacao(async (tx) => {
    const ac = await carregarAcompanhamento(req, acompanhamentoId, tx, { travar: true });
    exigirEmAndamento(ac);

    let inicial = null;
    if (tipo === 'FINAL' || tipo === 'REAVALIACAO') {
      inicial = await carregarLinha(tx, ac.id, 'INICIAL');
      if (!inicial || !inicial.concluido) {
        throw erros.conflito(tipo === 'FINAL'
          ? 'Conclua o questionário inicial antes de aplicar o final.'
          : 'Conclua o questionário inicial antes de aplicar a reavaliação.');
      }
    }
    const existente = await carregarLinha(tx, ac.id, tipo);
    if (tipo === 'REAVALIACAO' && !existente) {
      const final = await carregarLinha(tx, ac.id, 'FINAL');
      if (final && final.concluido) throw erros.conflito('O questionário final já foi concluído: a reavaliação não é mais necessária.');
    }
    const selecaoAtual = await carregarSelecoes(tx, existente?.id);

    // Questionário já concluído continua válido: só aceita nova versão completa.
    const concluir = concluirPedido || !!(existente && existente.concluido);
    const { valores: v, beneficioIds, destinoEconomiaIds, erros: problemas } = validarRespostas(corpo, { concluir, hoje, tipo });

    if (inicial && v.dataAplicacao && v.dataAplicacao < new Date(inicial.dataAplicacao).toISOString().slice(0, 10)) {
      problemas.dataAplicacao = `A data do questionário ${tipo === 'FINAL' ? 'final' : 'de reavaliação'} não pode ser anterior à do inicial.`;
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

    // Opção desativada pela coordenação só continua valendo para quem já tinha respondido com ela
    for (const campo of CAMPOS_ESCOLHA) {
      if (!problemas[campo] && v[campo] && !estado.opcaoAtiva(campo, v[campo]) && v[campo] !== existente?.[campo]) {
        problemas[campo] = 'Esta opção não está mais disponível.';
      }
    }

    // Perguntas extras (P2). `extras` ausente no corpo = não mexe nas respostas; para exigir as obrigatórias vale o que já está gravado.
    const defsExtras = tipo === 'REAVALIACAO' ? [] : estado.extras('QUESTIONARIO');
    let extrasValidados = null;
    if (defsExtras.length) {
      const informado = corpo?.extras !== undefined;
      const entrada = informado ? corpo.extras : (await extras.carregarRespostas(tx, 'QUESTIONARIO', existente?.id, { tipoQuestionario: tipo })).mapa;
      const atuais = await extras.opcoesAtuais(tx, 'QUESTIONARIO', existente?.id);
      const r = extras.validarExtras(defsExtras, entrada, { concluir, atuais });
      Object.assign(problemas, r.erros);
      if (informado) extrasValidados = r;
    }

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

    if (extrasValidados) await extras.gravarExtras(tx, 'QUESTIONARIO', questionarioId, extrasValidados);

    // instantâneo do índice de progresso (F5): refeito a cada gravação de um questionário concluído
    if (concluir) await indice.gravarInstantaneo(tx, { acompanhamentoId: ac.id, questionarioId, tipo, dataRef: v.dataAplicacao, respostas: v });

    await registrarAuditoria(req, existente ? 'ALTERAR' : 'CRIAR', 'questionario', questionarioId,
      { acompanhamentoId: ac.id, tipo, concluido: concluir }, tx);
  });
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
  const resumoQ = (l) => ({ existe: !!l, concluido: !!(l && l.concluido), dataAplicacao: l ? l.dataAplicacao : null, modelo: l ? (l.modelo === 'M1' ? 'M1' : 'LEGADO') : null });
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
  if (ehLegado(linhaI) !== ehLegado(linhaF)) {
    return {
      ...base,
      completo: false,
      mista: true,
      motivo: 'Os questionários inicial e final foram aplicados em formatos diferentes (o inicial no formato anterior): '
        + 'a comparação por pares equivalentes não está disponível. Consulte as respostas de cada questionário.',
    };
  }
  if (!ehLegado(linhaI)) return { ...base, completo: true, modelo: 'M1', ...(await comparacaoM1(linhaI, linhaF)) };

  const [si, sf, apoio] = await Promise.all([
    carregarSelecoes({ consultar }, linhaI.id), carregarSelecoes({ consultar }, linhaF.id), nomesApoio(),
  ]);
  const inicial = montarRespostas(linhaI, si.beneficioIds, si.destinoEconomiaIds);
  const final = montarRespostas(linhaF, sf.beneficioIds, sf.destinoEconomiaIds);
  // perguntas extras: lado a lado (a comparação numérica/índice usa só as oficiais)
  const [ei, ef] = await Promise.all([
    extras.carregarRespostas({ consultar }, 'QUESTIONARIO', linhaI.id, { tipoQuestionario: 'INICIAL' }),
    extras.carregarRespostas({ consultar }, 'QUESTIONARIO', linhaF.id, { tipoQuestionario: 'FINAL' }),
  ]);
  const adicionais = juntarExtras(ei.lista, ef.lista);
  return { ...base, completo: true, modelo: 'LEGADO', ...compararFamilia(inicial, final, apoio), extras: adicionais };
}

// Comparação M1: pares equivalentes + perguntas comparativas do final + o restante de cada questionário + perguntas adicionais.
async function comparacaoM1(linhaI, linhaF) {
  const [ri, rf] = await Promise.all([
    extras.carregarRespostas({ consultar }, m1.FORMULARIO_INICIAL, linhaI.id, { tipoQuestionario: 'INICIAL' }),
    extras.carregarRespostas({ consultar }, m1.FORMULARIO_FINAL, linhaF.id, { tipoQuestionario: 'FINAL' }),
  ]);
  const comparado = qm1.compararPares({ mapa: ri.mapa, detalhes: ri.detalhes }, { mapa: rf.mapa, detalhes: rf.detalhes });
  const usadosI = new Set(m1.PARES.map((p) => p.inicial));
  const usadosF = new Set([...m1.PARES.map((p) => p.final), ...m1.COMPARATIVAS_FINAL.map((c) => c.codigo)]);
  const lista = (l, usados, extra) => l.filter((x) => (extra ? !x.oficial : x.oficial && !usados.has(x.codigo)))
    .map((x) => ({ codigo: x.codigo, pergunta: x.pergunta, resposta: x.resposta }));
  return {
    ...comparado,
    outras: { inicial: lista(ri.lista, usadosI, false), final: lista(rf.lista, usadosF, false) },
    extrasAdicionais: { inicial: lista(ri.lista, usadosI, true), final: lista(rf.lista, usadosF, true) },
  };
}

// Junta as respostas extras do inicial e do final por pergunta (a ordem é a do catálogo).
function juntarExtras(listaInicial, listaFinal) {
  const porCodigo = new Map();
  for (const x of listaInicial) porCodigo.set(x.codigo, { codigo: x.codigo, pergunta: x.pergunta, tipo: x.tipo, secao: x.secao, inicial: x.resposta, final: null });
  for (const x of listaFinal) {
    const atual = porCodigo.get(x.codigo) || { codigo: x.codigo, pergunta: x.pergunta, tipo: x.tipo, secao: x.secao, inicial: null };
    porCodigo.set(x.codigo, { ...atual, pergunta: x.pergunta, final: x.resposta });
  }
  return [...porCodigo.values()].sort((a, b) => a.secao - b.secao || a.codigo.localeCompare(b.codigo));
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
        WHERE q.concluido = 1 AND q.tipo IN ('INICIAL', 'FINAL') AND q.acompanhamento_id IN (${elegiveis})`, params),
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
  const linhasM1 = new Map();
  for (const l of linhas) {
    if (!porAcomp.has(l.acompanhamentoId)) porAcomp.set(l.acompanhamentoId, { unidadeId: l.unidadeId });
    const lado = l.tipo === 'INICIAL' ? 'inicial' : 'final';
    const par = porAcomp.get(l.acompanhamentoId);
    par[`modelo_${lado}`] = l.modelo === 'M1' ? 'M1' : 'LEGADO';
    if (l.modelo === 'M1') linhasM1.set(l.id, { acompanhamentoId: l.acompanhamentoId, lado });
    else par[lado] = montarRespostas(l, mapaB.get(l.id) || [], mapaD.get(l.id) || []);
  }
  const todos = [...porAcomp.values()];
  const pares = todos.filter((p) => p.modelo_inicial === 'LEGADO' && p.modelo_final === 'LEGADO');
  const mistos = todos.filter((p) => p.modelo_inicial && p.modelo_final && p.modelo_inicial !== p.modelo_final).length;

  // M1: respostas lidas de resposta_extra
  const paresM1 = [];
  if (linhasM1.size) {
    const idsPorLado = { inicial: [], final: [] };
    for (const [id, x] of linhasM1) idsPorLado[x.lado].push(id);
    const lidasI = await extras.linhasDeDonos({ consultar }, m1.FORMULARIO_INICIAL, idsPorLado.inicial);
    const lidasF = await extras.linhasDeDonos({ consultar }, m1.FORMULARIO_FINAL, idsPorLado.final);
    const respostasDe = (form, tipoQ, lidas, id) => {
      const { mapa, detalhes } = extras.formatarRespostas(form, lidas.get(id) || [], { tipoQuestionario: tipoQ });
      return { mapa, detalhes };
    };
    const idPorAcomp = new Map();
    for (const [id, x] of linhasM1) {
      if (!idPorAcomp.has(x.acompanhamentoId)) idPorAcomp.set(x.acompanhamentoId, {});
      idPorAcomp.get(x.acompanhamentoId)[x.lado] = id;
    }
    for (const [acId, ids] of idPorAcomp) {
      if (!ids.inicial || !ids.final) continue;
      paresM1.push({
        unidadeId: porAcomp.get(acId).unidadeId,
        inicial: respostasDe(m1.FORMULARIO_INICIAL, 'INICIAL', lidasI, ids.inicial),
        final: respostasDe(m1.FORMULARIO_FINAL, 'FINAL', lidasF, ids.final),
      });
    }
  }

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

  const m1Resultado = paresM1.length ? {
    ...qm1.consolidarM1(paresM1),
    porUnidade: [...new Set(paresM1.map((p) => p.unidadeId))].map((uid) => {
      const un = unidades.find((u) => u.id === uid);
      return { unidadeId: uid, sigla: un ? un.sigla : null, nome: un ? un.nome : null, totalFamilias: paresM1.filter((p) => p.unidadeId === uid).length };
    }).sort((a, b) => String(a.sigla).localeCompare(String(b.sigla), 'pt-BR')),
  } : null;
  return { periodo: { inicio, fim }, unidadeId, ...resultado, porUnidade, m1: m1Resultado, mistos };
}

module.exports = { obter, salvar, comparacaoFamilia, comparacaoConsolidada, exigirTipo, cabecalhoDoAcompanhamento, ehLegado };
