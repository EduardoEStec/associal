'use strict';

// Testes das regras puras do questionário: validação e comparação. Rodar: node --test tests/familias/

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validarRespostas, montarRespostas, compararFamilia, consolidarComparacao, montarModelo, PERGUNTAS, ESCALAS,
} = require('../../server/services/questionario');
const { QUESTIONARIO } = require('../../server/lib/dominios');

const HOJE = '2026-06-10';

const completo = (extra = {}) => ({
  dataAplicacao: '2026-06-01',
  qtdMembrosFamilia: 4, rendaMensalMedia: 1500, qtdMembrosComRenda: 1, recebeAuxilio: true, beneficioIds: [1], auxilioOutro: null,
  acessoAlimentosInNatura: 'SEMANAL_1_2', frequenciaFrutasVerduras: 'UMA_DUAS', qualidadeAlimentacao: 'NAO_MELHOROU', saudeNutricional: 'NENHUMA',
  conseguePoupar: false, economiaMensalFaixa: 'ATE_100', economiaMensalValor: 80, destinoEconomiaIds: [2], destinoEconomiaOutro: null,
  capacidadePoupanca: 'NAO_CONSEGUE', gestaoFinanceira: 'SEM_MUDANCA',
  empoderadaDecisoes: false, melhoriaPlanejamento: false, avaliacaoArmazem: 'BOA', recomendaria: true,
  ...extra,
});

test('modelo: todas as escalas batem com os códigos de dominios.js', () => {
  for (const [campo, ordem] of Object.entries(ESCALAS)) {
    assert.deepEqual([...ordem].sort(), Object.keys(QUESTIONARIO[campo]).sort(), campo);
  }
  const m = montarModelo('FINAL');
  assert.equal(m.blocos.length, 5);
  assert.match(m.blocos[0].perguntas[1].texto, /^Hoje,/);
  assert.equal(montarModelo('INICIAL').blocos[0].perguntas[1].texto.startsWith('Hoje'), false);
  const rotuloNaoTinha = m.blocos[1].perguntas[0].opcoes.find((o) => o.valor === 'NAO_TINHA').rotulo;
  assert.equal(rotuloNaoTinha, 'Não tem acesso');
});

test('rascunho aceita tudo vazio; só a data é preenchida com hoje', () => {
  const r = validarRespostas({}, { concluir: false, hoje: HOJE });
  assert.deepEqual(r.erros, {});
  assert.equal(r.valores.dataAplicacao, HOJE);
  assert.equal(r.valores.rendaMensalMedia, null);
});

test('rascunho rejeita código inválido, data futura e números fora da faixa', () => {
  const r = validarRespostas({
    dataAplicacao: '2026-07-01', acessoAlimentosInNatura: 'TALVEZ', qtdMembrosFamilia: 99, rendaMensalMedia: -5, recomendaria: 'quem sabe',
    beneficioIds: ['a'],
  }, { concluir: false, hoje: HOJE });
  for (const campo of ['dataAplicacao', 'acessoAlimentosInNatura', 'qtdMembrosFamilia', 'rendaMensalMedia', 'recomendaria', 'beneficioIds']) {
    assert.ok(r.erros[campo], `esperava erro em ${campo}`);
  }
});

test('conclusão completa é válida', () => {
  const r = validarRespostas(completo(), { concluir: true, hoje: HOJE });
  assert.deepEqual(r.erros, {});
  assert.deepEqual(r.beneficioIds, [1]);
});

test('conclusão exige respostas fechadas, auxílio detalhado e destino da economia', () => {
  const r = validarRespostas({ dataAplicacao: '2026-06-01', recebeAuxilio: true }, { concluir: true, hoje: HOJE });
  assert.ok(r.erros.rendaMensalMedia);
  assert.ok(r.erros.avaliacaoArmazem);
  assert.ok(r.erros.beneficioIds);
  assert.ok(r.erros.destinoEconomiaIds);
  assert.equal(r.erros.dataAplicacao, undefined);
});

test('economia: valor deve combinar com a faixa; ACIMA_300 exige valor', () => {
  let r = validarRespostas(completo({ economiaMensalFaixa: 'DE_101_200', economiaMensalValor: 80 }), { concluir: true, hoje: HOJE });
  assert.ok(r.erros.economiaMensalValor);
  r = validarRespostas(completo({ economiaMensalFaixa: 'ACIMA_300', economiaMensalValor: null }), { concluir: true, hoje: HOJE });
  assert.ok(r.erros.economiaMensalValor);
  r = validarRespostas(completo({ economiaMensalFaixa: 'ACIMA_300', economiaMensalValor: '450,50' }), { concluir: true, hoje: HOJE });
  assert.deepEqual(r.erros, {});
  assert.equal(r.valores.economiaMensalValor, 450.5);
  r = validarRespostas(completo({ economiaMensalFaixa: 'DE_101_200', economiaMensalValor: 100 }), { concluir: true, hoje: HOJE });
  assert.ok(r.erros.economiaMensalValor, 'R$ 100,00 é "Até R$ 100", não 101-200');
});

