'use strict';

// Gera os templates docxtemplater dos modelos oficiais (M1) a partir do próprio papel timbrado dos modelos em docs/modelos:
//   server/templates/individual.docx            RELATÓRIO FINAL FAMILIAR (modelo 4)
//   server/templates/questionario-inicial.docx  QUESTIONÁRIO INICIAL DE ACOMPANHAMENTO FAMILIAR (modelo 1)
//   server/templates/questionario-final.docx    QUESTIONÁRIO FINAL FAMILIAR (modelo 3)
//
//   node tests/relatorios/construir-templates-m1.js ["caminho/do/modelo.docx"]
//
// Preserva cabeçalho (papel timbrado), estilos, margens e a fonte dos modelos (Times New Roman 12); troca só o corpo.
// Só precisa rodar quando o texto/estrutura dos templates mudar (os .docx gerados são versionados).

const fs = require('node:fs');
const path = require('node:path');
const PizZip = require('pizzip');

const origem = process.argv[2] || path.resolve(__dirname, '..', '..', 'docs', 'modelos', '4-relatorio-final-familiar.docx');
const destino = path.resolve(__dirname, '..', '..', 'server', 'templates');

// ---------- helpers de XML ----------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONTE = 'Times New Roman';

const rpr = ({ b = false, sz = 24 } = {}) =>
  `<w:rPr><w:rFonts w:ascii="${FONTE}" w:eastAsia="${FONTE}" w:hAnsi="${FONTE}" w:cs="${FONTE}"/>${b ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;

// Parágrafo com um único run. `texto` pode conter tags do docxtemplater.
function par(texto, { b = false, jc, sz = 24, corrido = false, antes = 0, depois, manter = false, recuo = 0, linha } = {}) {
  const ppr = [
    manter ? '<w:keepNext/>' : '',
    `<w:spacing w:before="${antes}" w:after="${depois ?? (corrido ? 120 : 0)}" w:line="${linha ?? (corrido ? 360 : 276)}" w:lineRule="auto"/>`,
    recuo ? `<w:ind w:left="${recuo}"/>` : '',
    jc ? `<w:jc w:val="${jc}"/>` : '',
  ].join('');
  const run = texto === '' ? '' : `<w:r>${rpr({ b, sz })}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
  return `<w:p><w:pPr>${ppr}${rpr({ b, sz })}</w:pPr>${run}</w:p>`;
}

const vazio = () => par('');
const titulo = (t) => par(t, { b: true, jc: 'center', sz: 28, depois: 200 });
const secao = (t) => par(t, { b: true, antes: 240, depois: 120, manter: true });
const subsecao = (t) => par(t, { b: true, antes: 120, depois: 60, manter: true });
// Parágrafo repetido para cada linha de um texto editável (abertura e fechamento do loop ficam em parágrafos próprios)
const abre = (nome) => par(`{#${nome}}`);
const fecha = (nome) => par(`{/${nome}}`);
const textoLista = (nome) => abre(nome) + par('{.}', { jc: 'both', corrido: true }) + fecha(nome);

// Bloco de assinatura dos modelos: linha, nome, Assistente Social, CRESS/SP e assinatura do responsável familiar
const assinatura = ({ responsavel = false } = {}) => [
  vazio(), vazio(),
  par('___________________________________________', { jc: 'center', manter: true }),
  par('{assinaturaNome}', { jc: 'center', manter: true }),
  par('Assistente Social', { jc: 'center', manter: true }),
  par('{cressLinha}', { jc: 'center', manter: !!responsavel }),
  responsavel ? vazio() : '',
  responsavel ? par('Assinatura responsável familiar: __________________________________', { antes: 120 }) : '',
].join('');

// ---------- corpos ----------

