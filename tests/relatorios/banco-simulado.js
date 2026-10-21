'use strict';

// Banco simulado (substitui server/db.js) usado pelos testes e pelo servidor de teste visual.
// Devolve dados fixos e respeita o filtro de unidade que o código passa nos parâmetros (un*/sel*).

const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
// ---------- banco simulado ----------
const UNIDADES = [
  { id: 1, sigla: 'BRA', nome: 'Brasilândia' },
  { id: 2, sigla: 'TIR', nome: 'Cidade Tiradentes' },
  { id: 3, sigla: 'JAR', nome: 'Jaraguá' },
];
const d = (s) => new Date(`${s}T00:00:00Z`);
const consultasUnidade = []; // registra se TODA consulta por unidade carregou o filtro

const INICIAL = {
  id: 101, acompanhamentoId: 10, tipo: 'INICIAL', dataAplicacao: d('2026-02-10'), concluido: true, unidadeId: 1,
  qtdMembrosFamilia: 4, rendaMensalMedia: 1200, qtdMembrosComRenda: 1, recebeAuxilio: true, auxilioOutro: 'Cesta básica',
  acessoAlimentosInNatura: 'NAO_TINHA', frequenciaFrutasVerduras: 'UMA_DUAS', qualidadeAlimentacao: null, saudeNutricional: null,
  conseguePoupar: false, economiaMensalFaixa: null, economiaMensalValor: null, destinoEconomiaOutro: null,
  capacidadePoupanca: 'NAO_CONSEGUE', gestaoFinanceira: null, empoderadaDecisoes: null, contribuicaoAutonomia: null,
  melhoriaPlanejamento: null, impactoComunidade: null, oQueMelhorar: null, avaliacaoArmazem: null, principalBeneficio: null, recomendaria: null,
};
const FINAL = {
  ...INICIAL, id: 102, tipo: 'FINAL', dataAplicacao: d('2026-05-12'), rendaMensalMedia: 1500, acessoAlimentosInNatura: 'DIARIO',
  frequenciaFrutasVerduras: 'CINCO_OU_MAIS', qualidadeAlimentacao: 'MELHOROU_MUITO', saudeNutricional: 'GRANDE_MELHORIA',
  conseguePoupar: true, economiaMensalFaixa: 'DE_101_200', economiaMensalValor: 150, capacidadePoupanca: 'AS_VEZES',
  gestaoFinanceira: 'MELHOROU', empoderadaDecisoes: true, contribuicaoAutonomia: 'Consigo comprar mais com o mesmo dinheiro & guardar "um pouco".',
  melhoriaPlanejamento: true, impactoComunidade: 'Vizinhos passaram a frequentar o armazém.', oQueMelhorar: 'Mais variedade de verduras.',
  avaliacaoArmazem: 'OTIMA', principalBeneficio: 'Preço baixo e produtos frescos', recomendaria: true,
};
// F6: instantâneo do índice (acompanhamento_indice) das duas famílias — a 10 (BRA) melhora, a 20 (TIR) fica igual
const linhaIndice = (acompanhamentoId, unidadeId, questionarioId, tipo, dataRef, g, a, r, e, u) => [['GERAL', g], ['ALIMENTACAO', a], ['RENDA', r], ['ECONOMIA', e], ['AUTONOMIA', u]]
  .map(([dimensao, nivel]) => ({ acompanhamentoId, unidadeId, questionarioId, tipo, dataRef: d(dataRef), dimensao, nivel }));
