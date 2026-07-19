/* ============ UltraTune — UI wiring ============ */

(() => {
  "use strict";

  // ---------- access gate ----------
  // Same password as before the redesign; stored only as a SHA-256 hash.

  const PASS_HASH = "3a54e2b634913ca0900f408fe466f548793cc5aab1d79c7c3b686d5bbec02cf1";
  const UNLOCK_KEY = "morphly_unlocked";

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  (function initLock() {
    const form = document.getElementById("lock-form");
    const input = document.getElementById("lock-input");
    const remember = document.getElementById("lock-remember-check");
    const errorEl = document.getElementById("lock-error");
    const unlock = () => document.body.classList.remove("locked");

    try {
      if (localStorage.getItem(UNLOCK_KEY) === PASS_HASH) { unlock(); return; }
    } catch { /* storage unavailable — just show the prompt */ }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      let hash;
      try { hash = await sha256Hex(input.value); }
      catch { errorEl.textContent = "Unlock needs a secure (https) connection."; return; }
      if (hash === PASS_HASH) {
        if (remember.checked) { try { localStorage.setItem(UNLOCK_KEY, PASS_HASH); } catch { /* ignore */ } }
        unlock();
      } else {
        errorEl.textContent = "Wrong password — try again.";
        input.value = "";
        input.focus();
        form.classList.remove("shake");
        void form.offsetWidth;
        form.classList.add("shake");
      }
    });
  })();

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const fmtTime = (s) => {
    if (!isFinite(s)) s = 0;
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  };

  let toastTimer;
  function toast(msg, ms = 3200) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- decks ----------

  const decks = { a: new Deck("a"), b: new Deck("b") };
  const deckEls = { a: $("#deck-a"), b: $("#deck-b") };
  const ACCENTS = { a: "#22d3ee", b: "#f471ff" };

  function wireDeck(id) {
    const deck = decks[id];
    const root = deckEls[id];
    const role = (r) => root.querySelector(`[data-role="${r}"]`);

    const playBtn = role("play");
    const platter = role("platter");
    const wave = role("wave");
    const tempoVal = role("tempo-val");

    deck.onstatechange = () => {
      playBtn.textContent = deck.playing ? "❚❚" : "▶";
      playBtn.classList.toggle("active", deck.playing);
      platter.classList.toggle("spinning", deck.playing);
      role("title").textContent = deck.meta.title;
      role("artist").textContent = deck.meta.artist || "—";
      role("src").textContent = deck.meta.src || "";
      role("dur").textContent = fmtTime(deck.duration);
      role("boost").classList.toggle("on", deck.boostOn);
      role("echo").classList.toggle("on", deck.echoOn);
      root.querySelector(".loop-group").classList.toggle("looping", deck.looping);
    };

    playBtn.addEventListener("click", () => { AudioEngine.resume(); deck.toggle(); });
    role("cue").addEventListener("click", () => deck.cue());
    role("brake").addEventListener("click", () => deck.brake());
    role("loop-in").addEventListener("click", () => deck.setLoopIn());
    role("loop-out").addEventListener("click", () => deck.setLoopOut());
    role("loop-exit").addEventListener("click", () => deck.exitLoop());

    const tempo = role("tempo");
    const updateTempoLabel = () => {
      const pct = (deck.rate - 1) * 100;
      tempoVal.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
    };
    tempo.addEventListener("input", () => { deck.setRate(parseFloat(tempo.value)); updateTempoLabel(); });
    role("tempo-reset").addEventListener("click", () => {
      tempo.value = "1";
      deck.setRate(1);
      updateTempoLabel();
    });

    role("eq-hi").addEventListener("input", (e) => deck.setEQ("hi", parseFloat(e.target.value)));
    role("eq-mid").addEventListener("input", (e) => deck.setEQ("mid", parseFloat(e.target.value)));
    role("eq-lo").addEventListener("input", (e) => deck.setEQ("lo", parseFloat(e.target.value)));
    role("filter").addEventListener("input", (e) => deck.setFilter(parseFloat(e.target.value)));
    role("filter").addEventListener("dblclick", (e) => { e.target.value = 0; deck.setFilter(0); });
    role("volume").addEventListener("input", (e) => deck.setVolume(parseFloat(e.target.value)));
    role("boost").addEventListener("click", () => deck.toggleBoost());
    role("echo").addEventListener("click", () => deck.toggleEcho());

    // click waveform to seek
    wave.addEventListener("pointerdown", (e) => {
      if (!deck.buffer) return;
      const rect = wave.getBoundingClientRect();
      deck.seek(((e.clientX - rect.left) / rect.width) * deck.duration);
    });

    // drop an audio file straight onto the deck
    const fileInput = role("file");
    root.addEventListener("dragover", (e) => { e.preventDefault(); root.classList.add("dragover"); });
    root.addEventListener("dragleave", () => root.classList.remove("dragover"));
    root.addEventListener("drop", (e) => {
      e.preventDefault();
      root.classList.remove("dragover");
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(f.name));
      if (file) loadFileIntoDeck(file, id);
    });
    root.querySelector(".track-meta").addEventListener("dblclick", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) loadFileIntoDeck(fileInput.files[0], id);
      fileInput.value = "";
    });
  }

  async function loadFileIntoDeck(file, deckId) {
    try {
      toast(`Loading “${file.name}” into Deck ${deckId.toUpperCase()}…`);
      await decks[deckId].load(await file.arrayBuffer(), {
        title: file.name.replace(/\.[^.]+$/, ""),
        artist: "Local file",
        src: "Full track · local",
      });
      toast(`Deck ${deckId.toUpperCase()} ready — hit play.`);
    } catch {
      toast("Couldn't decode that file — is it an audio format your browser supports?");
    }
  }

  async function loadSpotifyTrackIntoDeck(track, deckId) {
    if (!track.preview_url) {
      toast("Spotify has no preview clip for this track — DRM blocks the full stream. Try another track or a local file.", 4500);
      return;
    }
    try {
      toast(`Loading “${track.name}” into Deck ${deckId.toUpperCase()}…`);
      const res = await fetch(track.preview_url);
      if (!res.ok) throw new Error();
      await decks[deckId].load(await res.arrayBuffer(), {
        title: track.name,
        artist: track.artists.map((a) => a.name).join(", "),
        src: "30s preview · Spotify",
      });
      toast(`Deck ${deckId.toUpperCase()} ready — hit play.`);
    } catch {
      toast("Couldn't fetch that preview from Spotify — try another track.");
    }
  }

  wireDeck("a");
  wireDeck("b");

  // ---------- crossfader & master ----------

  function applyCrossfade(x) {
    // equal-power curve
    decks.a.setCrossfadeGain(Math.cos((x + 1) / 2 * Math.PI / 2));
    decks.b.setCrossfadeGain(Math.cos((1 - x) / 2 * Math.PI / 2));
  }
  const xfader = $("#crossfader");
  xfader.addEventListener("input", () => applyCrossfade(parseFloat(xfader.value)));
  xfader.addEventListener("dblclick", () => { xfader.value = 0; applyCrossfade(0); });
  $("#master-vol").addEventListener("input", (e) => AudioEngine.setMasterVolume(parseFloat(e.target.value)));

  // ---------- keyboard ----------

  document.addEventListener("keydown", (e) => {
    if (document.body.classList.contains("locked")) return;
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); decks.a.toggle(); }
    if (e.code === "Enter") { e.preventDefault(); decks.b.toggle(); }
  });

  // ---------- rendering: waveforms + master visualizer ----------

  function drawWave(deck, canvas, accent) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!deck.peaks) {
      g.fillStyle = "rgba(255,255,255,.06)";
      g.fillRect(0, h / 2 - 1, w, 2);
      return;
    }
    const n = deck.peaks.length;
    const pos = deck.position() / deck.duration;
    const barW = w / n;
    for (let i = 0; i < n; i++) {
      const amp = Math.max(deck.peaks[i] * (h / 2 - 2), 1);
      g.fillStyle = i / n <= pos ? accent : "rgba(255,255,255,.18)";
      g.fillRect(i * barW, h / 2 - amp, Math.max(barW - 0.5, 0.5), amp * 2);
    }
    // loop region
    if (deck.loopStart != null) {
      const x1 = (deck.loopStart / deck.duration) * w;
      const x2 = deck.loopEnd != null ? (deck.loopEnd / deck.duration) * w : x1 + 2;
      g.fillStyle = "rgba(250, 204, 21, .18)";
      g.fillRect(x1, 0, x2 - x1, h);
    }
    // cue marker
    const cx = (deck.cuePoint / deck.duration) * w;
    g.fillStyle = "#facc15";
    g.fillRect(cx - 1, 0, 2, h);
    // playhead
    g.fillStyle = "#fff";
    g.fillRect(pos * w - 1, 0, 2, h);
  }

  const vizCanvas = $("#master-viz");
  function drawViz() {
    const analyser = AudioEngine.analyser;
    const dpr = window.devicePixelRatio || 1;
    const w = vizCanvas.clientWidth, h = vizCanvas.clientHeight;
    if (vizCanvas.width !== w * dpr) { vizCanvas.width = w * dpr; vizCanvas.height = h * dpr; }
    const g = vizCanvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bars = 96;
    const step = Math.floor(data.length / bars);
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = data[i * step] / 255;
      const bh = Math.max(v * h, 2);
      const hue = 190 + (i / bars) * 110; // cyan → magenta
      g.fillStyle = `hsla(${hue}, 95%, 62%, ${0.35 + v * 0.65})`;
      g.fillRect(i * barW + 1, h - bh, barW - 2, bh);
    }
  }

  function renderLoop() {
    for (const id of ["a", "b"]) {
      const deck = decks[id];
      const root = deckEls[id];
      drawWave(deck, root.querySelector('[data-role="wave"]'), ACCENTS[id]);
      root.querySelector('[data-role="time"]').textContent = fmtTime(deck.position());
    }
    drawViz();
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // ---------- recording ----------

  const recBtn = $("#rec-btn");
  recBtn.addEventListener("click", async () => {
    if (!AudioEngine.recording) {
      AudioEngine.resume();
      AudioEngine.startRecording();
      recBtn.classList.add("recording");
      $("#rec-label").textContent = "STOP";
      toast("Recording your mix — everything you hear is captured.");
    } else {
      const blob = await AudioEngine.stopRecording();
      recBtn.classList.remove("recording");
      $("#rec-label").textContent = "REC";
      if (blob && blob.size > 0) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "ultratune-mix.webm";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        toast("Mix saved — check your downloads.");
      }
    }
  });

  // ---------- library: tabs ----------

  const panes = { search: $("#pane-search"), playlists: $("#pane-playlists"), local: $("#pane-local") };
  document.querySelectorAll(".lib-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".lib-tab").forEach((t) => t.classList.toggle("active", t === tab));
      for (const [name, pane] of Object.entries(panes)) pane.hidden = name !== tab.dataset.tab;
      if (tab.dataset.tab === "playlists") loadPlaylists();
    });
  });

  // ---------- library: track rows ----------

  const rowTemplate = $("#track-row-template");

  function renderSpotifyTracks(listEl, tracks) {
    listEl.innerHTML = "";
    if (!tracks.length) {
      listEl.innerHTML = '<li class="lib-empty">Nothing found.</li>';
      return;
    }
    for (const track of tracks) {
      const row = rowTemplate.content.firstElementChild.cloneNode(true);
      const art = track.album && track.album.images && track.album.images.length
        ? track.album.images[track.album.images.length - 1].url : "";
      const img = $('[data-role="art"]', row);
      if (art) img.src = art; else img.remove();
      $('[data-role="title"]', row).textContent = track.name;
      $('[data-role="artist"]', row).textContent = track.artists.map((a) => a.name).join(", ");
      $('[data-role="dur"]', row).textContent = fmtTime(track.duration_ms / 1000);
      const badge = $('[data-role="badge"]', row);
      if (track.preview_url) {
        badge.textContent = "30s preview";
        badge.hidden = false;
      } else {
        badge.textContent = "no preview";
        badge.classList.add("badge-muted");
        badge.hidden = false;
        row.classList.add("row-disabled");
      }
      $('[data-role="to-a"]', row).addEventListener("click", () => loadSpotifyTrackIntoDeck(track, "a"));
      $('[data-role="to-b"]', row).addEventListener("click", () => loadSpotifyTrackIntoDeck(track, "b"));
      listEl.appendChild(row);
    }
  }

  // ---------- library: search ----------

  const searchInput = $("#search-input");
  async function runSearch() {
    const q = searchInput.value.trim();
    if (!q) return;
    if (!Spotify.loggedIn()) { openSpotifyFlow(); return; }
    try {
      $("#search-results").innerHTML = '<li class="lib-empty">Searching…</li>';
      renderSpotifyTracks($("#search-results"), await Spotify.searchTracks(q));
    } catch (err) {
      if (err.message === "not-logged-in") { updateSpotifyButton(); openSpotifyFlow(); }
      else toast("Spotify search failed — " + err.message);
    }
  }
  $("#search-btn").addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  // ---------- library: playlists ----------

  let playlistsLoaded = false;
  async function loadPlaylists(force = false) {
    if (!Spotify.loggedIn()) {
      $("#playlist-nav").innerHTML = "";
      $("#playlist-results").innerHTML = '<li class="lib-empty">Connect Spotify to browse your playlists.</li>';
      return;
    }
    if (playlistsLoaded && !force) return;
    const nav = $("#playlist-nav");
    nav.innerHTML = '<span class="lib-empty">Loading playlists…</span>';
    try {
      const lists = await Spotify.myPlaylists();
      nav.innerHTML = "";
      const likedBtn = document.createElement("button");
      likedBtn.className = "pl-chip";
      likedBtn.textContent = "♥ Liked songs";
      likedBtn.addEventListener("click", async () => {
        selectChip(likedBtn);
        renderSpotifyTracks($("#playlist-results"), await Spotify.savedTracks());
      });
      nav.appendChild(likedBtn);
      for (const pl of lists) {
        const btn = document.createElement("button");
        btn.className = "pl-chip";
        btn.textContent = pl.name;
        btn.addEventListener("click", async () => {
          selectChip(btn);
          $("#playlist-results").innerHTML = '<li class="lib-empty">Loading tracks…</li>';
          renderSpotifyTracks($("#playlist-results"), await Spotify.playlistTracks(pl.id));
        });
        nav.appendChild(btn);
      }
      playlistsLoaded = true;
    } catch (err) {
      nav.innerHTML = "";
      if (err.message === "not-logged-in") loadPlaylists(true);
      else toast("Couldn't load playlists — " + err.message);
    }
  }
  function selectChip(chip) {
    document.querySelectorAll(".pl-chip").forEach((c) => c.classList.toggle("active", c === chip));
  }

  // ---------- library: local files ----------

  const localFiles = [];
  function renderLocalFiles() {
    const list = $("#local-results");
    list.innerHTML = "";
    for (const file of localFiles) {
      const row = rowTemplate.content.firstElementChild.cloneNode(true);
      $('[data-role="art"]', row).remove();
      $('[data-role="title"]', row).textContent = file.name;
      $('[data-role="artist"]', row).textContent = "Local file · full track";
      $('[data-role="dur"]', row).textContent = (file.size / 1024 / 1024).toFixed(1) + " MB";
      $('[data-role="to-a"]', row).addEventListener("click", () => loadFileIntoDeck(file, "a"));
      $('[data-role="to-b"]', row).addEventListener("click", () => loadFileIntoDeck(file, "b"));
      list.appendChild(row);
    }
  }
  function addLocalFiles(files) {
    for (const f of files) {
      if (f.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(f.name)) localFiles.push(f);
    }
    renderLocalFiles();
  }
  const localDrop = $("#local-drop");
  const localInput = $("#local-input");
  localDrop.addEventListener("click", () => localInput.click());
  localDrop.addEventListener("dragover", (e) => { e.preventDefault(); localDrop.classList.add("dragover"); });
  localDrop.addEventListener("dragleave", () => localDrop.classList.remove("dragover"));
  localDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    localDrop.classList.remove("dragover");
    addLocalFiles(e.dataTransfer.files);
  });
  localInput.addEventListener("change", () => { addLocalFiles(localInput.files); localInput.value = ""; });

  // ---------- Spotify connect / settings ----------

  const setupModal = $("#setup-modal");
  const clientIdInput = $("#client-id-input");
  $("#redirect-uri-display").textContent = Spotify.redirectUri();
  $("#copy-uri-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(Spotify.redirectUri());
      toast("Redirect URI copied.");
    } catch { toast("Copy failed — select and copy it manually."); }
  });

  function openSetup() {
    clientIdInput.value = Spotify.getClientId();
    setupModal.hidden = false;
    clientIdInput.focus();
  }
  function closeSetup() { setupModal.hidden = true; }
  $("#settings-btn").addEventListener("click", openSetup);
  $("#setup-cancel-btn").addEventListener("click", closeSetup);
  setupModal.addEventListener("click", (e) => { if (e.target === setupModal) closeSetup(); });
  $("#setup-save-btn").addEventListener("click", () => {
    const id = clientIdInput.value.trim();
    if (!id) { toast("Paste your Spotify Client ID first."); return; }
    Spotify.setClientId(id);
    closeSetup();
    Spotify.login().catch(() => toast("Couldn't start the Spotify login."));
  });

  function openSpotifyFlow() {
    if (!Spotify.getClientId()) openSetup();
    else Spotify.login().catch(() => toast("Couldn't start the Spotify login."));
  }

  const spotifyBtn = $("#spotify-btn");
  const spotifyLabel = $("#spotify-btn-label");
  async function updateSpotifyButton() {
    if (Spotify.loggedIn()) {
      spotifyBtn.classList.add("connected");
      spotifyLabel.textContent = "Spotify ✓";
      try {
        const profile = await Spotify.me();
        spotifyLabel.textContent = profile.display_name || "Spotify ✓";
      } catch { /* token may have just expired; button click re-auths */ }
      $("#search-hint").textContent =
        "Tracks load as Spotify's 30-second preview clips — DRM keeps full streams locked, so drop local files in for full-length tracks.";
    } else {
      spotifyBtn.classList.remove("connected");
      spotifyLabel.textContent = "Connect Spotify";
    }
  }
  spotifyBtn.addEventListener("click", () => {
    if (Spotify.loggedIn()) {
      if (confirm("Disconnect from Spotify?")) {
        Spotify.logout();
        playlistsLoaded = false;
        updateSpotifyButton();
      }
    } else openSpotifyFlow();
  });

  (async function initSpotify() {
    try {
      if (await Spotify.handleRedirect()) toast("Spotify connected — search away!");
    } catch { toast("Spotify login failed — check your Client ID and redirect URI."); }
    updateSpotifyButton();
  })();
})();
