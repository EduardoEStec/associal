'use strict';

// Edição do catálogo de perguntas e opções (P2/M1) pela coordenação e pelo ADMIN. Montado em /api/admin/perguntas (routes/admin.js).
// Formulários: QUESTIONARIO_INICIAL e QUESTIONARIO_FINAL (modelos oficiais M1), PESQUISA e ATENDIMENTO. QUESTIONARIO (formato
// anterior) só pode ser consultado e renomeado: não recebe perguntas novas.
// Regras:
//   - perguntas OFICIAIS só têm o texto (e a ajuda) renomeados; as opções oficiais são renomeadas, e a coordenação pode
//     ACRESCENTAR opções informando com qual opção oficial a nova "vale" no índice de progresso e na comparação (ou que não pontua);
//   - perguntas EXTRAS podem ser criadas, renomeadas, ativadas/desativadas, reordenadas e excluídas (só sem respostas);
//   - o código de pergunta e de opção NUNCA muda: renomear não afeta histórico, índice nem comparação;
//   - nada que tenha resposta é apagado: só se desativa. Toda mudança vai para a auditoria.

const { consultar, transacao } = require('../db');
const { erros } = require('../lib/erros');
const { registrarAuditoria } = require('../lib/auditoria');
const { texto, lancarSeErros, inteiroPositivo } = require('../lib/validacao');
const catalogo = require('./catalogo');
const estado = require('./catalogo-estado');
const { BLOCOS, COLUNAS } = require('./questionario');
const m1 = require('./modelos-m1');

const FORMULARIOS = estado.TODOS_FORMULARIOS;
const LEGADO = estado.FORMULARIO_LEGADO;
const TIPOS_EXTRA = Object.freeze(['TEXTO', 'NUMERO', 'SIM_NAO', 'ESCOLHA', 'MULTIPLA']);
const MIN_OPCOES_ATIVAS = 2;
const MAX_PERGUNTAS_POR_FORMULARIO = 60;
const MAX_OPCOES = 30;

const SECOES = Object.freeze({
  QUESTIONARIO: BLOCOS.map((b) => ({ numero: b.numero, titulo: b.titulo })),
  QUESTIONARIO_INICIAL: m1.SECOES.QUESTIONARIO_INICIAL,
  QUESTIONARIO_FINAL: m1.SECOES.QUESTIONARIO_FINAL,
  PESQUISA: [{ numero: 1, titulo: 'Perguntas da pesquisa' }],
  ATENDIMENTO: [{ numero: 1, titulo: 'Informações adicionais do atendimento' }],
});
const ROTULO_FORMULARIO = Object.freeze({
  QUESTIONARIO: 'Questionário (formato anterior)',
  QUESTIONARIO_INICIAL: 'Questionário inicial',
  QUESTIONARIO_FINAL: 'Questionário final',
  PESQUISA: 'Pesquisa de satisfação',
  ATENDIMENTO: 'Novo atendimento',
});

// Listas (tabelas de apoio) que alimentam as perguntas oficiais de múltipla escolha: editadas na aba Listas.
const APOIO_DA_PERGUNTA = Object.freeze({ destinoEconomiaIds: 'destino_economia', recebeAuxilio: 'beneficio' });

const ehVerdadeiro = (v) => v === true || v === 1 || v === '1' || v === 'true';

// ---------- leitura ----------

function exigirFormulario(valor, { paraCriar = false } = {}) {
  const f = String(valor || '').toUpperCase();
  if (!FORMULARIOS.includes(f)) throw erros.validacao({ formulario: 'Escolha o questionário inicial, o final, a pesquisa ou o atendimento.' });
  if (paraCriar && f === LEGADO) {
    throw erros.conflito('O questionário no formato anterior é somente leitura: acrescente a pergunta ao questionário inicial ou ao final.');
  }
  return f;
}

// Quantas respostas existem para cada código de uma coluna de escolha de dbo.questionario (nome da coluna vem de COLUNAS, nunca da entrada).
async function usoDasOpcoesOficiais(campo) {
  const coluna = COLUNAS[campo];
  if (!coluna) return new Map();
  const linhas = await consultar(`SELECT ${coluna} AS codigo, COUNT(*) AS n FROM questionario WHERE ${coluna} IS NOT NULL GROUP BY ${coluna}`);
  return new Map(linhas.map((l) => [l.codigo, l.n]));
}

