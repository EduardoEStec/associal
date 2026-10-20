// Cadastro (e edição) da família: responsável + membros dinâmicos + dados do acompanhamento.
import { api, ErroApi } from '../api.js';
import { formatarTelefone } from '../telefone.js';
import {
  h, toast, carregando, mascarar, formatarCpf, formatarCep, cpfValido, apenasDigitos, hojeIso,
  mostrarErrosCampos, comEspera,
} from '../ui.js';
import { carregarApoio, cabecalhoPagina, campo, selectApoio, isoDia } from './util.js';

function entrada(attrs) {
  return h('input', { class: 'input', ...attrs });
}

function criarCartaoMembro(apoio, membro = {}) {
  const cartao = h('div', { class: 'card fam-membro' });
  const topo = h('div', { class: 'linha-entre' }, h('strong', { class: 'fam-membro-titulo' }));
  const botaoRemover = h('button', { type: 'button', class: 'btn btn-texto btn-pequeno' }, 'Remover');
  topo.append(botaoRemover);

  const nome = entrada({ type: 'text', maxlength: 150, autocomplete: 'off' });
  nome.value = membro.nome || '';
  const nasc = entrada({ type: 'date', max: hojeIso() });
  nasc.value = isoDia(membro.dataNascimento);
  const idade = entrada({ type: 'number', inputmode: 'numeric', min: 0, max: 120 });
  idade.value = membro.idade ?? '';
  const genero = selectApoio({ lista: apoio.genero, valor: membro.generoId, vazio: 'Não informado' });
  const parentesco = entrada({ type: 'text', maxlength: 60, placeholder: 'Ex.: filho, cônjuge, mãe' });
  parentesco.value = membro.parentesco || '';
  const trabalha = h('select', { class: 'select' },
    h('option', { value: '' }, 'Não informado'), h('option', { value: 'true' }, 'Sim'), h('option', { value: 'false' }, 'Não'));
  trabalha.value = membro.trabalha === true ? 'true' : membro.trabalha === false ? 'false' : '';

  const rot = (texto, controle) => h('div', { class: 'campo' }, h('label', {}, texto), controle);
  cartao.append(
    topo,
    h('div', { class: 'grade grade-2' },
      rot('Nome', nome), rot('Parentesco com o responsável', parentesco),
      rot('Data de nascimento', nasc), rot('Idade (se não souber a data)', idade),
      rot('Gênero', genero), rot('Trabalha?', trabalha)),
  );
  const campos = { nome, dataNascimento: nasc, idade, generoId: genero, parentesco, trabalha };
  // O "for" do rótulo aponta para o campo (ids são atribuídos em renumerar()).
  cartao.campos = campos;
  cartao.lerValores = () => ({
    nome: nome.value.trim(),
    dataNascimento: nasc.value || null,
    idade: nasc.value || idade.value === '' ? null : Number(idade.value),
    generoId: genero.value ? Number(genero.value) : null,
    parentesco: parentesco.value.trim() || null,
    trabalha: trabalha.value === '' ? null : trabalha.value === 'true',
  });
  cartao.botaoRemover = botaoRemover;
  return cartao;
}

