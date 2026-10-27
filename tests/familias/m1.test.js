'use strict';

// Testes unitários (sem banco) dos modelos oficiais M1: definições, modelo das telas, comparação por pares,
// consolidação, índice de progresso v2 (com opção acrescentada pela coordenação) e textos do relatório final familiar.
// Rodar: node --test tests/familias/m1.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const m1 = require('../../server/services/modelos-m1');
const estado = require('../../server/services/catalogo-estado');
const catalogo = require('../../server/services/catalogo');
const qm1 = require('../../server/services/questionario-m1');
const regras = require('../../server/services/indice-progresso');
const extras = require('../../server/services/extras');
const textos = require('../../server/services/relatorios-textos');
const textosM1 = require('../../server/services/relatorios-textos-m1');
const { RESPOSTAS_INICIAL, RESPOSTAS_FINAL } = require('./m1-dados');

test.beforeEach(() => estado.restaurarPadrao());
test.after(() => estado.restaurarPadrao());

const codigosDe = (formulario) => m1.PERGUNTAS_PADRAO[formulario].map((p) => p.codigo);

// ---------- definições (modelos em papel) ----------

test('inicial tem 14 perguntas em 3 seções; final tem 21 em 4 seções, com códigos únicos e as seções do papel', () => {
  assert.equal(m1.PERGUNTAS_PADRAO.QUESTIONARIO_INICIAL.length, 14);
  assert.equal(m1.PERGUNTAS_PADRAO.QUESTIONARIO_FINAL.length, 21);
  for (const f of m1.FORMULARIOS_M1) assert.equal(new Set(codigosDe(f)).size, codigosDe(f).length);
  assert.deepEqual(m1.SECOES.QUESTIONARIO_INICIAL.map((s) => s.numero), [1, 2, 3]);
  assert.deepEqual(m1.SECOES.QUESTIONARIO_FINAL.map((s) => s.numero), [1, 2, 3, 4]);
  assert.deepEqual(codigosDe('QUESTIONARIO_FINAL').filter((c) => c.startsWith('1.')), ['1.2', '1.3', '1.4']);
});

test('divergências resolvidas pelo usuário: 3.6 do inicial só Sim/Parcialmente/Não; 3.2 do final com a faixa 301–400', () => {
  const p36 = m1.PERGUNTAS_PADRAO.QUESTIONARIO_INICIAL.find((p) => p.codigo === '3.6');
  assert.deepEqual(p36.opcoes.map((o) => o.texto), ['Sim', 'Parcialmente', 'Não']);
  const p32 = m1.PERGUNTAS_PADRAO.QUESTIONARIO_FINAL.find((p) => p.codigo === '3.2');
  assert.deepEqual(p32.opcoes.map((o) => o.texto), [
    'Até R$ 100,00', 'De R$ 101,00 a R$ 300,00', 'De R$ 301,00 a R$ 400,00', 'Acima de R$ 400,00', 'Outro valor',
  ]);
});

test('textos e opções seguem o papel (inclusive a ordem escrita no modelo)', () => {
  const ini = Object.fromEntries(m1.PERGUNTAS_PADRAO.QUESTIONARIO_INICIAL.map((p) => [p.codigo, p]));
  assert.deepEqual(ini['3.2'].opcoes.map((o) => o.texto), ['Algumas vezes', 'Frequentemente', 'Raramente', 'Nunca']);
  assert.deepEqual(ini['2.1'].opcoes.map((o) => o.texto), [
    'Trabalho formal', 'Trabalho informal/autônomo', 'Aposentadoria/pensão', 'Benefício de transferência de renda/assistencial',
    'Benefício previdenciário', 'Outras', 'Sem renda no momento']);
  assert.equal(ini['2.5'].texto, 'A família relata dificuldade para custear despesas básicas?');
  const fin = Object.fromEntries(m1.PERGUNTAS_PADRAO.QUESTIONARIO_FINAL.map((p) => [p.codigo, p]));
  assert.deepEqual(fin['3.3'].opcoes.map((o) => o.texto), ['Moradia', 'Energia elétrica/Água', 'Transporte', 'Saúde', 'Educação', 'Vestuário', 'Lazer', 'Outras']);
  assert.equal(fin['3.3'].tipo, 'MULTIPLA');
  assert.equal(fin['4.6'].tipo, 'SIM_NAO');
  assert.equal(fin['4.1'].texto, 'Quais as principais mudanças a família atribui após o acesso ao Armazém Solidário?');
});

