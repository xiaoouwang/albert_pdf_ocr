import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const MODEL = "openweight-ocr";
const KEY_STORAGE = "albert_ocr_api_key";
const PROXY_STORAGE = "albert_ocr_proxy_url";
const ALBERT_DIRECT = "https://albert.api.etalab.gouv.fr/v1/chat/completions";

const apiKeyInput = document.getElementById("apiKey");
const proxyUrlInput = document.getElementById("proxyUrl");
const pdfInput = document.getElementById("pdfInput");
const dropzone = document.getElementById("dropzone");
const fileName = document.getElementById("fileName");
const maxPagesInput = document.getElementById("maxPages");
const dpiInput = document.getElementById("dpi");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const outputEl = document.getElementById("output");
const previewsEl = document.getElementById("previews");

/** @type {{ name: string, bytes: Uint8Array } | null} */
let pdfDoc = null;
let lastMarkdown = "";
let running = false;

const configProxy =
  (window.ALBERT_OCR_CONFIG && window.ALBERT_OCR_CONFIG.proxyUrl) || "";

apiKeyInput.value = sessionStorage.getItem(KEY_STORAGE) || "";
proxyUrlInput.value =
  localStorage.getItem(PROXY_STORAGE) || configProxy || defaultLocalProxy();

// Prevent the browser from navigating to / opening a dropped PDF (page reload).
["dragover", "drop"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
  });
});

apiKeyInput.addEventListener("change", () => {
  sessionStorage.setItem(KEY_STORAGE, apiKeyInput.value.trim());
  syncRunEnabled();
});
apiKeyInput.addEventListener("input", syncRunEnabled);

// Block Enter from doing anything surprising in number/text fields.
[apiKeyInput, proxyUrlInput, maxPagesInput, dpiInput].forEach((el) => {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });
});

proxyUrlInput.addEventListener("change", () => {
  localStorage.setItem(PROXY_STORAGE, proxyUrlInput.value.trim());
});

pdfInput.addEventListener("change", () => {
  if (running) {
    // Ignore mid-OCR file-picker noise (cancel / re-open).
    pdfInput.value = "";
    return;
  }
  const file = pdfInput.files?.[0];
  if (file) {
    void setPdfFromFile(file);
  }
  // Cancelled picker → empty FileList: keep the current PDF.
  pdfInput.value = "";
});

dropzone.addEventListener("click", () => {
  if (running) return;
  pdfInput.click();
});

dropzone.addEventListener("keydown", (event) => {
  if (running) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    pdfInput.click();
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!running) dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (event) => {
  if (running) {
    setStatus("OCR en cours — attendez la fin avant de changer de PDF.", "error");
    return;
  }
  const file = event.dataTransfer?.files?.[0];
  if (file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    void setPdfFromFile(file);
  } else {
    setStatus("Déposez un fichier PDF.", "error");
  }
});

runBtn.addEventListener("click", () => {
  void runOcr();
});

clearBtn.addEventListener("click", () => {
  if (running) return;
  pdfDoc = null;
  pdfInput.value = "";
  fileName.textContent = "";
  maxPagesInput.value = "";
  maxPagesInput.removeAttribute("max");
  lastMarkdown = "";
  outputEl.textContent = "";
  previewsEl.innerHTML = "";
  progressBar.style.width = "0%";
  copyBtn.disabled = true;
  document.body.classList.remove("is-running");
  setStatus("");
  syncRunEnabled();
});

copyBtn.addEventListener("click", async () => {
  if (!lastMarkdown) return;
  await navigator.clipboard.writeText(lastMarkdown);
  setStatus("Résultat copié dans le presse-papiers.", "ok");
});

function isLocalHost() {
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === ""
  );
}

function defaultLocalProxy() {
  return isLocalHost() ? `${location.origin}/proxy/v1/chat/completions` : "";
}

function resolveEndpoint() {
  const proxy = proxyUrlInput.value.trim().replace(/\/$/, "");
  if (!proxy) {
    return ALBERT_DIRECT;
  }
  if (
    proxy.endsWith("/v1/chat/completions") ||
    proxy.endsWith("/proxy/v1/chat/completions")
  ) {
    return proxy;
  }
  return proxy;
}

