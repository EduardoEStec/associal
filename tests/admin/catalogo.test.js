'use strict';

// Regras PURAS do catálogo de perguntas e opções (P2), sem banco. Rodar: node --test tests/admin/*.test.js
// Cobre: leitura do catálogo, modelo do questionário com textos renomeados e perguntas extras, opção acrescentada a pergunta
// oficial (comparação inicial × final, distribuição consolidada e ÍNDICE DE PROGRESSO) e a validação das respostas extras.

const test = require('node:test');
const assert = require('node:assert/strict');
const estado = require('../../server/services/catalogo-estado');
const { montarCatalogo } = require('../../server/services/catalogo');
const q = require('../../server/services/questionario');
const indice = require('../../server/services/indice-progresso');
const extras = require('../../server/services/extras');

const HOJE = '2026-06-10';

// ---------- linhas do banco (já em camelCase) ----------
const PERGUNTA_2A = {
  id: 1, formulario: 'QUESTIONARIO', secao: 2, codigo: '2a', oficial: true, campo: 'acessoAlimentosInNatura', tipo: 'ESCOLHA',
  texto: 'Frequência de alimentos in natura (inicial)', textoFinal: 'Hoje, frequência de alimentos in natura', ajuda: null, obrigatoria: false, ordem: 10, ativa: true,
};
const base = (id, codigo, texto, posicao, textoFinal = null) => ({
  id, perguntaId: 1, codigo, texto, textoFinal, ordem: (posicao + 1) * 10, ativa: true, base: true, posicao,
  equivaleAId: null, equivaleCodigo: null, equivalePosicao: null,
});
const OPCOES_2A = [
  base(1, 'NAO_TINHA', 'Não tinha acesso', 0, 'Não tem acesso'),
  base(2, 'SEMANAL_1_2', '1 a 2 vezes por semana', 1),
  base(3, 'SEMANAL_2_3', '2 a 3 vezes por semana', 2),
  base(4, 'DIARIO', 'Todo dia', 3),
];
// opção acrescentada: vale como DIARIO (posição 3)
const OP_VALE_DIARIO = {
  id: 5, perguntaId: 1, codigo: 'OP01', texto: 'Todo dia, com horta própria', textoFinal: null, ordem: 50, ativa: true, base: false, posicao: null,
  equivaleAId: 4, equivaleCodigo: 'DIARIO', equivalePosicao: 3,
};
// opção acrescentada que não pontua
const OP_NAO_PONTUA = { ...OP_VALE_DIARIO, id: 6, codigo: 'OP02', texto: 'Não sabe informar', ordem: 60, equivaleAId: null, equivaleCodigo: null, equivalePosicao: null };

const extra = (id, o) => ({
  id, formulario: 'QUESTIONARIO', secao: 2, codigo: `E000${id}`, oficial: false, campo: null, tipo: 'TEXTO', texto: `Extra ${id}`, textoFinal: null, ajuda: null,
  obrigatoria: false, ordem: id * 10, ativa: true, ...o,
});
const opcaoExtra = (id, perguntaId, codigo, texto, ordem, ativa = true) => ({
  id, perguntaId, codigo, texto, textoFinal: null, ordem, ativa, base: false, posicao: null, equivaleAId: null, equivaleCodigo: null, equivalePosicao: null,
});

function carregar(perguntas, opcoes) {
  estado.definir(montarCatalogo(perguntas, opcoes));
}
test.afterEach(() => estado.restaurarPadrao());

const respostas = (extra = {}) => q.montarRespostas({
  qtdMembrosFamilia: 4, rendaMensalMedia: 1500, qtdMembrosComRenda: 1, recebeAuxilio: true,
  acessoAlimentosInNatura: 'SEMANAL_1_2', frequenciaFrutasVerduras: 'UMA_DUAS', qualidadeAlimentacao: 'NAO_MELHOROU', saudeNutricional: 'NENHUMA',
  conseguePoupar: false, economiaMensalFaixa: 'ATE_100', economiaMensalValor: 80, capacidadePoupanca: 'NAO_CONSEGUE', gestaoFinanceira: 'SEM_MUDANCA',
  empoderadaDecisoes: false, melhoriaPlanejamento: false, avaliacaoArmazem: 'BOA', recomendaria: true, ...extra,
}, [1], [2]);

