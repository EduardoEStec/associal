'use strict';

// M1 — Registro periódico (.docx no formato do modelo oficial 2): montagem dos dados e renderização do template, sem banco.
// Rodar: node --test tests/relatorios/registro-periodico.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PizZip = require('pizzip');

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'associal-rp-'));
process.env.UPLOAD_DIR = uploads;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABvrngfAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAC8BQPQ1QvYjAAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(path.join(uploads, 'acoes'), { recursive: true });
fs.writeFileSync(path.join(uploads, 'acoes', 'a'.repeat(32) + '.png'), PNG);

const rr = require('../../server/services/relatorios-registro');
const docx = require('../../server/services/relatorios-docx');

const responsavel = { nome: 'Maria da Silva', cpf: '11144477735', nis: '12345678901', telefone: '11987654321', telefone2: '', endereco: 'Rua A, 10', bairro: 'Centro' };

const registroBruto = (extra) => ({
  id: 1, dataRegistro: new Date('2026-10-10T00:00:00Z'), mesReferencia: new Date('2026-10-01T00:00:00Z'),
  tipoContatoNome: 'Visita domiciliar', tipoContatoOutro: null, houveContato: true, usoArmazemNome: 'Utilizou regularmente',
  orientacoesTexto: 'Orientação sobre CadÚnico', orientacaoOutro: null, orientacaoOutroNome: null, resumo: 'Família relatou redução das despesas com alimentação.', ...extra,
});

test('mesExtenso: dia 1 do mês vira "mês/ano" por extenso', () => {
  assert.equal(rr.mesExtenso('2026-10-01'), 'outubro/2026');
  assert.equal(rr.mesExtenso(new Date('2026-03-01T00:00:00Z')), 'março/2026');
  assert.equal(rr.mesExtenso(null), '');
});

test('montarLinha: colunas do modelo (mês, contato, uso do Armazém, orientações) e tentativa sem sucesso', () => {
  const l = rr.montarLinha(registroBruto({ orientacaoOutro: 'Curso de culinária', orientacaoOutroNome: 'Outros' }));
  assert.equal(l.mes, 'outubro/2026');
  assert.equal(l.dataTexto, '10/10/2026');
  assert.equal(l.contato, 'Visita domiciliar');
  assert.equal(l.uso, 'Utilizou regularmente');
  assert.equal(l.orientacoes, 'Orientação sobre CadÚnico; Outros: Curso de culinária');
  const t = rr.montarLinha(registroBruto({ id: 2, houveContato: false, tipoContatoNome: 'Contato telefônico', usoArmazemNome: 'Utilizou regularmente', resumo: null }));
  assert.equal(t.contato, 'Tentativa sem sucesso – Contato telefônico');
  assert.equal(t.uso, '', 'tentativa sem contato não tem uso do Armazém');
  // registro antigo, sem mês de referência: vale o mês da data
  assert.equal(rr.montarLinha(registroBruto({ mesReferencia: null, dataRegistro: new Date('2026-08-20T00:00:00Z') })).mes, 'agosto/2026');
});

test('montarDocumento: identificação padrão, intervalo de meses, edições e observações só dos registros com texto', () => {
  const linhas = [
    rr.montarLinha(registroBruto()),
    rr.montarLinha(registroBruto({ id: 2, dataRegistro: new Date('2026-12-02T00:00:00Z'), mesReferencia: new Date('2026-12-01T00:00:00Z'), resumo: '' })),
  ];
  const doc = rr.montarDocumento({ responsavel, linhas, profissional: 'Ana Assistente' });
  assert.equal(doc.identificacao.responsavel, 'Maria da Silva');
  assert.equal(doc.identificacao.cpfNis, '111.444.777-35 / 12345678901');
  assert.equal(doc.identificacao.contato, '(11) 98765-4321');
  assert.equal(doc.identificacao.profissional, 'Ana Assistente');
  assert.equal(doc.mesesTexto, 'outubro/2026 a dezembro/2026');
  assert.equal(doc.datasTexto, '10/10/2026, 02/12/2026');
  assert.equal(doc.observacoes.length, 1, 'registro sem texto fica fora das observações');
  assert.equal(doc.observacoes[0].rotulo, 'outubro/2026 (10/10/2026)');

  const editado = rr.montarDocumento({ responsavel, linhas, profissional: 'Ana' }, {
    identificacao: { profissional: 'Beatriz Souza', contato: '' }, observacoes: { 2: 'Retorno combinado para janeiro.' },
  });
  assert.equal(editado.identificacao.profissional, 'Beatriz Souza');
  assert.equal(editado.identificacao.contato, '', 'a assistente pode esvaziar um campo');
  assert.deepEqual(editado.observacoes.map((o) => o.texto), ['Família relatou redução das despesas com alimentação.', 'Retorno combinado para janeiro.']);
});

