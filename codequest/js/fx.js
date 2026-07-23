/* ============================================================
   fx.js — animated cinematic backdrop
   ------------------------------------------------------------
   One living scene per act, drawn full-screen behind the UI:
   parallax silhouettes, weather, a marching army, and the
   seal-keeper rising on the horizon while its chapter plays.

   Public API (unchanged for game.js):
     FX.init(canvas)      FX.setHue(c)     FX.setScene(n)
     FX.shake()           FX.burst(el)     FX.reduced()
     FX.setArmy(b)        FX.setFoe(b)     FX.bolt()
   No assets, no dependencies.
   ============================================================ */
(function (global) {
  'use strict';

  var cvs, ctx;
  var W = 0, H = 0, HORIZON = 0, DPR = 1;
  var reduced = global.matchMedia &&
                global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var scene = 0;                 // 0 = title, 1..3 = acts
  var hue = '#5ad1c8';
  var parts = [], stars = [], shards = [], puffs = [], ridges = {};
  var armyOn = false, armyFade = 0;
  var foeOn = false, foeFade = 0;
  var boltAt = -1e9, boltX = 0.5, boltSeed = 1;
  var px = 0, py = 0, tx = 0, ty = 0;
  var start = 0, last = 0, raf = null;

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------- deterministic rng so silhouettes hold still ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var prng = rng(1337);

  /* ---------- ridge generator: smooth hills or jagged peaks ---------- */
  function makeRidge(seed, base, amp, octaves, sharp) {
    var r = rng(seed), terms = [], i;
    for (i = 0; i < octaves; i++) {
      terms.push({ f: (i + 1) * (0.8 + r() * 1.4), a: amp / (i + 1), p: r() * Math.PI * 2 });
    }
    return function (u) {
      var y = 0;
      for (var k = 0; k < terms.length; k++) {
        var s = Math.sin(u * terms[k].f * Math.PI * 2 + terms[k].p);
        y += sharp ? -Math.abs(s) * terms[k].a : s * terms[k].a;
      }
      return base + y;
    };
  }

  function fillRidge(fn, color, shiftX, shiftY) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var x = 0; x <= W; x += 6) ctx.lineTo(x, fn((x + shiftX) / W) + shiftY);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function skyGradient(stops) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function glowBall(x, y, rad, inner, outer) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  /* ---------- particles ---------- */
  function mkPart(type, r) {
    if (type === 'rain') {
      return { x: r() * W * 1.2 - W * 0.1, y: r() * H, v: 9 + r() * 11,
               len: 9 + r() * 18, a: 0.10 + r() * 0.22 };
    }
    if (type === 'ember') {
      return { x: r() * W, y: HORIZON + r() * (H - HORIZON) * 0.7, v: 0.4 + r() * 1.5,
               sz: 0.7 + r() * 2.1, a: 0.25 + r() * 0.6, sw: r() * 6.283, swv: 0.006 + r() * 0.02 };
    }
    if (type === 'snow') {
      return { x: r() * W, y: r() * H, v: 0.25 + r() * 0.8, sz: 0.7 + r() * 2,
               a: 0.2 + r() * 0.5, sw: r() * 6.283, swv: 0.004 + r() * 0.012 };
    }
    return { x: r() * W, y: r() * H, v: 0.15 + r() * 0.5, sz: 0.6 + r() * 1.8,
             a: 0.12 + r() * 0.4, sw: r() * 6.283, swv: 0.003 + r() * 0.01 };
  }

  function seedParticles(type) {
    var n = type === 'rain' ? 190 : type === 'ember' ? 145 : type === 'snow' ? 165 : 90;
    var r = rng(4242);
    parts = [];
    parts.type = type;
    for (var i = 0; i < n; i++) parts.push(mkPart(type, r));
  }

  function stepParticles(dt) {
    var type = parts.type, p, i;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (type === 'rain') {
        p.y += p.v * dt; p.x += p.v * 0.34 * dt;
        if (p.y > H) { p.y = -20; p.x = prng() * W * 1.2 - W * 0.1; }
      } else if (type === 'ember') {
        p.y -= p.v * dt; p.sw += p.swv * dt; p.x += Math.sin(p.sw) * 0.5 * dt;
        if (p.y < -10) { p.y = H + 10; p.x = prng() * W; }
      } else if (type === 'snow') {
        p.y += p.v * dt; p.sw += p.swv * dt; p.x += Math.sin(p.sw) * 0.6 * dt;
        if (p.y > H + 6) { p.y = -6; p.x = prng() * W; }
      } else {
        p.y -= p.v * dt; p.sw += p.swv * dt; p.x += Math.sin(p.sw) * 0.35 * dt;
        if (p.y < -8) { p.y = H + 8; p.x = prng() * W; }
      }
    }
  }

  function drawParticles() {
    var type = parts.type, p, i;
    if (type === 'rain') {
      ctx.lineWidth = 1;
      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        ctx.strokeStyle = 'rgba(178,214,255,' + p.a + ')';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * 0.34, p.y + p.len);
        ctx.stroke();
      }
      return;
    }
    var col = type === 'ember' ? '255,168,74' : type === 'snow' ? '206,226,255' : '255,206,138';
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      ctx.fillStyle = 'rgba(' + col + ',' + p.a + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sz, 0, 6.2832);
      ctx.fill();
    }
  }

  /* ---------- shared props ---------- */
  function fogBand(t, y, h, alpha, speed, color) {
    ctx.save();
    ctx.globalAlpha = alpha;
    for (var i = 0; i < 3; i++) {
      var off = ((t * speed + i * W * 0.5) % (W * 1.6)) - W * 0.3;
      var g = ctx.createLinearGradient(off, 0, off + W * 0.9, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(off, y + Math.sin(t * 0.0008 + i) * 8, W * 0.9, h);
    }
    ctx.restore();
  }

  /* your column, marching the horizon */
  function drawArmy(t, baseY, color) {
    if (armyFade <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = armyFade * 0.85;
    ctx.fillStyle = color;
    var n = 20, spacing = W / n, walk = (t * 0.012) % (spacing * 2);
    for (var i = -2; i < n + 2; i++) {
      var x = i * spacing + walk;
      var bob = Math.sin(t * 0.006 + i * 1.7) * 1.8;
      var hgt = 17 + (i % 3) * 3;
      var y = baseY + bob;
      /* every fourth soldier carries a torch — gives the column a pulse */
      if (i % 4 === 0) {
        ctx.save();
        ctx.globalAlpha = armyFade * (0.5 + Math.sin(t * 0.009 + i) * 0.25);
        glowBall(x + 5, y - hgt - 12, 26, 'rgba(255,170,80,0.55)', 'rgba(255,170,80,0)');
        ctx.restore();
      }
      ctx.fillRect(x, y - hgt, 3.2, hgt);
      ctx.beginPath();
      ctx.arc(x + 1.6, y - hgt - 3, 2.6, 0, 6.2832);
      ctx.fill();
      if (i % 2 === 0) ctx.fillRect(x + 5, y - hgt - 12, 1.2, hgt + 12);
    }
    ctx.restore();
  }

  /* the seal-keeper, vast and half-sunk behind the horizon */
  function drawFoe(t, baseY) {
    if (foeFade <= 0.01) return;
    var rise = (1 - foeFade) * 90;
    var breathe = Math.sin(t * 0.0016) * 8;
    ctx.save();
    ctx.globalAlpha = foeFade;
    ctx.translate(W * 0.5, baseY + rise + breathe);
    var pulse = 0.55 + Math.sin(t * 0.005) * 0.35;

    /* backlight so the mass separates from the night sky */
    glowBall(0, -90, 260, 'rgba(120,150,210,' + (0.13 * foeFade) + ')', 'rgba(120,150,210,0)');

    ctx.beginPath();
    ctx.moveTo(-190, 40); ctx.lineTo(-120, -70); ctx.lineTo(-52, -104);
    ctx.lineTo(-30, -168); ctx.lineTo(30, -168); ctx.lineTo(52, -104);
    ctx.lineTo(120, -70); ctx.lineTo(190, 40);
    ctx.closePath();
    ctx.fillStyle = 'rgba(3,4,9,0.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,235,' + (0.30 * foeFade) + ')';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,120,60,' + pulse * foeFade + ')';
    ctx.beginPath(); ctx.ellipse(-13, -140, 6.5, 2.6, -0.16, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13, -140, 6.5, 2.6, 0.16, 0, 6.2832); ctx.fill();
    glowBall(0, -140, 130, 'rgba(255,110,50,' + 0.10 * pulse * foeFade + ')', 'rgba(255,110,50,0)');
    ctx.restore();
  }

  /* ============ ACT I — the drowned coast ============ */
  function drawAct1(t) {
    skyGradient([[0, '#04060f'], [0.34, '#0a1128'], [0.58, '#16243f'],
                 [0.63, '#24405c'], [1, '#050a14']]);

    var mx = W * 0.74 + px * 6, my = HORIZON - H * 0.34 + py * 4;
    glowBall(mx, my, 190, 'rgba(180,205,235,0.13)', 'rgba(180,205,235,0)');
    ctx.fillStyle = 'rgba(214,229,246,0.5)';
    ctx.beginPath(); ctx.arc(mx, my, 26, 0, 6.2832); ctx.fill();

    /* lightning, occasional and self-triggered */
    var since = t - boltAt;
    if (since < 620) {
      var k = since < 90 ? since / 90 : Math.max(0, 1 - (since - 90) / 530);
      ctx.fillStyle = 'rgba(150,190,240,' + (0.16 * k) + ')';
      ctx.fillRect(0, 0, W, H);
      var br = rng(boltSeed), bx = boltX * W, by = 0;
      ctx.strokeStyle = 'rgba(226,240,255,' + (0.75 * k) + ')';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      while (by < HORIZON - 40) { by += 20 + br() * 34; bx += (br() - 0.5) * 62; ctx.lineTo(bx, by); }
      ctx.stroke();
    } else if (Math.random() < 0.0022) {
      boltAt = t; boltX = 0.15 + Math.random() * 0.7; boltSeed = (Math.random() * 1e6) | 0;
    }

    fillRidge(ridges.far, '#0a1122', px * 10, py * 3);
    drawTowers(t, px * 10);
    drawFoe(t, HORIZON - 4);                       // looms behind the land
    fillRidge(ridges.near, '#060a15', px * 20, py * 5);
    drawArmy(t, HORIZON - 9 + py * 5, '#05070e');  // marches in front of it

    var g = ctx.createLinearGradient(0, HORIZON, 0, H);
    g.addColorStop(0, '#0d1c2e'); g.addColorStop(1, '#03060d');
    ctx.fillStyle = g;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);

    for (var i = 0; i < 26; i++) {
      var f = i / 26;
      var y = HORIZON + Math.pow(f, 1.7) * (H - HORIZON);
      var amp = 1.4 + f * 9;
      ctx.strokeStyle = 'rgba(150,196,236,' + (0.05 + f * 0.13) + ')';
      ctx.lineWidth = 0.8 + f * 1.6;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 14) {
        var yy = y + Math.sin(x * (0.006 + f * 0.004) + t * (0.0012 + f * 0.0018) + i) * amp;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    glowBall(mx, HORIZON + (H - HORIZON) * 0.45, 150, 'rgba(190,215,245,0.10)', 'rgba(190,215,245,0)');

    drawParticles();
    fogBand(t, HORIZON - 34, 70, 0.30, 0.008, 'rgba(150,180,215,0.30)');
  }

  function drawTowers(t, shift) {
    var spec = [[0.13, 96, 26], [0.19, 62, 18], [0.42, 130, 30],
                [0.47, 74, 20], [0.83, 108, 24], [0.9, 58, 16]];
    for (var i = 0; i < spec.length; i++) {
      var x = spec[i][0] * W - shift * 0.6, hgt = spec[i][1], w = spec[i][2];
      var base = ridges.far((spec[i][0] * W) / W);
      ctx.fillStyle = '#070c18';
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - hgt);
      ctx.lineTo(x + w * 0.28, base - hgt + 9);
      ctx.lineTo(x + w * 0.52, base - hgt - 7);
      ctx.lineTo(x + w * 0.76, base - hgt + 5);
      ctx.lineTo(x + w, base - hgt * 0.82);
      ctx.lineTo(x + w, base);
      ctx.closePath();
      ctx.fill();
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,182,96,' + (0.35 + Math.sin(t * 0.004 + i * 2) * 0.2) + ')';
        ctx.fillRect(x + w * 0.4, base - hgt * 0.55, 3, 5);
      }
    }
  }

  /* ============ ACT II — the burning heartland ============ */
  function drawAct2(t) {
    skyGradient([[0, '#0a0407'], [0.3, '#22090c'], [0.52, '#5c1d13'],
                 [0.63, '#b4471a'], [0.68, '#3a1109'], [1, '#0b0405']]);

    var pulse = 0.8 + Math.sin(t * 0.0011) * 0.2;
    glowBall(W * 0.3, HORIZON, W * 0.5 * pulse, 'rgba(255,132,40,0.30)', 'rgba(255,132,40,0)');
    glowBall(W * 0.72, HORIZON + 10, W * 0.42 * pulse, 'rgba(255,90,30,0.26)', 'rgba(255,90,30,0)');

    for (var i = 0; i < puffs.length; i++) {
      var p = puffs[i];
      var y = p.y - ((t * p.sp * 0.05) % (H * 1.2));
      if (y < -p.rad) y += H * 1.2;
      var x = (p.x + Math.sin(t * 0.0004 + i) * 40 + p.drift * t * 0.02) % (W + 300) - 150;
      glowBall(x, y, p.rad, 'rgba(34,20,18,' + p.a + ')', 'rgba(34,20,18,0)');
    }

    fillRidge(ridges.far, 'rgba(74,26,14,0.9)', px * 8, py * 3);
    fillRidge(ridges.mid, '#2a0f0a', px * 16, py * 5);
    drawFoe(t, HORIZON + 18);

    /* the fire line crawling along the near field */
    for (var x2 = 0; x2 <= W; x2 += 11) {
      var by = ridges.near((x2 + px * 26) / W) + py * 7;
      var fl = (Math.sin(x2 * 0.31 + t * 0.011) + Math.sin(x2 * 0.7 + t * 0.017)) * 0.5;
      var hgt = 10 + fl * 5;
      var a = 0.35 + fl * 0.3;
      var g = ctx.createLinearGradient(x2, by - hgt, x2, by);
      g.addColorStop(0, 'rgba(255,206,92,0)');
      g.addColorStop(0.45, 'rgba(255,150,44,' + a + ')');
      g.addColorStop(1, 'rgba(190,50,16,' + a + ')');
      ctx.fillStyle = g;
      ctx.fillRect(x2, by - hgt, 7, hgt);
    }
    fillRidge(ridges.near, '#0d0503', px * 26, py * 7);
    drawArmy(t, HORIZON + 22 + py * 7, '#170806');

    ctx.strokeStyle = 'rgba(8,4,3,0.95)';
    ctx.lineWidth = 1.4;
    var sr = rng(555);
    for (var s = 0; s < 90; s++) {
      var sx = sr() * W, sh = 12 + sr() * 26;
      var sy = ridges.near((sx + px * 26) / W) + py * 7 + sr() * 26;
      var sway = Math.sin(t * 0.003 + sx * 0.02) * 4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + sway * 0.5, sy - sh * 0.6, sx + sway, sy - sh);
      ctx.stroke();
    }

    drawParticles();
    fogBand(t, HORIZON - 20, 90, 0.22, 0.011, 'rgba(120,54,26,0.4)');
  }

  /* ============ ACT III — the obsidian throne ============ */
  function drawAct3(t) {
    skyGradient([[0, '#01010a'], [0.4, '#080a1e'], [0.63, '#121036'],
                 [0.66, '#0a0a1c'], [1, '#020207']]);

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.fillStyle = 'rgba(214,226,255,' + (0.35 + Math.sin(t * 0.0016 + st.tw) * 0.32) + ')';
      ctx.fillRect(st.x + px * 2, st.y + py * 2, st.s, st.s);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var cols = ['rgba(86,255,208,', 'rgba(126,142,255,', 'rgba(214,120,255,'];
    for (var b = 0; b < 3; b++) {
      var g = ctx.createLinearGradient(0, H * 0.05, 0, HORIZON * 0.95);
      g.addColorStop(0, cols[b] + '0)');
      g.addColorStop(0.45, cols[b] + (0.13 - b * 0.02) + ')');
      g.addColorStop(1, cols[b] + '0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 12) {
        var u = x / W;
        var y = H * 0.16 + b * 34 + Math.sin(u * 5.2 + t * 0.00042 + b * 1.9) * 46
                + Math.sin(u * 11.5 + t * 0.00071 + b) * 18;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (var x3 = W; x3 >= 0; x3 -= 12) {
        var u2 = x3 / W;
        var y2 = H * 0.16 + b * 34 + 132 + Math.sin(u2 * 5.2 + t * 0.00042 + b * 1.9) * 46
                 + Math.sin(u2 * 11.5 + t * 0.00071 + b) * 18;
        ctx.lineTo(x3, y2);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    for (var s = 0; s < shards.length; s++) {
      var sh = shards[s];
      sh.rot += sh.spin * 16;
      ctx.save();
      ctx.translate(sh.x + px * 12, sh.y + Math.sin(t * 0.0009 + sh.bob) * 12 + py * 8);
      ctx.rotate(sh.rot);
      ctx.fillStyle = 'rgba(16,16,34,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -sh.sz); ctx.lineTo(sh.sz * 0.5, 0);
      ctx.lineTo(0, sh.sz * 0.8); ctx.lineTo(-sh.sz * 0.45, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(126,190,255,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    fillRidge(ridges.far, '#080a1a', px * 8, py * 3);
    fillRidge(ridges.mid, '#05060f', px * 18, py * 6);
    drawThrone(t);
    drawFoe(t, HORIZON + 46);
    fillRidge(ridges.near, '#010207', px * 30, py * 10);
    drawArmy(t, HORIZON + 56 + py * 10, '#02030a');

    drawParticles();
    fogBand(t, HORIZON + 10, 80, 0.20, 0.006, 'rgba(120,150,220,0.22)');
  }

  function drawThrone(t) {
    var cx = W * 0.5 + px * 18, base = HORIZON + 8 + py * 6;
    ctx.fillStyle = '#03040c';
    ctx.beginPath();
    ctx.moveTo(cx - 120, base); ctx.lineTo(cx - 54, base - 96);
    ctx.lineTo(cx - 26, base - 74); ctx.lineTo(cx - 12, base - 190);
    ctx.lineTo(cx + 6, base - 132); ctx.lineTo(cx + 30, base - 216);
    ctx.lineTo(cx + 52, base - 88); ctx.lineTo(cx + 116, base);
    ctx.closePath();
    ctx.fill();
    var pulse = 0.4 + Math.sin(t * 0.0022) * 0.28;
    glowBall(cx + 30, base - 216, 90, 'rgba(120,190,255,' + (0.20 * pulse) + ')', 'rgba(120,190,255,0)');
    ctx.fillStyle = 'rgba(180,222,255,' + (0.5 + pulse * 0.4) + ')';
    ctx.beginPath(); ctx.arc(cx + 30, base - 216, 3.4, 0, 6.2832); ctx.fill();
  }

  /* ============ TITLE — the forge between worlds ============ */
  function drawTitle(t) {
    skyGradient([[0, '#03040c'], [0.45, '#090c1f'], [0.75, '#140f22'], [1, '#05050c']]);

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.fillStyle = 'rgba(224,214,255,' + (0.25 + Math.sin(t * 0.0014 + st.tw) * 0.28) + ')';
      ctx.fillRect(st.x + px * 3, st.y + py * 3, st.s, st.s);
    }

    var cx = W * 0.5 + px * 8, cy = H * 0.46 + py * 6;
    var R = Math.min(W, H) * 0.34;
    ctx.save();
    ctx.translate(cx, cy);
    glowBall(0, 0, R * 1.5, 'rgba(255,164,70,0.09)', 'rgba(255,164,70,0)');
    ctx.rotate(t * 0.00007);
    ctx.strokeStyle = 'rgba(255,182,96,0.20)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.2832); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, 6.2832); ctx.stroke();
    for (var k = 0; k < 24; k++) {
      var a = (k / 24) * 6.2832;
      ctx.strokeStyle = 'rgba(255,196,120,' + (0.1 + Math.abs(Math.sin(t * 0.0009 + k * 0.7)) * 0.5) + ')';
      ctx.lineWidth = k % 3 === 0 ? 2.4 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.stroke();
    }
    ctx.rotate(-t * 0.00016);
    ctx.strokeStyle = 'rgba(126,190,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.14, 0.6, 3.1); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 1.14, 3.7, 6.0); ctx.stroke();
    ctx.restore();

    fillRidge(ridges.near, '#03040a', px * 24, py * 6);
    drawParticles();
    fogBand(t, H * 0.72, 120, 0.18, 0.006, 'rgba(120,110,170,0.28)');
  }

  /* ---------- build / resize ---------- */
  function buildScene() {
    ridges = {}; stars = []; shards = []; puffs = [];
    var r = rng(7717), i;

    if (scene === 1) {
      ridges.far = makeRidge(11, HORIZON - 26, 16, 3, false);
      ridges.near = makeRidge(23, HORIZON - 6, 9, 4, false);
      seedParticles('rain');
    } else if (scene === 2) {
      ridges.far = makeRidge(31, HORIZON - 40, 26, 3, false);
      ridges.mid = makeRidge(47, HORIZON - 14, 18, 4, false);
      ridges.near = makeRidge(59, HORIZON + 26, 14, 5, false);
      seedParticles('ember');
      for (i = 0; i < 9; i++) {
        puffs.push({ x: r() * W, y: HORIZON - r() * H * 0.25, rad: 60 + r() * 130,
                     sp: 0.12 + r() * 0.3, drift: (r() - 0.5) * 0.25, a: 0.05 + r() * 0.07 });
      }
    } else if (scene === 3) {
      ridges.far = makeRidge(71, HORIZON - 30, 70, 3, true);
      ridges.mid = makeRidge(83, HORIZON + 6, 52, 4, true);
      ridges.near = makeRidge(97, HORIZON + 60, 38, 5, true);
      seedParticles('snow');
      for (i = 0; i < 220; i++) stars.push({ x: r() * W, y: r() * HORIZON * 0.95, s: r() * 1.5 + 0.3, tw: r() * 6.283 });
      for (i = 0; i < 14; i++) {
        shards.push({ x: r() * W, y: r() * H * 0.8, sz: 8 + r() * 26,
                      rot: r() * Math.PI, spin: (r() - 0.5) * 0.0006, bob: r() * 6.283 });
      }
    } else {
      ridges.near = makeRidge(5, H * 0.92, 22, 4, false);
      seedParticles('mote');
      for (i = 0; i < 190; i++) stars.push({ x: r() * W, y: r() * H * 0.85, s: r() * 1.4 + 0.3, tw: r() * 6.283 });
    }
  }

  function resize() {
    DPR = Math.min(global.devicePixelRatio || 1, 2);
    W = cvs.clientWidth; H = cvs.clientHeight;
    cvs.width = Math.floor(W * DPR); cvs.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    HORIZON = Math.round(H * 0.63);
    buildScene();
  }

  /* ---------- loop ---------- */
  function paint(t) {
    if (scene === 1) drawAct1(t);
    else if (scene === 2) drawAct2(t);
    else if (scene === 3) drawAct3(t);
    else drawTitle(t);
  }

  function frame(now) {
    var dt = Math.min((now - last) / 16.667, 3);
    last = now;
    px += (tx - px) * 0.045;
    py += (ty - py) * 0.045;
    armyFade += ((armyOn ? 1 : 0) - armyFade) * 0.03;
    foeFade += ((foeOn ? 1 : 0) - foeFade) * 0.025;
    stepParticles(dt);
    paint(now - start);
    raf = requestAnimationFrame(frame);
  }

  /* ---------- public ---------- */
  var FX = {
    init: function (canvas) {
      cvs = canvas;
      ctx = cvs.getContext('2d', { alpha: false });
      resize();
      global.addEventListener('resize', function () {
        clearTimeout(resize._t);
        resize._t = setTimeout(resize, 120);
      });
      global.addEventListener('pointermove', function (e) {
        tx = (e.clientX / (W || 1) - 0.5) * 2;
        ty = (e.clientY / (H || 1) - 0.5) * 2;
      }, { passive: true });

      start = last = performance.now();
      if (!reduced) raf = requestAnimationFrame(frame);
      else paint(0);                      // one static frame, still a real scene
    },

    /** Switch backdrop: 0 = title, 1..3 = acts. */
    setScene: function (n) {
      n = n | 0;
      if (n === scene) return;
      scene = n;
      buildScene();
      if (reduced) paint(performance.now() - start);
    },

    setArmy: function (on) { armyOn = !!on; if (reduced) armyFade = on ? 1 : 0; },
    setFoe:  function (on) { foeOn  = !!on; if (reduced) foeFade  = on ? 1 : 0; },
    bolt:    function () {
      if (scene !== 1) return;
      boltAt = performance.now() - start;
      boltX = 0.2 + Math.random() * 0.6;
      boltSeed = (Math.random() * 1e6) | 0;
    },

    /** Kept for compatibility — act tint now drives UI chrome, not embers. */
    setHue: function (c) { hue = c; },

    shake: function () {
      if (reduced) return;
      document.body.classList.remove('shake');
      void document.body.offsetWidth;
      document.body.classList.add('shake');
      setTimeout(function () { document.body.classList.remove('shake'); }, 420);
    },

    burst: function (el) {
      if (reduced || !el) return;
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var layer = document.createElement('div');
      layer.className = 'burst-layer';
      for (var i = 0; i < 26; i++) {
        var p = document.createElement('i');
        var ang = (Math.PI * 2 * i) / 26 + rand(-0.2, 0.2);
        var dist = rand(60, 210);
        p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        p.style.setProperty('--d', rand(0, 120) + 'ms');
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        layer.appendChild(p);
      }
      document.body.appendChild(layer);
      setTimeout(function () { layer.remove(); }, 1200);
    },

    reduced: function () { return reduced; }
  };

  global.FX = FX;
})(window);