// ---------- estado padrão ----------

test('sem catálogo carregado valem as definições oficiais do código (comportamento de antes)', () => {
  assert.deepEqual(estado.escalaDe('acessoAlimentosInNatura'), ['NAO_TINHA', 'SEMANAL_1_2', 'SEMANAL_2_3', 'DIARIO']);
  assert.deepEqual(estado.posicaoNaEscala('qualidadeAlimentacao', 'MELHOROU_MUITO'), { indice: 3, total: 4 });
  assert.equal(estado.rotuloOpcao('acessoAlimentosInNatura', 'NAO_TINHA', 'FINAL'), 'Não tem acesso');
  assert.equal(estado.rotuloOpcao('acessoAlimentosInNatura', 'NAO_TINHA', 'INICIAL'), 'Não tinha acesso');
  assert.equal(estado.ehCodigoValido('avaliacaoArmazem', 'OTIMA'), true);
  assert.equal(estado.ehCodigoValido('avaliacaoArmazem', 'OP01'), false);
  assert.deepEqual(estado.extras('QUESTIONARIO'), []);
  const m = q.montarModelo('INICIAL');
  assert.equal(m.blocos.flatMap((b) => b.perguntas).length, 21);
  assert.ok(m.blocos.flatMap((b) => b.perguntas).every((p) => !p.extra));
});

// ---------- catálogo carregado ----------

test('texto renomeado muda no modelo (inicial e final), mas o campo e o código da opção seguem iguais', () => {
  carregar([PERGUNTA_2A], OPCOES_2A);
  const inicial = q.montarModelo('INICIAL').blocos[1].perguntas[0];
  const final = q.montarModelo('FINAL').blocos[1].perguntas[0];
  assert.equal(inicial.campo, 'acessoAlimentosInNatura');
  assert.equal(inicial.texto, 'Frequência de alimentos in natura (inicial)');
  assert.equal(final.texto, 'Hoje, frequência de alimentos in natura');
  assert.deepEqual(inicial.opcoes.map((o) => [o.valor, o.rotulo]), [
    ['NAO_TINHA', 'Não tinha acesso'], ['SEMANAL_1_2', '1 a 2 vezes por semana'], ['SEMANAL_2_3', '2 a 3 vezes por semana'], ['DIARIO', 'Todo dia']]);
  assert.equal(final.opcoes[0].rotulo, 'Não tem acesso');
  // as outras perguntas continuam com o texto do código
  assert.match(q.montarModelo('INICIAL').blocos[0].perguntas[0].texto, /Quantas pessoas/);
});

test('opção acrescentada vale como a base indicada; "não pontua" fica sem posição', () => {
  carregar([PERGUNTA_2A], [...OPCOES_2A, OP_VALE_DIARIO, OP_NAO_PONTUA]);
  assert.deepEqual(estado.posicaoNaEscala('acessoAlimentosInNatura', 'OP01'), { indice: 3, total: 4 });
  assert.equal(estado.posicaoNaEscala('acessoAlimentosInNatura', 'OP02'), null);
  assert.equal(estado.ehCodigoValido('acessoAlimentosInNatura', 'OP02'), true);
  assert.equal(estado.posicaoNaEscala('acessoAlimentosInNatura', 'NAO_EXISTE'), null);
  const opcoes = q.montarModelo('INICIAL').blocos[1].perguntas[0].opcoes.map((o) => o.valor);
  assert.deepEqual(opcoes, ['NAO_TINHA', 'SEMANAL_1_2', 'SEMANAL_2_3', 'DIARIO', 'OP01', 'OP02']);
});

test('validação do questionário aceita o código novo e recusa código desconhecido', () => {
  carregar([PERGUNTA_2A], [...OPCOES_2A, OP_VALE_DIARIO]);
  assert.deepEqual(q.validarRespostas({ acessoAlimentosInNatura: 'OP01' }, { concluir: false, hoje: HOJE }).erros, {});
  assert.ok(q.validarRespostas({ acessoAlimentosInNatura: 'OP99' }, { concluir: false, hoje: HOJE }).erros.acessoAlimentosInNatura);
});

