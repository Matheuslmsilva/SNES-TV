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
    this.rom = u8;

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
    var ptr = M._s_video(), buf = M.HEAPU8.buffer, len = w * h * 4;
    if (this.vBuf !== buf || this.vPtr !== ptr || this.vLen !== len) {
      this.vView = new Uint8ClampedArray(buf, ptr, len);
      this.vBuf = buf; this.vPtr = ptr; this.vLen = len;
    }
    this.img.data.set(this.vView);
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
    var abuf = M.HEAP16.buffer, aptr = M._s_audio();
    if (this.aBuf !== abuf || this.aPtr !== aptr) { this.aView = new Int16Array(abuf, aptr, 8192 * 2); this.aBuf = abuf; this.aPtr = aptr; }
    var src = this.aView;
    var dev = (this.rFill - this.target) / this.target;           // -1 .. +n
    if (dev > 1) dev = 1; if (dev < -1) dev = -1;
    var step = this.step * (1 + 0.005 * dev), pos = this.frac, max = this.rSize - 1;
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
    var M = this.M, frameMs = 1000 / this.fps;
    var occ = this.ring ? Math.min(100, Math.round(this.rFill / this.target * 50)) : 50;

    // mede a frequência real da tela (média móvel)
    this.avg = this.avg ? this.avg * 0.95 + dt * 0.05 : dt;
    var hz = 1000 / this.avg;
    var vsync = Math.abs(hz - this.fps) < 1.5;    // tela a ~60 Hz: 1 quadro por atualização

    var n;
    if (this.turbo) {
      n = 3;
    } else if (vsync) {
      // quadros que a tela perdeu desde a última atualização (normalmente 1)
      n = Math.round(dt / (1000 / hz));
      if (n < 1) n = 1; if (n > 4) n = 4;
      this.acc = 0;
    } else {
      this.acc += dt;
      n = Math.floor(this.acc / frameMs);
      if (n > 4) { n = 4; this.acc = 0; } else this.acc -= n * frameMs;
    }

    var drew = false;
    for (var i = 0; i < n; i++) {
      // só desenha o último quadro; os de recuperação pulam o desenho
      var skip = i < n - 1;
      M._s_run(occ, skip ? 1 : 0);
      this.frames++;
      if (M._s_video_new()) drew = true;
      this.pushAudio();
    }
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

  // leitura da memória do SNES (endereços $7E0000-$7FFFFF) — usada pelas conquistas
  LiteSNES.prototype.mem = function () {
    var M = this.M; if (!M || !M._s_ram) return null;
    var ptr = M._s_ram(), buf = M.HEAPU8.buffer;
    if (!ptr) return null;
    if (this.rBuf !== buf || this.rPtr !== ptr) { this.rView = new Uint8Array(buf, ptr, 0x20000); this.rBuf = buf; this.rPtr = ptr; }
    var r = this.rView;
    if (!this.memApi) this.memApi = {
      u8: function (a) { return r[(a - 0x7E0000) & 0x1FFFF]; },
      u16: function (a) { var o = (a - 0x7E0000) & 0x1FFFF; return r[o] | (r[(o + 1) & 0x1FFFF] << 8); }
    };
    // atualiza a referência caso a memória tenha crescido
    var self = this;
    this.memApi.u8 = function (a) { return self.rView[(a - 0x7E0000) & 0x1FFFF]; };
    this.memApi.u16 = function (a) { var o = (a - 0x7E0000) & 0x1FFFF; return self.rView[o] | (self.rView[(o + 1) & 0x1FFFF] << 8); };
    return this.memApi;
  };

  LiteSNES.prototype.stop = function () {
    this.stopped = true;
    clearInterval(this.sramTimer);
    try { if (this.actx) this.actx.close(); } catch (e) {}
  };

  window.LiteSNES = LiteSNES;
})();
