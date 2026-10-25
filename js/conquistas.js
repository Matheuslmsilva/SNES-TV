/*
 * Conquistas do SNES TV
 *  - gerais: funcionam com os dois emuladores
 *  - de jogo: leem a memória do Super Nintendo (só no emulador "TV antiga")
 * Endereços: SMW Central (RAM map), Data Crystal (Super Mario Kart), documentação do
 * save do Super Metroid e códigos conhecidos do Zelda: A Link to the Past.
 */
(function () {
  "use strict";

  // ---------- jogos reconhecidos pelo nome gravado no cartucho ----------
  var GAMES = {
    smw:   { name: "Super Mario World", match: /SUPER\s*MARIO\s*WORLD/ },
    alttp: { name: "Zelda: A Link to the Past", match: /LEGEND OF ZELDA|ZELDA\s*NO\s*DENSETSU/ },
    sm:    { name: "Super Metroid", match: /SUPER\s*METROID/ },
    smk:   { name: "Super Mario Kart", match: /SUPER\s*MARIO\s*KART/ }
  };

  // ---------- portões: só conta quando o jogo está de fato sendo jogado ----------
  var GATES = {
    // $7E0100 = modo do jogo (0x0E mapa, 0x14 dentro da fase). A demonstração da tela de título usa 0x07.
    smwLevel: function (m) { return m.u8(0x7E0100) === 0x14; },
    smwGame:  function (m) { var g = m.u8(0x7E0100); return g === 0x0E || g === 0x14; },
    // $7E0010 = módulo (0x07 masmorra, 0x09 mundo). Corações máximos entre 3 e 20.
    alttp: function (m) { var mod = m.u8(0x7E0010), h = m.u8(0x7EF36C); return (mod === 0x07 || mod === 0x09) && h >= 0x18 && h <= 0xA0; },
    // tempo de jogo do save ($09DE minutos, $09E0 horas) > 0 e energia máxima válida — exclui as demonstrações
    sm: function (m) {
      var mx = m.u16(0x7E09C4), mins = m.u16(0x7E09E0) * 60 + m.u16(0x7E09DE);
      return mins >= 1 && mx >= 99 && mx <= 1499 && m.u16(0x7E09C2) <= mx;
    },
    // $7E10C1 = volta atual (127 = largada ... 133 = terminou)
    smk: function (m) { var l = m.u8(0x7E10C1); return l >= 127 && l <= 133; }
  };

  function bit(m, addr, mask) { return (m.u8(addr) & mask) === mask; }

  var DEFS = [
    // ===== gerais =====
    { id: "gen_first", g: "gen", t: "Aperte Start", d: "Abra o seu primeiro jogo" },
    { id: "gen_10games", g: "gen", t: "Colecionador", d: "Jogue 10 jogos diferentes" },
    { id: "gen_1h", g: "gen", t: "Maratona", d: "Jogue 1 hora no total" },
    { id: "gen_5h", g: "gen", t: "Viciado em SNES", d: "Jogue 5 horas no total" },
    { id: "gen_night", g: "gen", t: "Coruja", d: "Jogue entre meia-noite e 5 da manhã" },
    { id: "gen_phone", g: "gen", t: "Controle de bolso", d: "Jogue usando o celular como controle" },
    { id: "gen_pad", g: "gen", t: "Joystick de verdade", d: "Jogue com um joystick USB ou Bluetooth" },
    { id: "gen_coop", g: "gen", t: "Dupla dinâmica", d: "Jogue com o jogador 2" },
    { id: "gen_crt", g: "gen", t: "Nostalgia", d: "Jogue 10 minutos com o filtro de TV de tubo" },
    { id: "gen_save", g: "gen", t: "Ponto de controle", d: "Salve um estado pelo menu" },
    { id: "gen_send", g: "gen", t: "Carteiro", d: "Mande um jogo do celular para a TV" },

    // ===== Super Mario World =====
    { id: "smw_big", g: "smw", t: "Cresceu!", d: "Pegue um cogumelo", gate: "smwLevel", test: function (m) { return m.u8(0x7E0019) === 1; } },
    { id: "smw_cape", g: "smw", t: "Asas da capa", d: "Pegue a pena e vire Mario de capa", gate: "smwLevel", test: function (m) { return m.u8(0x7E0019) === 2; } },
    { id: "smw_fire", g: "smw", t: "Flor de fogo", d: "Pegue uma flor de fogo", gate: "smwLevel", test: function (m) { return m.u8(0x7E0019) === 3; } },
    { id: "smw_yoshi", g: "smw", t: "Amigo dinossauro", d: "Monte no Yoshi", gate: "smwLevel", test: function (m) { var y = m.u8(0x7E187A); return y === 1 || y === 2; } },
    { id: "smw_star", g: "smw", t: "Invencível", d: "Pegue uma estrela", gate: "smwLevel", test: function (m) { return m.u8(0x7E1490) > 0; } },
    { id: "smw_coins", g: "smw", t: "Cofrinho", d: "Junte 50 moedas", gate: "smwLevel", test: function (m) { return m.u8(0x7E0DBF) >= 50 && m.u8(0x7E0DBF) <= 99; } },
    { id: "smw_lives10", g: "smw", t: "Dez vidas", d: "Tenha 10 vidas", gate: "smwGame", test: function (m) { var v = m.u8(0x7E0DBE); return v >= 9 && v <= 98; } },
    { id: "smw_lives99", g: "smw", t: "Vida infinita", d: "Chegue a 99 vidas", gate: "smwGame", test: function (m) { return m.u8(0x7E0DBE) === 98; } },
    { id: "smw_exit10", g: "smw", t: "Explorador", d: "Complete 10 saídas", gate: "smwGame", test: function (m) { var e = m.u8(0x7E1F2E); return e >= 10 && e <= 96; } },
    { id: "smw_exit50", g: "smw", t: "Aventureiro", d: "Complete 50 saídas", gate: "smwGame", test: function (m) { var e = m.u8(0x7E1F2E); return e >= 50 && e <= 96; } },
    { id: "smw_exit96", g: "smw", t: "Mestre da Ilha dos Dinossauros", d: "Complete as 96 saídas", gate: "smwGame", test: function (m) { return m.u8(0x7E1F2E) === 96; } },
    { id: "smw_switch", g: "smw", t: "Palácio do interruptor", d: "Aperte um botão de palácio", gate: "smwGame", test: function (m) { for (var i = 0; i < 4; i++) if (m.u8(0x7E1F27 + i) === 1) return true; return false; } },
    { id: "smw_switch4", g: "smw", t: "Todas as cores", d: "Aperte os 4 palácios", gate: "smwGame", test: function (m) { for (var i = 0; i < 4; i++) if (m.u8(0x7E1F27 + i) !== 1) return false; return true; } },
    { id: "smw_end", g: "smw", t: "Salvou a princesa", d: "Derrote o Bowser e veja o final", test: function (m) { var g = m.u8(0x7E0100); return g >= 0x18 && g <= 0x29 && m.u8(0x7E13C6) === 8; } },

    // ===== Zelda: A Link to the Past =====
    { id: "z_sword", g: "alttp", t: "Herança do tio", d: "Pegue a primeira espada", gate: "alttp", test: function (m) { var s = m.u8(0x7EF359); return s >= 1 && s <= 4; } },
    { id: "z_master", g: "alttp", t: "A espada lendária", d: "Pegue a Master Sword", gate: "alttp", test: function (m) { var s = m.u8(0x7EF359); return s >= 2 && s <= 4; } },
    { id: "z_gold", g: "alttp", t: "Espada dourada", d: "Pegue a espada dourada", gate: "alttp", test: function (m) { return m.u8(0x7EF359) === 4; } },
    { id: "z_boots", g: "alttp", t: "Corrida de Pégaso", d: "Pegue as Botas de Pégaso", gate: "alttp", test: function (m) { return m.u8(0x7EF355) === 1; } },
    { id: "z_pearl", g: "alttp", t: "Pérola da Lua", d: "Pegue a Pérola da Lua", gate: "alttp", test: function (m) { return m.u8(0x7EF357) === 1; } },
    { id: "z_mirror", g: "alttp", t: "Escudo espelhado", d: "Pegue o escudo espelhado", gate: "alttp", test: function (m) { return m.u8(0x7EF35A) === 3; } },
    { id: "z_pendants", g: "alttp", t: "Três pingentes", d: "Junte os 3 pingentes", gate: "alttp", test: function (m) { return bit(m, 0x7EF374, 0x07); } },
    { id: "z_crystals", g: "alttp", t: "Sete cristais", d: "Resgate as 7 donzelas", gate: "alttp", test: function (m) { return bit(m, 0x7EF37A, 0x7F); } },
    { id: "z_hearts10", g: "alttp", t: "Coração valente", d: "Tenha 10 corações", gate: "alttp", test: function (m) { return m.u8(0x7EF36C) >= 0x50; } },
    { id: "z_hearts20", g: "alttp", t: "Coração de herói", d: "Tenha 20 corações", gate: "alttp", test: function (m) { return m.u8(0x7EF36C) === 0xA0; } },
    { id: "z_rupees", g: "alttp", t: "Bolso cheio", d: "Junte 500 rupias", gate: "alttp", test: function (m) { var r = m.u16(0x7EF360); return r >= 500 && r <= 999; } },

    // ===== Super Metroid =====
    { id: "sm_morph", g: "sm", t: "Bola Morph", d: "Pegue a Morph Ball", gate: "sm", test: function (m) { return (m.u16(0x7E09A4) & 0x0004) !== 0; } },
    { id: "sm_varia", g: "sm", t: "Traje Varia", d: "Pegue o Varia Suit", gate: "sm", test: function (m) { return (m.u16(0x7E09A4) & 0x0001) !== 0; } },
    { id: "sm_speed", g: "sm", t: "Velocista", d: "Pegue o Speed Booster", gate: "sm", test: function (m) { return (m.u16(0x7E09A4) & 0x2000) !== 0; } },
    { id: "sm_gravity", g: "sm", t: "Gravidade zero", d: "Pegue o Gravity Suit", gate: "sm", test: function (m) { return (m.u16(0x7E09A4) & 0x0020) !== 0; } },
    { id: "sm_space", g: "sm", t: "Pulo espacial", d: "Pegue o Space Jump", gate: "sm", test: function (m) { return (m.u16(0x7E09A4) & 0x0200) !== 0; } },
    { id: "sm_screw", g: "sm", t: "Ataque giratório", d: "Pegue o Screw Attack", gate: "sm", test: function (m) { return (m.u16(0x7E09A4) & 0x0008) !== 0; } },
    { id: "sm_kraid", g: "sm", t: "Gigante caído", d: "Derrote o Kraid", gate: "sm", test: function (m) { return (m.u8(0x7ED829) & 1) !== 0; } },
    { id: "sm_ridley", g: "sm", t: "Asas cortadas", d: "Derrote o Ridley", gate: "sm", test: function (m) { return (m.u8(0x7ED82A) & 1) !== 0; } },
    { id: "sm_bosses", g: "sm", t: "Os quatro guardiões", d: "Derrote Kraid, Phantoon, Draygon e Ridley", gate: "sm", test: function (m) {
      return (m.u8(0x7ED829) & 1) && (m.u8(0x7ED82A) & 1) && (m.u8(0x7ED82B) & 1) && (m.u8(0x7ED82C) & 1) ? true : false; } },
    { id: "sm_tanks", g: "sm", t: "Reservatório", d: "Tenha 5 tanques de energia", gate: "sm", test: function (m) { return m.u16(0x7E09C4) >= 599; } },
    { id: "sm_missiles", g: "sm", t: "Arsenal", d: "Carregue 100 mísseis", gate: "sm", test: function (m) { var x = m.u16(0x7E09C8); return x >= 100 && x <= 230; } },

    // ===== Super Mario Kart =====
    { id: "smk_finish", g: "smk", t: "Bandeira quadriculada", d: "Termine uma corrida", gate: "smk", test: function (m) { return m.u8(0x7E10C1) === 133; } },
    { id: "smk_lastlap", g: "smk", t: "Última volta", d: "Chegue à quinta volta", gate: "smk", test: function (m) { var l = m.u8(0x7E10F9); return l >= 131 && l <= 133; } },
    { id: "smk_coins", g: "smk", t: "Moedeiro", d: "Tenha 10 moedas numa corrida", gate: "smk", test: function (m) { return m.u8(0x7E0E00) === 10; } },
    { id: "smk_boost", g: "smk", t: "Cogumelo turbo", d: "Use um cogumelo", gate: "smk", test: function (m) { return m.u8(0x7E104E) === 58; } },
    { id: "smk_lava", g: "smk", t: "Banho de lava", d: "Caia na lava (acontece com todo mundo)", gate: "smk", test: function (m) { return m.u8(0x7E10A0) === 6; } }
  ];

  var GROUP_NAMES = { gen: "Gerais" };
  Object.keys(GAMES).forEach(function (k) { GROUP_NAMES[k] = GAMES[k].name; });

  // ---------- armazenamento ----------
  function load(key, def) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  var unlocked = load("snestv.ach", {});
  var stats = load("snestv.stats", { playSec: 0, crtSec: 0, games: {} });

  var C = {
    defs: DEFS, games: GAMES, groups: GROUP_NAMES,
    game: null,           // jogo atual reconhecido (smw, alttp...)
    onUnlock: null,       // function(def)
    lastInput: 0,
    hits: {},

    isUnlocked: function (id) { return !!unlocked[id]; },
    count: function () { return Object.keys(unlocked).filter(function (k) { return C.byId(k); }).length; },
    total: function () { return DEFS.length; },
    byId: function (id) { for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i]; return null; },

    unlock: function (id) {
      if (unlocked[id]) return;
      var d = C.byId(id); if (!d) return;
      unlocked[id] = Date.now();
      save("snestv.ach", unlocked);
      if (C.onUnlock) C.onUnlock(d);
    },

    // nome gravado no cabeçalho do cartucho (LoROM em 0x7FC0, HiROM em 0xFFC0)
    detect: function (rom) {
      C.game = null;
      if (!rom || !rom.length) return null;
      var base = rom.length % 1024 === 512 ? 512 : 0, best = "";
      [0x7FC0, 0xFFC0, 0x40FFC0].forEach(function (off) {
        var o = base + off;
        if (o + 32 > rom.length) return;
        var comp = rom[o + 0x1C] | (rom[o + 0x1D] << 8), sum = rom[o + 0x1E] | (rom[o + 0x1F] << 8);
        var title = "";
        for (var i = 0; i < 21; i++) { var c = rom[o + i]; title += c >= 32 && c < 127 ? String.fromCharCode(c) : " "; }
        if (((comp ^ sum) & 0xFFFF) === 0xFFFF || !best) best = title.toUpperCase();
      });
      Object.keys(GAMES).forEach(function (k) { if (GAMES[k].match.test(best)) C.game = k; });
      return C.game;
    },

    gameStarted: function (key) {
      C.unlock("gen_first");
      stats.games[key] = 1;
      if (Object.keys(stats.games).length >= 10) C.unlock("gen_10games");
      save("snestv.stats", stats);
      C.hits = {};
      C.started = Date.now();
    },

    input: function () { C.lastInput = Date.now(); },

    // chamado ~2x por segundo durante o jogo
    tick: function (sec, ctx) {
      stats.playSec += sec;
      if (ctx.crt) stats.crtSec += sec;
      if (stats.playSec >= 3600) C.unlock("gen_1h");
      if (stats.playSec >= 5 * 3600) C.unlock("gen_5h");
      if (stats.crtSec >= 600) C.unlock("gen_crt");
      var h = new Date().getHours();
      if (h >= 0 && h < 5) C.unlock("gen_night");
      if (ctx.phones) C.unlock("gen_phone");
      if (ctx.pads) C.unlock("gen_pad");
      if (ctx.coop) C.unlock("gen_coop");
      if (Math.random() < 0.1) save("snestv.stats", stats);

      // conquistas de jogo: precisa de memória, de alguém jogando de verdade e de 8 s de jogo
      var m = ctx.mem;
      if (!m || !C.game || Date.now() - C.started < 8000 || Date.now() - C.lastInput > 90000) return;
      for (var i = 0; i < DEFS.length; i++) {
        var d = DEFS[i];
        if (d.g !== C.game || unlocked[d.id] || !d.test) continue;
        var ok = false;
        try { ok = (!d.gate || GATES[d.gate](m)) && d.test(m); } catch (e) { ok = false; }
        // precisa valer em 2 verificações seguidas (evita falsos positivos)
        C.hits[d.id] = ok ? (C.hits[d.id] || 0) + 1 : 0;
        if (C.hits[d.id] >= 2) C.unlock(d.id);
      }
    },

    flush: function () { save("snestv.stats", stats); }
  };

  window.Conquistas = C;
})();
