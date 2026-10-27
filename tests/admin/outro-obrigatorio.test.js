'use strict';

// V21: toda opção "Outro/Outra/Outros" pede um texto OBRIGATÓRIO (back-end recusa vazio; sem a opção o texto é descartado).
// Regras puras, sem banco. Rodar: node --test tests/admin/outro-obrigatorio.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const extras = require('../../server/services/extras');
const pessoas = require('../../server/services/pessoas');

// ---------- perguntas adicionais dos questionários M1 (opção que pede detalhe) ----------
const DEF = {
  id: 7, codigo: 'X1', tipo: 'MULTIPLA', obrigatoria: false, ativa: true,
  opcoes: [
    { id: 1, codigo: 'A', texto: 'A', ativa: true, pedeDetalhe: false },
    { id: 2, codigo: 'OUTRAS', texto: 'Outras', ativa: true, pedeDetalhe: true },
  ],
};
const validar = (entrada, opcoes) => extras.validarExtras([DEF], { X1: entrada }, opcoes);

test('M1: ao concluir, "Outras" marcada sem texto é recusada (erro no campo detalhes.<código>)', () => {
  const r = validar(['A', 'OUTRAS'], { concluir: true, detalhes: {} });
  assert.match(r.erros['detalhes.X1'], /outra opção/i);
  assert.ok(validar(['OUTRAS'], { concluir: true, detalhes: { X1: '   ' } }).erros['detalhes.X1'], 'só espaços = vazio');
});

test('M1: com o texto, grava o complemento só na opção que pede detalhe', () => {
  const r = validar(['A', 'OUTRAS'], { concluir: true, detalhes: { X1: ' feira livre ' } });
  assert.deepEqual(r.erros, {});
  assert.deepEqual(r.itens.map((i) => [i.opcaoId, i.valorTexto]), [[1, null], [2, 'feira livre']]);
});

test('M1: sem a opção marcada o texto é ignorado; rascunho (concluir=false) segue sem o texto', () => {
  const r = validar(['A'], { concluir: true, detalhes: { X1: 'sobra' } });
  assert.deepEqual(r.erros, {});
  assert.ok(r.itens.every((i) => i.valorTexto === null));
  assert.deepEqual(validar(['OUTRAS'], { concluir: false, detalhes: {} }).erros, {});
});

test('quem não coleta complemento (atendimento, pesquisa, questionário anterior) não é afetado', () => {
  assert.deepEqual(validar(['OUTRAS'], { concluir: true }).erros, {});
});

// ---------- gênero, escolaridade e raça/etnia da pessoa ----------
const LISTAS = { genero: [{ id: 1, exigeTexto: false }, { id: 4, exigeTexto: true }], escolaridade: [{ id: 7, exigeTexto: true }], raca: [{ id: 6, exigeTexto: true }] };
const executor = {
  consultar: async (sql, p) => {
    const tabela = /FROM (\w+) WHERE id/.exec(sql)[1];
    return (LISTAS[tabela] || []).filter((o) => o.id === p.id);
  },
};
const dadosBase = { generoId: null, escolaridadeId: null, racaId: null, generoOutro: null, escolaridadeOutro: null, racaOutro: null };

test('pessoa: "Outra" sem texto => erro no campo do texto; com texto passa', async () => {
  const problemas = {};
  await pessoas.validarApoioPessoa({ ...dadosBase, generoId: 4, escolaridadeId: 7, racaId: 6, racaOutro: 'Quilombola' }, problemas, executor);
  assert.deepEqual(Object.keys(problemas).sort(), ['escolaridadeOutro', 'generoOutro']);
  assert.match(problemas.generoOutro, /gênero/);
});

test('pessoa: texto enviado com opção que não pede texto (ou sem opção) é descartado', async () => {
  const dados = { ...dadosBase, generoId: 1, generoOutro: 'sobra', racaOutro: 'sem opção' };
  const problemas = {};
  await pessoas.validarApoioPessoa(dados, problemas, executor);
  assert.deepEqual(problemas, {});
  assert.equal(dados.generoOutro, null);
  assert.equal(dados.racaOutro, null);
});

test('conferirOutro (família): prefixo do campo e descarte do texto', () => {
  const problemas = {};
  const m = { generoId: 4, generoOutro: null };
  pessoas.conferirOutro(m, 'generoId', 'generoOutro', LISTAS.genero, problemas, 'gênero', 'membros.2.');
  assert.ok(problemas['membros.2.generoOutro']);
  const n = { generoId: 1, generoOutro: 'x' };
  pessoas.conferirOutro(n, 'generoId', 'generoOutro', LISTAS.genero, {}, 'gênero');
  assert.equal(n.generoOutro, null);
});
