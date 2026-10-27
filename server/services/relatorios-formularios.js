'use strict';

// .docx do QUESTIONÁRIO INICIAL e do QUESTIONÁRIO FINAL no formato dos modelos oficiais (docs/modelos/1 e 3), preenchido com as
// respostas gravadas — ou em branco, se o questionário ainda não foi aplicado — para impressão e assinatura.

const { erros } = require('../lib/erros');
const questionarioDados = require('./questionario-dados');
const qm1 = require('./questionario-m1');
const docx = require('./relatorios-docx');
const { dataBr } = require('./relatorios-textos');

const LINHA = '_______________________________________________________________________';
const TRACO = '__________';

const formatarTelefone = (tel) => {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return '';
};
const formatarCpf = (cpf) => {
  const d = String(cpf ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf || '');
};
const linhaCress = (cress) => {
  const c = String(cress || '').trim();
  if (!c) return 'CRESS/SP: ';
  return /cress/i.test(c) ? c : `CRESS/SP: ${c}`;
};

const marca = (selecionada) => (selecionada ? 'X' : '  ');

// Uma pergunta do modelo -> { rotulo, opcoes: [{ marca, texto }], temResposta, resposta: [linhas] }
function perguntaParaDocx(p, respostas, detalhes) {
  const valor = respostas[p.codigo];
  const rotulo = `${p.extra ? '' : `${p.codigo}. `}${p.texto}`;
  const saida = { rotulo, opcoes: [], temResposta: false, resposta: [] };

  if (p.tipo === 'escolha' || p.tipo === 'multipla') {
    const escolhidas = new Set(p.tipo === 'multipla' ? (Array.isArray(valor) ? valor : []) : (valor ? [valor] : []));
    // opção desativada só aparece se foi a escolhida
    saida.opcoes = p.opcoes.filter((o) => o.ativa !== false || escolhidas.has(o.valor)).map((o) => {
      const sel = escolhidas.has(o.valor);
      const complemento = o.pedeDetalhe ? `: ${sel && detalhes[p.codigo] ? detalhes[p.codigo] : '______________________'}` : '';
      return { marca: marca(sel), texto: `${o.rotulo}${complemento}` };
    });
  } else if (p.tipo === 'booleano') {
    saida.opcoes = [{ marca: marca(valor === true), texto: 'Sim' }, { marca: marca(valor === false), texto: 'Não' }];
  } else if (p.tipo === 'numero') {
    saida.temResposta = true;
    saida.resposta = [valor === undefined || valor === null || valor === '' ? TRACO : String(valor).replace('.', ',')];
  } else {
    saida.temResposta = true;
    const t = typeof valor === 'string' ? valor.trim() : '';
    saida.resposta = t ? t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [LINHA, LINHA];
  }
  return saida;
}

// Linhas fixas da seção 1 do questionário inicial (dados do cadastro da família)
function linhasIdentificacao(cabecalho) {
  const r = cabecalho.responsavel;
  return [
    `Responsável familiar: ${r.nome || ''}`,
    `CPF/CadÚnico: ${[formatarCpf(r.cpf), r.nis].filter(Boolean).join(' / ')}`,
    `Endereço/território: ${r.endereco || ''}`,
    `Contato: ${formatarTelefone(r.telefone)}`,
  ];
}

async function gerarQuestionario(req, acompanhamentoId, tipoEntrada) {
  const tipo = String(tipoEntrada || '').toUpperCase();
  if (!['INICIAL', 'FINAL'].includes(tipo)) throw erros.naoEncontrado('Tipo de questionário inexistente. Use INICIAL ou FINAL.');
  const q = await questionarioDados.obter(req, acompanhamentoId, tipo);
  if (q.modelo !== 'M1') {
    throw erros.conflito('Este questionário foi aplicado no formato anterior e não tem o modelo impresso. Consulte as respostas na tela.');
  }
  const modelo = qm1.montarModeloM1(tipo);
  const c = q.cabecalho;
  const secoes = modelo.blocos.map((b) => ({
    titulo: `${b.numero}. ${b.titulo.toUpperCase()}`,
    linhasFixas: tipo === 'INICIAL' && b.numero === 1 ? linhasIdentificacao(c) : [],
    perguntas: b.perguntas.map((p) => perguntaParaDocx(p, q.respostas, q.detalhes || {})),
  }));
  const u = req.usuario;
  const r = c.responsavel;
  const buffer = docx.renderizar(tipo === 'INICIAL' ? 'questionario-inicial' : 'questionario-final', {
    unidade: c.unidade || '',
    assistente: c.assistente || '',
    dataInicio: dataBr(c.dataInicio),
    dataPrevista: c.dataPrevista ? dataBr(c.dataPrevista) : '____/_____/_______',
    dataAplicacao: q.dataAplicacao ? dataBr(q.dataAplicacao) : '____/_____/_______',
    meta: c.meta || '',
    responsavel: r.nome || '',
    cpfNis: [formatarCpf(r.cpf), r.nis].filter(Boolean).join(' / '),
    contato: formatarTelefone(r.telefone),
    endereco: r.endereco || '',
    secoes,
    assinaturaNome: c.assistente || u.nome,
    cressLinha: linhaCress(u.cress),
  });
  const nome = tipo === 'INICIAL' ? 'Questionario_Inicial' : 'Questionario_Final';
  return { buffer, nomeArquivo: `${nome}_${acompanhamentoId}${q.concluido ? '' : '_rascunho'}.docx`, concluido: q.concluido };
}

module.exports = { gerarQuestionario, perguntaParaDocx };
