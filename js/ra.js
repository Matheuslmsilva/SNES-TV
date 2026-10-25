/*
 * Conquistas da comunidade — RetroAchievements (retroachievements.org)
 *  - login com usuário e senha (só o "token" fica salvo na TV)
 *  - durante o jogo (emulador TV antiga) o rcheevos, compilado junto com o Snes9x 2005, lê a
 *    memória e desbloqueia as conquistas no servidor (modo normal / softcore)
 *  - fora do jogo: lista e progresso de cada jogo (consulta pelo MD5 da ROM)
 */
(function () {
  "use strict";
  var HOST = "https://retroachievements.org/dorequest.php";
  var MEDIA = "https://media.retroachievements.org/Badge/";

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var acct = load("snestv.ra", null);          // { user, token, name, score }
  var sets = load("snestv.ra.sets", {});       // por jogo: { h, id, title, img, total, unlocked, list, at }
  var hashes = load("snestv.ra.hash", {});     // gameKey -> md5
  function saveSets() {
    try { localStorage.setItem("snestv.ra.sets", JSON.stringify(sets)); }
    catch (e) {
      // sem espaço: mantém só os números (sem as listas) dos mais antigos
      Object.keys(sets).forEach(function (k) { if (sets[k].list && sets[k].list.length > 40) sets[k].list = sets[k].list.slice(0, 40); });
      try { localStorage.setItem("snestv.ra.sets", JSON.stringify(sets)); } catch (e2) {}
    }
  }

  // ---------------- MD5 (para identificar a ROM no RetroAchievements) ----------------
  function md5(u8) {
    var K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], i;
    for (i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    var n = u8.length, nb = ((n + 8) >> 6) + 1, W = new Int32Array(nb * 16);
    for (i = 0; i < n; i++) W[i >> 2] |= u8[i] << ((i % 4) * 8);
    W[n >> 2] |= 0x80 << ((n % 4) * 8);
    W[nb * 16 - 2] = (n * 8) | 0;
    W[nb * 16 - 1] = Math.floor(n / 536870912) | 0;
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var blk = 0; blk < nb * 16; blk += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g, r = i >> 4;
        if (r === 0) { F = (B & C) | (~B & D); g = i; }
        else if (r === 1) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (r === 2) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        var t = D; D = C; C = B;
        var x = (A + F + K[i] + W[blk + g]) | 0, s = S[(r << 2) | (i & 3)];
        B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
        A = t;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = "", w = [a0, b0, c0, d0];
    for (i = 0; i < 16; i++) { var by = (w[i >> 2] >>> ((i % 4) * 8)) & 255; out += (by < 16 ? "0" : "") + by.toString(16); }
    return out;
  }
  // hash de SNES: tira o cabeçalho de 512 bytes de copiador
  function romHash(rom) { return md5(rom.length % 8192 === 512 ? rom.subarray(512) : rom); }

  // ---------------- HTTP ----------------
  function post(params) {
    return new Promise(function (resolve, reject) {
      var body = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
      var x = new XMLHttpRequest();
      x.open("POST", HOST, true);
      x.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      x.timeout = 20000;
      x.onload = function () {
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (e) {}
        if (j) resolve(j); else reject(new Error("Resposta inválida do servidor (" + x.status + ")"));
      };
      x.onerror = x.ontimeout = function () { reject(new Error("offline")); };
      x.send(body);
    });
  }
  function errText(e) {
    return e && e.message === "offline" ?
      "Não consegui falar com o RetroAchievements. Confira a internet da TV (no navegador, alguns modelos bloqueiam; no app instalado funciona)." :
      (e && e.message) || "Erro desconhecido";
  }

  var RA = {
    MEDIA: MEDIA,
    md5: md5, romHash: romHash,
    onEvent: null,           // function(type, data)
    onUpdate: null,          // a lista/progresso mudou
    M: null, key: null, game: null,

    user: function () { return acct; },

    login: function (u, p) {
      return post({ r: "login2", u: u, p: p }).then(function (j) {
        if (!j.Success || !j.Token) throw new Error(j.Error || "Usuário ou senha incorretos");
        acct = { user: j.User || u, token: j.Token, name: j.User || u, score: j.SoftcorePoints || j.Score || 0 };
        save("snestv.ra", acct);
        RA.progressAt = 0;
        return acct;
      }, function (e) { throw new Error(errText(e)); });
    },

    logout: function () {
      acct = null; save("snestv.ra", null);
      if (RA.M && RA.M._s_ra_logout) RA.M._s_ra_logout();
      Object.keys(sets).forEach(function (k) { sets[k].unlocked = 0; (sets[k].list || []).forEach(function (a) { a.u = 0; }); });
      saveSets();
    },

    info: function (key) { var s = sets[key]; return s && s.id ? s : null; },
    known: function (key) { return !!sets[key]; },

    // --------- consulta fora do jogo ---------
    fetchSet: function (key, rom) {
      if (!acct) return Promise.resolve(null);
      var h = hashes[key] || (rom ? romHash(rom) : null);
      if (!h) return Promise.resolve(null);
      if (!hashes[key]) { hashes[key] = h; save("snestv.ra.hash", hashes); }
      return post({ r: "achievementsets", u: acct.user, t: acct.token, m: h, v: 2 }).then(function (j) {
        var old = sets[key] || {};
        if (!j.Success || !j.GameId) { sets[key] = { h: h, id: 0, at: Date.now() }; saveSets(); return null; }
        var list = [], seen = {};
        (j.Sets || []).forEach(function (st) {
          (st.Achievements || []).forEach(function (a) {
            if (a.Flags && a.Flags !== 3) return;                     // só as oficiais
            var was = (old.list || []).filter(function (o) { return o.id === a.ID; })[0];
            list.push({ id: a.ID, t: a.Title, d: a.Description, p: a.Points || 0,
              b: a.BadgeURL || (MEDIA + a.BadgeName + ".png"), bl: a.BadgeLockedURL || (MEDIA + a.BadgeName + "_lock.png"),
              u: was ? was.u : 0 });
            seen[a.ID] = 1;
          });
        });
        sets[key] = { h: h, id: j.GameId, title: j.Title, img: j.ImageIconUrl, total: list.length,
          unlocked: old.id === j.GameId ? Math.min(old.unlocked || 0, list.length) : 0, list: list, at: Date.now() };
        saveSets();
        return sets[key];
      });
    },

    // contagem de desbloqueadas de todos os jogos de SNES da conta (1 pedido)
    fetchProgress: function () {
      if (!acct) return Promise.resolve();
      return post({ r: "allprogress", u: acct.user, t: acct.token, c: 3 }).then(function (j) {
        if (!j.Success || !j.Response) return;
        RA.progressAt = Date.now();
        Object.keys(sets).forEach(function (k) {
          var s = sets[k], p = s.id && j.Response[s.id];
          if (!p) return;
          s.unlocked = Math.max(p.Unlocked || 0, p.UnlockedHardcore || 0);
          if (p.Achievements) s.total = p.Achievements;
        });
        saveSets();
        if (RA.onUpdate) RA.onUpdate();
      });
    },

    // percorre a lista de jogos, um de cada vez, sem atrapalhar a tela
    scanning: false,
    scan: function (games, keyOf, romFor) {
      if (!acct || RA.scanning) return;
      var todo = games.filter(function (g) {
        var s = sets[keyOf(g)];
        return !s || Date.now() - s.at > 7 * 86400000;
      });
      RA.scanning = true;
      var i = 0;
      function next() {
        if (!acct || i >= todo.length) {
          RA.scanning = false;
          if (todo.length || !RA.progressAt || Date.now() - RA.progressAt > 600000) RA.fetchProgress()["catch"](function () {});
          return;
        }
        var g = todo[i++], k = keyOf(g);
        var got = hashes[k] ? Promise.resolve(null) : romFor(g);
        got.then(function (rom) { return RA.fetchSet(k, rom); })
          .then(function () { if (RA.onUpdate) RA.onUpdate(); setTimeout(next, 250); },
            function (e) { if (e && e.message === "offline") { RA.scanning = false; return; } setTimeout(next, 250); });
      }
      next();
    },

    // --------- durante o jogo (emulador TV antiga) ---------
    attach: function (lite, rom, key) {
      RA.detach();
      var M = lite && lite.M;
      if (!acct || !M || !M._s_ra_login_tok) return false;
      RA.M = M; RA.key = key; RA.game = null;
      var h = romHash(rom);
      hashes[key] = h; save("snestv.ra.hash", hashes);
      M.raCall = raCall;
      M.raEvent = function (type, json) {
        var d = null;
        try { d = json ? JSON.parse(json) : null; } catch (e) {}
        if (type === 100) {
          if (d && d.ok) M._s_ra_load(cstr(M, h));
          else if (RA.onEvent) RA.onEvent("loginfail", d);
          return;
        }
        if (type === 101) {
          if (d && d.ok) { RA.game = JSON.parse(M.UTF8ToString(M._s_ra_game())); RA.sync(); }
          if (RA.onEvent) RA.onEvent("game", d && d.ok ? RA.game : null);
          return;
        }
        if (type === 1 && d) RA.sync();
        if (RA.onEvent) RA.onEvent(type, d);
      };
      M._s_ra_login_tok(cstr(M, acct.user), cstr(M, acct.token));
      clearInterval(RA.idle);
      RA.idle = setInterval(function () { if (RA.M && lite.paused && RA.M._s_ra_idle) RA.M._s_ra_idle(); }, 1000);
      return true;
    },

    // copia o estado do rc_client para o cache (lista com desbloqueios e progresso)
    sync: function () {
      var M = RA.M; if (!M || !RA.key) return;
      var g = JSON.parse(M.UTF8ToString(M._s_ra_game()));
      if (!g) return;
      var list = JSON.parse(M.UTF8ToString(M._s_ra_list()));
      sets[RA.key] = { h: hashes[RA.key], id: g.id, title: g.title, img: g.img, total: g.total, unlocked: g.unlocked,
        list: list.map(function (a) { return { id: a.id, t: a.t, d: a.d, p: a.p, b: a.b, bl: a.bl, u: a.u, m: a.m, mp: a.mp }; }),
        at: Date.now() };
      RA.game = g;
      saveSets();
      if (RA.onUpdate) RA.onUpdate();
    },

    reset: function () { if (RA.M && RA.M._s_ra_reset) RA.M._s_ra_reset(); },

    detach: function () {
      clearInterval(RA.idle);
      if (RA.M) { try { RA.sync(); RA.M._s_ra_unload(); } catch (e) {} }
      RA.M = null; RA.key = null; RA.game = null;
    }
  };

  function cstr(M, s) {
    var n = M.lengthBytesUTF8(s) + 1, p = M._malloc(n);
    M.stringToUTF8(s, p, n);
    return p;     // (pequeno; o rcheevos copia o texto)
  }

  // o rcheevos pede uma chamada HTTP; a resposta volta para o C
  function raCall(url, body, ctype, cb, data) {
    var M = RA.M;
    var x = new XMLHttpRequest();
    x.open(body != null ? "POST" : "GET", url, true);
    if (body != null) x.setRequestHeader("Content-Type", ctype || "application/x-www-form-urlencoded");
    x.timeout = 30000;
    function done(status, text) {
      if (!RA.M || RA.M !== M) return;           // o jogo já fechou
      var n = M.lengthBytesUTF8(text), p = M._malloc(n + 1);
      M.stringToUTF8(text, p, n + 1);
      try { M._s_ra_resp(cb, data, p, n, status); } catch (e) { console.error(e); }
      M._free(p);
    }
    x.onload = function () { done(x.status, x.responseText || ""); };
    // -2 = erro de rede que o rcheevos tenta de novo depois (desbloqueios ficam guardados)
    x.onerror = x.ontimeout = function () { done(/awardachievement|submitlbentry|ping/.test(body || url) ? -2 : -1, ""); };
    x.send(body);
  }

  window.RA = RA;
})();
