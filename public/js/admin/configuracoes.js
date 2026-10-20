// Aba Configurações. O COORDENADOR recebe do servidor só as chaves que pode editar.
import { api } from '../api.js';
import { h, toast, carregando, mostrarErrosCampos, comEspera, formatarDataHora } from '../ui.js';
import { campo, vazio } from './comum.js';

export async function montarConfiguracoes(raiz) {
  raiz.replaceChildren(carregando());
  let lista;
  try {
    lista = await api.get('/api/admin/configuracoes');
  } catch (e) {
    raiz.replaceChildren(h('div', { class: 'aviso aviso-perigo' }, e.message));
    return;
  }
  if (!lista.length) { raiz.replaceChildren(vazio('Nenhuma configuração disponível.')); return; }

  raiz.replaceChildren(...lista.map((c) => {
    const inteiro = c.tipo === 'inteiro';
    const form = h('form', { class: 'card', novalidate: true },
      campo(c.rotulo, 'valor', { tipo: inteiro ? 'number' : 'text', valor: c.valor, disabled: !c.editavel, inputmode: inteiro ? 'numeric' : null, min: inteiro ? 1 : null, ajuda: c.descricao }),
      c.alteradoEm ? h('p', { class: 'texto-pequeno' }, `Última alteração: ${formatarDataHora(c.alteradoEm)}`) : null);
    if (c.editavel) {
      const botao = h('button', { type: 'submit', class: 'btn' }, 'Salvar');
      form.append(h('div', { class: 'barra-acoes' }, botao));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        comEspera(botao, async () => {
          try {
            await api.put(`/api/admin/configuracoes/${c.chave}`, { valor: form.elements.valor.value });
            mostrarErrosCampos(form, {});
            toast.sucesso('Configuração salva.');
          } catch (err) {
            if (err.detalhes) mostrarErrosCampos(form, err.detalhes); else toast.erro(err.message);
          }
        });
      });
    }
    return form;
  }));
}
