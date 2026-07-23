/* ============================================================
   editor.js — a small Python editor: highlight overlay,
   line numbers, 4-space indent rules, run shortcut.
   A transparent <textarea> sits over a highlighted <pre>.
   ============================================================ */
(function (global) {
  'use strict';

  var INDENT = '    ';   // Python. Four spaces. Not negotiable.

  var RE = new RegExp([
    '(#[^\\n]*)',                                             // 1 comment
    '([fFrRbB]{0,2}(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'' +
      '|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'))', // 2 string
    '(\\b\\d+\\.?\\d*\\b)',                                   // 3 number
    '(@[A-Za-z_]\\w*)',                                       // 4 decorator
    '\\b(def|class|return|if|elif|else|for|while|in|not|and|or|is|None|True|False' +
      '|import|from|as|try|except|finally|raise|with|lambda|pass|break|continue' +
      '|global|nonlocal|yield|assert|del|async|await)\\b',    // 5 keyword
    '\\b(print|len|range|str|int|float|list|dict|set|tuple|sum|min|max|sorted' +
      '|enumerate|zip|abs|round|map|filter|any|all|isinstance|type|open|super|self)\\b', // 6 builtin
    '\\b([A-Za-z_]\\w*)(?=\\s*\\()'                           // 7 call
  ].join('|'), 'g');

  var CLS = [null, 'tok-com', 'tok-str', 'tok-num', 'tok-dec', 'tok-kw', 'tok-bi', 'tok-fn'];

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(src) {
    var out = '';
    var last = 0;
    var m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src)) !== null) {
      if (m.index > last) out += esc(src.slice(last, m.index));
      for (var g = 1; g < CLS.length; g++) {
        if (m[g] !== undefined) {
          out += '<span class="' + CLS[g] + '">' + esc(m[g]) + '</span>';
          break;
        }
      }
      last = m.index + m[0].length;
      if (m[0].length === 0) RE.lastIndex++;   // guard against zero-width loops
    }
    out += esc(src.slice(last));
    return out;
  }

  /**
   * Editor(opts)
   *   opts.textarea / opts.highlight / opts.gutter — elements
   *   opts.onRun      — Ctrl/Cmd+Enter
   *   opts.onActivity — any keystroke (drives the idle-check timer)
   *   opts.onChange   — content changed
   */
  function Editor(opts) {
    this.ta = opts.textarea;
    this.pre = opts.highlight.querySelector('code');
    this.gutter = opts.gutter;
    this.onRun = opts.onRun || function () {};
    this.onActivity = opts.onActivity || function () {};
    this.onChange = opts.onChange || function () {};
    this._bind();
  }

  Editor.prototype._bind = function () {
    var self = this;

    this.ta.addEventListener('input', function () {
      self.render();
      self.onActivity();
      self.onChange(self.ta.value);
    });

    this.ta.addEventListener('scroll', function () {
      opts_sync(self);
    });

    this.ta.addEventListener('keydown', function (e) {
      // run
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        self.onRun();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        e.shiftKey ? self._dedent() : self._insert(INDENT);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        self._newline();
        return;
      }
      self.onActivity();
    });

    function opts_sync(ed) {
      ed.pre.parentNode.scrollTop = ed.ta.scrollTop;
      ed.pre.parentNode.scrollLeft = ed.ta.scrollLeft;
      if (ed.gutter) ed.gutter.scrollTop = ed.ta.scrollTop;
    }
    this._sync = function () { opts_sync(self); };
  };

  /** Insert text at the caret, keeping undo history intact where possible. */
  Editor.prototype._insert = function (text) {
    var ta = this.ta;
    var s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    this.render();
    this.onChange(ta.value);
  };

  /** Auto-indent: keep the current indent, add one level after a colon. */
  Editor.prototype._newline = function () {
    var ta = this.ta;
    var pos = ta.selectionStart;
    var before = ta.value.slice(0, pos);
    var lineStart = before.lastIndexOf('\n') + 1;
    var line = before.slice(lineStart);
    var indent = (line.match(/^[ \t]*/) || [''])[0];
    if (/:\s*$/.test(line)) indent += INDENT;
    this._insert('\n' + indent);
  };

  /** Shift+Tab — remove up to one indent level from the caret's line. */
  Editor.prototype._dedent = function () {
    var ta = this.ta;
    var pos = ta.selectionStart;
    var lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    var head = ta.value.slice(lineStart, pos);
    var cut = 0;
    while (cut < INDENT.length && head[cut] === ' ') cut++;
    if (!cut) return;
    ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + cut);
    ta.selectionStart = ta.selectionEnd = pos - cut;
    this.render();
    this.onChange(ta.value);
  };

  Editor.prototype.render = function () {
    var src = this.ta.value;
    this.pre.innerHTML = highlight(src) + '\n';   // trailing \n keeps last line visible
    if (this.gutter) {
      var lines = src.split('\n').length;
      var html = '';
      for (var i = 1; i <= lines; i++) html += i + '\n';
      this.gutter.textContent = html;
    }
    this._sync();
  };

  Editor.prototype.set = function (src) {
    this.ta.value = src;
    this.render();
    this.ta.scrollTop = 0;
  };

  Editor.prototype.get = function () { return this.ta.value; };
  Editor.prototype.focus = function () { this.ta.focus(); };

  global.Editor = Editor;
})(window);
