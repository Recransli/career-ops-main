# Code Conquest — The Iron Compiler

A story-driven Python trainer for a **three-day workshop**. Twelve coding seals across
three acts, one act per day. Real CPython runs in the browser via
[Pyodide](https://pyodide.org) — no install, no accounts, no backend, nothing leaves
the page.

---

## For the facilitator

### The shape of it

| Act | Day | Stops | Teaches |
|-----|-----|-------|---------|
| **I — The Drowned Coast** | Day One | 1–4 | f-strings, loops, conditionals, string building, accumulators |
| **II — The Iron Heartland** | Day Two | 5–8 | **pandas** — DataFrames, row/column selection, null handling, new & renamed columns, date filtering, `merge` |
| **III — The Obsidian Throne** | Day Three | 9–12 | nested data, classes, `try`/`except`, capstone |

Each stop is roughly **8–15 minutes** for someone new to Python, so an act is a
comfortable 60–90 minute block with discussion in between. Act III runs longer —
classes and the capstone are the heaviest items.

### Instructor mode

Add `?instructor` to the URL:

```
https://YOUR-USERNAME.github.io/REPO/codequest/?instructor
```

This unlocks every stop and puts a **reveal solution** button on every puzzle, so you
can unblock a stuck table in seconds without hunting through files.

Jump straight to a specific stop with `?level=7` (1-based, combinable:
`?level=7&instructor`).

### Starting Day 2 and Day 3

The first stop of each act is **always unlocked**, so people can open the link on
Day 2 and go straight to Act II without replaying Day 1. Progress is saved in
`localStorage` per browser — if someone switches machines they start fresh, which is
usually fine since acts are independent.

### The hint system — read this before you run the session

When someone stalls (about 45 seconds with no typing, or three failed runs), the
**seal-keeper offers help**, and each hint comes wrapped in a piece of that
character's backstory. Taking hints gives you *more* story, not less.

This is deliberate. In a room where people are wary of looking slow in front of
colleagues, an inverted incentive does more for participation than any amount of
"there are no stupid questions". **Say this out loud at the start of Day 1** — that
hints are the intended path and they carry the good writing. It changes the room.

There are three hints per stop, escalating from a nudge to a near-complete answer,
then an optional full worked solution.

### Fast finishers

Every stop has an optional **banner objective** — a harder variant of the same
problem (one-line comprehension, `collections.Counter`, returning a tuple, etc.).
This is your pacing valve: the two people who finish in four minutes have somewhere
to go while you help everyone else.

### Practical notes

- **First load downloads ~8 MB** of Pyodide. Have everyone open the link while
  they're settling in on Day 1 morning rather than at 9:05 when you need it. It is
  cached afterwards.
- **Infinite loops are safe.** Python runs in a Web Worker with an 8-second timeout;
  a runaway loop gets stopped and the interpreter restarts. Nobody's tab freezes.
- **Reset campaign** on the war map clears progress and all saved code.
- Works offline after first load, except the very first Pyodide fetch.

---

## Deploying to GitHub Pages

The site is fully static — no build step.

### Option A — Actions workflow (already included)

`.github/workflows/codequest-pages.yml` publishes the `codequest/` folder on every
push to `main`. Enable it once:

**Settings → Pages → Build and deployment → Source: GitHub Actions**

Then push. The site lands at `https://<user>.github.io/<repo>/`.

### Option B — serve from a branch

**Settings → Pages → Source: Deploy from a branch**, pick `main` and `/ (root)`.
The game is then at `https://<user>.github.io/<repo>/codequest/`.

### Running it locally

```bash
python3 -m http.server 8099 --directory codequest
```

Then open <http://localhost:8099>. Any static server works; opening `index.html`
directly off the filesystem will **not** work, because Web Workers need a real origin.

---

## Customising the content

Everything a facilitator would want to change lives in **`js/levels.js`**. Each stop
is one object:

```js
{
  id: 'a1', act: 1,
  place: 'The Drowned Gate',
  teaches: 'f-strings & return',
  keeper: { name: 'The Tollkeeper', taunt: '...' },
  story:   [ { who: 'VEX', text: '...' } ],   // beats before the puzzle
  fn:      'muster',                          // function students must define
  brief:   '<p>...</p>',                      // the task, as HTML
  starter: 'def muster(name, count):\n    \n',
  tests:   [ { label: '...', args: [...], expect: '...' } ],
  bonus:   'the optional harder variant',
  hints:   [ { lore: '...', text: '...' } ],  // three of these
  solution:'def muster(...)...',
  victory: [ { who: 'KEEPER', text: '...' } ] // beats after the puzzle
}
```

**Speakers** are `NARRATOR` (centred italic, no portrait), `VEX` (the companion),
`KEEPER` (uses that stop's sigil), and `ORRIN` (the final act).

### Test forms

A test calls the student's function directly:

```js
{ label: 'Three towers lit', args: [['iron','tide']], expect: 'IT' }
```

…or evaluates a Python expression, for classes and multi-step checks:

```js
{
  label: 'It takes losses',
  expr:  '[(l := Legion("Iron", 50)), l.losses(20), l.size][-1]',
  show:  'l = Legion("Iron", 50); l.losses(20); l.size',   // what students see
  expect: 30
}
```

Use `expect_expr` instead of `expect` when the expected value is something JSON
can't carry, such as a tuple or a set:

```js
{ label: 'Returns a tuple', args: [[1,2]], expect_expr: '(3, 0)' }
```

Comparison is strict about type — `[1,2]` does not equal `(1,2)`, and `True` does not
equal `1`. That is intentional; type discipline is part of what you are teaching.

### Changing the difficulty ladder

If your room is more experienced, the cheapest edit is to raise Act I: replace the
first two stops with harder problems and keep the same story beats. The narrative
never refers to the specific difficulty of a puzzle, only to what the keeper is
stuck doing — so you can swap the task and keep every line of dialogue.

---

## File layout

```
codequest/
├── index.html          screens and layout
├── css/style.css       the whole visual system
└── js/
    ├── fx.js           2D ambient canvas (title + war map only)
    ├── world.js        ← the first-person 3D halls (three.js)
    ├── levels.js       ← all story and puzzle content
    ├── editor.js       Python highlighting, indent rules, line numbers
    ├── runner.js       Pyodide in a Web Worker + the test harness
    ├── map.js          the war map SVG
    └── game.js         screens, story pacing, the idle-check, saving
```

No dependencies, no build, no framework. Pyodide is the only external fetch.

---

## Accessibility

Respects `prefers-reduced-motion` (no typewriter, no embers, no shake). Map stops are
keyboard-reachable and activate with Enter or Space. Story advances with Enter/Space,
skips with Escape. Colour is never the only signal — every test result carries a ✓/✕
mark as well as its colour.

---

## Act II and the pandas download

Act II runs real pandas, not a simulation. The wheel is fetched from the Pyodide CDN
**the first time a student opens stop 5** — not at page load, so Day One costs nothing
extra. While it downloads, the strike button is disabled and the status line reads
*"The Compiler is remembering pandas…"*.

It is roughly a **20 MB** download, cached by the browser afterwards.

> **Facilitator tip:** on shared conference wifi, have the room open stop 5 (The Census
> Hall) during the Day Two intro so the fetch happens while you are still talking.
> After that it is instant for the rest of the day.

Each Act II stop declares what it needs in `js/levels.js`:

```js
{ id: 'b1', act: 2, needs: ['pandas'], … }
```

Add `'numpy'`, `'matplotlib'`, or any other Pyodide-supported package to that array and
the loader handles the rest.

### How answers are checked

DataFrames are compared with `pandas.testing.assert_frame_equal(check_dtype=False)`
after resetting the index, so students are not punished for an index left over from
filtering, or for int64 vs float64 drift after arithmetic. Column **names and order**
do matter. Failed trials print expected and actual as aligned tables.

---

## The 3D world

Chapters are played in first person. `js/world.js` builds a hall with
[three.js](https://threejs.org) (ES module, loaded from a CDN via an importmap in
`index.html`), and the camera walks you into it at eye height.

- **A hall per seal, not per act.** Room width, length, ceiling height, pillar count
  and pillar style are all derived from a hash of the level's `id`, so all twelve
  halls differ. The act only decides the palette, weather and props — flooded stone
  and rain in Act I, braziers and rising embers in Act II, drifting obsidian and snow
  in Act III.
- **The keeper is a character.** It stands 3–5 m tall, breathes, turns its head, and
  its eyes flare while it speaks. Its sigil rings orbit at a speed set by the level
  seed. When the seal breaks the rings fly apart, the eyes go out, and it settles —
  it does not die, it is allowed to stop.
- **Vex rides at your shoulder** as a small wireframe shard, and spins up when it
  talks.

### The pause

When the puzzle opens, `World.pause()` renders one final frame, sets `frozen`, and
**cancels the animation loop entirely**. The world holds mid-motion and CSS blurs and
desaturates it behind the code panel. A student typing for ten minutes costs zero GPU.
`World.win()` resumes it for the shatter.

### If WebGL is unavailable

`world.js` exports a no-op stub when the canvas or context cannot be created, and the
2D `fx.js` backdrop stays visible. The game remains fully playable.

### Tuning it

Palettes live in `ACT_LOOK` at the top of `js/world.js`. Room dimensions come from the
`rnd()` calls at the top of `buildHall()`. Both are safe to edit — nothing else reads
them.
