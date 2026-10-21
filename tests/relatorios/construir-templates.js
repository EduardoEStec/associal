'use strict';

// Gera server/templates/individual.docx e semestral.docx (templates docxtemplater) a partir do modelo
// original da INTECS — preserva papel timbrado (cabeçalho), estilos, margens e fontes; troca só o corpo.
//
//   node tests/relatorios/construir-templates.js ["C:\caminho\4.Modelo RELATÓRIO INDIVIDUAL FAMILIAR ....docx"]
//
// Só precisa ser executado quando o texto/estrutura dos templates mudar (os .docx gerados são versionados).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const PizZip = require('pizzip');

const MODELO_PADRAO = path.join(
  os.homedir(), 'Documents', 'ASSOCIAL', '4.Modelo RELATÓRIO INDIVIDUAL FAMILIAR empoderamento economico.docx',
);
const origem = process.argv[2] || MODELO_PADRAO;
const destino = path.resolve(__dirname, '..', '..', 'server', 'templates');
const LARGURA = 9070; // twips úteis (A4 menos margens de 2,5 cm)

// ---------- helpers de XML ----------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rpr = ({ b = false, sz = 24, cor } = {}) =>
  `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${b ? '<w:b/><w:bCs/>' : ''}`
  + `${cor ? `<w:color w:val="${cor}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;

