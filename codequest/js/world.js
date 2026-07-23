/* ============================================================
   world.js — the first-person 3D world
   ------------------------------------------------------------
   You stand in the Architect's boots. Each seal is its own hall:
   the camera walks you in, the seal-keeper looms and breathes in
   front of you, Vex floats at your shoulder.

   When the puzzle begins the world FREEZES mid-motion and the
   renderer stops entirely — the story is visibly waiting on you,
   and a student typing for ten minutes costs zero GPU.

   Every hall is generated from the level's id, so all twelve
   differ in size, colour, pillar rhythm and props.
   ============================================================ */
import * as THREE from 'three';

/* ---------- act palettes ---------- */
const ACT_LOOK = {
  1: {                                   // drowned coast — cold, wet, blue
    fog:   0x0e2338, floor: 0x1d2b3a, wall: 0x16222f, pillar: 0x24313f,
    key:   0x7fc4ff, rim: 0x2f6f9e, ember: 0x9fd4ff,
    keeper:0x0c1520, eye: 0xff7a3c, fall: 'rain', fogNear: 7, fogFar: 46
  },
  2: {                                   // burning heartland — amber, smoke
    fog:   0x30160c, floor: 0x2e1d16, wall: 0x241310, pillar: 0x342018,
    key:   0xffa552, rim: 0xc2481a, ember: 0xffb066,
    keeper:0x140a07, eye: 0xffd27a, fall: 'ember', fogNear: 6, fogFar: 40
  },
  3: {                                   // obsidian throne — violet, frozen
    fog:   0x14122e, floor: 0x1b1a38, wall: 0x121229, pillar: 0x222046,
    key:   0xb79cf7, rim: 0x5b3aa8, ember: 0xd8c8ff,
    keeper:0x08081a, eye: 0x9fe4ff, fall: 'snow', fogNear: 8, fogFar: 52
  }
};

/* deterministic per-level variation */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- module state ---------- */
let renderer, scene, camera, clock;
let canvas;
let hall = null;            // THREE.Group for the current level
let keeper = null;          // { group, head, eyes[], rings[], baseY }
let vex = null;             // { group, core }
let motes = null;           // THREE.Points
let running = false;
let frozen = false;
let raf = null;
let ready = false;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* camera rig */
const cam = {
  z: 10, targetZ: 3.4, walking: false,
  bob: 0, sway: 0, shake: 0,
  yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0
};

/* who is currently speaking — drives the character animation */
let speaker = null, speakPulse = 0;

/* ============================================================
   setup
   ============================================================ */
function init() {
  canvas = document.getElementById('world');
  if (!canvas) return false;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
  camera.position.set(0, 1.7, cam.z);

  clock = new THREE.Clock();
  resize();
  window.addEventListener('resize', resize);

  /* look around slightly with the pointer — you are standing in the room */
  window.addEventListener('pointermove', (e) => {
    cam.targetYaw = -(e.clientX / window.innerWidth - 0.5) * 0.28;
    cam.targetPitch = -(e.clientY / window.innerHeight - 0.5) * 0.16;
  }, { passive: true });

  ready = true;
  return true;
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (frozen) renderer.render(scene, camera);   // keep the frozen frame correct
}

/* ============================================================
   setpieces — the story, staged
   ------------------------------------------------------------
   Each level's place is a real location, not a reskinned box.
   A setpiece gets { hall, look, rnd, width, length, height, add }
   where add(fn) registers a per-frame animation callback.
   `outdoor: true` drops the walls and ceiling and opens the fog.
   ============================================================ */
let _glowTex = null;
function glowTex() {
  /* a soft radial falloff, so light-plates read as glow, not slabs */
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function plate(w, h, color, opacity, emissive) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      color, transparent: opacity !== undefined || !!emissive, opacity: opacity ?? 1,
      side: THREE.DoubleSide, depthWrite: false,
      map: emissive ? glowTex() : null,
      blending: emissive ? THREE.AdditiveBlending : THREE.NormalBlending
    })
  );
}

