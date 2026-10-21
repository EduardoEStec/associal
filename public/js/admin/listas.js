// Aba Listas (tabelas de apoio editáveis).
import { api } from '../api.js';
import { h, toast, confirmar, carregando } from '../ui.js';
import { campo, caixa, modalFormulario, tabela, vazio, badgeAtivo } from './comum.js';

const ROTULOS = {
  demanda: 'Demandas', encaminhamento: 'Encaminhamentos', vulnerabilidade: 'Vulnerabilidades', escolaridade: 'Escolaridade',
  raca: 'Raça/cor', genero: 'Gênero', faixa_etaria: 'Faixas etárias', nivel_vulnerabilidade: 'Níveis de vulnerabilidade',
  tema: 'Temas das ações', tipo_acao: 'Tipos de ação', beneficio: 'Benefícios recebidos', destino_economia: 'Destino da economia',
  tipo_contato: 'Tipos de contato',
};

export async function montarListas(raiz) {
  const nomes = await api.get('/api/admin/apoio');
  let atual = nomes[0];
  const area = h('div', {});

  async function carregar() {
    area.replaceChildren(carregando());
    try {
      const lista = await api.get(`/api/admin/apoio/${atual}`);
      const faixa = atual === 'faixa_etaria';
      const colunas = [
        { rotulo: 'Nome', valor: (i) => h('span', {}, h('strong', {}, i.nome), i.exigeTexto ? h('small', {}, ' (pede texto livre)') : null) },
        ...(faixa ? [{ rotulo: 'Idades', valor: (i) => (i.idadeMin === null && i.idadeMax === null ? '—' : `${i.idadeMin ?? 0} a ${i.idadeMax ?? '∞'}`) }] : []),
        { rotulo: 'Ordem', valor: (i) => i.ordem },
        { rotulo: 'Situação', valor: (i) => badgeAtivo(i.ativo) },
        {
          rotulo: 'Ações',
          valor: (i) => h('div', { class: 'admin-acoes' },
            h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => abrir(i) }, 'Editar'),
            h('button', { type: 'button', class: 'btn btn-pequeno btn-secundario', onclick: () => alternar(i) }, i.ativo ? 'Desativar' : 'Ativar'),
            i.emUso ? null : h('button', { type: 'button', class: 'btn btn-pequeno btn-perigo', onclick: () => excluir(i) }, 'Excluir')),
        },
      ];
      area.replaceChildren(lista.length ? tabela(colunas, lista, { classeLinha: (i) => (i.ativo ? '' : 'admin-inativo') }) : vazio('Nenhuma opção cadastrada.'));
    } catch (e) { area.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message)); }
  }

  async function alternar(i) {
    try { await api.patch(`/api/admin/apoio/${atual}/${i.id}/ativo`, { ativo: !i.ativo }); carregar(); } catch (e) { toast.erro(e.message); }
  }

  async function excluir(i) {
    if (!(await confirmar(`Excluir "${i.nome}"? Só é possível porque ainda não foi usada.`, { perigo: true, textoOk: 'Excluir' }))) return;
    try { await api.delete(`/api/admin/apoio/${atual}/${i.id}`); toast.sucesso('Opção excluída.'); carregar(); } catch (e) { toast.erro(e.message); }
  }

  function abrir(i) {
    const faixa = atual === 'faixa_etaria';
    const form = h('form', {},
      campo('Nome', 'nome', { valor: i?.nome, obrigatorio: true, maxlength: 150 }),
      campo('Ordem de exibição', 'ordem', { tipo: 'number', valor: i?.ordem ?? 0, min: 0, inputmode: 'numeric' }),
      faixa ? campo('Idade mínima', 'idadeMin', { tipo: 'number', valor: i?.idadeMin ?? '', min: 0, inputmode: 'numeric' }) : null,
      faixa ? campo('Idade máxima', 'idadeMax', { tipo: 'number', valor: i?.idadeMax ?? '', min: 0, inputmode: 'numeric', ajuda: 'Deixe as duas idades em branco para a opção "Outra".' }) : null,
      h('div', { class: 'opcoes' }, caixa('Pede um texto livre (opção "Outra/Outros")', 'exigeTexto', i?.exigeTexto)));
    modalFormulario({
      titulo: i ? 'Editar opção' : 'Nova opção',
      form,
      aoSalvar: async (f) => {
        const corpo = { nome: f.elements.nome.value, ordem: f.elements.ordem.value, exigeTexto: f.elements.exigeTexto.checked };
        if (faixa) { corpo.idadeMin = f.elements.idadeMin.value; corpo.idadeMax = f.elements.idadeMax.value; }
        if (i) await api.put(`/api/admin/apoio/${atual}/${i.id}`, corpo); else await api.post(`/api/admin/apoio/${atual}`, corpo);
        toast.sucesso('Opção salva.');
        carregar();
      },
    });
  }

  const seletor = campo('Lista', 'tabela', { tipo: 'select', valor: atual, opcoes: nomes.map((n) => ({ valor: n, rotulo: ROTULOS[n] || n })) });
  seletor.querySelector('select').addEventListener('change', (e) => { atual = e.target.value; carregar(); });
  raiz.append(
    h('div', { class: 'admin-barra' }, seletor, h('button', { type: 'button', class: 'btn', onclick: () => abrir(null) }, 'Nova opção')),
    h('p', { class: 'texto-pequeno' }, 'Opções já usadas em registros não podem ser excluídas: desative-as para que deixem de aparecer nos formulários.'),
    area);
  await carregar();
}
