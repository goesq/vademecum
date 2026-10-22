"use strict";
/* Vade Mecum Aberto
   Um só código para duas versões, escolhidas pela meta vm-modo:
   - "artifact": página no claude.ai; grifos na conta (db) quando disponível.
   - "site":     GitHub Pages; instalável, offline, grifos no aparelho com backup em arquivo. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const config = n => document.querySelector(`meta[name="vm-${n}"]`)?.content;

const VERSAO = config("versao") || "dev";
const SITE = config("modo") === "site";
const GRUPOS = ["Constituição", "Códigos", "Estatutos e leis"];
const CORES = ["amarelo", "verde", "rosa", "azul"];
const COR_SUMULAS = "#4b5563";
const NOME_TRIB = { SV: "vinculante", STF: "do STF", STJ: "do STJ" };

const principal = $("#principal");
const st = {
  meta: null, indice: [], leis: {}, sumulas: null, marcas: {},
  vista: null, voltarPara: null, notas: true,
  sumTrib: "SV", sumCanc: false, sumFiltro: "", buscaFiltro: null, offline: false,
};

/* ================================================================ utilidades */

function ler(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); } catch { return padrao; }
}
function gravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* armazenamento bloqueado */ }
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// tira acentos e põe em minúsculas sem mudar o comprimento, para casar posições no trecho
function norm(s) {
  let o = "";
  for (const c of s.toLowerCase()) o += c.normalize("NFD")[0];
  return o;
}
function plano(s) {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
}
const lei = id => st.indice.find(l => l.id === id);
const dataBR = iso => iso.split("-").reverse().join("/");
const numBR = n => n.toLocaleString("pt-BR");
const plural = (n, um, varios) => `${numBR(n)} ${n === 1 ? um : varios}`;

/* ================================================================ texto legal em HTML */

function fmt(s) {
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/\*\((.+?)\)\*/g, (_, t) => {
    const rev = t.match(/^((?:Revogad|Vetad)[oa]s?)(.*)$/s);
    return rev
      ? `<span class="nota nota--rev">(${rev[1]}<span class="nota__longo">${rev[2]}</span>)</span>`
      : `<span class="nota">(${t})</span>`;
  });
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, "$1<i>$2</i>");
  return h;
}
const RUBRICA = /^\*\*(?!§|Parágrafo|"?Art)[^*]{2,120}\*\*(\s*\*\(.*\)\*)?$/;
function classeParagrafo(p) {
  if (RUBRICA.test(p)) return "rubrica";
  if (/^\*\*(§|Parágrafo)/.test(p)) return "par";
  if (/^[IVXLCDM]+\s*[-–—]/.test(p)) return "inc";
  if (/^[a-z]\)/.test(p)) return "ali";
  if (/^\d+\.\s/.test(p)) return "item-n";
  return "";
}
function rotuloArt(n) {
  const limpo = n.replace(/\./g, "");
  return "Art. " + n + (/^\d+$/.test(limpo) && +limpo < 10 ? "º" : ".");
}
function classesMarca(m, extra = []) {
  return ["art", ...extra, m?.c ? "art--" + m.c : "", m?.f ? "art--fav" : ""].filter(Boolean).join(" ");
}
function botaoArt(rotulo) {
  return `<button class="art__n" aria-expanded="false"><span class="art__estrela" aria-label="Favorito">★</span>${esc(rotulo)}</button>`;
}
function htmlAnotacao(m) {
  return m?.nota ? `<div class="anotacao">${esc(m.nota)}</div>` : "";
}
function htmlArt(leiId, n, m) {
  const corpo = n.p.map((p, i) => i === 0
    ? `<p>${botaoArt(rotuloArt(n.n))} ${fmt(p.replace(/^\*\*"?Art\.?[^*]*\*\*\s*\.?\s*/, ""))}</p>`
    : `<p class="${classeParagrafo(p)}">${fmt(p)}</p>`).join("");
  return `<article class="${classesMarca(m)}" id="a-${leiId}-${n.id}" data-lei="${leiId}" data-id="${n.id}">${corpo}${htmlAnotacao(m)}</article>`;
}
function idSumula(s) { return s.tr + "-" + s.n; }
function rotuloSumula(s) { return s.tr === "SV" ? `Súmula Vinculante ${s.n}` : `Súmula ${s.n} do ${s.tr}`; }
function htmlSumula(s, m) {
  const id = idSumula(s);
  const rot = s.tr === "SV" ? `SV ${s.n}` : `Súmula ${s.n}`;
  return `<article class="${classesMarca(m, s.cancelada ? ["art--cancelada"] : [])}" id="a-sumulas-${id}" data-lei="sumulas" data-id="${id}">`
    + (s.assunto ? `<span class="art__assunto">${esc(s.assunto)}</span>` : "")
    + `<p>${botaoArt(rot)}${s.cancelada ? '<span class="art__tag">cancelada</span>' : ""} ${esc(s.x)}</p>${htmlAnotacao(m)}</article>`;
}
function htmlSelo(id) {
  const L = lei(id);
  return `<span class="selo" style="--cor:${L ? L.cor : COR_SUMULAS}">${esc(L ? L.sigla : "Súmula")}</span>`;
}

/* ================================================================ dados */

async function buscarJson(caminho) {
  const r = await fetch(`${caminho}?v=${VERSAO}`);
  if (!r.ok) throw new Error(caminho);
  return r.json();
}
async function carregarLei(id) {
  return (st.leis[id] ||= await buscarJson(`dados/${id}.json`));
}
async function carregarSumulas() {
  return (st.sumulas ||= await buscarJson("dados/sumulas.json"));
}

/* ================================================================ grifos: conta (db) ou aparelho */

const arm = { modo: "local", db: null, uid: null, voando: {}, pendente: {}, timers: {} };

