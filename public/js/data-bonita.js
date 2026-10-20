// Calendário no visual do app: cada <input type="date"> vira um campo dd/mm/aaaa (digitável, com máscara) + calendário em painel.
// Melhoria progressiva: o <input type="date"> original continua no DOM (oculto) como fonte da verdade, com value ISO
// yyyy-mm-dd, name, required, min e max. Ao escolher/digitar uma data válida o value dele é atualizado e os eventos
// 'input' e 'change' são disparados, então o código que já ouve o input não muda.
//
// Aplicado sozinho a todo input[type=date] da página (inclusive os criados depois). Exceção: atributo data-nativo.
// Carregado por js/layout.js.

import { abrirExclusivo, liberar } from './painel-unico.js';

const ICONE_CALENDARIO = '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const ICONE_ANTERIOR = '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ICONE_PROXIMO = '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SEMANA = [['D', 'domingo'], ['S', 'segunda-feira'], ['T', 'terça-feira'], ['Q', 'quarta-feira'], ['Q', 'quinta-feira'], ['S', 'sexta-feira'], ['S', 'sábado']];
const ANO_MIN = 1900;
const ANO_MAX = 2200;
const LARGURA = 320;
const FOLGA = 8;

let contador = 0;
let iniciado = false;

// ---------- datas (sempre locais; ISO yyyy-mm-dd; mês 0-11) ----------
const dois = (n) => String(n).padStart(2, '0');
const isoDe = ({ y, m, d }) => `${String(y).padStart(4, '0')}-${dois(m + 1)}-${dois(d)}`;
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const hoje = () => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; };
const diasNoMes = (y, m) => new Date(y, m + 1, 0).getDate();
function ler(iso) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!p) return null;
  const y = Number(p[1]); const m = Number(p[2]) - 1; const d = Number(p[3]);
  return diasNoMes(y, m) >= d && d >= 1 && m >= 0 && m < 12 ? { y, m, d } : null;
}
function somarDias({ y, m, d }, n) {
  const t = new Date(y, m, d + n);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
function somarMeses({ y, m, d }, n) {
  const total = y * 12 + m + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return { y: ny, m: nm, d: Math.min(d, diasNoMes(ny, nm)) };
}
const anoValido = (y) => y >= ANO_MIN && y <= ANO_MAX;

function criar(tag, classe, atributos = {}) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
  return el;
}
const original = (prop) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop);

