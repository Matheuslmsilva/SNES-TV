/*
 * SNES TV — launcher + emulador (snes9x em WebAssembly via EmulatorJS)
 *
 * Fontes de jogos, em ordem:
 *   1. Pen drive da TV (app Tizen instalado — usa tizen.filesystem)
 *   2. Pasta servida pelo PC (servidor.py → roms/list.json)
 *   3. Arquivo escolhido manualmente (navegador do PC)
 */
(function () {
  "use strict";

  var ROM_EXT = /\.(sfc|smc|swc|fig|zip|7z)$/i;
  var IS_TIZEN = typeof window.tizen !== "undefined" && !!window.tizen.filesystem;
  var COLS = 6;

  // Teclas do controle remoto Samsung
  var K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, EXIT: 10182,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, FF: 417, CH_UP: 427, CH_DOWN: 428,
    ESC: 27, BACKSPACE: 8
  };

  // Índices dos botões no libretro (snes9x)
  var BTN = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11, TURBO: 27 };

  // tecla → botão do SNES (cores = botões do SNES japonês/europeu)
  var TV_KEYS = {};
  TV_KEYS[K.UP] = BTN.UP; TV_KEYS[K.DOWN] = BTN.DOWN; TV_KEYS[K.LEFT] = BTN.LEFT; TV_KEYS[K.RIGHT] = BTN.RIGHT;
  TV_KEYS[K.ENTER] = BTN.B; TV_KEYS[K.YELLOW] = BTN.B; TV_KEYS[K.RED] = BTN.A;
  TV_KEYS[K.GREEN] = BTN.Y; TV_KEYS[K.BLUE] = BTN.X;
  TV_KEYS[49] = BTN.L; TV_KEYS[K.CH_DOWN] = BTN.L;   // 1
  TV_KEYS[51] = BTN.R; TV_KEYS[K.CH_UP] = BTN.R;     // 3
  TV_KEYS[53] = BTN.START; TV_KEYS[K.PLAYPAUSE] = BTN.START; TV_KEYS[K.PLAY] = BTN.START; TV_KEYS[K.PAUSE] = BTN.START; // 5
  TV_KEYS[48] = BTN.SELECT;                          // 0
  TV_KEYS[K.FF] = BTN.TURBO;

  var PC_KEYS = {};
  PC_KEYS[K.UP] = BTN.UP; PC_KEYS[K.DOWN] = BTN.DOWN; PC_KEYS[K.LEFT] = BTN.LEFT; PC_KEYS[K.RIGHT] = BTN.RIGHT;
  PC_KEYS[90] = BTN.B; PC_KEYS[88] = BTN.A; PC_KEYS[65] = BTN.Y; PC_KEYS[83] = BTN.X;   // Z X A S
  PC_KEYS[81] = BTN.L; PC_KEYS[87] = BTN.R;                                            // Q W
  PC_KEYS[13] = BTN.START; PC_KEYS[16] = BTN.SELECT; PC_KEYS[32] = BTN.TURBO;          // Enter Shift Espaço

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    view: "launcher",     // launcher | loading | game | menu | help
    helpFrom: "launcher",
    games: [],
    focus: 0,
    menuFocus: 0,
    current: null,
    turbo: false,
    held: {}              // teclas seguradas → botão
  };

  // ====================================================================
  // Utilidades
  // ====================================================================
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  function hashHue(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  function cleanTitle(file) {
    var base = file.replace(/\.[^.]+$/, "").replace(/_/g, " ");
    var tags = [];
    base = base.replace(/\s*[\(\[]([^\)\]]*)[\)\]]/g, function (m, t) { tags.push(t); return ""; });
    base = base.replace(/\s+/g, " ").trim();
    // "Legend of Zelda, The" → "The Legend of Zelda"
    var m = base.match(/^(.*?), (The|A|An|O|Os|As)( - .*)?$/i);
    if (m) base = m[2] + " " + m[1] + (m[3] || "");
    var region = "";
    tags.forEach(function (t) {
      if (/^(U|USA|E|Europe|J|Japan|B|Brazil|World|UE|JU)$/i.test(t)) region = t;
    });
    return { title: base || file, region: region };
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace(".", ",") + " MB";
    return Math.round(bytes / 1024) + " KB";
  }

  function gameKey(g) { return g.name + "|" + (g.size || 0); }

  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) {}
    return null;
  }

  // IndexedDB simples para os "estados salvos"
  var DB = null;
  function db() {
    if (DB) return DB;
    DB = new Promise(function (resolve, reject) {
      var req = indexedDB.open("snestv", 2);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("states")) d.createObjectStore("states");
        if (!d.objectStoreNames.contains("roms")) d.createObjectStore("roms");   // jogos escolhidos no navegador
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return DB;
  }
  function dbPut(key, val) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction("states", "readwrite");
        tx.objectStore("states").put(val, key);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function romsAll() {
    return db().then(function (d) {
      return new Promise(function (res) {
        var out = [], tx = d.transaction("roms"), cur = tx.objectStore("roms").openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { out.push(c.value); c.continue(); } else res(out);
        };
        cur.onerror = function () { res([]); };
      });
    }).catch(function () { return []; });
  }
  function romsPut(rec) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction("roms", "readwrite");
        tx.objectStore("roms").put(rec, rec.name);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function romsDel(name) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction("roms", "readwrite");
        tx.objectStore("roms").delete(name);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }
  function readAsBuffer(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function dbGet(key) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var r = d.transaction("states").objectStore("states").get(key);
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
    });
  }

  // ====================================================================
  // Controle remoto: registra teclas extras na TV
  // ====================================================================
  function registerTvKeys() {
    if (!window.tizen || !tizen.tvinputdevice) return;
    var wanted = ["ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
      "MediaPlayPause", "MediaPlay", "MediaPause", "MediaFastForward",
      "ChannelUp", "ChannelDown", "0", "1", "3", "5"];
    var supported = [];
    try { supported = tizen.tvinputdevice.getSupportedKeys().map(function (k) { return k.name; }); } catch (e) {}
    wanted.forEach(function (name) {
      if (supported.length && supported.indexOf(name) < 0) return;
      try { tizen.tvinputdevice.registerKey(name); } catch (e) {}
    });
  }

  // ====================================================================
  // Fonte 1: pen drive (Tizen)
  // ====================================================================
  function tizenStorages() {
    return new Promise(function (resolve) {
      try {
        tizen.filesystem.listStorages(function (list) {
          resolve(list.filter(function (s) {
            return s.type === "EXTERNAL" && (s.state === "MOUNTED" || !s.state);
          }));
        }, function () { resolve([]); });
      } catch (e) { resolve([]); }
    });
  }

  function tizenResolve(path) {
    return new Promise(function (resolve, reject) {
      try { tizen.filesystem.resolve(path, resolve, reject, "r"); } catch (e) { reject(e); }
    });
  }

  function tizenList(dir) {
    return new Promise(function (resolve) {
      try { dir.listFiles(resolve, function () { resolve([]); }); } catch (e) { resolve([]); }
    });
  }

  function scanTizenDir(dir, depth, out, label) {
    return tizenList(dir).then(function (files) {
      var subdirs = [];
      files.forEach(function (f) {
        if (f.name.charAt(0) === ".") return;
        if (f.isDirectory) {
          if (depth < 4 && !/^(System Volume Information|\$RECYCLE\.BIN|LOST\.DIR)$/i.test(f.name)) subdirs.push(f);
        } else if (ROM_EXT.test(f.name)) {
          out.push({ name: f.name, size: f.fileSize, source: "usb", where: label, tfile: f, path: f.fullPath });
        }
      });
      return subdirs.reduce(function (p, d) {
        return p.then(function () { return scanTizenDir(d, depth + 1, out, label); });
      }, Promise.resolve());
    });
  }

  function scanUsb() {
    return tizenStorages().then(function (storages) {
      var out = [];
      return storages.reduce(function (p, s) {
        return p.then(function () {
          return tizenResolve(s.label).then(function (root) {
            return scanTizenDir(root, 0, out, s.label);
          }).catch(function () {});
        });
      }, Promise.resolve()).then(function () { return { games: out, drives: storages.length }; });
    });
  }

  function readTizenFile(g) {
    // API nova (Tizen 5.0+): FileHandle.readData()
    try {
      if (tizen.filesystem.openFile) {
        var fh = tizen.filesystem.openFile(g.path, "r");
        var data = fh.readData();
        fh.close();
        if (data && data.length) return Promise.resolve(data);
      }
    } catch (e) { /* cai para a API antiga */ }
    // API antiga: FileStream.readBytes em blocos
    return new Promise(function (resolve, reject) {
      g.tfile.openStream("r", function (fs) {
        try {
          var total = g.tfile.fileSize, buf = new Uint8Array(total), off = 0, CH = 512 * 1024;
          while (off < total) {
            var bytes = fs.readBytes(Math.min(CH, total - off));
            if (!bytes || !bytes.length) break;
            buf.set(bytes, off); off += bytes.length;
          }
          fs.close();
          resolve(off === total ? buf : buf.subarray(0, off));
        } catch (e) { reject(e); }
      }, reject, "UTF-8");
    });
  }

  // ====================================================================
  // Fonte 2: servidor no PC (servidor.py)
  // ====================================================================
  function scanServer() {
    return fetch("roms/list.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("sem servidor");
      return r.json();
    }).then(function (list) {
      return list.map(function (it) {
        return { name: it.name, size: it.size, source: "pc", url: "roms/" + it.path.split("/").map(encodeURIComponent).join("/") };
      });
    }).catch(function () { return []; });
  }

  // ====================================================================
  // Lista de jogos
  // ====================================================================
  var scanning = false;
  function refresh(silent) {
    if (scanning) return;
    scanning = true;
    $("source-label").textContent = "Procurando jogos…";
    var jobs = [scanServer(), romsAll()];
    if (IS_TIZEN) jobs.push(scanUsb());
    Promise.all(jobs).then(function (res) {
      var pcGames = res[0];
      var usb = res[2] || { games: [], drives: 0 };
      var local = res[1].map(function (r) {
        return { name: r.name, size: r.size, source: "local", data: r.data };
      });
      var all = usb.games.concat(pcGames, local);
      var seen = {};
      all = all.filter(function (g) { var k = g.source + gameKey(g); if (seen[k]) return false; seen[k] = 1; return true; });
      all.forEach(function (g) { var c = cleanTitle(g.name); g.title = c.title; g.region = c.region; });
      all.sort(function (a, b) { return a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" }); });

      var last = store("snestv.last");
      if (last) all.forEach(function (g) { g.last = gameKey(g) === last; });

      state.games = all;
      var label = [];
      if (IS_TIZEN) label.push(usb.drives ? (usb.drives === 1 ? "Pen drive conectado" : usb.drives + " pen drives") : "Nenhum pen drive");
      if (pcGames.length) label.push("Pasta do PC");
      if (local.length) label.push("Jogos salvos nesta TV");
      if (!label.length) label.push(IS_TIZEN ? "Nenhum pen drive" : "Navegador");
      $("source-label").textContent = label.join(" · ");
      $("count").textContent = all.length ? all.length + (all.length === 1 ? " jogo" : " jogos") : "";
      renderGrid();
      if (!silent && IS_TIZEN && usb.drives && !usb.games.length) toast("O pen drive não tem jogos .sfc / .smc / .zip");
    }).then(function () { scanning = false; }, function () { scanning = false; });
  }

  function renderGrid() {
    var grid = $("grid");
    grid.innerHTML = "";
    var items = state.games.slice();
    // navegador da TV não abre arquivos; no PC/celular o seletor funciona
    var tvBrowser = /SMART-TV|Tizen|Web0S|NetCast|HbbTV/i.test(navigator.userAgent);
    if (!IS_TIZEN && !tvBrowser) items.unshift({ action: "open", title: "Abrir arquivos…", meta: "Escolher .sfc / .smc / .zip" });
    items.unshift({ action: "phone", title: "Adicionar pelo celular", meta: "Ler QR Code e enviar jogos" });
    $("empty").hidden = items.length > 0;
    grid.hidden = items.length === 0;

    var lastIdx = -1;
    items.forEach(function (g, i) {
      var el = document.createElement("div");
      el.className = "tile" + (g.action ? " action" : "");
      el.setAttribute("role", "option");
      var initial = g.action === "phone" ? "QR" : g.action ? "+" : (g.title.match(/[A-Za-z0-9À-ú]/) || ["?"])[0].toUpperCase();
      var hue = g.action ? 250 : hashHue(g.title);
      var meta = g.action ? g.meta :
        [g.region, fmtSize(g.size), g.source === "usb" ? "USB" : g.source === "pc" ? "PC" : g.source === "local" ? "salvo" : ""].filter(Boolean).join(" · ");
      el.innerHTML =
        '<div class="cart"><div class="shell"><div class="cart-label" style="--hue:' + hue + '"><span></span></div></div></div>' +
        '<div class="title"></div><div class="meta"></div>';
      el.querySelector(".cart-label span").textContent = initial;
      el.querySelector(".title").textContent = g.title;
      el.querySelector(".meta").textContent = meta;
      if (g.last) {
        var b = document.createElement("span"); b.className = "badge"; b.textContent = "último";
        el.querySelector(".meta").appendChild(b);
        lastIdx = i;
      }
      el.addEventListener("click", function () { state.focus = i; setFocus(); activate(); });
      grid.appendChild(el);
    });
    state.items = items;
    if (state.focus >= items.length || state.firstRender !== false) {
      state.focus = lastIdx >= 0 ? lastIdx : 0;
      state.firstRender = false;
    }
    setFocus();
  }

  function setFocus() {
    var tiles = $("grid").children;
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle("focused", i === state.focus);
    var el = tiles[state.focus];
    if (!el) return;
    // rolagem por linhas: o topo da tela sempre começa numa linha inteira
    var shelf = $("shelf"), grid = $("grid");
    var row = Math.floor(state.focus / COLS);
    var rowTop = function (r) { var t = tiles[r * COLS]; return t ? t.offsetTop : 0; };
    var first = Math.min(state.firstRow || 0, row);
    while (first < row && el.offsetTop + el.offsetHeight - rowTop(first) + 30 > shelf.clientHeight) first++;
    state.firstRow = first;
    grid.style.transform = "translateY(" + (first ? -(rowTop(first) - rowTop(0)) : 0) + "px)";
  }

  function moveFocus(dx, dy) {
    var n = state.items ? state.items.length : 0;
    if (!n) return;
    var f = state.focus;
    if (dx) f = Math.min(n - 1, Math.max(0, f + dx));
    if (dy) {
      var t = f + dy * COLS;
      if (t >= 0 && t < n) f = t;
      else if (dy > 0 && Math.floor(f / COLS) < Math.floor((n - 1) / COLS)) f = n - 1;
    }
    state.focus = f;
    setFocus();
  }

  function activate() {
    var g = state.items && state.items[state.focus];
    if (!g) return;
    if (g.action === "open") { $("file-input").click(); return; }
    if (g.action === "phone") { openPhone(); return; }
    startGame(g);
  }

  $("file-input").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files || []).filter(function (f) { return ROM_EXT.test(f.name); });
    e.target.value = "";
    if (!files.length) { toast("Nenhum jogo .sfc / .smc / .zip nos arquivos escolhidos", 3500); return; }
    toast(files.length === 1 ? "Salvando o jogo na TV…" : "Salvando " + files.length + " jogos na TV…", 2500);
    // guarda na TV (IndexedDB) para não precisar escolher de novo
    files.reduce(function (p, f) {
      return p.then(function () {
        return readAsBuffer(f).then(function (buf) {
          return romsPut({ name: f.name, size: f.size, data: buf, added: Date.now() });
        });
      }).catch(function (err) { console.warn(err); });
    }, Promise.resolve()).then(function () {
      if (files.length === 1) {
        var c = cleanTitle(files[0].name);
        startGame({ name: files[0].name, size: files[0].size, source: "local", file: files[0], title: c.title, region: c.region });
      } else {
        toast(files.length + " jogos salvos", 2000);
        refresh(true);
      }
    });
  });

  var removeArmed = null;
  function removeFocused() {
    var g = state.items && state.items[state.focus];
    if (!g || g.source !== "local") return;
    if (removeArmed !== g.name) {
      removeArmed = g.name;
      toast("Aperte AMARELO de novo para remover \"" + g.title + "\" desta TV", 3000);
      setTimeout(function () { removeArmed = null; }, 3000);
      return;
    }
    removeArmed = null;
    romsDel(g.name).then(function () { toast("Jogo removido", 1600); refresh(true); });
  }

  // ====================================================================
  // Emulador
  // ====================================================================
  function controlsConfig() {
    // Teclado, controle remoto e joysticks são tratados por nós (simulateInput),
    // então o EmulatorJS não recebe nenhum mapeamento próprio.
    return { 0: {}, 1: {}, 2: {}, 3: {} };
  }

  function getRomBytes(g) {
    if (g.source === "local") return Promise.resolve(g.file || g.data);
    if (g.source === "pc") {
      return fetch(g.url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      });
    }
    return readTizenFile(g);
  }

  function showLoading(g, text) {
    $("loading-initial").textContent = (g.title.match(/[A-Za-z0-9]/) || ["S"])[0].toUpperCase();
    $("loading-initial").parentNode.style.setProperty("--hue", hashHue(g.title));
    $("loading-text").textContent = text;
    $("loading").hidden = false;
  }

  function startGame(g) {
    state.view = "loading";
    state.current = g;
    showLoading(g, g.source === "usb" ? "Lendo do pen drive…" : "Carregando " + g.title + "…");
    store("snestv.last", gameKey(g));

    getRomBytes(g).then(function (data) {
      var file = data instanceof File ? data : new File([data], g.name, { type: "application/octet-stream" });
      $("loading-text").textContent = "Iniciando " + g.title + "…";
      $("launcher").hidden = true;
      $("game").hidden = false;

      window.EJS_player = "#player";
      window.EJS_core = "snes";
      window.EJS_gameUrl = file;
      window.EJS_gameName = g.name.replace(/\.[^.]+$/, "");
      window.EJS_pathtodata = "emulator/data/";
      window.EJS_language = "pt-BR";
      window.EJS_startOnLoaded = true;
      window.EJS_color = "#6c5fc7";
      window.EJS_backgroundColor = "#000000";
      window.EJS_defaultControls = controlsConfig();
      window.EJS_defaultOptions = { "save-save-interval": "30" };
      window.EJS_Buttons = {
        playPause: false, restart: false, mute: false, settings: false, fullscreen: false,
        saveState: false, loadState: false, screenRecord: false, gamepad: false, cheat: false,
        volume: false, saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false,
        screenshot: false, cacheManager: false, exitEmulation: false, netplay: false, diskButton: false
      };
      window.EJS_onGameStart = function () {
        $("loading").hidden = true;
        state.view = "game";
        focusEmu();
      };

      var s = document.createElement("script");
      s.src = "emulator/data/loader.js";
      s.onerror = function () { fail("Não foi possível carregar o emulador."); };
      document.body.appendChild(s);

      // Se nada acontecer em 40 s, avisa
      setTimeout(function () {
        if (state.view === "loading") fail("O jogo demorou demais para iniciar. A TV pode ser antiga demais para o emulador.");
      }, 40000);
    }).catch(function (e) {
      console.error(e);
      fail("Não foi possível ler o arquivo do jogo.");
    });
  }

  function fail(msg) {
    $("loading").hidden = true;
    toast(msg, 6000);
    // volta para a lista de forma limpa
    setTimeout(function () { location.reload(); }, state.view === "game" ? 3000 : 3500);
  }

  function emu() { return window.EJS_emulator; }
  function gm() { var e = emu(); return e && e.gameManager; }

  function focusEmu() {
    var e = emu();
    try { if (e && e.elements && e.elements.parent) e.elements.parent.focus(); } catch (err) {}
  }

  function press(btn, down) {
    var g = gm(); if (!g) return;
    try { g.simulateInput(0, btn, down ? 1 : 0); } catch (e) {}
  }

  function releaseAll() {
    Object.keys(state.held).forEach(function (k) { press(state.held[k], false); });
    state.held = {};
  }

  // ---------------- Menu de pausa ----------------
  function openMenu() {
    releaseAll();
    releasePads();
    try { emu().pause(); } catch (e) {}
    state.view = "menu";
    state.menuFocus = 0;
    $("menu-title").textContent = state.current ? state.current.title : "Pausado";
    $("turbo-state").textContent = state.turbo ? "ligada" : "desligada";
    $("menu").hidden = false;
    paintMenu();
  }

  function closeMenu() {
    $("menu").hidden = true;
    state.view = "game";
    try { emu().play(); } catch (e) {}
    focusEmu();
  }

  function paintMenu() {
    var items = $("menu-list").children;
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("focused", i === state.menuFocus);
  }

  function menuAction() {
    var act = $("menu-list").children[state.menuFocus].getAttribute("data-act");
    var g = gm(), key = "state:" + gameKey(state.current);
    if (act === "resume") return closeMenu();
    if (act === "save") {
      try {
        var data = g.getState();
        dbPut(key, data).then(function () { toast("Estado salvo"); closeMenu(); },
          function () { toast("Não foi possível salvar o estado"); });
      } catch (e) { toast("Não foi possível salvar o estado"); }
      return;
    }
    if (act === "load") {
      dbGet(key).then(function (data) {
        if (!data) { toast("Nenhum estado salvo para este jogo"); return; }
        g.loadState(data);
        toast("Estado carregado");
        closeMenu();
      }, function () { toast("Não foi possível carregar o estado"); });
      return;
    }
    if (act === "turbo") {
      state.turbo = !state.turbo;
      try { g.toggleFastForward(state.turbo ? 1 : 0); } catch (e) {}
      $("turbo-state").textContent = state.turbo ? "ligada" : "desligada";
      return;
    }
    if (act === "restart") { try { g.restart(); } catch (e) {} closeMenu(); return; }
    if (act === "controls") { openHelp("menu"); return; }
    if (act === "exit") return exitGame();
  }

  function exitGame() {
    $("menu").hidden = true;
    showLoading(state.current, "Salvando…");
    try { gm().saveSaveFiles(); } catch (e) {}
    // dá tempo para o IndexedDB gravar o save da bateria
    setTimeout(function () { location.reload(); }, 1500);
  }

  function openHelp(from) {
    state.helpFrom = from;
    state.view = "help";
    $("menu").hidden = true;
    $("help").hidden = false;
  }
  function closeHelp() {
    $("help").hidden = true;
    if (state.helpFrom === "menu") { state.view = "menu"; $("menu").hidden = false; }
    else state.view = "launcher";
  }

  function quitApp() {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* navegador: nada a fazer */ }
  }

  // ====================================================================
  // Teclado / controle remoto
  // ====================================================================
  var isBack = function (c) { return c === K.BACK || c === K.ESC || c === K.BACKSPACE; };

  window.addEventListener("keydown", function (e) {
    var c = e.keyCode;
    if (c === K.EXIT) return;   // deixa a TV tratar o EXIT

    if (state.view === "game") {
      if (isBack(c)) { e.preventDefault(); e.stopPropagation(); openMenu(); return; }
      var map = IS_TIZEN ? TV_KEYS : PC_KEYS;
      if (map[c] !== undefined) {
        e.preventDefault(); e.stopPropagation();
        if (!state.held[c]) { state.held[c] = map[c]; press(map[c], true); }
      }
      return;
    }

    // fora do jogo, nenhuma tecla chega ao emulador
    e.preventDefault(); e.stopPropagation();

    if (state.view === "launcher") {
      if (c === K.LEFT) moveFocus(-1, 0);
      else if (c === K.RIGHT) moveFocus(1, 0);
      else if (c === K.UP) moveFocus(0, -1);
      else if (c === K.DOWN) moveFocus(0, 1);
      else if (c === K.ENTER) activate();
      else if (c === K.RED || c === 116 /* F5 */) { refresh(); toast("Atualizando lista…", 1200); }
      else if (c === K.BLUE || c === 72 /* H */) openHelp("launcher");
      else if (c === K.GREEN || c === 71 /* G */) openWizard();
      else if (c === K.YELLOW || c === 46 /* Delete */) removeFocused();
      else if (c === K.BACK) quitApp();
    } else if (state.view === "menu") {
      var n = $("menu-list").children.length;
      if (c === K.UP) { state.menuFocus = (state.menuFocus + n - 1) % n; paintMenu(); }
      else if (c === K.DOWN) { state.menuFocus = (state.menuFocus + 1) % n; paintMenu(); }
      else if (c === K.ENTER) menuAction();
      else if (isBack(c)) closeMenu();
    } else if (state.view === "help") {
      if (c === K.ENTER || isBack(c)) closeHelp();
    } else if (state.view === "phone") {
      if (isBack(c) || c === K.ENTER) closePhone();
    } else if (state.view === "wizard") {
      if (isBack(c)) closeWizard(false);
      else if (c === K.ENTER) wizardSkip();
      else if (c === K.RED || c === 82 /* R */) wizardReset();
    }
  }, true);

  window.addEventListener("keyup", function (e) {
    if (state.view !== "game") return;
    var c = e.keyCode;
    if (state.held[c] !== undefined) {
      e.preventDefault(); e.stopPropagation();
      press(state.held[c], false);
      delete state.held[c];
    }
  }, true);

  // ====================================================================
  // Joysticks USB e Bluetooth
  // ====================================================================
  // Joystick "padrão" (Xbox, PlayStation, 8BitDo, a maioria dos USB): posição igual ao SNES
  var STD_MAP = {};
  STD_MAP[BTN.B] = "b0"; STD_MAP[BTN.A] = "b1"; STD_MAP[BTN.Y] = "b2"; STD_MAP[BTN.X] = "b3";
  STD_MAP[BTN.L] = "b4"; STD_MAP[BTN.R] = "b5"; STD_MAP[BTN.SELECT] = "b8"; STD_MAP[BTN.START] = "b9";
  STD_MAP[BTN.UP] = "b12"; STD_MAP[BTN.DOWN] = "b13"; STD_MAP[BTN.LEFT] = "b14"; STD_MAP[BTN.RIGHT] = "b15";
  var STICK = {};
  STICK[BTN.UP] = "a1-"; STICK[BTN.DOWN] = "a1+"; STICK[BTN.LEFT] = "a0-"; STICK[BTN.RIGHT] = "a0+";
  var SNES_BTNS = [BTN.B, BTN.Y, BTN.SELECT, BTN.START, BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, BTN.A, BTN.X, BTN.L, BTN.R];

  function padName(p) {
    var n = (p.id || "").replace(/\s*\([^)]*(STANDARD GAMEPAD|Vendor:)[^)]*\)\s*$/i, "")
      .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").replace(/\s+/g, " ").trim();
    return n || "Joystick";
  }
  function padMapKey(p) { return "snestv.pad." + p.id; }
  function customMap(p) {
    var raw = store(padMapKey(p));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // token: "b3" botão, "a1+" / "a1-" eixo, "a9=-0.43" eixo de valor fixo (direcional "hat")
  function tokenOn(p, tok) {
    var m = tok && tok.match(/^([ba])(\d+)(?:([+-])|=(-?[\d.]+))?$/);
    if (!m) return false;
    var i = +m[2];
    if (m[1] === "b") { var b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); }
    var v = p.axes[i];
    if (v === undefined) return false;
    if (m[3] === "+") return v > 0.5;
    if (m[3] === "-") return v < -0.5;
    return Math.abs(v - parseFloat(m[4])) < 0.12;
  }

  function readPad(p) {
    var map = customMap(p), out = {}, k;
    var m = map || STD_MAP;
    for (k in m) if (tokenOn(p, m[k])) out[k] = true;
    if (!map) {
      for (k in STICK) if (tokenOn(p, STICK[k])) out[k] = true;
      if (tokenOn(p, "b7")) out.turbo = true;   // gatilho direito (RT/R2/ZR)
      if (tokenOn(p, "b16")) out.menu = true;   // botão central (Xbox/PS/Home)
    }
    return out;
  }

  function connectedPads() {
    var list = navigator.getGamepads ? navigator.getGamepads() : [], out = [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected !== false) out.push(list[i]);
    return out;
  }

  function updatePadBadge(pads) {
    var el = $("pad-text"), box = $("pad-info");
    if (!pads.length) {
      el.textContent = "Nenhum joystick — conecte por USB ou Bluetooth e aperte um botão";
      box.classList.remove("on");
      return;
    }
    el.textContent = pads.slice(0, 4).map(function (p, n) {
      return "J" + (n + 1) + ": " + padName(p) + (customMap(p) ? " ✓" : "");
    }).join("  ·  ");
    box.classList.add("on");
  }

  var knownPads = {};
  function trackConnections(pads) {
    var now = {}, changed = false;
    pads.forEach(function (p, n) {
      var k = p.index + "|" + p.id;
      now[k] = padName(p);
      if (!knownPads[k]) {
        changed = true;
        var precisa = p.mapping !== "standard" && !customMap(p);
        toast("🎮 " + padName(p) + " conectado — jogador " + (n + 1) +
          (precisa ? ". Se os botões ficarem trocados, aperte VERDE na lista para configurar." : ""), precisa ? 5500 : 2600);
      }
    });
    Object.keys(knownPads).forEach(function (k) {
      if (!now[k]) { changed = true; toast("Joystick desconectado: " + knownPads[k], 2400); }
    });
    knownPads = now;
    if (changed || state.padBadgeDirty) { updatePadBadge(pads); state.padBadgeDirty = false; }
  }

  // botões enviados ao emulador, por jogador
  var padSent = {};
  function releasePads() {
    var g = gm();
    Object.keys(padSent).forEach(function (k) {
      var parts = k.split(":");
      try { if (g) g.simulateInput(+parts[0], +parts[1], 0); } catch (e) {}
    });
    padSent = {};
    if (state.padTurbo) { try { g.toggleFastForward(state.turbo ? 1 : 0); } catch (e) {} state.padTurbo = false; }
  }

  function feedGame(states) {
    var g = gm(); if (!g) return;
    states.forEach(function (st, player) {
      SNES_BTNS.forEach(function (b) {
        var k = player + ":" + b, on = !!st[b];
        if (on !== !!padSent[k]) {
          try { g.simulateInput(player, b, on ? 1 : 0); } catch (e) {}
          if (on) padSent[k] = true; else delete padSent[k];
        }
      });
    });
  }

  var padPrev = {};
  function pollPads() {
    try {
      var pads = connectedPads();
      trackConnections(pads);
      if (state.view === "wizard") {
        wizardPoll(pads);
      } else {
        var states = pads.slice(0, 4).map(readPad), any = {};
        states.forEach(function (st) { for (var k in st) any[k] = true; });
        var hit = function (k) { return any[k] && !padPrev[k]; };
        var up = hit(BTN.UP), down = hit(BTN.DOWN), left = hit(BTN.LEFT), right = hit(BTN.RIGHT);
        var ok = hit(BTN.B) || hit(BTN.A) || hit(BTN.START), back = hit(BTN.Y);

        if (state.view === "launcher") {
          if (left) moveFocus(-1, 0); if (right) moveFocus(1, 0);
          if (up) moveFocus(0, -1); if (down) moveFocus(0, 1);
          if (ok) activate();
          if (hit(BTN.X)) openHelp("launcher");
          if (hit(BTN.SELECT)) openWizard();
        } else if (state.view === "game") {
          if ((any[BTN.SELECT] && any[BTN.START]) || hit("menu")) { openMenu(); }
          else {
            feedGame(states);
            if (!!any.turbo !== !!state.padTurbo) {
              state.padTurbo = !!any.turbo;
              try { gm().toggleFastForward(state.padTurbo || state.turbo ? 1 : 0); } catch (e) {}
            }
          }
        } else if (state.view === "menu") {
          var n = $("menu-list").children.length;
          if (up) { state.menuFocus = (state.menuFocus + n - 1) % n; paintMenu(); }
          if (down) { state.menuFocus = (state.menuFocus + 1) % n; paintMenu(); }
          if (hit(BTN.B) || hit(BTN.A)) menuAction();
          if (back || hit("menu")) closeMenu();
        } else if (state.view === "help") {
          if (ok || back) closeHelp();
        } else if (state.view === "phone") {
          if (back || hit(BTN.B) || hit(BTN.A)) closePhone();
        }
        padPrev = any;
      }
    } catch (e) { console.error(e); }
    requestAnimationFrame(pollPads);
  }

  // ---------------- Assistente: configurar joystick genérico ----------------
  var WIZ = [
    [BTN.UP, "CIMA no direcional"], [BTN.DOWN, "BAIXO no direcional"],
    [BTN.LEFT, "ESQUERDA no direcional"], [BTN.RIGHT, "DIREITA no direcional"],
    [BTN.B, "o botão B (embaixo)"], [BTN.A, "o botão A (direita)"],
    [BTN.Y, "o botão Y (esquerda)"], [BTN.X, "o botão X (em cima)"],
    [BTN.L, "o botão L (ombro esquerdo)"], [BTN.R, "o botão R (ombro direito)"],
    [BTN.SELECT, "SELECT"], [BTN.START, "START"]
  ];
  var WIZ_PART = {}; // botão → id da peça no desenho
  WIZ_PART[BTN.UP] = "sp-up"; WIZ_PART[BTN.DOWN] = "sp-down"; WIZ_PART[BTN.LEFT] = "sp-left"; WIZ_PART[BTN.RIGHT] = "sp-right";
  WIZ_PART[BTN.B] = "sp-b"; WIZ_PART[BTN.A] = "sp-a"; WIZ_PART[BTN.Y] = "sp-y"; WIZ_PART[BTN.X] = "sp-x";
  WIZ_PART[BTN.L] = "sp-l"; WIZ_PART[BTN.R] = "sp-r"; WIZ_PART[BTN.SELECT] = "sp-select"; WIZ_PART[BTN.START] = "sp-start";
  var wiz = null;

  function openWizard() {
    var pads = connectedPads();
    if (!pads.length) {
      toast("Nenhum joystick encontrado. Conecte por USB ou Bluetooth e aperte qualquer botão nele.", 4000);
      return;
    }
    wiz = { step: 0, pad: null, padId: null, map: {}, rest: null, wait: true };
    state.view = "wizard";
    $("wizard").hidden = false;
    paintWizard();
  }

  function closeWizard(saved) {
    $("wizard").hidden = true;
    state.view = "launcher";
    wiz = null;
    padPrev = {};
    state.padBadgeDirty = true;
    if (!saved) toast("Configuração cancelada", 1600);
  }

  function paintWizard(msg) {
    var step = WIZ[wiz.step];
    $("wiz-pad").textContent = wiz.padName ? wiz.padName : "Aperte o botão pedido no joystick que você quer configurar";
    $("wiz-ask").textContent = step ? "Aperte " + step[1] : "";
    $("wiz-msg").textContent = msg || "";
    $("wiz-progress").textContent = (wiz.step + 1) + " de " + WIZ.length;
    Object.keys(WIZ_PART).forEach(function (b) {
      var el = document.getElementById(WIZ_PART[b]);
      if (!el) return;
      el.classList.toggle("on", step && +b === step[0]);
      el.classList.toggle("done", wiz.map[b] !== undefined);
    });
  }

  function anyActive(p, rest) {
    for (var i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed || p.buttons[i].value > 0.5) return true;
    if (rest) for (var j = 0; j < p.axes.length; j++) if (Math.abs(p.axes[j] - (rest[j] || 0)) > 0.4) return true;
    return false;
  }

  function wizardPoll(pads) {
    if (!wiz) return;
    var list = wiz.pad === null ? pads : pads.filter(function (p) { return p.index === wiz.pad; });
    if (wiz.pad !== null && !list.length) { toast("O joystick foi desconectado"); closeWizard(true); return; }
    if (wiz.wait) {   // espera soltar tudo e guarda a posição de repouso dos eixos
      var busy = list.some(function (p) { return anyActive(p, wiz.rest && wiz.rest[p.index]); });
      if (!busy) {
        wiz.wait = false;
        wiz.rest = {};
        list.forEach(function (p) { wiz.rest[p.index] = p.axes.slice(); });
      }
      return;
    }
    for (var n = 0; n < list.length; n++) {
      var p = list[n], tok = null, i;
      for (i = 0; i < p.buttons.length && !tok; i++) if (p.buttons[i].pressed || p.buttons[i].value > 0.5) tok = "b" + i;
      var rest = wiz.rest[p.index] || [];
      for (i = 0; i < p.axes.length && !tok; i++) {
        var v = p.axes[i], r = rest[i] || 0;
        if (Math.abs(v - r) > 0.5) {
          tok = (Math.abs(v) > 0.9 && Math.abs(r) < 0.2) ? "a" + i + (v > 0 ? "+" : "-") : "a" + i + "=" + v.toFixed(2);
        }
      }
      if (!tok) continue;
      wiz.wait = true;
      for (var b in wiz.map) if (wiz.map[b] === tok) { paintWizard("Esse botão já foi usado. Aperte outro."); return; }
      wiz.pad = p.index; wiz.padId = p.id; wiz.padName = padName(p);
      wiz.map[WIZ[wiz.step][0]] = tok;
      advanceWizard();
      return;
    }
  }

  function advanceWizard() {
    wiz.step++;
    if (wiz.step < WIZ.length) { paintWizard(); return; }
    if (!wiz.padId) { closeWizard(false); return; }
    try { localStorage.setItem("snestv.pad." + wiz.padId, JSON.stringify(wiz.map)); } catch (e) {}
    toast("🎮 " + wiz.padName + " configurado!", 2600);
    closeWizard(true);
  }

  function wizardSkip() { if (wiz) { wiz.wait = true; advanceWizard(); } }

  function wizardReset() {
    var pads = connectedPads();
    var p = wiz && wiz.pad !== null ? pads.filter(function (x) { return x.index === wiz.pad; })[0] : pads[0];
    if (p) { try { localStorage.removeItem(padMapKey(p)); } catch (e) {} toast("Botões de " + padName(p) + " voltaram ao padrão", 2600); }
    closeWizard(true);
  }

  // ====================================================================
  // Informações da TV (canto da tela)
  // ====================================================================
  function capability(key) {
    try { var v = tizen.systeminfo.getCapability(key); return v === "" ? null : v; } catch (e) { return null; }
  }

  function gpuName() {
    try {
      var gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return null;
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      var r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (!r) return null;
      var m = r.match(/^ANGLE \((.*)\)$/);
      if (m) { var parts = m[1].split(", "); r = parts[1] || parts[0]; }
      return r.replace(/\s*\(0x[0-9a-f]+\)/i, "").replace(/\s*Direct3D.*$/, "").replace(/\s*OpenGL.*$/, "").trim();
    } catch (e) { return null; }
  }

  function deviceInfo() {
    var d = {}, ua = navigator.userAgent;
    if (window.webapis && webapis.productinfo) {
      try { d.model = webapis.productinfo.getRealModel(); } catch (e) {}
      try { d.model = d.model || webapis.productinfo.getModel(); } catch (e) {}
      try { d.firmware = webapis.productinfo.getFirmware(); } catch (e) {}
    }
    if (IS_TIZEN && tizen.systeminfo) {
      d.model = d.model || capability("http://tizen.org/system/model_name");
      d.processor = capability("http://tizen.org/system/platform.processor");
      d.platform = capability("http://tizen.org/system/platform.name");
      d.arch = capability("http://tizen.org/feature/platform.core.cpu.arch");
      d.freq = capability("http://tizen.org/feature/platform.core.cpu.frequency");
      d.tizen = capability("http://tizen.org/feature/platform.version");
      try { d.ram = tizen.systeminfo.getTotalMemory(); } catch (e) {}
    }
    var t = ua.match(/Tizen\s*([\d.]+)/i);
    d.tizen = d.tizen || (t && t[1]);
    var cores = navigator.hardwareConcurrency;
    if (!d.arch) d.arch = /aarch64|arm64/i.test(ua) ? "ARM 64 bits" : /arm/i.test(ua) ? "ARM" : null;
    if (!d.ram && navigator.deviceMemory) d.ram = navigator.deviceMemory * 1073741824;
    d.gpu = gpuName();

    var line1 = d.model ? "Samsung " + d.model : (IS_TIZEN || /SMART-TV|Tizen/i.test(ua) ? "TV Samsung" : "Navegador");
    var cpu = [];
    if (d.processor) cpu.push(d.processor);
    if (d.arch) cpu.push(String(d.arch).replace(/^armv/i, "ARMv"));
    if (cores) cpu.push(cores + (cores === 1 ? " núcleo" : " núcleos"));
    if (d.freq) cpu.push((d.freq / 1000).toFixed(1).replace(".", ",") + " GHz");
    var line2 = cpu.length ? "Processador: " + cpu.join(" · ") : "";
    var extra = [];
    if (d.tizen) extra.push("Tizen " + d.tizen);
    if (d.gpu) extra.push("GPU " + d.gpu);
    if (d.ram) extra.push("RAM " + (d.ram / 1073741824).toFixed(1).replace(".", ",") + " GB");
    return { line1: line1, line2: line2, line3: extra.join(" · ") };
  }

  function showDeviceInfo() {
    var i = deviceInfo();
    $("tv-model").textContent = i.line1;
    $("tv-cpu").textContent = i.line2;
    $("tv-extra").textContent = i.line3;
    updatePadBadge(connectedPads());
  }

  // ====================================================================
  // Receber jogos pelo celular (QR Code + conexão direta WebRTC/PeerJS)
  // ====================================================================
  var SITE_URL = "https://matheuslmsilva.github.io/SNES-TV/";
  var phone = null;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function sendUrl(code) {
    var base = /^https?:$/.test(location.protocol) ? location.href.replace(/[#?].*$/, "").replace(/[^/]*$/, "") : SITE_URL;
    return base + "enviar.html#" + code;
  }

  function newCode() {
    var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", c = "";
    for (var i = 0; i < 6; i++) c += A.charAt(Math.floor(Math.random() * A.length));
    return c;
  }

  function phoneStatus(text, kind) {
    var el = $("phone-status");
    el.textContent = text;
    el.className = "phone-status " + (kind || "");
  }

  function openPhone() {
    state.view = "phone";
    $("phone").hidden = false;
    $("phone-qr").innerHTML = "";
    $("phone-code").textContent = "······";
    $("phone-url").textContent = "";
    $("phone-list").innerHTML = "";
    phone = { received: 0 };
    if (!window.RTCPeerConnection && !window.webkitRTCPeerConnection) {
      phoneStatus("O navegador desta TV não suporta receber arquivos do celular.", "err");
      return;
    }
    phoneStatus("Preparando…");
    var libs = window.Peer && window.qrcode ? Promise.resolve() :
      Promise.all([loadScript("lib/peerjs.min.js"), loadScript("lib/qrcode.js")]);
    libs.then(startPeer, function () { phoneStatus("Não consegui carregar os arquivos de conexão.", "err"); });
  }

  function startPeer() {
    if (!phone) return;
    var P = window.Peer || (window.peerjs && window.peerjs.Peer);
    var code = newCode();
    var peer = new P("snestv-tv-" + code);
    phone.peer = peer;
    peer.on("open", function () {
      if (!phone || phone.peer !== peer) return;
      var url = sendUrl(code);
      var qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      $("phone-qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
      $("phone-code").textContent = code;
      $("phone-url").textContent = url.replace(/^https?:\/\//, "").replace(/#.*$/, "") + "  ·  código " + code;
      phoneStatus("Aguardando o celular…");
    });
    peer.on("connection", function (conn) { handlePhoneConn(conn); });
    peer.on("error", function (err) {
      if (!phone || phone.peer !== peer) return;
      if (err.type === "unavailable-id") { try { peer.destroy(); } catch (e) {} startPeer(); return; }
      if (err.type === "browser-incompatible") phoneStatus("O navegador desta TV não suporta receber arquivos do celular.", "err");
      else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error")
        phoneStatus("Sem conexão com a internet. Confira o Wi-Fi da TV.", "err");
      else phoneStatus("Erro: " + (err.type || err), "err");
    });
    peer.on("disconnected", function () { try { if (phone && phone.peer === peer) peer.reconnect(); } catch (e) {} });
  }

  function handlePhoneConn(conn) {
    var cur = null;
    conn.on("open", function () { phoneStatus("Celular conectado ✓ — escolha os jogos no celular", "ok"); });
    conn.on("data", function (d) {
      if (d instanceof ArrayBuffer || (d && d.byteLength !== undefined && !d.t)) {
        if (!cur) return;
        var u = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
        if (cur.got + u.length > cur.size) { cur.bad = true; return; }
        cur.buf.set(u, cur.got); cur.got += u.length;
        cur.row.textContent = cur.name + " — " + Math.round(cur.got / cur.size * 100) + "%";
        return;
      }
      if (!d || typeof d !== "object") return;
      if (d.t === "hello") {
        var model = $("tv-model") ? $("tv-model").textContent : "";
        conn.send({ t: "hi", tv: /Samsung/.test(model) ? model : "TV" });
      } else if (d.t === "start") {
        var ok = ROM_EXT.test(d.name || "") && d.size > 0 && d.size <= 16 * 1048576;
        var li = document.createElement("li");
        $("phone-list").insertBefore(li, $("phone-list").firstChild);
        if (!ok) { li.textContent = d.name + " — recusado"; conn.send({ t: "fail", id: d.id, msg: "a TV recusou o arquivo" }); cur = null; return; }
        cur = { id: d.id, name: d.name, size: d.size, got: 0, buf: new Uint8Array(d.size), row: li };
        li.textContent = d.name + " — 0%";
        phoneStatus("Recebendo " + d.name + "…", "ok");
      } else if (d.t === "end" && cur && cur.id === d.id) {
        var f = cur; cur = null;
        if (f.bad || f.got !== f.size) { f.row.textContent = f.name + " — falhou"; conn.send({ t: "fail", id: f.id, msg: "chegou incompleto" }); return; }
        romsPut({ name: f.name, size: f.size, data: f.buf.buffer, added: Date.now() }).then(function () {
          f.row.textContent = f.name + " — salvo ✓";
          f.row.className = "ok";
          phone && phone.received++;
          conn.send({ t: "saved", id: f.id });
          phoneStatus("Jogo recebido! Pode mandar mais ou apertar VOLTAR.", "ok");
        }, function () {
          f.row.textContent = f.name + " — sem espaço na TV";
          conn.send({ t: "fail", id: f.id, msg: "sem espaço na TV" });
        });
      }
    });
    conn.on("close", function () { if (phone) phoneStatus("Celular desconectado. Aponte a câmera de novo para conectar.", ""); });
  }

  function closePhone() {
    $("phone").hidden = true;
    state.view = "launcher";
    var got = phone ? phone.received : 0;
    if (phone && phone.peer) { try { phone.peer.destroy(); } catch (e) {} }
    phone = null;
    padPrev = {};
    if (got) { toast(got === 1 ? "1 jogo adicionado" : got + " jogos adicionados", 2200); refresh(true); }
  }

  // ====================================================================
  // Início
  // ====================================================================
  function init() {
    registerTvKeys();
    showDeviceInfo();
    refresh(true);
    requestAnimationFrame(pollPads);

    if (IS_TIZEN) {
      // pen drive conectado/removido → atualiza sozinho
      try {
        tizen.filesystem.addStorageStateChangeListener(function (s) {
          if (state.view !== "launcher") return;
          toast(s.state === "MOUNTED" ? "Pen drive conectado" : "Pen drive removido", 1800);
          setTimeout(function () { refresh(true); }, 800);
        });
      } catch (e) {}
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && state.view === "launcher") refresh(true);
        if (document.hidden && state.view === "game") openMenu();
      });
    }
    window.addEventListener("resize", function () { state.firstRow = 0; setFocus(); });
  }

  init();
})();