test('pares equivalentes apontam para perguntas que existem nos dois modelos; reavaliação só usa perguntas do final com par', () => {
  for (const par of m1.PARES) {
    assert.ok(codigosDe('QUESTIONARIO_INICIAL').includes(par.inicial), par.chave);
    assert.ok(codigosDe('QUESTIONARIO_FINAL').includes(par.final), par.chave);
  }
  const doPar = m1.PARES.map((p) => p.final);
  assert.ok(m1.CODIGOS_REAVALIACAO.every((c) => doPar.includes(c)));
  assert.deepEqual(m1.COMPARATIVAS_FINAL.map((c) => c.codigo), ['1.4', '2.8', '3.4']);
});

// ---------- modelo entregue à tela ----------

test('modelo das telas: inicial e final diferentes; reavaliação com 5 perguntas; opções com "pede detalhe"', () => {
  const i = qm1.montarModeloM1('INICIAL');
  const f = qm1.montarModeloM1('FINAL');
  const r = qm1.montarModeloM1('REAVALIACAO');
  assert.equal(i.modelo, 'M1');
  assert.equal(i.blocos.flatMap((b) => b.perguntas).length, 14);
  assert.equal(f.blocos.flatMap((b) => b.perguntas).length, 21);
  assert.deepEqual(r.blocos.flatMap((b) => b.perguntas).map((p) => p.codigo), ['1.3', '2.4', '2.5', '2.6', '2.7']);
  const fonte = i.blocos[1].perguntas.find((p) => p.codigo === '2.1');
  assert.equal(fonte.tipo, 'escolha');
  assert.equal(fonte.opcoes.find((o) => o.valor === 'OUTRAS').pedeDetalhe, true);
  assert.equal(f.blocos[2].perguntas.find((p) => p.codigo === '3.3').tipo, 'multipla');
  assert.equal(f.blocos[3].perguntas.find((p) => p.codigo === '4.6').tipo, 'booleano');
  assert.equal(i.blocos[0].perguntas.find((p) => p.codigo === '1.1').max, 30);
});

// ---------- catálogo: texto renomeado, opção acrescentada, pergunta adicional ----------

function catalogoComExtras() {
  const padrao = estado.catalogoPadraoM1();
  const p32 = padrao.QUESTIONARIO_INICIAL.find((p) => p.codigo === '3.2');
  const nunca = p32.opcoes.find((o) => o.codigo === 'NUNCA');
  const perguntas = [];
  const opcoes = [];
  for (const form of m1.FORMULARIOS_M1) {
    for (const p of padrao[form]) {
      perguntas.push({ ...p, oficial: 1, obrigatoria: p.obrigatoria ? 1 : 0, ativa: 1, textoFinal: null });
      for (const o of p.opcoes) opcoes.push({ ...o, perguntaId: p.id, base: 1, ativa: 1, equivaleAId: null, equivaleCodigo: null, equivalePontos: null, pedeDetalhe: o.pedeDetalhe ? 1 : 0 });
    }
  }
  // opção acrescentada ao 3.2 do inicial: vale como "Nunca"; outra que não pontua; e uma pergunta adicional no final
  opcoes.push({ id: 9001, perguntaId: p32.id, codigo: 'OP01', texto: 'Só no fim do mês', textoFinal: null, ordem: 50, ativa: 1, base: 0, posicao: null, pontos: null, pedeDetalhe: 0, equivaleAId: nunca.id, equivaleCodigo: 'NUNCA', equivalePontos: 100 });
  opcoes.push({ id: 9002, perguntaId: p32.id, codigo: 'OP02', texto: 'Não sabe informar', textoFinal: null, ordem: 60, ativa: 1, base: 0, posicao: null, pontos: null, pedeDetalhe: 0, equivaleAId: null, equivaleCodigo: null, equivalePontos: null });
  perguntas.push({ id: 9100, formulario: 'QUESTIONARIO_FINAL', secao: 4, codigo: 'E0001', oficial: 0, campo: null, tipo: 'TEXTO', texto: 'Algum recado?', textoFinal: null, ajuda: null, obrigatoria: 0, ordem: 500, ativa: 1 });
  perguntas[0] = { ...perguntas[0], texto: 'Quantas pessoas moram na casa?' };
  return catalogo.montarCatalogo(perguntas, opcoes);
}

