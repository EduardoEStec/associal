'use strict';

// Códigos das respostas FECHADAS (colunas com CHECK no banco, ver 001_schema.sql)
// e demais enumerações fixas. O texto exibido ao usuário fica em `rotulos`.
// Listas que o ADMIN pode editar (demandas, temas...) NÃO estão aqui: vêm das tabelas de apoio.

const PERFIS = Object.freeze({ ASSISTENTE: 'ASSISTENTE', COORDENADOR: 'COORDENADOR', ADMIN: 'ADMIN' });

const STATUS_ACAO = Object.freeze(['PLANEJADA', 'REALIZADA', 'CANCELADA']);
const STATUS_ACOMPANHAMENTO = Object.freeze(['EM_ANDAMENTO', 'CONCLUIDO', 'DESLIGADO']);
const TIPO_QUESTIONARIO = Object.freeze(['INICIAL', 'FINAL']);

// Questionário familiar — coluna -> { codigo: rotulo }
const QUESTIONARIO = Object.freeze({
  acessoAlimentosInNatura: {
    NAO_TINHA: 'Não tinha acesso', SEMANAL_1_2: '1-2 vezes por semana', SEMANAL_2_3: '2-3 vezes por semana', DIARIO: 'Diário',
  },
  frequenciaFrutasVerduras: { UMA_DUAS: '1-2 vezes por semana', TRES_QUATRO: '3-4 vezes por semana', CINCO_OU_MAIS: '5 ou mais vezes por semana' },
  qualidadeAlimentacao: { MELHOROU_MUITO: 'Melhorou muito', MELHOROU_POUCO: 'Melhorou um pouco', NAO_MELHOROU: 'Não melhorou', PIOROU: 'Piorou' },
  saudeNutricional: { GRANDE_MELHORIA: 'Grande melhoria', PEQUENA_MELHORIA: 'Pequena melhoria', NENHUMA: 'Não houve melhoria' },
  economiaMensalFaixa: { ATE_100: 'Até R$ 100', DE_101_200: 'R$ 101 a R$ 200', DE_201_300: 'R$ 201 a R$ 300', ACIMA_300: 'Acima de R$ 300' },
  capacidadePoupanca: { REGULARMENTE: 'Poupa regularmente', AS_VEZES: 'Poupa às vezes', NAO_CONSEGUE: 'Não consegue poupar' },
  gestaoFinanceira: { MELHOROU: 'Sim, houve melhora', SEM_MUDANCA: 'Não houve mudança', PIOROU: 'Houve piora' },
  avaliacaoArmazem: { OTIMA: 'Ótima', BOA: 'Boa', REGULAR: 'Regular', RUIM: 'Ruim' },
});

// Tabelas de apoio editáveis pelo ADMIN (whitelist usada por /api/apoio e /api/admin).
// Todas têm: id, nome, ordem, ativo, exige_texto (faixa_etaria também idade_min/idade_max).
const TABELAS_APOIO = Object.freeze([
  'demanda', 'encaminhamento', 'vulnerabilidade', 'escolaridade', 'raca', 'genero',
  'faixa_etaria', 'nivel_vulnerabilidade', 'tema', 'tipo_acao', 'beneficio', 'destino_economia',
  'tipo_contato',
]);

module.exports = {
  PERFIS, STATUS_ACAO, STATUS_ACOMPANHAMENTO, TIPO_QUESTIONARIO, QUESTIONARIO, TABELAS_APOIO,
};
