// Gráficos em SVG gerado em JS puro (sem bibliotecas). Cores vêm de classes em painel.css
// (que usam as variáveis de tokens.css), então acompanham o tema. Texto sempre via textContent.

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, atributos = {}, ...filhos) {
  const no = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(atributos)) if (v !== undefined && v !== null) no.setAttribute(k, v);
  for (const f of filhos) if (f) no.append(f);
  return no;
}

function texto(conteudo, atributos) {
  const t = svg('text', atributos);
  t.textContent = conteudo;
  return t;
}

const fmt = (n) => Number(n).toLocaleString('pt-BR');

// Escala "bonita": maior valor arredondado para cima com ~4 divisões.
function escala(max) {
  if (max <= 0) return { topo: 4, passo: 1 };
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
  return { topo: Math.ceil(max / passo) * passo, passo };
}

function legenda(series) {
  const el = document.createElement('ul');
  el.className = 'grafico-legenda';
  series.forEach((s, i) => {
    const li = document.createElement('li');
    const marca = document.createElement('span');
    marca.className = `grafico-marca s${i % 4}`;
    li.append(marca, document.createTextNode(s.nome));
    el.append(li);
  });
  return el;
}

function moldura(titulo, desc, grafico, series) {
  const fig = document.createElement('figure');
  fig.className = 'grafico';
  grafico.setAttribute('role', 'img');
  grafico.setAttribute('aria-label', titulo);
  grafico.append(svg('title', {}), svg('desc', {}));
  grafico.querySelector('title').textContent = titulo;
  grafico.querySelector('desc').textContent = desc;
  fig.append(grafico);
  if (series && series.length > 1) fig.append(legenda(series));
  return fig;
}

function descricaoTabela(categorias, series) {
  return categorias.map((c, i) => `${c}: ${series.map((s) => `${s.nome} ${fmt(s.valores[i] ?? 0)}`).join(', ')}`).join('; ');
}

// Eixo Y + grade. Retorna a função de conversão valor -> y.
function eixoY(g, { esq, dir, topo, base, max }) {
  const { topo: vTopo, passo } = escala(max);
  const y = (v) => base - (v / vTopo) * (base - topo);
  for (let v = 0; v <= vTopo + 1e-9; v += passo) {
    g.append(
      svg('line', { x1: esq, x2: dir, y1: y(v), y2: y(v), class: v === 0 ? 'g-eixo' : 'g-grade' }),
      texto(fmt(v), { x: esq - 6, y: y(v) + 4, class: 'g-rotulo', 'text-anchor': 'end' }),
    );
  }
  return y;
}

// Barras agrupadas: categorias no eixo X, uma barra por série.
export function barras({ titulo, categorias, series, altura = 260 }) {
  const L = 640; const esq = 44; const dir = L - 8; const topo = 12; const base = altura - 30;
  const max = Math.max(0, ...series.flatMap((s) => s.valores));
  const g = svg('svg', { viewBox: `0 0 ${L} ${altura}`, class: 'grafico-svg', preserveAspectRatio: 'xMidYMid meet' });
  const y = eixoY(g, { esq, dir, topo, base, max });
  const larguraCat = (dir - esq) / Math.max(1, categorias.length);
  const larguraBarra = Math.min(34, (larguraCat * 0.8) / series.length);
  categorias.forEach((cat, i) => {
    const x0 = esq + larguraCat * i + (larguraCat - larguraBarra * series.length) / 2;
    series.forEach((s, j) => {
      const v = s.valores[i] ?? 0;
      const barra = svg('rect', { x: x0 + larguraBarra * j, y: y(v), width: Math.max(1, larguraBarra - 2), height: Math.max(0, base - y(v)), rx: 2, class: `g-s${j % 4}` });
      barra.append(svg('title'));
      barra.firstChild.textContent = `${cat} — ${s.nome}: ${fmt(v)}`;
      g.append(barra);
      if (categorias.length <= 8 && v > 0) {
        g.append(texto(fmt(v), { x: x0 + larguraBarra * j + (larguraBarra - 2) / 2, y: y(v) - 4, class: 'g-valor', 'text-anchor': 'middle' }));
      }
    });
    g.append(texto(cat, { x: esq + larguraCat * i + larguraCat / 2, y: base + 18, class: 'g-rotulo', 'text-anchor': 'middle' }));
  });
  return moldura(titulo, descricaoTabela(categorias, series), g, series);
}

