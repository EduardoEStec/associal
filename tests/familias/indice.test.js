'use strict';

// Testes das regras puras do índice de progresso (F5) e da reavaliação rápida. Rodar: node --test tests/familias/

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VERSAO_REGRA, VERSAO_REGRA_LEGADO, calcularIndice, classificarVariacao, compararPontos, montarEvolucao, situacaoReavaliacao,
} = require('../../server/services/indice-progresso');
const { validarRespostas, montarModelo, PERGUNTAS_REAVALIACAO } = require('../../server/services/questionario');

const SM = 1600;

const base = (extra = {}) => ({
  qtdMembrosFamilia: 4, rendaMensalMedia: 1600, qtdMembrosComRenda: 1,
  acessoAlimentosInNatura: 'SEMANAL_1_2', frequenciaFrutasVerduras: 'UMA_DUAS', qualidadeAlimentacao: 'NAO_MELHOROU', saudeNutricional: 'NENHUMA',
  conseguePoupar: false, economiaMensalFaixa: 'ATE_100', capacidadePoupanca: 'NAO_CONSEGUE', gestaoFinanceira: 'SEM_MUDANCA',
  empoderadaDecisoes: false, melhoriaPlanejamento: false,
  ...extra,
});
const melhor = (extra = {}) => base({
  qtdMembrosFamilia: 2, rendaMensalMedia: 4000, qtdMembrosComRenda: 2,
  acessoAlimentosInNatura: 'DIARIO', frequenciaFrutasVerduras: 'CINCO_OU_MAIS', qualidadeAlimentacao: 'MELHOROU_MUITO', saudeNutricional: 'GRANDE_MELHORIA',
  conseguePoupar: true, economiaMensalFaixa: 'ACIMA_300', capacidadePoupanca: 'REGULARMENTE', gestaoFinanceira: 'MELHOROU',
  empoderadaDecisoes: true, melhoriaPlanejamento: true,
  ...extra,
});

test('escalas ordenadas: posição ÷ (opções − 1) × 100', () => {
  const r = calcularIndice(base({ acessoAlimentosInNatura: 'SEMANAL_2_3', frequenciaFrutasVerduras: 'TRES_QUATRO' }), { tipo: 'FINAL', salarioMinimo: SM });
  const itens = Object.fromEntries(r.dimensoes.ALIMENTACAO.itens.map((i) => [i.campo, i.pontos]));
  assert.equal(itens.acessoAlimentosInNatura, 66.67); // 3ª de 4 opções
  assert.equal(itens.frequenciaFrutasVerduras, 50); // 2ª de 3 opções
  assert.equal(itens.qualidadeAlimentacao, 33.33); // NAO_MELHOROU: 2ª de 4 (do pior ao melhor)
  assert.equal(itens.saudeNutricional, 0);
});

test('renda per capita por faixa de salário mínimo (¼, ½ e 1 SM)', () => {
  const nivel = (renda, membros) => calcularIndice(base({ rendaMensalMedia: renda, qtdMembrosFamilia: membros, qtdMembrosComRenda: 0 }), { tipo: 'FINAL', salarioMinimo: SM })
    .dimensoes.RENDA.itens.find((i) => i.campo === 'rendaMensalMedia').pontos;
  assert.equal(nivel(400, 1), 0); // exatamente ¼ SM: ainda na faixa mais baixa
  assert.equal(nivel(401, 1), 33.33);
  assert.equal(nivel(800, 1), 33.33); // exatamente ½
  assert.equal(nivel(801, 1), 66.67);
  assert.equal(nivel(1600, 1), 66.67); // exatamente 1 SM
  assert.equal(nivel(1601, 1), 100);
  assert.equal(nivel(3300, 4), 66.67, 'divide pelo número de pessoas (per capita)');
});

test('renda per capita: sem renda, sem nº de pessoas ou sem salário mínimo o item não existe (nunca zero)', () => {
  const itens = (r, sm = SM) => calcularIndice(r, { tipo: 'FINAL', salarioMinimo: sm }).dimensoes.RENDA.itens.map((i) => i.campo);
  assert.ok(!itens(base({ rendaMensalMedia: null })).includes('rendaMensalMedia'));
  assert.ok(!itens(base({ qtdMembrosFamilia: null })).includes('rendaMensalMedia'));
  assert.ok(!itens(base(), 0).includes('rendaMensalMedia'));
});

