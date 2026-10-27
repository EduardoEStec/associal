'use strict';

// Textos padrão dos relatórios (funções puras, sem banco). Tudo aqui é apenas SUGESTÃO:
// a tela mostra os textos para o profissional editar antes de gerar o .docx.

const estado = require('./catalogo-estado');
const evolucaoTexto = require('./relatorios-evolucao');
const textosM1 = require('./relatorios-textos-m1');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- formatação ----------

const numero = (n, casas = 0) =>
  Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

const moeda = (n) => (n === null || n === undefined ? '' : `R$ ${numero(n, 2)}`);

const percentual = (parte, total) => (total > 0 ? `${numero((parte / total) * 100, 1)}%` : '—');

// 'AAAA-MM-DD' (ou Date) -> 'dd/mm/aaaa'
function dataBr(valor) {
  if (!valor) return '';
  const iso = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

// 'AAAA-MM-DD' -> '20 de outubro de 2026'
function dataExtenso(valor) {
  const iso = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor || '').slice(0, 10);
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return '';
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

function listaTexto(itens) {
  const l = itens.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}

const minuscula = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : '');
const plural = (n, singular, pluralTxt) => `${numero(n)} ${n === 1 ? singular : pluralTxt}`;

// Rótulo da opção no catálogo (a coordenação pode renomear e acrescentar opções)
const rotulo = (campo, codigo) => (codigo ? estado.rotuloOpcao(campo, codigo) || codigo : '');

// Perguntas adicionais (P2) como linhas de texto do relatório: "Pergunta Resposta: valor."
function linhasExtras(extras, titulo) {
  const itens = (extras || []).filter((x) => x.resposta);
  if (!itens.length) return [];
  return [titulo, ...itens.map((x) => `${x.pergunta} ${x.resposta}`)];
}