test('catálogo M1: texto renomeado vale, extra entra no fim da seção, opção acrescentada aparece no modelo', () => {
  estado.definir(catalogoComExtras());
  const i = qm1.montarModeloM1('INICIAL');
  assert.equal(i.blocos[0].perguntas[0].texto, 'Quantas pessoas moram na casa?');
  assert.equal(i.blocos[0].perguntas[0].codigo, '1.1', 'o código não muda');
  assert.deepEqual(i.blocos[2].perguntas.find((p) => p.codigo === '3.2').opcoes.map((o) => o.valor), ['ALGUMAS_VEZES', 'FREQUENTEMENTE', 'RARAMENTE', 'NUNCA', 'OP01', 'OP02']);
  const f = qm1.montarModeloM1('FINAL');
  const ultima = f.blocos[3].perguntas[f.blocos[3].perguntas.length - 1];
  assert.equal(ultima.codigo, 'E0001');
  assert.equal(ultima.extra, true);
  assert.equal(qm1.montarModeloM1('REAVALIACAO').blocos.flatMap((b) => b.perguntas).some((p) => p.extra), false);
});

test('pontos da opção acrescentada: vale como a base; "não pontua" => null; oficial usa os seus', () => {
  estado.definir(catalogoComExtras());
  assert.equal(estado.pontosM1('QUESTIONARIO_INICIAL', '3.2', 'NUNCA'), 100);
  assert.equal(estado.pontosM1('QUESTIONARIO_INICIAL', '3.2', 'OP01'), 100);
  assert.equal(estado.pontosM1('QUESTIONARIO_INICIAL', '3.2', 'OP02'), null);
  assert.equal(estado.pontosM1('QUESTIONARIO_INICIAL', '2.1', 'TRABALHO_FORMAL'), null, 'fonte de renda não pontua');
  assert.equal(estado.pontosM1('QUESTIONARIO_INICIAL', '3.2', 'INEXISTENTE'), null);
});

// ---------- índice de progresso v2 ----------

const mapaIni = (extra = {}) => ({ modelo: 'M1', mapa: { ...RESPOSTAS_INICIAL, ...extra } });
const mapaFin = (extra = {}) => ({ modelo: 'M1', mapa: { ...RESPOSTAS_FINAL, ...extra } });

test('índice v2: só os pares entram — Alimentação (4) e Renda (1); Economia e Autonomia ficam sem nível (nunca zero)', () => {
  const i = regras.calcularIndice(mapaIni(), { tipo: 'INICIAL' });
  assert.equal(i.versaoRegra, 2);
  assert.equal(i.dimensoes.ALIMENTACAO.itensTotal, 4);
  assert.equal(i.dimensoes.ALIMENTACAO.nivel, 0);
  assert.equal(i.dimensoes.RENDA.nivel, 25);
  assert.equal(i.dimensoes.ECONOMIA.nivel, null);
  assert.equal(i.dimensoes.ECONOMIA.itensTotal, 0);
  assert.equal(i.dimensoes.AUTONOMIA.nivel, null);
  assert.equal(i.geral.nivel, 12.5);
  assert.equal(i.geral.dimensoes, 2);
  const f = regras.calcularIndice(mapaFin(), { tipo: 'FINAL' });
  assert.equal(f.dimensoes.ALIMENTACAO.nivel, 100);
  assert.equal(f.dimensoes.RENDA.nivel, 50);
  assert.equal(f.geral.nivel, 75);
});

