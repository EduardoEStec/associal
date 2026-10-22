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

const { instalar, UNIDADES, consultasUnidade, respostasExtra, donosExtra } = require('./banco-simulado');
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
    assert.match(j.textos.evolucao, /foram registrados 3 contatos/);
    assert.match(j.textos.evolucao, /índice de progresso da família .* passou de [\d,]+ no inicial para [\d,]+ no final/);
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
    // F5: seção de evolução com a tabela das dimensões do índice de progresso
    assert.match(texto, /Evolução durante o acompanhamento/);
    for (const dim of ['Alimentação', 'Renda e trabalho', 'Economia e poupança', 'Autonomia', 'Índice geral']) assert.ok(texto.includes(dim), dim);
    assert.match(texto, /Melhorou/);
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


  // ---------- F6: progresso das famílias e satisfação no semestral, metas no individual ----------
  await teste('F6 semestral: prévia traz progresso, satisfação, textos padrão e comentários (só coordenação)', async () => {
    const c = await (await chamar('/semestral/previa?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' })).json();
    assert.equal(c.progresso.geral.n, 2);
    assert.equal(c.progresso.geral.melhoraram, 1);
    assert.equal(c.progresso.geral.iguais, 1);
    assert.equal(c.progresso.dimensoes.length, 4);
    assert.equal(c.progresso.metas.total, 3);
    assert.equal(c.progresso.acompanhamentos.emAndamento, 2);
    assert.equal(c.satisfacao.geral.respostas, 2);
    assert.equal(c.satisfacao.geral.recusas, 1);
    assert.equal(c.satisfacao.perguntas.length, 6);
    assert.equal(c.satisfacao.comentarios, undefined, 'os comentários vão na lista própria');
    assert.equal(c.comentariosSatisfacao.length, 2);
    assert.match(c.textos.progresso, /2 famílias tiveram duas ou mais medições do índice de progresso/);
    assert.match(c.textos.progresso, /1 \(50%\) melhoraram, 1 \(50%\) ficaram iguais e 0 \(0%\) pioraram/);
    assert.match(c.textos.progresso, /3 metas: 1 atingida\(s\), 1 não atingida\(s\), 1 em andamento/);
    assert.match(c.textos.satisfacao, /2 pesquisas de satisfação foram respondidas e 1 família preferiu não responder/);
    assert.match(c.textos.satisfacao, /A afirmação com menor concordância foi "/);
    // a assistente da BRA: só a sua unidade e sem os comentários das famílias
    const a = await (await chamar('/semestral/previa?dataInicio=2026-01-01&dataFim=2026-06-30')).json();
    assert.equal(a.progresso.geral.n, 1);
    assert.deepEqual(a.progresso.unidades.map((u) => u.sigla), ['BRA']);
    assert.equal(a.satisfacao.geral.respostas, 1);
    assert.deepEqual(a.comentariosSatisfacao, []);
  });

  await teste('F6 semestral: .docx traz as seções 4 e 5 com tabelas e os comentários escolhidos; considerações viram a seção 6', async () => {
    const r = await chamar('/semestral', {
      usuario: 'coordenador', metodo: 'POST',
      corpo: {
        dataInicio: '2026-01-01', dataFim: '2026-06-30', fotos: [], relatos: [],
        comentariosSatisfacao: [{ id: '1.T1' }, { id: '2.T2', texto: 'Comentário editado e sem nome.' }, { id: '99.T1', texto: 'não existe' }],
        textos: { satisfacao: 'Texto da satisfação editado.' },
      },
    });
    assert.equal(r.status, 200, await r.clone().text());
    const { texto } = textoDocx(Buffer.from(await r.arrayBuffer()));
    assert.match(texto, /4\. Acompanhamento e evolução das famílias/);
    assert.match(texto, /2 famílias tiveram duas ou mais medições/);
    assert.match(texto, /Famílias que melhoraram, ficaram iguais ou pioraram/);
    assert.match(texto, /Alimentação[\s\S]*Índice geral/);
    assert.match(texto, /Brasilândia[\s\S]*30[,.]?\d* → 70|40 → 70/);
    assert.match(texto, /Metas das famílias/);
    assert.match(texto, /5\. Satisfação das famílias/);
    assert.match(texto, /Texto da satisfação editado\./);
    assert.match(texto, /Concordância por afirmação/);
    assert.match(texto, /Resolvi meus problemas\./);
    assert.match(texto, /Trechos dos comentários das famílias/);
    assert.match(texto, /“Preço bom & atendimento <acolhedor>\.” \(BRA\)/);
    assert.match(texto, /“Comentário editado e sem nome\.” \(TIR\)/);
    assert.ok(!/não existe/.test(texto), 'comentário que não está no escopo é ignorado');
    assert.match(texto, /6\. Considerações finais/);
    assert.ok(!/\{|\}|undefined|NaN/.test(texto), 'sem tags soltas');
    // assistente: mesmo pedindo, não recebe comentário das famílias
    const b = await chamar('/semestral', {
      metodo: 'POST', corpo: { dataInicio: '2026-01-01', dataFim: '2026-06-30', fotos: [], relatos: [], comentariosSatisfacao: [{ id: '1.T1' }] },
    });
    assert.equal(b.status, 200);
    const outro = textoDocx(Buffer.from(await b.arrayBuffer())).texto;
    assert.ok(!/Preço bom/.test(outro) && !/Trechos dos comentários/.test(outro));
    assert.match(outro, /5\. Satisfação das famílias/);
  });

  await teste('F6 semestral: abaixo do n mínimo os textos não trazem percentuais nem nota geral', async () => {
    const fam = require(path.join(RAIZ, 'server/services/relatorios-progresso.js'));
    const sel = { n: 2, melhoraram: 1, iguais: 1, pioraram: 0, suficiente: false, pctMelhoraram: null };
    const progresso = { nMinimo: 5, tolerancia: 5, geral: sel, dimensoes: [], acompanhamentos: { concluidos: 0, desligados: 0, emAndamento: 2, tempoMedioDias: null }, metas: { total: 0 } };
    const t = fam.textoProgresso(progresso);
    assert.match(t, /inferior ao mínimo de 5 famílias para divulgar percentuais/);
    assert.ok(!/%/.test(t.split('\n')[0]));
    const geral = { respostas: 3, recusas: 0, suficiente: false, nps: null, taxaCobertura: null };
    const satisfacao = { nMinimo: 5, perguntas: [], geral };
    const s = fam.textoSatisfacao(satisfacao);
    assert.match(s, /inferior ao mínimo de 5 para divulgar nota geral e percentuais/);
    assert.ok(!/NPS/.test(s));
    assert.equal(fam.textoSatisfacao({ nMinimo: 5, perguntas: [], geral: { respostas: 0, recusas: 0 } }), 'No período não foram aplicadas pesquisas de satisfação às famílias acompanhadas.');
    const dados = fam.dadosTemplate({ progresso: { ...progresso, unidades: [], dimensoes: [], metas: { total: 0, porDimensao: [] } }, satisfacao: { geral, perguntas: [], unidades: [] }, comentarios: [] });
    assert.equal(dados.temTabelaSatisfacao, false);
    assert.equal(dados.progressoDimensoes.at(-1).percentual, 'n < mín.');
  });

  await teste('F6 CSV: progresso e satisfação (coordenação), sem dados pessoais; assistente 403', async () => {
    const p = await chamar('/exportar/progresso.csv?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' });
    assert.equal(p.status, 200);
    assert.match(p.headers.get('content-type'), /text\/csv/);
    const bufP = Buffer.from(await p.arrayBuffer());
    assert.deepEqual([...bufP.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const linhasP = bufP.toString('utf8').replace('﻿', '').trim().split('\r\n');
    assert.equal(linhasP[0], 'Recorte;Dimensão;Famílias comparadas;Melhoraram;Ficaram iguais;Pioraram;% que melhoraram;Situação');
    assert.ok(linhasP.includes('Todas as unidades;Índice geral;2;1;1;0;50;Bom'), linhasP.join('\n'));
    assert.ok(linhasP.some((l) => l.startsWith('BRA;Alimentação;1;1;0;0;100;')), linhasP.join('\n'));
    assert.ok(linhasP.some((l) => l.startsWith('TIR;Índice geral;1;0;1;0;0;')));
    const s = await chamar('/exportar/satisfacao.csv?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' });
    assert.equal(s.status, 200);
    const linhasS = Buffer.from(await s.arrayBuffer()).toString('utf8').replace('﻿', '').trim().split('\r\n');
    assert.equal(linhasS[0], 'Unidade;Respostas;Recusas;Nota geral (NPS);Índice de satisfação (%);Concordância (%);Taxa de recusa (%);Cobertura (%);Situação');
    assert.ok(linhasS.some((l) => l.startsWith('Todas as unidades;2;1;')), linhasS.join('\n'));
    assert.ok(!linhasS.join('').includes('Preço bom'), 'sem comentários no CSV');
    assert.equal((await chamar('/exportar/progresso.csv')).status, 403);
    assert.equal((await chamar('/exportar/satisfacao.csv')).status, 403);
    assert.equal((await chamar('/exportar/progresso.csv?unidadeIds=2', { usuario: 'coordenador' })).status, 200);
  });

  await teste('F6 individual: a seção Evolução traz as metas combinadas com a família (texto e tabela)', async () => {
    const r = await chamar('/individual/10', { metodo: 'POST', corpo: {} });
    assert.equal(r.status, 200, await r.clone().text());
    const { texto } = textoDocx(Buffer.from(await r.arrayBuffer()));
    assert.match(texto, /Evolução durante o acompanhamento/);
    assert.match(texto, /Foram combinadas com a família 2 metas: 1 atingida\(s\), 0 não atingida\(s\) e 1 em andamento\./);
    assert.match(texto, /Dimensão[\s\S]*Meta[\s\S]*Prazo[\s\S]*Situação[\s\S]*Encerrada em/);
    assert.match(texto, /Comprar frutas 3x por semana/);
    assert.match(texto, /Atingida/);
    assert.match(texto, /Em andamento/);
    assert.match(texto, /Guardar R\$ 20 por semana/);
    assert.ok(!/\{|\}|undefined|NaN/.test(texto), 'sem tags soltas');
  });

  await teste('P2: perguntas adicionais entram no relatório individual e no CSV de perguntas extras (só coordenação, sem identificar)', async () => {
    const estado = require(path.join(RAIZ, 'server/services/catalogo-estado.js'));
    const def = (id, codigo, tipo, texto, opcoes = []) => ({ id, formulario: 'QUESTIONARIO', codigo, secao: 4, tipo, texto, textoFinal: null, ajuda: null, obrigatoria: false, ordem: id, ativa: true, opcoes });
    estado.definir({ extras: { QUESTIONARIO: [
      def(7, 'E0001', 'TEXTO', 'O que mudou na rotina?'),
      def(8, 'E0002', 'ESCOLHA', 'Onde compra frutas?', [{ id: 80, codigo: 'OP01', texto: 'Feira', textoFinal: null, ordem: 10, ativa: true }]),
    ] } });
    respostasExtra.push(
      { donoId: 101, perguntaId: 7, opcaoId: null, valorTexto: 'Almoço juntos todo dia', valorNum: null },
      { donoId: 102, perguntaId: 8, opcaoId: 80, valorTexto: null, valorNum: null });
    donosExtra.QUESTIONARIO.push(
      { donoId: 101, data: new Date('2026-02-10T00:00:00Z'), unidadeId: 1, momento: 'INICIAL' },
      { donoId: 102, data: new Date('2026-05-12T00:00:00Z'), unidadeId: 1, momento: 'FINAL' });
    try {
      const j = await (await chamar('/individual/10/previa')).json();
      assert.match(j.textos.diagnostico, /Perguntas adicionais do questionário inicial:\nO que mudou na rotina\? Almoço juntos todo dia/);
      assert.match(j.textos.feedback, /Perguntas adicionais do questionário final:\nOnde compra frutas\? Feira/);
      const csv = await chamar('/exportar/perguntas-extras.csv?dataInicio=2026-01-01&dataFim=2026-06-30', { usuario: 'coordenador' });
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get('content-type'), /text\/csv/);
      const t = await csv.text();
      assert.match(t, /FORMULÁRIO;DATA;UNIDADE;Nº DO REGISTRO;MOMENTO;CÓDIGO DA PERGUNTA;PERGUNTA;RESPOSTA/);
      assert.match(t, /Questionário familiar;10\/02\/2026;BRA;101;Inicial;E0001;O que mudou na rotina\?;Almoço juntos todo dia/);
      assert.match(t, /Questionário familiar;12\/05\/2026;BRA;102;Final;E0002;Onde compra frutas\?;Feira/);
      assert.doesNotMatch(t, /Maria da Silva|529\.982/, 'sem nome nem CPF');
      assert.equal((await chamar('/exportar/perguntas-extras.csv')).status, 403, 'assistente não exporta');
    } finally {
      estado.restaurarPadrao();
      respostasExtra.length = 0;
      donosExtra.QUESTIONARIO.length = 0;
    }
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
