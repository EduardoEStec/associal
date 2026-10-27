'use strict';

// Modelos oficiais M1 (questionário INICIAL e questionário FINAL) conforme docs/modelos/1-questionario-inicial e 3-questionario-final.
// Fonte única das perguntas oficiais: dela saem a SEMENTE da migração 086 (scripts/gerar-semente-m1.js), o catálogo padrão usado
// quando o banco ainda não tem as tabelas e a regra do índice de progresso (versão 2).
//
// Depois da migração, textos, ordem, opções e perguntas adicionais vivem em dbo.catalogo_* (a coordenação edita em
// Administração > Perguntas e opções). O que NUNCA muda por configuração é o que está aqui: o código (estável), o tipo, o
// CAMPO (nome usado pelas regras) e a PONTUAÇÃO das opções oficiais (0 a 100; null = não pontua).
//
// Mapeamento pergunta do papel -> código -> uso: docs/modelos/MAPEAMENTO.md

const FORMULARIO_INICIAL = 'QUESTIONARIO_INICIAL';
const FORMULARIO_FINAL = 'QUESTIONARIO_FINAL';
const FORMULARIOS_M1 = Object.freeze([FORMULARIO_INICIAL, FORMULARIO_FINAL]);

// tipo do questionário (INICIAL | REAVALIACAO | FINAL) -> formulário do catálogo
const formularioDoTipo = (tipo) => (tipo === 'INICIAL' ? FORMULARIO_INICIAL : FORMULARIO_FINAL);

const SECOES = Object.freeze({
  [FORMULARIO_INICIAL]: [
    { numero: 1, titulo: 'Identificação da família' },
    { numero: 2, titulo: 'Situação econômica atual da família' },
    { numero: 3, titulo: 'Acesso a alimentos e segurança alimentar' },
  ],
  [FORMULARIO_FINAL]: [
    { numero: 1, titulo: 'Situação econômica atual' },
    { numero: 2, titulo: 'Segurança alimentar' },
    { numero: 3, titulo: 'Impacto econômico percebido do Armazém Solidário' },
    { numero: 4, titulo: 'Avaliação geral' },
  ],
});

// o(código, texto, pontos, { pedeDetalhe }) — pontos: 0 a 100 (100 = melhor situação); null = não pontua (informativa)
const o = (codigo, texto, pontos = null, extra = {}) => ({ codigo, texto, pontos, pedeDetalhe: !!extra.pedeDetalhe });

const FONTES_RENDA = [
  o('TRABALHO_FORMAL', 'Trabalho formal'),
  o('TRABALHO_INFORMAL', 'Trabalho informal/autônomo'),
  o('APOSENTADORIA_PENSAO', 'Aposentadoria/pensão'),
  o('TRANSFERENCIA_RENDA', 'Benefício de transferência de renda/assistencial'),
  o('PREVIDENCIARIO', 'Benefício previdenciário'),
  o('OUTRAS', 'Outras', null, { pedeDetalhe: true }),
  o('SEM_RENDA', 'Sem renda no momento'),
];

const FAIXAS_RENDA = [
  o('ATE_500', 'Até R$ 500,00', 0),
  o('DE_501_1000', 'De R$ 501,00 a R$ 1.000,00', 25),
  o('DE_1001_2000', 'De R$ 1.001,00 a R$ 2.000,00', 50),
  o('DE_2001_3000', 'De R$ 2.001,00 a R$ 3.000,00', 75),
  o('ACIMA_3000', 'Acima de R$ 3.000,00', 100),
  o('NAO_INFORMADO', 'Não informado'),
];

const COMPARATIVA = (extra) => [
  o('MELHOROU', 'Melhorou', 100),
  o('SEMELHANTE', 'Permaneceu semelhante', 50),
  o('PIOROU', 'Piorou', 0),
  o('NAO_AVALIAR', 'Não é possível avaliar'),
  ...(extra || []),
];

