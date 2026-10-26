/*
 * Google Drive no SNES TV
 *  - login pelo Google (Google Identity Services, "token" de 1 hora, só leitura)
 *    feito no próprio navegador da TV ou no celular (que manda o token para a TV)
 *  - lista os arquivos de SNES do Drive (.sfc .smc .swc .fig e .zip com nome de jogo de SNES)
 *  - baixa o jogo na hora de jogar e guarda uma cópia na TV
 * Precisa de um "ID do cliente OAuth" do Google Cloud em js/drive-config.js.
 */
(function () {
  "use strict";
  var API = "https://www.googleapis.com/drive/v3/";
  var SCOPE = "https://www.googleapis.com/auth/drive.readonly";
  var ROM_RE = /\.(sfc|smc|swc|fig)$/i, ZIP_RE = /\.zip$/i;

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var auth = load("snestv.drive.auth", null);    // { token, exp, email, name }
  var files = load("snestv.drive.files", []);    // [{ id, name, size }]

  function req(url, type, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!D.valid()) { reject(new Error("expirado")); return; }
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.setRequestHeader("Authorization", "Bearer " + auth.token);
      if (type) x.responseType = type;
      x.timeout = 120000;
      if (onProgress) x.onprogress = function (e) { onProgress(e.loaded, e.total); };
      x.onload = function () {
        if (x.status === 401) { auth.exp = 0; save("snestv.drive.auth", auth); reject(new Error("expirado")); return; }
        if (x.status < 200 || x.status >= 300) { reject(new Error("Drive respondeu " + x.status)); return; }
        if (type) resolve(x.response);
        else { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } }
      };
      x.onerror = x.ontimeout = function () { reject(new Error("Sem internet")); };
      x.send();
    });
  }

  var D = {
    clientId: function () { return String(window.SNESTV_GOOGLE_CLIENT_ID || ""); },
    configured: function () { return /\.apps\.googleusercontent\.com$/.test(D.clientId()); },
    linked: function () { return !!auth; },
    valid: function () { return !!(auth && auth.token && auth.exp > Date.now() + 30000); },
    who: function () { return auth ? (auth.name || auth.email || "sua conta") : ""; },
    minutesLeft: function () { return auth ? Math.max(0, Math.round((auth.exp - Date.now()) / 60000)) : 0; },
    files: function () { return files; },
    onChange: null,

    // token vindo do celular ou do login nesta TV
    setToken: function (token, expiresInSec) {
      auth = auth || {};
      auth.token = token;
      auth.exp = Date.now() + Math.max(60, (+expiresInSec || 3600) - 60) * 1000;
      save("snestv.drive.auth", auth);
      return req(API + "about?fields=user(displayName,emailAddress)").then(function (j) {
        auth.email = j.user && j.user.emailAddress; auth.name = j.user && j.user.displayName;
        save("snestv.drive.auth", auth);
        return D.list();
      });
    },

    // login no navegador desta TV (abre a janela do Google)
    loginHere: function () {
      if (!D.configured()) return Promise.reject(new Error("não configurado"));
      return loadGis().then(function () {
        return new Promise(function (resolve, reject) {
          var tc = google.accounts.oauth2.initTokenClient({
            client_id: D.clientId(), scope: SCOPE,
            callback: function (r) {
              if (r && r.access_token) resolve(D.setToken(r.access_token, r.expires_in));
              else reject(new Error((r && r.error) || "login cancelado"));
            },
            error_callback: function (e) { reject(new Error((e && (e.message || e.type)) || "login cancelado")); }
          });
          tc.requestAccessToken({ prompt: auth && auth.email ? "" : "consent", hint: auth && auth.email });
        });
      });
    },

    logout: function () {
      try { if (auth && auth.token && window.google && google.accounts) google.accounts.oauth2.revoke(auth.token, function () {}); } catch (e) {}
      auth = null; files = [];
      save("snestv.drive.auth", null); save("snestv.drive.files", null);
      if (D.onChange) D.onChange();
    },

    // procura os jogos no Drive inteiro (inclusive pastas compartilhadas com você)
    list: function () {
      var out = [], pages = 0;
      var q = encodeURIComponent("trashed = false and not mimeType contains 'google-apps'");
      function page(tok) {
        var url = API + "files?q=" + q + "&pageSize=1000&fields=nextPageToken,files(id,name,size)&includeItemsFromAllDrives=true&supportsAllDrives=true" +
          (tok ? "&pageToken=" + encodeURIComponent(tok) : "");
        return req(url).then(function (j) {
          (j.files || []).forEach(function (f) {
            var n = f.name || "", sz = +f.size || 0;
            if (sz <= 0 || sz > 16 * 1048576) return;
            if (ROM_RE.test(n) || (ZIP_RE.test(n) && D.looksSnes(n))) out.push({ id: f.id, name: n, size: sz });
          });
          if (j.nextPageToken && ++pages < 30) return page(j.nextPageToken);
        });
      }
      return page(null).then(function () {
        out.sort(function (a, b) { return a.name.localeCompare(b.name); });
        files = out;
        save("snestv.drive.files", files);
        if (D.onChange) D.onChange();
        return files;
      });
    },

    // .zip só entra se o nome for de um jogo de SNES (lista de capas) — o app troca isso por uma função melhor
    looksSnes: function (name) { return /snes|super nintendo|\(u\)|\(usa\)|\(e\)|\(j\)|\(europe\)|\(japan\)|\(brazil\)/i.test(name); },

    download: function (f, onProgress) {
      return req(API + "files/" + encodeURIComponent(f.id) + "?alt=media&supportsAllDrives=true", "arraybuffer", onProgress);
    }
  };

  var gisP = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisP) return gisP;
    gisP = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { gisP = null; reject(new Error("não consegui abrir o login do Google")); };
      document.head.appendChild(s);
    });
    return gisP;
  }
  D.loadGis = loadGis;
  D.SCOPE = SCOPE;

  window.Drive = D;
})();
