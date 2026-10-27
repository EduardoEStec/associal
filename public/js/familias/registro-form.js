// Formulário do registro de acompanhamento (criar e editar) no formato do modelo oficial "Registro periódico":
// mês de referência, data, contato realizado, uso do Armazém, orientações/encaminhamentos (várias), observações do
// profissional (com as frases-sugestão como atalhos), próximo contato e fotos com data (só se a família aceitar).
import { api, ErroApi } from '../api.js';
import { h, toast, abrirModal, mostrarErrosCampos, hojeIso } from '../ui.js';
import { campo } from './util.js';
import { blocoMetasDoRegistro } from './metas.js';
import { seletorFotosRegistro, enviarFotosRegistro, galeriaRegistro } from './registro-fotos.js';

export const ROTULO_SITUACAO = { MELHORANDO: 'Melhorando', IGUAL: 'Igual', PIORANDO: 'Piorando', NAO_SEI: 'Sem avaliação' };

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MAX_RESUMO = 2000;

// Pontos a observar do modelo oficial (ajuda recolhível ao lado das observações do profissional)
const PONTOS_A_OBSERVAR = [
  'Mudança na composição familiar',
  'Mudança na situação de segurança alimentar',
  'Acesso a benefícios/serviços públicos',
  'Mudança na frequência de utilização do Armazém',
  'Resistência da família em querer responder o questionário ou tirar foto',
  'Falta de um espaço reservado para fazer o acolhimento',
  'Outras mudanças relevantes',
];

