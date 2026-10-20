// Aba Usuários.
import { api } from '../api.js';
import { h, toast, confirmar, abrirModal, carregando, formatarDataHora } from '../ui.js';
import { campo, caixa, modalFormulario, tabela, vazio, badgeAtivo } from './comum.js';

const PERFIS = [
  { valor: 'ASSISTENTE', rotulo: 'Assistente social' },
  { valor: 'COORDENADOR', rotulo: 'Coordenador' },
  { valor: 'ADMIN', rotulo: 'Administrador' },
];
const rotuloPerfil = (p) => PERFIS.find((x) => x.valor === p)?.rotulo || p;

function mostrarSenha(titulo, login, senha) {
  abrirModal({
    titulo,
    conteudo: h('div', {},
      h('p', {}, `Senha provisória de ${login}. Ela só aparece agora: anote e repasse com segurança. No primeiro acesso o sistema exigirá uma nova senha.`),
      h('div', { class: 'senha-provisoria' }, senha)),
    botoes: [{ texto: 'Entendi', classe: 'btn' }],
    fechavel: false,
  });
}

export async function montarUsuarios(raiz, usuarioLogado) {
  const filtros = { busca: '', perfil: '', ativo: '' };
  const area = h('div', {});

  async function carregar() {
    area.replaceChildren(carregando());
    try {
      const lista = await api.get('/api/admin/usuarios', filtros);
      area.replaceChildren(lista.length ? tabela([
        { rotulo: 'Nome', valor: (u) => h('span', {}, h('strong', {}, u.nome), h('br'), h('small', {}, u.login)) },
        { rotulo: 'Perfil', valor: (u) => rotuloPerfil(u.perfil) },
        { rotulo: 'Unidades', valor: (u) => (u.perfil === 'ASSISTENTE' ? u.unidades.map((x) => x.sigla).join(', ') || '—' : 'Todas') },
        { rotulo: 'Situação', valor: (u) => badgeAtivo(u.ativo) },
        { rotulo: 'Último acesso', valor: (u) => (u.ultimoLoginEm ? formatarDataHora(u.ultimoLoginEm) : 'Nunca') },
        {
          rotulo: 'Ações',
          valor: (u) => h('div', { class: 'admin-acoes' },
            h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => editar(u) }, 'Editar'),
            h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => redefinir(u) }, 'Redefinir senha'),
            h('button', { type: 'button', class: `btn btn-pequeno ${u.ativo ? 'btn-perigo' : 'btn-secundario'}`, onclick: () => alternar(u) }, u.ativo ? 'Desativar' : 'Ativar')),
        },
      ], lista, { classeLinha: (u) => (u.ativo ? '' : 'admin-inativo') }) : vazio('Nenhum usuário encontrado.'));
    } catch (e) {
      area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
    }
  }

  async function alternar(u) {
    const ativar = !u.ativo;
    const ok = await confirmar(
      ativar ? `Reativar ${u.nome}?` : `Desativar ${u.nome}? A pessoa perde o acesso imediatamente.`,
      { perigo: !ativar, textoOk: ativar ? 'Ativar' : 'Desativar' });
    if (!ok) return;
    try {
      await api.patch(`/api/admin/usuarios/${u.id}/ativo`, { ativo: ativar });
      toast.sucesso(ativar ? 'Usuário reativado.' : 'Usuário desativado.');
      carregar();
    } catch (e) { toast.erro(e.message); }
  }

  async function redefinir(u) {
    if (!(await confirmar(`Gerar uma nova senha provisória para ${u.nome}? A senha atual deixará de funcionar.`, { textoOk: 'Gerar senha' }))) return;
    try {
      const r = await api.post(`/api/admin/usuarios/${u.id}/redefinir-senha`);
      mostrarSenha('Senha redefinida', u.login, r.senhaProvisoria);
    } catch (e) { toast.erro(e.message); }
  }

  async function formulario(u) {
    const todas = await api.get('/api/admin/unidades');
    const unidades = todas.filter((x) => x.ativo || (u?.unidades || []).some((v) => v.id === x.id));
    const selecionadas = new Set((u?.unidades || []).map((x) => x.id));
    const blocoUnidades = h('fieldset', { class: 'secao' },
      h('legend', {}, 'Unidades vinculadas'),
      h('div', { class: 'opcoes' }, unidades.map((x) => caixa(`${x.sigla} — ${x.nome}`, 'unidadeIds', selecionadas.has(x.id), x.id))),
      h('span', { class: 'ajuda' }, 'Obrigatório para assistente social. Coordenador e administrador veem todas as unidades.'));
    const form = h('form', {},
      u ? null : campo('Login', 'login', { obrigatorio: true, autocapitalize: 'none', autocomplete: 'off', ajuda: 'Letras minúsculas, números, ponto, hífen ou sublinhado.' }),
      campo('Nome completo', 'nome', { valor: u?.nome, obrigatorio: true }),
      campo('E-mail', 'email', { tipo: 'email', valor: u?.email }),
      campo('Perfil', 'perfil', { tipo: 'select', valor: u?.perfil || 'ASSISTENTE', opcoes: PERFIS, disabled: u?.id === usuarioLogado.id }),
      campo('CRESS', 'cress', { valor: u?.cress, ajuda: 'Registro profissional (assinatura dos relatórios).' }),
      blocoUnidades);
    const atualizar = () => { blocoUnidades.hidden = form.elements.perfil.value !== 'ASSISTENTE'; };
    form.elements.perfil.addEventListener('change', atualizar);
    atualizar();
    return form;
  }

  function corpo(form, u) {
    return {
      login: form.elements.login?.value,
      nome: form.elements.nome.value,
      email: form.elements.email.value,
      // select desabilitado (o próprio usuário) não envia valor: mantém o perfil atual
      perfil: u && u.id === usuarioLogado.id ? u.perfil : form.elements.perfil.value,
      cress: form.elements.cress.value,
      unidadeIds: [...form.querySelectorAll('input[name="unidadeIds"]:checked')].map((c) => Number(c.value)),
    };
  }

  async function criar() {
    const form = await formulario(null);
    modalFormulario({
      titulo: 'Novo usuário',
      form,
      textoSalvar: 'Criar usuário',
      aoSalvar: async (f) => {
        const r = await api.post('/api/admin/usuarios', corpo(f, null));
        toast.sucesso('Usuário criado.');
        carregar();
        mostrarSenha('Usuário criado', r.login, r.senhaProvisoria);
      },
    });
  }

  async function editar(u) {
    const form = await formulario(u);
    modalFormulario({
      titulo: `Editar ${u.nome}`,
      form,
      aoSalvar: async (f) => {
        await api.put(`/api/admin/usuarios/${u.id}`, corpo(f, u));
        toast.sucesso('Usuário atualizado.');
        carregar();
      },
    });
  }

  const busca = campo('Buscar', 'busca', { tipo: 'search', placeholder: 'Nome ou login' });
  const perfil = campo('Perfil', 'perfil', { tipo: 'select', opcoes: [{ valor: '', rotulo: 'Todos' }, ...PERFIS] });
  const situacao = campo('Situação', 'ativo', {
    tipo: 'select',
    opcoes: [{ valor: '', rotulo: 'Todos' }, { valor: '1', rotulo: 'Ativos' }, { valor: '0', rotulo: 'Inativos' }],
  });
  let temporizador;
  busca.querySelector('input').addEventListener('input', (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { filtros.busca = e.target.value; carregar(); }, 300);
  });
  perfil.querySelector('select').addEventListener('change', (e) => { filtros.perfil = e.target.value; carregar(); });
  situacao.querySelector('select').addEventListener('change', (e) => { filtros.ativo = e.target.value; carregar(); });

  raiz.append(
    h('div', { class: 'admin-barra' }, busca, perfil, situacao, h('button', { type: 'button', class: 'btn', onclick: criar }, 'Novo usuário')),
    area);
  await carregar();
}