test('membros com renda não pode exceder membros da família', () => {
  const r = validarRespostas(completo({ qtdMembrosFamilia: 2, qtdMembrosComRenda: 3 }), { concluir: true, hoje: HOJE });
  assert.ok(r.erros.qtdMembrosComRenda);
});

test('sem auxílio: descarta o texto "outro"', () => {
  const r = validarRespostas(completo({ recebeAuxilio: false, auxilioOutro: 'algo' }), { concluir: true, hoje: HOJE });
  assert.equal(r.valores.auxilioOutro, null);
});

const respostas = (linha) => montarRespostas(linha, linha.beneficioIds || [], linha.destinoEconomiaIds || []);

test('comparação por família: melhorou / igual / piorou e variação de renda', () => {
  const inicial = respostas(completo());
  const final = respostas(completo({
    rendaMensalMedia: 1800, acessoAlimentosInNatura: 'DIARIO', avaliacaoArmazem: 'REGULAR',
    conseguePoupar: true, economiaMensalFaixa: 'DE_101_200', economiaMensalValor: 150, capacidadePoupanca: 'AS_VEZES',
    qtdMembrosFamilia: 5, destinoEconomiaIds: [2, 3],
  }));
  const c = compararFamilia(inicial, final, { destino_economia: { 2: 'Alimentação', 3: 'Saúde' }, beneficio: { 1: 'Bolsa Família' } });
  const item = (campo) => c.itens.find((i) => i.campo === campo);

  assert.equal(item('rendaMensalMedia').tendencia, 'melhorou');
  assert.equal(item('rendaMensalMedia').variacao, 300);
  assert.equal(item('rendaMensalMedia').variacaoPercentual, 20);
  assert.equal(item('acessoAlimentosInNatura').tendencia, 'melhorou');
  assert.equal(item('acessoAlimentosInNatura').inicialRotulo, '1-2 vezes por semana');
  assert.equal(item('frequenciaFrutasVerduras').tendencia, 'igual');
  assert.equal(item('avaliacaoArmazem').tendencia, 'piorou');
  assert.equal(item('conseguePoupar').tendencia, 'melhorou');
  assert.equal(item('qtdMembrosFamilia').tendencia, 'neutro', 'nº de pessoas mudou, sem juízo de valor');
  assert.equal(item('recebeAuxilio').tendencia, 'igual');
  assert.deepEqual(item('recebeAuxilio').detalheFinal, ['Bolsa Família']);
  assert.deepEqual(item('destinoEconomiaIds').final, ['Alimentação', 'Saúde']);
  assert.equal(item('contribuicaoAutonomia').tendencia, 'sem_dados');
  assert.equal(c.passouAPoupar, true);
  assert.equal(c.renda.variacao, 300);
  assert.equal(c.economia.variacao, 70);
  assert.equal(c.resumo.piorou, 1);
  assert.ok(c.resumo.melhorou >= 5);
  assert.equal(c.itens.length, PERGUNTAS.length);
});

test('comparação consolidada: distribuição, médias e % que passou a poupar', () => {
  const mk = (i, f) => ({ inicial: respostas(completo(i)), final: respostas(completo(f)), unidadeId: 1 });
  const pares = [
    mk({ rendaMensalMedia: 1000, conseguePoupar: false }, { rendaMensalMedia: 1400, conseguePoupar: true, acessoAlimentosInNatura: 'DIARIO' }),
    mk({ rendaMensalMedia: 2000, conseguePoupar: false }, { rendaMensalMedia: 2000, conseguePoupar: false }),
    mk({ rendaMensalMedia: 1500, conseguePoupar: true }, { rendaMensalMedia: 1200, conseguePoupar: true }),
  ];
  const r = consolidarComparacao(pares, {});
  assert.equal(r.totalFamilias, 3);
  assert.equal(r.destaques.rendaMedia.antes, 1500);
  assert.equal(r.destaques.rendaMedia.depois, 1533.33);
  assert.equal(r.destaques.poupanca.antes, 1);
  assert.equal(r.destaques.poupanca.depois, 2);
  assert.equal(r.destaques.poupanca.naoPoupavamAntes, 2);
  assert.equal(r.destaques.poupanca.passaramAPoupar, 1);
  assert.equal(r.destaques.poupanca.percentualPassaramAPoupar, 50);

  const q = r.perguntas.find((p) => p.campo === 'acessoAlimentosInNatura');
  assert.equal(q.melhoraram, 1);
  assert.equal(q.iguais, 2);
  assert.equal(q.depois.opcoes.find((o) => o.valor === 'DIARIO').familias, 1);
  assert.equal(q.antes.opcoes.find((o) => o.valor === 'SEMANAL_1_2').familias, 3);

  const renda = r.perguntas.find((p) => p.campo === 'rendaMensalMedia');
  assert.equal(renda.melhoraram, 1);
  assert.equal(renda.pioraram, 1);
  assert.equal(renda.iguais, 1);
});

test('consolidado vazio não quebra', () => {
  const r = consolidarComparacao([], {});
  assert.equal(r.totalFamilias, 0);
  assert.equal(r.destaques.poupanca.percentualPassaramAPoupar, null);
});
