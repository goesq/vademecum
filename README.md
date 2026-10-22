# Vade Mecum Aberto

Vade mecum gratuito no navegador: Constituição Federal, os principais códigos, leis especiais e as súmulas do STF e do STJ, com busca, marca-texto, favoritos e anotações. Pode ser instalado no celular como app e funciona sem internet.

## O que tem

- Constituição Federal; CC, CPC, CP, CPP, CLT, CDC e CTN; ECA, LINDB, Estatuto da OAB, Juizados Especiais, LEP, Lei de Drogas, Maria da Penha, Crimes Hediondos, Improbidade, Processo Administrativo e Mandado de Segurança.
- Súmulas vinculantes, súmulas do STF e do STJ.
- Leis federais no texto compilado (vigente).

Os grifos e anotações ficam salvos no próprio aparelho. Na tela "Meus grifos" dá para exportar um backup e importá-lo em outro aparelho.

## De onde vêm os textos

Do repositório [ctresb/leis](https://github.com/ctresb/leis), que converte as fontes oficiais (Planalto, normas.leg.br, STF, STJ, CNJ) para Markdown. Leis e decisões judiciais não são protegidas por direito autoral (Lei 9.610/98, art. 8º, IV).

A conversão é automática e não substitui a publicação oficial. Antes de citar, confira no link "Fonte oficial" de cada lei.

## Como funciona

O app são três arquivos: `vade-mecum.html` (estrutura), `estilo.css` e `app.js`. O mesmo código roda como site (GitHub Pages) e como artifact do claude.ai; a meta `vm-modo` diz qual.

`build.py` faz o resto, sem dependências além do Python 3:

```bash
python -I build.py tudo      # baixa as leis, gera dados/ e monta site/ e artifact/
python -I build.py baixar    # só baixa (aceita um commit: baixar <sha>)
python -I build.py dados     # só converte fonte/md em dados/*.json
python -I build.py site      # só monta site/ (instalável e offline)
python -I build.py artifact  # só monta artifact/ (para publicar no claude.ai)
```

Para ver localmente: `python -I -m http.server 8765 --directory site` e abra http://localhost:8765.

Para incluir outra lei, acrescente uma linha em `LEIS` no `build.py` com o caminho do arquivo no repositório ctresb/leis.

## Publicação

O workflow `.github/workflows/publicar.yml` monta e publica o site no GitHub Pages a cada push e toda segunda-feira, pegando a versão mais recente das leis. Na primeira vez, em Settings → Pages, escolha "GitHub Actions" como Source.