// Parágrafo com um único run. `texto` pode conter tags do docxtemplater.
function par(texto, { b = false, jc, sz = 24, texto_corrido = false, antes = 0, depois, manter = false, quebraPagina = false } = {}) {
  const ppr = [
    manter ? '<w:keepNext/>' : '',
    quebraPagina ? '<w:pageBreakBefore/>' : '',
    texto_corrido
      ? `<w:spacing w:before="${antes}" w:after="${depois ?? 120}" w:line="360" w:lineRule="auto"/>`
      : `<w:spacing w:before="${antes}" w:after="${depois ?? 0}" w:line="240" w:lineRule="auto"/>`,
    jc ? `<w:jc w:val="${jc}"/>` : '',
  ].join('');
  const run = texto === '' ? '' : `<w:r>${rpr({ b, sz })}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
  return `<w:p><w:pPr>${ppr}${rpr({ b, sz })}</w:pPr>${run}</w:p>`;
}

const vazio = () => par('');
const titulo = (t) => par(t, { b: true, jc: 'center' });
const secao = (t) => par(t, { b: true, antes: 240, depois: 120, manter: true });
const subsecao = (t) => par(t, { b: true, antes: 120, depois: 60, manter: true });
const corpo = (t) => par(t, { jc: 'both', texto_corrido: true });
// Parágrafo repetido para cada linha de um texto editável (lista de strings).
// (abertura e fechamento do loop ficam em parágrafos próprios: são removidos e o do meio se repete — paragraphLoop)
const abre = (nome) => par(`{#${nome}}`);
const fecha = (nome) => par(`{/${nome}}`);
const textoLista = (nome) => abre(nome) + par('{.}', { jc: 'both', texto_corrido: true }) + fecha(nome);

function celula(texto, largura, { b = false, jc = 'left', fundo } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fundo}"/>` : ''}</w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="${jc}"/>${rpr({ b, sz: 20 })}</w:pPr>`
    + `<w:r>${rpr({ b, sz: 20 })}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p></w:tc>`;
}

// colunas: [{ titulo, largura (fração), campo, jc }]. A linha de dados é repetida (loop) para cada item de `lista`.
function tabela(lista, colunas) {
  const total = colunas.reduce((s, c) => s + c.largura, 0);
  const larg = colunas.map((c) => Math.round((c.largura / total) * LARGURA));
  const borda = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const cab = colunas.map((c, i) => celula(c.titulo, larg[i], { b: true, jc: c.jc || 'left', fundo: 'D9E2D5' })).join('');
  const dados = colunas.map((c, i) => {
    let t = `{${c.campo}}`;
    if (i === 0) t = `{#${lista}}${t}`;
    if (i === colunas.length - 1) t = `${t}{/${lista}}`;
    return celula(t, larg[i], { jc: c.jc || 'left' });
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${larg.map((l) => `<w:gridCol w:w="${l}"/>`).join('')}</w:tblGrid>`
    + `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${cab}</w:tr>`
    + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${dados}</w:tr></w:tbl>`;
}

const espaco = () => par('', { depois: 120 });

// ---------- corpos ----------
function corpoIndividual() {
  return [
    vazio(), vazio(),
    titulo('RELATÓRIO INDIVIDUAL FAMILIAR'),
    vazio(),
    par('Nome: {nome}'),
    par('Responsável Familiar: {responsavel}'),
    par('CPF: {cpf}        CadÚnico: {nis}'),
    par('Contato: {contato}        Endereço: {endereco}'),
    par('Unidade: {unidade}'),
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
    // F5: aparece só quando há evolução (índice de progresso com 2 ou mais pontos) ou texto
    abre('temEvolucao'), subsecao('Evolução durante o acompanhamento:'), textoLista('evolucao'), par('{@evolucaoTabela}'), par('', { depois: 120 }), fecha('temEvolucao'),
    secao('6. Feedback dos Beneficiários'), textoLista('feedback'),
    secao('7. Considerações finais'), textoLista('consideracoes'),
    vazio(),
    par('{localData}', { jc: 'right' }),
    vazio(), vazio(),
    par('___________________________________________', { jc: 'center' }),
    par('{assinaturaNome}', { jc: 'center' }),
    par('{assinaturaCargo}', { jc: 'center' }),
    par('{cressLinha}', { jc: 'center' }),
  ].join('');
}

function corpoSemestral() {
  const visitas = [
    { titulo: 'Data', largura: 1, campo: 'data' },
    { titulo: 'Instituição / Comunidade', largura: 3, campo: 'local' },
    { titulo: 'Temas', largura: 2.2, campo: 'temas' },
    { titulo: 'Participantes', largura: 1.5, campo: 'participantes', jc: 'right' },
  ];
  return [
    vazio(), vazio(),
    titulo('RELATÓRIO SEMESTRAL – PRESTAÇÃO DE CONTAS'),
    titulo('SERVIÇO SOCIAL – ARMAZÉNS SOLIDÁRIOS'),
    vazio(),
    par('Termo de Colaboração TCL/073/2023/SMDHC/SESANA', { jc: 'center' }),
    par('Período: {periodoTexto}', { jc: 'center' }),
    par('Unidades: {unidadesTexto}', { jc: 'center' }),
    vazio(),
    secao('1. Introdução'), textoLista('introducao'),

    secao('2. Atividades'),
    subsecao('2.1 Atendimentos'), textoLista('atendimentos'),
    tabela('atendimentosUnidades', [
      { titulo: 'Unidade', largura: 3, campo: 'nome' },
      { titulo: 'Atendimentos', largura: 1.4, campo: 'atendimentos', jc: 'right' },
      { titulo: 'Encaminhamentos', largura: 1.6, campo: 'encaminhamentos', jc: 'right' },
      { titulo: '% com encaminh.', largura: 1.5, campo: 'percentual', jc: 'right' },
    ]),
    espaco(),
    par('Total: {totalAtendimentos} atendimentos; {totalEncaminhamentos} encaminhamentos.', { b: true, depois: 120 }),

    subsecao('2.2 Encaminhamentos'), textoLista('encaminhamentos'),
    abre('temInstituicoes'),
    tabela('instituicoes', [
      { titulo: 'Instituição / serviço de encaminhamento', largura: 5, campo: 'nome' },
      { titulo: 'Quantidade', largura: 1.2, campo: 'quantidade', jc: 'right' },
    ]),
    espaco(),
    fecha('temInstituicoes'),

    subsecao('2.3 Visitas institucionais'), textoLista('visitas'),
    abre('visitasUnidades'),
    par('{nome} – {quantidade} visita(s)', { b: true, antes: 120, depois: 60, manter: true }),
    abre('temItens'),
    tabela('itens', visitas),
    espaco(),
    fecha('temItens'),
    abre('semItens'),
    par('Nenhuma visita institucional registrada no período.', { depois: 120 }),
    fecha('semItens'),
    fecha('visitasUnidades'),

    subsecao('2.4 Outras ações'), textoLista('outrasAcoes'),
    abre('temOutrasAcoes'),
    tabela('outras', [
      { titulo: 'Data', largura: 1, campo: 'data' },
      { titulo: 'Unidade', largura: 0.9, campo: 'sigla' },
      { titulo: 'Tipo', largura: 1.5, campo: 'tipo' },
      { titulo: 'Local', largura: 2.4, campo: 'local' },
      { titulo: 'Participantes', largura: 1.5, campo: 'participantes', jc: 'right' },
    ]),
    espaco(),
    fecha('temOutrasAcoes'),

    secao('3. Empoderamento econômico'), textoLista('empoderamento'),
    abre('temFamiliasUnidades'),
    tabela('familiasUnidades', [
      { titulo: 'Unidade', largura: 3, campo: 'nome' },
      { titulo: 'Famílias acompanhadas', largura: 2, campo: 'familias', jc: 'right' },
    ]),
    espaco(),
    fecha('temFamiliasUnidades'),
    abre('temComparacao'),
    subsecao('Resultados da comparação inicial × final'),
    tabela('indicadores', [
      { titulo: 'Indicador', largura: 3.6, campo: 'rotulo' },
      { titulo: 'Inicial', largura: 1.7, campo: 'inicial', jc: 'right' },
      { titulo: 'Final', largura: 1.7, campo: 'final', jc: 'right' },
    ]),
    espaco(),
    tabela('distribuicoes', [
      { titulo: 'Pergunta', largura: 2.6, campo: 'pergunta' },
      { titulo: 'Resposta', largura: 2.4, campo: 'resposta' },
      { titulo: 'Inicial', largura: 0.9, campo: 'inicial', jc: 'right' },
      { titulo: 'Final', largura: 0.9, campo: 'final', jc: 'right' },
    ]),
    espaco(),
    fecha('temComparacao'),
    abre('temRelatos'),
    subsecao('Relatos das famílias'),
    abre('relatos'),
    par('“{texto}” ({sigla})', { jc: 'both', texto_corrido: true }),
    fecha('relatos'),
    fecha('temRelatos'),

    // F6: progresso das famílias (índice, metas, acompanhamentos) e satisfação; só aparecem quando há dados
    abre('temProgresso'),
    secao('4. Acompanhamento e evolução das famílias'), textoLista('progresso'),
    abre('temTabelaProgresso'),
    subsecao('Famílias que melhoraram, ficaram iguais ou pioraram (índice de progresso)'),
    tabela('progressoDimensoes', [
      { titulo: 'Dimensão', largura: 3, campo: 'nome' },
      { titulo: 'Famílias', largura: 1.2, campo: 'familias', jc: 'right' },
      { titulo: 'Melhoraram', largura: 1.4, campo: 'melhoraram', jc: 'right' },
      { titulo: 'Iguais', largura: 1, campo: 'iguais', jc: 'right' },
      { titulo: 'Pioraram', largura: 1.2, campo: 'pioraram', jc: 'right' },
      { titulo: '% que melhoraram', largura: 1.6, campo: 'percentual', jc: 'right' },
    ]),
    espaco(),
    tabela('progressoUnidades', [
      { titulo: 'Unidade', largura: 2.4, campo: 'nome' },
      { titulo: 'Famílias', largura: 1.1, campo: 'familias', jc: 'right' },
      { titulo: 'Melhor.', largura: 1.1, campo: 'melhoraram', jc: 'right' },
      { titulo: 'Iguais', largura: 1, campo: 'iguais', jc: 'right' },
      { titulo: 'Pior.', largura: 1, campo: 'pioraram', jc: 'right' },
      { titulo: '% melhoraram', largura: 1.5, campo: 'percentual', jc: 'right' },
      { titulo: 'Índice (inicial → atual)', largura: 2, campo: 'indice', jc: 'right' },
    ]),
    espaco(),
    fecha('temTabelaProgresso'),
    abre('temMetas'),
    subsecao('Metas das famílias'),
    tabela('metasDimensoes', [
      { titulo: 'Dimensão', largura: 2.6, campo: 'nome' },
      { titulo: 'Metas', largura: 1, campo: 'total', jc: 'right' },
      { titulo: 'Em andamento', largura: 1.5, campo: 'emAndamento', jc: 'right' },
      { titulo: 'Atingidas', largura: 1.3, campo: 'atingidas', jc: 'right' },
      { titulo: 'Não atingidas', largura: 1.5, campo: 'naoAtingidas', jc: 'right' },
      { titulo: 'Canceladas', largura: 1.3, campo: 'canceladas', jc: 'right' },
    ]),
    espaco(),
    fecha('temMetas'),
    fecha('temProgresso'),

    abre('temSatisfacao'),
    secao('5. Satisfação das famílias'), textoLista('satisfacao'),
    abre('temTabelaSatisfacao'),
    subsecao('Concordância por afirmação'),
    tabela('satisfacaoPerguntas', [
      { titulo: 'Afirmação', largura: 4.6, campo: 'nome' },
      { titulo: 'Respostas', largura: 1.2, campo: 'respostas', jc: 'right' },
      { titulo: 'Concordância', largura: 1.5, campo: 'concordancia', jc: 'right' },
      { titulo: 'Média (1 a 5)', largura: 1.4, campo: 'media', jc: 'right' },
    ]),
    espaco(),
    fecha('temTabelaSatisfacao'),
    subsecao('Por unidade'),
    tabela('satisfacaoUnidades', [
      { titulo: 'Unidade', largura: 2.6, campo: 'nome' },
      { titulo: 'Respostas', largura: 1.2, campo: 'respostas', jc: 'right' },
      { titulo: 'Recusas', largura: 1.1, campo: 'recusas', jc: 'right' },
      { titulo: 'Nota geral (NPS)', largura: 1.6, campo: 'nps', jc: 'right' },
      { titulo: 'Satisfação', largura: 1.3, campo: 'satisfacao', jc: 'right' },
      { titulo: 'Situação', largura: 1.3, campo: 'situacao', jc: 'center' },
    ]),
    espaco(),
    abre('temComentariosSatisfacao'),
    subsecao('Trechos dos comentários das famílias'),
    abre('comentariosSatisfacao'),
    par('“{texto}” ({sigla})', { jc: 'both', texto_corrido: true }),
    fecha('comentariosSatisfacao'),
    fecha('temComentariosSatisfacao'),
    fecha('temSatisfacao'),

    secao('6. Considerações finais'), textoLista('consideracoes'),
    vazio(),
    par('{localData}', { jc: 'right' }),
    vazio(), vazio(),
    par('___________________________________________', { jc: 'center' }),
    par('{assinaturaNome}', { jc: 'center' }),
    par('{assinaturaCargo}', { jc: 'center' }),
    par('{cressLinha}', { jc: 'center' }),
    par('{@anexosXml}'),
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
gerar('individual.docx', corpoIndividual());
gerar('semestral.docx', corpoSemestral());
