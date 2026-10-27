'use strict';

// Respostas de exemplo dos modelos oficiais M1 (questionário inicial e final) para os testes.
// Chaves = código da pergunta do papel ("2.1"); valores no formato da API (docs/API-CATALOGO.md).

const RESPOSTAS_INICIAL = Object.freeze({
  '1.1': 4, '1.2': 'ADULTOS', '1.3': 'ATUALIZADO',
  '2.1': 'TRABALHO_INFORMAL', '2.2': 'DE_501_1000', '2.3': 1, '2.4': 'NENHUM', '2.5': 'FREQUENTEMENTE',
  '3.1': 'Família relata falta de alimentos no fim do mês.',
  '3.2': 'FREQUENTEMENTE', '3.3': 'SIM_FREQUENTEMENTE', '3.4': 'SIM', '3.5': 'NAO', '3.6': 'NAO',
});

const RESPOSTAS_FINAL = Object.freeze({
  '1.2': 'TRABALHO_INFORMAL', '1.3': 'DE_1001_2000', '1.4': 'MELHOROU',
  '2.1': 'SEMANALMENTE', '2.2': 'SIM', '2.3': 'MELHOROU_MUITO', '2.4': 'CINCO_OU_MAIS', '2.5': 'SIM', '2.6': 'NAO', '2.7': 'NAO', '2.8': 'MELHOROU',
  '3.1': 'SIM', '3.2': 'DE_301_400', '3.3': ['MORADIA', 'OUTRAS'], '3.4': 'MELHORA',
  '4.1': 'Sobrou dinheiro para outras despesas.', '4.2': 'O bairro ganhou uma opção de compra.', '4.3': 'Mais variedade de verduras.',
  '4.4': 'Preço baixo.', '4.5': 'BOA', '4.6': true,
});

// Corpo do PUT /api/familias/acompanhamentos/:id/questionarios/:tipo
const corpoInicial = (dataAplicacao, extra = {}, extrasCorpo = {}) => ({
  dataAplicacao, respostas: { ...RESPOSTAS_INICIAL, ...extra }, detalhes: {}, concluir: true, ...extrasCorpo,
});
const corpoFinal = (dataAplicacao, extra = {}, extrasCorpo = {}) => ({
  dataAplicacao, respostas: { ...RESPOSTAS_FINAL, ...extra }, detalhes: { '3.3': 'Dívida do gás' }, concluir: true, ...extrasCorpo,
});

module.exports = { RESPOSTAS_INICIAL, RESPOSTAS_FINAL, corpoInicial, corpoFinal };