// Estrutura para o editor: seções com perguntas (oficiais primeiro, depois extras na ordem escolhida) e suas opções.
async function listar(formularioEntrada) {
  const formulario = exigirFormulario(formularioEntrada);
  const perguntas = await consultar(
    `SELECT p.id, p.secao, p.codigo, p.oficial, p.campo, p.tipo, p.texto, p.texto_final, p.ajuda, p.obrigatoria, p.ordem, p.ativa,
            (SELECT COUNT(*) FROM resposta_extra r WHERE r.pergunta_id = p.id) AS respostas
       FROM catalogo_pergunta p WHERE p.formulario = @formulario ORDER BY p.secao, p.oficial DESC, p.ordem, p.id`, { formulario });
  const opcoes = await consultar(
    `SELECT o.id, o.pergunta_id, o.codigo, o.texto, o.texto_final, o.ordem, o.ativa, o.base, o.posicao, o.pontos, o.pede_detalhe, o.equivale_a_id,
            eq.codigo AS equivale_codigo, eq.texto AS equivale_texto,
            (SELECT COUNT(*) FROM resposta_extra r WHERE r.opcao_id = o.id) AS respostas
       FROM catalogo_opcao o
       JOIN catalogo_pergunta p ON p.id = o.pergunta_id
       LEFT JOIN catalogo_opcao eq ON eq.id = o.equivale_a_id
      WHERE p.formulario = @formulario ORDER BY o.pergunta_id, o.ordem, o.id`, { formulario });

  // formato anterior: as perguntas oficiais têm colunas fixas em dbo.questionario; nos demais tudo vive em resposta_extra
  const usoOficial = new Map();
  for (const p of perguntas) {
    if (formulario === LEGADO && p.oficial && p.tipo === 'ESCOLHA') usoOficial.set(p.id, await usoDasOpcoesOficiais(p.campo));
  }
  const porPergunta = new Map();
  for (const o of opcoes) {
    const p = perguntas.find((x) => x.id === o.perguntaId);
    const respostas = formulario === LEGADO && p.oficial ? (usoOficial.get(p.id)?.get(o.codigo) || 0) : o.respostas;
    if (!porPergunta.has(o.perguntaId)) porPergunta.set(o.perguntaId, []);
    porPergunta.get(o.perguntaId).push({
      id: o.id, codigo: o.codigo, texto: o.texto, textoFinal: o.textoFinal, ordem: o.ordem, ativa: !!o.ativa, base: !!o.base,
      equivaleCodigo: o.equivaleCodigo, equivaleTexto: o.equivaleTexto, respostas,
      pontua: o.base ? (formulario === LEGADO || o.pontos !== null) : o.equivaleAId !== null,
      pedeDetalhe: !!o.pedeDetalhe,
    });
  }

  return {
    formulario,
    rotulo: ROTULO_FORMULARIO[formulario],
    tipos: TIPOS_EXTRA,
    secoes: SECOES[formulario].map((s) => ({
      ...s,
      perguntas: perguntas.filter((p) => p.secao === s.numero).map((p) => ({
        id: p.id, codigo: p.codigo, oficial: !!p.oficial, tipo: p.tipo, texto: p.texto, textoFinal: p.textoFinal, ajuda: p.ajuda,
        obrigatoria: !!p.obrigatoria, ordem: p.ordem, ativa: !!p.ativa,
        respostas: formulario === LEGADO && p.oficial ? null : p.respostas,
        campo: p.campo,
        opcoes: porPergunta.get(p.id) || [],
        // formato anterior: perguntas de lista (benefícios, destinos) têm as opções na aba Listas
        apoio: formulario === LEGADO && p.oficial ? APOIO_DA_PERGUNTA[p.campo] || (p.tipo === 'MULTIPLA' ? 'destino_economia' : null) : null,
      })),
    })),
  };
}

// ---------- validação ----------

function validarTextoPergunta(corpo, { formulario, oficial }) {
  const problemas = {};
  const t = texto(corpo.texto, 500);
  if (!t || t.length < 3) problemas.texto = 'Escreva a pergunta (mínimo de 3 caracteres).';
  const ajuda = texto(corpo.ajuda, 300);
  let textoFinal = null;
  if (formulario === LEGADO) {
    textoFinal = texto(corpo.textoFinal, 500) || t;
  }
  if (oficial && !t) problemas.texto = 'A pergunta oficial não pode ficar sem texto.';
  return { problemas, t, textoFinal, ajuda };
}