test('proporção de pessoas com renda: 1c ÷ 1a, no máximo 100; zero pessoas com renda vale 0 (é uma resposta)', () => {
  const p = (com, total) => calcularIndice(base({ qtdMembrosComRenda: com, qtdMembrosFamilia: total }), { tipo: 'FINAL', salarioMinimo: SM })
    .dimensoes.RENDA.itens.find((i) => i.campo === 'qtdMembrosComRenda').pontos;
  assert.equal(p(1, 4), 25);
  assert.equal(p(0, 4), 0);
  assert.equal(p(5, 4), 100);
});

test('dimensão só existe com pelo menos metade dos itens respondidos; senão fica vazia', () => {
  // Alimentação tem 4 itens: 1 resposta não basta, 2 bastam
  const um = calcularIndice({ acessoAlimentosInNatura: 'DIARIO' }, { tipo: 'FINAL', salarioMinimo: SM });
  assert.equal(um.dimensoes.ALIMENTACAO.nivel, null);
  assert.equal(um.dimensoes.ALIMENTACAO.itensValidos, 1);
  const dois = calcularIndice({ acessoAlimentosInNatura: 'DIARIO', frequenciaFrutasVerduras: 'CINCO_OU_MAIS' }, { tipo: 'FINAL', salarioMinimo: SM });
  assert.equal(dois.dimensoes.ALIMENTACAO.nivel, 100);
  // Autonomia tem 2 itens: 1 basta
  assert.equal(calcularIndice({ empoderadaDecisoes: true }, { tipo: 'FINAL' }).dimensoes.AUTONOMIA.nivel, 100);
});

test('itens de percepção pesam metade no INICIAL e inteiro no FINAL', () => {
  const r = base({ acessoAlimentosInNatura: 'DIARIO', frequenciaFrutasVerduras: 'CINCO_OU_MAIS', qualidadeAlimentacao: 'PIOROU', saudeNutricional: 'NENHUMA' });
  const ini = calcularIndice(r, { tipo: 'INICIAL', salarioMinimo: SM }).dimensoes.ALIMENTACAO.nivel;
  const fin = calcularIndice(r, { tipo: 'FINAL', salarioMinimo: SM }).dimensoes.ALIMENTACAO.nivel;
  assert.equal(ini, 66.67); // (100 + 100 + 0·½ + 0·½) ÷ 3
  assert.equal(fin, 50); // (100 + 100 + 0 + 0) ÷ 4
});

test('índice geral = média simples das dimensões com nível; nunca conta dimensão vazia como zero', () => {
  const completo = calcularIndice(melhor(), { tipo: 'FINAL', salarioMinimo: SM });
  assert.equal(completo.geral.dimensoes, 4);
  assert.equal(completo.geral.nivel, 100);
  const parcial = calcularIndice({ empoderadaDecisoes: true, melhoriaPlanejamento: true }, { tipo: 'FINAL' });
  assert.equal(parcial.geral.dimensoes, 1);
  assert.equal(parcial.geral.nivel, 100);
  const vazio = calcularIndice({}, { tipo: 'FINAL' });
  assert.equal(vazio.geral.nivel, null);
  assert.equal(vazio.dimensoes.RENDA.nivel, null);
});

test('registra a versão da regra e os parâmetros usados', () => {
  const r = calcularIndice(base(), { tipo: 'FINAL', salarioMinimo: SM });
  assert.equal(r.versaoRegra, VERSAO_REGRA_LEGADO);
  assert.equal(r.parametros.salarioMinimo, SM);
  assert.equal(r.parametros.rendaPerCapita, 400);
});

test('semáforo: tolerância de 5 pontos; igual dentro da faixa; sem dados quando falta um lado', () => {
  assert.deepEqual(classificarVariacao(50, 55), { diferenca: 5, selo: 'melhorou' });
  assert.deepEqual(classificarVariacao(50, 54.99), { diferenca: 4.99, selo: 'igual' });
  assert.deepEqual(classificarVariacao(50, 45), { diferenca: -5, selo: 'piorou' });
  assert.deepEqual(classificarVariacao(50, 50), { diferenca: 0, selo: 'igual' });
  assert.deepEqual(classificarVariacao(null, 50), { diferenca: null, selo: 'sem_dados' });
  assert.deepEqual(classificarVariacao(50, undefined), { diferenca: null, selo: 'sem_dados' });
  assert.equal(classificarVariacao(50, 60, 10).selo, 'melhorou', 'tolerância editável');
  assert.equal(classificarVariacao(50, 58, 10).selo, 'igual');
});

