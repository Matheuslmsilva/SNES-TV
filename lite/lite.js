/*
 * Motor "TV antiga": Snes9x 2005 (CATSFC) compilado para WebAssembly,
 * com uma ponte mínima: canvas 2D, Web Audio e pulo de quadros automático.
 */
(function () {
  "use strict";

  var ROM_IN_ZIP = /\.(sfc|smc|swc|fig)$/i;

  function unzipRom(bytes) {
    var files = fflate.unzipSync(bytes, { filter: function (f) { return ROM_IN_ZIP.test(f.name); } });
    var names = Object.keys(files);
    if (!names.length) throw new Error("O .zip não tem nenhum jogo de SNES");
    return files[names[0]];
  }

  function LiteSNES(opts) {
    this.opts = opts;
    this.paused = false;
    this.turbo = false;
    this.frames = 0;
    this.pads = [0, 0, 0, 0];
    this.started = false;
  }

  LiteSNES.prototype.start = function (romBytes) {
    var self = this, o = this.opts;
    var u8 = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes);
    if (u8[0] === 0x50 && u8[1] === 0x4b) u8 = unzipRom(u8);   // "PK" = zip

    return Snes2005().then(function (M) {
      self.M = M;
      M._s_init(o.frameskip === false ? 0 : 1);
      var p = M._malloc(u8.length);
      M.HEAPU8.set(u8, p);
      var ok = M._s_load(p, u8.length);
      M._free(p);
      if (!ok) throw new Error("O emulador não reconheceu o jogo");

      self.fps = M._s_fps() || 60.0988;
      self.rate = M._s_rate() || 32040;
      self.setupVideo();
      self.setupAudio();
      return o.loadSram ? o.loadSram() : null;
    }).then(function (sram) {
      if (sram && sram.length) self.writeSram(sram);
      self.lastSram = self.sramHash();
      self.started = true;
      self.last = performance.now();
      self.acc = 0;
      self.loop = self.loop.bind(self);
      requestAnimationFrame(self.loop);
      self.sramTimer = setInterval(function () { self.saveSram(); }, 3000);
      return self;
    });
  };

  // ---------------- vídeo ----------------
  LiteSNES.prototype.setupVideo = function () {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 224;
    c.className = "lite-canvas";
    this.opts.container.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext("2d", { alpha: false });
    this.img = null;
  };

  LiteSNES.prototype.draw = function () {
    var M = this.M, w = M._s_video_w(), h = M._s_video_h();
    if (this.canvas.width !== w || this.canvas.height !== h || !this.img) {
      this.canvas.width = w; this.canvas.height = h;
      this.img = this.ctx.createImageData(w, h);
    }
    var ptr = M._s_video();
    this.img.data.set(new Uint8ClampedArray(M.HEAPU8.buffer, ptr, w * h * 4));
    this.ctx.putImageData(this.img, 0, 0);
    this.drawn = (this.drawn || 0) + 1;
  };

  // ---------------- áudio ----------------
  LiteSNES.prototype.setupAudio = function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    this.ring = null;
    if (!AC) return;
    try {
      var ctx = new AC();
      this.actx = ctx;
      var size = 16384;                       // quadros estéreo (~0,34 s a 48 kHz)
      this.ring = new Float32Array(size * 2);
      this.rSize = size; this.rRead = 0; this.rWrite = 0; this.rFill = 0;
      this.target = Math.round(ctx.sampleRate * 0.08);   // ~80 ms de folga
      this.step = this.rate / ctx.sampleRate;
      this.frac = 0;
      var self = this;
      var node = (ctx.createScriptProcessor || ctx.createJavaScriptNode).call(ctx, 2048, 0, 2);
      node.onaudioprocess = function (e) {
        var L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1), n = L.length;
        for (var i = 0; i < n; i++) {
          if (self.rFill > 0 && !self.paused) {
            L[i] = self.ring[self.rRead * 2]; R[i] = self.ring[self.rRead * 2 + 1];
            self.rRead = (self.rRead + 1) % self.rSize; self.rFill--;
          } else { L[i] = 0; R[i] = 0; }
        }
      };
      node.connect(ctx.destination);
      this.node = node;
      var resume = function () { if (ctx.state === "suspended") ctx.resume(); };
      resume();
      window.addEventListener("keydown", resume, true);
    } catch (e) { this.ring = null; }
  };

  LiteSNES.prototype.pushAudio = function () {
    if (!this.ring || this.turbo) return;
    var M = this.M, n = M._s_audio_count();
    if (!n) return;
    var src = new Int16Array(M.HEAP16.buffer, M._s_audio(), n * 2);
    var step = this.step, pos = this.frac, max = this.rSize - 1;
    while (pos < n - 1) {
      var i = pos | 0, f = pos - i;
      var l = src[i * 2] + (src[i * 2 + 2] - src[i * 2]) * f;
      var r = src[i * 2 + 1] + (src[i * 2 + 3] - src[i * 2 + 1]) * f;
      if (this.rFill < max) {
        this.ring[this.rWrite * 2] = l / 32768; this.ring[this.rWrite * 2 + 1] = r / 32768;
        this.rWrite = (this.rWrite + 1) % this.rSize; this.rFill++;
      }
      pos += step;
    }
    this.frac = pos - (n - 1);
    // se acumulou atraso demais, descarta o excesso (mantém o som em sincronia)
    var limit = this.target * 3;
    if (this.rFill > limit) {
      var drop = this.rFill - this.target;
      this.rRead = (this.rRead + drop) % this.rSize; this.rFill -= drop;
    }
  };

  // ---------------- laço principal ----------------
  LiteSNES.prototype.loop = function (now) {
    if (this.stopped) return;
    requestAnimationFrame(this.loop);
    var dt = now - this.last; this.last = now;
    if (this.paused || !this.started) return;
    if (dt > 250) dt = 250;
    var frameMs = 1000 / this.fps / (this.turbo ? 3 : 1);
    this.acc += dt;
    var ran = 0, maxRun = this.turbo ? 6 : 4, M = this.M;
    var occ = this.ring ? Math.min(100, Math.round(this.rFill / this.target * 50)) : 50;
    var drew = false;
    while (this.acc >= frameMs && ran < maxRun) {
      // atrasado (mais de 1 quadro na fila) → o núcleo pula o desenho deste quadro
      var behind = this.acc >= frameMs * 2 || (this.ring && this.rFill < this.target / 3);
      M._s_run(occ, behind ? 1 : 0);
      this.frames++;
      if (M._s_video_new()) drew = true;
      this.pushAudio();
      this.acc -= frameMs;
      ran++;
    }
    if (ran === maxRun) this.acc = 0;     // não dá para alcançar: desacelera em vez de travar
    if (drew) this.draw();
  };

  // ---------------- controles ----------------
  LiteSNES.prototype.press = function (port, btn, down) {
    if (btn === 27) { this.turbo = !!down; return; }
    if (btn < 0 || btn > 11 || port > 3) return;
    var m = this.pads[port];
    m = down ? (m | (1 << btn)) : (m & ~(1 << btn));
    this.pads[port] = m;
    if (this.M) this.M._s_set_pad(port, m);
  };

  LiteSNES.prototype.setTurbo = function (on) { this.turbo = !!on; };
  LiteSNES.prototype.pause = function () { this.paused = true; };
  LiteSNES.prototype.play = function () { this.paused = false; this.last = performance.now(); this.acc = 0; };
  LiteSNES.prototype.reset = function () { if (this.M) this.M._s_reset(); };

  // ---------------- saves ----------------
  LiteSNES.prototype.sramView = function () {
    var M = this.M, size = M._s_sram_size(), ptr = M._s_sram();
    if (!size || !ptr) return null;
    return new Uint8Array(M.HEAPU8.buffer, ptr, size);
  };
  LiteSNES.prototype.writeSram = function (data) {
    var v = this.sramView();
    if (v) v.set(data.subarray ? data.subarray(0, v.length) : new Uint8Array(data).subarray(0, v.length));
  };
  LiteSNES.prototype.sramHash = function () {
    var v = this.sramView(), h = 0;
    if (!v) return 0;
    for (var i = 0; i < v.length; i++) h = (h * 31 + v[i]) | 0;
    return h;
  };
  LiteSNES.prototype.saveSram = function () {
    if (!this.M || !this.opts.saveSram) return Promise.resolve();
    var h = this.sramHash();
    if (h === this.lastSram) return Promise.resolve();
    this.lastSram = h;
    var v = this.sramView();
    return v ? this.opts.saveSram(new Uint8Array(v)) : Promise.resolve();
  };

  LiteSNES.prototype.getState = function () {
    var M = this.M, size = M._s_state_size(), p = M._malloc(size);
    var ok = M._s_state_save(p, size);
    var out = ok ? new Uint8Array(M.HEAPU8.buffer, p, size).slice() : null;
    M._free(p);
    if (!out) throw new Error("falha ao salvar estado");
    return out;
  };
  LiteSNES.prototype.loadState = function (data) {
    var M = this.M, p = M._malloc(data.length);
    M.HEAPU8.set(data, p);
    var ok = M._s_state_load(p, data.length);
    M._free(p);
    return !!ok;
  };

  LiteSNES.prototype.stop = function () {
    this.stopped = true;
    clearInterval(this.sramTimer);
    try { if (this.actx) this.actx.close(); } catch (e) {}
  };

  window.LiteSNES = LiteSNES;
})();