test('índice v2: dimensão exige metade dos itens; reavaliação usa o subconjunto do final; compararPontos ignora dimensão sem nível', () => {
  const parcial = regras.calcularIndice({ modelo: 'M1', mapa: { '2.5': 'SIM' } }, { tipo: 'FINAL' });
  assert.equal(parcial.dimensoes.ALIMENTACAO.nivel, null, '1 de 4 itens: abaixo da metade');
  const dois = regras.calcularIndice({ modelo: 'M1', mapa: { '2.5': 'SIM', '2.6': 'NAO' } }, { tipo: 'FINAL' });
  assert.equal(dois.dimensoes.ALIMENTACAO.nivel, 100);
  const reav = regras.calcularIndice({ modelo: 'M1', mapa: { '1.3': 'DE_1001_2000', '2.4': 'TRES_QUATRO', '2.5': 'PARCIALMENTE', '2.6': 'ALGUMAS_VEZES', '2.7': 'NAO' } }, { tipo: 'REAVALIACAO' });
  assert.equal(reav.dimensoes.ALIMENTACAO.nivel, (67 + 50 + 50 + 100) / 4);
  const cmp = regras.compararPontos(regras.calcularIndice(mapaIni(), { tipo: 'INICIAL' }), regras.calcularIndice(mapaFin(), { tipo: 'FINAL' }));
  assert.equal(cmp.geral.dimensoesComparadas, 2);
  assert.equal(cmp.geral.selo, 'melhorou');
  assert.equal(cmp.dimensoes.ECONOMIA.selo, 'sem_dados');
});

test('índice v2 com opção acrescentada: vale como a base; "não pontua" reduz os itens válidos; o formato anterior continua na regra 1', () => {
  estado.definir(catalogoComExtras());
  const dim = (respostas) => regras.calcularIndice(respostas, { tipo: 'INICIAL' }).dimensoes.ALIMENTACAO;
  const base = dim(mapaIni({ '3.2': 'NUNCA' }));
  const nova = dim(mapaIni({ '3.2': 'OP01' }));
  const naoPontua = dim(mapaIni({ '3.2': 'OP02' }));
  assert.equal(nova.nivel, base.nivel);
  assert.equal(nova.itensValidos, base.itensValidos);
  assert.equal(naoPontua.itensValidos, base.itensValidos - 1);
  assert.equal(regras.versaoDoModelo('M1'), 2);
  assert.equal(regras.versaoDoModelo('LEGADO'), 1);
  assert.equal(regras.calcularIndice({ rendaMensalMedia: 1000, qtdMembrosFamilia: 2 }, { tipo: 'FINAL' }).versaoRegra, 1);
});

// ---------- comparação por pares ----------

test('comparação por pares: melhorou/igual/piorou por pontos; fonte de renda só "mudou"; frutas é aproximada; perguntas comparativas do final', () => {
  const ini = { mapa: { ...RESPOSTAS_INICIAL }, detalhes: {} };
  const fin = { mapa: { ...RESPOSTAS_FINAL, '1.2': 'TRABALHO_FORMAL', '2.7': 'SIM', '1.4': 'PIOROU', '2.8': 'NAO_AVALIAR' }, detalhes: {} };
  const c = qm1.compararPares(ini, fin);
  const por = Object.fromEntries(c.itens.map((i) => [i.chave, i]));
  assert.equal(por.alimentosSuficientes.tendencia, 'melhorou');
  assert.equal(por.deixouRefeicao.tendencia, 'igual', 'Sim (0) → Sim (0)');
  assert.equal(por.rendaFaixa.tendencia, 'melhorou');
  assert.equal(por.fonteRenda.tendencia, 'neutro');
  assert.equal(por.frutasVerduras.aproximado, true);
  assert.equal(por.frutasVerduras.final.rotulo, '5 ou mais vezes por semana');
  const comp = Object.fromEntries(c.comparativas.map((x) => [x.codigo, x]));
  assert.equal(comp['1.4'].tendencia, 'piorou');
  assert.equal(comp['2.8'].tendencia, 'sem_dados');
  assert.equal(comp['3.4'].tendencia, 'melhorou');
  assert.equal(c.resumo.comparaveis, c.resumo.melhorou + c.resumo.igual + c.resumo.piorou);
  // sem resposta de um lado => sem dados
  assert.equal(qm1.compararPares({ mapa: {} }, fin).itens.every((i) => i.tendencia === 'sem_dados'), true);
});