function validarOpcaoTexto(corpo, problemas, prefixo = '') {
  const t = texto(corpo.texto, 200);
  if (!t) problemas[`${prefixo}texto`] = 'Escreva o texto da opção.';
  return { t, textoFinal: texto(corpo.textoFinal, 200) };
}

async function carregarPergunta(executor, id) {
  const p = await executor.consultarUm('SELECT * FROM catalogo_pergunta WHERE id = @id', { id });
  if (!p) throw erros.naoEncontrado('Pergunta não encontrada.');
  return p;
}

async function carregarOpcao(executor, perguntaId, opcaoId) {
  const o = await executor.consultarUm('SELECT * FROM catalogo_opcao WHERE id = @id AND pergunta_id = @perguntaId', { id: opcaoId, perguntaId });
  if (!o) throw erros.naoEncontrado('Opção não encontrada.');
  return o;
}

const respostasDaPergunta = async (executor, perguntaId) =>
  (await executor.consultarUm('SELECT COUNT(*) AS n FROM resposta_extra WHERE pergunta_id = @perguntaId', { perguntaId })).n;

async function respostasDaOpcao(executor, pergunta, opcao) {
  if (!(pergunta.oficial && pergunta.formulario === LEGADO)) return (await executor.consultarUm('SELECT COUNT(*) AS n FROM resposta_extra WHERE opcao_id = @id', { id: opcao.id })).n;
  const coluna = COLUNAS[pergunta.campo];
  if (!coluna) return 0;
  return (await executor.consultarUm(`SELECT COUNT(*) AS n FROM questionario WHERE ${coluna} = @codigo`, { codigo: opcao.codigo })).n;
}

// A pergunta oficial entra no índice/comparação? Formato anterior: sempre. M1: só se alguma opção oficial tem pontos.
async function perguntaPontua(executor, pergunta) {
  if (pergunta.formulario === LEGADO) return true;
  const r = await executor.consultarUm('SELECT COUNT(*) AS n FROM catalogo_opcao WHERE pergunta_id = @id AND base = 1 AND pontos IS NOT NULL', { id: pergunta.id });
  return r.n > 0;
}

// Opção acrescentada a pergunta OFICIAL: `equivaleA` (código de uma opção base) ou `naoPontua`. Devolve o id da base ou null.
// Pergunta oficial que não pontua (ex.: fonte de renda) dispensa a escolha.
async function resolverEquivalencia(executor, pergunta, corpo, problemas) {
  if (!(await perguntaPontua(executor, pergunta))) return null;
  const naoPontua = ehVerdadeiro(corpo.naoPontua);
  const codigo = texto(corpo.equivaleA, 40);
  if (naoPontua) return null;
  if (!codigo) {
    problemas.equivaleA = 'Indique a qual opção oficial esta vale no índice de progresso, ou marque que não pontua.';
    return null;
  }
  const base = await executor.consultarUm(
    `SELECT id FROM catalogo_opcao WHERE pergunta_id = @perguntaId AND codigo = @codigo AND base = 1${pergunta.formulario === LEGADO ? '' : ' AND pontos IS NOT NULL'}`,
    { perguntaId: pergunta.id, codigo });
  if (!base) { problemas.equivaleA = 'Escolha uma das opções oficiais da pergunta.'; return null; }
  return base.id;
}

async function textoDuplicado(executor, perguntaId, t, exceto = 0) {
  const dup = await executor.consultarUm(
    'SELECT 1 AS x FROM catalogo_opcao WHERE pergunta_id = @perguntaId AND texto = @t AND id <> @exceto', { perguntaId, t, exceto });
  return !!dup;
}

const proximoNumero = (codigos, prefixo) =>
  codigos.map((c) => Number(String(c).slice(prefixo.length))).filter(Number.isInteger).reduce((m, n) => Math.max(m, n), 0) + 1;

async function atualizado(req) {
  catalogo.invalidar();
  await catalogo.garantir();
  return req;
}

// ---------- perguntas ----------

