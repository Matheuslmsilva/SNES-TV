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
  var h2g = load("snestv.ra.h2g", {});         // md5 -> id do jogo no RetroAchievements
  var queue = load("snestv.ra.queue", []);     // conquistas feitas sem internet, esperando envio

  // ---------- respostas guardadas para jogar sem internet (IndexedDB; localStorage se não houver) ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        var rq = indexedDB.open("snestv-ra", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  function kvGet(k) {
    return db().then(function (d) {
      if (!d) { try { return localStorage.getItem("snestv.rakv." + k); } catch (e) { return null; } }
      return new Promise(function (res) {
        try { var r = d.transaction("kv").objectStore("kv").get(k); r.onsuccess = function () { res(r.result == null ? null : r.result); }; r.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    });
  }
  function kvPut(k, v) {
    return db().then(function (d) {
      if (!d) { try { localStorage.setItem("snestv.rakv." + k, v); } catch (e) {} return; }
      try { d.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) {}
    });
  }
  function addUnlock(g, id) {
    if (!g || !id) return Promise.resolve();
    return kvGet("unl:" + g).then(function (t) {
      var l = []; try { l = t ? JSON.parse(t) : []; } catch (e) {}
      if (l.indexOf(+id) < 0) l.push(+id);
      return kvPut("unl:" + g, JSON.stringify(l));
    });
  }
  function strBytes(t) { var u = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i) & 255; return u; }
  function qs(body) {
    var o = {};
    String(body || "").split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); });
    return o;
  }
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
        if (j.Success && j.GameId) { kvPut("set:" + h, JSON.stringify(j)); h2g[h] = j.GameId; save("snestv.ra.h2g", h2g); }
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
      RA.flush();
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
      RA.flush();
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

    pending: function () { return queue.length; },

    // envia as conquistas feitas sem internet (mais antigas primeiro), como o RAOfflineProxy
    flushing: false,
    flush: function () {
      if (RA.flushing || !queue.length || !acct) return Promise.resolve(0);
      RA.flushing = true;
      var sent = 0;
      function next() {
        if (!queue.length) return Promise.resolve();
        var it = queue[0];
        // "o" = segundos desde o desbloqueio (o site aceita até 14 dias); "v" = assinatura com o mesmo valor
        var o = Math.max(1, Math.min(1209600, Math.round((Date.now() - it.at) / 1000)));
        var v = md5(strBytes(String(it.a) + it.u + "0" + String(it.a) + String(o)));
        var p = { r: "awardachievement", u: it.u, t: it.t, a: it.a, h: 0, o: o, v: v };
        if (it.m) p.m = it.m;
        return post(p).then(function (j) {
          var err = String((j && (j.Error || j.Code)) || "");
          if (j && !j.Success && /token|credential|login|auth/i.test(err) && !/already/i.test(err)) throw new Error("auth");
          queue.shift(); save("snestv.ra.queue", queue);
          if (j && j.Success) { sent++; addUnlock(h2g[it.m], it.a); }
          return next();
        });
      }
      return next().then(function () { RA.flushing = false; if (sent && RA.onEvent) RA.onEvent("flushed", { n: sent }); if (RA.onUpdate) RA.onUpdate(); return sent; },
        function () { RA.flushing = false; return sent; });
    },

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

  // o rcheevos pede uma chamada HTTP; a resposta volta para o C.
  // Com internet: repassa ao site e guarda a resposta. Sem internet: responde com o que foi guardado
  // e põe as conquistas numa fila, enviada quando a conexão voltar (mesma ideia do RAOfflineProxy).
  function raCall(url, body, ctype, cb, data) {
    var M = RA.M, q = qs(body), r = q.r || "";
    function done(status, text) {
      if (!RA.M || RA.M !== M) return;           // o jogo já fechou
      var n = M.lengthBytesUTF8(text), p = M._malloc(n + 1);
      M.stringToUTF8(text, p, n + 1);
      try { M._s_ra_resp(cb, data, p, n, status); } catch (e) { console.error(e); }
      M._free(p);
    }
    function offline() {
      offlineAnswer(r, q).then(function (t) {
        if (t != null) { RA.offline = true; done(200, t); }
        else done(-1, "");
      });
    }
    var x = new XMLHttpRequest();
    x.open(body != null ? "POST" : "GET", url, true);
    if (body != null) x.setRequestHeader("Content-Type", ctype || "application/x-www-form-urlencoded");
    x.timeout = 15000;
    x.onload = function () {
      if (x.status === 0 || x.status >= 500) { offline(); return; }
      var t = x.responseText || "";
      RA.offline = false;
      remember(r, q, t);
      done(x.status, t);
      if (queue.length) RA.flush();
    };
    x.onerror = x.ontimeout = offline;
    x.send(body);
  }

  function remember(r, q, t) {
    var j = null; try { j = JSON.parse(t); } catch (e) { return; }
    if (!j || !j.Success) return;
    if (r === "login2") kvPut("login:" + String(q.u).toLowerCase(), t);
    else if (r === "achievementsets") {
      kvPut("set:" + (q.m || "g" + q.g), t);
      if (q.m && j.GameId) { h2g[q.m] = j.GameId; save("snestv.ra.h2g", h2g); }
    } else if (r === "gameid") kvPut("gid:" + q.m, t);
    else if (r === "startsession") {
      var ids = (j.Unlocks || []).concat(j.HardcoreUnlocks || []).map(function (u) { return +u.ID; });
      kvPut("unl:" + q.g, JSON.stringify(ids));
    } else if (r === "awardachievement") addUnlock(q.g || h2g[q.m], q.a);
  }

  function offlineAnswer(r, q) {
    var now = Math.floor(Date.now() / 1000);
    if (r === "login2") return kvGet("login:" + String(q.u).toLowerCase()).then(function (t) {
      if (t) return t;
      if (!acct || !q.t || q.t !== acct.token) return null;
      return JSON.stringify({ Success: true, User: acct.user, Token: acct.token, Score: 0, SoftcorePoints: acct.score || 0, Messages: 0, Permissions: 1, AccountType: "Registered" });
    });
    if (r === "achievementsets") return kvGet("set:" + (q.m || "g" + q.g));
    if (r === "gameid") return kvGet("gid:" + q.m).then(function (t) {
      return t || (h2g[q.m] ? JSON.stringify({ Success: true, GameID: h2g[q.m] }) : null);
    });
    if (r === "startsession") return kvGet("unl:" + q.g).then(function (t) {
      // sessão montada aqui: desbloqueios guardados + os que estão na fila
      var ids = []; try { ids = t ? JSON.parse(t) : []; } catch (e) {}
      queue.forEach(function (it) { if (h2g[it.m] === +q.g && ids.indexOf(+it.a) < 0) ids.push(+it.a); });
      return JSON.stringify({ Success: true, Unlocks: ids.map(function (id) { return { ID: id, When: now }; }), HardcoreUnlocks: [], ServerNow: now });
    });
    if (r === "awardachievement") {
      if (+q.h) return Promise.resolve(JSON.stringify({ Success: false, Error: "Hardcore não funciona sem internet" }));
      if (!queue.some(function (it) { return it.a === +q.a; })) {
        queue.push({ a: +q.a, m: q.m || "", u: q.u, t: q.t, at: Date.now() });
        save("snestv.ra.queue", queue);
      }
      var g = h2g[q.m];
      if (g) addUnlock(g, q.a);
      if (RA.onEvent) RA.onEvent("queued", { n: queue.length });
      return Promise.resolve(JSON.stringify({ Success: true, Score: acct ? acct.score : 0, SoftcoreScore: acct ? acct.score : 0, AchievementID: +q.a }));
    }
    // ping e outros: só confirma
    return Promise.resolve(JSON.stringify({ Success: true }));
  }

  // voltou a internet → envia a fila
  try { window.addEventListener("online", function () { setTimeout(function () { RA.flush(); }, 2000); }); } catch (e) {}

  window.RA = RA;
})();