test('consolidação para o relatório semestral: tabelas indicadores/distribuições no mesmo formato de antes', () => {
  const pares = [
    { inicial: { mapa: { ...RESPOSTAS_INICIAL }, detalhes: {} }, final: { mapa: { ...RESPOSTAS_FINAL }, detalhes: {} } },
    { inicial: { mapa: { ...RESPOSTAS_INICIAL, '3.2': 'NUNCA' }, detalhes: {} }, final: { mapa: { ...RESPOSTAS_FINAL, '2.5': 'NAO', '4.6': false }, detalhes: {} } },
  ];
  const c = qm1.consolidarM1(pares);
  assert.equal(c.pares, 2);
  const alim = c.porPar.find((p) => p.chave === 'alimentosSuficientes');
  assert.deepEqual([alim.melhoraram, alim.iguais, alim.pioraram], [1, 0, 1]);
  assert.ok(c.indicadores.some((i) => /Recomendaria o projeto \(sim\)/.test(i.rotulo) && /50,0%/.test(i.final)));
  assert.ok(c.distribuicoes.some((d) => d.pergunta === 'Economia mensal no armazém (final)' && d.resposta === 'De R$ 301,00 a R$ 400,00' && d.final === '2'));
  assert.ok(c.distribuicoes.every((d) => ['inicial', 'final', 'pergunta', 'resposta'].every((k) => k in d)));
});

// ---------- validação ----------

test('validação das respostas: faixa numérica das oficiais, complemento da opção, regra "pessoas com renda ≤ integrantes"', () => {
  const defs = estado.m1Ativas('QUESTIONARIO_INICIAL');
  let r = extras.validarExtras(defs, { ...RESPOSTAS_INICIAL, '1.1': 31, '2.3': 1.5 }, { concluir: true });
  assert.ok(r.erros['extras.1.1']);
  assert.ok(r.erros['extras.2.3']);
  r = extras.validarExtras(defs, { ...RESPOSTAS_INICIAL, '2.1': 'OUTRAS' }, { concluir: true, detalhes: { '2.1': 'Venda de doces' } });
  assert.deepEqual(r.erros, {});
  assert.equal(r.itens.find((i) => i.valorTexto).valorTexto, 'Venda de doces');
  r = extras.validarExtras(defs, { ...RESPOSTAS_INICIAL, '2.1': 'OUTRAS' }, { concluir: true, detalhes: { '2.1': 'x'.repeat(201) } });
  assert.ok(r.erros['detalhes.2.1']);
  r = extras.validarExtras(defs, { '2.2': 'ATE_500' }, { concluir: true });
  assert.ok(r.erros['extras.2.1'] && !r.erros['extras.2.2'] && !r.erros['extras.3.1'], 'textos livres não são obrigatórios');
  assert.deepEqual(qm1.validarRegrasM1('INICIAL', { '1.1': 2, '2.3': 3 }), { 'extras.2.3': 'Não pode ser maior que o número de integrantes da família.' });
  assert.deepEqual(qm1.validarRegrasM1('INICIAL', { '1.1': 4, '2.3': 3 }), {});
});