// Perguntas. `campo`: nome estável usado pelas regras; as respostas trafegam por `codigo` ("2.1", "E0001").
const INICIAL = [
  { codigo: '1.1', secao: 1, campo: 'qtdIntegrantes', tipo: 'NUMERO', texto: 'Número de integrantes da família', obrigatoria: true, min: 1, max: 30 },
  {
    codigo: '1.2', secao: 1, campo: 'faixaEtaria', tipo: 'ESCOLHA', texto: 'Faixa etária predominante', obrigatoria: true,
    opcoes: [
      o('CRIANCAS_ADOLESCENTES', 'Crianças e adolescentes (até 17 anos)'),
      o('ADULTOS', 'Adultos (18 a 59 anos)'),
      o('IDOSOS', 'Idosos (60 anos ou mais)'),
    ],
  },
  {
    codigo: '1.3', secao: 1, campo: 'situacaoCadUnico', tipo: 'ESCOLHA', texto: 'Situação do CadÚnico', obrigatoria: true,
    opcoes: [
      o('ATUALIZADO', 'Atualizado'),
      o('NECESSITA_ATUALIZACAO', 'Necessita atualização'),
      o('EM_ATUALIZACAO', 'Em processo de atualização'),
    ],
  },
  { codigo: '2.1', secao: 2, campo: 'fonteRenda', tipo: 'ESCOLHA', texto: 'Qual a principal fonte de renda familiar?', obrigatoria: true, opcoes: FONTES_RENDA },
  { codigo: '2.2', secao: 2, campo: 'rendaFaixa', tipo: 'ESCOLHA', texto: 'Renda familiar mensal aproximada:', obrigatoria: true, opcoes: FAIXAS_RENDA },
  { codigo: '2.3', secao: 2, campo: 'pessoasComRenda', tipo: 'NUMERO', texto: 'Número de pessoas que contribuem para a renda familiar:', obrigatoria: true, min: 0, max: 30 },
  {
    codigo: '2.4', secao: 2, campo: 'reservaFinanceira', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Atualmente, a família consegue reservar algum valor da sua renda para poupança ou para situações imprevistas?',
    opcoes: [
      o('NENHUM', 'Não consegue reservar nenhum valor', 0),
      o('RARAMENTE', 'Consegue raramente', 25),
      o('OCASIONALMENTE', 'Consegue ocasionalmente', 50),
      o('REGULARMENTE', 'Consegue regularmente', 75),
      o('TODOS_MESES', 'Consegue reservar valor todos os meses', 100),
    ],
  },
  {
    codigo: '2.5', secao: 2, campo: 'dificuldadeDespesas', tipo: 'ESCOLHA', texto: 'A família relata dificuldade para custear despesas básicas?', obrigatoria: true,
    opcoes: [
      o('NAO', 'Não', 100),
      o('EVENTUALMENTE', 'Sim, eventualmente', 67),
      o('FREQUENTEMENTE', 'Sim, frequentemente', 33),
      o('PERMANENTE', 'Sim, de forma permanente', 0),
    ],
  },
  { codigo: '3.1', secao: 3, campo: 'situacaoAlimentar', tipo: 'TEXTO', texto: 'Situação alimentar antes/início do acompanhamento', obrigatoria: false },
  {
    codigo: '3.2', secao: 3, campo: 'alimentosSuficientes', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Antes do projeto, a família teve dificuldade para adquirir alimentos suficientes para todos os integrantes?',
    opcoes: [
      o('ALGUMAS_VEZES', 'Algumas vezes', 50),
      o('FREQUENTEMENTE', 'Frequentemente', 0),
      o('RARAMENTE', 'Raramente', 75),
      o('NUNCA', 'Nunca', 100),
    ],
  },
  {
    codigo: '3.3', secao: 3, campo: 'reducaoAlimentos', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Houve necessidade de reduzir a quantidade ou qualidade dos alimentos devido à falta de recursos financeiros?',
    opcoes: [
      o('SIM_EVENTUALMENTE', 'Sim, eventualmente', 50),
      o('SIM_FREQUENTEMENTE', 'Sim, frequentemente', 0),
      o('NAO', 'Não', 100),
    ],
  },
  {
    codigo: '3.4', secao: 3, campo: 'deixouRefeicao', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Houve situação em que algum integrante da família deixou de realizar uma refeição por falta de alimentos ou recursos financeiros?',
    opcoes: [
      o('SIM', 'Sim', 0),
      o('NAO', 'Não', 100),
      o('ALGUMAS_VEZES', 'Algumas vezes', 50),
    ],
  },
  {
    codigo: '3.5', secao: 3, campo: 'alimentosImportantes', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'A família conseguia adquirir regularmente alimentos considerados importantes para uma alimentação adequada?',
    opcoes: [
      o('PARCIALMENTE', 'Parcialmente', 50),
      o('RARAMENTE', 'Raramente', 25),
      o('NAO', 'Não', 0),
      o('SIM', 'Sim', 100),
    ],
  },
  {
    // decisão do usuário: só Sim / Parcialmente / Não (o modelo em papel misturava "1 – 2 vezes por semana")
    codigo: '3.6', secao: 3, campo: 'frutasVerduras', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'A família possuía acesso regular a frutas, verduras e legumes?',
    opcoes: [
      o('SIM', 'Sim', 100),
      o('PARCIALMENTE', 'Parcialmente', 50),
      o('NAO', 'Não', 0),
    ],
  },
];