test('3b com opção nova: valor × faixa não quebra quando a faixa não tem limite conhecido', () => {
  const p3b = { ...PERGUNTA_2A, id: 9, codigo: '3b', campo: 'economiaMensalFaixa', secao: 3 };
  const opcoes = ['ATE_100', 'DE_101_200', 'DE_201_300', 'ACIMA_300'].map((c, i) => ({ ...base(20 + i, c, c, i), perguntaId: 9 }));
  const nova = { ...OP_VALE_DIARIO, id: 30, perguntaId: 9, codigo: 'OP01', equivaleAId: 23, equivaleCodigo: 'ACIMA_300', equivalePosicao: 3 };
  carregar([p3b], [...opcoes, nova]);
  const r = q.validarRespostas({ economiaMensalFaixa: 'OP01', economiaMensalValor: 1500 }, { concluir: false, hoje: HOJE });
  assert.deepEqual(r.erros, {});
});

test('comparação inicial × final: a opção nova vale a posição da base; "não pontua" dá sem dados', () => {
  carregar([PERGUNTA_2A], [...OPCOES_2A, OP_VALE_DIARIO, OP_NAO_PONTUA]);
  const comp = (antes, depois) => q.compararFamilia(respostas({ acessoAlimentosInNatura: antes }), respostas({ acessoAlimentosInNatura: depois }))
    .itens.find((i) => i.campo === 'acessoAlimentosInNatura');
  assert.equal(comp('SEMANAL_1_2', 'OP01').tendencia, 'melhorou');
  assert.equal(comp('DIARIO', 'OP01').tendencia, 'igual', 'OP01 vale como DIARIO');
  assert.equal(comp('OP01', 'SEMANAL_2_3').tendencia, 'piorou');
  assert.equal(comp('SEMANAL_1_2', 'OP02').tendencia, 'sem_dados');
  assert.equal(comp('OP01', 'DIARIO').inicialRotulo, 'Todo dia, com horta própria');
});

test('comparação consolidada lista a opção nova com a contagem; desativada sem resposta some', () => {
  const inativa = { ...OP_NAO_PONTUA, ativa: false };
  carregar([PERGUNTA_2A], [...OPCOES_2A, OP_VALE_DIARIO, inativa]);
  const pares = [
    { inicial: respostas({ acessoAlimentosInNatura: 'SEMANAL_1_2' }), final: respostas({ acessoAlimentosInNatura: 'OP01' }) },
    { inicial: respostas({ acessoAlimentosInNatura: 'NAO_TINHA' }), final: respostas({ acessoAlimentosInNatura: 'DIARIO' }) },
  ];
  const c = q.consolidarComparacao(pares).perguntas.find((p) => p.campo === 'acessoAlimentosInNatura');
  const depois = Object.fromEntries(c.depois.opcoes.map((o) => [o.valor, o.familias]));
  assert.deepEqual(depois, { NAO_TINHA: 0, SEMANAL_1_2: 0, SEMANAL_2_3: 0, DIARIO: 1, OP01: 1 });
  assert.equal(c.melhoraram, 2);
  // desativada COM resposta volta a aparecer
  const comUso = q.consolidarComparacao([{ inicial: respostas({ acessoAlimentosInNatura: 'OP02' }), final: respostas() }]).perguntas
    .find((p) => p.campo === 'acessoAlimentosInNatura');
  assert.ok(comUso.antes.opcoes.some((o) => o.valor === 'OP02' && o.familias === 1));
});