async function criarPergunta(req, corpo) {
  const formulario = exigirFormulario(corpo.formulario, { paraCriar: true });
  const secao = Number(corpo.secao ?? 1);
  const problemas = {};
  if (!SECOES[formulario].some((s) => s.numero === secao)) problemas.secao = 'Escolha a seção.';
  const tipo = String(corpo.tipo || '').toUpperCase();
  if (!TIPOS_EXTRA.includes(tipo)) problemas.tipo = 'Escolha o tipo de resposta.';
  const { problemas: pt, t, textoFinal, ajuda } = validarTextoPergunta(corpo, { formulario, oficial: false });
  Object.assign(problemas, pt);
  // na pesquisa a família pode não querer responder: pergunta adicional nunca é obrigatória
  const obrigatoria = formulario !== 'PESQUISA' && ehVerdadeiro(corpo.obrigatoria) ? 1 : 0;

  const escolha = tipo === 'ESCOLHA' || tipo === 'MULTIPLA';
  const opcoes = [];
  if (escolha) {
    const brutas = Array.isArray(corpo.opcoes) ? corpo.opcoes : [];
    if (brutas.length < MIN_OPCOES_ATIVAS || brutas.length > MAX_OPCOES) problemas.opcoes = `Informe de ${MIN_OPCOES_ATIVAS} a ${MAX_OPCOES} opções.`;
    for (const b of brutas) {
      const o = texto(typeof b === 'string' ? b : b?.texto, 200);
      if (!o) { problemas.opcoes = 'Há opção sem texto.'; break; }
      if (opcoes.some((x) => x.toLowerCase() === o.toLowerCase())) { problemas.opcoes = 'Há opções repetidas.'; break; }
      opcoes.push(o);
    }
  }
  lancarSeErros(problemas);

  const resultado = await transacao(async (tx) => {
    const [{ total }] = await tx.consultar('SELECT COUNT(*) AS total FROM catalogo_pergunta WHERE formulario = @formulario AND oficial = 0', { formulario });
    if (total >= MAX_PERGUNTAS_POR_FORMULARIO) throw erros.conflito(`Limite de ${MAX_PERGUNTAS_POR_FORMULARIO} perguntas adicionais por formulário.`);
    const existentes = await tx.consultar(
      'SELECT codigo, ordem FROM catalogo_pergunta WITH (UPDLOCK, HOLDLOCK) WHERE formulario = @formulario AND oficial = 0', { formulario });
    const codigo = `E${String(proximoNumero(existentes.map((e) => e.codigo), 'E')).padStart(4, '0')}`;
    const ordem = existentes.reduce((m, e) => Math.max(m, e.ordem), 0) + 10;
    const [nova] = await tx.consultar(
      `INSERT INTO catalogo_pergunta (formulario, secao, codigo, oficial, tipo, texto, texto_final, ajuda, obrigatoria, ordem, criado_por)
       OUTPUT INSERTED.id VALUES (@formulario, @secao, @codigo, 0, @tipo, @t, @textoFinal, @ajuda, @obrigatoria, @ordem, @por)`,
      { formulario, secao, codigo, tipo, t, textoFinal, ajuda, obrigatoria, ordem, por: req.usuario.id });
    for (let i = 0; i < opcoes.length; i += 1) {
      await tx.consultar(
        'INSERT INTO catalogo_opcao (pergunta_id, codigo, texto, ordem, criado_por) VALUES (@pergunta, @codigo, @texto, @ordem, @por)',
        { pergunta: nova.id, codigo: `OP${String(i + 1).padStart(2, '0')}`, texto: opcoes[i], ordem: (i + 1) * 10, por: req.usuario.id });
    }
    await registrarAuditoria(req, 'CRIAR', 'catalogo_pergunta', nova.id, { formulario, codigo, tipo, texto: t }, tx);
    return { id: nova.id, codigo };
  });
  await atualizado();
  return resultado;
}

