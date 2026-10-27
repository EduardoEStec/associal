'use strict';

// Gera server/templates/registro-periodico.docx (template docxtemplater do REGISTRO PERIÓDICO DE ACOMPANHAMENTO)
// a partir do modelo oficial docs/modelos/2-registro-periodico.docx — preserva papel timbrado (cabeçalho), página A4
// em paisagem, margens e fonte (Times New Roman 12); troca só o corpo.
//
//   node tests/relatorios/construir-template-registro.js [caminho do modelo .docx]
//
// Só precisa ser executado quando o texto/estrutura do template mudar (o .docx gerado é versionado).

const fs = require('node:fs');
const path = require('node:path');
const PizZip = require('pizzip');

const RAIZ = path.resolve(__dirname, '..', '..');
const origem = process.argv[2] || path.join(RAIZ, 'docs', 'modelos', '2-registro-periodico.docx');
const destino = path.join(RAIZ, 'server', 'templates', 'registro-periodico.docx');
const LARGURA = 12868; // twips úteis (A4 paisagem 16838 menos margens de 1985 de cada lado)

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rpr = ({ b = false, sz = 24 } = {}) =>
  `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${b ? '<w:b/><w:bCs/>' : ''}`
  + `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;

const run = (texto, o) => `<w:r>${rpr(o)}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;

// Parágrafo com vários trechos [{ texto, b }]
function par(trechos, { jc, sz = 24, antes = 0, depois = 60, manter = false, quebraPagina = false, linha = 240 } = {}) {
  const lista = typeof trechos === 'string' ? [{ texto: trechos }] : trechos;
  const ppr = `${manter ? '<w:keepNext/>' : ''}${quebraPagina ? '<w:pageBreakBefore/>' : ''}`
    + `<w:spacing w:before="${antes}" w:after="${depois}" w:line="${linha}" w:lineRule="auto"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}`;
  return `<w:p><w:pPr>${ppr}${rpr({ sz })}</w:pPr>${lista.filter((t) => t.texto !== '').map((t) => run(t.texto, { b: t.b, sz })).join('')}</w:p>`;
}

const vazio = () => par('');
const secao = (t) => par([{ texto: t, b: true }], { antes: 240, depois: 100, manter: true });
const abre = (nome) => par(`{#${nome}}`);
const fecha = (nome) => par(`{/${nome}}`);
const linhaCampo = (rotulo, campo) => par([{ texto: `${rotulo}: `, b: true }, { texto: `{${campo}}` }], { linha: 300 });

function celula(paragrafos, largura, { b = false, jc = 'left', fundo } = {}) {
  const lista = Array.isArray(paragrafos) ? paragrafos : [paragrafos];
  const borda = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/><w:tcBorders>${['top', 'left', 'bottom', 'right'].map(borda).join('')}</w:tcBorders>`
    + `${fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fundo}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`
    + lista.map((t) => `<w:p><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/><w:jc w:val="${jc}"/>${rpr({ b })}</w:pPr>`
      + `${t === '' ? '' : run(t, { b })}</w:p>`).join('')
    + '</w:tc>';
}

// Colunas do modelo: Mês | Contato/atendimento realizado | Uso do Armazém | Orientações/encaminhamentos/outros | Assinatura/família
const COLUNAS = [
  { titulo: 'Mês', largura: 1500 },
  { titulo: 'Contato/atendimento realizado', largura: 2700 },
  { titulo: 'Uso do Armazém', largura: 2300 },
  { titulo: 'Orientações/encaminhamentos/outros', largura: 3668 },
  { titulo: 'Assinatura/família', largura: 2700 },
];

function tabela() {
  const total = COLUNAS.reduce((s, c) => s + c.largura, 0);
  if (total !== LARGURA) throw new Error(`Larguras somam ${total}, esperado ${LARGURA}`);
  const cab = COLUNAS.map((c) => celula(c.titulo, c.largura, { b: true, jc: 'center' })).join('');
  // a linha de dados se repete para cada registro (loop `linhas`); a última coluna fica em branco para a assinatura da família
  const dados = [
    celula(['{#linhas}{mes}', '{dataTexto}'], COLUNAS[0].largura, { jc: 'center' }),
    celula('{contato}', COLUNAS[1].largura),
    celula('{uso}', COLUNAS[2].largura),
    celula('{orientacoes}', COLUNAS[3].largura),
    celula(['{/linhas}', ''], COLUNAS[4].largura),
  ].join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA}" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + '<w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${COLUNAS.map((c) => `<w:gridCol w:w="${c.largura}"/>`).join('')}</w:tblGrid>`
    + `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${cab}</w:tr>`
    + `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="700"/></w:trPr>${dados}</w:tr></w:tbl>`;
}

function corpo() {
  return [
    par([{ texto: 'REGISTRO PERIÓDICO DE ACOMPANHAMENTO', b: true }], { jc: 'center', sz: 36, depois: 120 }),
    par([{ texto: 'Periodicidade sugerida:', b: true }, { texto: ' registro mensal ou bimestral, conforme a rotina da unidade.' }], { depois: 120 }),
    linhaCampo('Responsável Familiar', 'responsavel'),
    linhaCampo('CPF/CadÚnico', 'cpfNis'),
    linhaCampo('Contato', 'contato'),
    linhaCampo('Mês de referência', 'mesesTexto'),
    linhaCampo('Data do acompanhamento', 'datasTexto'),
    linhaCampo('Endereço', 'endereco'),
    linhaCampo('Profissional responsável', 'profissional'),
    vazio(),
    tabela(),
    vazio(),
    par([{ texto: 'Observações do profissional', b: true }], { manter: true, depois: 100 }),
    abre('observacoes'),
    par([{ texto: '{rotulo}: ', b: true }, { texto: '{texto}' }], { jc: 'both', linha: 300, depois: 100 }),
    fecha('observacoes'),
    abre('semObservacoes'),
    par('Sem observações do profissional registradas no período.', { depois: 100 }),
    fecha('semObservacoes'),
    secao('OBSERVAÇÕES'),
    par('No campo (observações do profissional), registrar fatos que possam contribuir para a análise da evolução da família durante o acompanhamento, ou algo que possa dificultar a meta como:', { jc: 'both', depois: 60 }),
    ...[
      'Mudança na composição familiar;',
      'Mudança na situação de segurança alimentar;',
      'Acesso a benefícios/serviços públicos;',
      'Mudança na frequência de utilização do Armazém;',
      'Resistência da família em querer responder o questionário ou tirar foto;',
      'Falta de um espaço reservado para fazer o acolhimento;',
      'Outras mudanças relevantes.',
    ].map((t) => par(`•  ${t}`, { depois: 20 })),
    secao('ANEXOS'),
    par('Fotos somente com o aceite da família, com a data do dia em que foi feito o acompanhamento.', { depois: 60 }),
    abre('semFotos'),
    par('Nenhuma foto anexada neste período.', { depois: 60 }),
    fecha('semFotos'),
    par('{@anexosXml}'),
  ].join('');
}

if (!fs.existsSync(origem)) {
  console.error(`Modelo oficial não encontrado: ${origem}\nInforme o caminho como argumento.`);
  process.exit(1);
}
const zip = new PizZip(fs.readFileSync(origem));
const doc = zip.file('word/document.xml').asText();
const inicio = doc.indexOf('<w:body>') + '<w:body>'.length;
const sect = doc.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)[0];
zip.file('word/document.xml', doc.slice(0, inicio) + corpo() + sect + doc.slice(doc.indexOf('</w:body>')));
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('gerado: server/templates/registro-periodico.docx');