test('ÍNDICE DE PROGRESSO com opção nova: igual ao da base equivalente; "não pontua" reduz os itens válidos', () => {
  carregar([PERGUNTA_2A], [...OPCOES_2A, OP_VALE_DIARIO, OP_NAO_PONTUA]);
  const dim = (r) => indice.calcularIndice(r, { tipo: 'FINAL' }).dimensoes.ALIMENTACAO;
  const comBase = dim(respostas({ acessoAlimentosInNatura: 'DIARIO' }));
  const comNova = dim(respostas({ acessoAlimentosInNatura: 'OP01' }));
  const semPontuar = dim(respostas({ acessoAlimentosInNatura: 'OP02' }));
  assert.equal(comNova.nivel, comBase.nivel);
  assert.equal(comNova.itensValidos, comBase.itensValidos);
  assert.equal(semPontuar.itensValidos, comBase.itensValidos - 1);
  const a2a = comNova.itens.find((i) => i.campo === 'acessoAlimentosInNatura');
  assert.equal(a2a.pontos, 100, 'DIARIO é a melhor posição da escala');
  assert.equal(semPontuar.itens.some((i) => i.campo === 'acessoAlimentosInNatura'), false);
  // a fórmula e a escala das outras perguntas não mudaram
  assert.equal(dim(respostas({ acessoAlimentosInNatura: 'NAO_TINHA' })).itens.find((i) => i.campo === 'acessoAlimentosInNatura').pontos, 0);
  assert.equal(indice.VERSAO_REGRA_LEGADO, 1);
  assert.equal(indice.calcularIndice(respostas(), { tipo: 'FINAL' }).versaoRegra, 1, 'questionário no formato anterior segue na regra v1');
});

// ---------- perguntas extras no modelo ----------

test('extras entram no fim da seção escolhida, inativas ficam de fora e a reavaliação não tem extras', () => {
  const texto = extra(1, { secao: 4, texto: 'O que mudou na rotina?', textoFinal: 'O que mudou depois do projeto?' });
  const escolha = extra(2, { secao: 2, tipo: 'ESCOLHA', texto: 'Onde compra frutas?', obrigatoria: true });
  const inativa = extra(3, { secao: 2, texto: 'Pergunta desativada', ativa: false });
  carregar([texto, escolha, inativa], [opcaoExtra(10, 2, 'OP01', 'Feira', 10), opcaoExtra(11, 2, 'OP02', 'Mercado', 20, false)]);
  const m = q.montarModelo('INICIAL');
  const b2 = m.blocos.find((b) => b.numero === 2).perguntas;
  assert.equal(b2.length, 5, '4 oficiais + 1 extra ativa');
  const e = b2[b2.length - 1];
  assert.deepEqual([e.extra, e.campo, e.tipo, e.obrigatoria], [true, 'extras.E0002', 'escolha', true]);
  assert.deepEqual(e.opcoes, [{ valor: 'OP01', rotulo: 'Feira', ativa: true }, { valor: 'OP02', rotulo: 'Mercado', ativa: false }]);
  assert.equal(m.blocos.find((b) => b.numero === 4).perguntas.at(-1).texto, 'O que mudou na rotina?');
  assert.equal(q.montarModelo('FINAL').blocos.find((b) => b.numero === 4).perguntas.at(-1).texto, 'O que mudou depois do projeto?');
  assert.ok(!JSON.stringify(m).includes('Pergunta desativada'));
  assert.ok(!q.montarModelo('REAVALIACAO').blocos.flatMap((b) => b.perguntas).some((p) => p.extra));
});

// ---------- validação das respostas extras ----------

const DEFS = [
  extra(1, { tipo: 'TEXTO', obrigatoria: true }),
  extra(2, { tipo: 'NUMERO' }),
  extra(3, { tipo: 'SIM_NAO' }),
  { ...extra(4, { tipo: 'ESCOLHA' }), opcoes: [opcaoExtra(41, 4, 'OP01', 'A', 10), opcaoExtra(42, 4, 'OP02', 'B', 20, false)] },
  { ...extra(5, { tipo: 'MULTIPLA' }), opcoes: [opcaoExtra(51, 5, 'OP01', 'X', 10), opcaoExtra(52, 5, 'OP02', 'Y', 20)] },
].map((d) => ({ opcoes: [], ...d }));
const cod = (n) => `E000${n}`;

