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
const folderInput = document.getElementById("folderInput");
const folderBtn = document.getElementById("folderBtn");
const dropzone = document.getElementById("dropzone");
const fileName = document.getElementById("fileName");
const fileListEl = document.getElementById("fileList");
const maxPagesInput = document.getElementById("maxPages");
const dpiInput = document.getElementById("dpi");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const exportMdBtn = document.getElementById("exportMdBtn");
const exportZipBtn = document.getElementById("exportZipBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const outputEl = document.getElementById("output");

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   relativePath: string,
 *   bytes: Uint8Array,
 *   pageCount: number,
 *   status: "queued" | "running" | "done" | "error",
 *   message: string,
 *   markdown: string,
 *   pages: { index: number, text: string, dataUrl: string }[],
 * }} PdfJob
 */

/** @type {PdfJob[]} */
let jobs = [];
let running = false;
let jobSeq = 0;

const configProxy =
  (window.ALBERT_OCR_CONFIG && window.ALBERT_OCR_CONFIG.proxyUrl) || "";

apiKeyInput.value = sessionStorage.getItem(KEY_STORAGE) || "";
proxyUrlInput.value =
  localStorage.getItem(PROXY_STORAGE) || configProxy || defaultLocalProxy();

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

[apiKeyInput, proxyUrlInput, maxPagesInput, dpiInput].forEach((el) => {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });
});

proxyUrlInput.addEventListener("change", () => {
  localStorage.setItem(PROXY_STORAGE, proxyUrlInput.value.trim());
});

pdfInput.addEventListener("change", () => {
  if (running) {
    pdfInput.value = "";
    return;
  }
  if (pdfInput.files?.length) {
    void addFiles([...pdfInput.files]);
  }
  pdfInput.value = "";
});

folderBtn?.addEventListener("click", () => {
  if (running) return;
  folderInput?.click();
});

folderInput?.addEventListener("change", () => {
  if (running) {
    folderInput.value = "";
    return;
  }
  if (folderInput.files?.length) {
    void addFiles([...folderInput.files]);
  }
  folderInput.value = "";
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
    setStatus("OCR en cours — attendez la fin avant d’ajouter des fichiers.", "error");
    return;
  }
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length) {
    void addFiles(files);
  } else {
    setStatus("Déposez un ou plusieurs PDF (ou un dossier).", "error");
  }
});

runBtn.addEventListener("click", () => {
  void runBatch();
});

clearBtn.addEventListener("click", () => {
  if (running) return;
  jobs = [];
  pdfInput.value = "";
  folderInput.value = "";
  fileName.textContent = "";
  fileListEl.innerHTML = "";
  maxPagesInput.value = "";
  maxPagesInput.removeAttribute("max");
  outputEl.innerHTML = "";
  progressBar.style.width = "0%";
  if (progressLabel) progressLabel.textContent = "0%";
  document.body.classList.remove("is-running");
  setStatus("");
  syncRunEnabled();
});

copyBtn.addEventListener("click", async () => {
  const markdown = buildCombinedMarkdown();
  if (!markdown) return;
  await navigator.clipboard.writeText(markdown);
  setStatus("Résultat copié dans le presse-papiers.", "ok");
});

exportMdBtn?.addEventListener("click", () => {
  void exportMarkdownFiles();
});

exportJsonBtn.addEventListener("click", () => {
  const payload = {
    model: MODEL,
    exportedAt: new Date().toISOString(),
    documents: jobs
      .filter((job) => job.status === "done")
      .map((job) => ({
        name: job.name,
        relativePath: job.relativePath,
        pageCount: job.pageCount,
        markdown: job.markdown,
        pages: job.pages.map((page) => ({
          index: page.index,
          text: page.text,
        })),
      })),
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
    "albert-ocr-results.json"
  );
});