const FINAL = [
  { codigo: '1.2', secao: 1, campo: 'fonteRenda', tipo: 'ESCOLHA', texto: 'Qual a principal fonte de renda familiar?', obrigatoria: true, opcoes: FONTES_RENDA },
  { codigo: '1.3', secao: 1, campo: 'rendaFaixa', tipo: 'ESCOLHA', texto: 'Qual a renda familiar mensal aproximada atualmente?', obrigatoria: true, opcoes: FAIXAS_RENDA },
  {
    codigo: '1.4', secao: 1, campo: 'evolucaoEconomica', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Comparando com o início do acompanhamento, a situação econômica da família:', opcoes: COMPARATIVA(),
  },
  {
    codigo: '2.1', secao: 2, campo: 'frequenciaCompras', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Com que frequência a família realiza compras no Armazém Solidário?',
    opcoes: [
      o('SEMANALMENTE', 'Semanalmente'),
      o('QUINZENALMENTE', 'Quinzenalmente'),
      o('MENSALMENTE', 'Mensalmente'),
      o('EVENTUALMENTE', 'Eventualmente'),
    ],
  },
  {
    codigo: '2.2', secao: 2, campo: 'armazemMelhoraAcesso', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'O Armazém Solidário contribui para melhorar o acesso da família aos alimentos?',
    opcoes: [o('SIM', 'Sim', 100), o('PARCIALMENTE', 'Parcialmente', 50), o('NAO', 'Não', 0)],
  },
  {
    codigo: '2.3', secao: 2, campo: 'qualidadeAlimentacao', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Qual foi o impacto na qualidade da alimentação da família após o acesso aos produtos mais baratos?',
    opcoes: [
      o('MELHOROU_MUITO', 'Melhorou muito', 100),
      o('MELHOROU_POUCO', 'Melhorou um pouco', 67),
      o('NAO_MELHOROU', 'Não melhorou', 33),
      o('PIOROU', 'Piorou', 0),
    ],
  },
  {
    codigo: '2.4', secao: 2, campo: 'frutasVerduras', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Com que frequência a família consome frutas, verduras e legumes após acesso ao armazém solidário?',
    opcoes: [
      o('UMA_DUAS', '1-2 vezes por semana', 33),
      o('TRES_QUATRO', '3-4 vezes por semana', 67),
      o('CINCO_OU_MAIS', '5 ou mais vezes por semana', 100),
    ],
  },
  {
    codigo: '2.5', secao: 2, campo: 'alimentosSuficientes', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Atualmente, a família consegue adquirir alimentos suficientes para atender suas necessidades?',
    opcoes: [o('SIM', 'Sim', 100), o('PARCIALMENTE', 'Parcialmente', 50), o('NAO', 'Não', 0)],
  },
  {
    codigo: '2.6', secao: 2, campo: 'reducaoAlimentos', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Atualmente, a família enfrenta redução da quantidade ou qualidade dos alimentos por falta de recursos?',
    opcoes: [
      o('NAO', 'Não', 100),
      o('RARAMENTE', 'Raramente', 75),
      o('ALGUMAS_VEZES', 'Algumas vezes', 50),
      o('FREQUENTEMENTE', 'Frequentemente', 0),
    ],
  },
  {
    codigo: '2.7', secao: 2, campo: 'deixouRefeicao', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Atualmente, algum integrante da família deixa de realizar refeições por falta de alimentos ou recursos?',
    opcoes: [o('NAO', 'Não', 100), o('SIM', 'Sim', 0)],
  },
  {
    codigo: '2.8', secao: 2, campo: 'variedadeAlimentos', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Houve mudança na variedade e qualidade dos alimentos consumidos pela família?', opcoes: COMPARATIVA(),
  },
  {
    codigo: '3.1', secao: 3, campo: 'precosReduziramDespesas', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'A família considera que os preços praticados no Armazém contribuíram para reduzir as despesas com alimentação e melhorar as condições econômicas da família?',
    opcoes: [o('SIM', 'Sim', 100), o('PARCIALMENTE', 'Parcialmente', 50), o('NAO', 'Não', 0)],
  },
  {
    // decisão do usuário: faixa 301–400 acrescentada (o papel não tinha)
    codigo: '3.2', secao: 3, campo: 'economiaMensal', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Quanto a família economiza mensalmente com a compra de produtos no armazém solidário?',
    opcoes: [
      o('ATE_100', 'Até R$ 100,00', 0),
      o('DE_101_300', 'De R$ 101,00 a R$ 300,00', 33),
      o('DE_301_400', 'De R$ 301,00 a R$ 400,00', 67),
      o('ACIMA_400', 'Acima de R$ 400,00', 100),
      o('OUTRO_VALOR', 'Outro valor', null, { pedeDetalhe: true }),
    ],
  },
  {
    codigo: '3.3', secao: 3, campo: 'despesasPriorizadas', tipo: 'MULTIPLA', obrigatoria: true,
    texto: 'Quais despesas são priorizadas com eventual economia obtida?',
    opcoes: [
      o('MORADIA', 'Moradia'),
      o('ENERGIA_AGUA', 'Energia elétrica/Água'),
      o('TRANSPORTE', 'Transporte'),
      o('SAUDE', 'Saúde'),
      o('EDUCACAO', 'Educação'),
      o('VESTUARIO', 'Vestuário'),
      o('LAZER', 'Lazer'),
      o('OUTRAS', 'Outras', null, { pedeDetalhe: true }),
    ],
  },
  {
    codigo: '3.4', secao: 3, campo: 'dividasGestao', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Houve redução de dívidas ou melhoria na gestão financeira familiar?',
    opcoes: [
      o('MELHORA', 'Sim, houve melhora', 100),
      o('NAO_MUDOU', 'Não houve mudança', 50),
      o('PARCIALMENTE', 'Houve parcialmente', 75),
    ],
  },
  { codigo: '4.1', secao: 4, campo: 'mudancasAtribuidas', tipo: 'TEXTO', texto: 'Quais as principais mudanças a família atribui após o acesso ao Armazém Solidário?', obrigatoria: false },
  { codigo: '4.2', secao: 4, campo: 'impactoComunidade', tipo: 'TEXTO', texto: 'Como a família enxerga o impacto do projeto na comunidade local?', obrigatoria: false },
  {
    codigo: '4.3', secao: 4, campo: 'oQueMelhorar', tipo: 'TEXTO', obrigatoria: false,
    texto: 'O que poderia ser melhorado no projeto para aumentar seu impacto no empoderamento econômico das famílias?',
  },
  { codigo: '4.4', secao: 4, campo: 'principalBeneficio', tipo: 'TEXTO', texto: 'O que a família considera como o principal benefício do projeto?', obrigatoria: false },
  {
    codigo: '4.5', secao: 4, campo: 'avaliacaoGeral', tipo: 'ESCOLHA', obrigatoria: true,
    texto: 'Qual é a avaliação geral da família sobre o armazém solidário?',
    opcoes: [o('OTIMA', 'Ótima', 100), o('BOA', 'Boa', 67), o('REGULAR', 'Regular', 33), o('RUIM', 'Ruim', 0)],
  },
  { codigo: '4.6', secao: 4, campo: 'recomendaria', tipo: 'SIM_NAO', texto: 'A família recomendaria o projeto para outras famílias ou comunidades?', obrigatoria: true },
];