function salvarMarcas(leiId) {
  if (arm.modo === "local") { gravar("vm-marcas", st.marcas); return; }
  clearTimeout(arm.timers[leiId]);
  arm.timers[leiId] = setTimeout(() => { delete arm.timers[leiId]; escreverNaConta(leiId); }, 700);
}
async function escreverNaConta(leiId, tentativa = 0) {
  if (arm.modo !== "conta") return;
  if (arm.voando[leiId]) { arm.pendente[leiId] = true; return; }
  arm.voando[leiId] = true;
  try {
    await arm.db.collection("data/users/" + arm.uid).doc(leiId).set({ arts: st.marcas[leiId] || {} });
  } catch (e) {
    arm.voando[leiId] = false;
    if (e?.code === "unavailable" && tentativa === 0) setTimeout(() => escreverNaConta(leiId, 1), 800 + Math.random() * 1200);
    else voltarParaAparelho();
    return;
  }
  arm.voando[leiId] = false;
  if (arm.pendente[leiId]) { arm.pendente[leiId] = false; escreverNaConta(leiId); }
}
function voltarParaAparelho() {
  if (arm.modo === "local") return;
  arm.modo = "local";
  gravar("vm-marcas", st.marcas);
  mostrarStatus();
}
async function conectarConta() {
  if (SITE || !window.claude?.use) return;
  try {
    const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
    const uid = await user?.id();
    if (!db || !uid) return;
    Object.assign(arm, { db, uid, modo: "conta" });
    let primeiro = true;
    db.collection("data/users/" + uid).onSnapshot(snap => {
      const novo = {};
      snap.docs.forEach(d => { const a = d.data()?.arts; if (a) novo[d.id] = structuredClone(a); });
      const sujos = new Set();
      if (primeiro) {
        primeiro = false;
        // o que foi grifado antes neste navegador sobe para a conta
        for (const [l, arts] of Object.entries(ler("vm-marcas", {}))) {
          for (const [a, m] of Object.entries(arts)) {
            novo[l] ||= {};
            if ((novo[l][a]?.t || 0) < (m.t || 0)) { novo[l][a] = m; sujos.add(l); }
          }
        }
        try { localStorage.removeItem("vm-marcas"); } catch { /* sem armazenamento */ }
      }
      // não atropela edições que ainda não foram gravadas
      for (const l of Object.keys(st.marcas)) if (arm.timers[l] || arm.voando[l]) novo[l] = st.marcas[l];
      st.marcas = novo;
      sujos.forEach(l => escreverNaConta(l));
      aplicarMarcas();
      mostrarStatus();
    }, voltarParaAparelho);
    mostrarStatus();
  } catch { /* continua salvando no aparelho */ }
}

const marca = (leiId, id) => st.marcas[leiId]?.[id];
function mudarMarca(leiId, id, mudanca) {
  const doc = (st.marcas[leiId] ||= {});
  const m = { ...doc[id], ...mudanca, t: Date.now() };
  for (const k of ["c", "f", "nota"]) if (!m[k]) delete m[k];
  if (m.c || m.f || m.nota) doc[id] = m; else delete doc[id];
  atualizarArt(leiId, id);
  salvarMarcas(leiId);
}
function atualizarArt(leiId, id) {
  const el = document.getElementById(`a-${leiId}-${id}`);
  if (!el) return;
  const m = marca(leiId, id);
  CORES.forEach(c => el.classList.toggle("art--" + c, m?.c === c));
  el.classList.toggle("art--fav", !!m?.f);
  let an = el.querySelector(".anotacao");
  if (m?.nota) {
    if (!an) { an = document.createElement("div"); an.className = "anotacao"; el.append(an); }
    an.textContent = m.nota;
  } else an?.remove();
}
function aplicarMarcas() {
  $$("article.art").forEach(el => atualizarArt(el.dataset.lei, el.dataset.id));
  if (ferr.alvo) sincronizarFerramentas();
}
function mostrarStatus() {
  const el = $("#status");
  if (arm.modo === "conta") {
    el.className = "status status--conta";
    el.textContent = "Grifos e anotações salvos na sua conta, em qualquer aparelho.";
  } else {
    el.className = "status" + (st.offline ? " status--offline" : "");
    el.textContent = `Grifos e anotações salvos neste ${SITE ? "aparelho" : "navegador"}.` + (st.offline ? " Funciona sem internet." : "");
  }
}

/* ================================================================ ferramentas do artigo */

const ferr = { el: null, alvo: null, timer: null };

