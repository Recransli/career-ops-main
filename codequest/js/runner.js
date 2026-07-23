/* ============================================================
   runner.js — sandboxed Python execution via Pyodide in a Worker
   ------------------------------------------------------------
   The worker owns the interpreter, so a student's `while True:`
   costs them a timeout instead of freezing the tab.

   A test is either:
     { args: [...] }   -> calls fn(*args)
     { expr: "..." }   -> evaluates a Python expression (classes, methods)
   and expects either:
     { expect: <json> }        -> compared with strict-ish equality
     { expect_expr: "..." }    -> for tuples/sets/objects JSON can't carry
   ============================================================ */
(function (global) {
  'use strict';

  var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';
  var RUN_TIMEOUT_MS = 8000;
  var LOAD_TIMEOUT_MS = 90000;   // pandas is a large download on a slow line

  // ---- Python harness -------------------------------------------------
  // Kept as its own string so the Python stays readable and lintable.
  var HARNESS = [
    'import json, io, contextlib, traceback, sys',
    '',
    'def __cq_run(user_code, fn_name, tests_json):',
    '    tests = json.loads(tests_json)',
    '    ns = {}',
    '    buf = io.StringIO()',
    '    try:',
    '        with contextlib.redirect_stdout(buf):',
    '            exec(user_code, ns)',
    '    except Exception as e:',
    '        # Show the student their own error, not our harness frames.',
    '        detail = "".join(traceback.format_exception_only(type(e), e))',
    '        if not isinstance(e, SyntaxError):',
    '            frames = traceback.extract_tb(e.__traceback__)',
    '            mine = [f for f in frames if f.filename == "<string>"]',
    '            if mine:',
    '                detail = "".join(traceback.format_list(mine)) + detail',
    '        detail = detail.replace(\'File "<string>", \', "")',
    '        return json.dumps({"error": "compile", "trace": detail})',
    '',
    '    if fn_name and not callable(ns.get(fn_name)):',
    '        return json.dumps({"error": "missing", "fn": fn_name})',
    '',
    '    try:',
    '        import pandas as pd',
    '        ns.setdefault("pd", pd)   # so expect_expr can build frames',
    '    except Exception:',
    '        pd = None',
    '',
    '    def eq(got, exp):',
    '        # DataFrames/Series need .equals — "==" gives an elementwise grid.',
    '        if pd is not None:',
    '            if isinstance(got, pd.DataFrame) or isinstance(exp, pd.DataFrame):',
    '                if not (isinstance(got, pd.DataFrame) and isinstance(exp, pd.DataFrame)):',
    '                    return False',
    '                g = got.reset_index(drop=True)',
    '                e = exp.reset_index(drop=True)',
    '                if list(g.columns) != list(e.columns):',
    '                    return False',
    '                # tolerate int64/float64 drift from arithmetic on new columns',
    '                try:',
    '                    from pandas.testing import assert_frame_equal',
    '                    assert_frame_equal(g, e, check_dtype=False)',
    '                    return True',
    '                except Exception:',
    '                    return False',
    '            if isinstance(got, pd.Series) or isinstance(exp, pd.Series):',
    '                if not (isinstance(got, pd.Series) and isinstance(exp, pd.Series)):',
    '                    return False',
    '                try:',
    '                    from pandas.testing import assert_series_equal',
    '                    assert_series_equal(got.reset_index(drop=True),',
    '                                        exp.reset_index(drop=True),',
    '                                        check_dtype=False, check_names=False)',
    '                    return True',
    '                except Exception:',
    '                    return False',
    '        # bool is a subclass of int in Python; keep them distinct here',
    '        if isinstance(got, bool) != isinstance(exp, bool):',
    '            return False',
    '        if isinstance(got, (int, float)) and isinstance(exp, (int, float)):',
    '            return got == exp',
    '        if type(got) is not type(exp):',
    '            return False',
    '        return got == exp',
    '',
    '    def show(v):',
    '        try:',
    '            if pd is not None and isinstance(v, (pd.DataFrame, pd.Series)):',
    '                # a table renders far more usefully than repr()',
    '                s = v.to_string()',
    '                return s if len(s) <= 600 else s[:597] + "..."',
    '            s = repr(v)',
    '        except Exception:',
    '            return "<unrepresentable>"',
    '        return s if len(s) <= 220 else s[:217] + "..."',
    '',
    '    out = []',
    '    for t in tests:',
    '        rec = {"label": t.get("label", "")}',
    '        buf = io.StringIO()',
    '        try:',
    '            with contextlib.redirect_stdout(buf):',
    '                if "expr" in t:',
    '                    # "show" lets a level display something friendlier',
    '                    # than the expression actually evaluated.',
    '                    rec["call"] = t.get("show", t["expr"])',
    '                    got = eval(t["expr"], ns)',
    '                else:',
    '                    args = t.get("args", [])',
    '                    rec["call"] = fn_name + "(" + ", ".join(repr(a) for a in args) + ")"',
    '                    got = ns[fn_name](*args)',
    '                exp = eval(t["expect_expr"], ns) if "expect_expr" in t else t.get("expect")',
    '            rec["expect"] = show(exp)',
    '            rec["got"] = show(got)',
    '            rec["pass"] = eq(got, exp)',
    '        except Exception as e:',
    '            rec["expect"] = show(t.get("expect"))',
    '            rec["got"] = None',
    '            rec["pass"] = False',
    '            rec["raised"] = type(e).__name__ + ": " + str(e)',
    '        rec["stdout"] = buf.getvalue()[:300]',
    '        out.append(rec)',
    '    return json.dumps({"results": out})'
  ].join('\n');

  // ---- worker source (stringified; built into a Blob) -----------------
  var WORKER_SRC = [
    'let pyodide = null;',
    'let ready = false;',
    'let HARNESS = null;',
    '',
    'async function boot(indexURL, harness) {',
    '  HARNESS = harness;',
    '  importScripts(indexURL + "pyodide.js");',
    '  pyodide = await loadPyodide({ indexURL: indexURL });',
    '  pyodide.runPython(HARNESS);',
    '  ready = true;',
    '  postMessage({ type: "ready" });',
    '}',
    '',
    'self.onmessage = async function (e) {',
    '  const msg = e.data;',
    '  if (msg.type === "boot") {',
    '    try { await boot(msg.indexURL, msg.harness); }',
    '    catch (err) { postMessage({ type: "bootfail", message: String(err) }); }',
    '    return;',
    '  }',
    '  if (msg.type === "load") {',
    '    // Heavy packages (pandas) are pulled only when an act needs them.',
    '    try {',
    '      await pyodide.loadPackage(msg.packages);',
    '      postMessage({ type: "loaded", id: msg.id });',
    '    } catch (err) {',
    '      postMessage({ type: "loadfail", id: msg.id, message: String(err) });',
    '    }',
    '    return;',
    '  }',
    '  if (msg.type === "run") {',
    '    if (!ready) { postMessage({ type: "result", id: msg.id, payload: { error: "notready" } }); return; }',
    '    let runner = null;',
    '    try {',
    '      runner = pyodide.globals.get("__cq_run");',
    '      const raw = runner(msg.code, msg.fnName, msg.testsJson);',
    '      postMessage({ type: "result", id: msg.id, payload: JSON.parse(raw) });',
    '    } catch (err) {',
    '      postMessage({ type: "result", id: msg.id, payload: { error: "host", message: String(err) } });',
    '    } finally {',
    '      if (runner && runner.destroy) { try { runner.destroy(); } catch (_) {} }',
    '    }',
    '  }',
    '};'
  ].join('\n');

  // ---- main-thread controller -----------------------------------------
  var worker = null;
  var seq = 0;
  var pending = {};          // id -> { resolve, timer }
  var loaded = {};           // package name -> true, once fetched
  var readyPromise = null;
  var listeners = [];
  var resolveReady = null;
  var rejectReady = null;

  function emit(evt, data) {
    listeners.forEach(function (fn) { try { fn(evt, data); } catch (_) {} });
  }

  function spawn() {
    var blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
    var w = new Worker(URL.createObjectURL(blob));

    w.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'ready') {
        emit('ready');
        if (resolveReady) resolveReady();
        return;
      }
      if (m.type === 'bootfail') {
        emit('error', m.message);
        if (rejectReady) rejectReady(new Error(m.message));
        return;
      }
      if (m.type === 'loaded' || m.type === 'loadfail') {
        var lp = pending[m.id];
        if (!lp) return;
        clearTimeout(lp.timer);
        delete pending[m.id];
        lp.resolve(m.type === 'loaded' ? { ok: true } : { ok: false, message: m.message });
        return;
      }
      if (m.type === 'result') {
        var p = pending[m.id];
        if (!p) return;
        clearTimeout(p.timer);
        delete pending[m.id];
        p.resolve(m.payload);
      }
    };

    w.onerror = function (err) {
      emit('error', err.message || 'worker error');
      if (rejectReady) rejectReady(new Error(err.message || 'worker error'));
    };

    w.postMessage({ type: 'boot', indexURL: PYODIDE_CDN, harness: HARNESS });
    return w;
  }

  var Runner = {
    /** Subscribe to lifecycle events: 'ready' | 'error'. */
    on: function (fn) { listeners.push(fn); },

    /** Boot the interpreter. Idempotent; returns a promise. */
    init: function () {
      if (readyPromise) return readyPromise;
      readyPromise = new Promise(function (res, rej) {
        resolveReady = res;
        rejectReady = rej;
        try { worker = spawn(); }
        catch (err) { rej(err); }
      });
      return readyPromise;
    },

    isReady: function () { return !!worker; },

    /**
     * Ensure Python packages are present before a level runs.
     * Cached per session, so re-entering an act costs nothing.
     * Resolves { ok: true } | { ok: false, message }.
     */
    load: function (packages) {
      var need = (packages || []).filter(function (p) { return !loaded[p]; });
      if (!need.length) return Promise.resolve({ ok: true });
      return new Promise(function (resolve) {
        if (!worker) { resolve({ ok: false, message: 'interpreter not ready' }); return; }
        var id = ++seq;
        var timer = setTimeout(function () {
          delete pending[id];
          resolve({ ok: false, message: 'timed out fetching ' + need.join(', ') });
        }, LOAD_TIMEOUT_MS);
        pending[id] = {
          timer: timer,
          resolve: function (r) {
            if (r.ok) need.forEach(function (p) { loaded[p] = true; });
            resolve(r);
          }
        };
        worker.postMessage({ type: 'load', id: id, packages: need });
      });
    },

    /**
     * Run student code against a level's tests.
     * Resolves to { results: [...] } | { error: 'compile'|'missing'|'timeout'|... }
     */
    run: function (code, fnName, tests) {
      return new Promise(function (resolve) {
        if (!worker) { resolve({ error: 'notready' }); return; }
        var id = ++seq;

        var timer = setTimeout(function () {
          delete pending[id];
          // A runaway loop can only be stopped by killing the interpreter.
          try { worker.terminate(); } catch (_) {}
          worker = null;
          readyPromise = null;
          loaded = {};              // fresh interpreter — packages must be refetched
          Runner.init();
          resolve({ error: 'timeout' });
        }, RUN_TIMEOUT_MS);

        pending[id] = { resolve: resolve, timer: timer };
        worker.postMessage({
          type: 'run',
          id: id,
          code: code,
          fnName: fnName,
          testsJson: JSON.stringify(tests)
        });
      });
    }
  };

  global.Runner = Runner;
})(window);
