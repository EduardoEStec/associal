// Botão "Formulário" do atendimento: abre o questionário individual familiar da pessoa atendida, pelo CPF.
//   - já é responsável por acompanhamento em andamento -> questionário pendente (inicial, senão final; os dois feitos -> comparação)
//   - ainda não é família acompanhada -> oferece "Iniciar acompanhamento" (cadastro pré-preenchido) e depois abre o inicial
//   - sem CPF -> explica o que falta
// Ao concluir o questionário, o módulo Famílias devolve para este atendimento (ver ../retorno-atendimento.js).
import { api } from '../api.js';
import { h, toast, abrirModal, formatarCpf } from '../ui.js';
import { guardarRetorno, guardarPreCadastro } from '../retorno-atendimento.js';

const FAMILIAS = '/familias.html';
const podeEscrever = (usuario) => ['ASSISTENTE', 'COORDENADOR', 'ADMIN'].includes(usuario.perfil);

// Acompanhamento do CPF visível ao usuário (em andamento primeiro; senão o mais recente encerrado)
async function acompanhamentoDoCpf(cpf) {
  const { itens } = await api.get('/api/familias', { q: cpf, tamanho: 100 });
  const meus = itens.filter((i) => i.responsavel.cpf === cpf);
  return { andamento: meus.find((i) => i.status === 'EM_ANDAMENTO') || null, encerrado: meus[0] || null };
}

function ir(destino, atendimentoId) {
  guardarRetorno({ acompanhamentoId: destino.acompanhamentoId, url: `/atendimentos.html#${atendimentoId}` });
  location.href = `${FAMILIAS}#/a/${destino.acompanhamentoId}/${destino.rota}`;
}

function mensagem(titulo, textos, botoes) {
  return abrirModal({
    titulo,
    conteudo: h('div', { class: 'form-aviso' }, textos.map((t) => h('p', {}, t))),
    botoes: [...botoes, { texto: 'Fechar', classe: 'btn btn-secundario' }],
  });
}

// atendimento: o objeto devolvido por GET /api/atendimentos/:id (pessoa, unidadeId, podeEditar)
export async function abrirFormulario({ usuario, atendimento: a }) {
  const cpf = a.pessoa.cpf;
  if (!cpf) {
    mensagem('Formulário', [
      'Este atendimento não tem CPF. O questionário individual familiar é ligado à família pelo CPF do responsável.',
      'Informe o CPF no atendimento ou cadastre a família em Famílias.',
    ], a.podeEditar ? [{ texto: 'Editar atendimento', classe: 'btn', acao: () => { location.hash = `#${a.id}/editar`; } }] : []);
    return;
  }

  let achado;
  try {
    achado = await acompanhamentoDoCpf(cpf);
  } catch (e) {
    toast.erro(e.message);
    return;
  }

  const { andamento, encerrado } = achado;
  if (andamento) {
    const rota = !andamento.inicialConcluido ? 'q/INICIAL' : !andamento.finalConcluido ? 'q/FINAL' : 'comparacao';
    ir({ acompanhamentoId: andamento.acompanhamentoId, rota }, a.id);
    return;
  }

  if (!podeEscrever(usuario)) {
    mensagem('Formulário', [
      encerrado ? 'O acompanhamento desta família já foi encerrado.' : 'Esta pessoa ainda não é uma família acompanhada.',
      'O seu perfil só consulta; quem pode iniciar o acompanhamento é a assistente social ou o coordenador.',
    ], encerrado ? [{ texto: 'Ver família', classe: 'btn', acao: () => ir({ acompanhamentoId: encerrado.acompanhamentoId, rota: '' }, a.id) }] : []);
    return;
  }

  mensagem('Iniciar acompanhamento', [
    encerrado
      ? `${a.pessoa.nome} já teve um acompanhamento, hoje encerrado. Para aplicar o formulário, inicie um novo acompanhamento.`
      : `${a.pessoa.nome} (CPF ${formatarCpf(cpf)}) ainda não é uma família acompanhada.`,
    'O cadastro da família abre com os dados do atendimento já preenchidos. Ao salvar, o questionário inicial abre em seguida.',
  ], [{
    texto: 'Iniciar acompanhamento',
    classe: 'btn',
    acao: () => {
      guardarPreCadastro({ cpf, unidadeId: a.unidadeId });
      guardarRetorno({ acompanhamentoId: null, cpf, url: `/atendimentos.html#${a.id}` });
      location.href = `${FAMILIAS}#/nova`;
      return false;
    },
  }]);
}

export function botaoFormulario(contexto) {
  return h('button', { type: 'button', class: 'btn', onclick: () => abrirFormulario(contexto) }, 'Formulário');
}
