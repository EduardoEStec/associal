'use strict';
// Teste do módulo Painel com banco simulado (sem SQL Server).  node tests/painel/painel.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const raiz = path.resolve(__dirname, '..', '..');
const chamadas = [];
const dbFalso = {
  tipos: { Date: function DateTipo() {} },
  consultar: async (texto, params = {}) => {
    chamadas.push({ texto, params });
    const t = texto.replace(/\s+/g, ' ');
    if (t.includes("tipo IN ('REAVALIACAO', 'FINAL')")) return []; // F6: reavaliações pendentes
    if (t.includes('FROM ASSOCIAL_unidade u')) return [{ unidadeId: 1, sigla: 'BRA', nome: 'Brasilândia' }, { unidadeId: 2, sigla: 'TIR', nome: 'Tiradentes' }];
    if (t.includes('FROM ASSOCIAL_atendimento a WHERE') && t.includes('COUNT(*) AS total')) return [{ total: 10 }];
    if (t.includes('atendimentos_com_encaminhamento') && t.includes('GROUP BY a.unidade_id')) return [{ unidadeId: 1, atendimentos: 8, atendimentosComEncaminhamento: 4 }, { unidadeId: 2, atendimentos: 2, atendimentosComEncaminhamento: 0 }];
    if (t.includes('FROM ASSOCIAL_acao_visita v') && t.includes('GROUP BY v.unidade_id')) return [{ unidadeId: 1, acoes: 2, participantes: 12 }];
    if (t.includes('familias_acompanhadas') && t.includes('GROUP BY ac.unidade_id')) return [{ unidadeId: 1, familiasAcompanhadas: 3 }];
    if (t.includes('FROM ASSOCIAL_configuracao')) return [{ valor: '15' }];
    if (t.includes('FROM ASSOCIAL_acompanhamento ac JOIN ASSOCIAL_unidade')) return [
      { acompanhamentoId: 1, unidadeSigla: 'BRA', responsavelNome: 'Maria', dataLimite: '2026-01-01', diasRestantes: -5 },
      { acompanhamentoId: 2, unidadeSigla: 'BRA', responsavelNome: 'Ana', dataLimite: '2026-02-01', diasRestantes: 3 }];
    if (t.includes('FROM ASSOCIAL_acao_visita v JOIN ASSOCIAL_unidade')) return [{ acaoId: 9, unidadeSigla: 'TIR', dataAcao: '2026-01-01', instituicaoLocal: 'X', diasAtraso: 4 }];
    if (t.includes('YEAR(a.data_atendimento)')) return [{ ano: 2026, mes: 3, atendimentos: 5, atendimentosComEncaminhamento: 1 }];
    if (t.includes('YEAR(v.data_acao)')) return [{ ano: 2026, mes: 3, acoes: 1, participantes: 7 }];
    if (t.includes('FROM (VALUES')) return [{ ano: 2026, mes: 3, familiasAcompanhadas: 2 }];
    if (t.includes('FROM ASSOCIAL_atendimento a')) return [{ id: 1, nome: 'Item', quantidade: 3 }];
    return [];
  },
};
require.cache[require.resolve(path.join(raiz, 'server/db.js'))] = { id: 'db', filename: 'db', loaded: true, exports: dbFalso };

const router = require(path.join(raiz, 'server/routes/painel.js'));
const { ErroApp } = require(path.join(raiz, 'server/lib/erros.js'));

function servidor(usuario) {
  const app = express();
  app.use((req, res, next) => { req.usuario = usuario; next(); });
  app.use('/api/painel', router);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err instanceof ErroApp ? err.status : 500).json({ erro: { codigo: err.codigo || 'ERRO', detalhes: err.detalhes } });
  });
  return new Promise((ok) => { const s = http.createServer(app).listen(0, () => ok(s)); });
}
const get = async (s, url) => { const r = await fetch(`http://127.0.0.1:${s.address().port}${url}`); return { status: r.status, corpo: await r.json() }; };