test('respostas legíveis: múltipla com complemento, sim/não e opção desconhecida', () => {
  assert.equal(qm1.rotuloResposta('QUESTIONARIO_FINAL', '3.3', ['MORADIA', 'OUTRAS'], 'Gás'), 'Moradia; Outras: Gás');
  assert.equal(qm1.rotuloResposta('QUESTIONARIO_FINAL', '4.6', true), 'Sim');
  assert.equal(qm1.rotuloResposta('QUESTIONARIO_FINAL', '4.6', false), 'Não');
  assert.equal(qm1.rotuloResposta('QUESTIONARIO_FINAL', '2.5', 'PARCIALMENTE'), 'Parcialmente');
  assert.equal(qm1.rotuloResposta('QUESTIONARIO_FINAL', '2.5', null), null);
});

// ---------- relatório final familiar (modelo 4) ----------

test('relatório final familiar: seções geradas dos questionários M1 e textos fixos do modelo 4', () => {
  const lista = (form, mapa) => ({ mapa, detalhes: { '3.3': 'Gás' }, lista: [] });
  const ini = lista('i', { ...RESPOSTAS_INICIAL });
  const fin = lista('f', { ...RESPOSTAS_FINAL });
  const d = textosM1.diagnosticoM1(ini).join('\n');
  assert.match(d, /composta por 4 integrantes, com predominância de adultos \(18 a 59 anos\)/);
  assert.match(d, /Situação do CadÚnico: atualizado/);
  assert.match(d, /Situação alimentar no início do acompanhamento: Família relata falta de alimentos/);
  assert.match(d, /acesso regular a frutas, verduras e legumes: não/);
  const imp = textosM1.impactoM1(ini, fin);
  assert.match(imp.impactoAlimentar, /Alimentos suficientes para todos: de "Frequentemente" para "Sim" \(houve melhora\)/);
  assert.match(imp.impactoAlimentar, /qualidade da alimentação após o acesso aos produtos mais baratos, a família relata: melhorou muito/);
  assert.match(imp.impactoEconomico, /Renda familiar mensal: de "De R\$ 501,00 a R\$ 1\.000,00" para "De R\$ 1\.001,00 a R\$ 2\.000,00"/);
  assert.match(imp.impactoEconomico, /Foi relatada pela família a contribuição dos preços do Armazém Solidário para a redução das despesas com alimentação/);
  assert.match(imp.impactoEconomico, /priorizada para: moradia; Outras: Gás/);
  assert.match(imp.impactoDesafios, /Impacto do projeto na comunidade local, segundo a família: O bairro/);
  const fb = textosM1.feedbackM1(fin).join('\n');
  assert.match(fb, /Principais mudanças que a família atribui/);
  assert.match(fb, /avaliou o Armazém Solidário como "Boa" e recomendaria o projeto/);
  const cons = textosM1.consideracoesM1(imp.comparado, { total: 3 });
  assert.match(cons, /8 respostas indicaram melhora/);
  assert.match(cons, /registros periódicos referentes aos atendimentos, utilização do Armazém, orientações, encaminhamentos/);
  assert.match(cons, /3 contatos foram registrados/);
});

test('relatório final familiar: sem inicial M1 só descreve o estado final; textos fixos vêm do modelo oficial', () => {
  const fin = { mapa: { ...RESPOSTAS_FINAL }, detalhes: {}, lista: [] };
  const imp = textosM1.impactoM1(null, fin);
  assert.match(imp.impactoAlimentar, /Alimentos suficientes para todos: sim\./);
  assert.equal(imp.comparado, null);
  assert.match(textos.INDIVIDUAL_FIXOS.objetivo, /10 famílias locais vinculadas ao projeto/);
  assert.match(textos.INDIVIDUAL_FIXOS.objetivo, /Indicador: Número de famílias apoiadas na unidade \(01\)\./);
  assert.match(textos.INDIVIDUAL_FIXOS.instrumentos, /frequência de utilização do Armazém/);
  const geral = textos.montarIndividual({
    acompanhamento: { unidadeNome: 'Brasilândia', dataInicio: '2026-03-01' }, responsavel: {}, membros: [],
    inicial: { modelo: 'M1', dataAplicacao: '2026-03-01' }, final: { modelo: 'M1', dataAplicacao: '2026-05-30' },
    inicialM1: { mapa: { ...RESPOSTAS_INICIAL }, detalhes: {}, lista: [] }, finalM1: fin, evolucao: null,
  });
  assert.match(geral.metodologia, /Os instrumentos utilizados permitiram observar/);
  assert.match(geral.diagnostico, /integrantes/);
  assert.match(geral.consideracoes, /Durante o período de acompanhamento/);
});

