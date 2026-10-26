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
  var COLS = 3;

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

  var ICONS = {
    drive: '<svg viewBox="0 0 64 44" aria-hidden="true"><path d="M22 4h20l18 31H40z" fill="#f2b705"/><path d="M22 4L4 35l10 7 18-31z" fill="#1fa463"/>' +
      '<path d="M14 42h38l8-7H24z" fill="#4285f4"/></svg>',
    pair: '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M16 4h32a14 14 0 0 1 0 28c-5 0-8-3-10-6H26c-2 3-5 6-10 6A14 14 0 0 1 16 4z" fill="#ece9f2"/>' +
      '<path d="M15 12v10M10 17h10" stroke="#332e45" stroke-width="3.5" stroke-linecap="round"/>' +
      '<circle cx="46" cy="12.5" r="3.2" fill="#3a63c8"/><circle cx="52" cy="18" r="3.2" fill="#d6383c"/>' +
      '<circle cx="46" cy="23.5" r="3.2" fill="#e8b71f"/><circle cx="40" cy="18" r="3.2" fill="#2f9a4e"/></svg>',
    net: '<svg viewBox="0 0 64 44" aria-hidden="true"><rect x="2" y="6" width="24" height="17" rx="2" fill="#ece9f2"/><rect x="5" y="9" width="18" height="11" fill="#6c5fc7"/>' +
      '<path d="M10 27h8" stroke="#ece9f2" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="38" y="6" width="24" height="17" rx="2" fill="#ece9f2"/><rect x="41" y="9" width="18" height="11" fill="#3a63c8"/>' +
      '<path d="M46 27h8" stroke="#ece9f2" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M22 37c6 6 14 6 20 0" stroke="#8fe3a5" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M40 33l3 4-5 1" stroke="#8fe3a5" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    phone: '<svg viewBox="0 0 56 48" aria-hidden="true"><path d="M8 4h32a3 3 0 0 1 3 3v26h-4v8H12v-8H5V7a3 3 0 0 1 3-3z" fill="#cfcbd6"/>' +
      '<path d="M9 7h30" stroke="#a9a4b3" stroke-width="2" stroke-dasharray="2 2"/>' +
      '<rect x="10" y="11" width="28" height="15" rx="2" fill="#6c5fc7"/>' +
      '<circle cx="44" cy="36" r="10" fill="#8fe3a5" stroke="#332e45" stroke-width="2.5"/>' +
      '<path d="M44 31v10M39 36h10" stroke="#1d1a24" stroke-width="3" stroke-linecap="round"/></svg>'
  };
  function setInitial(span, g, initial) {
    if (g.action && ICONS[g.action]) span.innerHTML = ICONS[g.action];
    else span.textContent = initial;
  }

  function labelBg(h, action) {
    if (action) return "repeating-linear-gradient(135deg, #3b3550 0, #3b3550 0.8rem, #332e45 0.8rem, #332e45 1.6rem)";
    return "linear-gradient(160deg, hsl(" + h + ",55%,46%), hsl(" + ((h + 40) % 360) + ",60%,28%))";
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

  var TV_LIKE = IS_TIZEN || /SMART-TV|Tizen|Web0S|NetCast|HbbTV/i.test(navigator.userAgent);
  // máximo = imagem 320x240 · leve = 640x480 · normal = tela inteira
  var PERF_NAMES = { max: "velocidade máxima", leve: "equilibrado", normal: "qualidade máxima" };
  function perfMode() {
    var v = null;
    try { v = localStorage.getItem("snestv.perf"); } catch (e) {}
    if (v && PERF_NAMES[v]) return v;
    return TV_LIKE ? "max" : "normal";   // na TV começa no mais rápido
  }
  function perfLight() { return perfMode() !== "normal"; }
  function showFps() { try { return localStorage.getItem("snestv.fps") === "1"; } catch (e) { return false; } }

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
    return snesGet("roms/list.json?" + Date.now()).then(function (txt) {
      var list = JSON.parse(txt);
      if (!list || !list.map) throw new Error("sem servidor");
      return list;
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
      // jogos do Google Drive que ainda não estão na TV
      if (window.Drive && Drive.linked()) {
        var have = {};
        all.forEach(function (g) { have[gameKey(g)] = 1; });
        Drive.files().forEach(function (f) {
          if (!have[f.name + "|" + f.size]) all.push({ name: f.name, size: f.size, source: "drive", driveId: f.id });
        });
        local.forEach(function (g) { if (Drive.files().some(function (f) { return f.name === g.name && f.size === g.size; })) g.fromDrive = true; });
      }
      var seen = {};
      all = all.filter(function (g) { var k = g.source + gameKey(g); if (seen[k]) return false; seen[k] = 1; return true; });
      all.forEach(function (g) { var c = cleanTitle(g.name); g.title = c.title; g.region = c.region; });
      all.sort(function (a, b) { return a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" }); });

      var last = store("snestv.last");
      if (last) all.forEach(function (g) { g.last = gameKey(g) === last; });

      state.games = all;
      var auto = null;
      try { auto = localStorage.getItem("snestv.autostart"); localStorage.removeItem("snestv.autostart"); } catch (e) {}
      if (auto) {
        var ag = all.filter(function (g) { return gameKey(g) === auto; })[0];
        if (ag) setTimeout(function () { startGame(ag); }, 50);
      }
      var inv = null;
      try { inv = localStorage.getItem("snestv.autoinvite"); localStorage.removeItem("snestv.autoinvite"); } catch (e) {}
      if (inv) {
        var ig = all.filter(function (g) { return gameKey(g) === inv; })[0];
        if (ig) setTimeout(function () { state.netIdx = all.indexOf(ig); netHost(ig); }, 300);
      }
      var label = [];
      if (IS_TIZEN) label.push(usb.drives ? (usb.drives === 1 ? "Pen drive conectado" : usb.drives + " pen drives") : "Nenhum pen drive");
      if (pcGames.length) label.push("Pasta do PC");
      if (local.length) label.push("Jogos salvos nesta TV");
      if (window.Drive && Drive.linked()) label.push("Google Drive");
      if (!label.length) label.push(IS_TIZEN ? "Nenhum pen drive" : "Navegador");
      $("source-label").textContent = label.join(" · ");
      $("count").textContent = all.length ? all.length + (all.length === 1 ? " jogo" : " jogos") : "";
      renderGrid();
      if (!silent && IS_TIZEN && usb.drives && !usb.games.length) toast("O pen drive não tem jogos .sfc / .smc / .zip");
    }).then(function () { scanning = false; }, function () { scanning = false; });
  }

  // ====================================================================
  // Menu lateral (seções) + grade de cartuchos
  // ====================================================================
  var SIDE = [
    { k: "all", t: "Jogos instalados", i: "🎮", filter: true },
    { k: "two", t: "2 jogadores", i: "👥", filter: true },
    { k: "drive", t: "Google Drive", i: "☁", filter: true },
    { k: "add", t: "Adicionar jogo", i: "＋", act: "phone" },
    { k: "adddrive", t: "Adicionar do Drive", i: "⇪", act: "drive" },
    { k: "open", t: "Abrir arquivos…", i: "📂", act: "open" },
    { k: "pad", t: "Configurar controle", i: "🕹", act: "wizard" },
    { k: "pair", t: "Celular como controle", i: "📱", act: "pair" },
    { k: "net", t: "Jogar online", i: "🌐", act: "net" },
    { k: "ach", t: "Conquistas", i: "★", act: "ach" }
  ];
  var SIDE_INFO = {
    all: "Os jogos do pen drive, da pasta do PC e os salvos nesta TV (inclusive os que vieram do Google Drive).",
    two: "Jogos que dá para jogar em duas pessoas ou mais (alguns são alternados: um de cada vez). Com 3 ou 4 jogadores, o Multitap liga sozinho.",
    drive: "Jogos de SNES do seu Google Drive. Ao abrir, o jogo é baixado e fica salvo na TV.",
    add: "Mande jogos do celular para a TV: leia o QR Code com a câmera e escolha os arquivos .sfc, .smc ou .zip.",
    adddrive: "Conecte o seu Google Drive: os jogos de SNES de lá aparecem na seção Google Drive.",
    open: "Escolha arquivos .sfc, .smc ou .zip deste aparelho. Eles ficam salvos para a próxima vez.",
    pad: "Joystick com botões trocados? Siga a tela apertando cada botão pedido. Fica salvo para aquele modelo.",
    pair: "Transforme o celular num controle de Super Nintendo. Até 4 celulares, um para cada jogador.",
    net: "Jogue com um amigo em outra TV, pela internet, com um código.",
    ach: "Conquistas do SNES TV e da comunidade (RetroAchievements)."
  };
  function sideItems() {
    var tvBrowser = /SMART-TV|Tizen|Web0S|NetCast|HbbTV/i.test(navigator.userAgent);
    return SIDE.filter(function (it) { return it.k !== "open" || (!IS_TIZEN && !tvBrowser); });
  }
  state.zone = state.zone || "grid";
  state.section = state.section || "all";
  state.sideIdx = state.sideIdx || 0;

  // quantos jogadores (base do libretro-database); 0 = não sabe
  var PLAYERS = null;
  function loadPlayers() {
    return snesGet("players.json", "text").then(function (t) { try { PLAYERS = JSON.parse(t); } catch (e) {} }, function () {});
  }
  function playersOf(g) {
    if (!PLAYERS || !g || g.action) return 0;
    // rápido: pelo nome do arquivo; o nome oficial (busca de capa) só se já foi calculado
    var n = PLAYERS[normTitle(g.title)];
    if (n) return n;
    // jogos instalados são poucos: pode buscar o nome oficial; os do Drive só se já foi calculado
    var cn = g.source === "drive" ? coverCache[gameKey(g)] : coverName(g);
    return cn ? PLAYERS[normTitle(cn)] || 0 : 0;
  }

  function sectionGames(sec) {
    var all = state.games || [];
    if (sec === "drive") return all.filter(function (g) { return g.source === "drive" || g.fromDrive; });
    var inst = all.filter(function (g) { return g.source !== "drive"; });
    if (sec === "two") return all.filter(function (g) { return playersOf(g) >= 2; });
    return inst;
  }
  function sectionCount(sec) { return sectionGames(sec).length; }

  function renderSide() {
    var ul = $("side-list"), list = sideItems();
    if (state.sideIdx >= list.length) state.sideIdx = 0;
    ul.innerHTML = "";
    list.forEach(function (it, i) {
      var li = document.createElement("li");
      li.className = (it.filter ? "sec" : "act") + (it.k === state.section ? " current" : "") + (state.zone === "side" && i === state.sideIdx ? " focused" : "");
      li.innerHTML = "<i></i><span></span><b></b>";
      li.querySelector("i").textContent = it.i;
      li.querySelector("span").textContent = it.t;
      if (it.filter) li.querySelector("b").textContent = state.games ? sectionCount(it.k) : "";
      if (it.k === "drive" && !(window.Drive && Drive.linked())) li.querySelector("b").textContent = "";
      if (i === list.length - 1 || (it.filter && list[i + 1] && !list[i + 1].filter)) li.className += " sep";
      li.addEventListener("click", function () { state.zone = "side"; state.sideIdx = i; sideActivate(); });
      ul.appendChild(li);
    });
  }

  function renderGrid() {
    detKey = null;
    var grid = $("grid");
    grid.innerHTML = "";
    var items = sectionGames(state.section);
    var emptyTxt = {
      all: ["Nenhum jogo instalado", "Coloque jogos .sfc, .smc ou .zip num pen drive, ou use \"Adicionar jogo\" no menu ao lado."],
      two: ["Nenhum jogo de 2 jogadores", "Os jogos para jogar em dupla aparecem aqui assim que estiverem na lista."],
      drive: window.Drive && Drive.linked() ? ["Nenhum jogo no Google Drive", "Não achei arquivos .sfc, .smc ou .zip de SNES no seu Drive. Use \"Adicionar via Google Drive\" → Procurar de novo."] :
        ["Google Drive não conectado", "Escolha \"Adicionar via Google Drive\" no menu ao lado para entrar com a sua conta."]
    }[state.section] || ["", ""];
    $("empty-title").textContent = emptyTxt[0];
    $("empty-text").textContent = emptyTxt[1];
    $("empty").hidden = items.length > 0;
    grid.hidden = items.length === 0;

    // cartuchos "leves": capa, nome oficial e progresso só para os que estão na tela (ver hydrate)
    var lastIdx = -1, frag = document.createDocumentFragment();
    items.forEach(function (g, i) {
      var el = document.createElement("div");
      el.className = "tile";
      el.setAttribute("role", "option");
      var meta = [g.region, fmtSize(g.size), g.source === "usb" ? "USB" : g.source === "pc" ? "PC" : g.source === "drive" ? "☁ Drive" : g.source === "local" ? (g.fromDrive ? "Drive ✓" : "salvo") : ""].filter(Boolean).join(" · ");
      el.innerHTML =
        '<div class="cart"><div class="shell"><div class="cart-label" style="background:' + labelBg(hashHue(g.title)) + '"><span></span></div></div></div>' +
        '<div class="title"></div><div class="meta"></div>';
      el.querySelector(".cart-label span").textContent = (g.title.match(/[A-Za-z0-9À-ú]/) || ["?"])[0].toUpperCase();
      el.querySelector(".title").textContent = g.title;
      el.querySelector(".meta").textContent = meta;
      if (g.last) {
        var bd = document.createElement("span"); bd.className = "badge"; bd.textContent = "último";
        el.querySelector(".meta").appendChild(bd);
        lastIdx = i;
      }
      el.addEventListener("click", function () { state.zone = "grid"; state.focus = i; setFocus(); activate(); });
      frag.appendChild(el);
    });
    grid.appendChild(frag);
    state.items = items;
    if (state.focus >= items.length || state.firstRender !== false) {
      state.focus = lastIdx >= 0 ? lastIdx : 0;
      state.firstRender = false;
    }
    // lista vazia: o foco vai para o menu; quando chegarem jogos, volta para a grade
    if (!items.length && state.zone === "grid") { state.zone = "side"; state.autoSide = true; }
    else if (items.length && state.autoSide) { state.zone = "grid"; state.autoSide = false; }
    state.firstRow = Math.min(state.firstRow || 0, Math.max(0, Math.floor((items.length - 1) / COLS)));
    renderSide();
    var cnt = items.length;
    $("count").textContent = cnt ? cnt + (cnt === 1 ? " jogo" : " jogos") : "";
    if (state.games.length) setTimeout(raScan, 1200);
    setFocus();
  }

  // completa os cartuchos visíveis (e uma linha antes/depois): capa, nome, jogadores, barra de conquistas
  function hydrate() {
    var tiles = $("grid").children, items = state.items || [];
    var first = Math.max(0, (state.firstRow || 0) - 1) * COLS, last = Math.min(items.length, ((state.firstRow || 0) + 4) * COLS);
    for (var i = first; i < last; i++) {
      var el = tiles[i], g = items[i];
      if (!el || el.hydrated) continue;
      el.hydrated = true;
      putCover(el.querySelector(".cart-label"), coverUrl(g));
      var cn = coverName(g);
      if (cn) el.querySelector(".title").textContent = cleanTitle(cn).title;
      var pl = playersOf(g);
      if (pl >= 2) {
        var pb = document.createElement("span"); pb.className = "badge pl"; pb.textContent = "👥 " + pl;
        el.querySelector(".meta").appendChild(pb);
      }
      paintBar(el, g);
    }
  }

  function setFocus() {
    $("greet").classList.toggle("focused", state.focus === -1);
    var tiles = $("grid").children, side = $("side-list").children;
    for (var s2 = 0; s2 < side.length; s2++) side[s2].classList.toggle("focused", state.focus !== -1 && state.zone === "side" && s2 === state.sideIdx);
    $("side").classList.toggle("active", state.zone === "side" && state.focus !== -1);
    if (state.focus === -1) {
      for (var j = 0; j < tiles.length; j++) tiles[j].classList.remove("focused");
      return;
    }
    var inGrid = state.zone === "grid";
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle("focused", inGrid && i === state.focus);
    if (!inGrid) {
      var it = sideItems()[state.sideIdx];
      if (it) showDetails(it.filter ? { action: "sec:" + it.k, title: it.t, icon: it.i } : { action: it.act, title: it.t, sideKey: it.k, icon: it.i });
    } else showDetails(state.items && state.items[state.focus]);
    var el = tiles[state.focus];
    // rolagem por linhas: o topo da tela sempre começa numa linha inteira
    var shelf = $("shelf"), grid = $("grid");
    if (el && inGrid) {
      var row = Math.floor(state.focus / COLS);
      var rowTop = function (r) { var t = tiles[r * COLS]; return t ? t.offsetTop : 0; };
      var first = Math.min(state.firstRow || 0, row);
      while (first < row && el.offsetTop + el.offsetHeight - rowTop(first) + 30 > shelf.clientHeight) first++;
      state.firstRow = first;
      grid.style.transform = "translateY(" + (first ? -(rowTop(first) - rowTop(0)) : 0) + "px)";
    } else if (!tiles.length) grid.style.transform = "translateY(0px)";
    hydrate();
  }

  var sideTimer = null;
  function moveFocus(dx, dy) {
    state.autoSide = false;
    var n = state.items ? state.items.length : 0;
    var f = state.focus;
    if (f === -1) { if (dy > 0) { state.focus = Math.min(Math.max(0, state.focus), Math.max(0, n - 1)); if (state.focus < 0) state.focus = 0; setFocus(); } return; }
    if (state.zone === "side") {
      var list = sideItems();
      if (dx > 0) { if (n) { state.zone = "grid"; state.focus = Math.min(state.focus, n - 1); if (state.focus < 0) state.focus = 0; } setFocus(); return; }
      if (dy < 0 && state.sideIdx === 0) { state.focus = -1; setFocus(); return; }
      if (dy) {
        state.sideIdx = Math.max(0, Math.min(list.length - 1, state.sideIdx + dy));
        setFocus();
        // seção: mostra os jogos dela logo (com um pequeno atraso para não pesar ao rolar o menu)
        var it = list[state.sideIdx];
        clearTimeout(sideTimer);
        if (it.filter && it.k !== state.section) sideTimer = setTimeout(function () {
          state.section = it.k; state.focus = 0; state.firstRow = 0; renderGrid();
        }, 280);
      }
      return;
    }
    if (!n) { state.zone = "side"; setFocus(); return; }
    // primeira coluna + ◀ → menu lateral
    if (dx < 0 && f % COLS === 0) { state.zone = "side"; setFocus(); return; }
    if (dy < 0 && f < COLS) { state.focus = -1; setFocus(); return; }
    if (dx) f = Math.min(n - 1, Math.max(0, f + dx));
    if (dy) {
      var t = f + dy * COLS;
      if (t >= 0 && t < n) f = t;
      else if (dy > 0 && Math.floor(f / COLS) < Math.floor((n - 1) / COLS)) f = n - 1;
    }
    state.focus = f;
    setFocus();
  }

  function sideActivate() {
    var it = sideItems()[state.sideIdx];
    if (!it) return;
    if (it.filter) {
      clearTimeout(sideTimer);
      if (it.k !== state.section) { state.section = it.k; state.focus = 0; state.firstRow = 0; renderGrid(); }
      if (state.items.length) { state.zone = "grid"; setFocus(); }
      else if (it.k === "drive" && !(window.Drive && Drive.linked())) openDrive();
      return;
    }
    if (it.act === "open") { $("file-input").click(); return; }
    if (it.act === "phone") { openPhone(); return; }
    if (it.act === "pair") { openPair("launcher"); return; }
    if (it.act === "ach") { openAch("launcher"); return; }
    if (it.act === "net") { openNet(); return; }
    if (it.act === "drive") { openDrive(); return; }
    if (it.act === "wizard") { openWizard(); return; }
  }

  function activate() {
    if (state.focus === -1) { openName(); return; }
    if (state.zone === "side") { sideActivate(); return; }
    var g = state.items && state.items[state.focus];
    if (!g) return;
    if (state.netPick) { netHost(g); return; }
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

  // ---------------- excluir jogo ----------------
  function canDelete(g) { return g && !g.action && (g.source === "local" || (g.source === "usb" && g.tfile)); }
  function removeFocused() {
    if (state.zone === "side" || state.focus < 0) return;
    var g = state.items && state.items[state.focus];
    if (!g || g.action) return;
    if (g.source === "pc") { toast("Este jogo está na pasta do PC — para tirar, apague o arquivo lá", 3500); return; }
    if (g.source === "drive") { toast("Este jogo está no seu Google Drive — para tirar da lista, apague ou mova lá", 3500); return; }
    if (!canDelete(g)) return;
    state.delGame = g;
    state.delBtn = 0;
    state.view = "del";
    var cn = coverName(g);
    $("del-title").textContent = cn ? cleanTitle(cn).title : g.title;
    $("del-text").textContent = g.source === "usb" ? "O arquivo será apagado do pen drive." : "O jogo será apagado desta TV.";
    $("del").hidden = false;
    paintDel();
  }
  function paintDel() {
    var b = $("del").querySelectorAll(".net-btn");
    for (var i = 0; i < b.length; i++) b[i].classList.toggle("focused", i === state.delBtn);
  }
  function closeDel() { $("del").hidden = true; state.view = "launcher"; padPrev = {}; }
  function dbDel(key) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction("states", "readwrite");
        tx.objectStore("states").delete(key);
        tx.oncomplete = res; tx.onerror = res;
      });
    }).catch(function () {});
  }
  function deleteUsbFile(g) {
    return new Promise(function (resolve, reject) {
      try {
        var full = g.tfile.fullPath || g.path, dirPath = full.substring(0, full.lastIndexOf("/"));
        tizen.filesystem.resolve(dirPath, function (dir) {
          try { dir.deleteFile(full, resolve, reject); } catch (e) { reject(e); }
        }, reject, "rw");
      } catch (e) { reject(e); }
    });
  }
  function confirmDel() {
    var act = $("del").querySelectorAll(".net-btn")[state.delBtn].getAttribute("data-act");
    var g = state.delGame;
    closeDel();
    if (act === "cancel" || !g) return;
    var key = gameKey(g);
    var job = g.source === "usb" ? deleteUsbFile(g) : romsDel(g.name);
    job.then(function () {
      if (act === "all") {
        ["sram2005:", "state2005:", "state:"].forEach(function (p) { dbDel(p + key); });
      }
      try { localStorage.removeItem("snestv.cover." + key); if (store("snestv.last") === key) localStorage.removeItem("snestv.last"); } catch (e) {}
      toast(act === "all" ? "Jogo e saves excluídos" : "Jogo excluído", 2000);
      state.focus = Math.max(0, state.focus - 1);
      refresh(true);
    }, function () {
      toast("Não foi possível apagar o arquivo do pen drive (ele pode estar protegido contra gravação)", 4000);
    });
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
    if (g.source === "drive") return driveBytes(g);
    if (g.source === "pc") {
      return snesGet(g.url, "arraybuffer");
    }
    return readTizenFile(g);
  }

  function showLoading(g, text) {
    $("loading-initial").textContent = (g.title.match(/[A-Za-z0-9]/) || ["S"])[0].toUpperCase();
    var lab = $("loading-initial").parentNode;
    lab.style.background = labelBg(hashHue(g.title));
    lab.classList.remove("has-cover");
    var old = lab.querySelector("img.cover"); if (old) old.parentNode.removeChild(old);
    if (g.title) putCover(lab, coverUrl(g));
    $("loading-text").textContent = text;
    $("loading").hidden = false;
  }

  function startGame(g, net) {
    state.view = "loading";
    state.net = net || null;
    state.current = g;
    showLoading(g, g.source === "usb" ? "Lendo do pen drive…" : g.source === "drive" ? "Baixando do Google Drive…" : "Carregando " + g.title + "…");
    store("snestv.last", gameKey(g));

    getRomBytes(g).then(function (data) {
      if (net || (engineName() === "lite" && !/\.7z$/i.test(g.name))) return startLite(g, data, net);
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
      var light = perfLight();
      window.EJS_defaultOptions = { "save-save-interval": "30" };
      window.SNESTV_RA_CFG = "";
      if (light) {
        // som mais barato de processar e mais folga no áudio
        window.EJS_defaultOptions["snes9x_audio_interpolation"] = "none";
        window.EJS_defaultOptions["shader"] = "disabled";
        window.SNESTV_RA_CFG = 'audio_resampler = "nearest"\naudio_resampler_quality = "1"\naudio_latency = 128\nvideo_smooth = false';
      }
      $("game").classList.toggle("light", light);
      $("game").classList.toggle("max", perfMode() === "max");
      fitPlayer();
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
        fitPlayer();
        startFps();
        Conquistas.detect(null);
        buildSideHelp(g, null);
        Conquistas.gameStarted(gameKey(g));
        startAchTimer();
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
      if (g.source === "drive") {
        // Drive: volta para a lista em vez de recarregar a página
        $("loading").hidden = true; $("game").hidden = true; $("launcher").hidden = false;
        state.view = "launcher";
        if (e && /expirado/.test(e.message)) { toast("O acesso ao Google Drive acabou (dura 1 hora). Entre de novo.", 4000); openDrive(); }
        else toast("Não consegui baixar do Google Drive: " + ((e && e.message) || e), 4000);
        return;
      }
      fail("Não foi possível ler o arquivo do jogo.");
    });
  }

  function startLite(g, data, net) {
    $("loading-text").textContent = "Iniciando " + g.title + "…";
    $("launcher").hidden = true;
    $("game").hidden = false;
    $("game").classList.add("lite");
    $("game").classList.remove("light", "max");
    var key = "sram2005:" + gameKey(g);
    var bytes = (typeof Blob !== "undefined" && data instanceof Blob) ? readAsBuffer(data) : Promise.resolve(data);
    var libs = window.LiteSNES ? Promise.resolve() :
      loadScript("lib/fflate.js").then(function () { return loadScript(window.SNES_HAS_WASM ? "lite/snes2005.js" : "lite/snes2005-asm.js"); })
        .then(function () { return loadScript("lite/lite.js"); });
    return libs.then(function () { return bytes; }).then(function (buf) {
      LITE = new LiteSNES({
        container: $("player"),
        // convidado do jogo online usa o save do anfitrião e não grava por cima do próprio
        loadSram: net && net.role === "guest" ? null : function () { return dbGet(key).then(function (d) { return d ? new Uint8Array(d) : null; }, function () { return null; }); },
        saveSram: net && net.role === "guest" ? null : function (u8) { return dbPut(key, u8.buffer); }
      });
      window.SNESTV_LITE = LITE;   // para diagnóstico
      fitPlayer();
      return LITE.start(buf);
    }).then(function () {
      $("loading").hidden = true;
      state.view = "game";
      fitPlayer();
      startFps();
      Conquistas.detect(LITE.rom);
      learnCover(g, LITE.rom);
      buildSideHelp(g, LITE.rom);
      Conquistas.gameStarted(gameKey(g));
      startAchTimer();
      if (window.RA && RA.user()) RA.attach(LITE, LITE.rom, gameKey(g));
      if (net) { netOnLiteReady(); return; }
      if (Conquistas.game) toast("★ Conquistas de " + Conquistas.games[Conquistas.game].name + " ativas", 2600);
    }).catch(function (e) {
      console.error(e);
      if (net) { fail("Não foi possível abrir o jogo online."); return; }
      fail("Este jogo não abriu no emulador TV antiga. Mudei para o TV nova — abra o jogo de novo.");
      try { localStorage.setItem("snestv.engine", "ejs"); } catch (err) {}
    });
  }

  function fail(msg) {
    $("loading").hidden = true;
    toast(msg, 6000);
    // volta para a lista de forma limpa
    setTimeout(function () { location.reload(); }, state.view === "game" ? 3000 : 3500);
  }

  // Modo leve: o emulador desenha numa tela pequena (640x480) e a TV amplia.
  // Isso tira muito trabalho da placa de vídeo da TV.
  function crtOn() { try { return localStorage.getItem("snestv.crt") !== "0"; } catch (e) { return true; } }

  function fitPlayer() {
    var vw = window.innerWidth, vh = window.innerHeight, crt = crtOn();
    // área 4:3 centralizada onde o jogo aparece (menor com o filtro, para caber a moldura do tubo)
    var room = crt ? 0.9 : 1;
    var gw = Math.min(vw * room, vh * room * 4 / 3), gh = gw * 3 / 4;
    var gx = Math.round((vw - gw) / 2), gy = Math.round((vh - gh) / 2);

    var pl = $("stage");
    if ($("game").classList.contains("lite")) {
      pl.style.transform = "";
      pl.style.position = "absolute";
      pl.style.left = gx + "px"; pl.style.top = gy + "px";
      pl.style.width = Math.round(gw) + "px"; pl.style.height = Math.round(gh) + "px";
    } else if ($("game").classList.contains("light")) {
      pl.style.width = pl.style.height = "";
      var W = pl.offsetWidth || 640, H = pl.offsetHeight || 480, k = gh / H;
      pl.style.transform = "scale(" + k + ")";
      pl.style.left = Math.round((vw - W * k) / 2) + "px";
      pl.style.top = gy + "px";
    } else if (crt) {
      pl.style.transform = "";
      pl.style.position = "absolute";
      pl.style.left = gx + "px"; pl.style.top = gy + "px";
      pl.style.width = Math.round(gw) + "px"; pl.style.height = Math.round(gh) + "px";
    } else {
      pl.style.transform = ""; pl.style.position = "";
      pl.style.left = pl.style.top = pl.style.width = pl.style.height = "";
    }

    // Filtro de TV de tubo: uma imagem pronta, desenhada uma vez só, colada por cima do jogo
    var el = $("crt");
    el.hidden = !crt;
    $("game").classList.toggle("crt-on", crt);
    if (crt) buildCrt(el, vw, vh, gx, gy, Math.round(gw), Math.round(gh));
    placeSides(gx, Math.round(gw), vw);
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  var crtKey = "";
  function buildCrt(cv, vw, vh, gx, gy, gw, gh) {
    var key = [vw, vh, gx, gy, gw, gh].join("x");
    if (key === crtKey) return;          // já está pronta para este tamanho
    crtKey = key;
    cv.width = vw; cv.height = vh;
    var c = cv.getContext("2d");
    var r = Math.round(gh * 0.045);      // cantos arredondados do tubo
    var b = Math.round(vh * 0.019);      // espessura da moldura

    // fundo preto + moldura de plástico
    c.fillStyle = "#000"; c.fillRect(0, 0, vw, vh);
    roundRectPath(c, gx - b - 4, gy - b - 4, gw + 2 * b + 8, gh + 2 * b + 8, r + b + 4); c.fillStyle = "#121116"; c.fill();
    roundRectPath(c, gx - b, gy - b, gw + 2 * b, gh + 2 * b, r + b); c.fillStyle = "#2b2831"; c.fill();
    roundRectPath(c, gx - b + 3, gy - b + 3, gw + 2 * b - 6, gh + 2 * b - 6, r + b - 3); c.fillStyle = "#0d0c10"; c.fill();

    // abre o buraco da tela
    c.save();
    roundRectPath(c, gx, gy, gw, gh, r);
    c.globalCompositeOperation = "destination-out";
    c.fill();
    c.restore();

    // tudo daqui para baixo fica só dentro da tela
    c.save();
    roundRectPath(c, gx, gy, gw, gh, r);
    c.clip();

    // linhas de varredura: uma faixa escura por linha do SNES (224 linhas)
    var lh = gh / 224;
    for (var i = 0; i < 224; i++) {
      var y = gy + i * lh;
      c.fillStyle = "rgba(0,0,0,0.30)"; c.fillRect(gx, y + lh * 0.5, gw, lh * 0.38);
      c.fillStyle = "rgba(0,0,0,0.10)"; c.fillRect(gx, y + lh * 0.88, gw, lh * 0.12);
    }
    // grade de fósforo RGB
    var cols = ["rgba(255,60,60,0.05)", "rgba(60,255,90,0.05)", "rgba(70,100,255,0.05)"];
    for (var x = gx; x < gx + gw; x++) { c.fillStyle = cols[(x - gx) % 3]; c.fillRect(x, gy, 1, gh); }
    // vinheta (bordas do tubo mais escuras)
    var vg = c.createRadialGradient(gx + gw / 2, gy + gh / 2, gh * 0.45, gx + gw / 2, gy + gh / 2, gh * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = vg; c.fillRect(gx, gy, gw, gh);
    // sombra interna da borda do vidro
    for (var k = 0; k < 14; k++) {
      roundRectPath(c, gx + k, gy + k, gw - 2 * k, gh - 2 * k, Math.max(2, r - k));
      c.strokeStyle = "rgba(0,0,0," + (0.42 * (1 - k / 14)).toFixed(3) + ")";
      c.lineWidth = 2; c.stroke();
    }
    // reflexo suave no vidro
    var gl = c.createRadialGradient(gx + gw * 0.28, gy + gh * 0.18, 0, gx + gw * 0.28, gy + gh * 0.18, gh * 0.45);
    gl.addColorStop(0, "rgba(255,255,255,0.06)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gl; c.fillRect(gx, gy, gw, gh);
    c.restore();
  }
  window.addEventListener("resize", fitPlayer);

  var fpsTimer = null;
  function startFps() {
    clearInterval(fpsTimer);
    var el = $("fps");
    el.hidden = !showFps();
    if (el.hidden) return;
    var last = null, lastT = 0, lastD = 0;
    fpsTimer = setInterval(function () {
      if (!E.ready()) return;
      var n = 0; try { n = E.frames(); } catch (e) { return; }
      var t = performance.now();
      if (last !== null && state.view === "game") {
        var fps = (n - last) * 1000 / (t - lastT);
        var extra = "";
        if (LITE) {
          var d = LITE.drawn || 0, img = (d - lastD) * 1000 / (t - lastT);
          lastD = d;
          if (img < fps - 2) extra = " · imagem " + Math.round(img);
        }
        el.textContent = Math.round(fps) + " FPS" + (fps < 55 ? " · lento" : "") + extra;
        el.className = "fps " + (fps >= 57 ? "ok" : fps >= 45 ? "mid" : "bad");
      }
      last = n; lastT = t;
    }, 1000);
  }

  function emu() { return window.EJS_emulator; }
  function gm() { var e = emu(); return e && e.gameManager; }

  // ---------------- Dois motores: "TV antiga" (Snes9x 2005) e "TV nova" (snes9x atual) ----------------
  var LITE = null;
  var ENGINE_NAMES = { lite: "TV antiga (leve)", ejs: "TV nova (completo)" };
  function engineName() {
    var v = null;
    try { v = localStorage.getItem("snestv.engine"); } catch (e) {}
    if (!window.SNES_HAS_WASM) return "lite";     // TV nova (EmulatorJS) precisa de WebAssembly
    return v === "ejs" ? "ejs" : "lite";
  }
  var E = {
    press: function (port, btn, down) {
      if (LITE) return LITE.press(port, btn, down);
      var g = gm(); if (!g) return;
      try { g.simulateInput(port, btn, down ? 1 : 0); } catch (e) {}
    },
    pause: function () { if (LITE) LITE.pause(); else try { emu().pause(); } catch (e) {} },
    play: function () { if (LITE) LITE.play(); else try { emu().play(); } catch (e) {} },
    getState: function () { return LITE ? LITE.getState() : gm().getState(); },
    loadState: function (d) { if (LITE) { LITE.loadState(new Uint8Array(d)); if (window.RA) RA.reset(); } else gm().loadState(d); },
    restart: function () { if (LITE) LITE.reset(); else try { gm().restart(); } catch (e) {} },
    turbo: function (on) { if (LITE) LITE.setTurbo(on); else try { gm().toggleFastForward(on ? 1 : 0); } catch (e) {} },
    saveSram: function () {
      if (LITE) return LITE.saveSram();
      try { gm().saveSaveFiles(); } catch (e) {}
      return new Promise(function (r) { setTimeout(r, 1200); });   // dá tempo do IndexedDB gravar
    },
    frames: function () { if (LITE) return LITE.frames; var g = gm(); return g ? g.getFrameNum() : 0; },
    ready: function () { return !!(LITE || gm()); }
  };

  function focusEmu() {
    var e = emu();
    try { if (e && e.elements && e.elements.parent) e.elements.parent.focus(); } catch (err) {}
  }

  function press(btn, down) { E.press(0, btn, down); }

  function releaseAll() {
    Object.keys(state.held).forEach(function (k) { press(state.held[k], false); });
    state.held = {};
  }

  // ---------------- Menu de pausa ----------------
  function openMenu() {
    releaseAll();
    releasePads();
    E.pause();
    state.view = "menu";
    state.menuFocus = 0;
    $("menu-title").textContent = state.current ? state.current.title : "Pausado";
    $("turbo-state").textContent = state.turbo ? "ligada" : "desligada";
    $("perf-state").textContent = LITE ? "automático" : PERF_NAMES[perfMode()];
    $("engine-state").textContent = ENGINE_NAMES[LITE ? "lite" : "ejs"];
    $("fps-state").textContent = showFps() ? "sim" : "não";
    $("crt-state").textContent = crtOn() ? "ligado" : "desligado";
    $("side-state").textContent = sideOn() ? "sim" : "não";
    $("padmodel-state").textContent = PADMODEL_NAMES[padModel()];
    $("menu").hidden = false;
    paintMenu();
  }

  function closeMenu() {
    $("menu").hidden = true;
    state.view = "game";
    E.play();
    focusEmu();
  }

  function paintMenu() {
    var items = $("menu-list").children;
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("focused", i === state.menuFocus);
  }

  function menuAction() {
    var act = $("menu-list").children[state.menuFocus].getAttribute("data-act");
    var key = (LITE ? "state2005:" : "state:") + gameKey(state.current);
    if (act === "resume") return closeMenu();
    if (LITE && LITE.net && /^(save|load|turbo|restart|engine|perf)$/.test(act)) {
      toast("Desativado no jogo online (as duas TVs precisam ficar iguais)", 3000); return;
    }
    if (act === "save") {
      try {
        var data = E.getState();
        dbPut(key, data).then(function () { toast("Estado salvo"); Conquistas.unlock("gen_save"); closeMenu(); },
          function () { toast("Não foi possível salvar o estado"); });
      } catch (e) { toast("Não foi possível salvar o estado"); }
      return;
    }
    if (act === "load") {
      dbGet(key).then(function (data) {
        if (!data) { toast("Nenhum estado salvo para este jogo"); return; }
        E.loadState(data);
        toast("Estado carregado");
        closeMenu();
      }, function () { toast("Não foi possível carregar o estado"); });
      return;
    }
    if (act === "turbo") {
      state.turbo = !state.turbo;
      E.turbo(state.turbo);
      $("turbo-state").textContent = state.turbo ? "ligada" : "desligada";
      return;
    }
    if (act === "restart") { E.restart(); closeMenu(); return; }
    if (act === "invite") { netInvite(); return; }
    if (act === "engine") {
      if (!window.SNES_HAS_WASM) { toast("O emulador TV nova precisa de um navegador mais novo. Esta TV usa só o TV antiga.", 4000); return; }
      var ne = engineName() === "lite" ? "ejs" : "lite";
      try { localStorage.setItem("snestv.engine", ne); } catch (e) {}
      try { localStorage.setItem("snestv.autostart", gameKey(state.current)); } catch (e) {}
      $("engine-state").textContent = ENGINE_NAMES[ne];
      return exitGame("Trocando para o emulador " + ENGINE_NAMES[ne] + "…");
    }
    if (act === "perf") {
      if (LITE) { toast("Este ajuste é só para o emulador TV nova. O TV antiga já roda no modo mais leve.", 3500); return; }
      var next = { max: "leve", leve: "normal", normal: "max" }[perfMode()];
      try { localStorage.setItem("snestv.perf", next); } catch (e) {}
      try { localStorage.setItem("snestv.autostart", gameKey(state.current)); } catch (e) {}
      $("perf-state").textContent = PERF_NAMES[next];
      return exitGame("Reabrindo em " + PERF_NAMES[next] + "…");
    }
    if (act === "side") {
      try { localStorage.setItem("snestv.side", sideOn() ? "0" : "1"); } catch (e) {}
      $("side-state").textContent = sideOn() ? "sim" : "não";
      fitPlayer();
      return;
    }
    if (act === "crt") {
      try { localStorage.setItem("snestv.crt", crtOn() ? "0" : "1"); } catch (e) {}
      $("crt-state").textContent = crtOn() ? "ligado" : "desligado";
      fitPlayer();
      return;
    }
    if (act === "padmodel") {
      var order = ["auto", "snes", "xbox", "ps"], nm = order[(order.indexOf(padModel()) + 1) % order.length];
      try { localStorage.setItem("snestv.padmodel", nm); } catch (e) {}
      $("padmodel-state").textContent = PADMODEL_NAMES[nm];
      if (state.current) buildSideHelp(state.current, LITE ? LITE.rom : null);
      return;
    }
    if (act === "fps") {
      try { localStorage.setItem("snestv.fps", showFps() ? "0" : "1"); } catch (e) {}
      $("fps-state").textContent = showFps() ? "sim" : "não";
      startFps();
      return;
    }
    if (act === "controls") { openHelp("menu"); return; }
    if (act === "pair") { openPair("menu"); return; }
    if (act === "ach") { openAch("menu"); return; }
    if (act === "exit") return exitGame();
  }

  function exitGame(msg) {
    netEnd();
    $("menu").hidden = true;
    showLoading(state.current, typeof msg === "string" ? msg : "Salvando…");
    Conquistas.flush();
    if (window.RA) RA.detach();
    Promise.resolve(E.saveSram()).catch(function () {}).then(function () {
      if (LITE) LITE.stop();
      setTimeout(function () { location.reload(); }, 300);
    });
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

  // Navegador da TV: a tecla VOLTAR do controle remoto às vezes não chega à página — o navegador
  // usa ela para "voltar no histórico". Deixamos uma entrada extra no histórico e, quando o
  // navegador volta, tratamos como VOLTAR do app.
  var lastBackKey = 0, guardOn = false;
  function armBackGuard() {
    if (guardOn || IS_TIZEN) return;
    try { history.pushState({ snestv: 1 }, ""); guardOn = true; } catch (e) {}
  }
  window.addEventListener("popstate", function () {
    guardOn = false;
    if (Date.now() - lastBackKey < 400) { armBackGuard(); return; }   // a tecla já foi tratada
    if (state.view === "launcher") return;     // na lista: deixa o navegador sair normalmente
    var ev;
    try { ev = document.createEvent("Event"); ev.initEvent("keydown", true, true); } catch (e) { return; }
    try { Object.defineProperty(ev, "keyCode", { get: function () { return K.BACK; } }); } catch (e) { return; }
    try { document.activeElement && document.activeElement.blur && document.activeElement.tagName === "INPUT" && document.activeElement.blur(); } catch (e) {}
    window.dispatchEvent(ev);
    armBackGuard();
  });

  window.addEventListener("keydown", function (e) {
    var c = e.keyCode;
    if (c === K.BACK || c === K.ESC || c === 65385) lastBackKey = Date.now();
    if (c === K.EXIT) return;   // deixa a TV tratar o EXIT

    if (state.view === "net" && state.netMode === "join") {
      if (formKey(e, c, ["net-code", "net-join-ok", "net-join-back"], netJoin, function () { netEnd(); netShow("home"); })) return;
      if (c === K.ENTER || c === 65376) { e.preventDefault(); netJoin(); }
      else if (c === K.BACK || c === K.ESC || c === 65385) { e.preventDefault(); closeNet(); }
      return;                    // deixa digitar o código
    }

    if (state.view === "name") {
      if (formKey(e, c, ["name-input", "name-ok", "name-back"], saveName, function () { if (userName()) closeName(); })) return;
      // 65376 = "Concluído" do teclado da Samsung
      if (c === K.ENTER || c === 65376) { e.preventDefault(); saveName(); }
      return;                    // as outras teclas vão para o campo de texto
    }

    if (state.view === "ra") {
      if (formKey(e, c, ["ra-user", "ra-pass", "ra-ok", "ra-out", "ra-back"], raSubmit, closeRa)) return;
      var inField = document.activeElement && document.activeElement.tagName === "INPUT";
      if (c === K.ENTER || c === 65376) {
        e.preventDefault();
        if (RA.user()) return;
        if (document.activeElement === $("ra-user")) $("ra-pass").focus(); else raSubmit();
      } else if (c === K.BACK || c === K.ESC || c === 65385 || (!inField && c === K.BACKSPACE)) { e.preventDefault(); closeRa(); }
      else if (c === K.DOWN && !RA.user()) { e.preventDefault(); $("ra-pass").focus(); }
      else if (c === K.UP && !RA.user()) { e.preventDefault(); $("ra-user").focus(); }
      return;                    // as outras teclas vão para o campo de texto
    }

    if (state.view === "game") {
      if (isBack(c)) { e.preventDefault(); e.stopPropagation(); openMenu(); return; }
      var map = IS_TIZEN ? TV_KEYS : PC_KEYS;
      if (map[c] !== undefined) {
        e.preventDefault(); e.stopPropagation();
        if (!state.held[c]) { state.held[c] = map[c]; press(map[c], true); Conquistas.input(); }
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
      else if (c === K.BACK) {
        if (state.netPick) { state.netPick = false; $("net-banner").hidden = true; toast("Partida online cancelada", 1800); }
        else quitApp();
      }
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
      else if (c === K.LEFT) toggleDest(-1);
      else if (c === K.RIGHT) toggleDest(1);
    } else if (state.view === "del") {
      if (c === K.LEFT) { state.delBtn = Math.max(0, state.delBtn - 1); paintDel(); }
      else if (c === K.RIGHT) { state.delBtn = Math.min(2, state.delBtn + 1); paintDel(); }
      else if (c === K.ENTER) confirmDel();
      else if (isBack(c)) closeDel();
    } else if (state.view === "net") {
      if (state.netMode === "home") {
        if (c === K.LEFT || c === K.RIGHT || c === K.UP || c === K.DOWN) { state.netBtn = state.netBtn ? 0 : 1; paintNetBtns(); }
        else if (c === K.ENTER) { if (state.netBtn === 0) netCreate(); else netShow("join"); }
        else if (isBack(c)) closeNet();
      } else if (state.netMode === "pick") {
        if (c === K.UP || c === K.LEFT) netPickMove(-1);
        else if (c === K.DOWN || c === K.RIGHT) netPickMove(1);
        else if (c === K.ENTER) netHost(state.games[state.netIdx]);
        else if (isBack(c)) netShow("home");
      } else if (state.netMode === "host" && c === K.ENTER && NET && NET.failed && state.netRetry) { state.netRetry();
      } else if (isBack(c)) { if (state.netMode === "host" && NET && NET.live) closeNet(); else if (state.netMode === "host") { netEnd(); netShow("pick"); } else closeNet(); }
    } else if (state.view === "drive") {
      if (c === K.UP || c === K.LEFT) driveMove(-1);
      else if (c === K.DOWN || c === K.RIGHT) driveMove(1);
      else if (c === K.ENTER) driveAction();
      else if (isBack(c)) closeDrive();
    } else if (state.view === "ach") {
      if (c === K.GREEN || c === 71 /* G */) openRa("ach");
      else if (isBack(c) || c === K.ENTER) closeAch();
      else if (c === K.DOWN) scrollAch(1);
      else if (c === K.UP) scrollAch(-1);
    } else if (state.view === "pair") {
      if (isBack(c) || c === K.ENTER) closePair();
      else if (c === K.RED || c === 82) { stopCtrl(); toast("Celulares desconectados", 2000); closePair(); }
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

  // Xbox: fabricante 045e (Microsoft) / XInput · PlayStation: 054c (Sony) / DualShock / DualSense
  function padType(p) {
    var id = String(p && p.id || "");
    if (/xbox|xinput|045e/i.test(id)) return "xbox";
    if (/054c|dualshock|dualsense|playstation|ps[345]|wireless controller/i.test(id)) return "ps";
    return "generic";
  }
  // ---------- mapeamento automático pelo modelo (base SDL GameControllerDB, ~570 controles) ----------
  var GCDB = null, gcdbLoading = false;
  function loadGcdb() {
    if (GCDB || gcdbLoading) return;
    gcdbLoading = true;
    snesGet("gcdb.json", "text").then(function (t) {
      try { GCDB = JSON.parse(t); } catch (e) { GCDB = {}; }
      mapCache = {}; state.padBadgeDirty = true;
      if (state.view === "game" && state.current) buildSideHelp(state.current, LITE ? LITE.rom : null);
    }, function () { GCDB = {}; });
  }
  function vidPid(p) {
    var id = String(p.id || ""), m = id.match(/Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i) || id.match(/^([0-9a-f]{4})-([0-9a-f]{4})-/i);
    return m ? (m[1] + ":" + m[2]).toLowerCase() : null;
  }
  function autoEntry(p) {
    if (!p || p.mapping === "standard") return null;
    if (!GCDB) { loadGcdb(); return null; }
    var k = vidPid(p);
    return k && GCDB[k] ? GCDB[k] : null;
  }

  function padName(p) {
    var t = padType(p), au = autoEntry(p);
    if (au && t === "generic") return au.n;
    if (t === "xbox") return "Controle Xbox";
    if (t === "ps") return /dualsense|0ce6|ps5/i.test(p.id) ? "Controle PS5" : "Controle PlayStation";
    var n = (p.id || "").replace(/\s*\([^)]*(STANDARD GAMEPAD|Vendor:)[^)]*\)\s*$/i, "")
      .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").replace(/\s+/g, " ").trim();
    return n || "Joystick";
  }
  function padMapKey(p) { return "snestv.pad." + p.id; }
  var mapCache = {};
  function customMap(p) {
    var key = padMapKey(p);
    if (key in mapCache) return mapCache[key];
    var raw = store(key), m = null;
    if (raw) { try { m = JSON.parse(raw); } catch (e) {} }
    mapCache[key] = m;
    return m;
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

  // eixos "presos" (gatilho parado em -1, analógico com defeito): ignorados até se mexerem
  var axisWatch = {};
  function axisVal(p, i) {
    var v = p.axes[i];
    if (v === undefined || v !== v) return 0;
    var key = p.index + "|" + i, w = axisWatch[key], now = Date.now();
    if (!w || Math.abs(v - w.v) > 0.02) { axisWatch[key] = { v: v, t: now, moved: !!w }; return v; }
    // parado longe do centro desde que o controle conectou → não é um analógico (ou está descalibrado)
    if (!w.moved && Math.abs(v) > 0.3 && now - w.t > 1500) return 0;
    return v;
  }
  function stickToDpad(out, ax, ay) {
    // zona morta circular de 45%; diagonais quando o ângulo fica entre duas direções
    if (Math.sqrt(ax * ax + ay * ay) < 0.45) return;
    if (ax < -0.38) out[BTN.LEFT] = true; if (ax > 0.38) out[BTN.RIGHT] = true;
    if (ay < -0.38) out[BTN.UP] = true; if (ay > 0.38) out[BTN.DOWN] = true;
  }
  function readPad(p) {
    var map = customMap(p), out = {}, k;
    var auto = map ? null : autoEntry(p);
    var m = map || (auto && auto.m) || STD_MAP;
    for (k in m) if (tokenOn(p, m[k])) out[k] = true;
    // controle reconhecido pelo modelo: direcional no "hat" (no Linux/Tizen aparece nos últimos eixos)
    if (auto && auto.h && p.axes.length >= 2) {
      var hx = axisVal(p, p.axes.length - 2), hy = axisVal(p, p.axes.length - 1);
      if ((hx === -1 || hx === 0 || hx === 1) && (hy === -1 || hy === 0 || hy === 1)) {
        if (hx < 0) out[BTN.LEFT] = true; if (hx > 0) out[BTN.RIGHT] = true;
        if (hy < 0) out[BTN.UP] = true; if (hy > 0) out[BTN.DOWN] = true;
      }
    }
    // analógico esquerdo → direcional (também nos joysticks configurados pelo assistente,
    // a não ser que o assistente já tenha usado esses eixos)
    var usesAxes = false;
    if (map) for (k in map) if (/^a[01]\b|^a[01][+=-]/.test(map[k])) usesAxes = true;
    if (!usesAxes) stickToDpad(out, axisVal(p, 0), axisVal(p, 1));
    // analógico direito também anda (controle padrão: eixos 2 e 3)
    if (!map && p.mapping === "standard" && p.axes.length >= 4) stickToDpad(out, axisVal(p, 2), axisVal(p, 3));
    if (!map) {
      // controles "não padrão" (alguns PS4/genéricos por Bluetooth): direcional num eixo "hat"
      if (p.mapping !== "standard" && p.axes.length > 9) {
        var h = p.axes[9];
        if (h > -1.05 && h < 1.05) {
          var dir = Math.round((h + 1) * 3.5);   // 0=↑ 1=↗ 2=→ 3=↘ 4=↓ 5=↙ 6=← 7=↖
          if (dir === 7 || dir === 0 || dir === 1) out[BTN.UP] = true;
          if (dir >= 1 && dir <= 3) out[BTN.RIGHT] = true;
          if (dir >= 3 && dir <= 5) out[BTN.DOWN] = true;
          if (dir >= 5 && dir <= 7) out[BTN.LEFT] = true;
        }
      }
      if (!auto && tokenOn(p, "b7")) out.turbo = true;   // gatilho direito (RT/R2/ZR)
      if (!auto && tokenOn(p, "b16")) out.menu = true;   // botão central (Xbox/PS/Home)
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
    var phones = typeof ctrl !== "undefined" ? ctrlCount() : 0;
    if (!pads.length && phones) {
      el.textContent = phones === 1 ? "📱 1 celular como controle" : "📱 " + phones + " celulares como controle";
      box.classList.add("on");
      return;
    }
    if (!pads.length) {
      el.textContent = "Nenhum joystick — conecte por USB ou Bluetooth e aperte um botão";
      box.classList.remove("on");
      return;
    }
    el.textContent = pads.slice(0, 4).map(function (p, n) {
      return "J" + (n + 1) + ": " + padName(p) + (customMap(p) ? " ✓" : autoEntry(p) ? " (auto)" : "");
    }).join("  ·  ") + (phones ? "  ·  📱 " + phones : "");
    box.classList.add("on");
  }

  var knownPads = {};
  function trackConnections(pads) {
    var now = {}, changed = false;
    pads.forEach(function (p, n) {
      var k = p.index + "|" + p.id;
      // controle "não padrão": espera a base de modelos carregar para dar o nome e os botões certos
      if (!knownPads[k] && p.mapping !== "standard" && !GCDB) { loadGcdb(); return; }
      now[k] = padName(p);
      if (!knownPads[k]) {
        changed = true;
        var precisa = p.mapping !== "standard" && !customMap(p), auto = precisa && autoEntry(p);
        toast("🎮 " + padName(p) + " conectado — jogador " + (n + 1) +
          (auto ? ". Botões configurados automaticamente pelo modelo." :
            precisa ? ". Se os botões ficarem trocados, use \"Configurar controle\" no menu." : ""), precisa ? 5000 : 2600);
      }
    });
    Object.keys(knownPads).forEach(function (k) {
      if (!now[k]) { changed = true; toast("Joystick desconectado: " + knownPads[k], 2400); }
    });
    knownPads = now;
    if (changed || state.padBadgeDirty) {
      updatePadBadge(pads); state.padBadgeDirty = false;
      if (changed && state.view === "game" && state.current) buildSideHelp(state.current, LITE ? LITE.rom : null);
      else if (state.view === "game" || state.view === "menu") paintPlayers();
    }
  }

  // botões enviados ao emulador, por jogador
  var padSent = {};
  function releasePads() {
    Object.keys(padSent).forEach(function (k) {
      var parts = k.split(":");
      E.press(+parts[0], +parts[1], false);
    });
    padSent = {};
    if (state.padTurbo) { E.turbo(state.turbo); state.padTurbo = false; }
  }

  function feedGame(states) {
    if (!E.ready()) return;
    states.forEach(function (st, player) {
      SNES_BTNS.forEach(function (b) {
        var k = player + ":" + b, on = !!st[b];
        if (on !== !!padSent[k]) {
          E.press(player, b, on);
          if (on) padSent[k] = true; else delete padSent[k];
        }
      });
    });
  }

  var padPrev = {};
  function pollPads() {
    try {
      if (!guardOn && state.view !== "launcher") armBackGuard();
      var pads = connectedPads();
      trackConnections(pads);
      if (state.view === "wizard") {
        wizardPoll(pads);
      } else {
        var states = pads.slice(0, 4).map(readPad), any = {};
        ctrl.states.forEach(function (st, i) {
          if (!st) return;
          var dst = states[i] || (states[i] = {});
          for (var k in st) dst[k] = true;
        });
        for (var si = 0; si < states.length; si++) if (!states[si]) states[si] = {};
        states.forEach(function (st) { for (var k in st) any[k] = true; });
        var now = performance.now();
        var hit = function (k) {
          if (!any[k]) return false;
          if (!padPrev[k]) { state.rep = state.rep || {}; state.rep[k] = now + 420; return true; }
          // segurando uma direção: repete a cada 130 ms (só na navegação)
          if ((k === BTN.UP || k === BTN.DOWN || k === BTN.LEFT || k === BTN.RIGHT) && state.view !== "game" &&
              state.rep && state.rep[k] && now >= state.rep[k]) { state.rep[k] = now + 130; return true; }
          return false;
        };
        var up = hit(BTN.UP), down = hit(BTN.DOWN), left = hit(BTN.LEFT), right = hit(BTN.RIGHT);
        var ok = hit(BTN.B) || hit(BTN.A) || hit(BTN.START), back = hit(BTN.Y);

        if (state.view === "launcher") {
          if (left) moveFocus(-1, 0); if (right) moveFocus(1, 0);
          if (up) moveFocus(0, -1); if (down) moveFocus(0, 1);
          if (ok) activate();
          if (hit(BTN.X)) openHelp("launcher");
          if (hit(BTN.SELECT)) openWizard();
          if (hit(BTN.Y)) removeFocused();
        } else if (state.view === "game") {
          if ((any[BTN.SELECT] && any[BTN.START]) || hit("menu")) { openMenu(); }
          else {
            // 3º ou 4º jogador presente → liga o Multitap (motor TV antiga)
            if (LITE && !LITE.net) {
              var need = !!(ctrl.conns[2] || ctrl.conns[3] || pads.length >= 3);
              if (need !== !!state.multitap) {
                state.multitap = need;
                var mt = LITE.setMultitap(need);
                if (need) toast(mt ? "Multitap ligado: até 4 jogadores (só nos jogos compatíveis)" : "Este jogo não aceita Multitap — só 2 jogadores", 3500);
              }
            }
            feedGame(states);
            var anyKey = false;
            for (var ak in any) { anyKey = true; break; }
            if (anyKey) {
              Conquistas.input();
              for (var pi = 0; pi < Math.min(pads.length, 4); pi++) {
                var pst = readPad(pads[pi]);
                for (var pk in pst) { state.usedPad = true; break; }
              }
              ctrl.states.forEach(function (st) { if (st) for (var ck in st) { state.usedPhone = true; break; } });
              for (var qi = 1; qi < states.length; qi++) for (var qk in states[qi]) { state.usedCoop = true; break; }
            }
            if (!!any.turbo !== !!state.padTurbo) {
              state.padTurbo = !!any.turbo;
              E.turbo(state.padTurbo || state.turbo);
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
          if (left) toggleDest(-1);
          if (right) toggleDest(1);
        } else if (state.view === "pair") {
          if (back) closePair();
        } else if (state.view === "del") {
          if (left) { state.delBtn = Math.max(0, state.delBtn - 1); paintDel(); }
          if (right) { state.delBtn = Math.min(2, state.delBtn + 1); paintDel(); }
          if (hit(BTN.B) || hit(BTN.A)) confirmDel();
          if (back) closeDel();
        } else if (state.view === "net") {
          if (state.netMode === "home") {
            if (left || right || up || down) { state.netBtn = state.netBtn ? 0 : 1; paintNetBtns(); }
            if (ok) { if (state.netBtn === 0) netCreate(); else netShow("join"); }
            if (back) closeNet();
          } else if (state.netMode === "pick") {
            if (up || left) netPickMove(-1);
            if (down || right) netPickMove(1);
            if (ok) netHost(state.games[state.netIdx]);
            if (back) netShow("home");
          } else if (state.netMode === "host" && ok && NET && NET.failed && state.netRetry) { state.netRetry();
          } else if (back) {
            if (state.netMode === "host" && NET && NET.live) closeNet();
            else if (state.netMode === "host") { netEnd(); netShow("pick"); }
            else closeNet();
          }
        } else if (state.view === "drive") {
          if (up || left) driveMove(-1);
          if (down || right) driveMove(1);
          if (ok) driveAction();
          if (back) closeDrive();
        } else if (state.view === "name") {
          if (back && userName()) closeName();
        } else if (state.view === "ra") {
          if (back) closeRa();
          if (hit(BTN.X) && RA.user()) raLogout();
        } else if (state.view === "ach") {
          if (hit(BTN.X)) openRa("ach");
          else if (back || ok) closeAch();
          if (down) scrollAch(1);
          if (up) scrollAch(-1);
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
    mapCache = {};
    toast("🎮 " + wiz.padName + " configurado!", 2600);
    closeWizard(true);
  }

  function wizardSkip() { if (wiz) { wiz.wait = true; advanceWizard(); } }

  function wizardReset() {
    var pads = connectedPads();
    var p = wiz && wiz.pad !== null ? pads.filter(function (x) { return x.index === wiz.pad; })[0] : pads[0];
    mapCache = {};
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

  // ---------------- onde salvar os jogos recebidos ----------------
  var usbDrives = [];
  function destPref() { try { return localStorage.getItem("snestv.dest") === "usb" ? "usb" : "tv"; } catch (e) { return "tv"; } }
  function destActual() { return destPref() === "usb" && IS_TIZEN && usbDrives.length ? "usb" : "tv"; }
  function paintDest() {
    var d = destActual(), usbOk = IS_TIZEN && usbDrives.length > 0;
    $("dest-tv").classList.toggle("on", d === "tv");
    $("dest-usb").classList.toggle("on", d === "usb");
    $("dest-usb").classList.toggle("off", !usbOk);
    $("dest-usb").textContent = usbOk ? "Pen drive" + (usbDrives.length > 1 ? " (" + usbDrives[0] + ")" : "") : "Pen drive";
    $("dest-note").textContent = !IS_TIZEN ? "Salvar no pen drive só funciona no app instalado na TV." :
      !usbOk ? "Conecte um pen drive para poder salvar nele." :
      d === "usb" ? "Os jogos vão para a pasta SNES do pen drive." : "";
  }
  function toggleDest(dir) {
    if (!IS_TIZEN || !usbDrives.length) { paintDest(); toast(IS_TIZEN ? "Nenhum pen drive conectado" : "Pen drive só no app instalado na TV", 2500); return; }
    try { localStorage.setItem("snestv.dest", dir > 0 ? "usb" : "tv"); } catch (e) {}
    paintDest();
  }
  function refreshDrives() {
    if (!IS_TIZEN) { usbDrives = []; return Promise.resolve(); }
    return tizenStorages().then(function (list) { usbDrives = list.map(function (s) { return s.label; }); });
  }

  // grava o jogo na pasta SNES do pen drive (app instalado)
  function saveToUsb(name, u8) {
    return new Promise(function (resolve, reject) {
      var label = usbDrives[0];
      try {
        tizen.filesystem.resolve(label, function (root) {
          var dir;
          try { dir = root.resolve("SNES"); } catch (e) { try { dir = root.createDirectory("SNES"); } catch (e2) { return reject(e2); } }
          var path = dir.fullPath + "/" + name;
          try { dir.deleteFile(path, function () { write(); }, function () { write(); }); } catch (e) { write(); }
          function write() {
            // API nova (Tizen 5.0+)
            try {
              if (tizen.filesystem.openFile) {
                var fh = tizen.filesystem.openFile(path, "w");
                fh.writeData(u8); fh.close();
                return resolve();
              }
            } catch (e) { /* cai para a API antiga */ }
            try {
              var file = dir.createFile(name);
              file.openStream("w", function (fs) {
                try {
                  for (var off = 0; off < u8.length; off += 65536) {
                    fs.writeBytes(Array.prototype.slice.call(u8.subarray(off, Math.min(u8.length, off + 65536))));
                  }
                  fs.close(); resolve();
                } catch (e) { reject(e); }
              }, reject);
            } catch (e) { reject(e); }
          }
        }, reject, "rw");
      } catch (e) { reject(e); }
    });
  }

  function openPhone() {
    state.view = "phone";
    refreshDrives().then(paintDest);
    paintDest();
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
      if (d.t === "drive" && d.token) { driveFromPhone(d); return; }
      if (d.t === "hello") {
        var model = $("tv-model") ? $("tv-model").textContent : "";
        conn.send({ t: "hi", tv: (/Samsung/.test(model) ? model : "TV") + (destActual() === "usb" ? " (salvando no pen drive)" : "") });
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
        var toUsb = destActual() === "usb";
        (toUsb ? saveToUsb(f.name, f.buf) : romsPut({ name: f.name, size: f.size, data: f.buf.buffer, added: Date.now() })).then(function () {
          f.row.textContent = f.name + (toUsb ? " — salvo no pen drive ✓" : " — salvo ✓");
          Conquistas.unlock("gen_send");
          f.row.className = "ok";
          phone && phone.received++;
          conn.send({ t: "saved", id: f.id, where: toUsb ? "usb" : "tv" });
          phoneStatus("Jogo recebido! Pode mandar mais ou apertar VOLTAR.", "ok");
        }, function () {
          f.row.textContent = f.name + (toUsb ? " — não deu para gravar no pen drive" : " — sem espaço na TV");
          conn.send({ t: "fail", id: f.id, msg: toUsb ? "o pen drive não aceitou (protegido ou cheio?)" : "sem espaço na TV" });
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
    if (state.phoneDrive) { state.phoneDrive = false; openDrive(); }
  }

  // ====================================================================
  // Celular como controle (QR Code + conexão direta com PeerJS)
  // ====================================================================
  var ctrl = { peer: null, conns: [], states: [], code: null, ready: false };

  function ctrlEnabled() { try { return localStorage.getItem("snestv.ctrl") === "1"; } catch (e) { return false; } }
  function ctrlCode() {
    var c = null;
    try { c = localStorage.getItem("snestv.ctrlcode"); } catch (e) {}
    if (!c || !/^[A-Z2-9]{6}$/.test(c)) {
      c = newCode();
      try { localStorage.setItem("snestv.ctrlcode", c); } catch (e) {}
    }
    return c;
  }
  function ctrlCount() { return ctrl.conns.filter(Boolean).length; }

  function startCtrl() {
    if (ctrl.peer && !ctrl.peer.destroyed) return Promise.resolve();
    if (!window.RTCPeerConnection && !window.webkitRTCPeerConnection) {
      pairStatus("O navegador desta TV não suporta conexão com o celular.", "err");
      return Promise.resolve();
    }
    var libs = (window.Peer || window.peerjs) ? Promise.resolve() : loadScript("lib/peerjs.min.js");
    return libs.then(function () {
      var P = window.Peer || window.peerjs.Peer;
      ctrl.code = ctrlCode();
      ctrl.ready = false;
      var peer = new P("snestv-pad-" + ctrl.code);
      ctrl.peer = peer;
      peer.on("open", function () { ctrl.ready = true; pairPaint(); });
      peer.on("connection", ctrlConn);
      peer.on("error", function (err) {
        if (err.type === "unavailable-id") {
          // a sessão anterior (antes de recarregar) ainda está registrada: tenta de novo
          try { peer.destroy(); } catch (e) {}
          ctrl.peer = null;
          pairStatus("Preparando…");
          setTimeout(function () { if (ctrlEnabled()) startCtrl(); }, 3000);
          return;
        }
        if (/network|server-error|socket/.test(err.type || "")) pairStatus("Sem conexão com a internet. Confira o Wi-Fi da TV.", "err");
      });
      peer.on("disconnected", function () {
        setTimeout(function () { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 2000);
      });
    }, function () { pairStatus("Não consegui carregar os arquivos de conexão.", "err"); });
  }

  function ctrlConn(conn) {
    conn.on("open", function () {
      var want = conn.metadata && +conn.metadata.player;
      var slot;
      if (want >= 1 && want <= 4) {
        slot = want - 1;
        var prev = ctrl.conns[slot];
        if (prev && prev !== conn) { ctrl.conns[slot] = null; try { prev.close(); } catch (e) {} }
      } else {
        slot = ctrl.conns.indexOf(null);
        if (slot < 0) slot = ctrl.conns.length;
      }
      if (slot >= 4) { try { conn.close(); } catch (e) {} return; }
      ctrl.conns[slot] = conn;
      ctrl.states[slot] = {};
      try { conn.send({ t: "hi", player: slot + 1 }); } catch (e) {}
      toast("📱 Celular conectado — jogador " + (slot + 1), 2500);
      state.padBadgeDirty = true;
      pairPaint();
      // fecha sozinho quando os 4 jogadores estiverem conectados
      if (state.view === "pair" && ctrl.conns[0] && ctrl.conns[1] && ctrl.conns[2] && ctrl.conns[3]) setTimeout(function () { if (state.view === "pair") closePair(); }, 2000);
      conn.on("data", function (d) {
        if (d && d.t === "skin") {
          ctrl.skins = ctrl.skins || [];
          ctrl.skins[slot] = d.s;
          if (state.view === "game" && state.current) buildSideHelp(state.current, LITE ? LITE.rom : null);
          return;
        }
        if (!d || d.t !== "pad") return;
        var st = {};
        for (var b = 0; b < 12; b++) if (d.m & (1 << b)) st[b] = true;
        if (d.menu) st.menu = true;
        ctrl.states[slot] = st;
      });
      conn.on("close", function () {
        if (ctrl.conns[slot] !== conn) return;
        ctrl.conns[slot] = null;
        ctrl.states[slot] = null;
        toast("Celular do jogador " + (slot + 1) + " desconectado", 2200);
        state.padBadgeDirty = true;
        pairPaint();
      });
    });
  }

  function stopCtrl() {
    try { localStorage.setItem("snestv.ctrl", "0"); } catch (e) {}
    ctrl.conns.forEach(function (c) { try { if (c) c.close(); } catch (e) {} });
    ctrl.conns = []; ctrl.states = [];
    try { if (ctrl.peer) ctrl.peer.destroy(); } catch (e) {}
    ctrl.peer = null;
    state.padBadgeDirty = true;
  }

  // ---------------- tela do QR Code do controle ----------------
  function pairStatus(text, kind) {
    var el = $("pair-status"); if (!el) return;
    el.textContent = text; el.className = "phone-status " + (kind || "");
  }
  function pairPaint() {
    if ($("pair").hidden) return;
    for (var p = 1; p <= 4; p++) {
      var on = !!ctrl.conns[p - 1];
      $("slot-" + p).classList.toggle("on", on);
      $("pair-st-" + p).textContent = on ? "Conectado ✓" : "Aguardando…";
    }
    if (!ctrl.ready || !window.qrcode) { pairStatus("Preparando…"); return; }
    var url = sendUrl(ctrl.code).replace("enviar.html", "controle.html");
    if (!state.pairQr) {
      for (var q = 1; q <= 4; q++) {
        var qr = qrcode(0, "M"); qr.addData(url + "-" + q); qr.make();
        $("pair-qr-" + q).innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
      }
      state.pairQr = true;
    }
    $("pair-code").textContent = ctrl.code;
    $("pair-url").textContent = url.replace(/^https?:\/\//, "").replace(/#.*$/, "");
    var n = ctrlCount();
    pairStatus(n === 0 ? "Aguardando os celulares…" : (n === 1 ? "1 celular conectado" : n + " celulares conectados") +
      (n >= 4 ? " — bom jogo!" : " — conecte mais ou aperte VOLTAR para jogar"), n ? "ok" : "");
  }
  function openPair(from) {
    state.pairFrom = from;
    state.view = "pair";
    $("menu").hidden = true;
    $("pair").hidden = false;
    state.pairQr = false;
    for (var qq = 1; qq <= 4; qq++) $("pair-qr-" + qq).innerHTML = "";
    $("pair-code").textContent = "······";
    try { localStorage.setItem("snestv.ctrl", "1"); } catch (e) {}
    var libs = window.qrcode ? Promise.resolve() : loadScript("lib/qrcode.js");
    libs.then(startCtrl).then(pairPaint);
  }
  function closePair() {
    $("pair").hidden = true;
    padPrev = {};
    if (state.pairFrom === "menu") { state.view = "menu"; $("menu").hidden = false; }
    else state.view = "launcher";
  }

  // ====================================================================
  // Conquistas: verificação, aviso na tela e tela de conquistas
  // ====================================================================
  var achTimer = null;
  function startAchTimer() {
    clearInterval(achTimer);
    state.usedPad = state.usedPhone = state.usedCoop = false;
    achTimer = setInterval(function () {
      if (state.view !== "game") return;
      Conquistas.tick(0.5, {
        crt: crtOn(),
        phones: state.usedPhone,
        pads: state.usedPad,
        coop: state.usedCoop,
        mem: LITE ? LITE.mem() : null
      });
    }, 500);
  }

  var achQueue = [], achShowing = false;
  function showAch(d) {
    achQueue.push(d);
    if (!achShowing) nextAch();
  }
  function nextAch() {
    var d = achQueue.shift();
    if (!d) { achShowing = false; $("ach-toast").hidden = true; return; }
    achShowing = true;
    $("ach-toast-t").textContent = d.t;
    $("ach-toast-d").textContent = d.d;
    $("ach-toast-s").textContent = d.label || "Conquista desbloqueada";
    var img = $("ach-toast-img");
    img.hidden = !d.img; $("ach-toast-star").hidden = !!d.img;
    if (d.img) img.src = d.img;
    var el = $("ach-toast");
    el.hidden = true; void el.offsetWidth; el.hidden = false;   // reinicia a animação
    setTimeout(nextAch, 4200);
  }

  function openAch(from) {
    state.achFrom = from;
    state.view = "ach";
    $("menu").hidden = true;
    $("ach").hidden = false;
    $("ach-count").textContent = "★ " + Conquistas.count() + " de " + Conquistas.total();
    var html = '<div class="ach-inner" id="ach-inner">';
    // conquistas da comunidade (RetroAchievements)
    var raU = window.RA && RA.user(), raSets = [];
    html += '<div class="ra-card"><b class="ra-logo">RA</b><div><b class="ra-h"></b><span class="ra-s"></span></div>' +
      '<span class="ra-k"><kbd class="key-dot c-y"></kbd> ' + (raU ? "conta" : "entrar") + '</span></div>';
    if (raU && state.games) {
      state.games.forEach(function (g) { var r = RA.info(gameKey(g)); if (r && r.total) raSets.push(r); });
      var cur = RA.game && RA.key ? RA.info(RA.key) : null;
      raSets.sort(function (a, b) { return (b === cur ? 1 : 0) - (a === cur ? 1 : 0) || (b.unlocked || 0) - (a.unlocked || 0); });
      raSets.forEach(function (r) {
        html += '<div class="ach-group ra-g"></div><div class="ach-grid">';
        (r.list || []).forEach(function (a) {
          html += '<div class="ach-item ra' + (a.u ? ' on' : '') + '"><img alt=""><div><b></b><span></span></div></div>';
        });
        html += '</div>';
      });
    }
    var order = ["gen", "smw", "alttp", "sm", "smk"];
    // jogo atual primeiro
    if (state.view === "ach" && from === "menu" && Conquistas.game) {
      order = [Conquistas.game].concat(order.filter(function (g) { return g !== Conquistas.game; }));
    }
    order.forEach(function (g) {
      var list = Conquistas.defs.filter(function (d) { return d.g === g; });
      var got = list.filter(function (d) { return Conquistas.isUnlocked(d.id); }).length;
      html += '<div class="ach-group">' + Conquistas.groups[g] + ' — ' + got + '/' + list.length + '</div><div class="ach-grid">';
      list.forEach(function (d) {
        var on = Conquistas.isUnlocked(d.id);
        html += '<div class="ach-item' + (on ? ' on' : '') + '"><i>' + (on ? '★' : '☆') + '</i><div><b></b><span></span></div></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    $("ach-list").innerHTML = html;
    // textos com textContent (seguro)
    var items = $("ach-list").querySelectorAll(".ach-item"), k = 0;
    order.forEach(function (g) {
      Conquistas.defs.filter(function (d) { return d.g === g; }).forEach(function (d) {
        items[k].querySelector("b").textContent = d.t;
        items[k].querySelector("span").textContent = d.d;
        k++;
      });
    });
    var card = $("ach-list").querySelector(".ra-card");
    card.querySelector(".ra-h").textContent = raU ? "RetroAchievements · " + raU.name : "Conquistas da comunidade (RetroAchievements)";
    card.querySelector(".ra-s").textContent = raU ?
      (raSets.length ? raSets.length + " dos seus jogos têm conquistas da comunidade · " + (raU.score || 0) + " pontos" : "Procurando os seus jogos no RetroAchievements…") +
      (RA.pending() ? " · " + RA.pending() + " esperando internet para enviar" : " · funciona também sem internet") :
      "Milhares de conquistas feitas pela comunidade para quase todos os jogos de SNES. Crie uma conta grátis em retroachievements.org e entre aqui.";
    var gh = $("ach-list").querySelectorAll(".ra-g"), ri = $("ach-list").querySelectorAll(".ach-item.ra"), q = 0;
    raSets.forEach(function (r, i) {
      gh[i].textContent = "Comunidade · " + r.title + " — " + Math.min(r.unlocked || 0, r.total) + "/" + r.total;
      (r.list || []).forEach(function (a) {
        var it = ri[q++], im = it.querySelector("img");
        im.onerror = function () { im.style.visibility = "hidden"; };
        im.src = a.u ? a.b : a.bl;
        it.querySelector("b").textContent = a.t + (a.p ? " · " + a.p + " pts" : "");
        it.querySelector("span").textContent = a.d + (!a.u && a.m ? " (" + a.m + ")" : "");
      });
    });
    state.achScroll = 0;
    scrollAch(0);
  }
  function scrollAch(dir) {
    var inner = $("ach-inner"), box = $("ach-list");
    if (!inner) return;
    var max = Math.max(0, inner.offsetHeight - box.clientHeight);
    state.achScroll = Math.max(0, Math.min(max, (state.achScroll || 0) + dir * box.clientHeight * 0.5));
    inner.style.transform = "translateY(" + (-state.achScroll) + "px)";
  }
  function closeAch() {
    $("ach").hidden = true;
    padPrev = {};
    if (state.achFrom === "menu") { state.view = "menu"; $("menu").hidden = false; }
    else { state.view = "launcher"; renderGrid(); }
  }

  // ====================================================================
  // Capas dos jogos (coleção pública libretro-thumbnails)
  // ====================================================================
  var COVER_BASE = "https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System/master/Named_Boxarts/";
  var COVERS = null, COVER_KEYS = null, coverCache = {};

  function loadCovers() {
    return new Promise(function (resolve) {
      try {
        var x = new XMLHttpRequest();
        x.open("GET", "covers.json", true);
        x.onload = function () {
          try { COVERS = JSON.parse(x.responseText); COVER_KEYS = Object.keys(COVERS); } catch (e) { COVERS = null; }
          resolve();
        };
        x.onerror = function () { resolve(); };
        x.send();
      } catch (e) { resolve(); }
    });
  }

  function normTitle(t) {
    t = String(t || "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").toLowerCase().replace(/&/g, " and ").replace(/_/g, " ");
    var m = t.match(/^(.*), (the|a|an)( - .*)?$/);
    if (m) t = m[1] + (m[3] || "");
    t = t.replace(/^(the|a|an) /, "");
    return t.replace(/[^a-z0-9]/g, "");
  }

  function bigrams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var b = s.substr(i, 2); o[b] = (o[b] || 0) + 1; } return o; }
  function dice(a, b) {
    if (a.length < 2 || b.length < 2) return 0;
    var A = bigrams(a), B = bigrams(b), inter = 0, na = a.length - 1, nb = b.length - 1;
    for (var k in A) if (B[k]) inter += Math.min(A[k], B[k]);
    return 2 * inter / (na + nb);
  }

  // resultado da busca de capa guardado na TV (a busca por nome parecido é pesada com muitos jogos)
  var fcMemo = null, fcDirty = null;
  function findCover(title) {
    if (!COVERS) return null;
    if (!fcMemo) { try { fcMemo = JSON.parse(localStorage.getItem("snestv.fc") || "{}"); } catch (e) { fcMemo = {}; } }
    var mk = normTitle(title);
    if (mk in fcMemo) return fcMemo[mk] || null;
    var r = findCoverSlow(title);
    fcMemo[mk] = r || 0;
    clearTimeout(fcDirty);
    fcDirty = setTimeout(function () { try { localStorage.setItem("snestv.fc", JSON.stringify(fcMemo)); } catch (e) {} }, 1500);
    return r;
  }
  function findCoverSlow(title) {
    var k = normTitle(title);
    if (k.length < 3) return null;
    if (COVERS[k]) return COVERS[k];
    // começa igual (ex.: "legendofzelda" → "legendofzeldaalinktothepast"): pega o mais curto
    var pref = null;
    if (k.length >= 8) for (var i = 0; i < COVER_KEYS.length; i++) {
      var c = COVER_KEYS[i];
      if (c.indexOf(k) === 0 && (!pref || c.length < pref.length)) pref = c;
    }
    if (pref) return COVERS[pref];
    // nome parecido (erros de digitação, abreviações)
    var best = null, bs = 0;
    for (var j = 0; j < COVER_KEYS.length; j++) {
      var key = COVER_KEYS[j];
      if (key.charAt(0) !== k.charAt(0) || Math.abs(key.length - k.length) > 12) continue;
      var s = dice(k, key);
      if (s > bs) { bs = s; best = key; }
    }
    return bs >= 0.8 ? COVERS[best] : null;
  }

  function headerTitle(u8) {
    if (!u8 || !u8.length) return "";
    var base = u8.length % 1024 === 512 ? 512 : 0, best = "";
    [0x7FC0, 0xFFC0].forEach(function (off) {
      var o = base + off;
      if (o + 32 > u8.length) return;
      var comp = u8[o + 0x1C] | (u8[o + 0x1D] << 8), sum = u8[o + 0x1E] | (u8[o + 0x1F] << 8), t = "";
      for (var i = 0; i < 21; i++) { var ch = u8[o + i]; t += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " "; }
      if (((comp ^ sum) & 0xFFFF) === 0xFFFF || !best) best = t.trim();
    });
    return best;
  }

  function coverName(g) {
    var key = gameKey(g);
    if (coverCache[key] !== undefined) return coverCache[key];
    var saved = null;
    try { saved = localStorage.getItem("snestv.cover." + key); } catch (e) {}
    var name = saved || findCover(g.title || g.name);
    if (!name && g.data) {            // jogo salvo na TV: tenta pelo nome gravado no cartucho
      try { name = findCover(headerTitle(new Uint8Array(g.data))); } catch (e) {}
    }
    coverCache[key] = name || null;
    return coverCache[key];
  }

  function coverUrl(g) { var n = coverName(g); return n ? COVER_BASE + encodeURIComponent(n) + ".png" : null; }

  function putCover(label, url) {
    if (!url || !label) return;
    var img = new Image();
    img.className = "cover";
    img.alt = "";
    img.onload = function () { label.classList.add("has-cover"); };
    img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
    img.src = url;
    label.appendChild(img);
  }

  // depois que o jogo abre, se a capa não foi achada pelo nome do arquivo, tenta pelo cartucho
  function learnCover(g, rom) {
    if (!COVERS || coverName(g)) return;
    var n = findCover(headerTitle(rom));
    if (!n) return;
    try { localStorage.setItem("snestv.cover." + gameKey(g), n); } catch (e) {}
    coverCache[gameKey(g)] = n;
  }

  // ====================================================================
  // Painel do jogo (lado direito da lista)
  // ====================================================================
  var ACTION_INFO = {
    phone: "Mande jogos do celular para a TV: leia o QR Code com a câmera, escolha os arquivos .sfc, .smc ou .zip e eles ficam salvos aqui.",
    pair: "Transforme o celular num controle de Super Nintendo. Até 4 celulares, um para cada jogador. Eles se reconectam sozinhos.",
    ach: "Todas as conquistas num lugar só: as gerais, que valem para qualquer jogo, e as de Super Mario World, Zelda, Super Metroid e Super Mario Kart.",
    open: "Escolha arquivos .sfc, .smc ou .zip deste aparelho. Eles ficam salvos para a próxima vez.",
    drive: "Conecte o seu Google Drive: os jogos de SNES de lá (.sfc, .smc e .zip com nome de jogo) aparecem nesta lista. Ao jogar, o jogo é baixado do Drive e uma cópia fica salva na TV.",
    net: "Jogue com um amigo em outra TV, pela internet. Uma TV cria a partida e recebe um código; a outra entra com esse código. As duas precisam ter o mesmo arquivo do jogo."
  };
  var detKey = null;

  function showDetails(g) {
    if (!g) return;
    var key = g.action ? "action:" + g.action : gameKey(g);
    var lab = $("det-label");
    var cn = g.action ? null : coverName(g);
    var title = cn ? cleanTitle(cn).title : g.title;

    if (detKey !== key) {
      detKey = key;
      var old = lab.querySelector("img.cover"); if (old) lab.removeChild(old);
      lab.classList.remove("has-cover");
      lab.style.background = labelBg(g.action ? 250 : hashHue(g.title), g.action);
      setInitial($("det-initial"), g, g.action ? (g.icon || { ach: "★", open: "+" }[g.action] || "+") :
        (g.title.match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase());
      if (!g.action) putCover(lab, coverUrl(g));
    }
    $("det-title").textContent = title;

    var meta = [];
    if (!g.action) {
      if (g.region) meta.push(g.region);
      if (g.size) meta.push(fmtSize(g.size));
      meta.push(g.source === "usb" ? "Pen drive" : g.source === "pc" ? "Pasta do PC" : g.source === "drive" ? "Google Drive (baixa ao jogar)" : g.fromDrive ? "Do Google Drive, salvo na TV" : "Salvo na TV");
      if (g.last) meta.push("último jogado");
    }
    $("det-meta").textContent = meta.join(" · ");
    $("det-desc").textContent = g.action ? (g.sideKey && SIDE_INFO[g.sideKey]) || (/^sec:/.test(g.action) ? SIDE_INFO[g.action.slice(4)] + "\n\n" + sectionCount(g.action.slice(4)) + " jogos nesta seção." : "") || ACTION_INFO[g.action] || "" : "";
    $("det-del").hidden = !canDelete(g);
    $("det-desc").hidden = !g.action;

    // conquistas: as da comunidade (RetroAchievements) + as do SNES TV
    var gk = g.action ? null : Conquistas.gameFor(cn, g.title, g.name);
    var ra = !g.action && window.RA ? RA.info(gameKey(g)) : null;
    var list = [], head, note = "";
    function local(defs) { return defs.map(function (d) { return { t: d.t, d: d.d, on: Conquistas.isUnlocked(d.id) }; }); }
    if (g.action === "ach") { list = local(Conquistas.defs); head = "Conquistas do SNES TV"; }
    else if (!g.action) {
      if (ra) {
        (ra.list || []).forEach(function (a) { list.push({ t: a.t, d: a.d, on: !!a.u, img: a.u ? a.b : a.bl, p: a.p, m: a.m }); });
        head = "Conquistas da comunidade";
      }
      if (gk) { list = list.concat(local(Conquistas.listFor(gk))); head = head || "Conquistas do jogo"; }
      if (!list.length) {
        list = local(Conquistas.listFor("gen")); head = "Conquistas gerais";
        note = window.RA && !RA.user() ? "Entre no RetroAchievements (menu Conquistas → VERDE) para ver as conquistas que a comunidade fez para este jogo. As gerais valem para todos:" :
          window.RA && RA.known(gameKey(g)) ? "A comunidade ainda não fez conquistas para este jogo. As gerais valem para todos:" :
          "Este jogo ainda não tem conquistas próprias. As gerais valem para todos:";
      }
    } else list = null;

    $("det-ach-box").hidden = !list;
    var ul = $("det-ach");
    ul.innerHTML = "";
    if (!list) return;
    var pr = !g.action ? achProgress(g) : null;
    var got = list.filter(function (d) { return d.on; }).length, total = list.length;
    // o servidor pode saber de desbloqueios que a lista guardada ainda não tem
    if (pr && pr.total && list.length && head !== "Conquistas gerais") { got = Math.max(got, pr.got); total = Math.max(total, pr.total); }
    $("det-ach-title").textContent = head;
    $("det-ach-count").textContent = "★ " + got + "/" + total;
    $("det-bar").style.width = Math.round(got / Math.max(1, total) * 100) + "%";
    if (note) {
      var li0 = document.createElement("li");
      li0.className = "det-note";
      li0.textContent = note;
      ul.appendChild(li0);
    }
    // desbloqueadas primeiro
    list.slice().sort(function (a, b) { return (b.on ? 1 : 0) - (a.on ? 1 : 0); })
      .forEach(function (d) {
        var li = document.createElement("li");
        li.className = (d.on ? "on" : "") + (d.img ? " pic" : "");
        li.innerHTML = (d.img ? '<img alt="">' : "<i></i>") + "<b></b><span></span>";
        if (d.img) { var im = li.querySelector("img"); im.onerror = function () { im.style.visibility = "hidden"; }; im.src = d.img; }
        else li.querySelector("i").textContent = d.on ? "★" : "☆";
        li.querySelector("b").textContent = d.t + (d.p ? "  · " + d.p + " pts" : "");
        li.querySelector("span").textContent = d.d + (!d.on && d.m ? "  (" + d.m + ")" : "");
        ul.appendChild(li);
      });
    // não coube tudo: mostra quantas faltam
    var hidden = 0;
    while (ul.children.length > 2 && ul.scrollHeight > ul.clientHeight + 2) { ul.removeChild(ul.lastChild); hidden++; }
    if (hidden) {
      ul.removeChild(ul.lastChild); hidden++;
      var more = document.createElement("li");
      more.className = "det-note";
      more.textContent = "+ mais " + hidden + " — veja todas no menu Conquistas";
      ul.appendChild(more);
    }
  }

  // progresso de conquistas de um jogo (comunidade + SNES TV)
  function achProgress(g) {
    if (!g || g.action) return null;
    var got = 0, total = 0, ra = window.RA ? RA.info(gameKey(g)) : null;
    if (ra && ra.total) { total += ra.total; got += Math.min(ra.unlocked || 0, ra.total); }
    var cn = coverName(g), gk = Conquistas.gameFor(cn, g.title, g.name);
    if (gk) {
      var l = Conquistas.listFor(gk);
      total += l.length;
      got += l.filter(function (d) { return Conquistas.isUnlocked(d.id); }).length;
    }
    return total ? { got: got, total: total, ra: !!ra } : null;
  }
  // barra transparente embaixo de cada cartucho
  function paintBar(el, g) {
    var bar = el.querySelector(".tile-prog");
    var pr = achProgress(g);
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "tile-prog";
      bar.innerHTML = "<i></i><span></span>";
      el.appendChild(bar);
    }
    bar.classList.toggle("none", !pr);
    bar.classList.toggle("full", !!pr && pr.got >= pr.total);
    bar.querySelector("i").style.width = pr ? Math.round(pr.got / pr.total * 100) + "%" : "0";
    bar.querySelector("span").textContent = pr ? "★ " + pr.got + "/" + pr.total : "sem conquistas";
  }
  // atualiza só os cartuchos já completos (os outros recebem a barra quando aparecerem)
  function paintBars() {
    var tiles = $("grid").children, items = state.items || [];
    for (var i = 0; i < tiles.length && i < items.length; i++) if (tiles[i].hydrated) paintBar(tiles[i], items[i]);
  }

  // ---------------- RetroAchievements: entrar com a conta ----------------
  function openRa(from) {
    state.raFrom = from || state.view;
    state.view = "ra";
    $("ach").hidden = true;
    $("ra-box").hidden = false;
    paintRa();
    if (!RA.user()) setTimeout(function () { try { $("ra-user").focus(); } catch (e) {} }, 80);
  }
  function paintRa(msg, cls) {
    var u = RA.user();
    $("ra-form").hidden = !!u;
    $("ra-logged").hidden = !u;
    $("ra-ok").hidden = !!u; $("ra-out").hidden = !u;
    if (u) { $("ra-name").textContent = u.name; $("ra-score").textContent = (u.score || 0) + " pontos"; }
    $("ra-keys").innerHTML = "<kbd>▲ ▼ ◀ ▶</kbd> escolher · <kbd>OK</kbd> confirmar · <kbd class=\"key-dot c-a\"></kbd> ou <kbd>VOLTAR</kbd> voltar";
    if (u) setTimeout(function () { try { $("ra-back").focus(); } catch (e) {} }, 60);
    var st = $("ra-status");
    st.textContent = msg || "";
    st.className = "pair-status" + (cls ? " " + cls : "");
  }
  function closeRa() {
    try { document.activeElement.blur(); } catch (e) {}
    $("ra-box").hidden = true;
    if (state.raFrom === "ach" || state.raFrom === "menu-ach") openAch(state.achFrom);
    else { state.view = "launcher"; setFocus(); }
  }
  function raSubmit() {
    var u = $("ra-user").value.replace(/\s/g, ""), p = $("ra-pass").value;
    if (!u) { $("ra-user").focus(); return; }
    if (!p) { $("ra-pass").focus(); return; }
    try { document.activeElement.blur(); } catch (e) {}
    paintRa("Entrando…");
    RA.login(u, p).then(function (a) {
      $("ra-pass").value = "";
      paintRa("Pronto! Bem-vindo, " + a.name + ". Procurando as conquistas dos seus jogos…", "ok");
      raScan();
    }, function (e) { paintRa(e.message, "err"); });
  }
  function raLogout() {
    RA.logout();
    paintRa("Você saiu da conta.", "ok");
    if (state.items) paintBars();
  }
  function raScan() {
    if (!window.RA || !RA.user() || !state.games || !state.games.length) return;
    var fl = window.fflate ? Promise.resolve() : loadScript("lib/fflate.js");
    fl.then(function () {
      RA.scan(state.games, gameKey, function (g) { return bytesOf(g).then(romOf); });
    });
  }

  // eventos do rcheevos durante o jogo
  function raEvent(type, d) {
    if (type === "game") {
      if (d && d.total) toast("🏆 RetroAchievements: " + d.unlocked + " de " + d.total + " conquistas da comunidade" + (RA.offline ? " (sem internet — envio depois)" : ""), 3500);
      else if (!d) toast("Este jogo não tem conquistas da comunidade (ou é outra versão da ROM)", 3000);
      return;
    }
    if (type === "queued") { toast("Sem internet: conquista guardada (" + d.n + " na fila). Vai para o site quando a internet voltar.", 3200); return; }
    if (type === "flushed") { toast("🏆 " + d.n + " conquista(s) feitas sem internet enviadas ao RetroAchievements", 3200); return; }
    if (type === "loginfail") { toast("RetroAchievements: " + ((d && d.msg) || "não consegui entrar"), 3500); return; }
    if (type === 1 && d) {
      showAch({ t: d.t, d: d.d + (d.p ? " · " + d.p + " pts" : ""), img: d.b, label: "Conquista da comunidade" });
    } else if ((type === 7 || type === 9) && d && d.m) {
      toast("🏆 " + d.t + " — " + d.m, 1800);
    } else if (type === 15) {
      showAch({ t: "Jogo completo!", d: "Você fez todas as conquistas da comunidade deste jogo", label: "RetroAchievements" });
    } else if (type === 16 && d) {
      toast("RetroAchievements: " + (d.msg || "erro do servidor"), 3500);
    } else if (type === 17) {
      toast("Sem internet: as conquistas serão enviadas quando a conexão voltar", 3000);
    } else if (type === 18) {
      toast("Conquistas enviadas ✓", 2000);
    }
  }

  // ====================================================================
  // Nome do jogador e saudação
  // ====================================================================
  function userName() { try { return (localStorage.getItem("snestv.name") || "").trim(); } catch (e) { return ""; } }
  function paintGreeting() {
    var n = userName();
    $("greet").textContent = n ? "Seja bem-vindo, " + n + "!" : "Seja bem-vindo!";
  }
  // telas com campo de texto: setas andam entre campo e botões; VERMELHO/VOLTAR = voltar
  function formKey(e, c, ids, onEnter, onBack) {
    var items = ids.map($).filter(function (el) { return el && !el.hidden && el.offsetParent !== null; });
    var a = document.activeElement, i = items.indexOf(a), onBtn = a && a.tagName === "BUTTON";
    if (c === K.BACK || c === K.ESC || c === 65385 || c === K.RED || (onBtn && c === K.BACKSPACE)) {
      e.preventDefault(); onBack(); return true;
    }
    if (c === K.DOWN || (onBtn && c === K.RIGHT)) {
      e.preventDefault();
      state.formNav = Date.now();
      var n = items[Math.min(items.length - 1, i + 1)];
      if (n) n.focus();
      return true;
    }
    if (c === K.UP || (onBtn && c === K.LEFT)) {
      e.preventDefault();
      state.formNav = Date.now();
      var pv = items[Math.max(0, i - 1)];
      if (pv) pv.focus();
      return true;
    }
    if (onBtn && (c === K.ENTER || c === 65376)) { e.preventDefault(); a.click(); return true; }
    return false;
  }
  $("name-ok").addEventListener("click", function () { saveName(); });
  $("name-back").addEventListener("click", function () { if (userName()) closeName(); });
  $("ra-ok").addEventListener("click", function () { raSubmit(); });
  $("net-join-ok").addEventListener("click", function () { netJoin(); });
  $("net-join-back").addEventListener("click", function () { netEnd(); netShow("home"); });
  $("ra-out").addEventListener("click", function () { raLogout(); });
  $("ra-back").addEventListener("click", function () { closeRa(); });

  function openName() {
    state.view = "name";
    $("name-box").hidden = false;
    var i = $("name-input");
    i.value = userName();
    $("name-back").hidden = !userName();
    setTimeout(function () {
      try { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } catch (e) {}
    }, 80);
  }
  function closeName() {
    state.view = "launcher";              // antes do blur (o blur dispara "change")
    try { $("name-input").blur(); } catch (e) {}
    $("name-box").hidden = true;
    if (state.focus === -1 && !state.items) state.focus = 0;
    setFocus();
  }
  function saveName() {
    var v = $("name-input").value.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").slice(0, 20);
    if (!v) { toast("Digite seu nome", 1800); return; }
    try { localStorage.setItem("snestv.name", v); } catch (e) {}
    paintGreeting();
    closeName();
    toast("Bom jogo, " + v + "!", 2200);
  }
  // quando o teclado da TV fecha com "Concluído", o campo dispara "change"
  $("name-input").addEventListener("change", function () {
    // saiu do campo com as setas (para ir aos botões): não salva sozinho
    if (Date.now() - (state.formNav || 0) < 500) return;
    if (state.view === "name" && $("name-input").value.replace(/\s/g, "")) saveName();
  });

  // ====================================================================
  // Jogar online: duas TVs, cada uma é um jogador (lockstep pela internet)
  // ====================================================================
  var NET = null;   // { role, peer, conn, code, game, hash, delay, rtt, started }

  // só o necessário para criar/entrar na partida (o emulador carrega depois, ao abrir o jogo)
  function netPeerLibs() {
    var chain = Promise.resolve();
    if (!window.fflate) chain = chain.then(function () { return loadScript("lib/fflate.js"); });
    if (!(window.Peer || window.peerjs)) chain = chain.then(function () { return loadScript("lib/peerjs.min.js"); });
    return chain;
  }
  function netSupported() {
    if (window.RTCPeerConnection || window.webkitRTCPeerConnection) return true;
    netStatus("O navegador desta TV não tem a conexão direta (WebRTC) que o jogo online usa. Tente pelo app instalado.", "err");
    return false;
  }
  // espera a conexão com o servidor; se demorar, avisa em vez de ficar parado
  function netWatch(peer, what) {
    clearTimeout(NET.wd);
    var me = NET;
    me.wd = setTimeout(function () {
      if (NET !== me || me.opened) return;
      netStatus("O servidor do jogo online não respondeu (" + what + "). Confira a internet da TV e aperte OK para tentar de novo.", "err");
      me.failed = true;
    }, 15000);
  }
  function netLibs() {
    var chain = Promise.resolve();
    if (!window.fflate) chain = chain.then(function () { return loadScript("lib/fflate.js"); });
    if (!window.Snes2005) chain = chain.then(function () { return loadScript(window.SNES_HAS_WASM ? "lite/snes2005.js" : "lite/snes2005-asm.js"); });
    if (!window.LiteSNES) chain = chain.then(function () { return loadScript("lite/lite.js"); });
    if (!(window.Peer || window.peerjs)) chain = chain.then(function () { return loadScript("lib/peerjs.min.js"); });
    return chain;
  }

  // impressão digital do jogo (ROM descompactada) para garantir que é o mesmo arquivo
  function romOf(data) {
    var u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (u8[0] === 0x50 && u8[1] === 0x4b && window.fflate) {
      var files = fflate.unzipSync(u8, { filter: function (f) { return /\.(sfc|smc|swc|fig)$/i.test(f.name); } });
      var k = Object.keys(files); if (k.length) u8 = files[k[0]];
    }
    return u8;
  }
  function fnv(u8) {
    var h = 2166136261;
    for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = (h * 16777619) >>> 0; }
    return ("00000000" + h.toString(16)).slice(-8) + "-" + u8.length;
  }
  function bytesOf(g) {
    return getRomBytes(g).then(function (d) {
      return (typeof Blob !== "undefined" && d instanceof Blob) ? readAsBuffer(d) : d;
    });
  }

  // ---------------- telas ----------------
  function netShow(mode) {
    state.view = "net";
    state.netMode = mode;
    $("net").hidden = false;
    ["home", "pick", "host", "join"].forEach(function (m) { $("net-" + m).hidden = m !== mode; });
    if (mode === "home") { state.netBtn = state.netBtn || 0; paintNetBtns(); }
    if (mode === "pick") paintNetList();
    if (mode === "join") setTimeout(function () { try { $("net-code").focus(); } catch (e) {} }, 80);
  }
  function paintNetBtns() {
    var b = $("net-home").querySelectorAll(".net-btn");
    for (var i = 0; i < b.length; i++) b[i].classList.toggle("focused", i === state.netBtn);
  }
  window.addEventListener("error", function (ev) {
    if (state.view === "net" && state.netMode !== "home") netStatus("Erro: " + (ev.message || "desconhecido"), "err");
  });
  function netStatus(text, kind) { var el = $("net-st-" + state.netMode); if (el) { el.textContent = text; el.className = "phone-status " + (kind || ""); } }
  function openNet() { netShow("home"); }
  function closeNet(keep) {
    $("net").hidden = true;
    var live = NET && NET.live && !NET.started;
    state.view = "launcher";
    if (live || (state.netLiveBack && LITE)) {
      // cancelou o convite feito durante o jogo: volta para o menu do jogo
      state.netLiveBack = false;
      netEnd();
      state.view = "menu"; $("menu").hidden = false; padPrev = {};
      return;
    }
    padPrev = {};
    try { $("net-code").blur(); } catch (e) {}
    if (!keep) netEnd();
    $("net-banner").hidden = !state.netPick;
  }
  function netEnd() {
    if (NET) {
      try { if (NET.conn) NET.conn.close(); } catch (e) {}
      try { if (NET.peer) NET.peer.destroy(); } catch (e) {}
    }
    NET = null;
  }

  // ---------------- anfitrião ----------------
  function netCreate() {
    if (!state.games || !state.games.length) { toast("Coloque um jogo na lista primeiro (pen drive ou celular)", 3500); return; }
    if (state.netIdx == null || state.netIdx >= state.games.length) {
      var f = state.items && state.items[state.focus];
      state.netIdx = Math.max(0, f && !f.action ? state.games.indexOf(f) : 0);
    }
    netShow("pick");
  }
  function paintNetList() {
    var ul = $("net-list");
    if (ul.children.length !== state.games.length) {
      ul.innerHTML = "";
      state.games.forEach(function (g) {
        var li = document.createElement("li"), cn = coverName(g);
        li.innerHTML = "<b></b><span></span>";
        li.querySelector("b").textContent = cn ? cleanTitle(cn).title : g.title;
        li.querySelector("span").textContent = [g.region, g.source === "usb" ? "Pen drive" : g.source === "pc" ? "PC" : "TV"].filter(Boolean).join(" · ");
        ul.appendChild(li);
      });
    }
    var lis = ul.children;
    for (var i = 0; i < lis.length; i++) lis[i].classList.toggle("focused", i === state.netIdx);
    var el = lis[state.netIdx], box = ul.parentNode;
    if (el) {
      if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
      else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
    }
  }
  function netPickMove(d) {
    var n = state.games.length;
    state.netIdx = (state.netIdx + d + n) % n;
    paintNetList();
  }

  // convidar no meio do jogo (o jogo continua de onde está)
  function netInvite() {
    var g = state.current;
    if (LITE && LITE.net) { toast("Você já está numa partida online", 2500); return; }
    if (!LITE) {
      // o jogo online usa o emulador TV antiga: reabre nele e já cria a partida
      try { localStorage.setItem("snestv.autoinvite", gameKey(g)); } catch (e) {}
      exitGame("Abrindo no emulador TV antiga para jogar online…");
      return;
    }
    $("menu").hidden = true;
    netHost(g, true);
  }

  function netHost(g, live) {
    state.netPick = false;
    $("net-banner").hidden = true;
    netEnd();
    netShow("host");
    $("net-host-back").textContent = live ? "cancelar e voltar ao jogo" : "cancelar";
    $("net-game").textContent = g.title;
    var code = newCode();
    // o código aparece na hora; a conexão é feita em seguida
    $("net-code-big").textContent = code;
    netStatus("Conectando ao servidor do jogo online…");
    NET = { role: "host", code: code, game: g, live: !!live };
    state.netRetry = function () { netHost(g, live); };
    if (!netSupported()) return;
    var me = NET;
    netPeerLibs().then(function () {
      if (NET !== me) return;
      var P = window.Peer || window.peerjs.Peer;
      var peer = new P("snestv-net-" + code);
      me.peer = peer;
      netWatch(peer, "criar partida");
      peer.on("open", function () {
        if (NET !== me) return;
        me.opened = true; clearTimeout(me.wd);
        netStatus(me.hash ? "Pronto! Passe o código para o seu amigo. Aguardando a outra TV…" : "Pronto! Passe o código para o seu amigo. (Lendo o jogo…)", "ok");
      });
      peer.on("error", function (e) {
        if (NET !== me) return;
        if (e.type === "unavailable-id") { netHost(g, live); return; }
        clearTimeout(me.wd); me.failed = true;
        netStatus("Sem conexão com o servidor do jogo online (" + e.type + "). Aperte OK para tentar de novo.", "err");
      });
      peer.on("connection", function (conn) {
        if (me.conn) { try { conn.close(); } catch (e) {} return; }   // só uma TV convidada
        me.conn = conn;
        conn.on("open", function () { netStatus("Outra TV conectada. Conferindo o jogo…", "ok"); });
        conn.on("data", function (d) {
          // se a outra TV chegar antes do jogo ser lido, espera
          if (d && d.t === "hello" && !me.hash) { me.pendingHello = d; return; }
          netData(d);
        });
        conn.on("close", netLost);
      });
      // lê o jogo (pen drive pode demorar) para conferir se a outra TV tem o mesmo arquivo
      return bytesOf(g).then(function (data) {
        if (NET !== me) return;
        me.hash = fnv(romOf(data));
        if (me.opened) netStatus("Pronto! Passe o código para o seu amigo. Aguardando a outra TV…", "ok");
        if (me.pendingHello) { var h = me.pendingHello; me.pendingHello = null; netData(h); }
      });
    }).catch(function (e) {
      console.error(e);
      if (NET !== me) return;
      me.failed = true;
      netStatus("Não foi possível preparar a partida: " + ((e && e.message) || e) + ". Aperte OK para tentar de novo.", "err");
    });
  }

  // ---------------- convidado ----------------
  function netJoin() {
    var code = ($("net-code").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) { netStatus("O código tem 6 letras/números", "err"); try { $("net-code").focus(); } catch (e) {} return; }
    try { document.activeElement.blur(); } catch (e) {}
    netEnd();
    netStatus("Conectando ao servidor do jogo online…");
    NET = { role: "guest", code: code };
    if (!netSupported()) return;
    var me = NET;
    netPeerLibs().then(function () {
      if (NET !== me) return;
      var P = window.Peer || window.peerjs.Peer;
      var peer = new P();
      me.peer = peer;
      netWatch(peer, "entrar na partida");
      peer.on("open", function () {
        if (NET !== me) return;
        netStatus("Procurando a partida " + code + "…");
        var conn = peer.connect("snestv-net-" + code, { reliable: true, serialization: "binary", metadata: { name: userName() } });
        me.conn = conn;
        conn.on("open", function () {
          me.opened = true; clearTimeout(me.wd);
          conn.send({ t: "hello", name: userName() || "Amigo" }); netStatus("Conectado! Recebendo o jogo da partida…", "ok");
        });
        conn.on("data", netData);
        conn.on("close", netLost);
      });
      peer.on("error", function (e) {
        if (NET !== me) return;
        clearTimeout(me.wd);
        netStatus(e.type === "peer-unavailable" ? "Não achei a partida. Confira o código e se a outra TV está mostrando esse código." :
          "Sem conexão com o servidor do jogo online (" + e.type + ")", "err");
      });
    }).catch(function (e) {
      console.error(e);
      netStatus("Não foi possível conectar: " + ((e && e.message) || e), "err");
    });
  }

  // procura na lista desta TV o mesmo arquivo de jogo
  function netFind(title, hash) {
    var want = normTitle(title);
    var list = state.games.slice().sort(function (a, b) {
      return (normTitle(b.title) === want ? 1 : 0) - (normTitle(a.title) === want ? 1 : 0);
    });
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var g = list[i++];
      return bytesOf(g).then(function (d) { return fnv(romOf(d)) === hash ? g : next(); }, next);
    }
    return next();
  }

  // ---------------- mensagens ----------------
  function netData(d) {
    if (!d || !NET) return;
    if (LITE && LITE.net && (d.t === "in" || d.t === "chk")) { LITE.netRecv(d); return; }
    var c = NET.conn;
    if (d.t === "ping") { c.send({ t: "pong", s: d.s }); return; }
    if (d.t === "pong") { NET.rtt = Math.round(performance.now() - d.s); if (NET.onPong) NET.onPong(); return; }

    if (NET.role === "host") {
      if (d.t === "hello") {
        NET.friend = d.name || "Amigo";
        netStatus(NET.friend + " conectou. Conferindo se a TV dele tem o mesmo jogo…", "ok");
        c.send({ t: "game", title: NET.game.title, hash: NET.hash, host: userName() || "Amigo" });
      } else if (d.t === "nogame") {
        netStatus("A outra TV não tem este jogo. Precisa ser exatamente o mesmo arquivo.", "err");
      } else if (d.t === "ready") {
        netStatus("Medindo a conexão…", "ok");
        var tries = 0, best = 9999;
        NET.onPong = function () {
          best = Math.min(best, NET.rtt);
          if (++tries < 5) c.send({ t: "ping", s: performance.now() });
          else { NET.onPong = null; NET.rtt = best; netBegin(); }
        };
        c.send({ t: "ping", s: performance.now() });
      } else if (d.t === "go") {
        LITE.net.syncing = false;
        LITE.play();
        netStarted();
      } else if (d.t === "desync") {
        netResync();
      } else if (d.t === "synced") {
        if (LITE && LITE.net) LITE.net.syncing = false;
      }
    } else {
      if (d.t === "game") {
        NET.friend = d.host || "Amigo";
        netStatus(NET.friend + " escolheu " + d.title + ". Procurando o jogo nesta TV…", "ok");
        netFind(d.title, d.hash).then(function (g) {
          if (!g) { c.send({ t: "nogame" }); netStatus("Esta TV não tem " + d.title + " (precisa ser o mesmo arquivo).", "err"); return; }
          NET.game = g;
          c.send({ t: "ready" });
          netStatus("Jogo encontrado! Aguardando " + NET.friend + "…", "ok");
        });
      } else if (d.t === "start") {
        NET.delay = d.delay;
        NET.startState = d.state; NET.startSram = d.sram;
        startGame(NET.game, { role: "guest" });
      } else if (d.t === "sync") {
        if (LITE && LITE.net) { LITE.netApply(d.f, d.state); c.send({ t: "synced" }); }
      }
    }
  }

  // anfitrião: abre o jogo, tira a "foto" do estado e manda para a outra TV
  function netBegin() {
    // atraso: metade da ida-e-volta em quadros + folga
    NET.delay = Math.max(3, Math.min(10, Math.ceil(NET.rtt / 2 / 16.7) + 2));
    if (NET.live && LITE) {
      // convite no meio do jogo: manda o momento atual do jogo para a outra TV
      state.net = { role: "host" };
      if (state.multitap) { LITE.setMultitap(false); state.multitap = false; }
      netOnLiteReady();
      return;
    }
    startGame(NET.game, { role: "host" });
  }
  function netOnLiteReady() {
    var c = NET.conn;
    if (NET.role === "host") {
      LITE.pause();
      var st = LITE.getState(), v = LITE.sramView();
      LITE.startNet({ role: "host", delay: NET.delay, send: function (m) { try { c.send(m); } catch (e) {} }, onDesync: netResync });
      LITE.net.syncing = true;          // espera o "go" da outra TV
      c.send({ t: "start", delay: NET.delay, state: st.buffer, sram: v ? new Uint8Array(v).buffer : null });
      $("loading").hidden = false;
      $("loading-text").textContent = "Esperando " + (NET.friend || "a outra TV") + " carregar…";
    } else {
      if (NET.startSram) LITE.writeSram(new Uint8Array(NET.startSram));
      LITE.loadState(new Uint8Array(NET.startState));
      LITE.startNet({ role: "guest", delay: NET.delay, send: function (m) { try { c.send(m); } catch (e) {} },
        onDesync: function () { c.send({ t: "desync" }); } });
      c.send({ t: "go" });
      netStarted();
    }
  }
  function netResync() {
    if (NET.role !== "host" || !LITE || !LITE.net || LITE.net.syncing) return;
    var snap = LITE.netSnapshot();
    NET.conn.send({ t: "sync", f: snap.f, state: snap.state.buffer });
  }
  function netStarted() {
    NET.started = true;
    $("loading").hidden = true;
    $("net").hidden = true;
    state.view = "game";
    $("net-badge").hidden = false;
    toast("Online com " + (NET.friend || "a outra TV") + " — você é o Jogador " + (NET.role === "host" ? 1 : 2), 3500);
    clearInterval(NET.timer);
    NET.timer = setInterval(function () {
      if (!NET || !NET.conn) return;
      try { NET.conn.send({ t: "ping", s: performance.now() }); } catch (e) {}
      var n = LITE && LITE.net;
      var waiting = n && n.stalled && performance.now() - n.stalledAt > 700;
      $("net-wait").hidden = !waiting;
      $("net-badge").textContent = "ONLINE · J" + (NET.role === "host" ? 1 : 2) + " · " + (NET.rtt ? NET.rtt + " ms" : "…");
      paintPlayers();
    }, 1000);
    paintPlayers();
  }
  function netLost() {
    if (!NET) return;
    var was = NET.started, who = NET.friend || "A outra TV";
    clearInterval(NET.timer);
    NET.conn = null;
    if (was && state.view !== "launcher") {
      toast(who + " saiu da partida", 4000);
      setTimeout(function () { exitGame("Partida encerrada…"); }, 1500);
    } else netStatus("A outra TV desconectou", "err");
  }

  // ====================================================================
  // Dicas de botões nas faixas pretas laterais (para quem está começando)
  // ====================================================================
  var GAME_HELP = {
    smw: { name: "Super Mario World", rows: [
      ["B", "Pular"], ["A", "Pulo giratório (quebra blocos)"], ["Y", "Correr · pegar casco · bola de fogo"],
      ["X", "Correr (igual ao Y)"], ["dpad", "Andar · ▼ abaixar · ▲ entrar em canos"], ["L", "Mover a tela"], ["R", "Mover a tela"],
      ["Start", "Pausar"], ["Select", "Usar o item guardado"] ] },
    alttp: { name: "Zelda: A Link to the Past", rows: [
      ["B", "Espada (segure para girar)"], ["A", "Agir: falar, ler, pegar, correr com as botas"], ["Y", "Usar o item escolhido"],
      ["X", "Mapa"], ["dpad", "Andar"], ["Start", "Menu de itens"], ["Select", "Salvar e sair"] ] },
    sm: { name: "Super Metroid", rows: [
      ["X", "Atirar"], ["A", "Pular"], ["B", "Correr"], ["Y", "Guardar a arma especial"],
      ["Select", "Trocar arma (míssil, super míssil...)"], ["L", "Mirar para baixo (diagonal)"], ["R", "Mirar para cima (diagonal)"],
      ["dpad", "Andar · ▼▼ virar bola"], ["Start", "Pausar e ver o mapa"] ] },
    smk: { name: "Super Mario Kart", rows: [
      ["B", "Acelerar"], ["Y", "Frear / ré"], ["A", "Usar o item"], ["L", "Pular / derrapar na curva"], ["R", "Pular / derrapar na curva"],
      ["X", "Olhar para trás"], ["dpad", "Virar"], ["Start", "Pausar"] ] },
    dkc: { name: "Donkey Kong Country", rows: [
      ["B", "Pular"], ["Y", "Correr · rolar · pegar barril"], ["Select", "Trocar de Kong"], ["dpad", "Andar · ▼ pegar · ▲ subir"], ["Start", "Pausar"] ] },
    sf2: { name: "Street Fighter II", rows: [
      ["Y", "Soco fraco"], ["X", "Soco médio"], ["L", "Soco forte"], ["B", "Chute fraco"], ["A", "Chute médio"], ["R", "Chute forte"],
      ["dpad", "Andar · ▲ pular · ▼ abaixar · ◀ (para trás) defender"], ["Start", "Pausar"] ] }
  };
  var GENERIC_HELP = { name: "Controle do Super Nintendo", rows: [
    ["dpad", "Direcional"], ["B", "Botão B (normalmente pular/confirmar)"], ["A", "Botão A"], ["Y", "Botão Y"], ["X", "Botão X"],
    ["L", "Botão L (ombro esquerdo)"], ["R", "Botão R (ombro direito)"], ["Start", "Começar / pausar"], ["Select", "Select"] ] };

  function helpKeyFor(g, rom) {
    var names = [];
    if (g) { var cn = coverName(g); if (cn) names.push(cn); names.push(g.title, g.name); }
    if (rom) names.push(headerTitle(rom));
    for (var i = 0; i < names.length; i++) {
      var k = normTitle(names[i]);
      if (!k) continue;
      var c4 = Conquistas.gameFor(names[i]);
      if (c4) return c4;
      if (k.indexOf("donkeykongcountry") === 0 && !/[23]/.test(k.charAt(17) || "")) return "dkc";
      if (k.indexOf("streetfighterii") === 0 || k.indexOf("superstreetfighterii") === 0) return "sf2";
    }
    return null;
  }

  function sideOn() { try { return localStorage.getItem("snestv.side") !== "0"; } catch (e) { return true; } }

  function btnChip(b) {
    var cls = { A: "c-a", B: "c-b", X: "c-x", Y: "c-y" }[b];
    if (cls) return '<i class="chip round ' + cls + '">' + b + "</i>";
    if (b === "dpad") return '<i class="chip dpad">✚</i>';
    return '<i class="chip pill">' + b + "</i>";
  }

  var REMOTE_ROWS = [
    ["OK ou amarelo", "B"], ["Vermelho", "A"], ["Verde", "Y"], ["Azul", "X"],
    ["1 ou CH ▼", "L"], ["3 ou CH ▲", "R"], ["5 ou ▶❚❚", "Start"], ["0", "Select"], ["Setas", "Direcional"], ["VOLTAR", "Menu do jogo"]
  ];
  var PC_ROWS = [
    ["Z", "B"], ["X", "A"], ["A", "Y"], ["S", "X"], ["Q", "L"], ["W", "R"], ["Enter", "Start"], ["Shift", "Select"], ["Setas", "Direcional"], ["Esc", "Menu do jogo"]
  ];

  var XBOX_ROWS = [
    ["A", "B"], ["B", "A"], ["X", "Y"], ["Y", "X"], ["LB", "L"], ["RB", "R"], ["☰ Menu", "Start"], ["⧉ Exibir", "Select"],
    ["Analógico", "Direcional"], ["RT (segurar)", "Turbo"], ["Botão Xbox", "Menu do jogo"]
  ];
  var PS_ROWS = [
    ["✕", "B"], ["○", "A"], ["□", "Y"], ["△", "X"], ["L1", "L"], ["R1", "R"], ["OPTIONS", "Start"], ["SHARE", "Select"],
    ["Analógico", "Direcional"], ["R2 (segurar)", "Turbo"], ["Botão PS", "Menu do jogo"]
  ];

  var SNES_ROWS = [
    ["B", "B"], ["A", "A"], ["Y", "Y"], ["X", "X"], ["L", "L"], ["R", "R"], ["START", "Start"], ["SELECT", "Select"],
    ["Direcional", "Direcional"], ["Select + Start", "Menu do jogo"]
  ];
  var PADMODEL_NAMES = { auto: "automático", snes: "SNES", xbox: "Xbox", ps: "PlayStation (PS4/PS5)" };
  function padModel() { try { var v = localStorage.getItem("snestv.padmodel"); return PADMODEL_NAMES[v] ? v : "auto"; } catch (e) { return "auto"; } }

  function buildSideHelp(g, rom) {
    var key = helpKeyFor(g, rom), h = key && GAME_HELP[key] ? GAME_HELP[key] : GENERIC_HELP;
    var L = $("side-left"), R = $("side-right");
    var html = '<div id="side-players" class="side-players"></div><div class="side-h">Botões</div><div class="side-game"></div><ul class="side-list">';
    h.rows.forEach(function () { html += "<li><span></span><em></em></li>"; });
    html += "</ul>";
    L.innerHTML = html;
    L.querySelector(".side-game").textContent = key ? h.name : "Este jogo";
    var lis = L.querySelectorAll("li");
    h.rows.forEach(function (r, i) {
      lis[i].querySelector("span").innerHTML = btnChip(r[0]);
      lis[i].querySelector("em").textContent = r[1];
    });
    paintPlayers();

    var pads = connectedPads(), pt = pads.length ? padType(pads[0]) : (ctrl.skins && ctrl.conns[0] && ctrl.skins[0]) || null;
    if (pt === "generic") pt = "snes";
    if (padModel() !== "auto") pt = padModel();          // escolhido no menu do jogo
    var rows = pt === "xbox" ? XBOX_ROWS : pt === "ps" ? PS_ROWS : pt === "snes" ? SNES_ROWS : TV_LIKE ? REMOTE_ROWS : PC_ROWS;
    var head = pt === "xbox" ? "No controle Xbox" : pt === "ps" ? "No controle PlayStation" : pt === "snes" ? "No controle SNES" : TV_LIKE ? "No controle da TV" : "No teclado";
    var html2 = '<div class="side-h">' + head + '</div><ul class="side-list remote">';
    rows.forEach(function () { html2 += "<li><b></b><span></span></li>"; });
    html2 += '</ul><div class="side-note">' + (pt ? "Os botões seguem a posição do controle do SNES. O analógico esquerdo também anda." :
      "Joystick: os botões ficam na mesma posição do controle do SNES. Select + Start = menu.") + '</div>';
    R.innerHTML = html2;
    var lis2 = R.querySelectorAll("li");
    rows.forEach(function (r, i) {
      var b = lis2[i].querySelector("b");
      b.textContent = r[0];
      if (pt === "ps" && /^[✕○□△]$/.test(r[0])) b.className = "ps-sym ps-" + ({ "✕": "x", "○": "o", "□": "s", "△": "t" })[r[0]];
      if (pt === "xbox" && /^[ABXY]$/.test(r[0])) b.className = "xb-sym xb-" + r[0].toLowerCase();
      if (pt === "snes" && /^[ABXY]$/.test(r[0])) b.className = "xb-sym sn-" + r[0].toLowerCase();
      var span = lis2[i].querySelector("span");
      span.innerHTML = /^(A|B|X|Y|L|R|Start|Select)$/.test(r[1]) ? btnChip(r[1]) : r[1] === "Direcional" ? btnChip("dpad") : "";
      if (r[1] === "Direcional" || r[1] === "Menu do jogo" || r[1] === "Turbo") span.innerHTML += "<small>" + r[1] + "</small>";
    });
    fitPlayer();
  }

  // quem é cada jogador (topo da faixa esquerda) e, no jogo online, o ping
  var P_COLORS = ["p1", "p2", "p3", "p4"];
  function playerList() {
    var pads = connectedPads(), out = [];
    var me = NET && NET.started ? (NET.role === "host" ? 0 : 1) : -1;
    for (var n = 0; n < 4; n++) {
      var who = [];
      if (me >= 0) {
        // online: este TV controla só o seu jogador; o outro é o amigo
        if (n === me) {
          who.push(pads[0] ? padName(pads[0]) : TV_LIKE ? "Controle da TV" : "Teclado");
          if (ctrl.conns[0]) who.push("Celular");
        } else if (n === 1 - me) who.push((NET.friend || "Amigo") + " (online)");
      } else {
        if (pads[n]) who.push(padName(pads[n]));
        if (ctrl.conns[n]) who.push("Celular" + (ctrl.skins && ctrl.skins[n] ? " (" + ({ snes: "SNES", xbox: "Xbox", ps: "PS5" })[ctrl.skins[n]] + ")" : ""));
        if (n === 0 && !pads[0]) who.push(TV_LIKE ? "Controle da TV" : "Teclado");
      }
      if (who.length) out.push({ n: n, who: who.join(" + "), me: me < 0 ? n === 0 : n === me });
    }
    return out;
  }
  function pingClass(ms) { return ms <= 60 ? "good" : ms <= 120 ? "ok" : "bad"; }
  function paintPlayers() {
    var box = $("side-players");
    if (!box) return;
    var list = playerList().sort(function (a, b) { return (b.me ? 1 : 0) - (a.me ? 1 : 0) || a.n - b.n; }), html = "";
    list.forEach(function (p, i) {
      if (i === 0 || p.me) {
        html += '<div class="pl-main"><span class="pl-tag ' + P_COLORS[p.n] + '">Jogador ' + (p.n + 1) + '</span>' +
          (NET && NET.started && p.me ? '<span class="pl-you">você</span>' : "") + '<div class="pl-who"></div></div>';
      } else html += '<div class="pl-row"><span class="pl-dot ' + P_COLORS[p.n] + '">J' + (p.n + 1) + '</span><span class="pl-who"></span></div>';
    });
    // garante que o jogador desta TV aparece em destaque
    if (NET && NET.started) {
      var ms = NET.rtt || 0, cls = ms ? pingClass(ms) : "";
      html += '<div class="pl-net"><span class="pl-bars ' + cls + '"><i></i><i></i><i></i><i></i></span><b>ONLINE</b>' +
        '<span class="pl-ping">' + (ms ? "Ping " + ms + " ms" : "Medindo…") + '</span></div>';
    }
    box.innerHTML = html;
    var whos = box.querySelectorAll(".pl-who");
    list.forEach(function (p, i) { if (whos[i]) whos[i].textContent = p.who; });
  }

  // posiciona as faixas laterais ao lado da área do jogo
  function placeSides(gx, gw, vw) {
    var L = $("side-left"), R = $("side-right");
    if (!L) return;
    var side = gx - 24, show = sideOn() && side >= 170 && state.view !== "launcher";
    L.hidden = R.hidden = !show;
    if (!show) return;
    L.style.width = R.style.width = side - 16 + "px";
    L.style.left = "16px";
    R.style.left = (gx + gw + 24) + "px";
  }

  // ====================================================================
  // Google Drive
  // ====================================================================
  function driveBytes(g) {
    if (!Drive.valid()) {
      return Promise.reject(new Error("drive-expirado"));
    }
    return Drive.download({ id: g.driveId }, function (got, total) {
      if (state.view === "loading") $("loading-text").textContent = "Baixando do Google Drive… " + (total ? Math.round(got / total * 100) + "%" : fmtSize(got));
    }).then(function (buf) {
      // guarda uma cópia na TV: da próxima vez abre na hora, mesmo sem internet
      romsPut({ name: g.name, size: g.size, data: buf, added: Date.now(), from: "drive" })["catch"](function () {});
      return buf;
    });
  }

  function driveState() {
    if (!Drive.configured()) return "config";
    return Drive.linked() ? (Drive.valid() ? "on" : "expired") : "off";
  }
  var DRIVE_BTNS = {
    here: "Entrar com o Google nesta TV",
    phone: "Entrar pelo celular (QR Code)",
    reload: "Procurar jogos de novo",
    logout: "Desconectar o Google Drive",
    back: "Voltar"
  };
  function openDrive() {
    state.view = "drive";
    state.driveBtn = 0;
    $("drive").hidden = false;
    paintDrive();
  }
  function closeDrive() {
    $("drive").hidden = true;
    state.view = "launcher";
    padPrev = {};
    renderGrid();
  }
  function driveButtons() {
    var st = driveState();
    if (st === "config") return ["back"];
    if (st === "off") return IS_TIZEN ? ["phone", "back"] : ["here", "phone", "back"];
    if (st === "expired") return (IS_TIZEN ? ["phone"] : ["here", "phone"]).concat(["logout", "back"]);
    return ["reload", "logout", "back"];
  }
  function paintDrive(msg, kind) {
    var st = driveState(), t = $("drive-text");
    if (st === "config") t.innerHTML = "O Google Drive ainda não foi configurado neste site. Falta o <b>ID do cliente do Google</b> (arquivo js/drive-config.js).";
    else if (st === "off") t.textContent = "Entre com a sua conta do Google. O SNES TV só lê os arquivos (não apaga nem muda nada) e mostra na lista os jogos de SNES que estão no seu Drive.";
    else {
      var n = Drive.files().length;
      t.textContent = "Conectado como " + Drive.who() + " · " + n + (n === 1 ? " jogo encontrado" : " jogos encontrados") + ". " +
        (st === "on" ? "O acesso vale por mais " + Drive.minutesLeft() + " min (regra do Google para sites); jogos já baixados ficam na TV." :
          "O acesso de 1 hora acabou: entre de novo para baixar jogos novos. Os já baixados continuam funcionando.");
    }
    var ul = $("drive-btns"), keys = driveButtons();
    if (state.driveBtn >= keys.length) state.driveBtn = keys.length - 1;
    ul.innerHTML = "";
    keys.forEach(function (k, i) {
      var li = document.createElement("li");
      li.textContent = DRIVE_BTNS[k];
      li.setAttribute("data-k", k);
      if (i === state.driveBtn) li.className = "focused";
      li.addEventListener("click", function () { state.driveBtn = i; driveAction(); });
      ul.appendChild(li);
    });
    var s = $("drive-status");
    s.textContent = msg || "";
    s.className = "phone-status " + (kind || "");
  }
  function driveMove(d) {
    var n = driveButtons().length;
    state.driveBtn = (state.driveBtn + d + n) % n;
    paintDrive($("drive-status").textContent, $("drive-status").className.replace("phone-status", "").trim());
  }
  function driveAction() {
    var k = driveButtons()[state.driveBtn];
    if (k === "back") return closeDrive();
    if (k === "logout") { Drive.logout(); paintDrive("Google Drive desconectado.", "ok"); refresh(true); return; }
    if (k === "phone") { $("drive").hidden = true; state.phoneDrive = true; openPhone(); return; }
    if (k === "reload") {
      paintDrive("Procurando jogos no Drive…");
      Drive.list().then(function (l) { paintDrive(l.length + " jogos encontrados.", "ok"); refresh(true); },
        function (e) { paintDrive(driveErr(e), "err"); });
      return;
    }
    if (k === "here") {
      paintDrive("Abrindo o login do Google… (pode abrir uma janela nova)");
      Drive.loginHere().then(function (l) {
        state.driveBtn = 0;
        paintDrive("Pronto! " + l.length + " jogos encontrados no seu Drive.", "ok");
        refresh(true);
      }, function (e) { paintDrive(driveErr(e), "err"); });
    }
  }
  function driveErr(e) {
    var m = (e && e.message) || String(e);
    if (m === "expirado") return "O acesso ao Drive acabou (dura 1 hora). Entre de novo.";
    if (/popup|janela|blocked/i.test(m)) return "A TV bloqueou a janela do Google. Use \"Entrar pelo celular\".";
    return "Não deu certo: " + m;
  }
  // token mandado pelo celular (tela "Adicionar pelo celular")
  function driveFromPhone(d) {
    Drive.setToken(d.token, d.expires).then(function (l) {
      phoneStatus("Google Drive conectado ✓ — " + l.length + " jogos encontrados. Aperte VOLTAR.", "ok");
      toast("☁ Google Drive conectado: " + l.length + " jogos", 3000);
      refresh(true);
    }, function (e) { phoneStatus("Google Drive: " + driveErr(e), "err"); });
  }

  // ====================================================================
  // Início
  // ====================================================================
  function init() {
    registerTvKeys();
    Conquistas.onUnlock = showAch;
    if (window.Drive) {
      var baseSnes = Drive.looksSnes;
      Drive.looksSnes = function (n) { return baseSnes(n) || !!findCover(cleanTitle(n).title); };
    }
    if (window.RA) {
      RA.onEvent = raEvent;
      RA.onUpdate = function () {
        if (state.view !== "launcher" || !state.items) return;
        paintBars();
        detKey = null; setFocus();
      };
    }
    paintGreeting();
    if (!userName()) setTimeout(openName, 300);
    showDeviceInfo();
    if (ctrlEnabled()) startCtrl();
    Promise.all([loadCovers(), loadPlayers()]).then(function () { if (state.view === "launcher" && state.items) renderGrid(); });
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