async function atualizarPergunta(req, id, corpo) {
  const resultado = await transacao(async (tx) => {
    const p = await carregarPergunta(tx, id);
    const { problemas, t, textoFinal, ajuda } = validarTextoPergunta(corpo, { formulario: p.formulario, oficial: !!p.oficial });
    let secao = p.secao;
    let obrigatoria = p.obrigatoria;
    if (!p.oficial) {
      if (corpo.secao !== undefined && Number(corpo.secao) !== p.secao) {
        secao = Number(corpo.secao);
        if (!SECOES[p.formulario].some((s) => s.numero === secao)) problemas.secao = 'Escolha a seção.';
      }
      if (corpo.obrigatoria !== undefined) obrigatoria = p.formulario !== 'PESQUISA' && ehVerdadeiro(corpo.obrigatoria) ? 1 : 0;
    }
    lancarSeErros(problemas);
    await tx.consultar(
      `UPDATE catalogo_pergunta SET texto = @t, texto_final = @textoFinal, ajuda = @ajuda, secao = @secao, obrigatoria = @obrigatoria,
              alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id`,
      { id, t, textoFinal: p.formulario === 'QUESTIONARIO' ? textoFinal : p.textoFinal, ajuda, secao, obrigatoria, por: req.usuario.id });
    await registrarAuditoria(req, 'ALTERAR', 'catalogo_pergunta', id,
      { formulario: p.formulario, codigo: p.codigo, de: p.texto, para: t, ...(obrigatoria !== p.obrigatoria ? { obrigatoria: !!obrigatoria } : {}) }, tx);
    return { id };
  });
  await atualizado();
  return resultado;
}

async function definirAtiva(req, id, ativa) {
  await transacao(async (tx) => {
    const p = await carregarPergunta(tx, id);
    if (p.oficial) throw erros.conflito('As perguntas oficiais não podem ser desativadas: elas alimentam o índice de progresso e os relatórios.');
    await tx.consultar('UPDATE catalogo_pergunta SET ativa = @ativa, alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id',
      { id, ativa: ativa ? 1 : 0, por: req.usuario.id });
    await registrarAuditoria(req, 'ALTERAR', 'catalogo_pergunta', id, { formulario: p.formulario, codigo: p.codigo, ativa }, tx);
  });
  await atualizado();
  return { id, ativa };
}

async function excluirPergunta(req, id) {
  await transacao(async (tx) => {
    const p = await carregarPergunta(tx, id);
    if (p.oficial) throw erros.conflito('As perguntas oficiais não podem ser excluídas.');
    if (await respostasDaPergunta(tx, id) > 0) {
      throw erros.conflito('Esta pergunta já tem respostas e não pode ser excluída. Desative-a para que deixe de aparecer nos formulários.');
    }
    await tx.consultar('DELETE FROM catalogo_opcao WHERE pergunta_id = @id', { id });
    await tx.consultar('DELETE FROM catalogo_pergunta WHERE id = @id', { id });
    await registrarAuditoria(req, 'EXCLUIR', 'catalogo_pergunta', id, { formulario: p.formulario, codigo: p.codigo, texto: p.texto }, tx);
  });
  await atualizado();
}

// ids = TODAS as perguntas extras da seção, na nova ordem
async function ordenarPerguntas(req, corpo) {
  const formulario = exigirFormulario(corpo.formulario, { paraCriar: true });
  const secao = Number(corpo.secao ?? 1);
  const ids = Array.isArray(corpo.ids) ? corpo.ids.map(inteiroPositivo) : null;
  if (!ids || ids.includes(null)) throw erros.validacao({ ids: 'Lista de perguntas inválida.' });
  await transacao(async (tx) => {
    const atuais = await tx.consultar(
      'SELECT id FROM catalogo_pergunta WHERE formulario = @formulario AND secao = @secao AND oficial = 0', { formulario, secao });
    if (atuais.length !== ids.length || atuais.some((a) => !ids.includes(a.id)) || new Set(ids).size !== ids.length) {
      throw erros.validacao({ ids: 'A lista deve conter todas as perguntas adicionais da seção.' });
    }
    for (let i = 0; i < ids.length; i += 1) {
      await tx.consultar('UPDATE catalogo_pergunta SET ordem = @ordem, alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id',
        { id: ids[i], ordem: (i + 1) * 10, por: req.usuario.id });
    }
    await registrarAuditoria(req, 'ALTERAR', 'catalogo_pergunta', null, { formulario, secao, ordem: ids }, tx);
  });
  await atualizado();
}

// ---------- opções ----------

async function exigirPerguntaDeEscolha(executor, perguntaId) {
  const p = await carregarPergunta(executor, perguntaId);
  if (p.tipo !== 'ESCOLHA' && p.tipo !== 'MULTIPLA') {
    throw erros.conflito(p.oficial
      ? 'Esta pergunta não tem opções para configurar aqui (as listas são editadas na aba Listas).'
      : 'Esta pergunta não é de escolha.');
  }
  return p;
}