const INDICES = [
  ...linhaIndice(10, 1, 101, 'INICIAL', '2026-02-10', 40, 30, 40, 40, 50), ...linhaIndice(10, 1, 102, 'FINAL', '2026-05-12', 70, 80, 60, 70, 70),
  ...linhaIndice(20, 2, 201, 'INICIAL', '2026-02-10', 50, 50, 50, 50, 50), ...linhaIndice(20, 2, 202, 'FINAL', '2026-05-12', 52, 52, 50, 50, 56),
];
const METAS = [
  { acompanhamentoId: 10, unidadeId: 1, dimensao: 'ALIMENTACAO', descricao: 'Comprar frutas 3x por semana', prazo: d('2026-06-01'), status: 'ATINGIDA', concluidaEm: d('2026-05-10'), criadoEm: d('2026-02-12') },
  { acompanhamentoId: 10, unidadeId: 1, dimensao: 'ECONOMIA', descricao: 'Guardar R$ 20 por semana', prazo: null, status: 'EM_ANDAMENTO', concluidaEm: null, criadoEm: d('2026-02-12') },
  { acompanhamentoId: 20, unidadeId: 2, dimensao: 'RENDA', descricao: 'Retomar o bico', prazo: null, status: 'NAO_ATINGIDA', concluidaEm: d('2026-05-20'), criadoEm: d('2026-02-15') },
];
const PESQUISAS = [
  { id: 1, acompanhamentoId: 10, unidadeId: 1, situacao: 'CONCLUIDA', momento: 'FINAL', dataAplicacao: d('2026-05-13'), comentarioOculto: false },
  { id: 2, acompanhamentoId: 20, unidadeId: 2, situacao: 'CONCLUIDA', momento: 'FINAL', dataAplicacao: d('2026-05-14'), comentarioOculto: false },
  { id: 3, acompanhamentoId: 20, unidadeId: 2, situacao: 'RECUSADA', momento: 'AVULSA', dataAplicacao: d('2026-04-01'), comentarioOculto: false },
];
const itemPesq = (respostaId, codigo, tipo, valorNum, valorTexto = null, pergunta = '') => ({ respostaId, codigo, tipo, valorNum, valorTexto, pergunta, prefereNaoResponder: false });
const AFIRMACOES = ['Fui tratada(o) com respeito.', 'Os produtos têm qualidade.', 'Os preços cabem no orçamento.', 'O atendimento foi claro.', 'Recomendaria a um vizinho.', 'Resolvi meus problemas.'];
const ITENS_PESQUISA = [
  ...[[1, 10, 5], [2, 6, 3]].flatMap(([id, nps, lk]) => [itemPesq(id, 'NPS', 'NPS', nps), ...AFIRMACOES.map((t, i) => itemPesq(id, `L${i + 1}`, 'LIKERT', lk, null, t))]),
  itemPesq(1, 'T1', 'TEXTO', null, 'Preço bom & atendimento <acolhedor>.'), itemPesq(2, 'T2', 'TEXTO', null, 'Mais variedade de frutas.'),
];

// outra família (unidade 2) só para o filtro de unidade
const INICIAL_2 = { ...INICIAL, id: 201, acompanhamentoId: 20, unidadeId: 2, rendaMensalMedia: 900 };
const FINAL_2 = { ...FINAL, id: 202, acompanhamentoId: 20, unidadeId: 2, rendaMensalMedia: 1000, principalBeneficio: 'Economia' };

const ACOMPANHAMENTOS = [
  { id: 10, familiaId: 1, unidadeId: 1, dataInicio: d('2026-02-01'), status: 'EM_ANDAMENTO', unidadeSigla: 'BRA', unidadeNome: 'Brasilândia', dataEncerramento: null },
  { id: 20, familiaId: 2, unidadeId: 2, dataInicio: d('2026-02-01'), status: 'EM_ANDAMENTO', unidadeSigla: 'TIR', unidadeNome: 'Cidade Tiradentes', dataEncerramento: null },
];

const permitidasDe = (p) => Object.entries(p || {}).filter(([k]) => /^un\d+$/.test(k)).map(([, v]) => v);
const selecionadasDe = (p) => Object.entries(p || {}).filter(([k]) => /^sel\d+$/.test(k)).map(([, v]) => v);
const visiveis = (linhas, p) => {
  const perm = permitidasDe(p);
  const sel = selecionadasDe(p);
  return linhas.filter((l) => perm.includes(l.unidadeId) && (sel.length === 0 || sel.includes(l.unidadeId)));
};

