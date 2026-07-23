/* ============================================================
   game.js — screens, story pacing, the idle-check, scoring.
   ============================================================ */
(function (global) {
  'use strict';

  var SAVE_KEY = 'codeconquest.v1';
  var ACT_STARTS = [0, 4, 8];

  // Idle thresholds, in ms. The keeper checks in later each time it is waved off.
  var IDLE_STEPS = [45000, 75000, 100000];

  var LEVELS = global.CQ.LEVELS;
  var ACTS = global.CQ.ACTS;

  var $ = function (id) { return document.getElementById(id); };

  // ---- state ----------------------------------------------------------
  var params = new URLSearchParams(location.search);
  var INSTRUCTOR = params.has('instructor');

  var save = { cleared: [], code: {}, hints: {}, seenActs: [] };
  var cur = 0;              // current level index
  var phase = 'title';
  var editor = null;
  var passed = 0;
  var failStreak = 0;
  var lastActivity = Date.now();
  var idleStep = 0;
  var counselOpen = false;
  var solved = false;
  var pyReady = false;
  var pkgReady = true;      // false while an act's packages are downloading

  // ---- persistence ----------------------------------------------------
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        var v = JSON.parse(raw);
        save.cleared = v.cleared || [];
        save.code = v.code || {};
        save.hints = v.hints || {};
        save.seenActs = v.seenActs || [];
      }
    } catch (_) {}
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
  }

  function isCleared(i) { return save.cleared.indexOf(LEVELS[i].id) !== -1; }
  function hintsTaken(id) { return save.hints[id] || 0; }

  function unlocked(i) {
    if (INSTRUCTOR) return true;
    if (ACT_STARTS.indexOf(i) !== -1) return true;   // each day can start fresh
    return isCleared(i - 1);
  }

  function firstUnfinished() {
    for (var i = 0; i < LEVELS.length; i++) if (!isCleared(i)) return i;
    return LEVELS.length - 1;
  }

  function actOf(i) { return ACTS[LEVELS[i].act - 1]; }

  // ---- small helpers --------------------------------------------------
  function show(id) {
    ['screen-title', 'screen-map', 'screen-chapter', 'screen-end'].forEach(function (s) {
      $(s).classList.toggle('is-active', s === id);
    });
    // Only the chapter screen carries the army and the looming keeper.
    if (id !== 'screen-chapter') {
      global.FX.setArmy(false);
      global.FX.setFoe(false);
      global.World.leave();
    }
    if (id === 'screen-title') global.FX.setScene(0);
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 2600);
  }

  function setActTheme(act) {
    document.documentElement.style.setProperty('--act', act.hue);
    document.documentElement.style.setProperty('--act-deep', act.hue2);
    global.FX.setHue(act.hue);
    global.FX.setScene(act.n);
  }

  var ROMAN = ['I', 'II', 'III'];

  // ---- portraits ------------------------------------------------------
  var VEX_SVG =
    '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" ' +
    'stroke-linejoin="round"><path d="M50 8 L86 40 L72 88 H28 L14 40 Z"/>' +
    '<path d="M30 46 h40" /><circle cx="50" cy="56" r="9" fill="currentColor" stroke="none"/>' +
    '<path d="M50 8 L50 46 M14 40 L30 46 M86 40 L70 46"/></svg>';

  var ORRIN_SVG =
    '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3" ' +
    'stroke-linejoin="round"><path d="M22 66 L30 30 L50 50 L70 30 L78 66 Z"/>' +
    '<path d="M22 76 h56"/><path d="M42 42 v-8 M58 42 v-8"/></svg>';

  function portraitFor(who, level) {
    if (who === 'VEX') return VEX_SVG;
    if (who === 'ORRIN') return ORRIN_SVG;
    if (who === 'KEEPER') return level ? level.sigil : VEX_SVG;
    return '';
  }
  function nameFor(who, level) {
    if (who === 'VEX') return 'Vex';
    if (who === 'ORRIN') return 'Orrin';
    if (who === 'KEEPER') return level ? level.keeper.name : '';
    return '';
  }

  // ============================================================
  //  CINEMA — story beats
  // ============================================================
  var scene = { beats: [], i: 0, typing: false, timer: null, done: null, level: null };

  function playScene(beats, level, onDone) {
    scene.beats = beats;
    scene.i = -1;
    scene.done = onDone;
    scene.level = level;
    $('cinema').classList.add('is-on');
    $('warroom').classList.remove('is-on');
    phase = 'story';
    nextBeat();
  }

  function nextBeat() {
    clearTimeout(scene.timer);
    scene.i++;
    if (scene.i >= scene.beats.length) {
      $('cinema').classList.remove('is-on');
      if (scene.done) scene.done();
      return;
    }
    var b = scene.beats[scene.i];
    var isNarr = b.who === 'NARRATOR';

    $('dialogue').classList.toggle('is-narration', isNarr);
    $('dlg-portrait').innerHTML = isNarr ? '' : portraitFor(b.who, scene.level);
    $('dlg-name').textContent = isNarr ? '' : nameFor(b.who, scene.level);
    $('dlg-next').style.opacity = '0';

    // The hall reacts to whoever is speaking: the keeper's eyes flare,
    // Vex spins up at your shoulder.
    global.World.speak(b.who);

    typeOut(b.text);
  }

  function typeOut(text) {
    var el = $('dlg-text');
    if (global.FX.reduced()) { el.textContent = text; scene.typing = false; $('dlg-next').style.opacity = '1'; return; }
    el.textContent = '';
    scene.typing = true;
    var i = 0;
    (function tick() {
      if (i >= text.length) {
        scene.typing = false;
        $('dlg-next').style.opacity = '1';
        return;
      }
      // Slow down a touch at sentence ends so lines land.
      var ch = text[i++];
      el.textContent += ch;
      var pause = /[.!?]/.test(ch) ? 130 : /[,;—]/.test(ch) ? 60 : 14;
      scene.timer = setTimeout(tick, pause);
    })();
  }

  function advanceScene() {
    if (scene.typing) {                    // first click finishes the line
      clearTimeout(scene.timer);
      scene.typing = false;
      $('dlg-text').textContent = scene.beats[scene.i].text;
      $('dlg-next').style.opacity = '1';
      return;
    }
    nextBeat();
  }

  // ============================================================
  //  MAP
  // ============================================================
  function renderMap(hoverIdx) {
    var idx = (hoverIdx === null || hoverIdx === undefined) ? cur : hoverIdx;
    RealmMap.render($('realm-map'), {
      levels: LEVELS,
      cleared: save.cleared,
      current: cur,
      unlocked: unlocked,
      onPick: function (i) { cur = i; openLevel(i); },
      onHover: function (i) { updateBrief(i === null ? cur : i); }
    });
    $('progress-count').textContent = String(save.cleared.length);
    updateBrief(idx);
  }

  function updateBrief(i) {
    var lv = LEVELS[i];
    var act = actOf(i);
    var done = isCleared(i);
    var open = unlocked(i);

    $('brief-name').textContent = lv.place;
    $('brief-sub').textContent = act.day + ' · Act ' + ROMAN[act.n - 1] + ' · ' + lv.province;
    $('brief-text').innerHTML =
      '<strong>Teaches:</strong> ' + lv.teaches + '<br>' +
      '<strong>Seal-keeper:</strong> ' + lv.keeper.name +
      (done ? '<br><span class="brief-done">✓ Restored</span>' : '') +
      (!open ? '<br><span class="brief-locked">Sealed — finish the previous stop</span>' : '');

    var btn = $('btn-march');
    btn.disabled = !open;
    btn.textContent = done ? 'Return to ' + lv.place : 'March on ' + lv.place;
    btn.onclick = function () { cur = i; openLevel(i); };
    setActTheme(act);
  }

  // ============================================================
  //  LEVEL FLOW
  // ============================================================
  function openLevel(i) {
    cur = i;
    var lv = LEVELS[i];
    var act = actOf(i);
    setActTheme(act);

    $('cin-chapter').textContent = 'Act ' + ROMAN[act.n - 1] + ' · ' + act.name;
    $('cin-place').textContent = lv.place;
    $('cinema-sigil').innerHTML = lv.sigil;
    $('wr-chapter').textContent = 'Act ' + ROMAN[act.n - 1] + ' · ' + lv.place;
    $('wr-place').textContent = lv.keeper.name;

    show('screen-chapter');

    // Walk into this seal's hall. The 2D backdrop steps aside.
    global.World.enter(lv, act.n);
    global.FX.setArmy(false);
    global.FX.setFoe(false);

    // Act openers play once, before the act's first seal.
    var beats = lv.story.slice();
    if (save.seenActs.indexOf(act.n) === -1) {
      beats = act.intro.concat(beats);
      save.seenActs.push(act.n);
      persist();
    }
    playScene(beats, lv, enterPuzzle);
  }

  function enterPuzzle() {
    var lv = LEVELS[cur];
    phase = 'puzzle';
    solved = false;
    passed = 0;
    failStreak = 0;
    idleStep = 0;
    counselOpen = false;
    lastActivity = Date.now();

    $('warroom').classList.add('is-on');
    $('counsel').hidden = true;
    $('paused-note').classList.remove('is-hidden');

    // The story stops here: the hall freezes mid-motion and falls out of
    // focus behind the code. Rendering halts entirely until the seal breaks.
    global.World.pause();

    $('foe-sigil').innerHTML = lv.sigil;
    $('foe-name').textContent = lv.keeper.name;
    $('foe-taunt').textContent = '“' + lv.keeper.taunt + '”';

    $('task-sig').textContent = lv.fn === 'Legion' ? 'class Legion' : 'def ' + lv.fn + '(...)';
    $('task-brief').innerHTML = lv.brief +
      '<p class="brief-bonus"><strong>Banner objective</strong> (optional) — ' + lv.bonus + '</p>';
    $('editor-file').textContent = lv.id + '_' + (lv.fn === 'Legion' ? 'legion' : lv.fn) + '.py';

    editor.set(save.code[lv.id] || lv.starter);
    setHp(0, lv.tests.length);
    $('results').innerHTML = '<li class="res-idle">No trial run yet. Write your answer, then strike the seal.</li>';
    $('run-status').textContent = pyReady ? '' : 'Warming the forge…';

    ensurePackages(lv);

    renderHints();
    editor.focus();
  }

  function setHp(p, total) {
    var pct = total ? Math.round((p / total) * 100) : 0;
    $('hp-fill').style.width = pct + '%';
    $('hp-text').textContent = p + ' / ' + total;
    $('foe').classList.toggle('is-broken', total > 0 && p === total);
  }

  // ============================================================
  //  RUNNING
  // ============================================================

  /**
   * Acts can declare Python packages they need (Act II wants pandas).
   * They are fetched on first entry to that act, never up front — the
   * coast should not cost a student a 20 MB download.
   */
  function ensurePackages(lv) {
    pkgReady = true;
    if (!lv.needs || !lv.needs.length) return;
    if (!global.Runner.isReady()) return;   // boot handler retries this

    pkgReady = false;
    var btn = $('btn-run');
    btn.disabled = true;
    $('run-status').textContent = 'The Compiler is remembering ' + lv.needs.join(', ') + '…';

    global.Runner.load(lv.needs).then(function (r) {
      pkgReady = r.ok;
      btn.disabled = false;
      if (r.ok) {
        $('run-status').textContent = '';
      } else {
        $('run-status').textContent = '';
        toast('Could not load ' + lv.needs.join(', ') + ' — check your connection.');
      }
    });
  }

  function runCode() {
    var lv = LEVELS[cur];
    if (!pyReady) { toast('The interpreter is still loading — one moment.'); return; }
    if (!pkgReady) { toast('Still fetching ' + (lv.needs || []).join(', ') + ' — one moment.'); return; }

    var btn = $('btn-run');
    btn.disabled = true;
    $('run-status').textContent = 'Striking…';
    lastActivity = Date.now();

    var code = editor.get();
    save.code[lv.id] = code;
    persist();

    Runner.run(code, lv.fn, lv.tests).then(function (res) {
      btn.disabled = false;
      $('run-status').textContent = '';
      handleResult(res, lv);
    });
  }

  function handleResult(res, lv) {
    var ul = $('results');

    if (res.error) {
      failStreak++;
      global.FX.shake();
      global.World.jolt();
      var msg, detail = '';
      if (res.error === 'compile') {
        msg = 'Python could not read your code.';
        detail = '<pre class="res-trace">' + escapeHtml(res.trace || '') + '</pre>';
      } else if (res.error === 'missing') {
        msg = 'No <code>' + res.fn + '</code> was defined. Check the name and the spelling.';
      } else if (res.error === 'timeout') {
        msg = 'Your code ran too long and was stopped. That usually means a loop with no way out.';
      } else if (res.error === 'notready') {
        msg = 'The interpreter is still loading.';
      } else {
        msg = 'Something went wrong running that: ' + escapeHtml(res.message || res.error);
      }
      ul.innerHTML = '<li class="res res--err"><span class="res-mark">✕</span>' +
                     '<div><p class="res-title">' + msg + '</p>' + detail + '</div></li>';
      setHp(0, lv.tests.length);
      maybeCounselAfterFail();
      return;
    }

    var rows = res.results || [];
    var p = rows.filter(function (r) { return r.pass; }).length;
    passed = p;
    setHp(p, lv.tests.length);

    ul.innerHTML = rows.map(function (r) {
      var out = '';
      if (r.raised) {
        out = '<p class="res-line res-raised">raised <code>' + escapeHtml(r.raised) + '</code></p>';
      } else if (!r.pass) {
        out = '<p class="res-line">expected <code>' + escapeHtml(r.expect) + '</code></p>' +
              '<p class="res-line">got <code class="bad">' + escapeHtml(String(r.got)) + '</code></p>';
      }
      var printed = r.stdout ? '<p class="res-line res-stdout">printed: <code>' +
                    escapeHtml(r.stdout.trim()) + '</code></p>' : '';
      return '<li class="res ' + (r.pass ? 'res--ok' : 'res--no') + '">' +
             '<span class="res-mark">' + (r.pass ? '✓' : '✕') + '</span>' +
             '<div><p class="res-title">' + escapeHtml(r.label) + '</p>' +
             '<p class="res-call"><code>' + escapeHtml(r.call || '') + '</code></p>' +
             out + printed + '</div></li>';
    }).join('');

    if (p === rows.length && rows.length) {
      failStreak = 0;
      onWin(lv);
    } else {
      failStreak++;
      global.FX.shake();
      global.World.jolt();
      maybeCounselAfterFail();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  //  WIN
  // ============================================================
  function onWin(lv) {
    if (solved) return;
    solved = true;
    phase = 'won';
    hideCounsel();
    $('paused-note').classList.add('is-hidden');
    global.FX.burst($('foe-sigil'));
    global.FX.setFoe(false);          // the keeper sinks back down — it gets to stop
    global.World.win();               // rings fly apart, the world unfreezes
    toast('The seal breaks.');

    if (save.cleared.indexOf(lv.id) === -1) {
      save.cleared.push(lv.id);
      persist();
    }

    setTimeout(function () {
      $('warroom').classList.remove('is-on');
      playScene(lv.victory, lv, function () {
        var next = cur + 1;
        if (next >= LEVELS.length) { showEnd(); return; }
        cur = firstUnfinished();
        show('screen-map');
        phase = 'map';
        renderMap();
      });
    }, 1100);
  }

  // ============================================================
  //  THE IDLE CHECK  —  the keeper offers help, and help is lore
  // ============================================================
  var COUNSEL_IDLE = [
    'You have been still a while. I have been still for two hundred years — I know the difference between thinking and being stuck. Shall I tell you something?',
    'Still there. Take another piece of it. It costs me nothing; I have nothing else to spend it on.',
    'One more, then. It is the last useful thing I know.'
  ];
  var COUNSEL_FAIL = [
    'That was close to a shape. Not the shape. Do you want the next piece of it?',
    'Again, and nearly. Let me hand you something.',
    'I have watched a great many people fail at this. You are not failing badly. Take the last piece.'
  ];
  var COUNSEL_SPENT =
    'I have given you everything I have. The rest is yours — or read the working, and take it apart. There has never been shame in reading.';

  function showCounsel(kind) {
    if (counselOpen || solved || phase !== 'puzzle') return;
    var lv = LEVELS[cur];
    var taken = hintsTaken(lv.id);
    var spent = taken >= lv.hints.length;

    counselOpen = true;
    $('counsel-portrait').innerHTML = lv.sigil;
    $('counsel').querySelector('.counsel-name').textContent = lv.keeper.name;
    $('counsel-text').textContent = spent ? COUNSEL_SPENT
      : (kind === 'fail' ? COUNSEL_FAIL : COUNSEL_IDLE)[Math.min(taken, 2)];

    var hintBtn = $('btn-hint');
    hintBtn.textContent = spent ? 'Show me the working' : (taken === 0 ? 'Give me a nudge' : 'Tell me more');
    hintBtn.onclick = spent ? revealSolution : takeHint;

    $('counsel').hidden = false;
    $('counsel').classList.add('is-in');
  }

  function hideCounsel() {
    counselOpen = false;
    $('counsel').hidden = true;
    $('counsel').classList.remove('is-in');
  }

  function takeHint() {
    var lv = LEVELS[cur];
    var n = hintsTaken(lv.id);
    if (n < lv.hints.length) {
      save.hints[lv.id] = n + 1;
      persist();
      renderHints();
    }
    hideCounsel();
    lastActivity = Date.now();
    editor.focus();
  }

  function declineCounsel() {
    hideCounsel();
    lastActivity = Date.now();
    idleStep = Math.min(idleStep + 1, IDLE_STEPS.length - 1);
    failStreak = 0;
    editor.focus();
  }

  function maybeCounselAfterFail() {
    if (failStreak >= 3) showCounsel('fail');
  }

  function renderHints() {
    var lv = LEVELS[cur];
    var n = hintsTaken(lv.id);
    var box = $('hints');
    var html = '';

    for (var i = 0; i < n && i < lv.hints.length; i++) {
      var h = lv.hints[i];
      html += '<div class="hint">' +
              '<p class="hint-lore">“' + h.lore + '”</p>' +
              '<p class="hint-text">' + h.text + '</p></div>';
    }

    if (n > 0 && n >= lv.hints.length) {
      html += '<button class="btn btn--ghost btn--sm btn--block" id="btn-solution">Show me the working</button>';
    } else if (n > 0) {
      html += '<button class="btn btn--ghost btn--sm btn--block" id="btn-more">Ask for more</button>';
    }
    if (INSTRUCTOR) {
      html += '<button class="btn btn--ghost btn--sm btn--block" id="btn-solution-i">' +
              'Instructor · reveal solution</button>';
    }
    box.innerHTML = html;

    var more = $('btn-more');
    if (more) more.onclick = takeHint;
    var sol = $('btn-solution');
    if (sol) sol.onclick = revealSolution;
    var soli = $('btn-solution-i');
    if (soli) soli.onclick = revealSolution;
  }

  function revealSolution() {
    var lv = LEVELS[cur];
    hideCounsel();
    var box = $('hints');
    if (box.querySelector('.solution')) return;
    var d = document.createElement('div');
    d.className = 'solution';
    d.innerHTML = '<p class="solution-label">The working</p><pre>' +
                  escapeHtml(lv.solution) + '</pre>' +
                  '<button class="btn btn--sm btn--ghost btn--block" id="btn-load-sol">' +
                  'Load it into the editor</button>';
    box.appendChild(d);
    $('btn-load-sol').onclick = function () {
      editor.set(lv.solution);
      save.code[lv.id] = lv.solution;
      persist();
      toast('Loaded. Read it, run it, then change something and see what breaks.');
    };
  }

  // The heartbeat that watches for a stalled player.
  setInterval(function () {
    if (phase !== 'puzzle' || counselOpen || solved) return;
    if (Date.now() - lastActivity > IDLE_STEPS[idleStep]) showCounsel('idle');
  }, 2000);

  // ============================================================
  //  END
  // ============================================================
  function showEnd() {
    phase = 'end';
    var totalHints = Object.keys(save.hints).reduce(function (a, k) { return a + save.hints[k]; }, 0);
    $('end-text').innerHTML =
      '<p>Orrin walks down the mountain to look at a granary. Behind him the realm starts ' +
      'moving again — badly at first, the way anything does after two hundred years of ' +
      'being held still.</p>' +
      '<p>Twelve seals. Strings, loops, lists, dictionaries, sets, sorting, nested data, ' +
      'classes, and a ledger that survived a bad entry. That is a working knowledge of ' +
      'Python, and you built it a piece at a time.</p>';
    $('end-stats').innerHTML =
      '<div class="stat"><b>' + save.cleared.length + '</b><span>seals broken</span></div>' +
      '<div class="stat"><b>' + totalHints + '</b><span>pieces of lore earned</span></div>' +
      '<div class="stat"><b>3</b><span>acts marched</span></div>';
    show('screen-end');
    // Dawn over the empty throne — the first morning in two hundred years.
    global.World.epilogue();
  }

  // ============================================================
  //  BOOT
  // ============================================================
  function init() {
    load();
    global.FX.init($('fx'));
    setActTheme(ACTS[0]);
    cur = firstUnfinished();

    editor = new Editor({
      textarea: $('code'),
      highlight: $('highlight'),
      gutter: $('gutter'),
      onRun: runCode,
      onActivity: function () { lastActivity = Date.now(); },
      onChange: function (src) {
        var lv = LEVELS[cur];
        if (lv) { save.code[lv.id] = src; }
      }
    });

    // Start the interpreter download immediately — it is the long pole.
    Runner.on(function (evt, data) {
      if (evt === 'ready') {
        pyReady = true;
        if (phase === 'puzzle') {
          $('run-status').textContent = '';
          ensurePackages(LEVELS[cur]);   // boot finished after we entered the level
        }
        return;
      }
      if (evt === 'error') {
        $('run-status').textContent = 'Interpreter failed to load — check the network.';
        console.error('[codequest] pyodide:', data);
      }
    });
    Runner.init();

    // --- title
    $('btn-begin').onclick = function () {
      show('screen-map'); phase = 'map'; renderMap();
    };
    if (save.cleared.length) {
      var c = $('btn-continue');
      c.hidden = false;
      c.onclick = function () { show('screen-map'); phase = 'map'; renderMap(); };
      $('btn-begin').textContent = 'Start over';
    }

    // --- map
    $('btn-reset').onclick = function () {
      if (!confirm('Reset the whole campaign? Your code and progress will be cleared.')) return;
      save = { cleared: [], code: {}, hints: {}, seenActs: [] };
      persist();
      cur = 0;
      renderMap();
      toast('Campaign reset.');
    };

    // --- cinema
    $('dialogue').addEventListener('click', advanceScene);
    $('btn-skip').onclick = function (e) {
      e.stopPropagation();
      clearTimeout(scene.timer);
      scene.typing = false;
      scene.i = scene.beats.length;
      nextBeat();
    };
    document.addEventListener('keydown', function (e) {
      if (phase !== 'story') return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advanceScene(); }
      if (e.key === 'Escape') $('btn-skip').click();
    });

    // --- warroom
    $('btn-run').onclick = runCode;
    $('btn-reset-code').onclick = function () {
      var lv = LEVELS[cur];
      editor.set(lv.starter);
      save.code[lv.id] = lv.starter;
      persist();
      toast('Back to the starting shape.');
    };
    $('btn-retreat').onclick = function () {
      phase = 'map';
      cur = firstUnfinished();
      show('screen-map');
      renderMap();
    };
    $('btn-nohint').onclick = declineCounsel;

    // --- end
    $('btn-again').onclick = function () {
      show('screen-title'); phase = 'title';
    };

    if (INSTRUCTOR) {
      document.body.classList.add('instructor');
      toast('Instructor mode — every stop unlocked, solutions available.');
    }

    // ?level=7 jumps straight in (1-based), handy mid-session.
    var lvl = parseInt(params.get('level'), 10);
    if (lvl >= 1 && lvl <= LEVELS.length) {
      cur = lvl - 1;
      openLevel(cur);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