// "Pede um texto livre" (opção "Outra/Outros"): só nos questionários inicial e final, onde o formulário coleta o texto
// (as listas de apoio do atendimento e do registro têm o próprio "exige_texto", na aba Listas).
const aceitaDetalhe = (p) => m1.FORMULARIOS_M1.includes(p.formulario);
const querDetalhe = (corpo) => corpo.pedeDetalhe === true || corpo.pedeDetalhe === 'true';

async function criarOpcao(req, perguntaId, corpo) {
  const resultado = await transacao(async (tx) => {
    const p = await exigirPerguntaDeEscolha(tx, perguntaId);
    if (p.oficial && ![LEGADO, ...m1.FORMULARIOS_M1].includes(p.formulario)) throw erros.conflito('Esta pergunta não aceita novas opções.');
    const problemas = {};
    const { t, textoFinal } = validarOpcaoTexto(corpo, problemas);
    let equivaleAId = null;
    if (p.oficial) equivaleAId = await resolverEquivalencia(tx, p, corpo, problemas);
    if (t && await textoDuplicado(tx, p.id, t)) problemas.texto = 'Já existe uma opção com este texto.';
    lancarSeErros(problemas);

    const existentes = await tx.consultar('SELECT codigo, ordem FROM catalogo_opcao WITH (UPDLOCK, HOLDLOCK) WHERE pergunta_id = @id', { id: p.id });
    if (existentes.length >= MAX_OPCOES) throw erros.conflito(`Limite de ${MAX_OPCOES} opções por pergunta.`);
    const codigo = `OP${String(proximoNumero(existentes.map((e) => e.codigo.startsWith('OP') ? e.codigo : 'OP00'), 'OP')).padStart(2, '0')}`;
    const ordem = existentes.reduce((m, e) => Math.max(m, e.ordem), 0) + 10;
    const [nova] = await tx.consultar(
      `INSERT INTO catalogo_opcao (pergunta_id, codigo, texto, texto_final, ordem, base, equivale_a_id, pede_detalhe, criado_por)
       OUTPUT INSERTED.id VALUES (@pergunta, @codigo, @t, @textoFinal, @ordem, 0, @equivale, @pedeDetalhe, @por)`,
      { pergunta: p.id, codigo, t, textoFinal: p.formulario === 'QUESTIONARIO' ? textoFinal : null, ordem, equivale: equivaleAId,
        pedeDetalhe: aceitaDetalhe(p) && querDetalhe(corpo), por: req.usuario.id });
    await registrarAuditoria(req, 'CRIAR', 'catalogo_opcao', nova.id,
      { formulario: p.formulario, pergunta: p.codigo, codigo, texto: t, ...(p.oficial ? { valeComo: equivaleAId ? corpo.equivaleA : 'nao_pontua' } : {}) }, tx);
    return { id: nova.id, codigo };
  });
  await atualizado();
  return resultado;
}

async function atualizarOpcao(req, perguntaId, opcaoId, corpo) {
  await transacao(async (tx) => {
    const p = await exigirPerguntaDeEscolha(tx, perguntaId);
    const o = await carregarOpcao(tx, p.id, opcaoId);
    const problemas = {};
    const { t, textoFinal } = validarOpcaoTexto(corpo, problemas);
    if (t && await textoDuplicado(tx, p.id, t, o.id)) problemas.texto = 'Já existe uma opção com este texto.';

    let equivaleAId = o.equivaleAId;
    const querMudarEquivalencia = p.oficial && !o.base && (corpo.equivaleA !== undefined || corpo.naoPontua !== undefined);
    if (querMudarEquivalencia) {
      const novo = await resolverEquivalencia(tx, p, corpo, problemas);
      if (!Object.keys(problemas).length && novo !== o.equivaleAId) {
        if (await respostasDaOpcao(tx, p, o) > 0) {
          throw erros.conflito('Esta opção já foi usada em questionários: mudar o quanto ela vale alteraria índices e comparações já calculados. Crie uma nova opção com o valor correto e desative esta.');
        }
        equivaleAId = novo;
      }
    }
    lancarSeErros(problemas);
    await tx.consultar(
      `UPDATE catalogo_opcao SET texto = @t, texto_final = @textoFinal, equivale_a_id = @equivale, pede_detalhe = @pedeDetalhe,
              alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id`,
      { id: o.id, t, textoFinal: p.formulario === 'QUESTIONARIO' ? textoFinal : o.textoFinal, equivale: equivaleAId,
        pedeDetalhe: o.base || !aceitaDetalhe(p) || corpo.pedeDetalhe === undefined ? !!o.pedeDetalhe : querDetalhe(corpo), por: req.usuario.id });
    await registrarAuditoria(req, 'ALTERAR', 'catalogo_opcao', o.id,
      { formulario: p.formulario, pergunta: p.codigo, codigo: o.codigo, de: o.texto, para: t, ...(equivaleAId !== o.equivaleAId ? { valeComoAlterado: true } : {}) }, tx);
  });
  await atualizado();
  return { id: opcaoId };
}