function responder(sql, p = {}) {
  const s = sql.replace(/\s+/g, ' ');
  const exigeUnidade = /unidade_id IN \(@un0/.test(s);
  if (/\bFROM (atendimento|acao_visita|acompanhamento|questionario|familia)\b/.test(s) && !exigeUnidade && !/FROM familia f JOIN pessoa|FROM familia_membro|FROM questionario WHERE acompanhamento_id|FROM questionario_(beneficio|destino)|INSERT INTO auditoria/.test(s)) {
    consultasUnidade.push(`SEM FILTRO DE UNIDADE: ${s.slice(0, 80)}`);
  }

  if (/INSERT INTO auditoria/.test(s)) return [];
  if (/FROM unidade WHERE id IN/.test(s)) {
    const ids = Object.values(p);
    return UNIDADES.filter((u) => ids.includes(u.id));
  }
  if (/FROM acompanhamento ac JOIN unidade un ON un.id = ac.unidade_id WHERE ac.id = @id/.test(s)) {
    return ACOMPANHAMENTOS.filter((a) => a.id === p.id && permitidasDe(p).includes(a.unidadeId));
  }
  if (/FROM familia f JOIN pessoa p ON p.id = f.responsavel_pessoa_id WHERE f.id/.test(s)) {
    return [{ nome: 'Maria da Silva Santos', cpf: '52998224725', nis: '12345678901', endereco: 'Rua das Flores, 100', cep: '02345000', bairro: 'Brasilândia', trabalhoAtual: 'Diarista' }];
  }
  if (/FROM familia_membro/.test(s)) {
    return [
      { id: 1, nome: 'João', dataNascimento: d('2010-04-01'), idade: null, parentesco: 'Filho', trabalha: false },
      { id: 2, nome: 'Ana', dataNascimento: null, idade: 40, parentesco: 'Cônjuge', trabalha: true },
    ];
  }
  if (/FROM questionario WHERE acompanhamento_id = @id/.test(s)) return p.id === 10 ? [INICIAL, FINAL] : [];
  // F5 (índice de progresso na seção "Evolução" do individual)
  if (/FROM acompanhamento ac WHERE ac.id = @id AND/.test(s)) {
    return ACOMPANHAMENTOS.filter((a) => a.id === p.id && permitidasDe(p).includes(a.unidadeId)).map((a) => ({ ...a, usuarioId: 1, dataPrevistaFinal: null, observacoes: null }));
  }
  // F6 (painel/relatório semestral): todas as consultas por unidade passam pelo filtro un*/sel*
  if (/FROM configuracao WHERE chave IN \('pesquisa_n_minimo'/.test(s)) return [{ chave: 'pesquisa_n_minimo', valor: '1' }];
  if (/SELECT ac\.id, ac\.unidade_id, ac\.status, ac\.data_inicio/.test(s)) return visiveis(ACOMPANHAMENTOS, p);
  if (/FROM acompanhamento_indice ai JOIN acompanhamento ac/.test(s)) return visiveis(INDICES, p);
  if (/FROM acompanhamento_meta m JOIN acompanhamento ac/.test(s)) return visiveis(METAS, p);
  if (/FROM acompanhamento_registro r JOIN acompanhamento ac/.test(s)) return [{ total: 5, familias: 2 }];
  if (/FROM pesquisa_resposta_item i/.test(s)) {
    const ids = new Set(visiveis(PESQUISAS, p).map((x) => x.id));
    return ITENS_PESQUISA.filter((i) => ids.has(i.respostaId));
  }
  if (/FROM pesquisa_resposta r JOIN acompanhamento ac/.test(s)) return visiveis(PESQUISAS, p);
  if (/FROM acompanhamento_meta WHERE acompanhamento_id = @id/.test(s)) return METAS.filter((m) => m.acompanhamentoId === p.id);
  if (/FROM configuracao WHERE chave IN \('indice_tolerancia_pontos'/.test(s)) return [];
  if (/FROM questionario WHERE acompanhamento_id = @ac/.test(s)) return p.ac === 10 ? [INICIAL, FINAL] : [];
  if (/FROM acompanhamento_indice/.test(s)) return [];
  if (/FROM acompanhamento_registro/.test(s) && /COUNT\(\*\) AS total/.test(s)) return [{ total: 3, primeiro: d('2026-02-20'), ultimo: d('2026-04-20') }];
  if (/FROM acompanhamento_registro/.test(s)) return [{ dataRegistro: d('2026-02-20'), situacao: 'IGUAL' }, { dataRegistro: d('2026-04-20'), situacao: 'MELHORANDO' }];
  if (/FROM questionario_beneficio/.test(s)) return [{ nome: 'Bolsa Família' }, { nome: 'Tarifa Social de Energia' }];
  if (/FROM questionario_destino_economia/.test(s)) return [{ nome: 'Alimentação' }, { nome: 'Educação' }];
  if (/FROM acompanhamento ac WHERE .*ac\.data_inicio <= @fim/.test(s) && /SELECT ac\.unidade_id, ac\.data_inicio/.test(s)) {
    return visiveis(ACOMPANHAMENTOS, p);
  }
  if (/SELECT ac\.unidade_id, COUNT\(\*\) AS familias/.test(s)) {
    return UNIDADES.map((u) => ({ unidadeId: u.id, familias: visiveis(ACOMPANHAMENTOS, p).filter((a) => a.unidadeId === u.id).length })).filter((x) => x.familias);
  }
  if (/FROM questionario q JOIN acompanhamento ac/.test(s)) return visiveis([INICIAL, FINAL, INICIAL_2, FINAL_2], p);
  if (/SELECT a\.unidade_id, COUNT\(\*\) AS atendimentos FROM atendimento/.test(s)) {
    return visiveis([{ unidadeId: 1, atendimentos: 120 }, { unidadeId: 2, atendimentos: 80 }, { unidadeId: 3, atendimentos: 5 }], p);
  }
  if (/AS atendimentos_com_encaminhamento/.test(s)) {
    return visiveis([{ unidadeId: 1, encaminhamentos: 90, atendimentosComEncaminhamento: 70 }, { unidadeId: 2, encaminhamentos: 40, atendimentosComEncaminhamento: 30 }], p);
  }
  if (/FROM atendimento a JOIN atendimento_encaminhamento ae ON ae.atendimento_id = a.id JOIN encaminhamento e|JOIN encaminhamento e ON e.id/.test(s)) {
    return permitidasDe(p).includes(1) ? [{ nome: 'CRAS', quantidade: 70 }, { nome: 'Unidade Descomplica', quantidade: 25 }, { nome: 'UBS', quantidade: 10 }] : [];
  }
  if (/FROM acao_visita_tema/.test(s)) {
    return [{ acaoVisitaId: 1, nome: 'Assistência Social' }, { acaoVisitaId: 1, nome: 'Saúde' }, { acaoVisitaId: 2, nome: 'Idoso' }];
  }
  if (/FROM acao_visita av JOIN tipo_acao ta/.test(s) && /av\.status = 'REALIZADA'/.test(s)) {
    return visiveis([
      { id: 1, unidadeId: 1, dataAcao: d('2026-03-12'), instituicaoLocal: 'CCA Nossa Senhora & Cia', endereco: 'Rua A', qtdParticipantes: 40, tipo: 'Visita institucional' },
      { id: 2, unidadeId: 2, dataAcao: d('2026-04-02'), instituicaoLocal: 'UBS Central', endereco: 'Rua B', qtdParticipantes: 15, tipo: 'Palestra' },
    ], p);
  }
  if (/FROM acao_visita_foto f/.test(s) && /SELECT TOP 500/.test(s)) {
    return visiveis([
      { id: 11, arquivo: 'foto1.jpg', mimeType: 'image/jpeg', legenda: 'Roda de conversa', unidadeId: 1, dataAcao: d('2026-03-12'), instituicaoLocal: 'CCA N. Sra.' },
      { id: 12, arquivo: 'foto2.png', mimeType: 'image/png', legenda: 'Palestra <saúde>', unidadeId: 2, dataAcao: d('2026-04-02'), instituicaoLocal: 'UBS Central' },
      { id: 13, arquivo: 'foto3.webp', mimeType: 'image/webp', legenda: 'WebP', unidadeId: 2, dataAcao: d('2026-04-02'), instituicaoLocal: 'UBS Central' },
      { id: 14, arquivo: '../../etc/passwd', mimeType: 'image/jpeg', legenda: 'Traversal', unidadeId: 1, dataAcao: d('2026-03-12'), instituicaoLocal: 'X' },
    ], p);
  }
  if (/FROM acao_visita_foto f JOIN acao_visita av ON av.id = f.acao_visita_id WHERE f.id = @id/.test(s)) {
    const todas = { 11: { id: 11, arquivo: 'foto1.jpg', mimeType: 'image/jpeg', unidadeId: 1 }, 12: { id: 12, arquivo: 'foto2.png', mimeType: 'image/png', unidadeId: 2 } };
    const f = todas[p.id];
    return f && permitidasDe(p).includes(f.unidadeId) ? [f] : [];
  }
  if (/FROM atendimento a WHERE .* GROUP BY a\.unidade_id, YEAR/.test(s)) {
    return visiveis([
      { unidadeId: 1, ano: 2026, mes: 1, atendimentos: 50 }, { unidadeId: 1, ano: 2026, mes: 2, atendimentos: 70 }, { unidadeId: 2, ano: 2026, mes: 2, atendimentos: 80 },
    ], p);
  }
  if (/FROM acao_visita av WHERE .* GROUP BY av\.unidade_id, YEAR/.test(s)) {
    return visiveis([{ unidadeId: 1, ano: 2026, mes: 2, acoes: 3, participantes: 100 }], p);
  }
  if (/FROM acao_visita av JOIN unidade un ON un.id = av.unidade_id JOIN tipo_acao ta/.test(s)) {
    return visiveis([
      { id: 1, unidadeId: 1, dataAcao: d('2026-03-12'), sigla: 'BRA', instituicaoLocal: '=HYPERLINK("x")', endereco: 'Rua; A', status: 'REALIZADA', qtdParticipantes: 40, tipo: 'Visita institucional' },
      { id: 2, unidadeId: 2, dataAcao: d('2026-04-02'), sigla: 'TIR', instituicaoLocal: 'UBS', endereco: null, status: 'CANCELADA', qtdParticipantes: null, tipo: 'Palestra' },
    ], p);
  }
  if (/FROM acompanhamento ac JOIN familia f JOIN pessoa/.test(s) || /SELECT TOP 200 ac\.id/.test(s)) {
    return visiveis(ACOMPANHAMENTOS, p).map((a) => ({ id: a.id, dataInicio: a.dataInicio, status: a.status, unidadeSigla: a.unidadeSigla, responsavelNome: 'Fulana', temInicial: 1, temFinal: 1 }));
  }
  throw new Error(`Consulta não prevista no banco simulado: ${s.slice(0, 160)}`);
}

function instalar() {
  const dbPath = require.resolve(path.join(RAIZ, 'server/db.js'));
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      tipos: { Date: Symbol('Date') },
      consultar: async (sql, p) => responder(sql, p),
      consultarUm: async (sql, p) => (await responder(sql, p))[0] || null,
      transacao: async (fn) => fn({ consultar: async () => [] }),
    },
  };
}

module.exports = { instalar, UNIDADES, consultasUnidade };