test('compararPontos: geral usa só as dimensões com nível nos dois pontos', () => {
  const a = calcularIndice(base(), { tipo: 'INICIAL', salarioMinimo: SM });
  const b = calcularIndice(melhor(), { tipo: 'FINAL', salarioMinimo: SM });
  const c = compararPontos(a, b);
  assert.equal(c.geral.selo, 'melhorou');
  assert.equal(c.geral.dimensoesComparadas, 4);
  for (const dim of ['ALIMENTACAO', 'RENDA', 'ECONOMIA', 'AUTONOMIA']) assert.equal(c.dimensoes[dim].selo, 'melhorou', dim);

  // o ponto final sem Autonomia não faz o geral "subir" nem "cair" só pela dimensão que sumiu
  const semAut = { ...b, dimensoes: { ...b.dimensoes, AUTONOMIA: { nivel: null, itensValidos: 0, itensTotal: 2 } } };
  const c2 = compararPontos(a, semAut);
  assert.equal(c2.geral.dimensoesComparadas, 3);
  assert.equal(c2.dimensoes.AUTONOMIA.selo, 'sem_dados');
});

test('piorou e igual aparecem de verdade', () => {
  const a = calcularIndice(melhor(), { tipo: 'INICIAL', salarioMinimo: SM });
  const b = calcularIndice(base(), { tipo: 'FINAL', salarioMinimo: SM });
  assert.equal(compararPontos(a, b).geral.selo, 'piorou');
  assert.equal(compararPontos(a, a).geral.selo, 'igual');
});

test('evolução: ordena por data, compara primeiro × último e cada passo', () => {
  const ini = { tipo: 'INICIAL', dataRef: '2026-01-10', ...calcularIndice(base(), { tipo: 'INICIAL', salarioMinimo: SM }) };
  const rea = { tipo: 'REAVALIACAO', dataRef: '2026-02-25', ...calcularIndice(base({ conseguePoupar: true, empoderadaDecisoes: true }), { tipo: 'REAVALIACAO', salarioMinimo: SM }) };
  const fin = { tipo: 'FINAL', dataRef: '2026-04-10', ...calcularIndice(melhor(), { tipo: 'FINAL', salarioMinimo: SM }) };
  const e = montarEvolucao([fin, ini, rea]);
  assert.deepEqual(e.pontos.map((p) => p.tipo), ['INICIAL', 'REAVALIACAO', 'FINAL']);
  assert.equal(e.passos.length, 2);
  assert.deepEqual([e.comparacao.de, e.comparacao.para], ['INICIAL', 'FINAL']);
  assert.equal(e.comparacao.geral.selo, 'melhorou');
  assert.equal(montarEvolucao([ini]).comparacao, null);
  assert.deepEqual(montarEvolucao([]).pontos, []);
});

test('reavaliação: pendente só depois da data, dispensada com o final feito, não se aplica sem o inicial', () => {
  const p = { status: 'EM_ANDAMENTO', inicialConcluido: true, reavaliacaoConcluida: false, finalConcluido: false, dataInicio: '2026-01-01T00:00:00.000Z', reavaliacaoDias: 45 };
  assert.deepEqual(situacaoReavaliacao({ ...p, hoje: '2026-02-14' }), { situacao: 'AGENDADA', dataPrevista: '2026-02-15' });
  assert.equal(situacaoReavaliacao({ ...p, hoje: '2026-02-15' }).situacao, 'PENDENTE');
  assert.equal(situacaoReavaliacao({ ...p, hoje: '2026-05-01', finalConcluido: true }).situacao, 'DISPENSADA');
  assert.equal(situacaoReavaliacao({ ...p, hoje: '2026-05-01', inicialConcluido: false }).situacao, 'NAO_SE_APLICA');
  assert.equal(situacaoReavaliacao({ ...p, hoje: '2026-05-01', status: 'DESLIGADO' }).situacao, 'NAO_SE_APLICA');
  assert.equal(situacaoReavaliacao({ ...p, hoje: '2026-01-02', reavaliacaoConcluida: true }).situacao, 'CONCLUIDA');
  // o banco devolve a data como Date
  assert.deepEqual(situacaoReavaliacao({ ...p, dataInicio: new Date('2026-01-01T00:00:00Z'), hoje: '2026-02-14' }), { situacao: 'AGENDADA', dataPrevista: '2026-02-15' });
});