// "25122026" digitado -> "25/12/2026" (sem barra sobrando)
const mascarar = (digitos) => {
  const d = digitos.slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

function aprimorar(nativo) {
  if (nativo.dataset.db || 'nativo' in nativo.dataset) return;
  nativo.dataset.db = '1';
  const n = (contador += 1);

  const envoltorio = criar('div', 'db');
  const texto = criar('input', `${nativo.className} db-texto`.trim(), {
    type: 'text', inputmode: 'numeric', placeholder: 'dd/mm/aaaa', maxlength: '10', autocomplete: 'off', id: `db-${n}`,
  });
  const botao = criar('button', 'db-botao', { type: 'button', 'aria-label': 'Abrir calendário', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  botao.innerHTML = ICONE_CALENDARIO;
  const erro = criar('div', 'db-erro', { id: `db-erro-${n}`, role: 'alert' });
  erro.hidden = true;
  nativo.replaceWith(envoltorio);
  envoltorio.append(nativo, texto, botao, erro);
  nativo.classList.add('db-nativo');
  nativo.tabIndex = -1;
  nativo.setAttribute('aria-hidden', 'true');
  nativo.addEventListener('focus', () => texto.focus()); // foco vindo do input original (label, modal, validação) vai para o campo visível

  let painel = null;
  let sujo = false; // texto digitado ainda não confirmado
  let vista = 'dias'; // 'dias' | 'meses' | 'anos'
  let ano = 0;
  let mes = 0;
  let foco = null; // { y, m, d } dia com foco/seleção por teclado
  let origem = botao; // quem recebe o foco ao fechar
  let alturaNatural = 0;
  let corpo; let botaoMes; let botaoAno; let anterior; let proximo; let botaoHoje;

  // ---------- campo ----------
  const limites = () => ({ min: nativo.min || '', max: nativo.max || '' });
  const fora = (iso) => { const { min, max } = limites(); return (!!min && iso < min) || (!!max && iso > max); };

  function mostrarErro(mensagem) {
    erro.textContent = mensagem;
    erro.hidden = false;
    texto.setAttribute('aria-invalid', 'true');
    texto.setAttribute('aria-describedby', erro.id);
  }
  function limparErro() {
    erro.hidden = true;
    erro.textContent = '';
    texto.removeAttribute('aria-invalid');
    texto.removeAttribute('aria-describedby');
  }
  function definir(iso, emitir) {
    const mudou = nativo.value !== iso;
    original('value').set.call(nativo, iso);
    sujo = false;
    limparErro();
    texto.value = br(nativo.value);
    if (mudou && emitir) {
      nativo.dispatchEvent(new Event('input', { bubbles: true }));
      nativo.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function mensagemLimites() {
    const { min, max } = limites();
    if (min && max) return `Escolha uma data entre ${br(min)} e ${br(max)}.`;
    return min ? `Escolha uma data a partir de ${br(min)}.` : `Escolha uma data até ${br(max)}.`;
  }
  // Valida o que foi digitado ao sair do campo (ou Enter): vazio limpa; inválida/fora do período limpa o valor e avisa
  function confirmar() {
    if (!sujo) return;
    const digitos = texto.value.replace(/\D/g, '');
    if (!digitos) { definir('', true); return; }
    const dia = Number(digitos.slice(0, 2)); const mesDigitado = Number(digitos.slice(2, 4)); const anoDigitado = Number(digitos.slice(4));
    const data = digitos.length === 8 && anoValido(anoDigitado) ? ler(isoDe({ y: anoDigitado, m: mesDigitado - 1, d: dia })) : null;
    if (!data) {
      const digitado = texto.value;
      definir('', true);
      texto.value = digitado; // mantém o que foi digitado para a pessoa corrigir
      sujo = true;
      mostrarErro('Data inválida. Digite dia/mês/ano, por exemplo 25/12/2026.');
      return;
    }
    const iso = isoDe(data);
    if (fora(iso)) {
      definir('', true);
      texto.value = br(iso);
      sujo = true;
      mostrarErro(mensagemLimites());
      return;
    }
    definir(iso, true);
  }
  function atualizar() {
    if (!sujo) { texto.value = br(nativo.value); limparErro(); } // não apaga o que a pessoa está digitando (ou o texto com erro)
    texto.disabled = nativo.disabled;
    texto.readOnly = nativo.readOnly;
    texto.required = nativo.required;
    botao.disabled = nativo.disabled || nativo.readOnly;
    const rotulos = [...(nativo.labels || [])].map((l, i) => l.id || (l.id = `db-rot-${n}-${i}`));
    if (nativo.getAttribute('aria-label')) texto.setAttribute('aria-label', nativo.getAttribute('aria-label'));
    else if (rotulos.length) texto.setAttribute('aria-labelledby', rotulos.join(' '));
    if (painel) desenhar(false);
  }
  // value atribuído pelo código da página (ex.: botão "Limpar") não dispara evento: reflete na hora
  Object.defineProperty(nativo, 'value', {
    configurable: true,
    get() { return original('value').get.call(this); },
    set(v) { original('value').set.call(this, v); sujo = false; atualizar(); },
  });
  new MutationObserver(atualizar).observe(nativo, { attributes: true, attributeFilter: ['disabled', 'required', 'readonly', 'min', 'max', 'value'] });
  nativo.form?.addEventListener('reset', () => setTimeout(atualizar));

  texto.addEventListener('input', (e) => {
    e.stopPropagation(); // quem ouve o formulário só deve ver o input original
    const antes = texto.selectionStart ?? texto.value.length;
    const digitosAntes = texto.value.slice(0, antes).replace(/\D/g, '').length;
    const formatado = mascarar(texto.value.replace(/\D/g, ''));
    texto.value = formatado;
    let pos = 0; let contados = 0;
    while (pos < formatado.length && contados < digitosAntes) { if (/\d/.test(formatado[pos])) contados += 1; pos += 1; }
    texto.setSelectionRange(pos, pos);
    sujo = true;
    if (erro.hidden === false) limparErro();
    if (formatado.length === 10) confirmar();
  });
  texto.addEventListener('change', (e) => e.stopPropagation());
  texto.addEventListener('blur', confirmar);
  texto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmar(); // sem preventDefault: o Enter ainda envia o formulário, já com a data confirmada
    else if (e.key === 'ArrowDown') { e.preventDefault(); confirmar(); abrir(texto); }
  });

  // ---------- painel ----------
  function nomeMes(i) { return MESES[i][0].toUpperCase() + MESES[i].slice(1); }

  function celula(texto_, { classe = '', rotulo, selecionada = false, desabilitada = false, focada = false, aoClicar }) {
    const b = criar('button', `db-cel ${classe}`.trim(), { type: 'button', role: 'gridcell', tabindex: focada ? '0' : '-1', 'data-cel': '1' });
    b.textContent = texto_;
    if (rotulo) b.setAttribute('aria-label', rotulo);
    b.setAttribute('aria-selected', String(selecionada));
    if (desabilitada) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (!desabilitada) aoClicar(); });
    return b;
  }
  function linhas(celulas, porLinha, classe) {
    const grade = criar('div', classe, { role: 'grid' });
    for (let i = 0; i < celulas.length; i += porLinha) {
      const linha = criar('div', 'db-linha', { role: 'row' });
      linha.append(...celulas.slice(i, i + porLinha));
      grade.append(linha);
    }
    return grade;
  }

  function desenhar(focar) {
    if (!painel) return;
    const { min, max } = limites();
    const selecionado = nativo.value;
    const h = isoDe(hoje());
    corpo.replaceChildren();
    botaoMes.hidden = vista === 'anos';
    botaoMes.textContent = nomeMes(mes);
    const inicioAnos = ano - (((ano % 12) + 12) % 12);
    botaoAno.textContent = vista === 'anos' ? `${inicioAnos} – ${inicioAnos + 11}` : String(ano);
    botaoAno.setAttribute('aria-label', vista === 'anos' ? 'Escolher ano' : `Ano ${ano}, escolher ano`);
    botaoMes.setAttribute('aria-label', `Mês ${MESES[mes]}, escolher mês`);

    let anteriorFora; let proximoFora;
    if (vista === 'dias') {
      const grade = [];
      const primeiro = new Date(ano, mes, 1).getDay();
      SEMANA.forEach(([curto, longo]) => grade.push(Object.assign(criar('div', 'db-semana', { role: 'columnheader', 'aria-label': longo }), { textContent: curto })));
      const cabecalho = criar('div', 'db-linha', { role: 'row' });
      cabecalho.append(...grade);
      const celulas = [];
      for (let i = 0; i < 42; i++) {
        const dia = somarDias({ y: ano, m: mes, d: 1 }, i - primeiro);
        const iso = isoDe(dia);
        const classes = [dia.m !== mes ? 'db-outro' : '', iso === h ? 'db-hoje' : '', iso === selecionado ? 'db-sel' : '', fora(iso) ? 'db-fora' : ''].filter(Boolean).join(' ');
        celulas.push(celula(String(dia.d), {
          classe: classes, selecionada: iso === selecionado, desabilitada: fora(iso), focada: foco && iso === isoDe(foco),
          rotulo: `${dia.d} de ${MESES[dia.m]} de ${dia.y}${iso === h ? ', hoje' : ''}`,
          aoClicar: () => escolher(iso),
        }));
      }
      const gradeDias = linhas(celulas, 7, 'db-dias');
      gradeDias.setAttribute('aria-label', `${nomeMes(mes)} de ${ano}`);
      gradeDias.prepend(cabecalho);
      corpo.append(gradeDias);
      const ant = somarMeses({ y: ano, m: mes, d: 1 }, -1);
      anteriorFora = !!min && isoDe({ y: ant.y, m: ant.m, d: diasNoMes(ant.y, ant.m) }) < min;
      const prox = somarMeses({ y: ano, m: mes, d: 1 }, 1);
      proximoFora = !!max && isoDe({ y: prox.y, m: prox.m, d: 1 }) > max;
      anterior.setAttribute('aria-label', 'Mês anterior');
      proximo.setAttribute('aria-label', 'Próximo mês');
    } else if (vista === 'meses') {
      const celulas = MESES_CURTOS.map((nome, i) => {
        const primeiroDia = isoDe({ y: ano, m: i, d: 1 });
        const ultimoDia = isoDe({ y: ano, m: i, d: diasNoMes(ano, i) });
        const desabilitada = (!!min && ultimoDia < min) || (!!max && primeiroDia > max);
        return celula(nome, {
          classe: 'db-cel-grande', desabilitada, selecionada: i === mes, focada: i === mes, rotulo: `${nomeMes(i)} de ${ano}`,
          aoClicar: () => { mes = i; foco = { y: ano, m: mes, d: Math.min(foco.d, diasNoMes(ano, mes)) }; vista = 'dias'; desenhar(true); },
        });
      });
      corpo.append(linhas(celulas, 3, 'db-meses'));
      anteriorFora = !!min && `${ano - 1}-12-31` < min;
      proximoFora = !!max && `${ano + 1}-01-01` > max;
      anterior.setAttribute('aria-label', 'Ano anterior');
      proximo.setAttribute('aria-label', 'Próximo ano');
    } else {
      const celulas = Array.from({ length: 12 }, (_, i) => {
        const y = inicioAnos + i;
        const desabilitada = !anoValido(y) || (!!min && `${y}-12-31` < min) || (!!max && `${y}-01-01` > max);
        return celula(String(y), {
          classe: `db-cel-grande ${y === hoje().y ? 'db-hoje' : ''}`, desabilitada, selecionada: y === ano, focada: y === ano, rotulo: `Ano ${y}`,
          aoClicar: () => { ano = y; foco = { y: ano, m: mes, d: Math.min(foco.d, diasNoMes(ano, mes)) }; vista = 'dias'; desenhar(true); },
        });
      });
      corpo.append(linhas(celulas, 4, 'db-anos'));
      anteriorFora = !!min && `${inicioAnos - 1}-12-31` < min;
      proximoFora = !!max && `${inicioAnos + 12}-01-01` > max;
      anterior.setAttribute('aria-label', '12 anos anteriores');
      proximo.setAttribute('aria-label', 'Próximos 12 anos');
    }
    anterior.disabled = anteriorFora || (vista === 'anos' ? inicioAnos - 12 < ANO_MIN : false) || (vista !== 'anos' && ano <= ANO_MIN && (vista === 'meses' || mes === 0));
    proximo.disabled = proximoFora || (vista === 'anos' ? inicioAnos + 12 > ANO_MAX : false) || (vista !== 'anos' && ano >= ANO_MAX && (vista === 'meses' || mes === 11));
    botaoHoje.disabled = fora(h);
    if (focar) corpo.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
    posicionar();
  }

  function escolher(iso) {
    if (fora(iso)) return;
    fechar(origem);
    definir(iso, true);
  }

  function navegar(passo) {
    if (vista === 'dias') { const p = somarMeses({ y: ano, m: mes, d: 1 }, passo); ano = p.y; mes = p.m; }
    else if (vista === 'meses') ano += passo;
    else ano += passo * 12;
    foco = { y: ano, m: mes, d: Math.min(foco.d, diasNoMes(ano, mes)) };
    desenhar(false);
  }

  function posicionar() {
    if (!painel) return;
    if (!envoltorio.isConnected) { fechar(false); return; }
    const r = envoltorio.getBoundingClientRect();
    let limite = innerHeight;
    const menu = document.querySelector('.app-menu'); // menu inferior do celular cobre o rodapé
    if (menu) {
      const m = menu.getBoundingClientRect();
      if (m.top > innerHeight / 2 && m.height < innerHeight / 2) limite = m.top;
    }
    const largura = Math.min(LARGURA, innerWidth - 2 * FOLGA);
    painel.style.width = `${largura}px`;
    painel.style.left = `${Math.min(Math.max(FOLGA, r.left), innerWidth - largura - FOLGA)}px`;
    painel.style.setProperty('--db-altura', 'none');
    const natural = painel.offsetHeight;
    alturaNatural = natural;
    const abaixo = limite - r.bottom - FOLGA;
    const acima = r.top - FOLGA;
    const paraCima = abaixo < natural && acima > abaixo;
    painel.style.setProperty('--db-altura', `${Math.max(200, Math.floor(paraCima ? acima : abaixo))}px`);
    painel.classList.toggle('cima', paraCima);
    if (paraCima) { painel.style.top = 'auto'; painel.style.bottom = `${innerHeight - r.top + 4}px`; }
    else { painel.style.bottom = 'auto'; painel.style.top = `${r.bottom + 4}px`; }
  }

  function aoRolar(e) {
    if (!painel || painel.contains(e.target)) return;
    const r = envoltorio.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { fechar(false); return; }
    posicionar();
  }
  function aoRedimensionar() { posicionar(); }
  function aoClicarFora(e) {
    if (!painel.contains(e.target) && !botao.contains(e.target)) fechar(false);
  }

  function abrir(quem) {
    if (painel || nativo.disabled || nativo.readOnly) return;
    abrirExclusivo(fechar);
    origem = quem;
    const { min, max } = limites();
    const h = hoje();
    foco = ler(nativo.value) || h;
    if (!ler(nativo.value)) {
      if (min && isoDe(foco) < min) foco = ler(min) || foco;
      if (max && isoDe(foco) > max) foco = ler(max) || foco;
    }
    ano = foco.y; mes = foco.m; vista = 'dias';

    painel = criar('div', 'db-painel', { role: 'dialog', 'aria-label': 'Escolher data' });
    anterior = criar('button', 'db-nav', { type: 'button' });
    anterior.innerHTML = ICONE_ANTERIOR;
    proximo = criar('button', 'db-nav', { type: 'button' });
    proximo.innerHTML = ICONE_PROXIMO;
    botaoMes = criar('button', 'db-titulo-botao', { type: 'button' });
    botaoAno = criar('button', 'db-titulo-botao', { type: 'button' });
    const titulo = criar('div', 'db-titulo', { 'aria-live': 'polite' });
    titulo.append(botaoMes, botaoAno);
    const cabecalho = criar('div', 'db-cab');
    cabecalho.append(anterior, titulo, proximo);
    corpo = criar('div', 'db-corpo');
    botaoHoje = criar('button', 'db-acao', { type: 'button' });
    botaoHoje.textContent = 'Hoje';
    const rodape = criar('div', 'db-rodape');
    rodape.append(botaoHoje);
    if (!nativo.required) {
      const limpar = criar('button', 'db-acao db-acao-limpar', { type: 'button' });
      limpar.textContent = 'Limpar';
      limpar.addEventListener('click', () => { fechar(origem); definir('', true); });
      rodape.append(limpar);
    }
    painel.append(cabecalho, corpo, rodape);
    for (const b of [anterior, proximo, botaoMes, botaoAno, botaoHoje]) b.addEventListener('mousedown', (e) => e.preventDefault());
    anterior.addEventListener('click', () => navegar(-1));
    proximo.addEventListener('click', () => navegar(1));
    botaoMes.addEventListener('click', () => { vista = vista === 'meses' ? 'dias' : 'meses'; desenhar(true); });
    botaoAno.addEventListener('click', () => { vista = vista === 'anos' ? 'dias' : 'anos'; desenhar(true); });
    botaoHoje.addEventListener('click', () => escolher(isoDe(hoje())));
    painel.addEventListener('keydown', aoTeclar);

    document.body.append(painel);
    botao.setAttribute('aria-expanded', 'true');
    desenhar(true);
    // sem espaço nem acima nem abaixo (celular): rola a página para deixar o campo no alto e o calendário embaixo
    if (painel.offsetHeight < alturaNatural - 1 && document.scrollingElement.scrollHeight > innerHeight) {
      const r = envoltorio.getBoundingClientRect();
      if (r.top > 100) { scrollBy(0, r.top - 90); posicionar(); }
    }
    requestAnimationFrame(() => painel?.classList.add('aberto'));
    document.addEventListener('pointerdown', aoClicarFora, true);
    addEventListener('scroll', aoRolar, true);
    addEventListener('resize', aoRedimensionar);
  }

  function fechar(devolverFoco = origem) {
    if (!painel) return;
    document.removeEventListener('pointerdown', aoClicarFora, true);
    removeEventListener('scroll', aoRolar, true);
    removeEventListener('resize', aoRedimensionar);
    painel.remove();
    painel = null;
    botao.setAttribute('aria-expanded', 'false');
    liberar(fechar);
    if (devolverFoco) devolverFoco.focus({ preventScroll: true });
  }

  // ---------- teclado ----------
  function mover(novo) {
    if (!anoValido(novo.y)) return;
    foco = novo; ano = novo.y; mes = novo.m;
    desenhar(true);
  }
  function aoTeclar(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(origem); return; } // não fecha o modal por baixo
    if (k === 'Tab') { fechar(botao); return; } // o Tab segue do botão para o próximo campo
    if (!e.target.closest('[data-cel]')) return; // setas só valem sobre as células
    const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: vista === 'dias' ? -7 : vista === 'meses' ? -3 : -4, ArrowDown: vista === 'dias' ? 7 : vista === 'meses' ? 3 : 4 };
    if (k in passos) {
      e.preventDefault();
      if (vista === 'dias') mover(somarDias(foco, passos[k]));
      else if (vista === 'meses') {
        const i = mes + passos[k];
        if (i >= 0 && i < 12) { mes = i; foco = { y: ano, m: mes, d: Math.min(foco.d, diasNoMes(ano, mes)) }; desenhar(true); }
      } else {
        const novo = ano + passos[k];
        if (anoValido(novo)) { ano = novo; foco = { y: ano, m: mes, d: Math.min(foco.d, diasNoMes(ano, mes)) }; desenhar(true); }
      }
    } else if (vista === 'dias' && (k === 'PageUp' || k === 'PageDown')) {
      e.preventDefault();
      mover(somarMeses(foco, (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1)));
    } else if (vista === 'dias' && (k === 'Home' || k === 'End')) {
      e.preventDefault();
      const dow = new Date(foco.y, foco.m, foco.d).getDay();
      mover(somarDias(foco, k === 'Home' ? -dow : 6 - dow));
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      e.target.closest('[data-cel]').click();
    }
  }

  botao.addEventListener('click', () => { if (painel) fechar(botao); else { confirmar(); abrir(botao); } });
  atualizar();
}

function varrer(no) {
  if (no.nodeType !== 1) return;
  if (no.matches('input[type="date"]')) aprimorar(no);
  no.querySelectorAll('input[type="date"]').forEach(aprimorar);
}

export function iniciarDatasBonitas() {
  if (iniciado) return;
  iniciado = true;
  varrer(document.body);
  new MutationObserver((mutacoes) => {
    for (const m of mutacoes) m.addedNodes.forEach(varrer);
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarDatasBonitas);
else iniciarDatasBonitas();
