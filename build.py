"""Vade Mecum Aberto: baixa as leis de ctresb/leis e gera os dados e o site.

Uso (sempre a partir de qualquer pasta; os caminhos são relativos a este arquivo):
  python -I build.py baixar [commit]   baixa os .md para fonte/md (padrão: commit mais recente)
  python -I build.py dados             converte fonte/md em dados/*.json
  python -I build.py site              monta o site estático em site/
  python -I build.py artifact          monta a versão para o claude.ai em artifact/
  python -I build.py tudo [commit]     todas as etapas
"""
import hashlib
import json
import os
import re
import shutil
import struct
import sys
import time
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
FONTE = RAIZ / "fonte"
DADOS = RAIZ / "dados"
SITE = RAIZ / "site"
REPO = "ctresb/leis"

# id, sigla, nome, nome curto (índice lateral), grupo, cor da aba lateral, caminho no repo
LEIS = [
    ("cf", "CF", "Constituição Federal", "Constituição", "Constituição", "#1f6b45", "constituicao.md"),
    ("cc", "CC", "Código Civil", "Civil", "Códigos", "#1d4f91", "federal/leis-ordinarias/2002/lei-10406-2002-01-10.md"),
    ("cpc", "CPC", "Código de Processo Civil", "Processo Civil", "Códigos", "#3b82b8", "federal/leis-ordinarias/2015/lei-13105-2015-03-16.md"),
    ("cp", "CP", "Código Penal", "Penal", "Códigos", "#a3262f", "federal/decretos-lei/1940/del-2848-1940-12-07.md"),
    ("cpp", "CPP", "Código de Processo Penal", "Processo Penal", "Códigos", "#cf6a2a", "federal/decretos-lei/1941/del-3689-1941-10-03.md"),
    ("clt", "CLT", "Consolidação das Leis do Trabalho", "Trabalho", "Códigos", "#7a5230", "federal/decretos-lei/1943/del-5452-1943-05-01.md"),
    ("cdc", "CDC", "Código de Defesa do Consumidor", "Consumidor", "Códigos", "#6d3fa0", "federal/leis-ordinarias/1990/lei-8078-1990-09-11.md"),
    ("ctn", "CTN", "Código Tributário Nacional", "Tributário", "Códigos", "#0f7c7c", "federal/leis-ordinarias/1966/lei-5172-1966-10-25.md"),
    ("eca", "ECA", "Estatuto da Criança e do Adolescente", "Criança e Adolescente", "Estatutos e leis", "#c49a12", "federal/leis-ordinarias/1990/lei-8069-1990-07-13.md"),
    ("lindb", "LINDB", "Lei de Introdução às Normas do Direito Brasileiro", "Introdução às Normas", "Estatutos e leis", "#55606e", "federal/decretos-lei/1942/del-4657-1942-09-04.md"),
    ("oab", "EOAB", "Estatuto da Advocacia e da OAB", "Advocacia e OAB", "Estatutos e leis", "#8a1c4a", "federal/leis-ordinarias/1994/lei-8906-1994-07-04.md"),
    ("jec", "JEC", "Lei dos Juizados Especiais", "Juizados Especiais", "Estatutos e leis", "#4a7a2a", "federal/leis-ordinarias/1995/lei-9099-1995-09-26.md"),
    ("lep", "LEP", "Lei de Execução Penal", "Execução Penal", "Estatutos e leis", "#9c4a1a", "federal/leis-ordinarias/1984/lei-7210-1984-07-11.md"),
    ("drogas", "LD", "Lei de Drogas", "Drogas", "Estatutos e leis", "#5b5b9a", "federal/leis-ordinarias/2006/lei-11343-2006-08-23.md"),
    ("lmp", "LMP", "Lei Maria da Penha", "Maria da Penha", "Estatutos e leis", "#b0457a", "federal/leis-ordinarias/2006/lei-11340-2006-08-07.md"),
    ("hed", "LCH", "Lei dos Crimes Hediondos", "Crimes Hediondos", "Estatutos e leis", "#6e2a2a", "federal/leis-ordinarias/1990/lei-8072-1990-07-25.md"),
    ("lia", "LIA", "Lei de Improbidade Administrativa", "Improbidade", "Estatutos e leis", "#2f5f7a", "federal/leis-ordinarias/1992/lei-8429-1992-06-02.md"),
    ("lpa", "LPA", "Lei do Processo Administrativo", "Processo Administrativo", "Estatutos e leis", "#3d6b5c", "federal/leis-ordinarias/1999/lei-9784-1999-01-29.md"),
    ("ms", "LMS", "Lei do Mandado de Segurança", "Mandado de Segurança", "Estatutos e leis", "#7a6a2a", "federal/leis-ordinarias/2009/lei-12016-2009-08-07.md"),
]
PASTAS_SUMULAS = ["jurisprudencia/stf/sumulas-vinculantes", "jurisprudencia/stf/sumulas", "jurisprudencia/stj/sumulas"]