exportZipBtn?.addEventListener("click", async () => {
  const done = jobs.filter((job) => job.status === "done" && job.markdown);
  if (!done.length) return;

  setStatus("Préparation du ZIP…");
  try {
    const { default: JSZip } = await import(
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm"
    );
    const zip = new JSZip();
    const used = new Set();
    for (const job of done) {
      const path = uniqueZipPath(job, used);
      zip.file(path, job.markdown);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "albert-ocr-results.zip");
    setStatus(`ZIP exporté — ${done.length} fichier(s).`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(error.message || String(error), "error");
  }
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
  if (!proxy) return ALBERT_DIRECT;
  return proxy;
}

function isPdfFile(file) {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function safeBaseName(name) {
  return name.replace(/\.pdf$/i, "").replace(/[^\w.\-]+/g, "_") || "document";
}

function uniqueZipPath(job, used) {
  const relative = (job.relativePath || job.name).replace(/\\/g, "/");
  let base = relative.toLowerCase().endsWith(".pdf")
    ? relative.slice(0, -4)
    : relative;
  base = base.replace(/^\.?\//, "") || safeBaseName(job.name);
  let path = `${base}.md`;
  let i = 2;
  while (used.has(path.toLowerCase())) {
    path = `${base}-${i}.md`;
    i += 1;
  }
  used.add(path.toLowerCase());
  return path;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadPdfDocument(bytes) {
  try {
    return await pdfjsLib.getDocument({
      data: bytes.slice(),
      isOffscreenCanvasSupported: false,
    }).promise;
  } catch (error) {
    // Fallback if the CDN worker fails to start.
    console.warn("PDF.js worker failed, retrying without worker", error);
    return await pdfjsLib.getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  }
}

async function addFiles(fileList) {
  const pdfs = fileList.filter(isPdfFile);
  if (!pdfs.length) {
    setStatus("Aucun PDF trouvé dans la sélection.", "error");
    syncRunEnabled();
    return;
  }

  setStatus(`Chargement de ${pdfs.length} PDF…`);
  let added = 0;
  let maxPagesAcross = 0;

  for (const file of pdfs) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const pdf = await loadPdfDocument(bytes);
      const pageCount = pdf.numPages;
      const relativePath =
        file.webkitRelativePath && file.webkitRelativePath.length
          ? file.webkitRelativePath
          : file.name;

      const duplicate = jobs.some(
        (job) =>
          job.relativePath === relativePath && job.bytes.length === bytes.length
      );
      if (duplicate) continue;

      jobSeq += 1;
      jobs.push({
        id: `job-${jobSeq}`,
        name: file.name,
        relativePath,
        bytes,
        pageCount,
        status: "queued",
        message: "En file",
        markdown: "",
        pages: [],
      });
      added += 1;
      maxPagesAcross = Math.max(maxPagesAcross, pageCount);
    } catch (error) {
      console.error(error);
      jobSeq += 1;
      jobs.push({
        id: `job-${jobSeq}`,
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(),
        pageCount: 0,
        status: "error",
        message: error.message || String(error),
        markdown: "",
        pages: [],
      });
      setStatus(`Impossible de lire ${file.name}: ${error.message}`, "error");
    }
  }

  if (maxPagesAcross > 0) {
    if (!maxPagesInput.value) {
      maxPagesInput.value = String(maxPagesAcross);
    }
    const currentMax = Math.max(
      maxPagesAcross,
      Number(maxPagesInput.max) || 0,
      Number(maxPagesInput.value) || 0
    );
    maxPagesInput.max = String(currentMax);
  }

  renderFileList();
  syncRunEnabled();
  if (added) {
    const needKey = !apiKeyInput.value.trim();
    setStatus(
      needKey
        ? `${jobs.filter((j) => j.status === "queued").length} PDF prêt(s) — entrez votre clé API pour lancer l’OCR.`
        : `${jobs.filter((j) => j.status === "queued").length} PDF en file (${added} ajouté${added > 1 ? "s" : ""}).`,
      needKey ? "" : "ok"
    );
  } else if (!jobs.some((j) => j.status === "queued")) {
    setStatus("Aucun PDF utilisable ajouté.", "error");
  }
}

function renderFileList() {
  fileListEl.innerHTML = "";
  const totalPages = jobs.reduce((sum, job) => sum + job.pageCount, 0);
  fileName.textContent = jobs.length
    ? `${jobs.length} PDF · ${totalPages} page${totalPages > 1 ? "s" : ""}`
    : "";

  for (const job of jobs) {
    const li = document.createElement("li");
    li.dataset.jobId = job.id;
    li.classList.toggle("is-active", job.status === "running");
    li.classList.toggle("is-done", job.status === "done");
    li.classList.toggle("is-error", job.status === "error");

    const title = document.createElement("span");
    title.textContent = job.relativePath || job.name;

    const meta = document.createElement("span");
    meta.className = "file-meta";
    meta.textContent = `${job.pageCount} p.`;

    const status = document.createElement("span");
    status.className = "file-status";
    status.textContent = job.message;

    li.append(title, meta, status);
    fileListEl.append(li);
  }
}

function syncRunEnabled() {
  const hasJobs = jobs.some(
    (job) => job.status === "queued" || job.status === "error"
  );
  const hasQueuedBytes = jobs.some(
    (job) => job.status === "queued" && job.bytes.length > 0
  );
  const hasKey = Boolean(apiKeyInput.value.trim());
  const hasResults = jobs.some((job) => job.status === "done" && job.markdown);
  const canRun = !running && hasKey && hasQueuedBytes;

  runBtn.disabled = !canRun;
  if (!canRun && !running) {
    if (!hasQueuedBytes && hasJobs) {
      runBtn.title = "Aucun PDF valide en file d’attente";
    } else if (!hasQueuedBytes) {
      runBtn.title = "Ajoutez au moins un PDF";
    } else if (!hasKey) {
      runBtn.title = "Entrez votre clé API Albert";
    } else {
      runBtn.title = "";
    }
  } else {
    runBtn.title = "";
  }

  clearBtn.disabled = running;
  dropzone.classList.toggle("disabled", running);
  pdfInput.disabled = running;
  if (folderBtn) folderBtn.disabled = running;
  if (folderInput) folderInput.disabled = running;
  copyBtn.disabled = !hasResults;
  if (exportMdBtn) exportMdBtn.disabled = !hasResults;
  if (exportZipBtn) exportZipBtn.disabled = !hasResults;
  if (exportJsonBtn) exportJsonBtn.disabled = !hasResults;
}

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  if (progressLabel) {
    progressLabel.textContent = `${pct}%`;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCombinedMarkdown() {
  return jobs
    .filter((job) => job.status === "done" && job.markdown)
    .map((job) => `# ${job.relativePath || job.name}\n\n${job.markdown}`)
    .join("\n\n---\n\n");
}

function doneJobs() {
  return jobs.filter((job) => job.status === "done" && job.markdown);
}

async function exportMarkdownFiles() {
  const done = doneJobs();
  if (!done.length) return;

  // Download one .md per PDF (same separation as ZIP entries).
  // Avoid showDirectoryPicker: browsers often block system folders (Downloads, etc.).
  const used = new Set();
  for (let i = 0; i < done.length; i += 1) {
    const path = uniqueZipPath(done[i], used).replace(/\//g, "__");
    downloadBlob(
      new Blob([done[i].markdown], { type: "text/markdown;charset=utf-8" }),
      path
    );
    // Stagger downloads so the browser does not block them.
    if (i < done.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  setStatus(`Markdown exporté — ${done.length} fichier(s).`, "ok");
}

function renderResults() {
  const items = jobs.filter(
    (job) =>
      job.status === "done" ||
      job.status === "running" ||
      job.status === "error"
  );
  if (!items.length) {
    outputEl.innerHTML = "";
    return;
  }

  outputEl.innerHTML = items
    .map((job) => {
      const pagesDone = job.pages.length;
      let detail = "";
      if (job.status === "running") {
        detail = `OCR en cours… ${pagesDone} page(s) traitée(s)`;
      } else if (job.status === "done") {
        detail = `Terminé — ${pagesDone} page(s). Utilisez l’export pour récupérer le texte.`;
      } else {
        detail = job.message || "Erreur";
      }
      return (
        `<article class="doc-block">` +
        `<h3 class="doc-title">${escapeHtml(job.relativePath || job.name)}</h3>` +
        `<p class="doc-summary">${escapeHtml(detail)}</p>` +
        `</article>`
      );
    })
    .join("");
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

async function ocrJob(apiKey, job, dpi, maxPagesPerPdf, progress) {
  job.status = "running";
  job.message = "Démarrage…";
  job.pages = [];
  job.markdown = "";
  renderFileList();

  const pdf = await loadPdfDocument(job.bytes);
  const maxPages = Math.min(
    pdf.numPages,
    Math.max(1, maxPagesPerPdf || pdf.numPages)
  );
  const parts = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const pctLocal = Math.round((pageNumber / maxPages) * 100);
    job.message = `${pctLocal}% (page ${pageNumber}/${maxPages})`;
    renderFileList();
    setStatus(
      `${job.relativePath || job.name} — ${pctLocal}%`
    );

    const page = await pdf.getPage(pageNumber);
    const { base64 } = await renderPageToJpeg(page, dpi);

    const text = (await ocrImage(apiKey, base64)).trim();
    job.pages.push({ index: pageNumber - 1, text, dataUrl: "" });
    parts.push(`## Page ${pageNumber - 1}\n\n${text}`);
    job.markdown = parts.join("\n\n");

    progress.done += 1;
    setProgress(progress.done, progress.total);
    renderResults();
  }

  job.status = "done";
  job.message = `Terminé (${maxPages} p.)`;
  renderFileList();
}

async function runBatch() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey || !jobs.length || running) return;

  sessionStorage.setItem(KEY_STORAGE, apiKey);
  localStorage.setItem(PROXY_STORAGE, proxyUrlInput.value.trim());
  running = true;
  document.body.classList.add("is-running");
  syncRunEnabled();
  outputEl.innerHTML = "";
  setProgress(0, 1);

  const dpi = Math.min(300, Math.max(96, Number(dpiInput.value) || 300));
  const maxPagesPerPdf = Number(maxPagesInput.value) || 0;
  const pending = jobs.filter(
    (job) =>
      job.bytes.length > 0 &&
      (job.status === "queued" || job.status === "error")
  );

  // Re-queue previous errors when relaunching.
  for (const job of pending) {
    job.status = "queued";
    job.message = "En file";
    job.markdown = "";
    job.pages = [];
  }
  renderFileList();

  const toProcess = jobs.filter(
    (job) => job.status === "queued" && job.bytes.length > 0
  );
  const progress = {
    done: 0,
    total: toProcess.reduce((sum, job) => {
      const pages = Math.min(
        job.pageCount,
        Math.max(1, maxPagesPerPdf || job.pageCount)
      );
      return sum + pages;
    }, 0),
  };
  setProgress(0, progress.total || 1);

  try {
    for (const job of toProcess) {
      try {
        await ocrJob(apiKey, job, dpi, maxPagesPerPdf, progress);
      } catch (error) {
        console.error(error);
        job.status = "error";
        job.message = error.message || String(error);
        renderFileList();
      }
    }

    const doneCount = jobs.filter((job) => job.status === "done").length;
    const errorCount = jobs.filter((job) => job.status === "error").length;
    if (errorCount && doneCount) {
      setStatus(
        `Terminé avec erreurs — ${doneCount} OK, ${errorCount} échec(s).`,
        "error"
      );
    } else if (errorCount) {
      setStatus(`Échec — ${errorCount} fichier(s).`, "error");
    } else {
      setStatus(
        `Terminé — ${doneCount} PDF, ${progress.done} page(s).`,
        "ok"
      );
    }
  } finally {
    running = false;
    document.body.classList.remove("is-running");
    syncRunEnabled();
  }
}

syncRunEnabled();