// ---------- .docx dos modelos 1 e 3 ----------

test('.docx dos questionários: "( X )" nas escolhidas, "Outras: ____" com complemento e linhas para texto em branco', () => {
  const { perguntaParaDocx } = require('../../server/services/relatorios-formularios');
  const docx = require('../../server/services/relatorios-docx');
  const PizZip = require('pizzip');
  const modelo = qm1.montarModeloM1('FINAL');
  const perguntas = modelo.blocos.flatMap((b) => b.perguntas);
  const achar = (codigo) => perguntas.find((p) => p.codigo === codigo);

  const fonte = perguntaParaDocx(achar('1.2'), { '1.2': 'OUTRAS' }, { '1.2': 'Venda de doces' });
  assert.equal(fonte.opcoes.filter((o) => o.marca === 'X').length, 1);
  assert.equal(fonte.opcoes.find((o) => o.marca === 'X').texto, 'Outras: Venda de doces');
  assert.equal(perguntaParaDocx(achar('1.2'), {}, {}).opcoes.find((o) => o.texto.startsWith('Outras')).texto, 'Outras: ______________________');
  const multipla = perguntaParaDocx(achar('3.3'), { '3.3': ['MORADIA', 'LAZER'] }, {});
  assert.deepEqual(multipla.opcoes.filter((o) => o.marca === 'X').map((o) => o.texto), ['Moradia', 'Lazer']);
  assert.deepEqual(perguntaParaDocx(achar('4.6'), { '4.6': false }, {}).opcoes.map((o) => [o.texto, o.marca]), [['Sim', '  '], ['Não', 'X']]);
  const aberta = perguntaParaDocx(achar('4.1'), {}, {});
  assert.equal(aberta.temResposta, true);
  assert.equal(aberta.resposta.length, 2, 'em branco: duas linhas para escrever à mão');
  assert.deepEqual(perguntaParaDocx(achar('4.1'), { '4.1': 'Linha 1\nLinha 2' }, {}).resposta, ['Linha 1', 'Linha 2']);

  const buffer = docx.renderizar('questionario-final', {
    unidade: 'Brasilândia', assistente: 'Ana', responsavel: 'Maria', cpfNis: '123', contato: '(11) 99999-8888', endereco: 'Rua A',
    dataInicio: '01/03/2026', dataAplicacao: '30/05/2026',
    secoes: [{ titulo: '1. SITUAÇÃO ECONÔMICA ATUAL', linhasFixas: [], perguntas: [perguntaParaDocx(achar('1.3'), { '1.3': 'ATE_500' }, {})] }],
    assinaturaNome: 'Ana', cressLinha: 'CRESS/SP: 123',
  });
  const xml = new PizZip(buffer).file('word/document.xml').asText();
  const txt = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  assert.match(txt, /QUESTIONÁRIO FINAL FAMILIAR: após acesso ao armazém solidário/);
  assert.match(txt, /\( X \) Até R\$ 500,00/);
  assert.match(txt, /Assinatura responsável familiar/);
  assert.match(txt, /CRESS\/SP: 123/);
  assert.doesNotMatch(txt, /\{[#/@]?[A-Za-z.]+\}/, 'sem tags soltas');
});