function criarFerramentas() {
  ferr.el = $("#tpl-ferramentas").content.firstElementChild.cloneNode(true);
  ferr.el.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || !ferr.alvo) return;
    const { lei: l, id } = ferr.alvo;
    if (b.dataset.cor !== undefined) mudarMarca(l, id, { c: b.dataset.cor });
    else if (b.dataset.acao === "favorito") mudarMarca(l, id, { f: !marca(l, id)?.f });
    else if (b.dataset.acao === "copiar") { copiarArtigo(b); return; }
    else if (b.dataset.acao === "fechar") { fecharFerramentas(); return; }
    sincronizarFerramentas();
  });
  $("textarea", ferr.el).addEventListener("input", e => {
    clearTimeout(ferr.timer);
    const { lei: l, id } = ferr.alvo, texto = e.target.value;
    ferr.timer = setTimeout(() => { ferr.timer = null; mudarMarca(l, id, { nota: texto.trim() ? texto : "" }); }, 500);
  });
}
function abrirFerramentas(art) {
  if (!ferr.el) criarFerramentas();
  const mesmo = ferr.alvo?.el === art;
  fecharFerramentas();
  if (mesmo) return;
  ferr.alvo = { lei: art.dataset.lei, id: art.dataset.id, el: art };
  $(".art__n", art).setAttribute("aria-expanded", "true");
  art.after(ferr.el);
  sincronizarFerramentas();
}
function sincronizarFerramentas() {
  const { lei: l, id } = ferr.alvo, m = marca(l, id) || {};
  $$(".cor", ferr.el).forEach(b => b.setAttribute("aria-pressed", String((m.c || "") === b.dataset.cor)));
  $('[data-acao="favorito"]', ferr.el).setAttribute("aria-pressed", String(!!m.f));
  const nota = $("textarea", ferr.el);
  if (document.activeElement !== nota) nota.value = m.nota || "";
}
function fecharFerramentas() {
  if (!ferr.alvo) return;
  if (ferr.timer) {
    clearTimeout(ferr.timer); ferr.timer = null;
    const v = $("textarea", ferr.el).value;
    mudarMarca(ferr.alvo.lei, ferr.alvo.id, { nota: v.trim() ? v : "" });
  }
  $(".art__n", ferr.alvo.el)?.setAttribute("aria-expanded", "false");
  ferr.el.remove();
  ferr.alvo = null;
}
async function copiarArtigo(botao) {
  const { lei: l, el } = ferr.alvo;
  const copia = el.cloneNode(true);
  copia.querySelectorAll(".anotacao, .art__estrela, .art__tag").forEach(x => x.remove());
  const texto = $$("p", copia).map(p => p.textContent.trim()).join("\n") + (l === "sumulas" ? "" : ` (${lei(l).sigla})`);
  try {
    await navigator.clipboard.writeText(texto);
    botao.textContent = "Copiado";
  } catch {
    const faixa = document.createRange();
    faixa.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(faixa);
    botao.textContent = "Texto selecionado";
  }
  setTimeout(() => { botao.textContent = "Copiar texto"; }, 1600);
}

/* ================================================================ índice lateral */

