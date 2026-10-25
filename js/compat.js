/*
 * Compatibilidade com navegadores de TV antigos (Samsung 2015+, LG webOS antigos,
 * Android TV, Chromium 38+). Só preenche o que estiver faltando.
 */
(function (w) {
  "use strict";

  // ---- requestAnimationFrame / performance.now ----
  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame = w.webkitRequestAnimationFrame || function (cb) {
      return setTimeout(function () { cb(Date.now()); }, 16);
    };
  }
  if (!w.performance) w.performance = {};
  if (!w.performance.now) {
    var t0 = Date.now();
    w.performance.now = function () { return Date.now() - t0; };
  }

  // ---- Promise (mínima, compatível com then/catch/all/resolve/reject) ----
  if (typeof w.Promise !== "function") {
    var P = function (fn) {
      var self = this;
      self._s = 0; self._v = undefined; self._q = [];
      function settle(st, v) {
        if (self._s) return;
        if (st === 1 && v && (typeof v === "object" || typeof v === "function")) {
          var then;
          try { then = v.then; } catch (e) { return settle(2, e); }
          if (typeof then === "function") {
            var done = false;
            try {
              then.call(v, function (x) { if (!done) { done = true; settle(1, x); } },
                function (x) { if (!done) { done = true; settle(2, x); } });
            } catch (e) { if (!done) { done = true; settle(2, e); } }
            return;
          }
        }
        self._s = st; self._v = v;
        setTimeout(function () { var q = self._q; self._q = []; for (var i = 0; i < q.length; i++) q[i](); }, 0);
      }
      try { fn(function (v) { settle(1, v); }, function (e) { settle(2, e); }); } catch (e) { settle(2, e); }
      self._settle = settle;
    };
    P.prototype.then = function (ok, bad) {
      var self = this;
      return new P(function (res, rej) {
        function run() {
          var cb = self._s === 1 ? ok : bad;
          if (typeof cb !== "function") { (self._s === 1 ? res : rej)(self._v); return; }
          try { res(cb(self._v)); } catch (e) { rej(e); }
        }
        if (self._s) setTimeout(run, 0); else self._q.push(run);
      });
    };
    P.prototype["catch"] = function (bad) { return this.then(null, bad); };
    P.resolve = function (v) { return new P(function (r) { r(v); }); };
    P.reject = function (e) { return new P(function (r, j) { j(e); }); };
    P.all = function (list) {
      return new P(function (res, rej) {
        var out = [], left = list.length;
        if (!left) return res(out);
        list.forEach(function (p, i) {
          P.resolve(p).then(function (v) { out[i] = v; if (--left === 0) res(out); }, rej);
        });
      });
    };
    w.Promise = P;
  }

  // ---- Object.assign / Array.prototype.fill / String trim (usados por bibliotecas) ----
  if (!Object.assign) {
    Object.assign = function (t) {
      for (var i = 1; i < arguments.length; i++) {
        var s = arguments[i];
        if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
      }
      return t;
    };
  }
  if (typeof Uint8Array !== "undefined" && !Uint8Array.prototype.slice) {
    Uint8Array.prototype.slice = function (a, b) { return new Uint8Array(Array.prototype.slice.call(this, a, b)); };
  }

  // ---- Element.closest (página do celular) ----
  if (w.Element && !Element.prototype.closest) {
    Element.prototype.closest = function (sel) {
      var el = this, m = el.matches || el.webkitMatchesSelector || el.msMatchesSelector;
      while (el && el.nodeType === 1) { if (m.call(el, sel)) return el; el = el.parentNode; m = el && (el.matches || el.webkitMatchesSelector); }
      return null;
    };
  }

  // ---- download simples (fetch não existe em navegadores antigos) ----
  w.snesGet = function (url, type) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      if (type) x.responseType = type;           // "arraybuffer" ou "text"
      x.onload = function () {
        if (x.status === 200 || (x.status === 0 && x.response)) resolve(type ? x.response : x.responseText);
        else reject(new Error("HTTP " + x.status));
      };
      x.onerror = function () { reject(new Error("rede")); };
      x.send();
    });
  };

  w.SNES_HAS_WASM = typeof w.WebAssembly === "object" && typeof w.WebAssembly.instantiate === "function";
})(window);