export async function renderCadastro({ usuario, conteudo, navegar }, acompanhamentoId = null) {
  conteudo.replaceChildren(carregando());
  const edicao = acompanhamentoId !== null;
  const [apoio, atual] = await Promise.all([
    carregarApoio(),
    edicao ? api.get(`/api/familias/acompanhamentos/${acompanhamentoId}`) : null,
  ]);
  if (edicao && atual.status !== 'EM_ANDAMENTO') {
    conteudo.replaceChildren(
      cabecalhoPagina('Editar família', { voltar: { href: `#/a/${acompanhamentoId}`, texto: 'Voltar' } }),
      h('div', { class: 'aviso aviso-aviso' }, 'Este acompanhamento já foi encerrado e não pode mais ser alterado.'));
    return;
  }

  const r = atual?.responsavel || {};
  const form = h('form', { class: 'fam-form', novalidate: true });

  // --- Acompanhamento ---
  const unidades = usuario.unidades;
  let selUnidade = null;
  if (!edicao && unidades.length > 1) {
    selUnidade = h('select', { class: 'select', id: 'unidadeId', name: 'unidadeId' }, h('option', { value: '' }, 'Selecione'),
      unidades.map((u) => h('option', { value: String(u.id) }, `${u.sigla} — ${u.nome}`)));
  }
  const dataInicio = entrada({ type: 'date', id: 'dataInicio', name: 'dataInicio', max: hojeIso(), value: edicao ? isoDia(atual.dataInicio) : hojeIso() });
  const secAcomp = h('fieldset', { class: 'secao' }, h('legend', {}, 'Acompanhamento'),
    !edicao && !selUnidade ? h('p', { class: 'texto-pequeno' }, `Unidade: ${unidades[0]?.nome || ''}`) : null,
    h('div', { class: 'grade grade-2' },
      selUnidade ? campo({ id: 'unidadeId', rotulo: 'Unidade', obrigatorio: true, controle: selUnidade }) : null,
      campo({ id: 'dataInicio', rotulo: 'Data de início', obrigatorio: true,
        ajuda: 'O prazo do questionário final é calculado a partir desta data.', controle: dataInicio })));
  if (edicao && usuario.perfil === 'COORDENADOR') {
    const prazo = entrada({ type: 'date', id: 'dataPrevistaFinal', name: 'dataPrevistaFinal', value: isoDia(atual.dataPrevistaFinal) });
    secAcomp.append(campo({ id: 'dataPrevistaFinal', rotulo: 'Prazo do questionário final', ajuda: 'Somente a coordenação altera o prazo.', controle: prazo }));
  }

  // --- Responsável ---
  const cpf = entrada({ type: 'text', id: 'cpf', name: 'responsavel.cpf', inputmode: 'numeric', autocomplete: 'off', maxlength: 14, placeholder: '000.000.000-00' });
  cpf.value = r.cpf ? formatarCpf(r.cpf) : '';
  if (edicao) cpf.readOnly = true;
  mascarar(cpf, formatarCpf);
  const avisoCpf = h('div', { 'aria-live': 'polite' });
  const nome = entrada({ type: 'text', id: 'nome', name: 'responsavel.nome', maxlength: 150, autocomplete: 'off', value: r.nome || '' });
  const nasc = entrada({ type: 'date', id: 'nasc', name: 'responsavel.dataNascimento', max: hojeIso(), value: isoDia(r.dataNascimento) });
  const nis = entrada({ type: 'text', id: 'nis', name: 'responsavel.nis', inputmode: 'numeric', maxlength: 11, value: r.nis || '' });
  const telefone = entrada({ type: 'tel', id: 'telefone', name: 'responsavel.telefone', inputmode: 'tel', maxlength: 15, placeholder: '(11) 91234-5678', autocomplete: 'off', value: r.telefone ? formatarTelefone(r.telefone) : '' });
  const telefone2 = entrada({ type: 'tel', id: 'telefone2', name: 'responsavel.telefone2', inputmode: 'tel', maxlength: 15, placeholder: '(11) 91234-5678', autocomplete: 'off', value: r.telefone2 ? formatarTelefone(r.telefone2) : '' });
  mascarar(telefone, formatarTelefone);
  mascarar(telefone2, formatarTelefone);
  const endereco = entrada({ type: 'text', id: 'endereco', name: 'responsavel.endereco', maxlength: 200, value: r.endereco || '' });
  const cep = entrada({ type: 'text', id: 'cep', name: 'responsavel.cep', inputmode: 'numeric', maxlength: 9, value: r.cep ? formatarCep(r.cep) : '' });
  mascarar(cep, formatarCep);
  const bairro = entrada({ type: 'text', id: 'bairro', name: 'responsavel.bairro', maxlength: 100, value: r.bairro || '' });
  const trabalho = entrada({ type: 'text', id: 'trabalho', name: 'responsavel.trabalhoAtual', maxlength: 200, value: r.trabalhoAtual || '' });
  const genero = selectApoio({ id: 'genero', name: 'responsavel.generoId', lista: apoio.genero, valor: r.generoId, vazio: 'Não informado' });
  const escolaridade = selectApoio({ id: 'escolaridade', name: 'responsavel.escolaridadeId', lista: apoio.escolaridade, valor: r.escolaridadeId, vazio: 'Não informada' });
  const raca = selectApoio({ id: 'raca', name: 'responsavel.racaId', lista: apoio.raca, valor: r.racaId, vazio: 'Não informada' });

  const secResp = h('fieldset', { class: 'secao' }, h('legend', {}, 'Responsável familiar'),
    campo({
      id: 'cpf', rotulo: 'CPF', obrigatorio: true,
      ajuda: edicao ? 'O CPF identifica a família e não pode ser alterado.' : 'Se a pessoa já tiver cadastro, os dados são preenchidos automaticamente.',
      controle: cpf,
    }),
    avisoCpf,
    campo({ id: 'nome', rotulo: 'Nome completo', obrigatorio: true, controle: nome }),
    h('div', { class: 'grade grade-2' },
      campo({ id: 'nasc', rotulo: 'Data de nascimento', controle: nasc }),
      campo({ id: 'nis', rotulo: 'Nº CadÚnico (NIS)', controle: nis }),
      campo({ id: 'telefone', rotulo: 'Telefone', controle: telefone }),
      campo({ id: 'telefone2', rotulo: 'Telefone de recado (opcional)', controle: telefone2 }),
      campo({ id: 'endereco', rotulo: 'Endereço (rua e número)', controle: endereco }),
      campo({ id: 'cep', rotulo: 'CEP', controle: cep }),
      campo({ id: 'bairro', rotulo: 'Bairro', controle: bairro }),
      campo({ id: 'trabalho', rotulo: 'Trabalho atual', controle: trabalho }),
      campo({ id: 'genero', rotulo: 'Gênero', controle: genero }),
      campo({ id: 'escolaridade', rotulo: 'Escolaridade', controle: escolaridade }),
      campo({ id: 'raca', rotulo: 'Raça/etnia', controle: raca })));

  // Busca por CPF (contrato da API de pessoas: GET /api/pessoas/buscar?cpf=)
  let ultimoCpfBuscado = '';
  async function buscarCpf() {
    const d = apenasDigitos(cpf.value);
    if (edicao || d.length !== 11 || d === ultimoCpfBuscado) return;
    if (!cpfValido(d)) { avisoCpf.replaceChildren(h('p', { class: 'erro-campo', role: 'alert' }, 'CPF inválido.')); return; }
    ultimoCpfBuscado = d;
    avisoCpf.replaceChildren(h('p', { class: 'ajuda' }, 'Buscando cadastro…'));
    try {
      const res = await api.get('/api/pessoas/buscar', { cpf: d });
      if (res.encontrada) {
        const p = res.pessoa;
        nome.value = p.nome || ''; nasc.value = isoDia(p.dataNascimento); nis.value = p.nis || '';
        telefone.value = p.telefone ? formatarTelefone(p.telefone) : ''; telefone2.value = p.telefone2 ? formatarTelefone(p.telefone2) : '';
        endereco.value = p.endereco || ''; cep.value = p.cep ? formatarCep(p.cep) : ''; bairro.value = p.bairro || '';
        trabalho.value = p.trabalhoAtual || ''; genero.value = p.generoId ? String(p.generoId) : '';
        escolaridade.value = p.escolaridadeId ? String(p.escolaridadeId) : ''; raca.value = p.racaId ? String(p.racaId) : '';
        avisoCpf.replaceChildren(h('div', { class: 'aviso aviso-sucesso' }, 'Cadastro existente: dados preenchidos. Confira e atualize se necessário.'));
      } else {
        avisoCpf.replaceChildren(h('p', { class: 'ajuda' }, 'CPF ainda não cadastrado: preencha os dados.'));
      }
    } catch {
      ultimoCpfBuscado = '';
      avisoCpf.replaceChildren(h('p', { class: 'ajuda' }, 'Não foi possível buscar o cadastro agora. Preencha os dados manualmente.'));
    }
  }
  cpf.addEventListener('input', buscarCpf);
  cpf.addEventListener('blur', buscarCpf);

  // --- Membros ---
  const listaMembros = h('div', { class: 'fam-membros' });
  const vazio = h('p', { class: 'texto-pequeno texto-suave' }, 'Nenhum outro membro cadastrado. Adicione as demais pessoas que moram com o responsável.');
  const cartoes = [];
  function renumerar() {
    cartoes.forEach((c, i) => {
      c.querySelector('.fam-membro-titulo').textContent = `Membro ${i + 1}`;
      for (const [chave, no] of Object.entries(c.campos)) {
        no.name = `membros.${i}.${chave}`;
        no.id = `m${i}-${chave}`;
        no.closest('.campo').querySelector('label').setAttribute('for', no.id);
      }
    });
    vazio.hidden = cartoes.length > 0;
  }
  function adicionar(m) {
    const c = criarCartaoMembro(apoio, m);
    c.botaoRemover.addEventListener('click', () => {
      cartoes.splice(cartoes.indexOf(c), 1);
      c.remove();
      renumerar();
    });
    cartoes.push(c);
    listaMembros.append(c);
    renumerar();
    return c;
  }
  (atual?.membros || []).forEach(adicionar);
  const botaoAdd = h('button', {
    type: 'button',
    class: 'btn btn-secundario btn-bloco',
    onclick: () => adicionar({}).querySelector('input')?.focus(),
  }, '+ Adicionar membro da família');
  const secMembros = h('fieldset', { class: 'secao' }, h('legend', {}, 'Demais membros da família'), vazio, listaMembros, botaoAdd);

  // --- Observações ---
  const observacoes = h('textarea', { class: 'textarea', id: 'observacoes', name: 'observacoes', maxlength: 4000 });
  observacoes.value = atual?.observacoes || '';
  const secObs = h('fieldset', { class: 'secao' }, h('legend', {}, 'Observações'),
    campo({ id: 'observacoes', rotulo: 'Anotações sobre a família (opcional)', controle: observacoes }));

  const botaoSalvar = h('button', { type: 'submit', class: 'btn' }, edicao ? 'Salvar alterações' : 'Cadastrar família');
  form.append(secAcomp, secResp, secMembros, secObs,
    h('div', { class: 'barra-acoes' },
      h('a', { class: 'btn btn-secundario', href: edicao ? `#/a/${acompanhamentoId}` : '#/' }, 'Cancelar'), botaoSalvar));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const corpo = {
      dataInicio: dataInicio.value || undefined,
      observacoes: observacoes.value.trim() || null,
      responsavel: {
        cpf: apenasDigitos(cpf.value), nome: nome.value.trim(), dataNascimento: nasc.value || null,
        nis: nis.value.trim() || null, telefone: apenasDigitos(telefone.value) || null, telefone2: apenasDigitos(telefone2.value) || null, endereco: endereco.value.trim() || null, cep: apenasDigitos(cep.value) || null,
        bairro: bairro.value.trim() || null, trabalhoAtual: trabalho.value.trim() || null,
        generoId: genero.value ? Number(genero.value) : null, escolaridadeId: escolaridade.value ? Number(escolaridade.value) : null,
        racaId: raca.value ? Number(raca.value) : null,
      },
      membros: cartoes.map((c) => c.lerValores()),
    };
    if (selUnidade) corpo.unidadeId = selUnidade.value ? Number(selUnidade.value) : undefined;
    const prazo = form.elements.dataPrevistaFinal;
    if (edicao && prazo && prazo.value) corpo.dataPrevistaFinal = prazo.value;
    if (edicao) delete corpo.responsavel.cpf;

    await comEspera(botaoSalvar, async () => {
      try {
        if (edicao) {
          await api.put(`/api/familias/acompanhamentos/${acompanhamentoId}`, corpo);
          toast.sucesso('Família atualizada.');
          navegar(`#/a/${acompanhamentoId}`);
        } else {
          const res = await api.post('/api/familias', corpo);
          toast.sucesso('Família cadastrada. Agora aplique o questionário inicial.');
          navegar(`#/a/${res.acompanhamentoId}`);
        }
      } catch (err) {
        if (err instanceof ErroApi && err.status === 400) {
          mostrarErrosCampos(form, err.detalhes);
          toast.erro('Corrija os campos destacados.');
        } else if (err instanceof ErroApi && err.status === 409 && err.detalhes?.acompanhamentoId) {
          toast.aviso(err.message);
          navegar(`#/a/${err.detalhes.acompanhamentoId}`);
        } else {
          toast.erro(err.message);
          if (err instanceof ErroApi && err.status === 409) {
            avisoCpf.replaceChildren(h('div', { class: 'aviso aviso-aviso' }, err.message));
          }
        }
      }
    });
  });

  conteudo.replaceChildren(
    cabecalhoPagina(edicao ? 'Editar família' : 'Nova família', {
      voltar: { href: edicao ? `#/a/${acompanhamentoId}` : '#/', texto: edicao ? 'Voltar à família' : 'Lista de famílias' },
    }),
    form,
  );
  if (!edicao) cpf.focus();
}
