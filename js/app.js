/* ============ Morphly — in-browser file conversion ============ */
/*
 * Images  → converted instantly with the Canvas API (png / jpg / webp)
 * Video, audio, gifs & exotic image formats → FFmpeg compiled to WebAssembly,
 * loaded lazily from a CDN the first time it's needed.
 * Nothing ever leaves the user's device.
 */

(() => {
  "use strict";

  // ---------- access gate ----------
  // Password is stored only as a SHA-256 hash; "remember me" keeps the
  // unlocked state in localStorage so returning visitors skip the prompt.

  const PASS_HASH = "3a54e2b634913ca0900f408fe466f548793cc5aab1d79c7c3b686d5bbec02cf1";
  const UNLOCK_KEY = "morphly_unlocked";

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function unlock() {
    document.body.classList.remove("locked");
  }

  (function initLock() {
    const form = document.getElementById("lock-form");
    const input = document.getElementById("lock-input");
    const remember = document.getElementById("lock-remember-check");
    const errorEl = document.getElementById("lock-error");
    const card = form;

    try {
      if (localStorage.getItem(UNLOCK_KEY) === PASS_HASH) {
        unlock();
        return;
      }
    } catch { /* storage unavailable — just show the prompt */ }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      let hash;
      try {
        hash = await sha256Hex(input.value);
      } catch {
        errorEl.textContent = "Unlock needs a secure (https) connection.";
        return;
      }
      if (hash === PASS_HASH) {
        if (remember.checked) {
          try { localStorage.setItem(UNLOCK_KEY, PASS_HASH); } catch { /* ignore */ }
        }
        unlock();
      } else {
        errorEl.textContent = "Wrong password — try again.";
        input.value = "";
        input.focus();
        card.classList.remove("shake");
        void card.offsetWidth; // restart the animation
        card.classList.add("shake");
      }
    });
  })();

  // ---------- format catalog ----------

  const KIND = { IMAGE: "image", VIDEO: "video", AUDIO: "audio" };

  const TARGETS = {
    [KIND.IMAGE]: ["png", "jpg", "webp", "gif", "bmp", "tiff"],
    [KIND.VIDEO]: ["mp4", "webm", "mov", "mkv", "avi", "gif", "mp3", "wav", "ogg"],
    [KIND.AUDIO]: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
  };

  // formats the Canvas API can encode natively — no FFmpeg needed
  const CANVAS_TARGETS = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

  const OUTPUT_MIME = {
    png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    bmp: "image/bmp", tiff: "image/tiff",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    mkv: "video/x-matroska", avi: "video/x-msvideo",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
    flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  };

  const EXT_KIND = {
    png: KIND.IMAGE, jpg: KIND.IMAGE, jpeg: KIND.IMAGE, webp: KIND.IMAGE,
    gif: KIND.IMAGE, bmp: KIND.IMAGE, tiff: KIND.IMAGE, tif: KIND.IMAGE,
    avif: KIND.IMAGE, svg: KIND.IMAGE, ico: KIND.IMAGE, heic: KIND.IMAGE,
    mp4: KIND.VIDEO, webm: KIND.VIDEO, mov: KIND.VIDEO, mkv: KIND.VIDEO,
    avi: KIND.VIDEO, flv: KIND.VIDEO, wmv: KIND.VIDEO, m4v: KIND.VIDEO,
    mpg: KIND.VIDEO, mpeg: KIND.VIDEO, ts: KIND.VIDEO, "3gp": KIND.VIDEO,
    mp3: KIND.AUDIO, wav: KIND.AUDIO, ogg: KIND.AUDIO, oga: KIND.AUDIO,
    flac: KIND.AUDIO, m4a: KIND.AUDIO, aac: KIND.AUDIO, wma: KIND.AUDIO,
    opus: KIND.AUDIO, aiff: KIND.AUDIO, amr: KIND.AUDIO,
  };

  const KIND_ICON = { [KIND.IMAGE]: "🖼️", [KIND.VIDEO]: "🎬", [KIND.AUDIO]: "🎵" };

  // FFmpeg argument sets per output format (input file is prepended by caller)
  function ffmpegArgs(target, inputKind) {
    switch (target) {
      case "mp4":
      case "mkv":
      case "mov":
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k"];
      case "webm":
        return ["-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime",
                "-cpu-used", "5", "-c:a", "libvorbis"];
      case "avi":
        return ["-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", "-q:a", "4"];
      case "gif":
        return inputKind === KIND.VIDEO
          ? ["-vf", "fps=12,scale=480:-2:flags=lanczos", "-loop", "0"]
          : [];
      case "mp3":
        return ["-vn", "-c:a", "libmp3lame", "-q:a", "2"];
      case "wav":
        return ["-vn", "-c:a", "pcm_s16le"];
      case "ogg":
        return ["-vn", "-c:a", "libvorbis", "-q:a", "5"];
      case "flac":
        return ["-vn", "-c:a", "flac"];
      case "m4a":
      case "aac":
        return ["-vn", "-c:a", "aac", "-b:a", "192k"];
      default:
        return []; // plain remux / image rewrite — let ffmpeg pick defaults
    }
  }

  // ---------- state ----------

  /** @type {Map<number, {file: File, kind: string, el: HTMLElement, busy: boolean, resultUrl?: string}>} */
  const items = new Map();
  let nextId = 1;

  // ---------- dom ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const dropzone = $("#dropzone");
  const fileInput = $("#file-input");
  const queueSection = $("#queue-section");
  const fileList = $("#file-list");
  const template = $("#file-item-template");
  const engineStatus = $("#engine-status");
  const engineStatusText = $("#engine-status-text");

  // ---------- hero word rotation ----------

  const WORDS = ["anything", "videos", "music", "images", "GIFs", "podcasts"];
  let wordIdx = 0;
  setInterval(() => {
    wordIdx = (wordIdx + 1) % WORDS.length;
    const el = $("#rotating-word");
    el.style.opacity = "0";
    setTimeout(() => {
      el.textContent = WORDS[wordIdx];
      el.style.transition = "opacity 0.4s ease";
      el.style.opacity = "1";
    }, 250);
  }, 2600);

  // ---------- ffmpeg engine (lazy singleton) ----------

  const FFMPEG_VERSION = "0.12.10";
  const CORE_VERSION = "0.12.6";
  let ffmpegPromise = null;
  let onFfmpegProgress = null; // progress callback for the job currently running

  function loadFFmpeg() {
    if (ffmpegPromise) return ffmpegPromise;

    ffmpegPromise = (async () => {
      if (!window.FFmpegWASM || !window.FFmpegUtil) {
        throw new Error("Conversion engine failed to load — check your connection and refresh.");
      }
      engineStatus.hidden = false;
      engineStatusText.textContent = "Downloading conversion engine (~30 MB, one time)…";

      const { FFmpeg } = window.FFmpegWASM;
      const { toBlobURL } = window.FFmpegUtil;
      const coreBase = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress }) => {
        if (onFfmpegProgress) onFfmpegProgress(progress);
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm"),
        classWorkerURL: await toBlobURL(
          `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/814.ffmpeg.js`,
          "text/javascript"
        ),
      });

      engineStatus.hidden = true;
      return ffmpeg;
    })().catch((err) => {
      engineStatus.hidden = true;
      ffmpegPromise = null; // allow retry
      throw err;
    });

    return ffmpegPromise;
  }

  // FFmpeg runs one job at a time — chain conversions through a queue
  let jobChain = Promise.resolve();
  function enqueueJob(job) {
    const run = jobChain.then(job, job);
    jobChain = run.catch(() => {});
    return run;
  }

  // ---------- helpers ----------

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : "";
  }

  function kindOf(file) {
    if (file.type.startsWith("image/")) return KIND.IMAGE;
    if (file.type.startsWith("video/")) return KIND.VIDEO;
    if (file.type.startsWith("audio/")) return KIND.AUDIO;
    return EXT_KIND[extOf(file.name)] || null;
  }

  function baseName(name) {
    return name.replace(/\.[a-z0-9]+$/i, "");
  }

  function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  // ---------- conversion ----------

  async function convertWithCanvas(file, target) {
    const mime = CANVAS_TARGETS[target];
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (target === "jpg") {
      // JPEG has no alpha — flatten onto white instead of black
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    if (!blob || blob.type !== mime) {
      throw new Error("canvas-unsupported"); // caller falls back to ffmpeg
    }
    return blob;
  }

  async function convertWithFFmpeg(file, target, kind, onProgress) {
    const ffmpeg = await loadFFmpeg();
    const { fetchFile } = window.FFmpegUtil;

    return enqueueJob(async () => {
      const inExt = extOf(file.name) || "bin";
      const inName = `input.${inExt}`;
      const outName = `output.${target}`;

      onFfmpegProgress = onProgress;
      try {
        await ffmpeg.writeFile(inName, await fetchFile(file));
        const code = await ffmpeg.exec(["-i", inName, ...ffmpegArgs(target, kind), outName]);
        if (code !== 0) throw new Error("FFmpeg could not convert this file.");
        const data = await ffmpeg.readFile(outName);
        return new Blob([data.buffer], { type: OUTPUT_MIME[target] || "application/octet-stream" });
      } finally {
        onFfmpegProgress = null;
        // best-effort cleanup of the in-memory FS
        for (const n of [inName, outName]) {
          try { await ffmpeg.deleteFile(n); } catch { /* ignore */ }
        }
      }
    });
  }

  async function convertItem(id) {
    const item = items.get(id);
    if (!item || item.busy) return;

    const { file, kind, el } = item;
    const target = $('[data-role="format"]', el).value;
    const statusEl = $('[data-role="status"]', el);
    const track = $('[data-role="progress-track"]', el);
    const bar = $('[data-role="progress-bar"]', el);
    const convertBtn = $('[data-role="convert"]', el);
    const downloadBtn = $('[data-role="download"]', el);

    item.busy = true;
    convertBtn.disabled = true;
    downloadBtn.hidden = true;
    if (item.resultUrl) { URL.revokeObjectURL(item.resultUrl); item.resultUrl = null; }
    statusEl.className = "file-status";
    track.hidden = false;
    bar.style.width = "0%";
    bar.classList.add("indeterminate");

    try {
      let blob = null;

      if (kind === KIND.IMAGE && CANVAS_TARGETS[target]) {
        statusEl.textContent = "Converting…";
        try {
          blob = await convertWithCanvas(file, target);
        } catch {
          blob = null; // fall through to ffmpeg
        }
      }

      if (!blob) {
        statusEl.textContent = "Waiting for engine…";
        blob = await convertWithFFmpeg(file, target, kind, (p) => {
          const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
          bar.classList.remove("indeterminate");
          bar.style.width = `${pct}%`;
          statusEl.textContent = `Converting… ${pct}%`;
        });
      }

      bar.classList.remove("indeterminate");
      bar.style.width = "100%";
      statusEl.textContent = `Done — ${humanSize(blob.size)}`;
      statusEl.classList.add("done");

      item.resultUrl = URL.createObjectURL(blob);
      downloadBtn.href = item.resultUrl;
      downloadBtn.download = `${baseName(file.name)}.${target}`;
      downloadBtn.textContent = `Download .${target}`;
      downloadBtn.hidden = false;
    } catch (err) {
      console.error(err);
      bar.classList.remove("indeterminate");
      track.hidden = true;
      statusEl.textContent = err && err.message ? err.message : "Conversion failed.";
      statusEl.classList.add("error");
    } finally {
      item.busy = false;
      convertBtn.disabled = false;
    }
  }

  // ---------- file queue UI ----------

  function addFiles(fileListLike) {
    for (const file of fileListLike) {
      const kind = kindOf(file);
      if (!kind) {
        flashDropzoneError(`"${file.name}" isn't a supported image, video or audio file.`);
        continue;
      }

      const id = nextId++;
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.id = id;

      $('[data-role="icon"]', node).textContent = KIND_ICON[kind];
      $('[data-role="name"]', node).textContent = file.name;
      $('[data-role="name"]', node).title = file.name;
      $('[data-role="size"]', node).textContent = humanSize(file.size);
      $('[data-role="type"]', node).textContent =
        (extOf(file.name) || kind).toUpperCase() + ` ${kind}`;

      const select = $('[data-role="format"]', node);
      const sourceExt = extOf(file.name);
      for (const fmt of TARGETS[kind]) {
        if (fmt === sourceExt || (fmt === "jpg" && sourceExt === "jpeg")) continue;
        const opt = document.createElement("option");
        opt.value = fmt;
        opt.textContent = fmt.toUpperCase();
        select.appendChild(opt);
      }

      $('[data-role="convert"]', node).addEventListener("click", () => convertItem(id));
      $('[data-role="remove"]', node).addEventListener("click", () => removeItem(id));
      select.addEventListener("change", () => {
        const dl = $('[data-role="download"]', node);
        dl.hidden = true; // stale result for a different format
      });

      fileList.appendChild(node);
      items.set(id, { file, kind, el: node, busy: false, resultUrl: null });
    }

    queueSection.hidden = items.size === 0;
    if (items.size > 0) {
      queueSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function removeItem(id) {
    const item = items.get(id);
    if (!item) return;
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.el.remove();
    items.delete(id);
    queueSection.hidden = items.size === 0;
  }

  let errorTimer = null;
  function flashDropzoneError(msg) {
    const sub = $(".dz-sub");
    if (!sub.dataset.original) sub.dataset.original = sub.innerHTML;
    sub.textContent = msg;
    sub.style.color = "var(--danger)";
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      sub.innerHTML = sub.dataset.original;
      sub.style.color = "";
    }, 4000);
  }

  // ---------- events ----------

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );

  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // allow dropping anywhere on the page without the browser navigating away
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  $("#convert-all-btn").addEventListener("click", () => {
    for (const id of items.keys()) convertItem(id);
  });

  $("#clear-all-btn").addEventListener("click", () => {
    for (const id of [...items.keys()]) removeItem(id);
  });
})();
