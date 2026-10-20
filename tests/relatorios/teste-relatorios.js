'use strict';

// Testes do módulo de relatórios SEM SQL Server: `server/db.js` é substituído por um banco simulado
// que devolve dados fixos (e respeita o filtro de unidade que as rotas passam nos parâmetros).
//
//   node tests/relatorios/teste-relatorios.js [pasta-de-saida-dos-docx]
//
// Se uma pasta de saída for informada, grava os .docx gerados nela para conferência visual no Word.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const SAIDA = process.argv[2] ? path.resolve(process.argv[2]) : null;
const RAIZ = path.resolve(__dirname, '..', '..');
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'associal-uploads-'));
process.env.UPLOAD_DIR = UPLOADS;
process.env.NODE_ENV = 'test';

// ---------- arquivos de foto de teste ----------
fs.mkdirSync(path.join(UPLOADS, 'acoes'), { recursive: true });
const PizZip = require('pizzip');
const jpeg = new PizZip(fs.readFileSync(path.join(RAIZ, 'server/templates/individual.docx'))).file('word/media/image1.jpeg').asNodeBuffer();
fs.writeFileSync(path.join(UPLOADS, 'acoes', 'foto1.jpg'), jpeg);
fs.writeFileSync(path.join(UPLOADS, 'acoes', 'foto2.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABvrngfAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAC8BQPQ1QvYjAAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(path.join(UPLOADS, 'acoes', 'foto3.webp'), Buffer.from('RIFF....WEBPVP8 ', 'latin1'));

const { instalar, UNIDADES, consultasUnidade } = require('./banco-simulado');
instalar();

// ---------- app de teste ----------
const express = require('express');
const { tratarErros } = require(path.join(RAIZ, 'server/middlewares/erros.js'));
const router = require(path.join(RAIZ, 'server/routes/relatorios.js'));

const USUARIOS = {
  assistenteBRA: { id: 5, nome: 'Carla Assistente', cress: '12345', perfil: 'ASSISTENTE', unidades: [UNIDADES[0]] },
  coordenador: { id: 1, nome: 'Elinaldo Coordenador', cress: 'CRESS/SP 99999', perfil: 'COORDENADOR', unidades: UNIDADES },
};
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { req.usuario = USUARIOS[req.get('x-teste-usuario')] || USUARIOS.assistenteBRA; next(); });
app.use('/api/relatorios', router);
app.use(tratarErros);

// ---------- utilitários de teste ----------
let base;
let falhas = 0;
let total = 0;
async function teste(nome, fn) {
  total += 1;
  try { await fn(); console.log(`  ok   ${nome}`); } catch (e) { falhas += 1; console.log(`  FALHA ${nome}\n       ${e.stack.split('\n').slice(0, 4).join('\n       ')}`); }
}
const chamar = (caminho, { usuario = 'assistenteBRA', metodo = 'GET', corpo } = {}) => fetch(`${base}/api/relatorios${caminho}`, {
  method: metodo,
  headers: { 'x-teste-usuario': usuario, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
  body: corpo ? JSON.stringify(corpo) : undefined,
});
const textoDocx = (buffer) => {
  const zip = new PizZip(buffer);
  const xml = zip.file('word/document.xml').asText();
  const { DOMParser } = require('@xmldom/xmldom');
  const erros = [];
  new DOMParser({ onError: (nivel, msg) => erros.push(`${nivel}: ${msg}`) }).parseFromString(xml, 'text/xml');
  assert.deepEqual(erros, [], 'document.xml deve ser XML bem formado');
  return { zip, xml, texto: xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>') };
};
const salvar = (nome, buf) => { if (SAIDA) { fs.mkdirSync(SAIDA, { recursive: true }); fs.writeFileSync(path.join(SAIDA, nome), buf); } };

async function main() {
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  console.log('Relatórios (banco simulado)');

  await teste('opções: assistente vê só a sua unidade e não consolida', async () => {
    const o = await (await chamar('/opcoes')).json();
    assert.equal(o.unidades.length, 1);
    assert.equal(o.consolidaTodas, false);
    assert.match(o.semestre.dataInicio, /^\d{4}-0[17]-01$/);
  });

  await teste('individual: prévia traz textos preenchidos a partir dos questionários', async () => {
    const r = await chamar('/individual/10/previa');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.identificacao.responsavel, 'Maria da Silva Santos');
    assert.equal(j.identificacao.cpf, '529.982.247-25');
    assert.equal(j.identificacao.nome, 'Família Santos');
    assert.match(j.textos.diagnostico, /composta por 4 pessoas/);
    assert.match(j.textos.diagnostico, /R\$ 1\.200,00/);
    assert.match(j.textos.diagnostico, /Bolsa Família.*Cesta básica/);
    assert.match(j.textos.impactoEconomico, /aumentou de R\$ 1\.200,00 para R\$ 1\.500,00 \(\+25,0%\)/);
    assert.match(j.textos.impactoAlimentar, /não tinha acesso para diário/);
    assert.match(j.textos.feedback, /"Ótima"/);
    assert.equal(j.assinatura.nome, 'Carla Assistente');
    assert.equal(j.avisos.length, 0);
  });

  await teste('individual: assistente da unidade A não acessa família da unidade B (404)', async () => {
    assert.equal((await chamar('/individual/20/previa')).status, 404);
    assert.equal((await chamar('/individual/20', { metodo: 'POST', corpo: {} })).status, 404);
    assert.equal((await chamar('/individual/abc/previa')).status, 404);
    assert.equal((await chamar('/individual/20/previa', { usuario: 'coordenador' })).status, 200);
  });

  await teste('individual: gera .docx válido com textos editados e assinatura do usuário', async () => {
    const r = await chamar('/individual/10', {
      metodo: 'POST',
      corpo: {
        textos: { introducao: 'Primeira linha editada.\nSegunda linha & "aspas" <tag>.' },
        identificacao: { contato: '(11) 99999-0000' },
        data: '2026-10-20', local: 'São Paulo/SP',
      },
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /wordprocessingml/);
    assert.match(r.headers.get('content-disposition'), /Relatorio_Individual_Familiar_BRA_10_2026-10-20\.docx/);
    const buf = Buffer.from(await r.arrayBuffer());
    salvar('individual.docx', buf);
    const { texto, zip } = textoDocx(buf);
    assert.match(texto, /RELATÓRIO INDIVIDUAL FAMILIAR/);
    assert.match(texto, /Responsável Familiar: Maria da Silva Santos/);
    assert.match(texto, /CPF: 529\.982\.247-25/);
    assert.match(texto, /Contato: \(11\) 99999-0000/);
    assert.match(texto, /Primeira linha editada\.\nSegunda linha & "aspas" <tag>\./);
    assert.match(texto, /Situação Socioeconômica Identificada/);
    assert.match(texto, /aumentou de R\$ 1\.200,00/);          // texto padrão mantido onde não editado
    assert.match(texto, /São Paulo\/SP, 20 de outubro de 2026\./);
    assert.match(texto, /Carla Assistente\nAssistente Social\nCRESS\/SP: 12345/);
    assert.ok(!/\{|\}|undefined/.test(texto), 'sem tags soltas nem "undefined"');
    assert.ok(zip.file('word/header1.xml') && zip.file('word/media/image1.jpeg'), 'papel timbrado preservado');
  });

  await teste('individual: validação de entrada (texto não-string, data inválida)', async () => {
    const a = await chamar('/individual/10', { metodo: 'POST', corpo: { textos: { introducao: 123 } } });
    assert.equal(a.status, 400);
    assert.equal((await a.json()).erro.codigo, 'VALIDACAO');
    const b = await chamar('/individual/10', { metodo: 'POST', corpo: { data: '31/02/2026' } });
    assert.equal(b.status, 400);
  });

  await teste('semestral: prévia consolida números, relatos e fotos da unidade do assistente', async () => {
    const r = await chamar('/semestral/previa?dataInicio=2026-01-01&dataFim=2026-06-30');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.unidades.length, 1);
    assert.equal(j.totais.atendimentos, 120);
    assert.equal(j.totais.encaminhamentos, 90);
    assert.equal(j.totais.visitas, 1);
    assert.equal(j.totais.outrasAcoes, 0);
    assert.equal(j.totais.familias, 1);
    assert.equal(j.comparacao.pares, 1);
    assert.equal(j.relatos.every((x) => x.unidadeId === 1), true);
    assert.ok(j.relatos.length >= 3);
    assert.equal(j.fotos.every((f) => f.unidadeId === 1), true);
    assert.match(j.textos.atendimentos, /120 atendimentos sociais/);
    const renda = j.comparacao.indicadores.find((i) => /Renda/.test(i.rotulo));
    assert.equal(renda.inicial, 'R$ 1.200,00');
    assert.equal(renda.final, 'R$ 1.500,00');
  });

  await teste('semestral: unidade fora do escopo => 403; coordenador consolida todas', async () => {
    assert.equal((await chamar('/semestral/previa?unidadeIds=2')).status, 403);
    assert.equal((await chamar('/semestral/previa?unidadeIds=1,3')).status, 403);
    const j = await (await chamar('/semestral/previa?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' })).json();
    assert.equal(j.unidades.length, 3);
    assert.equal(j.totais.atendimentos, 205);
    assert.equal(j.comparacao.pares, 2);
    const so2 = await (await chamar('/semestral/previa?dataInicio=2026-01-01&dataFim=2026-06-30&unidadeIds=2', { usuario: 'coordenador' })).json();
    assert.equal(so2.unidades.length, 1);
    assert.equal(so2.totais.atendimentos, 80);
  });

  await teste('semestral: período inválido => 400', async () => {
    assert.equal((await chamar('/semestral/previa?dataInicio=2026-07-01&dataFim=2026-01-01')).status, 400);
    assert.equal((await chamar('/semestral/previa?dataInicio=abc')).status, 400);
    assert.equal((await chamar('/semestral/previa?dataInicio=2020-01-01&dataFim=2026-01-01')).status, 400);
  });

  await teste('semestral: gera .docx (consolidado) com tabelas, relatos e fotos incorporadas', async () => {
    const previa = await (await chamar('/semestral/previa?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' })).json();
    const r = await chamar('/semestral', {
      usuario: 'coordenador', metodo: 'POST',
      corpo: {
        dataInicio: '2026-01-01', dataFim: '2026-06-30',
        textos: { consideracoes: 'Considerações editadas pelo coordenador.' },
        relatos: [{ id: previa.relatos[0].id }, { id: previa.relatos[1].id, texto: 'Relato anonimizado e editado.' }, { id: 'inexistente.x' }],
        fotos: previa.fotos.map((f) => f.id),
        data: '2026-07-05',
      },
    });
    assert.equal(r.status, 200, await r.clone().text());
    const buf = Buffer.from(await r.arrayBuffer());
    salvar('semestral.docx', buf);
    const { texto, zip, xml } = textoDocx(buf);
    assert.match(texto, /RELATÓRIO SEMESTRAL/);
    assert.match(texto, /Período: 01\/01\/2026 a 30\/06\/2026/);
    assert.match(texto, /Total: 205 atendimentos; 130 encaminhamentos\./);
    assert.match(texto, /CRAS/);
    assert.match(texto, /Brasilândia – 1 visita\(s\)/);
    assert.match(texto, /Cidade Tiradentes – 0 visita\(s\)/);
    assert.match(texto, /Nenhuma visita institucional registrada/);
    assert.match(texto, /CCA Nossa Senhora & Cia/);
    assert.match(texto, /Palestra/);                       // 2.4 outras ações
    assert.match(texto, /Renda mensal média da família/);
    assert.match(texto, /Relato anonimizado e editado\./);
    assert.match(texto, /Considerações editadas pelo coordenador\./);
    assert.match(texto, /Elinaldo Coordenador\nCoordenador\(a\)\nCRESS\/SP 99999/);
    assert.match(texto, /ANEXOS – REGISTRO FOTOGRÁFICO/);
    assert.match(texto, /Foto 1 – Roda de conversa/);
    assert.match(texto, /Palestra <saúde>/);
    assert.match(texto, /formato não suportado/);          // webp -> só legenda
    assert.ok(!/passwd/.test(texto) || /não incorporada/.test(texto));
    assert.ok(!/\{|\}|undefined/.test(texto), 'sem tags soltas');
    const midias = Object.keys(zip.files).filter((n) => n.startsWith('word/media/foto_anexo_'));
    assert.equal(midias.length, 2, `2 imagens incorporadas (jpeg+png), achou ${midias}`);
    assert.match(zip.file('[Content_Types].xml').asText(), /Extension="png"/);
    assert.match(zip.file('word/_rels/document.xml.rels').asText(), /rIdFotoAnexo1/);
    assert.equal((xml.match(/<w:drawing>/g) || []).length, 2);
    const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'ids de desenho únicos');
  });

  await teste('semestral: assistente não consegue incluir foto/relato de outra unidade', async () => {
    const r = await chamar('/semestral', {
      metodo: 'POST',
      corpo: { dataInicio: '2026-01-01', dataFim: '2026-06-30', fotos: [11, 12, 13], relatos: [{ id: '201.principalBeneficio' }] },
    });
    assert.equal(r.status, 200);
    const { texto, zip } = textoDocx(Buffer.from(await r.arrayBuffer()));
    assert.ok(!/Palestra <saúde>/.test(texto) && !/\(TIR\)/.test(texto));
    assert.equal(Object.keys(zip.files).filter((n) => n.startsWith('word/media/foto_anexo_')).length, 1);
    const sem = await chamar('/semestral', { metodo: 'POST', corpo: { unidadeIds: [2] } });
    assert.equal(sem.status, 403);
  });

  await teste('semestral: sem fotos nem relatos não gera anexos', async () => {
    const r = await chamar('/semestral', { metodo: 'POST', corpo: { dataInicio: '2026-01-01', dataFim: '2026-06-30' } });
    assert.equal(r.status, 200);
    const { texto } = textoDocx(Buffer.from(await r.arrayBuffer()));
    assert.ok(!/ANEXOS/.test(texto) && !/Relatos das famílias/.test(texto));
  });

  await teste('foto: miniatura só da própria unidade; traversal bloqueado', async () => {
    const ok = await chamar('/foto/11');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.equal((await chamar('/foto/12')).status, 404);        // outra unidade
    assert.equal((await chamar('/foto/12', { usuario: 'coordenador' })).status, 200);
    assert.equal((await chamar('/foto/999')).status, 404);
  });

  await teste('CSV: formato BS_ATENDIMENTO e BASE_UNICA_ACOES (; BOM UTF-8, sem injeção de fórmula)', async () => {
    const a = await chamar('/exportar/atendimentos.csv?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' });
    assert.equal(a.status, 200);
    assert.match(a.headers.get('content-type'), /text\/csv/);
    const buf = Buffer.from(await a.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const linhas = buf.toString('utf8').replace('﻿', '').trim().split('\r\n');
    assert.equal(linhas[0], 'ANO;MÊS;DATA;UNIDADE;QTD ATD_ENCAMINHAMENTO CRAS E DESCOMPLICA;QTD AÇOES;QTDE PARTICIPANTES;QTD FAMILIA ACOMPANHADA;TOTAL ATENDIMENTO;% ENCAMINHAMENTOS');
    assert.ok(linhas.some((l) => l.startsWith('2026;2;28/02/2026;BRA;70;3;100;1;170;0,411765')), linhas.join('\n'));
    const b = await chamar('/exportar/acoes.csv?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' });
    const txt = Buffer.from(await b.arrayBuffer()).toString('utf8');
    assert.match(txt, /ANO;vv;DATA;UNIDADE;LOCAL;ENDEREÇO;TEMA 1;TEMA 2;TEMA 3;TEMA 4;STATUS;QTD DE PARTICIPANTES;TIPO/);
    assert.match(txt, /'=HYPERLINK/);                              // fórmula neutralizada
    assert.match(txt, /"Rua; A"/);                                 // ; escapado
    assert.match(txt, /Cancelada/);
    const so = await (await chamar('/exportar/acoes.csv?dataInicio=2026-01-01&dataFim=2026-06-30')).text();
    assert.ok(!/TIR/.test(so), 'assistente da BRA não vê ações da TIR');
    assert.equal((await chamar('/exportar/acoes.csv?unidadeIds=2')).status, 403);
  });

  await teste('toda consulta por unidade carregou o filtro de unidade', async () => {
    assert.deepEqual(consultasUnidade, []);
  });

  servidor.close();
  console.log(`\n${total - falhas}/${total} testes passaram`);
  fs.rmSync(UPLOADS, { recursive: true, force: true });
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