function montarIndice() {
  const item = (id, sigla, nome, cor) =>
    `<li><button class="item" data-ir="${id}" style="--cor:${cor}"><span class="item__aba"></span><span class="item__sigla">${esc(sigla)}</span><span class="item__nome">${esc(nome)}</span></button></li>`;
  const grupo = (titulo, itens) => `<section class="grupo"><h2 class="rotulo">${titulo}</h2><ul>${itens}</ul></section>`;
  $("#indice").innerHTML =
    GRUPOS.map(g => grupo(g, st.indice.filter(l => l.grupo === g).map(l => item(l.id, l.sigla, l.curto, l.cor)).join(""))).join("")
    + grupo("Jurisprudência", item("sumulas", "Súmulas", "STF e STJ", COR_SUMULAS))
    + grupo("Seu estudo", item("grifos", "Grifos", "Marcados e anotados", "var(--accent)"));
}
function marcarAtual(id) {
  $$("#indice .item").forEach(b => {
    if (b.dataset.ir === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}
function abrirGaveta(aberta) {
  document.body.classList.toggle("gaveta", aberta);
  $("#veu").hidden = !aberta;
  $("#bt-menu").setAttribute("aria-expanded", String(aberta));
}

/* ================================================================ navegação */

async function ir(destino, art) {
  fecharFerramentas();
  abrirGaveta(false);
  if (destino !== "busca") { $("#busca").value = ""; st.voltarPara = null; }
  if (destino === "inicio") return vistaInicio();
  if (destino === "sumulas") return vistaSumulas(art);
  if (destino === "grifos") return vistaGrifos();
  if (lei(destino)) return vistaLei(destino, art);
}
function rolarPara(el) {
  if (!el) return;
  // a rubrica ("Homicídio simples") fica logo acima do artigo: mostra junto
  const ancora = el.previousElementSibling?.classList.contains("rubrica") ? el.previousElementSibling : el;
  const vai = () => ancora.scrollIntoView({ block: "start" });
  vai();
  // as fontes chegam depois e mudam a altura do texto: rola de novo
  if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(() => requestAnimationFrame(vai));
  el.classList.remove("piscar");
  void el.offsetWidth;
  el.classList.add("piscar");
}
function topo() { scrollTo(0, 0); }

/* ---------------- início */

function vistaInicio() {
  st.vista = { tipo: "inicio" };
  marcarAtual("inicio");
  const ult = ler("vm-ultimo", null);
  const ultLei = ult && lei(ult.lei);
  const s = st.meta.sumulas;
  const totArts = st.indice.reduce((a, l) => a + l.artigos, 0);
  const baixados = st.indice.map(l => l.baixado).sort();
  const livro = (id, sigla, nome, qtd, cor) =>
    `<li><button class="livro" data-ir="${id}" style="--cor:${cor}"><span class="livro__lombada"></span><span class="livro__sigla">${esc(sigla)}</span><span class="livro__nome">${esc(nome)}</span><span class="livro__qtd">${qtd}</span></button></li>`;
  const estante = (titulo, itens) => `<section class="estante"><h2 class="rotulo">${titulo}</h2><ul class="estante__lista">${itens}</ul></section>`;

  principal.innerHTML = `<div class="pagina pagina--larga">
    <section class="ola">
      <h1>Leis e súmulas</h1>
      <p class="ola__sub">${st.indice.length} leis no texto vigente (${numBR(totArts)} artigos) e ${numBR(s.SV + s.STF + s.STJ)} súmulas do STF e do STJ.</p>
      ${ultLei ? `<div class="ola__acoes"><button class="btn btn--primario" data-ir="${ultLei.id}" data-art="${esc(ult.art || "")}">Continuar em ${esc(ultLei.sigla)}${ult.art ? ", art. " + esc(ult.rot || ult.art) : ""}</button></div>` : ""}
      <div class="exemplos"><span>Atalhos</span>${["cf 5", "cp 121", "sv 11", "boa-fé", "usucapião"].map(q => `<button class="chip" data-buscar="${q}">${q}</button>`).join("")}</div>
      <div id="instalar"></div>
    </section>
    ${GRUPOS.map(g => estante(g, st.indice.filter(l => l.grupo === g).map(l => livro(l.id, l.sigla, l.nome, plural(l.artigos, "artigo", "artigos"), l.cor)).join(""))).join("")}
    ${estante("Jurisprudência e estudo",
      livro("sumulas", "Súmulas", "Vinculantes, STF e STJ", plural(s.SV + s.STF + s.STJ, "súmula", "súmulas"), COR_SUMULAS)
      + livro("grifos", "Grifos", "Tudo o que você marcou", "", "var(--accent)"))}
    <footer class="rodape">
      <p>Textos do repositório aberto <a href="https://github.com/ctresb/leis" target="_blank" rel="noopener">ctresb/leis</a>, versão de ${dataBR(st.meta.atualizado)}. Leis federais e Constituição no texto compilado, obtido das fontes oficiais entre ${dataBR(baixados[0])} e ${dataBR(baixados.at(-1))}.</p>
      <p>Conversão automática: não substitui o Diário Oficial. Antes de citar em prova, trabalho ou peça, confira no link “Fonte oficial” de cada lei.</p>
    </footer>
  </div>`;
  montarInstalar();
  topo();
}

/* ---------------- lei */

async function vistaLei(id, art) {
  marcarAtual(id);
  if (st.vista?.tipo !== "lei" || st.vista.id !== id) {
    principal.innerHTML = `<p class="carregando">Abrindo ${esc(lei(id).nome)}…</p>`;
    let L;
    try { L = await carregarLei(id); } catch {
      principal.innerHTML = `<div class="vazio"><strong>Não consegui abrir esta lei.</strong>Verifique a conexão e toque nela de novo no índice.</div>`;
      return;
    }
    st.vista = { tipo: "lei", id };
    principal.innerHTML = htmlLei(L);
    ligarLei(id);
  }
  if (art) rolarPara(document.getElementById(`a-${id}-${art}`)); else topo();
  lembrar(id, art);
}
function htmlLei(L) {
  const m = st.marcas[L.id] || {};
  const primeiro = L.nos.findIndex(n => n.t !== "p");
  const preambulo = L.nos.slice(0, primeiro).map(n => `<p>${fmt(n.x)}</p>`).join("");
  const corpo = L.nos.slice(primeiro).map((n, j) => {
    const i = j + primeiro;
    if (n.t === "h") { const tag = "h" + Math.min(n.l + 1, 6); return `<${tag} class="titulo titulo--${n.l}" id="h-${i}">${fmt(n.x)}</${tag}>`; }
    if (n.t === "r") return `<p class="rubrica">${fmt(n.x)}</p>`;
    if (n.t === "p") return `<p class="solto">${fmt(n.x)}</p>`;
    return htmlArt(L.id, n, m[n.id]);
  }).join("");
  const sumario = L.nos.map((n, i) => n.t === "h" ? `<a href="#h-${i}" class="s${n.l}" data-h="h-${i}">${esc(plano(n.x))}</a>` : "").join("");
  const ementa = L.ementa && L.ementa.replace(/\.$/, "") !== L.nome ? `<p class="cabecalho__ementa">${esc(L.ementa)}</p>` : "";
  return `<div class="pagina" style="--cor:${L.cor}">
    <header class="cabecalho">
      <p class="cabecalho__ref">${htmlSelo(L.id)}<span>${esc(L.titulo)}</span></p>
      <h1>${esc(L.nome)}</h1>
      ${ementa}
      <p class="cabecalho__meta"><span>${plural(L.artigos, "artigo", "artigos")}</span><span>Texto compilado, obtido em ${dataBR(L.baixado)}</span><a href="${esc(L.fonte)}" target="_blank" rel="noopener">Fonte oficial ↗</a></p>
    </header>
    <div class="barra" role="toolbar" aria-label="Navegar na lei">
      <form class="ir-art" id="form-ir"><label for="ir-art">Art.</label><input id="ir-art" autocomplete="off" placeholder="${L.id === "cf" ? "5 ou adct 10" : "ex.: 121"}"><button>Ir</button></form>
      ${sumario ? `<button class="btn" id="bt-sumario" aria-expanded="false" aria-controls="sumario">Sumário</button>` : ""}
      <label class="interruptor"><input type="checkbox" role="switch" id="chk-notas" ${st.notas ? "checked" : ""}>Notas de redação</label>
      <span class="barra__aviso" id="aviso-ir" role="status"></span>
      <span class="dica barra__fim">Toque em “Art.” para grifar</span>
    </div>
    <nav class="sumario" id="sumario" aria-label="Sumário" hidden>${sumario}</nav>
    <div class="texto${st.notas ? "" : " sem-notas"}" id="texto">${preambulo ? `<div class="preambulo">${preambulo}</div>` : ""}${corpo}</div>
  </div>`;
}
function ligarLei(id) {
  $("#form-ir").addEventListener("submit", e => {
    e.preventDefault();
    const alvo = acharArt(id, $("#ir-art").value);
    $("#aviso-ir").textContent = alvo ? "" : "Artigo não encontrado";
    if (alvo) { rolarPara(document.getElementById(`a-${id}-${alvo}`)); lembrar(id, alvo); }
  });
  $("#chk-notas").addEventListener("change", e => {
    st.notas = e.target.checked;
    gravar("vm-notas", st.notas);
    $("#texto").classList.toggle("sem-notas", !st.notas);
  });
  const sumario = $("#sumario"), bt = $("#bt-sumario");
  const mostrarSumario = v => { sumario.hidden = !v; bt?.setAttribute("aria-expanded", String(v)); };
  bt?.addEventListener("click", () => mostrarSumario(sumario.hidden));
  sumario.addEventListener("click", e => {
    const a = e.target.closest("a[data-h]");
    if (!a) return;
    e.preventDefault();
    mostrarSumario(false);
    rolarPara(document.getElementById(a.dataset.h));
  });
}
function acharArt(id, consulta) {
  let s = consulta.trim().toLowerCase().replace(/^art(igo)?\.?\s*/, "").replace(/[º°ª]/g, "");
  let pre = "";
  if (/^adct/.test(s)) { pre = "adct-"; s = s.replace(/^adct\.?\s*(art\.?\s*)?/, ""); }
  const m = s.match(/^(\d[\d.]*)\s*-?\s*([a-z]{0,2})$/);
  if (!m) return null;
  const cand = pre + m[1].replace(/\./g, "") + (m[2] ? "-" + m[2].toUpperCase() : "");
  return st.leis[id]?.nos.some(n => n.t === "a" && n.id === cand) ? cand : null;
}
function lembrar(id, art) {
  const n = art && st.leis[id]?.nos.find(x => x.id === art);
  gravar("vm-ultimo", { lei: id, art: art || null, rot: n ? n.n : null });
}

/* ---------------- súmulas */

async function vistaSumulas(alvo) {
  marcarAtual("sumulas");
  if (!st.sumulas) principal.innerHTML = `<p class="carregando">Carregando súmulas…</p>`;
  await carregarSumulas();
  if (alvo) {
    st.sumTrib = alvo.split("-")[0];
    st.sumFiltro = "";
    if (st.sumulas.find(s => idSumula(s) === alvo)?.cancelada) st.sumCanc = true;
  }
  st.vista = { tipo: "sumulas" };
  const n = st.meta.sumulas;
  principal.innerHTML = `<div class="pagina" style="--cor:${COR_SUMULAS}">
    <header class="cabecalho">
      <p class="cabecalho__ref"><span class="rotulo">Jurisprudência</span></p>
      <h1>Súmulas</h1>
      <p class="cabecalho__meta"><span>Vinculantes: Banco Nacional de Precedentes (CNJ)</span><span>STF e STJ: cadernos oficiais dos tribunais</span></p>
    </header>
    <div class="barra" role="toolbar" aria-label="Filtrar súmulas">
      <div class="segmentado">${["SV", "STF", "STJ"].map(t => `<button data-trib="${t}" aria-pressed="${st.sumTrib === t}">${t === "SV" ? "Vinculantes" : t} · ${n[t]}</button>`).join("")}</div>
      <input class="campo" id="sum-filtro" type="search" placeholder="Número ou palavra" value="${esc(st.sumFiltro)}" aria-label="Filtrar súmulas">
      <label class="interruptor"><input type="checkbox" role="switch" id="sum-canc" ${st.sumCanc ? "checked" : ""}>Canceladas</label>
    </div>
    <div class="texto" id="lista-sumulas"></div>
  </div>`;
  $$("[data-trib]").forEach(b => b.addEventListener("click", () => {
    st.sumTrib = b.dataset.trib;
    $$("[data-trib]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    listarSumulas();
  }));
  $("#sum-filtro").addEventListener("input", e => { st.sumFiltro = e.target.value; listarSumulas(); });
  $("#sum-canc").addEventListener("change", e => { st.sumCanc = e.target.checked; listarSumulas(); });
  listarSumulas();
  if (alvo) rolarPara(document.getElementById("a-sumulas-" + alvo)); else topo();
}
function listarSumulas() {
  fecharFerramentas();
  const f = norm(st.sumFiltro.trim());
  const num = /^\d+$/.test(f) ? +f : null;
  const m = st.marcas.sumulas || {};
  const lista = st.sumulas.filter(s => s.tr === st.sumTrib && (st.sumCanc || !s.cancelada)
    && (!f || (num !== null ? s.n === num : norm(s.x + " " + s.assunto).includes(f))));
  $("#lista-sumulas").innerHTML = lista.length
    ? lista.map(s => htmlSumula(s, m[idSumula(s)])).join("")
    : `<div class="vazio"><strong>Nenhuma súmula ${NOME_TRIB[st.sumTrib]} com “${esc(st.sumFiltro)}”.</strong>Tente outra palavra, ou ligue “Canceladas”.</div>`;
}

/* ---------------- grifos */

async function vistaGrifos() {
  marcarAtual("grifos");
  st.vista = { tipo: "grifos" };
  const leis = Object.keys(st.marcas).filter(l => Object.keys(st.marcas[l]).length);
  const cab = total => `<header class="cabecalho">
      <p class="cabecalho__ref"><span class="rotulo">Seu estudo</span></p>
      <h1>Meus grifos</h1>
      ${total ? `<p class="cabecalho__meta"><span>${plural(total, "item marcado", "itens marcados")}</span></p>` : ""}
    </header>`;
  if (!leis.length) {
    principal.innerHTML = `<div class="pagina">${cab(0)}
      <div class="vazio"><strong>Nada marcado ainda.</strong>Abra uma lei, toque no “Art.” de um artigo e escolha uma cor, marque como favorito ou escreva uma anotação. Tudo aparece aqui, separado por lei.</div>
      ${htmlBackup()}</div>`;
    ligarBackup();
    return;
  }
  principal.innerHTML = `<p class="carregando">Juntando seus grifos…</p>`;
  await Promise.all(leis.map(l => l === "sumulas" ? carregarSumulas() : carregarLei(l)));
  if (st.vista?.tipo !== "grifos") return;
  const ordem = [...st.indice.map(l => l.id), "sumulas"].filter(l => leis.includes(l));
  const total = ordem.reduce((a, l) => a + Object.keys(st.marcas[l]).length, 0);
  principal.innerHTML = `<div class="pagina">${cab(total)}
    ${htmlBackup()}
    <div class="barra" role="toolbar" aria-label="Filtrar grifos">
      <label class="interruptor"><input type="checkbox" role="switch" id="g-fav">Só favoritos</label>
      <label class="interruptor"><input type="checkbox" role="switch" id="g-nota">Só com anotação</label>
    </div>
    <div class="texto${st.notas ? "" : " sem-notas"}" id="lista-grifos"></div>
  </div>`;
  ligarBackup();
  const desenhar = () => {
    fecharFerramentas();
    const soFav = $("#g-fav").checked, soNota = $("#g-nota").checked;
    $("#lista-grifos").innerHTML = ordem.map(l => {
      const m = st.marcas[l] || {};
      const passa = id => m[id] && (!soFav || m[id].f) && (!soNota || m[id].nota);
      const itens = l === "sumulas"
        ? st.sumulas.filter(s => passa(idSumula(s))).map(s => htmlSumula(s, m[idSumula(s)]))
        : st.leis[l].nos.filter(n => n.t === "a" && passa(n.id)).map(n => htmlArt(l, n, m[n.id]));
      if (!itens.length) return "";
      return `<div class="grupo-grifos">${htmlSelo(l)}<button class="btn btn--pequeno" data-ir="${l}">Abrir ${esc(lei(l)?.sigla || "súmulas")}</button></div>${itens.join("")}`;
    }).join("") || `<div class="vazio"><strong>Nenhum item com esse filtro.</strong>Desligue os filtros para ver tudo.</div>`;
  };
  $("#g-fav").addEventListener("change", desenhar);
  $("#g-nota").addEventListener("change", desenhar);
  desenhar();
  topo();
}

/* ================================================================ busca */

const indiceBusca = {};
function indexar(id) {
  if (indiceBusca[id]) return indiceBusca[id];
  const itens = id === "sumulas"
    ? st.sumulas.map(s => ({ id: idSumula(s), rot: rotuloSumula(s), txt: s.x, canc: s.cancelada }))
    : st.leis[id].nos.filter(n => n.t === "a").map(n => ({
      id: n.id, rot: rotuloArt(n.n),
      txt: plano(n.p.join(" ")).replace(/^"?Art\.?\s*[\d.]+\s*[º°o]?\.?(\s*-\s*[A-Z]{1,2}\.?)?\s*/, ""),
    }));
  itens.forEach(a => { a.n = norm(a.txt); });
  return (indiceBusca[id] = itens);
}
const APELIDOS = {
  cf: "cf", crfb: "cf", cc: "cc", cpc: "cpc", cp: "cp", cpp: "cpp", clt: "clt", cdc: "cdc", ctn: "ctn",
  eca: "eca", lindb: "lindb", oab: "oab", eoab: "oab", jec: "jec", lep: "lep", ld: "drogas", drogas: "drogas",
  lmp: "lmp", lch: "hed", hediondos: "hed", lia: "lia", lpa: "lpa", lms: "ms", ms: "ms",
};
// "cc 1228", "art 5 cf", "sv 11", "súmula 7 stj" viram atalhos diretos
function atalhos(q) {
  const s = norm(q.trim()).replace(/[º°ª,]/g, " ").replace(/\s+/g, " ").trim();
  const out = [];
  let m = s.match(/^(?:art(?:igo)?\.?\s*)?(\d[\d.]*(?:\s*-\s*[a-z]{1,2})?)\s+(?:do\s+|da\s+)?([a-z]+)$/)
    || s.match(/^([a-z]+)\s+(?:art(?:igo)?\.?\s*)?(adct\s*\d[\d.]*|\d[\d.]*(?:\s*-\s*[a-z]{1,2})?)$/);
  if (m) {
    const [sigla, art] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const id = APELIDOS[sigla];
    if (id) out.push({ lei: id, art, rot: `${lei(id).sigla}, art. ${art.replace(/\s/g, "")}` });
  }
  m = s.match(/^(?:sumula\s+)?(?:sv|vinculante)\s*(\d+)$/) || s.match(/^sumula\s+vinculante\s+(\d+)$/);
  if (m) out.push({ sum: "SV-" + m[1], rot: "Súmula Vinculante " + m[1] });
  m = s.match(/^(?:sumula\s+)?(\d+)\s+(?:do\s+)?(stf|stj)$/) || s.match(/^(?:sumula\s+)?(stf|stj)\s+(\d+)$/);
  if (m) {
    const [n, t] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    out.push({ sum: t.toUpperCase() + "-" + n, rot: `Súmula ${n} do ${t.toUpperCase()}` });
  }
  return out;
}
async function saltar(a) {
  if (a.sum) {
    await carregarSumulas();
    if (!st.sumulas.some(s => idSumula(s) === a.sum)) return false;
    ir("sumulas", a.sum);
    return true;
  }
  await carregarLei(a.lei);
  const art = acharArt(a.lei, a.art);
  if (art) ir(a.lei, art);
  return !!art;
}

let buscaSeq = 0;
async function buscar(q) {
  const seq = ++buscaSeq;
  if (!q.trim()) {
    const v = st.voltarPara;
    st.voltarPara = null;
    st.vista = null;
    if (v) ir(v.id || v.tipo);
    return;
  }
  if (st.vista?.tipo !== "busca") st.voltarPara = st.vista;
  st.vista = { tipo: "busca" };
  marcarAtual("busca");
  fecharFerramentas();

  const lista = atalhos(q);
  const htmlAtalhos = lista.length
    ? `<div class="saltos">${lista.map(a => `<button class="btn btn--primario" data-salto="${esc(JSON.stringify(a))}">Ir para ${esc(a.rot)} →</button>`).join("")}</div>`
    : "";
  const frase = q.trim().match(/^"(.+)"$/);
  const termos = frase ? [norm(frase[1])] : norm(q).split(/\s+/).filter(t => t.length > 1);
  if (!frase && termos.join("").length < 3) {
    principal.innerHTML = `<div class="pagina">${htmlAtalhos}<p class="dica">Digite pelo menos 3 letras.</p></div>`;
    return;
  }
  const faltam = st.indice.filter(l => !st.leis[l.id]);
  if (faltam.length || !st.sumulas) {
    principal.innerHTML = `<div class="pagina">${htmlAtalhos}<p class="carregando">Preparando a busca em todas as leis (só na primeira vez)…</p></div>`;
    await Promise.all([...faltam.map(l => carregarLei(l.id).catch(() => null)), carregarSumulas()]);
    if (seq !== buscaSeq) return;
  }

  const achados = [], contagem = {};
  for (const id of [...st.indice.map(l => l.id), "sumulas"]) {
    if (id !== "sumulas" && !st.leis[id]) continue;
    for (const a of indexar(id)) {
      if (!termos.every(t => a.n.includes(t))) continue;
      contagem[id] = (contagem[id] || 0) + 1;
      if (!st.buscaFiltro || st.buscaFiltro === id) achados.push({ lei: id, a });
    }
  }
  // as palavras juntas, na ordem digitada, vêm primeiro
  const junto = termos.join(" ");
  if (termos.length > 1) achados.sort((x, y) => y.a.n.includes(junto) - x.a.n.includes(junto));
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);
  const mostra = achados.slice(0, 200);

  principal.innerHTML = `<div class="pagina">
    ${htmlAtalhos}
    <p class="resultados-cab">${plural(total, "resultado", "resultados")} para “${esc(q.trim())}”${achados.length > 200 ? " · mostrando os 200 primeiros" : ""}</p>
    ${Object.keys(contagem).length > 1 ? `<div class="filtros"><button class="chip" data-filtro="" aria-pressed="${!st.buscaFiltro}">Todas</button>${Object.entries(contagem).map(([id, n]) => `<button class="chip" data-filtro="${id}" aria-pressed="${st.buscaFiltro === id}">${esc(lei(id)?.sigla || "Súmulas")} · ${n}</button>`).join("")}</div>` : ""}
    ${mostra.map(({ lei: l, a }) => `<button class="resultado" data-res-lei="${l}" data-res-art="${esc(a.id)}">
      <span class="resultado__topo">${htmlSelo(l)}${esc(a.rot)}${a.canc ? ' <span class="art__tag">cancelada</span>' : ""}</span>
      <span class="resultado__trecho">${trecho(a, termos)}</span></button>`).join("")}
    ${total ? "" : `<div class="vazio"><strong>Nada encontrado.</strong>Tente menos palavras (acento não faz diferença). Para uma expressão exata, use aspas: "boa-fé objetiva".</div>`}
  </div>`;
  topo();
}
function trecho(a, termos) {
  const p = Math.max(0, a.n.indexOf(termos[0]));
  // corta o trecho em espaços, para não começar nem terminar no meio de uma palavra
  let ini = Math.max(0, p - 90), fim = Math.min(a.txt.length, p + 200);
  if (ini > 0) ini = a.txt.indexOf(" ", ini) + 1 || ini;
  if (fim < a.txt.length) fim = a.txt.lastIndexOf(" ", fim) > p ? a.txt.lastIndexOf(" ", fim) : fim;
  const pedaco = a.txt.slice(ini, fim), pn = a.n.slice(ini, fim);
  const faixas = [];
  for (const t of termos) for (let i = pn.indexOf(t); i >= 0; i = pn.indexOf(t, i + t.length)) faixas.push([i, i + t.length]);
  faixas.sort((x, y) => x[0] - y[0]);
  let out = "", pos = 0;
  for (const [s, e] of faixas) {
    if (s < pos) continue;
    out += esc(pedaco.slice(pos, s)) + "<mark>" + esc(pedaco.slice(s, e)) + "</mark>";
    pos = e;
  }
  out += esc(pedaco.slice(pos));
  return (ini > 0 ? "… " : "") + out + (fim < a.txt.length ? " …" : "");
}

/* ================================================================ só na versão site */

let pedidoInstalar = null;
function montarInstalar() {
  const el = $("#instalar");
  if (!el || !SITE || matchMedia("(display-mode: standalone)").matches || navigator.standalone) return;
  if (pedidoInstalar) {
    el.innerHTML = `<div class="ola__acoes"><button class="btn" id="bt-instalar">Instalar como app</button><span class="dica">Abre pela tela inicial e funciona sem internet.</span></div>`;
    $("#bt-instalar").addEventListener("click", async () => {
      pedidoInstalar.prompt();
      await pedidoInstalar.userChoice;
      pedidoInstalar = null;
      el.innerHTML = "";
    });
  } else if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    el.innerHTML = `<p class="dica dica--ios">No iPhone, toque em Compartilhar e depois em “Adicionar à Tela de Início”: abre como app, funciona sem internet e seus grifos ficam guardados.</p>`;
  }
}
function exportarGrifos() {
  const conteudo = { app: "vade-mecum-aberto", formato: 1, exportado: new Date().toISOString(), marcas: st.marcas };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(conteudo, null, 1)], { type: "application/json" }));
  a.download = `vade-mecum-grifos-${new Date().toLocaleDateString("sv")}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importarGrifos(arquivo) {
  let dados = null;
  try { dados = JSON.parse(await arquivo.text()); } catch { /* arquivo inválido */ }
  if (!dados || dados.app !== "vade-mecum-aberto" || typeof dados.marcas !== "object") {
    $("#aviso-backup").textContent = "Esse arquivo não é um backup do Vade Mecum.";
    return;
  }
  let n = 0;
  for (const [l, arts] of Object.entries(dados.marcas)) {
    if (l !== "sumulas" && !lei(l)) continue;
    st.marcas[l] ||= {};
    for (const [id, m] of Object.entries(arts || {})) {
      if (!m || typeof m !== "object" || (st.marcas[l][id]?.t || 0) >= (m.t || 0)) continue;
      const limpo = { t: +m.t || Date.now() };
      if (CORES.includes(m.c)) limpo.c = m.c;
      if (m.f) limpo.f = true;
      if (typeof m.nota === "string" && m.nota) limpo.nota = m.nota;
      st.marcas[l][id] = limpo;
      n++;
    }
    salvarMarcas(l);
  }
  await vistaGrifos();
  $("#aviso-backup").textContent = n ? `${plural(n, "item importado", "itens importados")}.` : "Nada novo nesse backup.";
}
function htmlBackup() {
  if (!SITE) return "";
  return `<section class="backup" aria-label="Backup">
    <p class="dica">Seus grifos ficam só neste aparelho. Exporte de vez em quando, e importe o arquivo para levar tudo para outro celular ou computador.</p>
    <div class="backup__acoes">
      <button class="btn btn--pequeno" id="bt-exportar">Exportar backup</button>
      <label class="btn btn--pequeno">Importar backup<input type="file" id="in-importar" accept="application/json,.json" hidden></label>
      <span class="barra__aviso" id="aviso-backup" role="status"></span>
    </div>
  </section>`;
}
function ligarBackup() {
  if (!SITE) return;
  $("#bt-exportar").addEventListener("click", exportarGrifos);
  $("#in-importar").addEventListener("change", e => {
    const f = e.target.files[0];
    if (f) importarGrifos(f);
    e.target.value = "";
  });
}
// claro é o padrão; "sistema" segue o tema do aparelho
const escuroNoSistema = matchMedia("(prefers-color-scheme: dark)");
let temaAtual = "light";
function aplicarTema(tema) {
  temaAtual = ["light", "dark", "sistema"].includes(tema) ? tema : "light";
  const escuro = temaAtual === "dark" || (temaAtual === "sistema" && escuroNoSistema.matches);
  document.documentElement.dataset.theme = escuro ? "dark" : "light";
  $$("#tema button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tema === temaAtual)));
}
escuroNoSistema.addEventListener?.("change", () => { if (SITE && temaAtual === "sistema") aplicarTema("sistema"); });
function iniciarSite() {
  if (!SITE) return;
  $("#linha-tema").hidden = false;
  aplicarTema(ler("vm-tema", "light"));
  $("#tema").addEventListener("click", e => {
    const b = e.target.closest("[data-tema]");
    if (!b) return;
    aplicarTema(b.dataset.tema);
    gravar("vm-tema", b.dataset.tema);
  });
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); pedidoInstalar = e; montarInstalar(); });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.ready.then(() => { st.offline = true; mostrarStatus(); });
  }
  // pede ao navegador para não apagar os grifos quando faltar espaço
  navigator.storage?.persist?.().catch(() => {});
}

/* ================================================================ eventos */

document.addEventListener("click", e => {
  const t = e.target;
  const artBt = t.closest(".art__n");
  if (artBt) { abrirFerramentas(artBt.closest("article")); return; }
  const destino = t.closest("[data-ir]");
  if (destino) { ir(destino.dataset.ir, destino.dataset.art || null); return; }
  const res = t.closest("[data-res-lei]");
  if (res) { ir(res.dataset.resLei, res.dataset.resArt); return; }
  const salto = t.closest("[data-salto]");
  if (salto) { saltar(JSON.parse(salto.dataset.salto)).then(ok => { if (!ok) salto.textContent = "Não encontrado"; }); return; }
  const filtro = t.closest("[data-filtro]");
  if (filtro) { st.buscaFiltro = filtro.dataset.filtro || null; buscar($("#busca").value); return; }
  const exemplo = t.closest("[data-buscar]");
  if (exemplo) {
    const q = exemplo.dataset.buscar;
    $("#busca").value = q;
    const lista = atalhos(q);
    if (lista.length) saltar(lista[0]); else buscar(q);
  }
});

let esperaBusca;
const campoBusca = $("#busca");
campoBusca.addEventListener("input", () => {
  clearTimeout(esperaBusca);
  st.buscaFiltro = null;
  esperaBusca = setTimeout(() => buscar(campoBusca.value), 280);
});
campoBusca.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  clearTimeout(esperaBusca);
  const q = campoBusca.value, lista = atalhos(q);
  if (!lista.length) { buscar(q); return; }
  campoBusca.blur();
  saltar(lista[0]).then(ok => { if (!ok) { campoBusca.value = q; buscar(q); } });
});
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); campoBusca.focus(); }
  if (e.key === "Escape") { fecharFerramentas(); abrirGaveta(false); }
});
$("#bt-inicio").addEventListener("click", () => ir("inicio"));
$("#bt-menu").addEventListener("click", () => abrirGaveta(true));
$("#veu").addEventListener("click", () => abrirGaveta(false));

let tamanho = ler("vm-fs", 16);
const aplicarTamanho = () => document.documentElement.style.setProperty("--fs-leitura", tamanho + "px");
$("#bt-fmenos").addEventListener("click", () => { tamanho = Math.max(14, tamanho - 1); aplicarTamanho(); gravar("vm-fs", tamanho); });
$("#bt-fmais").addEventListener("click", () => { tamanho = Math.min(24, tamanho + 1); aplicarTamanho(); gravar("vm-fs", tamanho); });

/* ================================================================ início */

(async function iniciar() {
  aplicarTamanho();
  iniciarSite();
  st.notas = ler("vm-notas", true);
  st.marcas = ler("vm-marcas", {});
  mostrarStatus();
  try {
    st.meta = await buscarJson("dados/indice.json");
    st.indice = st.meta.leis;
  } catch {
    principal.innerHTML = `<div class="vazio"><strong>Não consegui carregar as leis.</strong>Verifique a conexão e recarregue a página.</div>`;
    return;
  }
  montarIndice();
  const m = decodeURIComponent(location.hash.slice(1)).match(/^([a-z]+)(?:-(.+))?$/);
  if (m && lei(m[1]) && m[2]) { await carregarLei(m[1]); ir(m[1], acharArt(m[1], m[2])); }
  else if (m && (lei(m[1]) || m[1] === "sumulas" || m[1] === "grifos")) ir(m[1], m[2] || null);
  else vistaInicio();
  conectarConta();
})();