const SETPIECE = {
  /* ---- ACT I · the drowned coast ---- */

  a1: { // The Drowned Gate — a colossal gate ajar, chains into black water
    build({ hall, look, length, height, add }) {
      const gateMat = new THREE.MeshStandardMaterial({
        color: 0x1a2836, roughness: 0.55, metalness: 0.6
      });
      const gz = -length * 0.52;
      const doors = [];
      for (const side of [-1, 1]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, height * 0.86, 0.34), gateMat);
        door.geometry.translate(side * -1.3, 0, 0);      // hinge on the outer edge
        door.position.set(side * 2.9, height * 0.43, gz);
        door.rotation.y = side * 0.5;                     // ajar — the sea pushed it open
        hall.add(door);
        doors.push({ door, side });
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.7, 0.8), gateMat);
      lintel.position.set(0, height * 0.88, gz);
      hall.add(lintel);
      /* chains swinging from the lintel */
      const chains = [];
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5),
          new THREE.MeshStandardMaterial({ color: 0x3a4a58, metalness: 0.8, roughness: 0.4 })
        );
        c.geometry.translate(0, -1.2, 0);
        c.position.set(-2.6 + i * 1.7, height * 0.84, gz + 0.5);
        hall.add(c);
        chains.push({ c, ph: i * 1.9 });
      }
      add((t) => {
        for (const { door, side } of doors) door.rotation.y = side * (0.5 + Math.sin(t * 0.4 + side) * 0.03);
        for (const { c, ph } of chains) {
          c.rotation.x = Math.sin(t * 0.9 + ph) * 0.1;
          c.rotation.z = Math.cos(t * 0.7 + ph) * 0.08;
        }
      });
    }
  },

  a2: { // The Tidewall — outdoors: a long sea-wall taking waves in the storm
    outdoor: true,
    build({ hall, look, width, length, add }) {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x22303c, roughness: 0.85 });
      const wz = -length * 0.5;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width * 3, 3.4, 1.6), wallMat);
      wall.position.set(0, 1.7, wz);
      hall.add(wall);
      /* crenellations */
      for (let i = -6; i <= 6; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.6), wallMat);
        m.position.set(i * 2.2, 3.7, wz);
        hall.add(m);
      }
      /* the sea beyond, heaving */
      const sea = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 6, length, 24, 8),
        new THREE.MeshStandardMaterial({
          color: 0x0d2438, roughness: 0.2, metalness: 0.7, flatShading: true
        })
      );
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, 0.7, wz - length * 0.5 - 2);
      hall.add(sea);
      const seaPos = sea.geometry.attributes.position;
      const seaBase = seaPos.array.slice();
      /* spray bursts where waves hit the wall */
      const sprays = [];
      for (let i = 0; i < 3; i++) {
        const s = plate(3.2, 2.2, 0x9fd4ff, 0, true);
        s.position.set((i - 1) * 7, 4.4, wz - 0.4);
        hall.add(s);
        sprays.push({ s, ph: i * 2.3 });
      }
      add((t) => {
        for (let i = 0; i < seaPos.count; i++) {
          const x = seaBase[i * 3], y = seaBase[i * 3 + 1];
          seaPos.array[i * 3 + 2] = seaBase[i * 3 + 2]
            + Math.sin(x * 0.4 + t * 1.6) * 0.5 + Math.cos(y * 0.5 + t * 1.1) * 0.4;
        }
        seaPos.needsUpdate = true;
        for (const { s, ph } of sprays) {
          const cyc = (t * 0.55 + ph) % 6.283;
          const k = Math.max(0, Math.sin(cyc));
          s.material.opacity = k * 0.5;
          s.scale.setScalar(0.6 + k * 0.9);
          s.position.y = 3.6 + k * 1.6;
        }
      });
    }
  },

  a3: { // The Signal Towers — beacons repeating a dead message down the coast
    outdoor: true,
    build({ hall, look, width, length, add }) {
      const stone = new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.9 });
      const beacons = [];
      for (let i = 0; i < 5; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const h = 7 + (i % 3) * 2;
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.05, h, 7), stone);
        const z = -4 - i * (length * 0.13);
        tower.position.set(side * (width * 0.42 + i * 0.6), h / 2, z);
        tower.rotation.z = side * 0.02 * (i + 1);        // older towers lean more
        hall.add(tower);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.34, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.2 })
        );
        lamp.position.set(tower.position.x, h + 0.5, z);
        hall.add(lamp);
        const light = new THREE.PointLight(0x9fd4ff, 0, 16, 2);
        light.position.copy(lamp.position);
        hall.add(light);
        beacons.push({ lamp, light });
      }
      /* the same three-pulse signal travels tower to tower, endlessly */
      add((t) => {
        const seq = t * 1.35;
        beacons.forEach((b, i) => {
          const local = seq - i * 0.9;
          const phase = ((local % 7) + 7) % 7;
          const on = phase < 2.2 ? Math.abs(Math.sin(phase * Math.PI * 1.36)) : 0;
          b.lamp.material.opacity = 0.15 + on * 0.85;
          b.light.intensity = on * 26;
        });
      });
    }
  },

  a4: { // The Reckoning Field — standing stones counted by a sweeping light
    outdoor: true,
    build({ hall, look, width, length, add }) {
      const stones = [];
      const mat = new THREE.MeshStandardMaterial({
        color: 0x243240, roughness: 0.85, metalness: 0.1,
        emissive: 0x7fc4ff, emissiveIntensity: 0
      });
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) {
          const m = mat.clone();
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3 + (r + c) % 3 * 0.5, 0.36), m);
          s.position.set((c - 2) * (width * 0.2), s.geometry.parameters.height / 2,
                         -4.5 - r * (length * 0.11));
          s.rotation.y = ((r * 5 + c) % 7 - 3) * 0.09;
          hall.add(s);
          stones.push(s);
        }
      }
      /* the count sweeps the rows, stone by stone, and never finishes */
      add((t) => {
        const idx = Math.floor(t * 2.4) % (stones.length + 6);   // pause between passes
        stones.forEach((s, i) => {
          const lit = i === idx ? 1 : Math.max(0, s.material.emissiveIntensity - 0.03);
          s.material.emissiveIntensity = lit;
        });
      });
    }
  },

  /* ---- ACT II · the iron heartland ---- */

  b1: { // The Census Hall — shelf canyons, a blizzard of falling records
    build({ hall, look, width, length, height, rnd, add }) {
      const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9 });
      for (let i = 0; i < 4; i++) {
        for (const side of [-1, 1]) {
          const sh = new THREE.Mesh(new THREE.BoxGeometry(0.5, height * 0.8, 3.2), shelfMat);
          sh.position.set(side * (width / 2 - 1.7), height * 0.4, -3.5 - i * (length * 0.13));
          hall.add(sh);
          /* glowing record-spines */
          for (let b = 0; b < 6; b++) {
            const spine = plate(0.26, 0.36, 0xffb066, 0.5, true);
            spine.position.set(side * (width / 2 - 1.42), 1 + b, sh.position.z + (b % 3 - 1));
            spine.rotation.y = side * Math.PI / 2;
            hall.add(spine);
          }
        }
      }
      /* pages falling, endlessly — the census never files itself */
      const pages = [];
      for (let i = 0; i < 22; i++) {
        const p = plate(0.24, 0.32, 0xffe8c8, 0.7);
        p.position.set((rnd() - 0.5) * width * 0.8, rnd() * height, -rnd() * length * 0.5);
        hall.add(p);
        pages.push({ p, ph: rnd() * 6.28, v: 0.25 + rnd() * 0.4 });
      }
      add((t, dt) => {
        for (const pg of pages) {
          pg.p.position.y -= pg.v * dt;
          pg.p.position.x += Math.sin(t * 1.3 + pg.ph) * dt * 0.35;
          pg.p.rotation.x = Math.sin(t * 0.9 + pg.ph) * 0.9;
          pg.p.rotation.z = Math.cos(t * 0.7 + pg.ph) * 0.7;
          if (pg.p.position.y < 0) pg.p.position.y = 7;
        }
      });
    }
  },

  b2: { // The Granary Ledger — grain sacks and a great scale that will not settle
    build({ hall, look, width, length, rnd, add }) {
      const sackMat = new THREE.MeshStandardMaterial({ color: 0x4a341c, roughness: 1 });
      for (let i = 0; i < 14; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.5 + rnd() * 0.25, 7, 6), sackMat);
        s.scale.y = 0.72;
        const side = i % 2 === 0 ? -1 : 1;
        s.position.set(side * (width / 2 - 1.4 - rnd() * 1.2),
                       0.36 + (i % 3 === 0 ? 0.62 : 0),
                       -2.5 - rnd() * length * 0.42);
        hall.add(s);
      }
      /* the scale: a tall post, a beam, two hanging pans — forever hunting balance */
      const iron = new THREE.MeshStandardMaterial({ color: 0x2a1a10, metalness: 0.6, roughness: 0.5 });
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.4, 7), iron);
      post.position.set(1.9, 1.7, -5);
      hall.add(post);
      const beam = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.09, 0.09), iron);
      beam.add(bar);
      const pans = [];
      for (const side of [-1, 1]) {
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 4), iron);
        wire.position.set(side * 1.5, -0.45, 0);
        beam.add(wire);
        const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.1, 8), iron);
        pan.position.set(side * 1.5, -0.95, 0);
        beam.add(pan);
        pans.push(pan);
      }
      beam.position.set(1.9, 3.3, -5);
      hall.add(beam);
      /* grain motes trickling onto the heavier pan */
      const trickle = [];
      for (let i = 0; i < 10; i++) {
        const g = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 })
        );
        hall.add(g);
        trickle.push({ g, ph: rnd() });
      }
      add((t, dt) => {
        /* it tips one way, corrects, overshoots — an audit that never closes */
        beam.rotation.z = Math.sin(t * 0.7) * 0.16 + Math.sin(t * 2.3) * 0.03;
        for (const tr of trickle) {
          tr.ph += dt * 0.5;
          const k = tr.ph % 1;
          tr.g.position.set(1.9 + Math.sin(beam.rotation.z) * -1.5 * 0.2,
                            3.6 - k * 1.2, -5);
          tr.g.material.opacity = 0.85 * (1 - k);
        }
      });
    }
  },

  b3: { // The Muster Calendar — war banners and a turning year-ring
    build({ hall, look, width, length, height, add }) {
      const banners = [];
      for (let i = 0; i < 4; i++) {
        for (const side of [-1, 1]) {
          const b = plate(0.9, 2.2, i % 2 ? 0xc2481a : 0x8a2f12, 0.92);
          b.position.set(side * (width / 2 - 1.2), height - 1.6, -3 - i * (length * 0.12));
          b.rotation.y = side * 0.2;
          hall.add(b);
          banners.push({ b, ph: i * 1.7 + side });
        }
      }
      /* the year-ring: a huge calendar wheel grinding above the keeper */
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.6, 0.1, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xffa552, transparent: true, opacity: 0.5 })
      );
      ring.position.set(0, height * 0.62, -7);
      hall.add(ring);
      const ticks = new THREE.Group();
      for (let i = 0; i < 12; i++) {
        const tk = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.42, 0.06),
          new THREE.MeshBasicMaterial({ color: 0xffd27a })
        );
        const a = (i / 12) * Math.PI * 2;
        tk.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
        tk.rotation.z = a;
        ticks.add(tk);
      }
      ticks.position.copy(ring.position);
      hall.add(ticks);
      add((t, dt) => {
        for (const { b, ph } of banners) {
          b.rotation.y += Math.sin(t * 1.8 + ph) * dt * 0.14;
          b.rotation.x = Math.sin(t * 1.2 + ph) * 0.08;
        }
        ring.rotation.z += dt * 0.16;
        ticks.rotation.z += dt * 0.16;
      });
    }
  },

  b4: { // The Twin Bridges — two spans over a drop; the far one carries your ghost
    outdoor: true,
    build({ hall, look, width, length, add }) {
      /* the chasm floor, far below */
      const pit = new THREE.Mesh(
        new THREE.PlaneGeometry(width * 6, length * 2),
        new THREE.MeshBasicMaterial({ color: 0x0c0503 })
      );
      pit.rotation.x = -Math.PI / 2;
      pit.position.y = -7;
      hall.add(pit);
      const lava = plate(width * 5, length * 1.6, 0xff5a1e, 0.16, true);
      lava.rotation.x = -Math.PI / 2;
      lava.position.y = -6.8;
      hall.add(lava);

      const deckMat = new THREE.MeshStandardMaterial({ color: 0x241410, roughness: 0.8 });
      for (const bx of [0, 4.4]) {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, length * 1.2), deckMat);
        deck.position.set(bx, -0.2, -length * 0.28);
        hall.add(deck);
        /* rope posts */
        for (let i = 0; i < 6; i++) {
          for (const side of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), deckMat);
            post.position.set(bx + side * 1.2, 0.5, -2 - i * (length * 0.16));
            hall.add(post);
          }
        }
      }
      add((t) => { lava.material.opacity = 0.12 + Math.sin(t * 0.8) * 0.05; });
    }
  },

  /* ---- ACT III · the obsidian throne ---- */

  c1: { // The Spider Room — a web of light with packets crawling its threads
    build({ hall, look, width, length, height, rnd, add }) {
      const nodes = [];
      for (let i = 0; i < 11; i++) {
        const n = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xb79cf7 })
        );
        n.position.set((rnd() - 0.5) * width * 0.85,
                       1 + rnd() * (height - 2),
                       -3 - rnd() * length * 0.42);
        hall.add(n);
        nodes.push(n.position);
      }
      const runners = [];
      const lineMat = new THREE.LineBasicMaterial({ color: 0x5b3aa8, transparent: true, opacity: 0.55 });
      for (let i = 0; i < nodes.length; i++) {
        const j = (i * 3 + 1) % nodes.length;
        if (i === j) continue;
        const geo = new THREE.BufferGeometry().setFromPoints([nodes[i], nodes[j]]);
        hall.add(new THREE.Line(geo, lineMat));
        /* a data-packet that walks this strand */
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xd8c8ff })
        );
        hall.add(dot);
        runners.push({ dot, a: nodes[i], b: nodes[j], ph: rnd() * 6.28, sp: 0.2 + rnd() * 0.35 });
      }
      add((t) => {
        for (const r of runners) {
          const k = (Math.sin(t * r.sp + r.ph) + 1) / 2;
          r.dot.position.lerpVectors(r.a, r.b, k);
        }
      });
    }
  },

  c2: { // The Cold Forge — an anvil, a flame frozen mid-leap, sparks hanging still
    build({ hall, look, width, length, rnd, add }) {
      const iron = new THREE.MeshStandardMaterial({ color: 0x14142c, metalness: 0.8, roughness: 0.3 });
      const anvil = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.6), iron);
      anvil.position.set(-1.8, 0.95, -4.4);
      hall.add(anvil);
      const anvilBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), iron);
      anvilBase.position.set(-1.8, 0.35, -4.4);
      hall.add(anvilBase);
      /* the flame, stopped mid-leap the day the Compiler broke */
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.6, 7),
        new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.5 })
      );
      flame.position.set(1.9, 1.6, -5);
      flame.rotation.z = -0.3;                    // leaning, as if caught by wind
      hall.add(flame);
      const hearth = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 8), iron);
      hearth.position.set(1.9, 0.4, -5);
      hall.add(hearth);
      const cold = new THREE.PointLight(0x9fe4ff, 9, 10, 2);
      cold.position.set(1.9, 2, -5);
      hall.add(cold);
      /* sparks suspended in the air — one at a time remembers how to fall */
      const sparks = [];
      for (let i = 0; i < 26; i++) {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 5, 5),
          new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.9 })
        );
        s.position.set(1.9 + (rnd() - 0.5) * 2.4, 1.4 + rnd() * 2.6, -5 + (rnd() - 0.5) * 2);
        s.userData.home = s.position.clone();
        hall.add(s);
        sparks.push(s);
      }
      add((t, dt) => {
        flame.material.opacity = 0.44 + Math.sin(t * 0.5) * 0.08;   // almost still
        cold.intensity = 8 + Math.sin(t * 0.5) * 1.2;
        const chosen = Math.floor(t / 4) % sparks.length;           // every 4s, one falls
        sparks.forEach((s, i) => {
          if (i === chosen) {
            s.position.y -= dt * 0.5;
            s.material.opacity = Math.max(0, s.material.opacity - dt * 0.25);
          } else if (s.material.opacity < 0.9) {
            s.position.copy(s.userData.home);
            s.material.opacity = 0.9;
          }
        });
      });
    }
  },

  c3: { // The Broken Ledger — a giant book bleeding glitched entries
    build({ hall, look, width, length, height, rnd, add }) {
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(3, 0.3, 2),
        new THREE.MeshStandardMaterial({ color: 0x1b1a38, roughness: 0.7 })
      );
      desk.position.set(2.2, 1.1, -4.6);
      hall.add(desk);
      /* the ledger itself, open, pages tilted like a broken roof */
      for (const side of [-1, 1]) {
        const page = plate(1.4, 1.8, 0xe8e2d0, 0.95);
        page.position.set(2.2 + side * 0.68, 1.36, -4.6);
        page.rotation.x = -Math.PI / 2 + 0.16;
        page.rotation.y = side * -0.24;
        hall.add(page);
      }
      /* corrupted entries — red glyph-strips that stutter in and out */
      const glitches = [];
      for (let i = 0; i < 9; i++) {
        const g = plate(0.9, 0.12, 0xff4a3c, 0, true);
        g.position.set(2.2 + (rnd() - 0.5) * 1.6, 1.6 + rnd() * 2.2, -4.6 + (rnd() - 0.5) * 1.4);
        hall.add(g);
        glitches.push({ g, seed: rnd() * 100 });
      }
      /* torn shreds orbiting the desk in a slow panic */
      const shreds = [];
      for (let i = 0; i < 14; i++) {
        const s = plate(0.2, 0.26, 0xd8cfb8, 0.8);
        hall.add(s);
        shreds.push({ s, r: 1.4 + rnd() * 1.8, ph: rnd() * 6.28, y: 1.4 + rnd() * 2, sp: 0.3 + rnd() * 0.5 });
      }
      add((t, dt) => {
        for (const { g, seed } of glitches) {
          /* deterministic stutter, no RNG in the hot loop */
          const n = Math.sin(t * 13 + seed) * Math.sin(t * 7.3 + seed * 2);
          g.material.opacity = n > 0.55 ? 0.85 : 0;
        }
        for (const sh of shreds) {
          sh.ph += dt * sh.sp;
          sh.s.position.set(2.2 + Math.cos(sh.ph) * sh.r, sh.y + Math.sin(t + sh.ph) * 0.2,
                            -4.6 + Math.sin(sh.ph) * sh.r);
          sh.s.rotation.y = sh.ph;
          sh.s.rotation.x = Math.sin(t * 2 + sh.ph) * 0.6;
        }
      });
    }
  },

  c4: { // The Obsidian Throne — the seat of the man who stopped the world
    build({ hall, look, width, length, height, add }) {
      const obsidian = new THREE.MeshStandardMaterial({
        color: 0x0c0c20, metalness: 0.75, roughness: 0.22,
        emissive: 0x5b3aa8, emissiveIntensity: 0.1
      });
      /* dais steps */
      for (let i = 0; i < 3; i++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(7 - i * 1.6, 0.42, 4.6 - i), obsidian);
        step.position.set(0, 0.21 + i * 0.42, -7.4);
        hall.add(step);
      }
      /* the throne — a jagged black chair, far too large for a person */
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 4.6, 0.5), obsidian);
      seatBack.position.set(0, 3.4, -8.6);
      seatBack.rotation.x = -0.06;
      hall.add(seatBack);
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.2, 5), obsidian);
        horn.position.set(side * 0.95, 6.1, -8.6);
        horn.rotation.z = side * -0.3;
        hall.add(horn);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 2.2), obsidian);
        arm.position.set(side * 1.05, 1.9, -7.8);
        hall.add(arm);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 2), obsidian);
      seat.position.set(0, 1.5, -7.9);
      hall.add(seat);
      /* the futures he computed — a slow galaxy of possibilities over the throne */
      const futures = new THREE.Group();
      for (let i = 0; i < 60; i++) {
        const f = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.07, 0.07),
          new THREE.MeshBasicMaterial({
            color: i % 5 ? 0xb79cf7 : 0x9fe4ff, transparent: true, opacity: 0.75
          })
        );
        const a = (i / 60) * Math.PI * 2 * 3.7;
        const r = 1.2 + (i / 60) * 2.6;
        f.position.set(Math.cos(a) * r, (i / 60) * 2.4, Math.sin(a) * r * 0.5);
        futures.add(f);
      }
      futures.position.set(0, 5.4, -8.4);
      hall.add(futures);
      add((t, dt) => {
        futures.rotation.y += dt * 0.14;
        futures.children.forEach((f, i) => {
          f.material.opacity = 0.4 + Math.abs(Math.sin(t * 0.6 + i * 0.7)) * 0.5;
        });
      });
    }
  }
};