(async () => {
  const coord = await servidor({ perfil: 'COORDENADOR', unidades: [{ id: 1, sigla: 'BRA' }, { id: 2, sigla: 'TIR' }] });
  const assist = await servidor({ perfil: 'ASSISTENTE', unidades: [{ id: 1, sigla: 'BRA' }] });
  const semUn = await servidor({ perfil: 'ASSISTENTE', unidades: [] });

  // mensal: fórmulas do Excel
  let r = await get(coord, '/api/painel/mensal?ano=2026&mes=3');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.periodo, { inicio: '2026-03-01', fim: '2026-03-31' });
  const bra = r.corpo.unidades.find((u) => u.sigla === 'BRA');
  assert.equal(bra.totalAtendimento, 8 + 12);
  assert.equal(bra.pctEncaminhamentos, 8 / 20);
  assert.equal(r.corpo.total.atendimentos, 10);
  assert.equal(r.corpo.total.participantes, 12);
  assert.equal(r.corpo.total.familiasAcompanhadas, 3);
  assert.equal(r.corpo.total.totalAtendimento, 22);
  assert.equal(r.corpo.unidades.find((u) => u.sigla === 'TIR').pctEncaminhamentos, 1);

  // validações
  assert.equal((await get(coord, '/api/painel/mensal?ano=2026&mes=13')).status, 400);
  assert.equal((await get(coord, '/api/painel/mensal?inicio=2026-05-01&fim=2026-04-01')).status, 400);
  assert.equal((await get(coord, '/api/painel/mensal?inicio=abc&fim=2026-04-01')).status, 400);
  assert.equal((await get(coord, '/api/painel/mensal?inicio=2026-01-01&fim=2026-06-30&unidadeId=99')).status, 403);
  assert.equal((await get(coord, '/api/painel/mensal?inicio=2026-01-01&fim=2026-06-30&unidadeId=x')).status, 400);
  assert.equal((await get(coord, '/api/painel/mensal?inicio=2026-01-01&fim=2026-06-30&unidadeId=2')).status, 200);

  // perfis: assistente só no resumo
  assert.equal((await get(assist, '/api/painel/mensal')).status, 403);
  assert.equal((await get(assist, '/api/painel/alertas')).status, 403);
  assert.equal((await get(assist, '/api/painel/perfil')).status, 403);
  r = await get(assist, '/api/painel/resumo-inicio');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pendentes.vencidos, 1);
  assert.equal(r.corpo.pendentes.aVencer, 1);
  assert.equal(r.corpo.escopo, 'UNIDADES_DO_USUARIO');
  assert.equal((await get(semUn, '/api/painel/resumo-inicio')).status, 200);

  // evolução / perfil / alertas
  r = await get(coord, '/api/painel/evolucao?inicio=2026-01-01&fim=2026-04-30');
  assert.equal(r.corpo.meses.length, 4);
  assert.equal(r.corpo.meses[2].atendimentos, 5);
  assert.equal(r.corpo.meses[2].totalAtendimento, 12);
  assert.equal(r.corpo.meses[0].atendimentos, 0);
  assert.equal((await get(coord, '/api/painel/evolucao')).status, 200);
  r = await get(coord, '/api/painel/perfil?inicio=2026-01-01&fim=2026-03-31');
  for (const k of ['faixaEtaria', 'genero', 'escolaridade', 'raca', 'nivelVulnerabilidade', 'vulnerabilidades', 'demandas', 'encaminhamentos']) assert.ok(Array.isArray(r.corpo[k]), k);
  assert.equal(r.corpo.totalAtendimentos, 10);
  r = await get(coord, '/api/painel/alertas');
  assert.equal(r.corpo.questionariosFinais.length, 2);
  assert.equal(r.corpo.acoesDesatualizadas.length, 1);

  // LGPD: TODA consulta de dados filtra por unidade (ou é a leitura de configuração)
  const semFiltro = chamadas.filter((c) => !/FROM ASSOCIAL_configuracao/.test(c.texto) && !/IN \(@un0/.test(c.texto) && !/1 = 0/.test(c.texto));
  assert.deepEqual(semFiltro.map((c) => c.texto.slice(0, 80)), []);
  assert.ok(chamadas.some((c) => c.params.un0 === 1 && c.params.un1 === undefined));
  assert.ok(chamadas.some((c) => c.texto.includes('1 = 0')));

  [coord, assist, semUn].forEach((s) => s.close());
  console.log('painel: todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