async function definirOpcaoAtiva(req, perguntaId, opcaoId, ativa) {
  await transacao(async (tx) => {
    const p = await exigirPerguntaDeEscolha(tx, perguntaId);
    const o = await carregarOpcao(tx, p.id, opcaoId);
    if (!ativa) {
      const [{ n }] = await tx.consultar('SELECT COUNT(*) AS n FROM catalogo_opcao WHERE pergunta_id = @id AND ativa = 1 AND id <> @opcao', { id: p.id, opcao: o.id });
      if (n < MIN_OPCOES_ATIVAS) throw erros.conflito(`A pergunta precisa de pelo menos ${MIN_OPCOES_ATIVAS} opções ativas.`);
    }
    await tx.consultar('UPDATE catalogo_opcao SET ativa = @ativa, alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id',
      { id: o.id, ativa: ativa ? 1 : 0, por: req.usuario.id });
    await registrarAuditoria(req, 'ALTERAR', 'catalogo_opcao', o.id, { formulario: p.formulario, pergunta: p.codigo, codigo: o.codigo, ativa }, tx);
  });
  await atualizado();
  return { id: opcaoId, ativa };
}

async function excluirOpcao(req, perguntaId, opcaoId) {
  await transacao(async (tx) => {
    const p = await exigirPerguntaDeEscolha(tx, perguntaId);
    const o = await carregarOpcao(tx, p.id, opcaoId);
    if (o.base) throw erros.conflito('As opções oficiais não podem ser excluídas.');
    if (await respostasDaOpcao(tx, p, o) > 0) {
      throw erros.conflito('Esta opção já foi usada em respostas e não pode ser excluída. Desative-a para que deixe de aparecer nos formulários.');
    }
    await tx.consultar('DELETE FROM catalogo_opcao WHERE id = @id', { id: o.id });
    await registrarAuditoria(req, 'EXCLUIR', 'catalogo_opcao', o.id, { formulario: p.formulario, pergunta: p.codigo, codigo: o.codigo, texto: o.texto }, tx);
  });
  await atualizado();
}

// ids = TODAS as opções da pergunta, na nova ordem de exibição (a posição na escala do índice não muda)
async function ordenarOpcoes(req, perguntaId, corpo) {
  const ids = Array.isArray(corpo.ids) ? corpo.ids.map(inteiroPositivo) : null;
  if (!ids || ids.includes(null)) throw erros.validacao({ ids: 'Lista de opções inválida.' });
  await transacao(async (tx) => {
    const p = await exigirPerguntaDeEscolha(tx, perguntaId);
    const atuais = await tx.consultar('SELECT id FROM catalogo_opcao WHERE pergunta_id = @id', { id: p.id });
    if (atuais.length !== ids.length || atuais.some((a) => !ids.includes(a.id)) || new Set(ids).size !== ids.length) {
      throw erros.validacao({ ids: 'A lista deve conter todas as opções da pergunta.' });
    }
    for (let i = 0; i < ids.length; i += 1) {
      await tx.consultar('UPDATE catalogo_opcao SET ordem = @ordem, alterado_por = @por, alterado_em = SYSUTCDATETIME() WHERE id = @id',
        { id: ids[i], ordem: (i + 1) * 10, por: req.usuario.id });
    }
    await registrarAuditoria(req, 'ALTERAR', 'catalogo_pergunta', p.id, { formulario: p.formulario, codigo: p.codigo, ordemOpcoes: ids }, tx);
  });
  await atualizado();
}

module.exports = {
  TIPOS_EXTRA, SECOES, listar, criarPergunta, atualizarPergunta, definirAtiva, excluirPergunta, ordenarPerguntas,
  criarOpcao, atualizarOpcao, definirOpcaoAtiva, excluirOpcao, ordenarOpcoes,
};