async function setPdfFromFile(file) {
  try {
    // Copy bytes immediately so we don't depend on a live File/FileList.
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pageCount = pdf.numPages;

    pdfDoc = { name: file.name, bytes, pageCount };
    fileName.textContent = `${file.name} · ${pageCount} page${pageCount > 1 ? "s" : ""}`;
    maxPagesInput.value = String(pageCount);
    maxPagesInput.max = String(pageCount);
    setStatus("");
    syncRunEnabled();
  } catch (error) {
    pdfDoc = null;
    fileName.textContent = "";
    maxPagesInput.value = "";
    maxPagesInput.removeAttribute("max");
    setStatus(error.message || String(error), "error");
    syncRunEnabled();
  }
}

function syncRunEnabled() {
  runBtn.disabled = running || !(apiKeyInput.value.trim() && pdfDoc);
  clearBtn.disabled = running;
  dropzone.classList.toggle("disabled", running);
  pdfInput.disabled = running;
}

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
}

async function renderPageToJpeg(page, dpi) {
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    dataUrl,
    base64: dataUrl.split(",", 2)[1],
  };
}

function corsHelpMessage(error) {
  const msg = error && error.message ? error.message : String(error);
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    msg.includes("CORS")
  ) {
    return (
      "Échec réseau/CORS : GitHub Pages ne peut pas appeler Albert directement. " +
      "Déployez le Cloudflare Worker (voir README) et collez son URL dans « Proxy CORS »."
    );
  }
  return msg;
}

async function ocrImage(apiKey, imageBase64) {
  const endpoint = resolveEndpoint();
  if (!proxyUrlInput.value.trim() && !isLocalHost()) {
    throw new Error(
      "Proxy CORS requis pour GitHub Pages. Déployez web/worker.js avec Wrangler, " +
        "puis renseignez l’URL du Worker (ou config.js → proxyUrl)."
    );
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.2,
        top_p: 0.9,
      }),
    });
  } catch (error) {
    throw new Error(corsHelpMessage(error));
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload.detail ||
      payload.error?.message ||
      JSON.stringify(payload) ||
      response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  return payload.choices?.[0]?.message?.content || "";
}

async function runOcr() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey || !pdfDoc || running) return;

  sessionStorage.setItem(KEY_STORAGE, apiKey);
  localStorage.setItem(PROXY_STORAGE, proxyUrlInput.value.trim());
  running = true;
  document.body.classList.add("is-running");
  syncRunEnabled();
  copyBtn.disabled = true;
  lastMarkdown = "";
  outputEl.textContent = "";
  previewsEl.innerHTML = "";
  setProgress(0, 1);
  setStatus("Chargement du PDF…");

  try {
    // Pass a copy: pdf.js may transfer/detach the buffer.
    const data = pdfDoc.bytes.slice();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const maxPages = Math.min(
      pdf.numPages,
      Math.max(1, Number(maxPagesInput.value) || pdf.numPages)
    );
    const dpi = Math.min(300, Math.max(96, Number(dpiInput.value) || 300));
    const parts = [];

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      setStatus(`Rendu page ${pageNumber}/${maxPages}…`);
      const page = await pdf.getPage(pageNumber);
      const { dataUrl, base64 } = await renderPageToJpeg(page, dpi);

      const figure = document.createElement("figure");
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = `Page ${pageNumber}`;
      const caption = document.createElement("figcaption");
      caption.textContent = `Page ${pageNumber}`;
      figure.append(img, caption);
      previewsEl.append(figure);

      setStatus(`OCR page ${pageNumber}/${maxPages}…`);
      const text = (await ocrImage(apiKey, base64)).trim();
      parts.push(`## Page ${pageNumber - 1}\n\n${text}`);
      lastMarkdown = parts.join("\n\n");
      outputEl.textContent = lastMarkdown;
      setProgress(pageNumber, maxPages);
    }

    copyBtn.disabled = !lastMarkdown;
    setStatus(`Terminé — ${maxPages} page(s) traitée(s).`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error), "error");
  } finally {
    running = false;
    document.body.classList.remove("is-running");
    syncRunEnabled();
  }
}

syncRunEnabled();