const pluralDias = (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

export function somarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const rotuloMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;

// Meses disponíveis (AAAA-MM), do mês atual até o mês do início do acompanhamento, do mais novo ao mais antigo.
export function mesesDisponiveis(dataInicio, hoje, extra) {
  const lista = [];
  let [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  const [ai, mi] = dataInicio ? [Number(dataInicio.slice(0, 4)), Number(dataInicio.slice(5, 7))] : [a, m - 11];
  while ((a > ai || (a === ai && m >= mi)) && lista.length < 240) {
    lista.push(`${a}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  if (extra && !lista.includes(extra)) lista.push(extra);
  return lista;
}

function opcaoRadio(nome, valor, rotulo, marcado) {
  const entrada = h('input', { type: 'radio', name: nome, value: valor, checked: marcado });
  return h('label', { class: 'opcao' }, entrada, h('span', {}, rotulo));
}

function opcaoCaixa(nome, valor, rotulo, marcado) {
  const entrada = h('input', { type: 'checkbox', name: nome, value: valor, checked: marcado });
  return h('label', { class: 'opcao' }, entrada, h('span', {}, rotulo));
}

export function abrirFormularioRegistro({ id, dados, registro, aoSalvar }) {
  const editando = !!registro;
  const form = h('form', { class: 'fam-form-registro', novalidate: true });
  const hoje = hojeIso();
  const dataInicial = registro?.dataRegistro?.slice(0, 10) || hoje;

  // ----- quando: mês de referência e data -----
  const data = h('input', { class: 'input', type: 'date', id: 'rg-data', name: 'dataRegistro', value: dataInicial, max: hoje, required: true });
  if (dados.dataInicio) data.min = String(dados.dataInicio).slice(0, 10);

  const mesAtual = registro?.mesReferencia ? registro.mesReferencia.slice(0, 7) : dataInicial.slice(0, 7);
  const mes = h('select', { class: 'select', id: 'rg-mes', name: 'mesReferencia' },
    mesesDisponiveis(dados.dataInicio ? String(dados.dataInicio).slice(0, 10) : null, hoje, mesAtual)
      .map((ym) => h('option', { value: ym }, rotuloMes(ym))));
  mes.value = mesAtual;
  let mesEscolhido = editando; // enquanto a pessoa não mexe no mês, ele acompanha a data
  mes.addEventListener('change', () => { mesEscolhido = true; });

  // ----- contato realizado -----
  const tipo = h('select', { class: 'select', id: 'rg-tipo', name: 'tipoContatoId' },
    h('option', { value: '' }, 'Selecione'),
    dados.tiposContato.map((t) => h('option', { value: String(t.id), 'data-exige': t.exigeTexto ? '1' : '' }, t.nome)));
  tipo.value = registro?.tipoContatoId ? String(registro.tipoContatoId) : '';
  if (editando && tipo.value === '') { // tipo desativado depois do registro: mantém visível
    tipo.append(h('option', { value: String(registro.tipoContatoId) }, registro.tipoContato));
    tipo.value = String(registro.tipoContatoId);
  }
  const outro = h('input', { class: 'input', type: 'text', id: 'rg-outro', name: 'tipoContatoOutro', maxlength: 200, value: registro?.tipoContatoOutro || '', placeholder: 'Qual?' });
  const campoOutro = campo({ id: 'rg-outro', rotulo: 'Descreva o tipo de contato', obrigatorio: true, controle: outro });
  const exigeTexto = () => !!dados.tiposContato.find((t) => String(t.id) === tipo.value)?.exigeTexto
    || (editando && tipo.value === String(registro.tipoContatoId) && !!registro.tipoContatoOutro);
  const atualizarOutro = () => { campoOutro.hidden = !exigeTexto(); };

  const houveSim = registro ? registro.houveContato : true;
  const grupoFalou = h('div', { class: 'opcoes fam-opcoes-linha', role: 'radiogroup', 'aria-labelledby': 'rg-falou-rotulo' },
    opcaoRadio('houveContato', 'true', 'Sim', houveSim), opcaoRadio('houveContato', 'false', 'Não', !houveSim));
  const campoFalou = h('div', { class: 'campo' }, h('span', { class: 'rotulo obrigatorio', id: 'rg-falou-rotulo' }, 'Conseguiu falar com a família?'), grupoFalou);

  // ----- uso do Armazém -----
  const usos = dados.usosArmazem || [];
  const grupoUso = h('div', { class: 'opcoes', role: 'radiogroup', 'aria-labelledby': 'rg-uso-rotulo', id: 'rg-uso' },
    usos.map((u) => opcaoRadio('usoArmazemId', String(u.id), u.nome, registro?.usoArmazem?.id === u.id)),
    registro?.usoArmazem && !usos.some((u) => u.id === registro.usoArmazem.id)
      ? opcaoRadio('usoArmazemId', String(registro.usoArmazem.id), registro.usoArmazem.nome, true) : null);
  const campoUso = h('div', { class: 'campo' }, h('span', { class: 'rotulo', id: 'rg-uso-rotulo' }, 'Uso do Armazém'), grupoUso);

  // ----- orientações e encaminhamentos -----
  const orientacoes = dados.orientacoes || [];
  const marcadasAntes = new Set((registro?.orientacoes || []).map((o) => o.id));
  const caixas = h('div', { class: 'opcoes', id: 'rg-orientacoes' },
    orientacoes.map((o) => opcaoCaixa('orientacaoIds', String(o.id), o.nome, marcadasAntes.has(o.id))),
    (registro?.orientacoes || []).filter((o) => !orientacoes.some((x) => x.id === o.id)).map((o) => opcaoCaixa('orientacaoIds', String(o.id), o.nome, true)));
  const orientacaoOutro = h('input', { class: 'input', type: 'text', id: 'rg-orientacao-outro', name: 'orientacaoOutro', maxlength: 200, value: registro?.orientacaoOutro || '', placeholder: 'Qual orientação ou encaminhamento?' });
  const campoOrientacaoOutro = campo({ id: 'rg-orientacao-outro', rotulo: 'Descreva a outra orientação ou encaminhamento', obrigatorio: true, controle: orientacaoOutro });
  const campoOrientacoes = h('div', { class: 'campo' }, h('span', { class: 'rotulo', id: 'rg-orientacoes-rotulo' }, 'Orientações, encaminhamentos e outros'), caixas);
  const pedeOutro = () => {
    const ids = new Set([...form.querySelectorAll('input[name="orientacaoIds"]:checked')].map((c) => Number(c.value)));
    return [...orientacoes, ...(registro?.orientacoes || [])].some((o) => ids.has(o.id) && (o.exigeTexto ?? false));
  };
  const atualizarOrientacaoOutro = () => { campoOrientacaoOutro.hidden = !pedeOutro(); };

  // ----- situação -----
  const grupoSit = h('div', { class: 'opcoes fam-opcoes-linha', role: 'radiogroup', 'aria-labelledby': 'rg-sit-rotulo' },
    ['MELHORANDO', 'IGUAL', 'PIORANDO', 'NAO_SEI'].map((v) => opcaoRadio('situacao', v, ROTULO_SITUACAO[v], registro?.situacao === v)));
  const campoSit = h('div', { class: 'campo' }, h('span', { class: 'rotulo obrigatorio', id: 'rg-sit-rotulo' }, 'Como a família está?'), grupoSit);

  // ----- observações do profissional + frases-sugestão -----
  const resumo = h('textarea', { class: 'textarea', id: 'rg-resumo', name: 'resumo', maxlength: MAX_RESUMO, rows: 5, value: registro?.resumo || '' });
  resumo.value = registro?.resumo || '';
  const contador = h('span', { class: 'ajuda' });
  const contar = () => { contador.textContent = `${resumo.value.length} de ${MAX_RESUMO} caracteres`; };
  resumo.addEventListener('input', contar);
  const frases = dados.frases || [];
  const atalhos = frases.length
    ? h('div', { class: 'fam-frases', role: 'group', 'aria-label': 'Frases-sugestão' },
      h('span', { class: 'texto-pequeno texto-suave' }, 'Toque numa frase para inseri-la nas observações:'),
      h('div', { class: 'fam-frases-lista' }, frases.map((f) => h('button', {
        type: 'button', class: 'fam-frase',
        onclick: () => {
          const atual = resumo.value.trimEnd();
          const novo = atual ? `${atual}\n${f.nome}` : f.nome;
          if (novo.length > MAX_RESUMO) { toast.aviso('A frase não cabe: o limite das observações foi atingido.'); return; }
          resumo.value = novo; contar(); resumo.focus();
        },
      }, f.nome))))
    : null;
  const pontos = h('details', { class: 'fam-pontos' },
    h('summary', {}, 'Pontos a observar'),
    h('p', { class: 'texto-pequeno texto-suave' }, 'Registre fatos que ajudem a analisar a evolução da família ou que possam dificultar a meta, como:'),
    h('ul', { class: 'texto-pequeno' }, PONTOS_A_OBSERVAR.map((p) => h('li', {}, p))));
  const campoResumo = h('div', { class: 'campo' },
    h('label', { for: 'rg-resumo', class: 'obrigatorio' }, 'Observações do profissional'),
    atalhos, resumo, contador, pontos,
    h('span', { class: 'ajuda' }, 'Seja breve. Não registre detalhes de saúde nem de violência neste campo.'));

  const proximo = h('input', { class: 'input', type: 'date', id: 'rg-proximo', name: 'proximoContatoEm',
    value: editando ? (registro.proximoContatoEm?.slice(0, 10) || '') : somarDias(hoje, dados.semContatoDias) });
  const campoProximo = campo({ id: 'rg-proximo', rotulo: 'Próximo contato', ajuda: `Sugestão: daqui a ${pluralDias(dados.semContatoDias)}. Deixe em branco se não houver data.`, controle: proximo });

  const blocoMetas = blocoMetasDoRegistro(dados.metas, registro);

  // ----- fotos (só com o aceite da família) -----
  const aceita = h('input', { type: 'checkbox', name: 'familiaAceitaFoto', id: 'rg-aceita-foto', checked: !!registro?.familiaAceitaFoto });
  const fotosNovas = seletorFotosRegistro({ dataPadrao: dataInicial, max: hoje });
  const jaAnexadas = registro?.fotos || [];
  const baseFotos = `/api/familias/acompanhamentos/${id}/registros/${registro?.id}`;
  const areaFotos = h('div', { class: 'fam-fotos-area' },
    h('p', { class: 'texto-pequeno texto-suave' }, 'Cada foto leva a data do dia em que foi feito o acompanhamento.'),
    jaAnexadas.length ? galeriaRegistro(jaAnexadas, {
      remover: async (f) => {
        await api.delete(`${baseFotos}/fotos/${f.id}`);
        toast.sucesso('Foto excluída.');
      },
    }) : null,
    fotosNovas.elemento);
  const campoFotos = h('fieldset', { class: 'fam-fotos-campo' },
    h('legend', {}, 'Fotos'),
    h('label', { class: 'opcao' }, aceita, h('span', {}, 'A família aceitou fotos')),
    areaFotos);
  const atualizarFotos = () => { areaFotos.hidden = !aceita.checked; };
  aceita.addEventListener('change', atualizarFotos);

  const atualizarFalou = () => {
    const sim = form.elements.houveContato.value !== 'false';
    campoSit.hidden = !sim; campoUso.hidden = !sim; campoOrientacoes.hidden = !sim;
    blocoMetas.mostrar(sim);
    campoResumo.querySelector('label').classList.toggle('obrigatorio', sim);
    if (!sim) campoOrientacaoOutro.hidden = true; else atualizarOrientacaoOutro();
  };

  form.append(
    h('div', { class: 'fam-form-quando' },
      campo({ id: 'rg-mes', rotulo: 'Mês de referência', controle: mes }),
      campo({ id: 'rg-data', rotulo: 'Data do acompanhamento', obrigatorio: true, controle: data })),
    campo({ id: 'rg-tipo', rotulo: 'Contato/atendimento realizado', obrigatorio: true, controle: tipo }),
    campoOutro, campoFalou, campoUso, campoOrientacoes, campoOrientacaoOutro, campoSit, campoResumo,
    ...(blocoMetas.elemento ? [blocoMetas.elemento] : []), // sem metas em andamento não há bloco (append(null) escreveria "null" na tela)
    campoProximo, campoFotos);
  form.addEventListener('submit', (e) => e.preventDefault());
  tipo.addEventListener('change', atualizarOutro);
  data.addEventListener('change', () => {
    if (!mesEscolhido && data.value) {
      const ym = data.value.slice(0, 7);
      if (![...mes.options].some((o) => o.value === ym)) mes.append(h('option', { value: ym }, rotuloMes(ym)));
      mes.value = ym;
    }
    if (data.value) fotosNovas.definirDataPadrao(data.value);
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'houveContato') atualizarFalou();
    if (e.target.name === 'orientacaoIds') atualizarOrientacaoOutro();
  });
  atualizarOutro(); atualizarFalou(); contar(); atualizarFotos();

  const url = `/api/familias/acompanhamentos/${id}/registros`;
  abrirModal({
    titulo: editando ? 'Editar registro de contato' : 'Registrar contato',
    conteudo: form,
    botoes: [
      { texto: 'Cancelar', classe: 'btn btn-secundario' },
      {
        texto: 'Salvar',
        classe: 'btn',
        acao: async () => {
          const houve = form.elements.houveContato.value !== 'false';
          const ids = houve ? [...form.querySelectorAll('input[name="orientacaoIds"]:checked')].map((c) => Number(c.value)) : [];
          const uso = form.querySelector('input[name="usoArmazemId"]:checked');
          const corpo = {
            mesReferencia: mes.value || undefined,
            dataRegistro: data.value || undefined,
            tipoContatoId: tipo.value ? Number(tipo.value) : null,
            tipoContatoOutro: exigeTexto() ? outro.value.trim() || null : null,
            houveContato: houve,
            usoArmazemId: houve && uso ? Number(uso.value) : null,
            orientacaoIds: ids,
            orientacaoOutro: houve && pedeOutro() ? orientacaoOutro.value.trim() || null : null,
            situacao: houve ? form.elements.situacao.value || null : null,
            resumo: resumo.value.trim() || null,
            proximoContatoEm: proximo.value || null,
            familiaAceitaFoto: aceita.checked,
            metas: houve ? blocoMetas.valores() : [],
          };
          const fotos = aceita.checked ? fotosNovas.selecionadas() : [];
          if (fotos.some((f) => !f.data)) { toast.aviso('Informe a data de cada foto.'); return false; }
          let registroId = registro?.id;
          try {
            if (editando) await api.put(`${url}/${registro.id}`, corpo);
            else registroId = (await api.post(url, corpo)).id;
          } catch (e) {
            if (e instanceof ErroApi && e.status === 400) mostrarErrosCampos(form, e.detalhes); else toast.erro(e.message);
            return false;
          }
          if (fotos.length) {
            try {
              await enviarFotosRegistro(`${url}/${registroId}`, fotos);
            } catch (e) {
              toast.erro(`O registro foi salvo, mas as fotos não foram enviadas: ${e.message} Edite o registro para anexá-las.`);
              aoSalvar();
              return true;
            }
          }
          toast.sucesso(editando ? 'Registro atualizado.' : 'Contato registrado.');
          aoSalvar();
          return true;
        },
      },
    ],
  });
}
