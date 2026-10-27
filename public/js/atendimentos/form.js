// Atendimentos — formulário de novo atendimento / edição (18 campos da especificação).
import { api, ErroApi } from '../api.js';
import { formatarTelefone } from '../telefone.js';
import { montarExtras } from './extras.js';
import {
  h, toast, carregando, mostrarErrosCampos, comEspera, hojeIso, formatarCpf, formatarCep, mascarar,
  cpfValido, apenasDigitos,
} from '../ui.js';

const CHAVE_RASCUNHO = 'associal.atendimento.rascunho.v1';

// localStorage pode lançar (modo privado, bloqueio): nunca deixe isso quebrar o formulário.
const rascunho = {
  ler() { try { return JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || 'null'); } catch { return null; } },
  gravar(v) { try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  limpar() { try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* sem armazenamento */ } },
};

const CAMPOS_TEXTO = [
  'dataAtendimento', 'unidadeId', 'cpf', 'nome', 'dataNascimento', 'nis', 'telefone', 'telefone2', 'endereco', 'cep', 'bairro',
  'trabalhoAtual', 'faixaEtariaId', 'generoOutro', 'escolaridadeOutro', 'racaOutro', 'demandaOutra', 'vulnerabilidadeOutra', 'encaminhamentoOutro', 'resumo',
];
const CAMPOS_RADIO = ['generoId', 'nivelVulnerabilidadeId'];
const CAMPOS_SELECT = ['escolaridadeId', 'racaId'];
const CAMPOS_MULTI = ['demandas', 'vulnerabilidades', 'encaminhamentos'];

function campo(rotulo, entrada, { id, obrigatorio, ajuda } = {}) {
  return h('div', { class: 'campo' },
    h('label', { for: id, class: obrigatorio ? 'obrigatorio' : false }, rotulo),
    entrada,
    ajuda ? h('span', { class: 'ajuda' }, ajuda) : null);
}

function grupo(rotulo, filhos) {
  return h('div', { class: 'campo', role: 'group', 'aria-label': rotulo }, h('span', { class: 'rotulo' }, rotulo), filhos);
}

function opcoesRadio(nome, lista) {
  return h('div', { class: 'opcoes atend-opcoes-grade' }, ...lista.map((o) =>
    h('label', { class: 'opcao' }, h('input', { type: 'radio', name: nome, value: o.id }), o.nome)));
}

function opcoesCheck(nome, lista) {
  return h('div', { class: 'opcoes atend-opcoes-grade' }, ...lista.map((o) =>
    h('label', { class: 'opcao' },
      h('input', { type: 'checkbox', name: nome, value: o.id, dataset: { exigeTexto: o.exigeTexto ? '1' : '' } }), o.nome)));
}

function select(nome, lista, textoVazio = 'Selecione…') {
  return h('select', { class: 'select', name: nome, id: nome },
    h('option', { value: '' }, textoVazio), ...lista.map((o) => h('option', { value: o.id }, o.nome)));
}

// Faixa etária (mesma regra do back-end, que é quem decide): idade na data do atendimento.
function idadeNaData(nascimento, data) {
  if (!nascimento || !data) return null;
  const [an, mn, dn] = nascimento.split('-').map(Number);
  const [ar, mr, dr] = data.split('-').map(Number);
  let idade = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) idade -= 1;
  return idade >= 0 ? idade : null;
}

function faixaCalculada(faixas, idade) {
  if (idade === null) return null;
  return faixas.find((f) => (f.idadeMin !== null || f.idadeMax !== null)
    && (f.idadeMin === null || idade >= f.idadeMin) && (f.idadeMax === null || idade <= f.idadeMax)) || null;
}