/* ============================================================
   hall construction — one per level, seeded by level id
   ============================================================ */
function buildHall(level, actN) {
  disposeHall();

  const look = ACT_LOOK[actN] || ACT_LOOK[1];
  const rnd = rngFrom(hash(level.id));
  const piece = SETPIECE[level.id] || null;
  const outdoor = !!(piece && piece.outdoor);

  /* per-level geometry variation */
  const width  = 7 + rnd() * 5;          // 7 – 12 m across
  const length = 26 + rnd() * 14;        // 26 – 40 m deep
  const height = 5 + rnd() * 4;          // 5 – 9 m tall
  const pillarCount = 4 + Math.floor(rnd() * 4);
  const pillarStyle = Math.floor(rnd() * 3);

  hall = new THREE.Group();
  hall.userData.anims = [];
  scene.add(hall);

  /* outdoors the fog opens up — you can see weather and horizon */
  scene.fog = new THREE.Fog(look.fog, look.fogNear, outdoor ? look.fogFar * 1.7 : look.fogFar);
  scene.background = new THREE.Color(look.fog);

  /* ---- floor ---- */
  const floorMat = new THREE.MeshStandardMaterial({
    color: look.floor, roughness: 0.86, metalness: 0.16
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.4, length * 1.6), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -length * 0.3;
  hall.add(floor);

  /* Act I floods its halls — a faint reflective sheet just above the stone */
  if (actN === 1) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 2.4, length * 1.6),
      new THREE.MeshStandardMaterial({
        color: look.rim, roughness: 0.06, metalness: 0.94,
        transparent: true, opacity: 0.5
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.05, -length * 0.3);
    hall.add(water);
    hall.userData.water = water;
  }

  /* ---- walls + ceiling (indoor halls only) ---- */
  const wallMat = new THREE.MeshStandardMaterial({ color: look.wall, roughness: 0.95 });
  const spacing = length / (pillarCount + 1);
  if (!outdoor) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, height, length * 1.4), wallMat);
      w.position.set(side * width / 2, height / 2, -length * 0.3);
      hall.add(w);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, length * 1.4), wallMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, height, -length * 0.3);
    hall.add(ceil);

    /* pillars, rhythm varies per level */
    const pillarMat = new THREE.MeshStandardMaterial({
      color: look.pillar, roughness: 0.8, metalness: 0.22
    });
    let pillarGeo;
    if (pillarStyle === 0)      pillarGeo = new THREE.CylinderGeometry(0.34, 0.44, height, 8);
    else if (pillarStyle === 1) pillarGeo = new THREE.BoxGeometry(0.7, height, 0.7);
    else                        pillarGeo = new THREE.CylinderGeometry(0.3, 0.3, height, 6);

    for (let i = 0; i < pillarCount; i++) {
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(pillarGeo, pillarMat);
        p.position.set(side * (width / 2 - 1.1), height / 2, -i * spacing - 2);
        /* broken halls lean */
        p.rotation.z = (rnd() - 0.5) * 0.06;
        hall.add(p);
      }
    }
  }

  /* ---- the far wall, carrying the seal (outdoors the seal hangs in air) ---- */
  if (!outdoor) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.6), wallMat);
    back.position.set(0, height / 2, -length * 0.62);
    hall.add(back);
  }

  const sealRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.07, 8, 48),
    new THREE.MeshBasicMaterial({ color: look.key, transparent: true, opacity: 0.55 })
  );
  sealRing.position.set(0, height * 0.5, -length * 0.62 + 0.4);
  hall.add(sealRing);
  hall.userData.sealRing = sealRing;

  /* ---- lighting ---- */
  hall.add(new THREE.AmbientLight(0xffffff, 1.15));
  hall.add(new THREE.HemisphereLight(look.key, look.rim, 1.6));

  /* Glowing strips where the walls meet the floor. These do most of the
     architectural work — they give the hall a readable perspective even
     when the fog eats everything else. */
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.05, length * 1.35),
      new THREE.MeshBasicMaterial({ color: look.key, transparent: true, opacity: 0.55 })
    );
    strip.position.set(side * (width / 2 - 0.34), 0.03, -length * 0.3);
    hall.add(strip);
  }

  /* the light the keeper throws — puts it in silhouette against the far wall */
  const keyLight = new THREE.PointLight(look.key, 42, 30, 2);
  keyLight.position.set(0, height * 0.62, -9);
  hall.add(keyLight);
  hall.userData.keyLight = keyLight;

  const rimLight = new THREE.PointLight(look.rim, 26, 26, 2);
  rimLight.position.set(0, 2.2, -length * 0.5);
  hall.add(rimLight);

  /* a soft fill just behind you so near pillars are not pure black */
  const fill = new THREE.PointLight(look.rim, 8, 16, 2);
  fill.position.set(0, 3, 6);
  hall.add(fill);

  /* torch light travelling with you, so the hall reveals as you walk */
  const torch = new THREE.PointLight(look.ember, 12, 14, 2);
  hall.add(torch);
  hall.userData.torch = torch;

  /* ---- act props (indoor flavor; setpieces own the outdoor stages) ---- */
  if (actN === 2 && !outdoor) {              // braziers burning down the hall
    for (let i = 0; i < pillarCount; i++) {
      for (const side of [-1, 1]) {
        const bowl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.16, 0.3, 8),
          new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.9 })
        );
        bowl.position.set(side * (width / 2 - 1.1), 1.3, -i * spacing - 2);
        hall.add(bowl);
        const fire = new THREE.PointLight(0xff8a30, 7, 7, 2);
        fire.position.copy(bowl.position);
        fire.position.y += 0.35;
        hall.add(fire);
        (hall.userData.fires ||= []).push(fire);
      }
    }
  }
  if (actN === 3 && !outdoor) {              // obsidian shards adrift
    hall.userData.shards = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16 + rnd() * 0.3, 0),
        new THREE.MeshStandardMaterial({
          color: 0x1a1a38, roughness: 0.25, metalness: 0.7,
          emissive: look.rim, emissiveIntensity: 0.35
        })
      );
      s.position.set((rnd() - 0.5) * width * 0.8, 1 + rnd() * height * 0.7, -rnd() * length * 0.55);
      hall.add(s);
      hall.userData.shards.push({ mesh: s, spin: (rnd() - 0.5) * 0.4, bob: rnd() * 6.28 });
    }
  }

  /* ---- the story's stage for this specific place ---- */
  if (piece) {
    piece.build({
      hall, look, rnd, width, length, height,
      add: (fn) => hall.userData.anims.push(fn)
    });
  }

  buildMotes(look, width, length, height);
  buildKeeper(level, look, rnd);
  buildVex(look);

  /* the walk-in starts from the doorway */
  cam.z = 9.5;
  cam.targetZ = 3.6;
  cam.walking = true;
  camera.position.set(0, 1.7, cam.z);
}

