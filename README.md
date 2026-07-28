# Albert OCR — Albert API OCR

**Albert API OCR** est une interface web pour l’OCR de PDF avec le modèle
`openweight-ocr` d’Albert API (DINUM / Etalab). Chaque page est rendue
localement dans le navigateur, puis envoyée à l’API&nbsp;: vous obtenez un
texte exploitable sans installer de logiciel. La clé API reste dans la session
du navigateur.

Site en ligne&nbsp;: https://xiaoouwang.github.io/albert_pdf_ocr/

---

## Notes sur GitHub Pages

GitHub Pages ne peut héberger que des fichiers **statiques**. Albert API
n’envoie **pas** d’en-têtes CORS&nbsp;: une page sur `*.github.io` ne peut donc
pas appeler directement `https://albert.api.etalab.gouv.fr`.

## Solution&nbsp;: site statique + proxy CORS gratuit

```text
Navigateur (GitHub Pages)  →  Cloudflare Worker (CORS)  →  Albert API
```

La clé API reste dans le navigateur de l’utilisateur. Le Worker se contente de
relayer la requête.

### 1. Déployer le Worker (une fois, gratuit)

Depuis ce dossier `web/`&nbsp;:

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```

Copiez l’URL affichée par Wrangler, par exemple
`https://albert-ocr-proxy.<sous-domaine>.workers.dev`

### 2. Pointer l’interface vers le Worker

Modifiez `config.js`&nbsp;:

```js
window.ALBERT_OCR_CONFIG = {
  proxyUrl: "https://albert-ocr-proxy.<sous-domaine>.workers.dev",
};
```

### 3. Publier sur GitHub Pages

1. Poussez le contenu de `web/` dans un dépôt (racine, dossier `/docs`, ou
   branche `gh-pages`).
2. Settings → Pages → déployer depuis ce dossier / cette branche.
3. Ajoutez un fichier `.nojekyll` vide (déjà inclus) pour que Pages serve les
   fichiers tels quels.

Pour un site projet (`https://USER.github.io/REPO/`), placez les fichiers de
`web/` à la racine du dépôt, ou activez Pages depuis `/docs` après y avoir
copié ces fichiers.

### Développement local (sans Cloudflare)

```bash
python3 server.py
# ouvrir http://127.0.0.1:8765/
```

Laissez `proxyUrl` vide&nbsp;: l’interface utilise alors la route locale
`/proxy/...`.

## Correctif à plus long terme

Demander aux mainteneurs d’Albert API d’ajouter des en-têtes CORS sur
`/v1/chat/completions` (par ex. autoriser les origines navigateur). GitHub Pages
suffirait alors seul, et le Worker deviendrait optionnel.