test('template registro-periodico.docx: tabela por mês, cabeçalho do modelo, caracteres especiais e foto com data', async () => {
  const linhas = [
    rr.montarLinha(registroBruto({ resumo: 'Pediu <ajuda> & orientação "extra".' })),
    rr.montarLinha(registroBruto({ id: 2, houveContato: false, tipoContatoNome: 'Contato telefônico', dataRegistro: new Date('2026-11-12T00:00:00Z'), mesReferencia: null, resumo: null })),
  ];
  const doc = rr.montarDocumento({ responsavel, linhas, profissional: 'Ana' });
  const anexos = await docx.montarAnexos([{
    nome: 'Brasilândia',
    fotos: [{ caminho: path.join(uploads, 'acoes', 'a'.repeat(32) + '.png'), legenda: 'Visita domiciliar – cozinha', data: '2026-10-10', local: '' }],
  }]);
  const buffer = docx.renderizar('registro-periodico', {
    ...doc.identificacao, mesesTexto: doc.mesesTexto, datasTexto: doc.datasTexto,
    linhas: doc.linhas.map((l) => ({ mes: l.mes, dataTexto: l.dataTexto, contato: l.contato, uso: l.uso, orientacoes: l.orientacoes })),
    observacoes: doc.observacoes, semObservacoes: doc.observacoes.length === 0, semFotos: anexos.xml === '',
  }, anexos);

  const zip = new PizZip(buffer);
  const xml = zip.file('word/document.xml').asText();
  const texto = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const esperado of [
    'REGISTRO PERIÓDICO DE ACOMPANHAMENTO', 'Periodicidade sugerida: registro mensal ou bimestral',
    'Responsável Familiar: Maria da Silva', 'CPF/CadÚnico: 111.444.777-35', 'Profissional responsável: Ana',
    'Contato/atendimento realizado', 'Uso do Armazém', 'Assinatura/família',
    'outubro/2026', 'Visita domiciliar', 'Utilizou regularmente', 'Tentativa sem sucesso – Contato telefônico', 'novembro/2026',
    'Observações do profissional', 'Pediu <ajuda> & orientação "extra".', 'OBSERVAÇÕES', 'Mudança na composição familiar;', 'ANEXOS',
    'Foto 1 – Visita domiciliar – cozinha (10/10/2026)',
  ]) assert.ok(texto.includes(esperado), `faltou: ${esperado}`);
  assert.ok(!texto.includes('Nenhuma foto anexada'), 'com foto, não diz que não há fotos');
  assert.ok(zip.file(/word\/media\/foto_anexo_1\.png/).length === 1, 'a foto foi incorporada ao pacote');
  assert.ok(zip.file('word/header1.xml'), 'cabeçalho (papel timbrado) preservado');
  assert.match(xml, /w:orient="landscape"/, 'página em paisagem como no modelo');
  assert.equal((xml.match(/<w:tr[ >]/g) || []).length, 3, 'cabeçalho + uma linha por registro');
});

test('template registro-periodico.docx sem registros e sem fotos', () => {
  const doc = rr.montarDocumento({ responsavel, linhas: [], profissional: 'Ana' });
  const buffer = docx.renderizar('registro-periodico', {
    ...doc.identificacao, mesesTexto: '', datasTexto: '', linhas: [], observacoes: [], semObservacoes: true, semFotos: true,
  });
  const texto = new PizZip(buffer).file('word/document.xml').asText().replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  assert.ok(texto.includes('Sem observações do profissional registradas no período.'));
  assert.ok(texto.includes('Nenhuma foto anexada neste período.'));
});

test.after(() => fs.rmSync(uploads, { recursive: true, force: true }));