export async function renderForm({ usuario, conteudo, apoio }, id) {
  const editando = !!id;
  conteudo.replaceChildren(carregando());
  const [existente, defsExtras] = await Promise.all([
    editando ? api.get(`/api/atendimentos/${id}`) : null,
    api.get('/api/apoio/perguntas/ATENDIMENTO').catch(() => []), // perguntas adicionais da coordenação (podem não existir)
  ]);
  const extras = montarExtras(defsExtras, existente?.extras);
  let pessoaId = existente?.pessoaId ?? null; // pessoa localizada por CPF (novo atendimento)

  const multiUnidade = usuario.unidades.length > 1;
  const f = {}; // refs úteis
  const form = h('form', { novalidate: true, autocomplete: 'off' });

  const avisoCadastro = h('div', { class: 'aviso aviso-sucesso atend-cadastro-existente', hidden: true, role: 'status' });
  const avisoRascunho = h('div', { class: 'aviso aviso-aviso atend-rascunho', hidden: true, role: 'status' },
    'Recuperamos um rascunho não salvo deste formulário. ',
    h('button', {
      type: 'button',
      class: 'btn btn-texto btn-pequeno',
      onclick: () => { rascunho.limpar(); location.reload(); },
    }, 'Descartar rascunho'));
  const faixaTexto = h('p', { class: 'atend-faixa' });
  f.faixaManual = campo('Faixa etária', select('faixaEtariaId', apoio.faixaEtaria), { id: 'faixaEtariaId', ajuda: 'Sem data de nascimento a faixa precisa ser escolhida.' });
  f.faixaAuto = grupo('Faixa etária (calculada)', faixaTexto);

  const entrada = {
    dataAtendimento: h('input', { class: 'input', type: 'date', name: 'dataAtendimento', id: 'dataAtendimento', max: hojeIso() }),
    unidadeId: h('select', { class: 'select', name: 'unidadeId', id: 'unidadeId' }, ...usuario.unidades.map((u) => h('option', { value: u.id }, `${u.sigla} — ${u.nome}`))),
    cpf: h('input', { class: 'input', name: 'cpf', id: 'cpf', inputmode: 'numeric', maxlength: 14, placeholder: '000.000.000-00' }),
    nome: h('input', { class: 'input', name: 'nome', id: 'nome', maxlength: 150, autocomplete: 'off' }),
    dataNascimento: h('input', { class: 'input', type: 'date', name: 'dataNascimento', id: 'dataNascimento', max: hojeIso() }),
    nis: h('input', { class: 'input', name: 'nis', id: 'nis', inputmode: 'numeric', maxlength: 11 }),
    telefone: h('input', { class: 'input', type: 'tel', name: 'telefone', id: 'telefone', inputmode: 'tel', maxlength: 15, placeholder: '(11) 91234-5678', autocomplete: 'off' }),
    telefone2: h('input', { class: 'input', type: 'tel', name: 'telefone2', id: 'telefone2', inputmode: 'tel', maxlength: 15, placeholder: '(11) 91234-5678', autocomplete: 'off' }),
    endereco: h('input', { class: 'input', name: 'endereco', id: 'endereco', maxlength: 200 }),
    cep: h('input', { class: 'input', name: 'cep', id: 'cep', inputmode: 'numeric', maxlength: 9, placeholder: '00000-000' }),
    bairro: h('input', { class: 'input', name: 'bairro', id: 'bairro', maxlength: 100 }),
    trabalhoAtual: h('input', { class: 'input', name: 'trabalhoAtual', id: 'trabalhoAtual', maxlength: 200 }),
    resumo: h('textarea', { class: 'textarea', name: 'resumo', id: 'resumo', rows: 6 }),
  };
  mascarar(entrada.cpf, formatarCpf);
  mascarar(entrada.cep, formatarCep);
  mascarar(entrada.telefone, formatarTelefone);
  mascarar(entrada.telefone2, formatarTelefone);
  entrada.nis.addEventListener('input', () => { entrada.nis.value = apenasDigitos(entrada.nis.value).slice(0, 11); });

  const outras = {
    demandaOutra: h('input', { class: 'input', name: 'demandaOutra', id: 'demandaOutra', maxlength: 300 }),
    vulnerabilidadeOutra: h('input', { class: 'input', name: 'vulnerabilidadeOutra', id: 'vulnerabilidadeOutra', maxlength: 300 }),
    encaminhamentoOutro: h('input', { class: 'input', name: 'encaminhamentoOutro', id: 'encaminhamentoOutro', maxlength: 300 }),
  };
  const blocosOutra = {
    demandas: campo('Qual outra demanda?', outras.demandaOutra, { id: 'demandaOutra', obrigatorio: true }),
    vulnerabilidades: campo('Quais outros riscos/vulnerabilidades?', outras.vulnerabilidadeOutra, { id: 'vulnerabilidadeOutra', obrigatorio: true }),
    encaminhamentos: campo('Qual outro encaminhamento?', outras.encaminhamentoOutro, { id: 'encaminhamentoOutro', obrigatorio: true }),
  };
  // campo de texto de cada grupo (só aparece, e só é exigido, com "Outra/Outros" marcado)
  const textoOutra = { demandas: 'demandaOutra', vulnerabilidades: 'vulnerabilidadeOutra', encaminhamentos: 'encaminhamentoOutro' };
  for (const b of Object.values(blocosOutra)) b.hidden = true;

  // "Outra" em gênero, escolaridade e raça/etnia: campo de texto obrigatório, só visível com a opção marcada
  const listasPessoa = [
    { id: 'generoId', outro: 'generoOutro', lista: apoio.genero, rotulo: 'Qual outro gênero?' },
    { id: 'escolaridadeId', outro: 'escolaridadeOutro', lista: apoio.escolaridade, rotulo: 'Qual outra escolaridade?' },
    { id: 'racaId', outro: 'racaOutro', lista: apoio.raca, rotulo: 'Qual outra raça/etnia?' },
  ];
  const textosPessoa = {};
  const blocosPessoa = {};
  for (const l of listasPessoa) {
    textosPessoa[l.outro] = h('input', { class: 'input', name: l.outro, id: l.outro, maxlength: 200 });
    blocosPessoa[l.outro] = campo(l.rotulo, textosPessoa[l.outro], { id: l.outro, obrigatorio: true });
    blocosPessoa[l.outro].hidden = true;
  }

  form.append(
    avisoRascunho,
    h('fieldset', { class: 'secao' }, h('legend', {}, 'Atendimento'),
      h('div', { class: 'grade grade-2' },
        campo('Data do atendimento', entrada.dataAtendimento, { id: 'dataAtendimento', obrigatorio: true }),
        multiUnidade ? campo('Unidade', entrada.unidadeId, { id: 'unidadeId', obrigatorio: true }) : null)),

    h('fieldset', { class: 'secao' }, h('legend', {}, 'Dados da pessoa'),
      campo('CPF', entrada.cpf, { id: 'cpf', ajuda: editando ? undefined : 'Ao digitar um CPF já cadastrado, os dados são preenchidos automaticamente.' }),
      avisoCadastro,
      campo('Nome completo', entrada.nome, { id: 'nome', obrigatorio: true }),
      h('div', { class: 'grade grade-2' },
        campo('Data de nascimento', entrada.dataNascimento, { id: 'dataNascimento' }),
        campo('Nº CadÚnico (NIS)', entrada.nis, { id: 'nis' })),
      h('div', { class: 'grade grade-2' },
        campo('Telefone', entrada.telefone, { id: 'telefone' }),
        campo('Telefone de recado (opcional)', entrada.telefone2, { id: 'telefone2' })),
      campo('Endereço (rua e número)', entrada.endereco, { id: 'endereco' }),
      h('div', { class: 'grade grade-2' },
        campo('CEP', entrada.cep, { id: 'cep' }),
        campo('Bairro', entrada.bairro, { id: 'bairro' })),
      campo('Trabalho atual', entrada.trabalhoAtual, { id: 'trabalhoAtual' }),
      f.faixaAuto, f.faixaManual,
      grupo('Gênero', opcoesRadio('generoId', apoio.genero)),
      blocosPessoa.generoOutro,
      h('div', { class: 'grade grade-2' },
        campo('Escolaridade', select('escolaridadeId', apoio.escolaridade), { id: 'escolaridadeId' }),
        campo('Raça/etnia', select('racaId', apoio.raca), { id: 'racaId' })),
      blocosPessoa.escolaridadeOutro,
      blocosPessoa.racaOutro),

    h('fieldset', { class: 'secao' }, h('legend', {}, 'Demanda'),
      grupo('Demandas (marque todas que se aplicam)', opcoesCheck('demandas', apoio.demanda)),
      blocosOutra.demandas),

    h('fieldset', { class: 'secao' }, h('legend', {}, 'Vulnerabilidade'),
      grupo('Nível de vulnerabilidade', opcoesRadio('nivelVulnerabilidadeId', apoio.nivelVulnerabilidade)),
      grupo('Vulnerabilidades/riscos (múltipla escolha)', opcoesCheck('vulnerabilidades', apoio.vulnerabilidade)),
      blocosOutra.vulnerabilidades),

    h('fieldset', { class: 'secao' }, h('legend', {}, 'Resumo e encaminhamentos'),
      campo('Resumo do atendimento', entrada.resumo, { id: 'resumo' }),
      grupo('Encaminhamentos (múltipla escolha)', opcoesCheck('encaminhamentos', apoio.encaminhamento)),
      blocosOutra.encaminhamentos),

    extras.secao,
  );

  const botaoSalvar = h('button', { type: 'submit', class: 'btn' }, editando ? 'Salvar alterações' : 'Registrar atendimento');
  form.append(h('div', { class: 'barra-acoes atend-barra-fixa' },
    h('a', { class: 'btn btn-secundario', href: editando ? `#${id}` : '#' }, 'Cancelar'),
    botaoSalvar));

  // ---------- comportamento ----------

  function atualizarOutras() {
    for (const [nome, bloco] of Object.entries(blocosOutra)) {
      const precisa = [...form.querySelectorAll(`input[name="${nome}"]:checked`)].some((c) => c.dataset.exigeTexto);
      bloco.hidden = !precisa;
      outras[textoOutra[nome]].required = precisa;
      if (!precisa) outras[textoOutra[nome]].value = '';
    }
    for (const l of listasPessoa) {
      const escolhida = form.elements[l.id]?.value;
      const precisa = !!l.lista.find((o) => String(o.id) === String(escolhida))?.exigeTexto;
      blocosPessoa[l.outro].hidden = !precisa;
      textosPessoa[l.outro].required = precisa;
      if (!precisa) textosPessoa[l.outro].value = '';
    }
  }

  function atualizarFaixa() {
    const idade = idadeNaData(entrada.dataNascimento.value, entrada.dataAtendimento.value);
    const faixa = faixaCalculada(apoio.faixaEtaria, idade);
    f.faixaAuto.hidden = idade === null;
    f.faixaManual.hidden = idade !== null;
    faixaTexto.textContent = idade === null ? '' : `${faixa ? faixa.nome : 'Outra'} (${idade} anos na data do atendimento)`;
  }

  function lerValores() {
    const v = {};
    for (const n of [...CAMPOS_TEXTO, ...CAMPOS_SELECT]) { const el = form.elements[n]; if (el) v[n] = el.value; }
    for (const n of CAMPOS_RADIO) v[n] = form.querySelector(`input[name="${n}"]:checked`)?.value || '';
    for (const n of CAMPOS_MULTI) v[n] = [...form.querySelectorAll(`input[name="${n}"]:checked`)].map((c) => c.value);
    v.extras = extras.ler();
    return v;
  }

  function aplicarValores(v) {
    for (const n of [...CAMPOS_TEXTO, ...CAMPOS_SELECT]) {
      const el = form.elements[n];
      if (el && v[n] !== undefined && v[n] !== null) el.value = v[n];
    }
    for (const n of CAMPOS_RADIO) {
      form.querySelectorAll(`input[name="${n}"]`).forEach((r) => { r.checked = String(r.value) === String(v[n] ?? ''); });
    }
    for (const n of CAMPOS_MULTI) {
      const marcados = (v[n] || []).map(String);
      form.querySelectorAll(`input[name="${n}"]`).forEach((c) => { c.checked = marcados.includes(c.value); });
    }
    if (v.extras) extras.aplicar(v.extras);
    atualizarOutras();
    atualizarFaixa();
  }

  function dadosParaPessoa(p) {
    return {
      cpf: p.cpf ? formatarCpf(p.cpf) : '', nome: p.nome, dataNascimento: (p.dataNascimento || '').slice(0, 10),
      nis: p.nis || '', telefone: p.telefone ? formatarTelefone(p.telefone) : '', telefone2: p.telefone2 ? formatarTelefone(p.telefone2) : '',
      endereco: p.endereco || '', cep: p.cep ? formatarCep(p.cep) : '', bairro: p.bairro || '',
      trabalhoAtual: p.trabalhoAtual || '', generoId: p.generoId ?? '', escolaridadeId: p.escolaridadeId ?? '', racaId: p.racaId ?? '',
      generoOutro: p.generoOutro || '', escolaridadeOutro: p.escolaridadeOutro || '', racaOutro: p.racaOutro || '',
    };
  }

  // Busca por CPF: só dados pessoais (a API não devolve nada de outras unidades).
  let ultimoCpfBuscado = '';
  async function buscarCpf() {
    const digitos = apenasDigitos(entrada.cpf.value);
    if (editando || digitos.length !== 11 || !cpfValido(digitos) || digitos === ultimoCpfBuscado) return;
    ultimoCpfBuscado = digitos;
    try {
      const r = await api.get('/api/pessoas/buscar', { cpf: digitos });
      if (r.encontrada) {
        pessoaId = r.pessoa.id;
        aplicarValores(dadosParaPessoa(r.pessoa));
        avisoCadastro.textContent = 'Cadastro existente: os dados pessoais foram preenchidos. Confira e atualize se algo mudou.';
        avisoCadastro.hidden = false;
      } else {
        pessoaId = null;
        avisoCadastro.hidden = true;
      }
    } catch (e) {
      if (e.status !== 0) toast.aviso(e.message); // sem internet: segue o preenchimento manual
      ultimoCpfBuscado = '';
    }
  }

  entrada.cpf.addEventListener('input', buscarCpf);
  entrada.dataNascimento.addEventListener('input', atualizarFaixa);
  entrada.dataAtendimento.addEventListener('input', atualizarFaixa);
  form.addEventListener('change', atualizarOutras);

  // ---------- valores iniciais / rascunho ----------

  entrada.dataAtendimento.value = hojeIso();
  entrada.unidadeId.value = usuario.unidades[0]?.id ?? '';

  if (existente) {
    aplicarValores({
      ...dadosParaPessoa(existente.pessoa),
      dataAtendimento: (existente.dataAtendimento || '').slice(0, 10),
      unidadeId: existente.unidadeId,
      nivelVulnerabilidadeId: existente.nivelVulnerabilidadeId ?? '',
      faixaEtariaId: existente.faixaEtariaId ?? '',
      demandas: existente.demandas, vulnerabilidades: existente.vulnerabilidades, encaminhamentos: existente.encaminhamentos,
      demandaOutra: existente.demandaOutra || '', vulnerabilidadeOutra: existente.vulnerabilidadeOutra || '',
      encaminhamentoOutro: existente.encaminhamentoOutro || '', resumo: existente.resumo || '', extras: existente.extras,
    });
  } else {
    atualizarFaixa();
    const salvo = rascunho.ler();
    if (salvo?.valores) {
      aplicarValores(salvo.valores);
      pessoaId = salvo.pessoaId ?? null;
      ultimoCpfBuscado = apenasDigitos(salvo.valores.cpf);
      avisoRascunho.hidden = false;
    }
    let temporizador;
    form.addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => rascunho.gravar({ valores: lerValores(), pessoaId }), 400);
    });
    form.addEventListener('change', () => rascunho.gravar({ valores: lerValores(), pessoaId }));
  }

  // ---------- envio ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = lerValores();
    const faltando = {};
    for (const [nome, bloco] of Object.entries(blocosOutra)) {
      const chave = textoOutra[nome];
      if (!bloco.hidden && !String(v[chave] || '').trim()) faltando[chave] = 'Especifique qual é a outra opção.';
    }
    for (const l of listasPessoa) {
      if (!blocosPessoa[l.outro].hidden && !String(v[l.outro] || '').trim()) faltando[l.outro] = 'Especifique qual é a outra opção.';
    }
    if (Object.keys(faltando).length) {
      mostrarErrosCampos(form, faltando);
      (outras[Object.keys(faltando)[0]] || textosPessoa[Object.keys(faltando)[0]]).focus({ preventScroll: true });
      return;
    }
    const corpo = {
      ...v,
      pessoaId: editando ? undefined : pessoaId,
      unidadeId: v.unidadeId || undefined,
      faixaEtariaId: v.faixaEtariaId || null,
      cpf: apenasDigitos(v.cpf) || null,
      nis: v.nis || null,
      telefone: apenasDigitos(v.telefone) || null,
      telefone2: apenasDigitos(v.telefone2) || null,
      cep: apenasDigitos(v.cep) || null,
    };
    try {
      await comEspera(botaoSalvar, async () => {
        const r = editando ? await api.put(`/api/atendimentos/${id}`, corpo) : await api.post('/api/atendimentos', corpo);
        if (!editando) rascunho.limpar();
        toast.sucesso(editando ? 'Atendimento atualizado.' : 'Atendimento registrado.');
        location.hash = `#${editando ? id : r.id}`;
      });
    } catch (err) {
      if (!(err instanceof ErroApi)) throw err;
      if (err.detalhes) mostrarErrosCampos(form, err.detalhes);
      if (err.status === 0) toast.erro('Sem conexão. Seus dados continuam guardados neste aparelho; tente salvar novamente quando a internet voltar.');
      else toast.erro(err.message);
    }
  });

  conteudo.replaceChildren(
    h('div', { class: 'pagina-titulo' }, h('h1', {}, editando ? 'Editar atendimento' : 'Novo atendimento')),
    form,
  );
}