const PERGUNTAS_PADRAO = Object.freeze({ [FORMULARIO_INICIAL]: INICIAL, [FORMULARIO_FINAL]: FINAL });

// Reavaliação rápida (metade do prazo): subconjunto do FINAL = só as perguntas de ESTADO que têm par no INICIAL
const CODIGOS_REAVALIACAO = Object.freeze(['1.3', '2.4', '2.5', '2.6', '2.7']);

// Pares equivalentes inicial × final (chave -> código em cada questionário).
//   aproximado: as escalas não são idênticas (equivalência documentada em docs/modelos/MAPEAMENTO.md)
//   indice: dimensão do índice de progresso em que o par entra (null = só comparação)
const PARES = Object.freeze([
  { chave: 'fonteRenda', rotulo: 'Principal fonte de renda', inicial: '2.1', final: '1.2', indice: null },
  { chave: 'rendaFaixa', rotulo: 'Renda familiar mensal', inicial: '2.2', final: '1.3', indice: 'RENDA' },
  { chave: 'alimentosSuficientes', rotulo: 'Alimentos suficientes para todos', inicial: '3.2', final: '2.5', indice: 'ALIMENTACAO' },
  { chave: 'reducaoAlimentos', rotulo: 'Redução da quantidade ou qualidade dos alimentos', inicial: '3.3', final: '2.6', indice: 'ALIMENTACAO' },
  { chave: 'deixouRefeicao', rotulo: 'Alguém deixou de fazer refeição', inicial: '3.4', final: '2.7', indice: 'ALIMENTACAO' },
  { chave: 'frutasVerduras', rotulo: 'Frutas, verduras e legumes', inicial: '3.6', final: '2.4', indice: 'ALIMENTACAO', aproximado: true },
]);

// Perguntas do FINAL que já são, por si, comparativas com o início (não têm par no INICIAL)
const COMPARATIVAS_FINAL = Object.freeze([
  { codigo: '1.4', rotulo: 'Situação econômica em relação ao início' },
  { codigo: '2.8', rotulo: 'Variedade e qualidade dos alimentos' },
  { codigo: '3.4', rotulo: 'Dívidas e gestão financeira' },
]);

// Chave de uma pergunta do formulário (campo estável)
const campoDe = (formulario, codigo) => PERGUNTAS_PADRAO[formulario]?.find((p) => p.codigo === codigo)?.campo || null;

module.exports = {
  FORMULARIO_INICIAL, FORMULARIO_FINAL, FORMULARIOS_M1, formularioDoTipo,
  SECOES, PERGUNTAS_PADRAO, CODIGOS_REAVALIACAO, PARES, COMPARATIVAS_FINAL, campoDe,
};