/* ---------- drifting particles ---------- */
function buildMotes(look, width, length, height) {
  const n = 260;
  const pos = new Float32Array(n * 3);
  const spd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * width * 1.1;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = -Math.random() * length * 0.7 + 4;
    spd[i] = 0.3 + Math.random() * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  motes = new THREE.Points(geo, new THREE.PointsMaterial({
    color: look.ember, size: look.fall === 'rain' ? 0.035 : 0.055,
    transparent: true, opacity: 0.45, depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  motes.userData = { spd, mode: look.fall, height, length, width };
  hall.add(motes);
}

/* ---------- the seal-keeper ---------- */
function buildKeeper(level, look, rnd) {
  /* The last keeper is not a construct. Orrin is a man. */
  if (level.id === 'c4') { buildOrrin(look); return; }

  const g = new THREE.Group();
  const tall = 3.2 + rnd() * 1.8;            // 3.2 – 5 m: it towers over you
  const girth = 0.75 + rnd() * 0.5;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: look.keeper, roughness: 0.62, metalness: 0.45,
    emissive: look.rim, emissiveIntensity: 0.12
  });

  /* body — a tapered mass, wider at the shoulder */
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(girth * 0.95, girth * 0.55, tall * 0.72, 7),
    bodyMat
  );
  body.position.y = tall * 0.36;
  g.add(body);

  /* shoulders */
  const shoulders = new THREE.Mesh(
    new THREE.BoxGeometry(girth * 2.5, girth * 0.42, girth * 1.15),
    bodyMat
  );
  shoulders.position.y = tall * 0.70;
  g.add(shoulders);

  /* head — faceted, no face. These things are not people any more. */
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(girth * 0.66, 0), bodyMat);
  head.position.y = tall * 0.86;
  g.add(head);

  /* two burning eyes */
  const eyeMat = new THREE.MeshBasicMaterial({ color: look.eye });
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(girth * 0.1, 8, 8), eyeMat.clone());
    e.position.set(sx * girth * 0.24, tall * 0.87, girth * 0.55);
    g.add(e);
    eyes.push(e);
  }
  const glow = new THREE.PointLight(look.eye, 4, 8, 2);
  glow.position.set(0, tall * 0.87, girth);
  g.add(glow);

  /* sigil rings — the fragment of the Compiler it is still running */
  const ringCount = 1 + Math.floor(rnd() * 3);
  const rings = [];
  for (let i = 0; i < ringCount; i++) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(girth * (1.5 + i * 0.42), 0.028, 6, 40),
      new THREE.MeshBasicMaterial({ color: look.key, transparent: true, opacity: 0.65 })
    );
    r.position.y = tall * (0.45 + rnd() * 0.35);
    r.rotation.x = Math.PI / 2 + (rnd() - 0.5) * 0.25;
    r.rotation.y = rnd() * Math.PI;
    g.add(r);
    rings.push({ mesh: r, spin: (rnd() - 0.5) * 0.55 + 0.18, tilt: (rnd() - 0.5) * 0.2 });
  }

  g.position.set(0, 0, -5.6);
  hall.add(g);

  keeper = { group: g, head, eyes, glow, rings, tall, alive: true, breakT: -1 };

  /* The Twinned Sentinel is two of the same thing, out of phase. */
  if (level.id === 'b4') {
    const ghost = g.clone(true);
    ghost.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.3;
      }
    });
    ghost.position.set(4.4, 0, -5.6);
    hall.add(ghost);
    keeper.ghost = ghost;
  }
}