test('extras: normaliza cada tipo e devolve as linhas a gravar', () => {
  const r = extras.validarExtras(DEFS, {
    [cod(1)]: '  texto livre ', [cod(2)]: '3,5', [cod(3)]: false, [cod(4)]: 'OP01', [cod(5)]: ['OP01', 'OP02', 'OP01'],
  }, { concluir: true });
  assert.deepEqual(r.erros, {});
  assert.deepEqual(r.itens, [
    { perguntaId: 1, opcaoId: null, valorTexto: 'texto livre', valorNum: null },
    { perguntaId: 2, opcaoId: null, valorTexto: null, valorNum: 3.5 },
    { perguntaId: 3, opcaoId: null, valorTexto: null, valorNum: 0 },
    { perguntaId: 4, opcaoId: 41, valorTexto: null, valorNum: null },
    { perguntaId: 5, opcaoId: 51, valorTexto: null, valorNum: null },
    { perguntaId: 5, opcaoId: 52, valorTexto: null, valorNum: null },
  ]);
  assert.deepEqual(r.perguntaIds, [1, 2, 3, 4, 5]);
});

test('extras: obrigatória só vale ao concluir; vazio limpa a resposta; falta de `extras` não é erro de formato', () => {
  assert.deepEqual(extras.validarExtras(DEFS, {}, { concluir: false }).erros, {});
  const r = extras.validarExtras(DEFS, { [cod(1)]: '   ' }, { concluir: true });
  assert.deepEqual(Object.keys(r.erros), ['extras.E0001']);
  assert.deepEqual(extras.validarExtras(DEFS, undefined, { concluir: false }).itens, []);
});

test('extras: erros por tipo (número, sim/não, opção desconhecida, lista, texto longo, formato do objeto)', () => {
  const r = extras.validarExtras(DEFS, {
    [cod(1)]: 'x'.repeat(2001), [cod(2)]: 'abc', [cod(3)]: 'talvez', [cod(4)]: 'OP99', [cod(5)]: 'OP01',
  }, { concluir: false });
  assert.deepEqual(Object.keys(r.erros).sort(), ['extras.E0001', 'extras.E0002', 'extras.E0003', 'extras.E0004', 'extras.E0005']);
  assert.ok(extras.validarExtras(DEFS, [], {}).erros.extras);
  assert.ok(extras.validarExtras(DEFS, 'texto', {}).erros.extras);
});

test('extras: opção desativada só é aceita se já estava escolhida', () => {
  assert.ok(extras.validarExtras(DEFS, { [cod(1)]: 'a', [cod(4)]: 'OP02' }, {}).erros['extras.E0004']);
  const atuais = new Map([[4, new Set([42])]]);
  assert.deepEqual(extras.validarExtras(DEFS, { [cod(1)]: 'a', [cod(4)]: 'OP02' }, { atuais }).erros, {});
});

test('extras: respostas viram valores da API e texto legível (inclusive de pergunta desativada)', () => {
  carregar(DEFS.map((d, i) => (i === 1 ? { ...d, ativa: false } : d)).map(({ opcoes, ...d }) => d), DEFS.flatMap((d) => d.opcoes));
  // as definições vêm do catálogo carregado (montarCatalogo agrupa as opções por pergunta)
  const linhas = [
    { perguntaId: 1, opcaoId: null, valorTexto: 'ok', valorNum: null },
    { perguntaId: 2, opcaoId: null, valorTexto: null, valorNum: 7 },
    { perguntaId: 3, opcaoId: null, valorTexto: null, valorNum: 1 },
    { perguntaId: 4, opcaoId: 41, valorTexto: null, valorNum: null },
    { perguntaId: 5, opcaoId: 52, valorTexto: null, valorNum: null },
    { perguntaId: 5, opcaoId: 51, valorTexto: null, valorNum: null },
  ];
  const { mapa, lista } = extras.formatarRespostas('QUESTIONARIO', linhas);
  assert.deepEqual(mapa, { E0001: 'ok', E0002: 7, E0003: true, E0004: 'OP01', E0005: ['OP01', 'OP02'] });
  assert.deepEqual(lista.map((x) => x.resposta), ['ok', '7', 'Sim', 'A', 'X; Y']);
  assert.equal(lista.find((x) => x.codigo === 'E0002').ativa, false);
});
