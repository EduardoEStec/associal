// Aba Auditoria (somente leitura, paginada).
import { api } from '../api.js';
import { h, toast, carregando, formatarDataHora, hojeIso } from '../ui.js';
import { campo, tabela, vazio } from './comum.js';

export async function montarAuditoria(raiz) {
  const filtros = { usuarioId: '', acao: '', tabela: '', dataInicio: '', dataFim: '' };
  let pagina = 1;
  const area = h('div', {});
  const opcoes = await api.get('/api/admin/auditoria/opcoes');
  const todos = (extra) => [{ valor: '', rotulo: 'Todos' }, ...extra];

  async function carregar() {
    area.replaceChildren(carregando());
    try {
      const r = await api.get('/api/admin/auditoria', { ...filtros, pagina });
      const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
      area.replaceChildren(
        r.itens.length ? tabela([
          { rotulo: 'Quando', valor: (a) => formatarDataHora(a.criadoEm) },
          { rotulo: 'Usuário', valor: (a) => a.usuarioNome || (a.usuarioId ? `#${a.usuarioId}` : '—') },
          { rotulo: 'Ação', valor: (a) => a.acao },
          { rotulo: 'Registro', valor: (a) => (a.tabela ? `${a.tabela}${a.registroId ? ` #${a.registroId}` : ''}` : '—') },
          { rotulo: 'Detalhes', valor: (a) => h('span', { class: 'auditoria-detalhes' }, a.detalhes || '') },
          { rotulo: 'IP', valor: (a) => a.ip || '—' },
        ], r.itens) : vazio('Nenhum registro para os filtros informados.'),
        h('div', { class: 'admin-paginacao' },
          h('span', { class: 'texto-pequeno' }, `${r.total} registro(s) · página ${r.pagina} de ${paginas}`),
          h('div', { class: 'admin-acoes' },
            h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', disabled: pagina <= 1, onclick: () => { pagina -= 1; carregar(); } }, 'Anterior'),
            h('button', { type: 'button', class: 'btn btn-secundario btn-pequeno', disabled: pagina >= paginas, onclick: () => { pagina += 1; carregar(); } }, 'Próxima'))));
    } catch (e) {
      area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
      toast.erro(e.message);
    }
  }

  const campos = [
    ['usuarioId', campo('Usuário', 'usuarioId', { tipo: 'select', opcoes: todos(opcoes.usuarios.map((u) => ({ valor: u.id, rotulo: `${u.nome} (${u.login})` }))) })],
    ['acao', campo('Ação', 'acao', { tipo: 'select', opcoes: todos(opcoes.acoes.map((a) => ({ valor: a, rotulo: a }))) })],
    ['tabela', campo('Tabela', 'tabela', { tipo: 'select', opcoes: todos(opcoes.tabelas.map((t) => ({ valor: t, rotulo: t }))) })],
    ['dataInicio', campo('De', 'dataInicio', { tipo: 'date', max: hojeIso() })],
    ['dataFim', campo('Até', 'dataFim', { tipo: 'date', max: hojeIso() })],
  ];
  for (const [chave, el] of campos) {
    el.querySelector('input, select').addEventListener('change', (e) => { filtros[chave] = e.target.value; pagina = 1; carregar(); });
  }

  raiz.append(h('div', { class: 'admin-barra' }, campos.map(([, el]) => el)), area);
  await carregar();
}