/* ---------- Orrin, the Architect before you ---------- */
function buildOrrin(look) {
  const g = new THREE.Group();
  const tall = 1.9;                              // human height — that's the point
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x1a1830, roughness: 0.85, metalness: 0.1
  });

  /* long robe */
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, tall * 0.78, 8), cloth);
  robe.position.y = tall * 0.39;
  g.add(robe);
  /* shoulders + head */
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, tall * 0.24, 7), cloth);
  chest.position.y = tall * 0.72;
  g.add(chest);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.7 })
  );
  head.position.y = tall * 0.94;
  g.add(head);
  /* the Architect's circlet — a thin ring of the same light the seals use */
  const circlet = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.014, 6, 24),
    new THREE.MeshBasicMaterial({ color: look.key, transparent: true, opacity: 1 })
  );
  circlet.position.y = tall * 0.97;
  circlet.rotation.x = Math.PI / 2.3;
  g.add(circlet);
  /* his staff, planted */
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, tall * 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2444, metalness: 0.5, roughness: 0.4 })
  );
  staff.position.set(0.42, tall * 0.6, 0.1);
  g.add(staff);
  const staffTip = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.09, 0),
    new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 1 })
  );
  staffTip.position.set(0.42, tall * 1.24, 0.1);
  g.add(staffTip);
  const glow = new THREE.PointLight(0x9fe4ff, 3, 7, 2);
  glow.position.set(0.42, tall * 1.24, 0.4);
  g.add(glow);

  /* he stands on the dais, in front of his own throne */
  g.position.set(0, 1.26, -6.2);
  hall.add(g);

  /* same contract as a keeper, so the whole rig just works:
     eyes -> staff tip (flares when he speaks), rings -> circlet + tip
     (they fly apart when the last seal breaks). */
  keeper = {
    group: g, head, eyes: [staffTip], glow,
    rings: [
      { mesh: circlet, spin: 0.3, tilt: 0 },
      { mesh: staffTip, spin: 0.8, tilt: 0.1 }
    ],
    tall, alive: true, breakT: -1, human: true
  };
}