// Modelo 4: RELATÓRIO FINAL FAMILIAR
function corpoRelatorioFinal() {
  return [
    titulo('RELATÓRIO FINAL FAMILIAR'),
    par('Responsável Familiar: {responsavel}'),
    par('CPF/CadÚnico: {cpfNis}'),
    par('Contato: {contato}            Endereço: {endereco}'),
    vazio(),
    secao('1. Introdução'), textoLista('introducao'),
    secao('2. Objetivo'), textoLista('objetivo'),
    secao('3. Metodologia'), textoLista('metodologia'),
    secao('4. Diagnóstico Inicial'),
    subsecao('Situação Socioeconômica Identificada:'), textoLista('diagnostico'),
    secao('5. Impacto na Comunidade'),
    subsecao('Melhoria das escolhas alimentares.'), textoLista('impactoAlimentar'),
    subsecao('Desafios e Oportunidades:'), textoLista('impactoDesafios'),
    subsecao('Impactos Econômicos:'), textoLista('impactoEconomico'),
    // aparece só quando há evolução (índice de progresso com 2 ou mais pontos) ou texto
    abre('temEvolucao'), subsecao('Evolução durante o acompanhamento:'), textoLista('evolucao'), par('{@evolucaoTabela}'), par('', { depois: 120 }), fecha('temEvolucao'),
    secao('6. Feedback dos Beneficiários'), textoLista('feedback'),
    secao('7. Considerações finais'), textoLista('consideracoes'),
    vazio(),
    par('{localData}', { jc: 'right' }),
    assinatura(),
  ].join('');
}

// Estrutura comum dos questionários preenchidos: seções -> perguntas -> opções "( X ) texto" e/ou resposta
function blocoSecoes() {
  return [
    abre('secoes'),
    par('{titulo}', { b: true, antes: 240, depois: 120, manter: true }),
    abre('linhasFixas'), par('{.}'), fecha('linhasFixas'),
    abre('perguntas'),
    par('{rotulo}', { antes: 160, depois: 40, manter: true, b: false }),
    abre('opcoes'), par('( {marca} ) {texto}', { recuo: 360, depois: 0 }), fecha('opcoes'),
    abre('temResposta'), abre('resposta'), par('{.}', { recuo: 360, depois: 0 }), fecha('resposta'), fecha('temResposta'),
    fecha('perguntas'),
    fecha('secoes'),
  ].join('');
}

// Modelo 1: QUESTIONÁRIO INICIAL
function corpoInicial() {
  return [
    titulo('QUESTIONÁRIO INICIAL DE ACOMPANHAMENTO FAMILIAR'),
    par('Unidade: {unidade}'),
    par('Assistente Social responsável: {assistente}'),
    par('Data de início do acompanhamento: {dataInicio}'),
    par('Data prevista para conclusão: {dataPrevista}'),
    par('Meta: {meta}', { jc: 'both', antes: 80 }),
    blocoSecoes(),
    assinatura({ responsavel: true }),
  ].join('');
}

// Modelo 3: QUESTIONÁRIO FINAL FAMILIAR
function corpoFinal() {
  return [
    titulo('QUESTIONÁRIO FINAL FAMILIAR: após acesso ao armazém solidário'),
    par('Unidade: {unidade}'),
    par('Assistente Social responsável: {assistente}'),
    par('Responsável Familiar: {responsavel}'),
    par('CPF/CadÚnico: {cpfNis}'),
    par('Contato: {contato}     Endereço: {endereco}'),
    par('Data de início do acompanhamento: {dataInicio}'),
    par('Data final de aplicação do questionário: {dataAplicacao}'),
    blocoSecoes(),
    assinatura({ responsavel: true }),
  ].join('');
}

// ---------- montagem ----------
function gerar(nomeArquivo, corpoXml) {
  const zip = new PizZip(fs.readFileSync(origem));
  const doc = zip.file('word/document.xml').asText();
  const inicio = doc.indexOf('<w:body>') + '<w:body>'.length;
  const sect = doc.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)[0];
  zip.file('word/document.xml', doc.slice(0, inicio) + corpoXml + sect + doc.slice(doc.indexOf('</w:body>')));
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, nomeArquivo), zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`gerado: server/templates/${nomeArquivo}`);
}

if (!fs.existsSync(origem)) {
  console.error(`Modelo original não encontrado: ${origem}\nInforme o caminho como argumento.`);
  process.exit(1);
}
gerar('individual.docx', corpoRelatorioFinal());
gerar('questionario-inicial.docx', corpoInicial());
gerar('questionario-final.docx', corpoFinal());