ART = re.compile(r"^\*\*\"?Art\.?\s*(\d[\d.]*)\s*(?:º|°|o)?\.?\s*(?:-\s*([A-Z]{1,2}))?")
FECHO = re.compile(r"^(Brasília|Rio de Janeiro|Petrópolis),?\s+(em\s+)?\d")
PAGINA = re.compile(r"^Página \d+ de \d+$")
RUBRICA = re.compile(r"^\*\*(?!§|Parágrafo|\"?Art)[^*]{2,120}\*\*(\s*\*\(.*\)\*)?$")


# ---------------------------------------------------------------- baixar

def pegar(url, tentativas=4):
    cab = {"User-Agent": "vade-mecum-aberto"}
    if "api.github.com" in url and os.environ.get("GITHUB_TOKEN"):
        cab["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=cab), timeout=60) as r:
                return r.read()
        except Exception:
            if i == tentativas - 1:
                raise
            time.sleep(2 ** i)


def api(caminho):
    return json.loads(pegar(f"https://api.github.com/repos/{REPO}/{caminho}"))


def baixar(commit=None):
    info = api(f"commits/{commit or 'HEAD'}")
    sha, data = info["sha"], info["commit"]["committer"]["date"][:10]
    print(f"ctresb/leis @ {sha[:10]} ({data})")

    caminhos = [l[-1] for l in LEIS]
    for pasta in PASTAS_SUMULAS:
        arvore = api(f"git/trees/{sha}")
        for parte in pasta.split("/"):
            no = next(e for e in arvore["tree"] if e["path"] == parte)
            arvore = api(f"git/trees/{no['sha']}")
        caminhos += [f"{pasta}/{e['path']}" for e in arvore["tree"] if e["path"].endswith(".md")]

    novo = FONTE / "md.novo"
    shutil.rmtree(novo, ignore_errors=True)

    def um(c):
        destino = novo / c
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(pegar(f"https://raw.githubusercontent.com/{REPO}/{sha}/{c}"))

    with ThreadPoolExecutor(16) as ex:
        list(ex.map(um, caminhos))
    shutil.rmtree(FONTE / "md", ignore_errors=True)
    novo.rename(FONTE / "md")
    (FONTE / "commit.json").write_text(json.dumps({"sha": sha, "data": data}), encoding="utf-8")
    print(f"{len(caminhos)} arquivos baixados")


# ---------------------------------------------------------------- dados

def cabecalho(texto):
    meta = {}
    if texto.startswith("---\n"):
        fim = texto.index("\n---\n", 4)
        for linha in texto[4:fim].splitlines():
            m = re.match(r'^(\w+):\s*"?(.*?)"?\s*$', linha)
            if m:
                meta[m.group(1)] = m.group(2)
        texto = texto[fim + 5:]
    return meta, texto


def converter_lei(texto):
    """Lista de nós: h (título), r (rubrica), p (texto solto), a (artigo com parágrafos)."""
    nos, art, vistos, prefixo = [], None, {}, ""
    terminou = False
    for bloco in re.split(r"\n\s*\n", texto):
        bloco = " ".join(l.strip() for l in bloco.strip().splitlines())
        if not bloco:
            continue
        h = re.match(r"^(#{1,6})\s+(.*)$", bloco)
        if h:
            nivel, titulo = len(h.group(1)), h.group(2).strip()
            if nivel == 1 and not nos:
                continue  # título do arquivo, já vai no cabeçalho
            if "TRANSITÓRIAS" in titulo.upper() and nivel == 1:
                prefixo = "adct-"
            nos.append({"t": "h", "l": nivel, "x": titulo})
            art = None
            terminou = False
            continue
        m = ART.match(bloco)
        if m and not terminou:
            base = m.group(1).rstrip(".")
            num = base.replace(".", "") + ("-" + m.group(2) if m.group(2) else "")
            ident = prefixo + num
            vistos[ident] = vistos.get(ident, 0) + 1
            if vistos[ident] > 1:
                ident += "~" + str(vistos[ident])
            rotulo = base + ("-" + m.group(2) if m.group(2) else "")
            # rubrica em negrito ("Homicídio simples") é do artigo seguinte, não do anterior
            if art is not None and len(art["p"]) > 1 and RUBRICA.match(art["p"][-1]):
                nos.append({"t": "r", "x": art["p"].pop()})
            art = {"t": "a", "id": ident, "n": rotulo, "p": [bloco]}
            nos.append(art)
            continue
        if FECHO.match(bloco):
            terminou = True
            art = None
        if art is not None:
            art["p"].append(bloco)
        else:
            nos.append({"t": "r" if RUBRICA.match(bloco) else "p", "x": bloco})
    return nos


def sumulas(raiz):
    out = []
    for f in sorted((raiz / "jurisprudencia/stf/sumulas-vinculantes").glob("*.md")):
        meta, corpo = cabecalho(f.read_text(encoding="utf-8"))
        m = re.search(r"## Questão\s*\n(.*?)\n## ", corpo, re.S)
        out.append({
            "tr": "SV", "n": int(meta["numero"]), "x": " ".join(m.group(1).split()),
            "cancelada": meta.get("situacao") != "APROVADO", "assunto": "",
        })
    for trib, pasta in (("STF", "stf"), ("STJ", "stj")):
        for f in sorted((raiz / f"jurisprudencia/{pasta}/sumulas").glob("*.md")):
            meta, corpo = cabecalho(f.read_text(encoding="utf-8"))
            linhas = [l.strip() for l in corpo.splitlines() if l.strip() and not PAGINA.match(l.strip())]
            assunto = ""
            if trib == "STF":
                ini = next(i for i, l in enumerate(linhas) if re.match(r"^SÚMULA\s+\d", l, re.I)) + 1
                fim = next((i for i in range(ini, len(linhas)) if linhas[i].startswith(("Data de Aprovação", "Observação", "Precedentes", "Referência"))), len(linhas))
            else:
                if "Enunciado" not in linhas:
                    continue
                i_s = next(i for i, l in enumerate(linhas) if re.match(r"^Súmula\s+\d", l, re.I))
                if linhas[i_s + 1] != "Enunciado":
                    assunto = linhas[i_s + 1]
                ini = linhas.index("Enunciado") + 1
                fim = next((i for i in range(ini, len(linhas)) if linhas[i].startswith(("Órgão Julgador", "Data da Decisão"))), len(linhas))
            texto = " ".join(linhas[ini:fim])
            if texto.isupper():
                texto = texto.capitalize()
            cancelada = meta.get("revogada") == "true" or bool(re.search(r"\b(CANCELADA|REVOGADA)\b", " ".join(linhas[:ini + 2])))
            out.append({"tr": trib, "n": int(meta["numero"]), "x": texto, "cancelada": cancelada, "assunto": assunto.title() if assunto.isupper() else assunto})
    out.sort(key=lambda s: ("SV STF STJ".split().index(s["tr"]), s["n"]))
    return out


def dados():
    fonte = FONTE / "md"
    commit = json.loads((FONTE / "commit.json").read_text(encoding="utf-8"))
    shutil.rmtree(DADOS, ignore_errors=True)
    DADOS.mkdir(parents=True)
    leis = []
    for ident, sigla, nome, curto, grupo, cor, caminho in LEIS:
        meta, corpo = cabecalho((fonte / caminho).read_text(encoding="utf-8"))
        nos = converter_lei(corpo)
        arts = sum(1 for n in nos if n["t"] == "a")
        info = {
            "id": ident, "sigla": sigla, "nome": nome, "curto": curto, "grupo": grupo, "cor": cor,
            "titulo": meta.get("titulo", "Constituição da República Federativa do Brasil de 1988"),
            "ementa": meta.get("ementa", ""),
            "fonte": meta.get("fonte", "https://www.planalto.gov.br/ccivil_03/constituicao/constituicaocompilado.htm"),
            "baixado": meta.get("baixado_em", commit["data"]), "artigos": arts,
        }
        leis.append(info)
        (DADOS / f"{ident}.json").write_text(json.dumps({**info, "nos": nos}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{sigla:10} {arts:5} artigos")
    sums = sumulas(fonte)
    (DADOS / "sumulas.json").write_text(json.dumps(sums, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    contagem = {t: sum(1 for s in sums if s["tr"] == t) for t in ("SV", "STF", "STJ")}
    indice = {"commit": commit["sha"][:10], "atualizado": commit["data"], "sumulas": contagem, "leis": leis}
    (DADOS / "indice.json").write_text(json.dumps(indice, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("súmulas", contagem)


# ---------------------------------------------------------------- ícones (PNG sem dependências)

def png(caminho, tam, mascaravel=False):
    """Uma folha de lei com abas coloridas na borda, como um vade mecum impresso."""
    fundo, papel, linha = (123, 30, 43), (250, 247, 242), (201, 190, 180)
    abas = [(31, 107, 69), (29, 79, 145), (163, 38, 47), (207, 106, 42), (196, 154, 18)]
    s = tam / 512

    def caixa(x, y, x0, y0, x1, y1, r):
        # cobertura (0..1) de um retângulo arredondado, com antisserrilhado nas bordas
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** .5
        return max(0.0, min(1.0, r - d + .5)) if r else float(x0 <= x < x1 and y0 <= y < y1)

    m = 0 if mascaravel else 1  # ícone comum tem cantos arredondados; o mascarável é quadrado cheio
    z = .82 if mascaravel else 1  # mascarável: desenho dentro da zona segura
    o = 256 * (1 - z)
    formas = [((0, 0, 512, 512, 96 * m), fundo)]
    for i, cor in enumerate(abas):
        y0 = o + (120 + i * 56) * z
        formas.append(((o + 340 * z, y0, o + 392 * z, y0 + 40 * z, 8 * z), cor))
    formas.append(((o + 132 * z, o + 96 * z, o + 360 * z, o + 416 * z, 14 * z), papel))
    for i in range(6):
        y0 = o + (150 + i * 40) * z
        larg = 170 if i % 3 != 2 else 110
        formas.append(((o + 166 * z, y0, o + (166 + larg) * z, y0 + 12 * z, 6 * z), linha))
    linhas_px = bytearray()
    for py in range(tam):
        linhas_px.append(0)
        for px in range(tam):
            x, y = (px + .5) / s, (py + .5) / s
            r = g = b = a = 0.0
            for (x0, y0, x1, y1, raio), cor in formas:
                if not (x0 - 1 <= x <= x1 + 1 and y0 - 1 <= y <= y1 + 1):
                    continue
                c = caixa(x, y, x0, y0, x1, y1, raio)
                if c:
                    r, g, b = (r * (1 - c) + cor[0] * c, g * (1 - c) + cor[1] * c, b * (1 - c) + cor[2] * c)
                    a = a + c * (1 - a)
            # nas bordas antisserrilhadas a cor ficou multiplicada pela cobertura: desfaz
            k = 1 / a if 0 < a < 1 else 1
            linhas_px += bytes((min(255, round(r * k)), min(255, round(g * k)), min(255, round(b * k)), round(a * 255)))
    def bloco(tipo, dados_):
        return struct.pack(">I", len(dados_)) + tipo + dados_ + struct.pack(">I", zlib.crc32(tipo + dados_))
    caminho.write_bytes(b"\x89PNG\r\n\x1a\n" + bloco(b"IHDR", struct.pack(">IIBBBBB", tam, tam, 8, 6, 0, 0, 0))
                        + bloco(b"IDAT", zlib.compress(bytes(linhas_px), 9)) + bloco(b"IEND", b""))


FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#7b1e2b"/>
<g><rect x="340" y="120" width="52" height="40" rx="8" fill="#1f6b45"/><rect x="340" y="176" width="52" height="40" rx="8" fill="#1d4f91"/><rect x="340" y="232" width="52" height="40" rx="8" fill="#a3262f"/><rect x="340" y="288" width="52" height="40" rx="8" fill="#cf6a2a"/><rect x="340" y="344" width="52" height="40" rx="8" fill="#c49a12"/></g>
<rect x="132" y="96" width="228" height="320" rx="14" fill="#faf7f2"/>
<g fill="#c9beb4"><rect x="166" y="150" width="170" height="12" rx="6"/><rect x="166" y="190" width="170" height="12" rx="6"/><rect x="166" y="230" width="110" height="12" rx="6"/><rect x="166" y="270" width="170" height="12" rx="6"/><rect x="166" y="310" width="170" height="12" rx="6"/><rect x="166" y="350" width="110" height="12" rx="6"/></g></svg>"""


# ---------------------------------------------------------------- site

CABECA_SITE = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Vade mecum gratuito: Constituição, códigos, leis e súmulas do STF e do STJ, com busca, marca-texto e anotações. Funciona sem internet.">
<meta name="theme-color" content="#ffffff">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icones/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Vade Mecum">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
"""

SW = """// Gerado por build.py. Guarda o app e todas as leis para funcionar sem internet.
const VERSAO = "__VERSAO__";
const CACHE = "vm-" + VERSAO;
const FONTES = "vm-fontes";
const ARQUIVOS = __ARQUIVOS__;
const CSS_FONTES = __CSS_FONTES__;

// fontes do Google: guarda já na instalação, para o app ficar igual sem internet desde o começo.
// Se falhar (sem rede, bloqueio), segue com as fontes do sistema.
async function guardarFontes() {
  const c = await caches.open(FONTES);
  for (const url of CSS_FONTES) {
    if (await c.match(url)) continue;
    const r = await fetch(url);
    if (!r.ok) continue;
    const css = await r.clone().text();
    const woffs = [...css.matchAll(/url\\((https:\\/\\/fonts\\.gstatic\\.com\\/[^)]+)\\)/g)].map(m => m[1]);
    await Promise.all(woffs.map(w => fetch(w, { mode: "cors" }).then(f => f.ok && c.put(w, f))));
    await c.put(url, r);
  }
}

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS))
    .then(() => guardarFontes().catch(() => {}))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith("vm-") && k !== CACHE && k !== FONTES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTES).then(async c => (await c.match(req, { ignoreVary: true })) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    // página: tenta a rede (para pegar versões novas), mas não espera mais que 3 s
    const rede = fetch(req).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put("./", r.clone())); return r; });
    const guardada = () => caches.match("./", { cacheName: CACHE }).then(r => r || caches.match("./"));
    e.respondWith(Promise.race([rede, new Promise(ok => setTimeout(ok, 3000))])
      .then(r => r || guardada())
      .catch(() => guardada()));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
"""


CODIGO = ["vade-mecum.html", "estilo.css", "app.js"]


def versao():
    """Muda sempre que o código ou os dados mudam: força o navegador a buscar de novo."""
    h = hashlib.sha256()
    for f in [RAIZ / c for c in CODIGO] + sorted(DADOS.glob("*.json")):
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


def carimbar(html, versao_, modo):
    """Grava versão e modo nas metas e nos ?v= do HTML-fonte."""
    novo = html.replace('<meta name="vm-versao" content="dev">', f'<meta name="vm-versao" content="{versao_}">')
    novo = novo.replace('<meta name="vm-modo" content="artifact">', f'<meta name="vm-modo" content="{modo}">')
    novo = novo.replace("?v=dev", f"?v={versao_}")
    assert f'content="{versao_}"' in novo and f'content="{modo}"' in novo and "?v=dev" not in novo
    return novo


def copiar_codigo(destino):
    shutil.copytree(DADOS, destino / "dados")
    for c in CODIGO[1:]:
        shutil.copy(RAIZ / c, destino / c)


def artifact():
    """Pasta pronta para publicar como artifact no claude.ai (página sem <html>, o claude.ai põe)."""
    destino = RAIZ / "artifact"
    v = versao()
    shutil.rmtree(destino, ignore_errors=True)
    destino.mkdir()
    copiar_codigo(destino)
    html = (RAIZ / "vade-mecum.html").read_text(encoding="utf-8")
    (destino / "vade-mecum.html").write_text(carimbar(html, v, "artifact"), encoding="utf-8")
    print(f"artifact/ pronto: versão {v}")


def site():
    v = versao()
    html = carimbar((RAIZ / "vade-mecum.html").read_text(encoding="utf-8"), v, "site")
    corte = html.index('<header class="topo">')
    cabeca, corpo = html[:corte], html[corte:]

    shutil.rmtree(SITE, ignore_errors=True)
    (SITE / "icones").mkdir(parents=True)
    copiar_codigo(SITE)
    (SITE / "index.html").write_text(CABECA_SITE + cabeca + "</head>\n<body>\n" + corpo + "\n</body>\n</html>\n", encoding="utf-8")
    (SITE / "favicon.svg").write_text(FAVICON, encoding="utf-8")
    png(SITE / "icones/icone-192.png", 192)
    png(SITE / "icones/icone-512.png", 512)
    png(SITE / "icones/mascaravel-512.png", 512, mascaravel=True)
    png(SITE / "icones/apple-touch-icon.png", 180, mascaravel=True)
    manifesto = {
        "name": "Vade Mecum Aberto", "short_name": "Vade Mecum", "lang": "pt-BR",
        "description": "Constituição, códigos, leis e súmulas com busca, marca-texto e anotações.",
        "id": "./", "start_url": "./", "scope": "./", "display": "standalone",
        "categories": ["education", "books", "productivity"],
        "background_color": "#f4f5f2", "theme_color": "#ffffff",
        "icons": [
            {"src": "icones/icone-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icones/icone-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "icones/mascaravel-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
        "shortcuts": [
            {"name": "Constituição Federal", "short_name": "Constituição", "url": "./#cf", "icons": [{"src": "icones/icone-192.png", "sizes": "192x192"}]},
            {"name": "Súmulas do STF e do STJ", "short_name": "Súmulas", "url": "./#sumulas", "icons": [{"src": "icones/icone-192.png", "sizes": "192x192"}]},
            {"name": "Meus grifos", "short_name": "Grifos", "url": "./#grifos", "icons": [{"src": "icones/icone-192.png", "sizes": "192x192"}]},
        ],
    }
    (SITE / "manifest.webmanifest").write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")
    arquivos = ["./", "manifest.webmanifest", "favicon.svg", "icones/icone-192.png", "icones/apple-touch-icon.png"]
    arquivos += [f"{c}?v={v}" for c in CODIGO[1:]]
    arquivos += [f"dados/{f.name}?v={v}" for f in sorted(DADOS.glob("*.json"))]
    css_fontes = re.findall(r'href="(https://fonts\.googleapis\.com/css2[^"]+)"', html)
    sw = SW.replace("__VERSAO__", v).replace("__ARQUIVOS__", json.dumps(arquivos)).replace("__CSS_FONTES__", json.dumps(css_fontes))
    (SITE / "sw.js").write_text(sw, encoding="utf-8")
    tamanho = sum(f.stat().st_size for f in SITE.rglob("*") if f.is_file())
    print(f"site/ pronto: versão {v}, {tamanho / 1e6:.1f} MB")


ETAPAS = {"baixar": baixar, "dados": dados, "site": site, "artifact": artifact}

if __name__ == "__main__":
    etapa, *resto = sys.argv[1:] or ["tudo"]
    if etapa not in (*ETAPAS, "tudo"):
        sys.exit(__doc__)
    for nome, funcao in ETAPAS.items():
        if etapa in (nome, "tudo"):
            funcao(*resto[:1]) if nome == "baixar" else funcao()
