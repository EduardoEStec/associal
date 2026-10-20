// Aba Unidades.
import { api } from '../api.js';
import { h, toast, confirmar, carregando } from '../ui.js';
import { campo, modalFormulario, tabela, vazio, badgeAtivo } from './comum.js';

export async function montarUnidades(raiz) {
  const area = h('div', {});

  async function carregar() {
    area.replaceChildren(carregando());
    try {
      const lista = await api.get('/api/admin/unidades');
      area.replaceChildren(lista.length ? tabela([
        { rotulo: 'Sigla', valor: (u) => h('strong', {}, u.sigla) },
        { rotulo: 'Nome', valor: (u) => u.nome },
        { rotulo: 'Endereço', valor: (u) => u.endereco || '—' },
        { rotulo: 'Ordem', valor: (u) => u.ordem },
        { rotulo: 'Situação', valor: (u) => badgeAtivo(u.ativo) },
        {
          rotulo: 'Ações',
          valor: (u) => h('div', { class: 'admin-acoes' },
            h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => abrir(u) }, 'Editar'),
            h('button', { type: 'button', class: `btn btn-pequeno ${u.ativo ? 'btn-perigo' : 'btn-secundario'}`, onclick: () => alternar(u) }, u.ativo ? 'Desativar' : 'Ativar')),
        },
      ], lista, { classeLinha: (u) => (u.ativo ? '' : 'admin-inativo') }) : vazio('Nenhuma unidade cadastrada.'));
    } catch (e) { area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message)); }
  }

  async function alternar(u) {
    const ativar = !u.ativo;
    const ok = await confirmar(
      ativar ? `Reativar a unidade ${u.sigla}?` : `Desativar a unidade ${u.sigla}? O histórico é mantido.`,
      { perigo: !ativar, textoOk: ativar ? 'Ativar' : 'Desativar' });
    if (!ok) return;
    try { await api.patch(`/api/admin/unidades/${u.id}/ativo`, { ativo: ativar }); carregar(); } catch (e) { toast.erro(e.message); }
  }

  function abrir(u) {
    const form = h('form', {},
      campo('Sigla', 'sigla', { valor: u?.sigla, obrigatorio: true, maxlength: 5, ajuda: 'De 2 a 5 letras ou números.' }),
      campo('Nome', 'nome', { valor: u?.nome, obrigatorio: true, maxlength: 100 }),
      campo('Endereço', 'endereco', { valor: u?.endereco, maxlength: 200 }),
      campo('Ordem de exibição', 'ordem', { tipo: 'number', valor: u?.ordem ?? 0, min: 0, inputmode: 'numeric' }));
    modalFormulario({
      titulo: u ? `Editar unidade ${u.sigla}` : 'Nova unidade',
      form,
      aoSalvar: async (f) => {
        const corpo = Object.fromEntries(['sigla', 'nome', 'endereco', 'ordem'].map((n) => [n, f.elements[n].value]));
        if (u) await api.put(`/api/admin/unidades/${u.id}`, corpo); else await api.post('/api/admin/unidades', corpo);
        toast.sucesso('Unidade salva.');
        carregar();
      },
    });
  }

  raiz.append(h('div', { class: 'admin-barra' }, h('button', { type: 'button', class: 'btn', onclick: () => abrir(null) }, 'Nova unidade')), area);
  await carregar();
}