// Converte um texto em lista de parágrafos (linhas em branco são descartadas).
function paragrafos(textoLivre) {
  return String(textoLivre ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function idadeEm(dataNascimento, referencia) {
  if (!dataNascimento) return null;
  const n = String(dataNascimento instanceof Date ? dataNascimento.toISOString() : dataNascimento).slice(0, 10);
  const r = String(referencia || new Date().toISOString()).slice(0, 10);
  const [an, mn, dn] = n.split('-').map(Number);
  const [ar, mr, dr] = r.split('-').map(Number);
  if (!an || !ar) return null;
  let idade = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) idade -= 1;
  return idade >= 0 ? idade : null;
}

// ---------- Relatório Individual Familiar ----------

const INDIVIDUAL_FIXOS = Object.freeze({
  introducao:
    'A segurança alimentar e nutricional é um pilar fundamental para o desenvolvimento e a dignidade das famílias, '
    + 'especialmente em contextos de vulnerabilidade socioeconômica. Nesse cenário, o empoderamento econômico de famílias '
    + 'locais usuárias do programa Armazém Solidário surge como uma estratégia essencial para contribuir não apenas para o '
    + 'acesso a alimentos de qualidade, mas também para a autonomia e o direito dos munícipes, visando integrar ações que '
    + 'fortaleçam a capacidade financeira e o poder de compra das famílias.',
  // modelo oficial 4 (docs/modelos/4-relatorio-final-familiar)
  objetivo:
    'Contribuir para o empoderamento econômico de 10 famílias locais vinculadas ao projeto, considerando os impactos observados '
    + 'do Armazém Solidário na economia familiar e na segurança alimentar durante o período de acompanhamento.\n'
    + 'Indicador: Número de famílias apoiadas na unidade (01).\n'
    + 'Meios de Verificação: Questionários iniciais e finais; registros de acompanhamento individual; relatórios de impacto '
    + 'econômico e de segurança alimentar; feedback das famílias.',
  // frase do modelo oficial 4 (seção 3, Metodologia)
  instrumentos:
    'Os instrumentos utilizados permitiram observar aspectos relacionados à situação econômica, capacidade de reserva financeira, '
    + 'despesas familiares, acesso aos alimentos, qualidade e variedade da alimentação, frequência de utilização do Armazém e '
    + 'percepção da família sobre as mudanças ocorridas durante o acompanhamento.',
});

function gerarMetodologia({ unidadeNome, dataInicio, inicial, final }) {
  const linhas = [
    `Seleção das Famílias: família usuária do programa Armazém Solidário${unidadeNome ? ` da unidade ${unidadeNome}` : ''}, `
    + `em situação de vulnerabilidade socioeconômica, acompanhada pelo Serviço Social desde ${dataBr(dataInicio)}.`,
  ];
  const aplic = [];
  if (inicial?.dataAplicacao) aplic.push(`questionário inicial em ${dataBr(inicial.dataAplicacao)}`);
  if (final?.dataAplicacao) aplic.push(`questionário final em ${dataBr(final.dataAplicacao)}`);
  linhas.push(
    'Monitoramento e Avaliação: acompanhamento individual da família por meio de entrevistas, registros periódicos de acompanhamento '
    + `e aplicação dos questionários inicial e final${aplic.length ? ` (${listaTexto(aplic)})` : ''}, permitindo comparar a situação da família antes e depois `
    + 'do acompanhamento quanto à renda, ao acesso e consumo de alimentos e à percepção sobre o Armazém Solidário.',
  );
  linhas.push(INDIVIDUAL_FIXOS.instrumentos);
  return linhas.join('\n');
}

function descreverComposicao(membros, responsavel, inicial, referencia) {
  const partes = [];
  const total = inicial?.qtdMembrosFamilia || (membros.length ? membros.length : null);
  if (total) partes.push(`A família é composta por ${plural(total, 'pessoa', 'pessoas')}.`);
  if (membros.length) {
    const desc = membros.map((m) => {
      const idade = m.idade ?? idadeEm(m.dataNascimento, referencia);
      const par = m.parentesco ? m.parentesco.toLowerCase() : 'membro';
      return idade !== null && idade !== undefined ? `${par} (${plural(idade, 'ano', 'anos')})` : par;
    });
    partes.push(`Membros: ${listaTexto(desc)}.`);
  }
  const trabalhamMembros = membros.filter((m) => m.trabalha === true).length;
  const trabalhoResp = responsavel?.trabalhoAtual;
  if (trabalhoResp) partes.push(`O(A) responsável familiar atua como: ${trabalhoResp}.`);
  if (inicial?.qtdMembrosComRenda !== null && inicial?.qtdMembrosComRenda !== undefined) {
    partes.push(`${plural(inicial.qtdMembrosComRenda, 'membro possui', 'membros possuem')} renda.`);
  } else if (trabalhamMembros) {
    partes.push(`${plural(trabalhamMembros, 'membro trabalha', 'membros trabalham')}.`);
  }
  return partes;
}

function gerarDiagnostico({ responsavel, membros, inicial, beneficiosInicial, dataInicio, extrasInicial }) {
  if (!inicial) {
    return 'Questionário inicial ainda não aplicado. Descreva aqui a situação socioeconômica identificada: níveis de renda, '
      + 'acesso a alimentos e situação de trabalho da família.';
  }
  const ref = inicial.dataAplicacao || dataInicio;
  const linhas = [];
  const comp = descreverComposicao(membros, responsavel, inicial, ref);
  if (comp.length) linhas.push(comp.join(' '));

  if (inicial.rendaMensalMedia !== null && inicial.rendaMensalMedia !== undefined) {
    let t = `A renda mensal média da família era de ${moeda(inicial.rendaMensalMedia)}`;
    const pessoas = inicial.qtdMembrosFamilia || (membros.length || null);
    if (pessoas) t += `, o que corresponde a aproximadamente ${moeda(inicial.rendaMensalMedia / pessoas)} por pessoa`;
    linhas.push(`${t}.`);
  }

  if (inicial.recebeAuxilio === true) {
    const nomes = [...beneficiosInicial];
    if (inicial.auxilioOutro) nomes.push(inicial.auxilioOutro);
    linhas.push(`A família recebia auxílio governamental${nomes.length ? `: ${listaTexto(nomes)}` : ''}.`);
  } else if (inicial.recebeAuxilio === false) {
    linhas.push('A família não recebia auxílio governamental.');
  }

  const alim = [];
  if (inicial.acessoAlimentosInNatura) {
    alim.push(`acesso a alimentos in natura: ${minuscula(rotulo('acessoAlimentosInNatura', inicial.acessoAlimentosInNatura))}`);
  }
  if (inicial.frequenciaFrutasVerduras) {
    alim.push(`consumo de frutas, verduras e legumes: ${minuscula(rotulo('frequenciaFrutasVerduras', inicial.frequenciaFrutasVerduras))}`);
  }
  if (alim.length) linhas.push(`Em relação à alimentação, observou-se ${listaTexto(alim)}.`);

  const eco = [];
  if (inicial.conseguePoupar === true) eco.push('a família conseguia poupar');
  else if (inicial.conseguePoupar === false) eco.push('a família não conseguia poupar');
  if (inicial.capacidadePoupanca) eco.push(`capacidade de poupança: ${minuscula(rotulo('capacidadePoupanca', inicial.capacidadePoupanca))}`);
  const ecoTxt = eco.filter(Boolean);
  if (ecoTxt.length) linhas.push(`Quanto à situação econômica, ${listaTexto(ecoTxt)}.`);

  linhas.push(...linhasExtras(extrasInicial, 'Perguntas adicionais do questionário inicial:'));
  return linhas.join('\n');
}

// Compara duas respostas fechadas e devolve uma frase ("de X para Y") ou null.
function deParaRotulo(campo, ini, fin) {
  if (!fin) return null;
  const a = rotulo(campo, ini);
  const b = rotulo(campo, fin);
  if (!a) return minuscula(b);
  return a === b ? `${minuscula(b)} (sem alteração)` : `de ${minuscula(a)} para ${minuscula(b)}`;
}

function gerarImpacto({ inicial, final, destinosFinal }) {
  const vazio = {
    impactoAlimentar: '',
    impactoDesafios: '',
    impactoEconomico: '',
  };
  if (!final) {
    return {
      impactoAlimentar: 'Questionário final ainda não aplicado. Descreva aqui a melhoria das escolhas alimentares da família.',
      impactoDesafios: 'Descreva os desafios enfrentados pela comunidade e as potencialidades identificadas.',
      impactoEconomico: 'Descreva os avanços financeiros observados na família.',
    };
  }
  const saida = { ...vazio };

  // Alimentação
  const alim = [];
  const acesso = deParaRotulo('acessoAlimentosInNatura', inicial?.acessoAlimentosInNatura, final.acessoAlimentosInNatura);
  if (acesso) alim.push(`O acesso a alimentos in natura passou ${acesso}.`);
  const freq = deParaRotulo('frequenciaFrutasVerduras', inicial?.frequenciaFrutasVerduras, final.frequenciaFrutasVerduras);
  if (freq) alim.push(`O consumo de frutas, verduras e legumes passou ${freq}.`);
  if (final.qualidadeAlimentacao) {
    alim.push(`Sobre a qualidade da alimentação, a família relata que ${minuscula(rotulo('qualidadeAlimentacao', final.qualidadeAlimentacao))}.`);
  }
  if (final.saudeNutricional) {
    alim.push(`Em relação à saúde e ao bem-estar nutricional, a família percebe: ${minuscula(rotulo('saudeNutricional', final.saudeNutricional))}.`);
  }
  saida.impactoAlimentar = alim.join('\n');

  // Desafios e oportunidades (respostas abertas)
  const des = [];
  if (final.impactoComunidade) des.push(`Impacto percebido na comunidade: ${final.impactoComunidade}`);
  if (final.oQueMelhorar) des.push(`Pontos a melhorar apontados pela família: ${final.oQueMelhorar}`);
  saida.impactoDesafios = des.join('\n');

  // Econômico
  const eco = [];
  const ri = inicial?.rendaMensalMedia;
  const rf = final.rendaMensalMedia;
  if (ri !== null && ri !== undefined && rf !== null && rf !== undefined) {
    const dif = rf - ri;
    if (dif === 0) eco.push(`A renda mensal média permaneceu em ${moeda(rf)}.`);
    else {
      const pct = ri > 0 ? ` (${dif > 0 ? '+' : '−'}${numero(Math.abs(dif / ri) * 100, 1)}%)` : '';
      eco.push(`A renda mensal média ${dif > 0 ? 'aumentou' : 'diminuiu'} de ${moeda(ri)} para ${moeda(rf)}${pct}.`);
    }
  } else if (rf !== null && rf !== undefined) {
    eco.push(`A renda mensal média informada ao final foi de ${moeda(rf)}.`);
  }
  if (final.economiaMensalFaixa || final.economiaMensalValor !== null && final.economiaMensalValor !== undefined) {
    const faixa = final.economiaMensalFaixa ? rotulo('economiaMensalFaixa', final.economiaMensalFaixa) : '';
    const valor = final.economiaMensalValor !== null && final.economiaMensalValor !== undefined ? moeda(final.economiaMensalValor) : '';
    eco.push(`A economia mensal proporcionada pelo Armazém Solidário foi estimada em ${[valor, faixa && `(faixa: ${faixa})`].filter(Boolean).join(' ')}.`);
  }
  if (destinosFinal?.length || final.destinoEconomiaOutro) {
    const d = [...(destinosFinal || []).map(minuscula)];
    if (final.destinoEconomiaOutro) d.push(final.destinoEconomiaOutro);
    eco.push(`A economia obtida foi destinada a: ${listaTexto(d)}.`);
  }
  if (final.conseguePoupar !== null && final.conseguePoupar !== undefined) {
    const antes = inicial?.conseguePoupar;
    if (antes === false && final.conseguePoupar === true) eco.push('A família passou a conseguir poupar.');
    else eco.push(final.conseguePoupar ? 'A família consegue poupar.' : 'A família ainda não consegue poupar.');
  }
  const poup = deParaRotulo('capacidadePoupanca', inicial?.capacidadePoupanca, final.capacidadePoupanca);
  if (poup) eco.push(`A capacidade de poupança passou ${poup}.`);
  if (final.gestaoFinanceira) {
    eco.push(`Quanto às dívidas e à gestão financeira, a família relata: ${minuscula(rotulo('gestaoFinanceira', final.gestaoFinanceira))}.`);
  }
  saida.impactoEconomico = eco.join('\n');
  return saida;
}

function gerarFeedback({ final, extrasFinal }) {
  if (!final) {
    return 'Questionário final ainda não aplicado. Registre aqui depoimentos ou análises baseadas no feedback da família.';
  }
  const l = [];
  if (final.avaliacaoArmazem) {
    l.push(`A família avaliou o Armazém Solidário como "${rotulo('avaliacaoArmazem', final.avaliacaoArmazem)}"`
      + `${final.recomendaria === true ? ' e recomendaria o programa a outras famílias' : final.recomendaria === false ? ' e não recomendaria o programa a outras famílias' : ''}.`);
  }
  if (final.principalBeneficio) l.push(`Principal benefício percebido: "${final.principalBeneficio}"`);
  if (final.contribuicaoAutonomia) l.push(`Sobre a contribuição para a autonomia financeira: "${final.contribuicaoAutonomia}"`);
  const emp = [];
  if (final.empoderadaDecisoes === true) emp.push('sente-se mais empoderada para tomar decisões');
  else if (final.empoderadaDecisoes === false) emp.push('não relata maior empoderamento para tomar decisões');
  if (final.melhoriaPlanejamento === true) emp.push('percebeu melhoria no planejamento financeiro');
  else if (final.melhoriaPlanejamento === false) emp.push('não percebeu melhoria no planejamento financeiro');
  if (emp.length) l.push(`A família ${listaTexto(emp)}.`);
  l.push(...linhasExtras(extrasFinal, 'Perguntas adicionais do questionário final:'));
  return l.join('\n') || 'Registre aqui depoimentos ou análises baseadas no feedback da família.';
}

function gerarConsideracoesIndividual({ final }) {
  if (!final) {
    return 'Resuma os principais resultados e impactos observados e sugira ações futuras para o acompanhamento da família.';
  }
  return 'O acompanhamento evidencia a contribuição do Armazém Solidário para a segurança alimentar e para o fortalecimento '
    + 'econômico da família. Recomenda-se a continuidade do acompanhamento pelo Serviço Social e a articulação com a rede '
    + 'socioassistencial, conforme as necessidades identificadas, garantindo a continuidade e a ampliação dos resultados alcançados.';
}

// Relatório Final Familiar (modelo oficial 4). Cada seção usa o formato do questionário correspondente: M1 (modelos oficiais) ou
// o formato anterior (LEGADO), que continua sendo lido para os acompanhamentos antigos.
function montarIndividual(dados) {
  const { acompanhamento, responsavel, membros, inicial, final, beneficiosInicial, destinosFinal, extrasInicial, extrasFinal, inicialM1, finalM1 } = dados;
  let impacto;
  let comparado = null;
  if (finalM1) {
    ({ comparado, ...impacto } = textosM1.impactoM1(inicialM1, finalM1));
  } else {
    impacto = gerarImpacto({ inicial, final, destinosFinal });
  }
  const diagnostico = inicialM1
    ? (textosM1.diagnosticoM1(inicialM1).concat(textosM1.linhasExtras(inicialM1.lista, 'Perguntas adicionais do questionário inicial:'))).join('\n')
    : gerarDiagnostico({ responsavel, membros, inicial, beneficiosInicial, dataInicio: acompanhamento.dataInicio, extrasInicial });
  const feedbackM1 = finalM1 ? textosM1.feedbackM1(finalM1) : null;
  return {
    introducao: INDIVIDUAL_FIXOS.introducao,
    objetivo: INDIVIDUAL_FIXOS.objetivo,
    metodologia: gerarMetodologia({
      unidadeNome: acompanhamento.unidadeNome, dataInicio: acompanhamento.dataInicio, inicial, final,
    }),
    diagnostico,
    ...impacto,
    evolucao: evolucaoTexto.gerarTextoEvolucao(dados.evolucao),
    feedback: finalM1
      ? (feedbackM1.join('\n') || 'Registre aqui depoimentos ou análises baseadas no feedback da família.')
      : gerarFeedback({ final, extrasFinal }),
    consideracoes: finalM1 ? textosM1.consideracoesM1(comparado, dados.evolucao?.contatos) : gerarConsideracoesIndividual({ final }),
  };
}

// ---------- Relatório Semestral ----------

const SEMESTRAL_FIXOS = Object.freeze({
  introducao:
    'Este relatório apresenta as atividades do Serviço Social desenvolvidas nos Armazéns Solidários no âmbito do Termo de '
    + 'Colaboração TCL/073/2023/SMDHC/SESANA, firmado entre a Secretaria Municipal de Direitos Humanos e Cidadania (SMDHC) e o '
    + 'INTECS. Reúne os atendimentos e encaminhamentos realizados, as visitas institucionais e demais ações junto à rede '
    + 'socioassistencial e comunitária e os resultados do acompanhamento de famílias para o empoderamento econômico.',
});

function descreverUnidades(unidades) {
  return unidades.length ? listaTexto(unidades.map((u) => u.nome)) : '';
}

function gerarTextosSemestral({ periodo, unidades, totais }) {
  const { atendimentos, encaminhamentos, atendimentosComEncaminhamento, visitas, outrasAcoes, familias, pares } = totais;
  const per = `${dataBr(periodo.dataInicio)} a ${dataBr(periodo.dataFim)}`;
  const un = descreverUnidades(unidades);

  const t = {
    introducao: `${SEMESTRAL_FIXOS.introducao}\nPeríodo de referência: ${per}.${un ? ` Unidades abrangidas: ${un}.` : ''}`,
    atendimentos: `No período de ${per} foram realizados ${plural(atendimentos, 'atendimento social', 'atendimentos sociais')}`
      + `${unidades.length > 1 ? ` nas ${unidades.length} unidades` : ''}.`,
    encaminhamentos: encaminhamentos > 0
      ? `Foram realizados ${plural(encaminhamentos, 'encaminhamento', 'encaminhamentos')} à rede de serviços, `
        + `alcançando ${plural(atendimentosComEncaminhamento, 'atendimento', 'atendimentos')} `
        + `(${percentual(atendimentosComEncaminhamento, atendimentos)} do total), conforme a distribuição por instituição abaixo.`
      : 'Não foram registrados encaminhamentos no período.',
    visitas: visitas > 0
      ? `Foram realizadas ${plural(visitas, 'visita institucional', 'visitas institucionais')} para divulgação do Armazém Solidário e articulação com a rede, `
        + 'conforme o detalhamento por unidade.'
      : 'Não foram registradas visitas institucionais realizadas no período.',
    outrasAcoes: outrasAcoes > 0
      ? `Além das visitas, foram realizadas ${plural(outrasAcoes, 'outra ação', 'outras ações')} (ações na unidade, palestras, rodas de conversa e similares).`
      : 'Não foram registradas outras ações no período.',
    empoderamento: familias > 0
      ? `No período, ${plural(familias, 'família foi acompanhada', 'famílias foram acompanhadas')} pelo Serviço Social. `
        + (pares > 0
          ? `Para ${plural(pares, 'família', 'famílias')} com questionários inicial e final concluídos, a comparação entre os dois momentos é apresentada a seguir.`
          : 'Ainda não há famílias com os questionários inicial e final concluídos no período para comparação.')
      : 'Não há famílias em acompanhamento registradas no período.',
    consideracoes: 'No período, o Serviço Social consolidou o atendimento às famílias usuárias dos Armazéns Solidários, '
      + 'fortaleceu a articulação com a rede socioassistencial e comunitária e acompanhou famílias para avaliar os impactos do programa '
      + 'na renda e na segurança alimentar. Seguiremos aprimorando as ações para ampliar o alcance e os resultados do projeto.',
  };
  return t;
}

module.exports = {
  numero, moeda, percentual, dataBr, dataExtenso, listaTexto, plural, rotulo, paragrafos, idadeEm,
  INDIVIDUAL_FIXOS, SEMESTRAL_FIXOS,
  montarIndividual, gerarDiagnostico, gerarImpacto, gerarFeedback, gerarMetodologia, gerarTextosSemestral,
};