// Linhas: categorias (meses) no eixo X, uma linha por série.
export function linhas({ titulo, categorias, series, altura = 260 }) {
  const L = 640; const esq = 44; const dir = L - 14; const topo = 14; const base = altura - 30;
  const max = Math.max(0, ...series.flatMap((s) => s.valores));
  const g = svg('svg', { viewBox: `0 0 ${L} ${altura}`, class: 'grafico-svg', preserveAspectRatio: 'xMidYMid meet' });
  const y = eixoY(g, { esq, dir, topo, base, max });
  const passoX = categorias.length > 1 ? (dir - esq) / (categorias.length - 1) : 0;
  const x = (i) => (categorias.length > 1 ? esq + passoX * i : (esq + dir) / 2);
  // rótulos do eixo X: no máximo ~8 para caber no celular
  const salto = Math.ceil(categorias.length / 8);
  categorias.forEach((cat, i) => {
    if (i % salto === 0) g.append(texto(cat, { x: x(i), y: base + 18, class: 'g-rotulo', 'text-anchor': 'middle' }));
  });
  series.forEach((s, j) => {
    const pontos = s.valores.map((v, i) => `${x(i)},${y(v ?? 0)}`).join(' ');
    g.append(svg('polyline', { points: pontos, class: `g-linha g-l${j % 4}`, fill: 'none' }));
    s.valores.forEach((v, i) => {
      const c = svg('circle', { cx: x(i), cy: y(v ?? 0), r: 3.5, class: `g-ponto g-s${j % 4}` });
      c.append(svg('title'));
      c.firstChild.textContent = `${categorias[i]} — ${s.nome}: ${fmt(v ?? 0)}`;
      g.append(c);
    });
  });
  return moldura(titulo, descricaoTabela(categorias, series), g, series);
}

// Barras horizontais para distribuições (rótulo acima da barra: legível no celular).
// itens: [{ nome, quantidade }]; total opcional para mostrar o percentual.
export function distribuicao({ titulo, itens, total, vazio = 'Sem dados no período.' }) {
  const cartao = document.createElement('section');
  cartao.className = 'card dist';
  const h3 = document.createElement('h3');
  h3.textContent = titulo;
  cartao.append(h3);
  if (!itens.length) {
    const p = document.createElement('p');
    p.className = 'texto-suave texto-pequeno';
    p.textContent = vazio;
    cartao.append(p);
    return cartao;
  }
  const max = Math.max(...itens.map((i) => i.quantidade), 1);
  const soma = total ?? itens.reduce((s, i) => s + i.quantidade, 0);
  const L = 400; const alturaLinha = 38;
  const g = svg('svg', { viewBox: `0 0 ${L} ${alturaLinha * itens.length}`, class: 'grafico-svg' });
  itens.forEach((it, i) => {
    const y0 = i * alturaLinha;
    const pct = soma > 0 ? ` (${((it.quantidade / soma) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : '';
    g.append(
      texto(it.nome, { x: 0, y: y0 + 13, class: 'g-rotulo g-rotulo-forte' }),
      svg('rect', { x: 0, y: y0 + 18, width: Math.max(2, (it.quantidade / max) * (L - 90)), height: 12, rx: 3, class: 'g-s0' }),
      texto(`${fmt(it.quantidade)}${pct}`, { x: Math.max(2, (it.quantidade / max) * (L - 90)) + 6, y: y0 + 29, class: 'g-valor' }),
    );
  });
  g.setAttribute('role', 'img');
  g.setAttribute('aria-label', `${titulo}: ${itens.map((i) => `${i.nome} ${fmt(i.quantidade)}`).join('; ')}`);
  cartao.append(g);
  return cartao;
}
