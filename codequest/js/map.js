/* ============================================================
   map.js — the war map: a march route with twelve stops,
   banded into three acts (one per training day).
   ============================================================ */
(function (global) {
  'use strict';

  var VB = { w: 1000, h: 560 };

  // Serpentine route: inland and upward, coast (bottom-left) to summit (top-right).
  var NODES = [
    { x: 72,  y: 470 }, { x: 152, y: 388 }, { x: 242, y: 456 }, { x: 332, y: 370 },
    { x: 422, y: 432 }, { x: 508, y: 330 }, { x: 596, y: 396 }, { x: 682, y: 294 },
    { x: 762, y: 352 }, { x: 838, y: 246 }, { x: 902, y: 312 }, { x: 956, y: 178 }
  ];

  var BANDS = [
    { from: 0,  to: 3,  label: 'Act I · The Drowned Coast',  day: 'Day One' },
    { from: 4,  to: 7,  label: 'Act II · The Iron Heartland', day: 'Day Two' },
    { from: 8,  to: 11, label: 'Act III · The Obsidian Throne', day: 'Day Three' }
  ];

  function routePath(pts) {
    // Catmull-Rom through every stop, converted to cubic beziers.
    // Passes exactly through each node without the loops a naive
    // quadratic chain produces.
    if (pts.length < 2) return '';
    var d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || pts[i + 1];
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) +
           ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) +
           ' ' + p2.x + ' ' + p2.y;
    }
    return d;
  }

  var COAST = 'M0 496 Q125 480 250 492 Q375 504 500 496 Q625 488 750 504 Q875 516 1000 500';

  function terrain() {
    return [
      // far mountains (act III sits among these)
      '<path class="m-far" d="M560 560 L640 300 L700 366 L770 250 L830 320 L890 206 L950 288 L1000 214 L1000 560 Z"/>',
      // near ridges
      '<g class="m-ridge">',
      '<path d="M596 372 L654 292 L700 344 L758 262 L812 330 L868 236 L926 300 L980 232"/>',
      '<path d="M286 452 L330 404 L368 442 L410 396 L452 440"/>',
      '</g>',
      // sea + coastline
      '<path class="m-sea" d="' + COAST + ' L1000 560 L0 560 Z"/>',
      '<path class="m-coast" d="' + COAST + '"/>',
      '<g class="m-waves">',
      '<path d="M40 524q20 0 20-7t20-7 20 7 20 7"/>',
      '<path d="M210 540q20 0 20-7t20-7 20 7 20 7"/>',
      '<path d="M430 534q20 0 20-7t20-7 20 7 20 7"/>',
      '<path d="M650 546q20 0 20-7t20-7 20 7 20 7"/>',
      '</g>',
      // forest ticks along the lowlands
      '<g class="m-trees">',
      '<path d="M120 470v-11M136 476v-11M152 468v-11M172 474v-11"/>',
      '<path d="M446 452v-11M462 458v-11M478 450v-11"/>',
      '</g>'
    ].join('');
  }

  /**
   * render(el, state)
   *   state.levels   — CQ.LEVELS
   *   state.cleared  — array of cleared level ids
   *   state.current  — index of the next playable level
   *   state.unlocked — fn(index) -> bool
   *   state.onPick   — fn(index)
   *   state.onHover  — fn(index|null)
   */
  function render(el, state) {
    var levels = state.levels;
    var svg = [];

    svg.push('<svg viewBox="0 0 ' + VB.w + ' ' + VB.h + '" class="m-svg" ' +
             'role="img" aria-label="Campaign map">');

    svg.push('<defs>' +
      '<linearGradient id="mgold" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0%" stop-color="#ffd98a"/><stop offset="100%" stop-color="#d69e2e"/>' +
      '</linearGradient>' +
      '<filter id="mglow" x="-60%" y="-60%" width="220%" height="220%">' +
        '<feGaussianBlur stdDeviation="6" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter></defs>');

    // Act panels sit behind the landscape; their labels go back on top
    // afterwards so the terrain doesn't swallow them.
    BANDS.forEach(function (b, i) {
      var x0 = NODES[b.from].x - 46;
      var x1 = NODES[b.to].x + 46;
      svg.push('<rect class="m-band-rect m-band--' + (i + 1) + '" x="' + x0 + '" y="26" ' +
               'width="' + (x1 - x0) + '" height="' + (VB.h - 60) + '" rx="14"/>');
    });

    svg.push(terrain());

    BANDS.forEach(function (b) {
      var mid = (NODES[b.from].x - 46 + NODES[b.to].x + 46) / 2;
      svg.push('<g class="m-band">');
      svg.push('<text x="' + mid + '" y="52" class="m-band-label">' + b.label + '</text>');
      svg.push('<text x="' + mid + '" y="72" class="m-band-day">' + b.day + '</text>');
      svg.push('</g>');
    });

    // route
    var d = routePath(NODES);
    svg.push('<path class="m-route" d="' + d + '"/>');

    // conquered portion of the route
    var clearedCount = state.cleared.length;
    if (clearedCount > 0) {
      var upto = NODES.slice(0, Math.min(clearedCount + 1, NODES.length));
      if (upto.length > 1) {
        svg.push('<path class="m-route m-route--won" d="' + routePath(upto) + '"/>');
      }
    }

    // stops
    levels.forEach(function (lv, i) {
      var n = NODES[i];
      var done = state.cleared.indexOf(lv.id) !== -1;
      var open = state.unlocked(i);
      var cur = i === state.current;
      var cls = 'm-stop' + (done ? ' is-done' : '') + (cur ? ' is-current' : '') +
                (!open ? ' is-locked' : '');

      svg.push('<g class="' + cls + '" data-i="' + i + '" tabindex="0" role="button" ' +
               'aria-label="' + lv.place + (done ? ', restored' : open ? ', available' : ', locked') + '">');

      if (cur) svg.push('<circle class="m-pulse" cx="' + n.x + '" cy="' + n.y + '" r="20"/>');
      svg.push('<circle class="m-hit" cx="' + n.x + '" cy="' + n.y + '" r="26"/>');
      svg.push('<circle class="m-disc" cx="' + n.x + '" cy="' + n.y + '" r="14"/>');

      if (done) {
        svg.push('<path class="m-tick" d="M' + (n.x - 6) + ' ' + n.y +
                 ' l4 5 l8 -10"/>');
        svg.push('<path class="m-banner" d="M' + (n.x + 11) + ' ' + (n.y - 12) +
                 ' l0 -22 l16 6 l-16 6"/>');
      } else if (!open) {
        svg.push('<rect class="m-lock" x="' + (n.x - 4) + '" y="' + (n.y - 3) +
                 '" width="8" height="7" rx="1.5"/>' +
                 '<path class="m-lock-arc" d="M' + (n.x - 2.5) + ' ' + (n.y - 3) +
                 ' v-2.5 a2.5 2.5 0 0 1 5 0 v2.5"/>');
      } else {
        svg.push('<circle class="m-core" cx="' + n.x + '" cy="' + n.y + '" r="4.5"/>');
      }

      svg.push('<text class="m-label" x="' + n.x + '" y="' + (n.y + 34) + '">' +
               lv.place + '</text>');
      svg.push('</g>');
    });

    svg.push('</svg>');
    el.innerHTML = svg.join('');

    // events
    var stops = el.querySelectorAll('.m-stop');
    Array.prototype.forEach.call(stops, function (g) {
      var i = parseInt(g.getAttribute('data-i'), 10);
      g.addEventListener('click', function () { if (state.unlocked(i)) state.onPick(i); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (state.unlocked(i)) state.onPick(i);
        }
      });
      g.addEventListener('mouseenter', function () { if (state.onHover) state.onHover(i); });
      g.addEventListener('focus', function () { if (state.onHover) state.onHover(i); });
      g.addEventListener('mouseleave', function () { if (state.onHover) state.onHover(null); });
    });
  }

  global.RealmMap = { render: render };
})(window);
