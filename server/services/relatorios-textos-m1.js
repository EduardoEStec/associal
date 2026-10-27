'use strict';

// Textos padrão do RELATÓRIO FINAL FAMILIAR (modelo oficial 4) gerados a partir dos questionários dos modelos oficiais M1.
// Funções puras. Tudo é SUGESTÃO: a assistente edita na tela antes de baixar o .docx.
// Entrada: `inicial` / `final` = { mapa, detalhes, lista } (respostas por código de pergunta, como em questionario-dados.js).

const m1 = require('./modelos-m1');
const qm1 = require('./questionario-m1');

const minuscula = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : '');
const listaTexto = (itens) => {
  const l = itens.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
};
const plural = (n, singular, pluralTxt) => `${n} ${n === 1 ? singular : pluralTxt}`;

const FI = m1.FORMULARIO_INICIAL;
const FF = m1.FORMULARIO_FINAL;

// Rótulo legível da resposta (já com o complemento "Outras: ..."), ou null
const resposta = (form, lado, codigo) => (lado ? qm1.rotuloResposta(form, codigo, lado.mapa[codigo], lado.detalhes?.[codigo]) : null);
const texto = (lado, codigo) => {
  const v = lado?.mapa?.[codigo];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

// Perguntas adicionais (criadas pela coordenação): "Pergunta Resposta: valor."
function linhasExtras(lista, titulo) {
  const itens = (lista || []).filter((x) => !x.oficial && x.resposta);
  if (!itens.length) return [];
  return [titulo, ...itens.map((x) => `${x.pergunta} ${x.resposta}`)];
}

// ---------- 4. Diagnóstico inicial ----------

function diagnosticoM1(inicial) {
  const r = (c) => resposta(FI, inicial, c);
  const linhas = [];

  const fam = [];
  if (inicial.mapa['1.1'] !== undefined && inicial.mapa['1.1'] !== null) fam.push(`A família é composta por ${plural(Number(inicial.mapa['1.1']), 'integrante', 'integrantes')}`);
  if (r('1.2')) fam.push(`com predominância de ${minuscula(r('1.2'))}`);
  if (fam.length) linhas.push(`${fam.join(', ')}.`);
  if (r('1.3')) linhas.push(`Situação do CadÚnico: ${minuscula(r('1.3'))}.`);

  const eco = [];
  if (r('2.1')) {
    const outra = inicial.mapa['2.1'] === 'OUTRAS' && inicial.detalhes?.['2.1'];
    eco.push(`a principal fonte de renda familiar era ${outra ? `outra (${inicial.detalhes['2.1']})` : minuscula(r('2.1'))}`);
  }
  if (r('2.2')) eco.push(`a renda familiar mensal aproximada era ${minuscula(r('2.2'))}`);
  if (inicial.mapa['2.3'] !== undefined && inicial.mapa['2.3'] !== null) {
    const n = Number(inicial.mapa['2.3']);
    eco.push(`${plural(n, 'pessoa contribuía', 'pessoas contribuíam')} para a renda familiar`);
  }
  if (eco.length) linhas.push(`Quanto à situação econômica, ${listaTexto(eco)}.`);
  const reserva = [];
  if (r('2.4')) reserva.push(`capacidade de reservar valor para poupança ou imprevistos: ${minuscula(r('2.4'))}`);
  if (r('2.5')) reserva.push(`dificuldade para custear despesas básicas: ${minuscula(r('2.5'))}`);
  if (reserva.length) linhas.push(`Foi relatado: ${listaTexto(reserva)}.`);

  const situacao = texto(inicial, '3.1');
  if (situacao) linhas.push(`Situação alimentar no início do acompanhamento: ${situacao}`);
  const alim = [];
  if (r('3.2')) alim.push(`dificuldade para adquirir alimentos suficientes para todos os integrantes antes do projeto: ${minuscula(r('3.2'))}`);
  if (r('3.3')) alim.push(`necessidade de reduzir a quantidade ou a qualidade dos alimentos por falta de recursos: ${minuscula(r('3.3'))}`);
  if (r('3.4')) alim.push(`integrante que deixou de fazer uma refeição por falta de alimentos ou recursos: ${minuscula(r('3.4'))}`);
  if (r('3.5')) alim.push(`aquisição regular de alimentos importantes para uma alimentação adequada: ${minuscula(r('3.5'))}`);
  if (r('3.6')) alim.push(`acesso regular a frutas, verduras e legumes: ${minuscula(r('3.6'))}`);
  if (alim.length) linhas.push(`Em relação ao acesso a alimentos, observou-se ${listaTexto(alim)}.`);
  return linhas;
}

// ---------- 5. Impacto ----------

const NOME_TENDENCIA = { melhorou: 'houve melhora', igual: 'sem alteração', piorou: 'houve piora', neutro: 'houve mudança', sem_dados: '' };

function deParaPar(par, item) {
  const de = item.inicial.rotulo;
  const para = item.final.rotulo;
  if (!para) return null;
  const sufixo = NOME_TENDENCIA[item.tendencia] ? ` (${NOME_TENDENCIA[item.tendencia]})` : '';
  if (!de) return `${par.rotulo}: "${para}".`;
  return de === para
    ? `${par.rotulo}: "${para}" (sem alteração).`
    : `${par.rotulo}: de "${de}" para "${para}"${sufixo}.`;
}

// inicial pode ser null (questionário inicial no formato anterior ou ausente): então só se descreve o estado final.
function impactoM1(inicial, final) {
  const rf = (c) => resposta(FF, final, c);
  const comparado = inicial ? qm1.compararPares(inicial, final) : null;
  const porChave = comparado ? Object.fromEntries(comparado.itens.map((i) => [i.chave, i])) : {};

  // Alimentação
  const alim = [];
  for (const par of m1.PARES.filter((p) => p.indice === 'ALIMENTACAO')) {
    const item = porChave[par.chave];
    const linha = item ? deParaPar(par, item) : (rf(par.final) ? `${par.rotulo}: ${minuscula(rf(par.final))}.` : null);
    if (linha) alim.push(linha);
  }
  if (rf('2.3')) alim.push(`Sobre a qualidade da alimentação após o acesso aos produtos mais baratos, a família relata: ${minuscula(rf('2.3'))}.`);
  if (rf('2.8')) alim.push(`Quanto à variedade e à qualidade dos alimentos consumidos, a família relata: ${minuscula(rf('2.8'))}.`);
  if (rf('2.1') || rf('2.2')) {
    const partes = [];
    if (rf('2.1')) partes.push(`realiza compras no Armazém Solidário ${minuscula(rf('2.1'))}`);
    if (rf('2.2')) partes.push(`considera que o Armazém ${final.mapa['2.2'] === 'SIM' ? 'contribui' : final.mapa['2.2'] === 'PARCIALMENTE' ? 'contribui parcialmente' : 'não contribui'} para melhorar o acesso aos alimentos`);
    alim.push(`A família ${listaTexto(partes)}.`);
  }

  // Desafios e oportunidades (respostas abertas)
  const des = [];
  if (texto(final, '4.2')) des.push(`Impacto do projeto na comunidade local, segundo a família: ${texto(final, '4.2')}`);
  if (texto(final, '4.3')) des.push(`Pontos a melhorar apontados pela família: ${texto(final, '4.3')}`);

  // Econômico
  const eco = [];
  if (comparado) {
    for (const chave of ['rendaFaixa', 'fonteRenda']) {
      const par = m1.PARES.find((p) => p.chave === chave);
      const linha = deParaPar(par, porChave[chave]);
      if (linha) eco.push(linha);
    }
  } else {
    if (rf('1.3')) eco.push(`Renda familiar mensal aproximada ao final: ${minuscula(rf('1.3'))}.`);
    if (rf('1.2')) eco.push(`Principal fonte de renda ao final: ${minuscula(rf('1.2'))}.`);
  }
  if (rf('1.4')) eco.push(`Comparando com o início do acompanhamento, a situação econômica da família ${minuscula(rf('1.4'))}.`);
  if (rf('3.1')) {
    eco.push(final.mapa['3.1'] === 'SIM' ? 'Foi relatada pela família a contribuição dos preços do Armazém Solidário para a redução das despesas com alimentação e para a melhora das condições econômicas.'
      : `Sobre a contribuição dos preços do Armazém para reduzir as despesas com alimentação e melhorar as condições econômicas, a família respondeu: ${minuscula(rf('3.1'))}.`);
  }
  if (rf('3.2')) eco.push(`A economia mensal estimada com as compras no Armazém Solidário foi: ${minuscula(rf('3.2'))}.`);
  if (rf('3.3')) eco.push(`A economia obtida é priorizada para: ${minuscula(rf('3.3'))}.`);
  if (rf('3.4')) eco.push(`Sobre a redução de dívidas ou melhoria na gestão financeira familiar: ${minuscula(rf('3.4'))}.`);

  return { impactoAlimentar: alim.join('\n'), impactoDesafios: des.join('\n'), impactoEconomico: eco.join('\n'), comparado };
}

// ---------- 6. Feedback ----------

function feedbackM1(final) {
  const l = [];
  const rf = (c) => resposta(FF, final, c);
  if (texto(final, '4.1')) l.push(`Principais mudanças que a família atribui após o acesso ao Armazém Solidário: “${texto(final, '4.1')}”`);
  if (texto(final, '4.2')) l.push(`Como a família enxerga o impacto do projeto na comunidade local: “${texto(final, '4.2')}”`);
  if (texto(final, '4.3')) l.push(`O que poderia ser melhorado no projeto, segundo a família: “${texto(final, '4.3')}”`);
  if (texto(final, '4.4')) l.push(`Principal benefício do projeto para a família: “${texto(final, '4.4')}”`);
  if (rf('4.5')) {
    const rec = final.mapa['4.6'];
    l.push(`A família avaliou o Armazém Solidário como "${rf('4.5')}"`
      + `${rec === true ? ' e recomendaria o projeto a outras famílias ou comunidades' : rec === false ? ' e não recomendaria o projeto a outras famílias ou comunidades' : ''}.`);
  } else if (final.mapa['4.6'] === true || final.mapa['4.6'] === false) {
    l.push(`A família ${final.mapa['4.6'] ? 'recomendaria' : 'não recomendaria'} o projeto a outras famílias ou comunidades.`);
  }
  l.push(...linhasExtras(final.lista, 'Perguntas adicionais do questionário final:'));
  return l;
}

// ---------- 7. Considerações finais ----------

function consideracoesM1(comparado, contatos) {
  const partes = [];
  if (comparado) {
    const r = comparado.resumo;
    if (r.comparaveis > 0) {
      partes.push(`Na comparação entre o questionário inicial e o final, ${plural(r.melhorou, 'resposta indicou melhora', 'respostas indicaram melhora')}, `
        + `${plural(r.igual, 'permaneceu igual', 'permaneceram iguais')} e ${plural(r.piorou, 'indicou piora', 'indicaram piora')}.`);
    }
  }
  partes.push('Durante o período de acompanhamento, foram realizados registros periódicos referentes aos atendimentos, utilização do Armazém, '
    + 'orientações, encaminhamentos e demais ocorrências relevantes.'
    + `${contatos?.total ? ` No total, ${plural(contatos.total, 'contato foi registrado', 'contatos foram registrados')}.` : ''}`);
  partes.push('O acompanhamento evidencia a contribuição do Armazém Solidário para a segurança alimentar e para o fortalecimento econômico da família. '
    + 'Recomenda-se a continuidade do acompanhamento pelo Serviço Social e a articulação com a rede socioassistencial, conforme as necessidades identificadas.');
  return partes.join('\n');
}

module.exports = { diagnosticoM1, impactoM1, feedbackM1, consideracoesM1, linhasExtras };