/* ---------- Vex, at your shoulder ---------- */
function buildVex(look) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.035, 0),
    new THREE.MeshBasicMaterial({ color: 0x9ff0e6 })
  );
  g.add(core);
  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.065, 0),
    new THREE.MeshBasicMaterial({ color: 0x5ad1c8, wireframe: true, transparent: true, opacity: 0.55 })
  );
  g.add(shell);
  g.add(new THREE.PointLight(0x5ad1c8, 1.4, 3, 2));
  scene.add(g);
  vex = { group: g, core, shell };
}

/* ---------- teardown ---------- */
function disposeHall() {
  if (vex) { scene.remove(vex.group); disposeTree(vex.group); vex = null; }
  if (!hall) return;
  scene.remove(hall);
  disposeTree(hall);
  hall = null; keeper = null; motes = null;
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}

/* ============================================================
   animation
   ============================================================ */
function tick() {
  raf = requestAnimationFrame(tick);
  if (frozen) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  /* --- camera: walk in, then breathe --- */
  if (cam.walking) {
    cam.z += (cam.targetZ - cam.z) * Math.min(dt * 1.6, 1);
    if (Math.abs(cam.z - cam.targetZ) < 0.02) { cam.z = cam.targetZ; cam.walking = false; }
    cam.bob += dt * 7;
  } else {
    cam.bob += dt * 1.5;
  }
  const bobAmt = cam.walking ? 0.045 : 0.012;
  camera.position.z = cam.z;
  camera.position.y = 1.7 + Math.sin(cam.bob) * bobAmt;
  camera.position.x = Math.sin(cam.bob * 0.5) * (cam.walking ? 0.05 : 0.02);

  if (cam.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * cam.shake;
    camera.position.y += (Math.random() - 0.5) * cam.shake;
    cam.shake *= 0.88;
  }

  cam.yaw += (cam.targetYaw - cam.yaw) * 0.05;
  cam.pitch += (cam.targetPitch - cam.pitch) * 0.05;
  camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');

  /* --- torch follows you --- */
  if (hall?.userData.torch) {
    hall.userData.torch.position.set(camera.position.x + 0.4, 1.9, camera.position.z - 0.4);
    hall.userData.torch.intensity = 11 + Math.sin(t * 9) * 1.6 + Math.sin(t * 21) * 0.8;
  }
  if (hall?.userData.fires) {
    hall.userData.fires.forEach((f, i) => {
      f.intensity = 6 + Math.sin(t * 8 + i * 1.7) * 1.4 + Math.sin(t * 17 + i) * 0.7;
    });
  }
  if (hall?.userData.sealRing) {
    hall.userData.sealRing.rotation.z = t * 0.16;
    hall.userData.sealRing.material.opacity = 0.42 + Math.sin(t * 1.4) * 0.16;
  }
  if (hall?.userData.shards) {
    hall.userData.shards.forEach((s) => {
      s.mesh.rotation.x += s.spin * dt;
      s.mesh.rotation.y += s.spin * dt * 0.7;
      s.mesh.position.y += Math.sin(t * 0.7 + s.bob) * dt * 0.12;
    });
  }
  if (hall?.userData.water) {
    hall.userData.water.position.y = 0.05 + Math.sin(t * 0.8) * 0.012;
  }

  /* --- the story's stage, playing --- */
  if (hall?.userData.anims) {
    for (const fn of hall.userData.anims) fn(t, dt);
  }

  /* --- the keeper: breathing, watching, speaking --- */
  if (keeper?.alive) {
    const k = keeper.group;
    const baseY = keeper.human ? 1.26 : 0;         // Orrin stands on his dais
    const headY = keeper.tall * (keeper.human ? 0.94 : 0.86);
    k.position.y = baseY + Math.sin(t * 0.9) * (keeper.human ? 0.015 : 0.09);
    k.rotation.y = Math.sin(t * 0.35) * (keeper.human ? 0.04 : 0.09);
    keeper.head.rotation.y = Math.sin(t * 0.5) * 0.22;
    keeper.head.position.y = headY + Math.sin(t * 1.3) * (keeper.human ? 0.008 : 0.03);
    if (keeper.ghost) {                             // the twin, half a beat behind
      keeper.ghost.position.y = Math.sin(t * 0.9 - 0.9) * 0.09;
      keeper.ghost.rotation.y = Math.sin(t * 0.35 - 0.9) * 0.09;
    }

    const talking = speaker === 'KEEPER' || speaker === 'ORRIN';
    const pulse = talking
      ? 0.7 + Math.abs(Math.sin(t * 7)) * 0.9        // eyes flare on its lines
      : 0.45 + Math.sin(t * 1.6) * 0.2;
    keeper.eyes.forEach((e) => { e.scale.setScalar(0.8 + pulse * 0.5); });
    keeper.glow.intensity = 3 + pulse * 4;

    keeper.rings.forEach((r) => {
      r.mesh.rotation.z += r.spin * dt;
      r.mesh.rotation.x += r.tilt * dt * 0.4;
    });
  } else if (keeper && keeper.breakT >= 0) {
    /* defeat: the rings fly apart and the light goes out of it */
    keeper.breakT += dt;
    const p = Math.min(keeper.breakT / 2.2, 1);
    keeper.rings.forEach((r, i) => {
      r.mesh.position.y += dt * (0.7 + i * 0.35);
      r.mesh.scale.setScalar(1 + p * 2.2);
      r.mesh.material.opacity = 0.65 * (1 - p);
      r.mesh.rotation.z += r.spin * dt * 3;
    });
    keeper.eyes.forEach((e) => e.scale.setScalar(Math.max(0.001, 1 - p)));
    keeper.glow.intensity = 7 * (1 - p);
    /* it settles, finally allowed to stop — Orrin only bows his head */
    keeper.group.position.y = (keeper.human ? 1.26 : 0) - p * (keeper.human ? 0.1 : 0.55);
    if (keeper.human) keeper.head.rotation.x = p * 0.5;
    if (keeper.ghost) {
      keeper.ghost.traverse((o) => {
        if (o.material?.opacity !== undefined) o.material.opacity = 0.3 * (1 - p);
      });
    }

    /* the way forward opens: a door of light on the far wall, and the
       camera leans toward it */
    if (hall?.userData.winDoor) {
      const d = hall.userData.winDoor;
      d.material.opacity = Math.min(0.85, p * 1.1);
      d.scale.y = 0.2 + p * 0.8;
      cam.targetZ = 2.7;
      if (!cam.walking && Math.abs(cam.z - cam.targetZ) > 0.02) {
        cam.z += (cam.targetZ - cam.z) * dt * 0.5;
      }
    }
  }

  /* --- Vex rides at your shoulder --- */
  if (vex) {
    const off = new THREE.Vector3(-0.62, -0.34, -1.5).applyEuler(camera.rotation);
    vex.group.position.copy(camera.position).add(off);
    const talking = speaker === 'VEX';
    vex.group.rotation.y += dt * (talking ? 3.4 : 0.8);
    vex.group.rotation.x += dt * 0.35;
    const s = talking ? 1.25 + Math.sin(t * 12) * 0.14 : 1;
    vex.group.scale.setScalar(s);
    vex.shell.material.opacity = talking ? 0.85 : 0.5;
  }

  /* --- weather --- */
  if (motes) {
    const p = motes.geometry.attributes.position;
    const { spd, mode, height, width, length } = motes.userData;
    for (let i = 0; i < spd.length; i++) {
      const iy = i * 3 + 1;
      if (mode === 'ember') {
        p.array[iy] += spd[i] * dt * 0.55;
        if (p.array[iy] > height) p.array[iy] = 0;
      } else {
        p.array[iy] -= spd[i] * dt * (mode === 'rain' ? 3.2 : 0.5);
        if (p.array[iy] < 0) p.array[iy] = height;
      }
      if (mode !== 'rain') {
        p.array[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.06;
      }
    }
    p.needsUpdate = true;
  }

  if (speakPulse > 0) speakPulse -= dt;
  renderer.render(scene, camera);
}

function start() {
  if (raf === null) { clock.getDelta(); raf = requestAnimationFrame(tick); }
  running = true;
}
function stop() {
  if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
  running = false;
}

/* ============================================================
   public API — consumed by game.js
   ============================================================ */
const World = {
  supported: false,

  /** Walk into a level's hall. */
  enter(level, actN) {
    if (!ready) return;
    canvas.classList.add('is-on');
    canvas.classList.remove('is-frozen');
    frozen = false;
    buildHall(level, actN);
    if (reduced) { cam.z = cam.targetZ; cam.walking = false; camera.position.z = cam.z; }
    start();
  },

  /** Who is talking right now — drives eye flare and Vex's spin. */
  speak(who) { speaker = who; speakPulse = 0.4; },

  /**
   * The story pauses. Freeze mid-motion, blur back, stop rendering
   * entirely so a student typing for ten minutes costs no GPU.
   */
  pause() {
    if (!ready || !hall) return;
    renderer.render(scene, camera);      // one last crisp frame to freeze on
    frozen = true;
    stop();
    canvas.classList.add('is-frozen');
  },

  /** The story resumes. */
  resume() {
    if (!ready || !hall) return;
    canvas.classList.remove('is-frozen');
    frozen = false;
    start();
  },

  /** The seal breaks: rings fly apart, the keeper is allowed to stop,
      and the way forward opens as a door of light. */
  win() {
    if (!keeper) return;
    this.resume();
    keeper.alive = false;
    keeper.breakT = 0;
    cam.shake = 0.16;
    if (hall?.userData.keyLight) hall.userData.keyLight.intensity = 90;
    if (hall && !hall.userData.winDoor) {
      const door = plate(2.2, 4.4, 0xfff2d8, 0, true);
      /* just in front of the far wall, behind the fallen keeper */
      door.position.set(0, 2.2, keeper.group.position.z - 3.4);
      hall.add(door);
      hall.userData.winDoor = door;
      const doorLight = new THREE.PointLight(0xffe6b8, 0, 20, 2);
      doorLight.position.copy(door.position);
      hall.add(doorLight);
      hall.userData.anims.push((t, dt) => {
        doorLight.intensity = Math.min(30, doorLight.intensity + dt * 9);
      });
    }
  },

  /**
   * Epilogue: the throne hall again, empty, while dawn — the first in
   * two hundred years — comes up through the fog.
   */
  epilogue() {
    if (!ready) return;
    canvas.classList.add('is-on');
    canvas.classList.remove('is-frozen');
    frozen = false;
    buildHall({ id: 'c4' }, 3);

    /* no keeper: Orrin has already walked down the mountain */
    if (keeper) { hall.remove(keeper.group); disposeTree(keeper.group); keeper = null; }

    const dawn = new THREE.Color(0x7a4a2a);
    const sun = new THREE.PointLight(0xffc890, 0, 60, 2);
    sun.position.set(0, 3, -14);
    hall.add(sun);
    let k = 0;
    hall.userData.anims.push((t, dt) => {
      k = Math.min(1, k + dt * 0.055);            // ~18s of sunrise
      scene.fog.color.lerpColors(new THREE.Color(ACT_LOOK[3].fog), dawn, k);
      scene.background.copy(scene.fog.color);
      sun.intensity = k * 34;
      sun.position.y = 3 + k * 6;
    });

    /* a slow, unhurried drift toward the empty throne */
    cam.z = 6.5;
    cam.targetZ = 2.4;
    cam.walking = false;
    hall.userData.anims.push((t, dt) => {
      cam.z += (cam.targetZ - cam.z) * dt * 0.05;
    });
    if (reduced) { cam.z = 3.5; }
    start();
  },

  /** A failed strike rattles the hall. */
  jolt() { cam.shake = 0.1; },

  /** Leave the world (map, title, epilogue). */
  leave() {
    if (!ready) return;
    stop();
    frozen = false;
    canvas.classList.remove('is-on', 'is-frozen');
    disposeHall();
  }
};

/* ---------- boot, and drain anything game.js queued ---------- */
if (init()) {
  World.supported = true;
  const queued = (window.World && window.World._q) || [];
  window.World = World;
  queued.forEach(([fn, args]) => { if (typeof World[fn] === 'function') World[fn](...args); });
} else {
  window.World = Object.assign(window.World || {}, {
    supported: false,
    enter() {}, speak() {}, pause() {}, resume() {}, win() {}, jolt() {}, leave() {}, epilogue() {}
  });
}