// ---------- reavaliação rápida no questionário ----------

test('modelo da reavaliação: só as perguntas de estado, no presente', () => {
  const m = montarModelo('REAVALIACAO');
  const campos = m.blocos.flatMap((b) => b.perguntas.map((p) => p.campo));
  assert.deepEqual(campos.sort(), [...PERGUNTAS_REAVALIACAO].sort());
  assert.equal(m.blocos.length, 4, 'o bloco 5 (percepção) não entra');
  assert.equal(campos.length, 10); // 9 perguntas + a confirmação do nº de pessoas
  const acesso = m.blocos[1].perguntas.find((p) => p.campo === 'acessoAlimentosInNatura');
  assert.equal(acesso.opcoes[0].rotulo, 'Não tem acesso');
});

test('a reavaliação não altera as perguntas oficiais: INICIAL e FINAL continuam com 5 blocos e todas as perguntas', () => {
  for (const tipo of ['INICIAL', 'FINAL']) {
    const m = montarModelo(tipo);
    assert.equal(m.blocos.length, 5);
    assert.equal(m.blocos.flatMap((b) => b.perguntas).length, 21);
  }
});

const HOJE = '2026-06-10';
const respostasReav = (extra = {}) => ({
  dataAplicacao: '2026-06-01', qtdMembrosFamilia: 4, rendaMensalMedia: 1500, qtdMembrosComRenda: 1,
  acessoAlimentosInNatura: 'SEMANAL_2_3', frequenciaFrutasVerduras: 'TRES_QUATRO',
  conseguePoupar: true, economiaMensalFaixa: 'DE_101_200', economiaMensalValor: 150, capacidadePoupanca: 'AS_VEZES',
  empoderadaDecisoes: true, melhoriaPlanejamento: true,
  ...extra,
});

test('validação da reavaliação: concluir exige só as perguntas de estado (sem auxílio, destino nem bloco 5)', () => {
  const ok = validarRespostas(respostasReav(), { concluir: true, hoje: HOJE, tipo: 'REAVALIACAO' });
  assert.deepEqual(ok.erros, {});
  assert.deepEqual(ok.destinoEconomiaIds, []);
  assert.equal(ok.valores.recebeAuxilio, null);
  const falta = validarRespostas(respostasReav({ capacidadePoupanca: null }), { concluir: true, hoje: HOJE, tipo: 'REAVALIACAO' });
  assert.ok(falta.erros.capacidadePoupanca);
  // o mesmo corpo NÃO conclui um questionário final
  const final = validarRespostas(respostasReav(), { concluir: true, hoje: HOJE, tipo: 'FINAL' });
  assert.ok(final.erros.recebeAuxilio && final.erros.avaliacaoArmazem);
});

test('reavaliação ignora campos de fora do subconjunto (nada de bloco 5 ou percepção gravado)', () => {
  const r = validarRespostas(respostasReav({ avaliacaoArmazem: 'BOA', recomendaria: true, qualidadeAlimentacao: 'PIOROU', recebeAuxilio: true, beneficioIds: [1] }),
    { concluir: true, hoje: HOJE, tipo: 'REAVALIACAO' });
  assert.equal(r.valores.avaliacaoArmazem, null);
  assert.equal(r.valores.recomendaria, null);
  assert.equal(r.valores.qualidadeAlimentacao, null);
  assert.equal(r.valores.recebeAuxilio, null);
  assert.deepEqual(r.beneficioIds, []);
});

test('reavaliação mantém as coerências (renda com valor/faixa, pessoas com renda ≤ pessoas)', () => {
  const r = validarRespostas(respostasReav({ economiaMensalValor: 500 }), { concluir: true, hoje: HOJE, tipo: 'REAVALIACAO' });
  assert.ok(r.erros.economiaMensalValor);
  const s = validarRespostas(respostasReav({ qtdMembrosComRenda: 9 }), { concluir: true, hoje: HOJE, tipo: 'REAVALIACAO' });
  assert.ok(s.erros.qtdMembrosComRenda);
  const rascunho = validarRespostas({ rendaMensalMedia: 900 }, { concluir: false, hoje: HOJE, tipo: 'REAVALIACAO' });
  assert.deepEqual(rascunho.erros, {});
});
