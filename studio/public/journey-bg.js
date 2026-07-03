/* journey-bg.js — the world you travel through in Career-Ops Studio.
 *
 * A calm dot-terrain rolls beneath you; a warm path of light curves ahead
 * toward a soft sun on the horizon — the destination. Each stage of the app
 * eases the camera further down the path. During the "about you" stage a
 * dotted globe rises and marks the user's cities.
 *
 * Palette matches the UI (ivory, sand, terracotta). If WebGL or the CDN is
 * unavailable, the canvas stays empty and the app works identically.
 */

const API = {
  setStage(i) { queue.push(() => impl && impl.setStage(i)); flush(); },
  setCities(names) { queue.push(() => impl && impl.setCities(names)); flush(); },
  setGlobe(on) { queue.push(() => impl && impl.setGlobe(on)); flush(); },
};
window.journeyBg = API;
const queue = [];
let impl = null;
function flush() { if (impl) while (queue.length) queue.shift()(); }

const CITIES = {
  "new york": [40.7, -74.0], "san francisco": [37.8, -122.4], "seattle": [47.6, -122.3],
  "austin": [30.3, -97.7], "boston": [42.4, -71.1], "chicago": [41.9, -87.6],
  "los angeles": [34.1, -118.2], "denver": [39.7, -105.0], "atlanta": [33.7, -84.4],
  "toronto": [43.7, -79.4], "vancouver": [49.3, -123.1], "mexico city": [19.4, -99.1],
  "sao paulo": [-23.6, -46.6], "london": [51.5, -0.1], "dublin": [53.3, -6.3],
  "paris": [48.9, 2.4], "berlin": [52.5, 13.4], "munich": [48.1, 11.6],
  "amsterdam": [52.4, 4.9], "zurich": [47.4, 8.5], "stockholm": [59.3, 18.1],
  "madrid": [40.4, -3.7], "barcelona": [41.4, 2.2], "lisbon": [38.7, -9.1],
  "milan": [45.5, 9.2], "warsaw": [52.2, 21.0], "dubai": [25.2, 55.3],
  "tel aviv": [32.1, 34.8], "bangalore": [13.0, 77.6], "bengaluru": [13.0, 77.6],
  "hyderabad": [17.4, 78.5], "mumbai": [19.1, 72.9], "delhi": [28.6, 77.2],
  "pune": [18.5, 73.9], "chennai": [13.1, 80.3], "singapore": [1.35, 103.8],
  "hong kong": [22.3, 114.2], "tokyo": [35.7, 139.7], "seoul": [37.6, 127.0],
  "sydney": [-33.9, 151.2], "melbourne": [-37.8, 145.0], "auckland": [-36.8, 174.8],
  "usa": [39.8, -98.6], "united states": [39.8, -98.6], "india": [22.0, 79.0],
  "canada": [56.1, -106.3], "uk": [54.0, -2.0], "united kingdom": [54.0, -2.0],
  "germany": [51.2, 10.4], "france": [46.6, 2.2], "australia": [-25.3, 133.8],
  "netherlands": [52.1, 5.3], "spain": [40.5, -3.7], "japan": [36.2, 138.3],
  "brazil": [-14.2, -51.9], "remote": null,
};

let THREE;
try {
  THREE = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
} catch {
  console.warn("[journey-bg] three.js unavailable — background disabled.");
}

if (THREE) {
  const canvas = document.getElementById("bg");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xfaf9f5, 0.0105);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);

  // Round, softly-shaded sprite so every point renders as a tiny sphere
  // instead of a hard square.
  function discTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(26, 24, 4, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,.85)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    return new THREE.CanvasTexture(c);
  }
  const DISC = discTexture();

  // The route: a gentle S-curve through the world. Camera and path both follow it.
  const pathX = (z) => Math.sin(z * 0.02) * 9;

  // ── Terrain: a rolling sea of sand dots ──────────────────────────
  const TW = 110, TD = 190, SPACING = 2.1;
  const tCount = TW * TD;
  const tPos = new Float32Array(tCount * 3);
  const tPhase = new Float32Array(tCount);
  let k = 0;
  for (let zi = 0; zi < TD; zi++) {
    for (let xi = 0; xi < TW; xi++) {
      const x = (xi - TW / 2) * SPACING;
      const z = 80 - zi * SPACING;
      tPos[k * 3] = x; tPos[k * 3 + 1] = 0; tPos[k * 3 + 2] = z;
      tPhase[k] = (x * 0.35 + z * 0.22);
      k++;
    }
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
  const terrain = new THREE.Points(tGeo, new THREE.PointsMaterial({
    size: 0.8, color: 0xcbbfa8, map: DISC, alphaTest: 0.15, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  scene.add(terrain);

  // ── The path: brighter terracotta dots tracing the route ahead ──
  const PN = 260;
  const pPos = new Float32Array(PN * 3);
  for (let i = 0; i < PN; i++) {
    const z = 70 - i * 1.55;
    const lane = (i % 2 === 0 ? 1 : -1) * 0.9; // two dotted edges of the path
    pPos[i * 3] = pathX(z) + lane;
    pPos[i * 3 + 1] = -5.4;
    pPos[i * 3 + 2] = z;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const path = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 1.15, color: 0xd97757, map: DISC, alphaTest: 0.15, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  scene.add(path);

  // ── The sun on the horizon: destination glow ─────────────────────
  const sunCanvas = document.createElement("canvas");
  sunCanvas.width = sunCanvas.height = 256;
  const g = sunCanvas.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, "rgba(217,119,87,0.95)");
  grad.addColorStop(0.35, "rgba(226,158,118,0.55)");
  grad.addColorStop(1, "rgba(250,249,245,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(sunCanvas), transparent: true, opacity: 0.9, depthWrite: false,
  }));
  sun.scale.set(46, 46, 1);
  scene.add(sun);

  // ── Sparse drifting motes for depth ──────────────────────────────
  const MN = 320;
  const mPos = new Float32Array(MN * 3);
  for (let i = 0; i < MN; i++) {
    mPos[i * 3] = (Math.random() - 0.5) * 130;
    mPos[i * 3 + 1] = Math.random() * 26 - 4;
    mPos[i * 3 + 2] = 80 - Math.random() * 380;
  }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute("position", new THREE.BufferAttribute(mPos, 3));
  const motes = new THREE.Points(mGeo, new THREE.PointsMaterial({
    size: 0.7, color: 0xd9a288, map: DISC, alphaTest: 0.15, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  scene.add(motes);

  // ── Dotted globe (rises during the "about you" stage) ────────────
  const globe = new THREE.Group();
  const R = 10;
  const gpts = [];
  for (let i = 0; i < 900; i++) {
    const y = 1 - (i / 899) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    gpts.push(Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R);
  }
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(gpts), 3));
  const gMat = new THREE.PointsMaterial({ size: 0.3, color: 0xb09a7e, map: DISC, alphaTest: 0.15, transparent: true, opacity: 0 });
  globe.add(new THREE.Points(gGeo, gMat));
  const markers = new THREE.Group();
  globe.add(markers);
  scene.add(globe);

  const latLon = (lat, lon, r = R) => {
    const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  };

  // ── State ─────────────────────────────────────────────────────────
  let camZ = 62, camZTarget = 62, globeTarget = 0, globeOpacity = 0;
  let mouseX = 0, mouseY = 0;

  impl = {
    setStage(i) { camZTarget = 62 - i * 30; },
    setGlobe(on) { globeTarget = on ? 1 : 0; },
    setCities(names) {
      markers.clear();
      const seen = new Set();
      for (const raw of names || []) {
        const q = String(raw).toLowerCase();
        for (const [name, ll] of Object.entries(CITIES)) {
          if (!ll || seen.has(name) || !q.includes(name)) continue;
          seen.add(name);
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), new THREE.MeshBasicMaterial({ color: 0xd97757 }));
          m.position.copy(latLon(ll[0], ll[1], R + 0.15));
          markers.add(m);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.5, 0.6, 24),
            new THREE.MeshBasicMaterial({ color: 0xd97757, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
          );
          ring.position.copy(m.position);
          ring.lookAt(0, 0, 0);
          markers.add(ring);
        }
      }
    },
  };

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize);
  resize();
  addEventListener("pointermove", (e) => {
    mouseX = (e.clientX / innerWidth - 0.5) * 2;
    mouseY = (e.clientY / innerHeight - 0.5) * 2;
  });

  const clock = new THREE.Clock();
  (function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // Camera glides along the route
    camZ += (camZTarget - camZ) * 0.028;
    const cx = pathX(camZ);
    camera.position.set(
      cx + mouseX * 1.6,
      1.2 - mouseY * 1.0,
      camZ
    );
    const lookZ = camZ - 34;
    camera.lookAt(pathX(lookZ), -1.5, lookZ);

    // Terrain breathes — slow rolling waves
    const pos = tGeo.attributes.position;
    for (let i = 0; i < tCount; i++) {
      const x = pos.array[i * 3], z = pos.array[i * 3 + 2];
      const dx = x - pathX(z);
      const ahead = Math.max(0, camZ - z);                 // how far down the route
      const well = -2.4 * Math.exp(-(dx * dx) / 750)       // valley along the path
                   - Math.min(2.2, ahead * 0.008);          // sheet dips toward the sun
      pos.array[i * 3 + 1] = -6 + well
        + Math.sin(tPhase[i] + t * 0.45) * 0.5
        + Math.sin(x * 0.05 + t * 0.2) * 0.8;
    }
    pos.needsUpdate = true;

    // Path pulses gently toward the horizon
    path.material.opacity = 0.7 + Math.sin(t * 1.4) * 0.15;

    // Sun sits on the horizon ahead of wherever you are
    sun.position.set(pathX(camZ - 200) * 0.6, 7.5, camZ - 210);

    // Motes drift up slowly
    const mp = mGeo.attributes.position;
    for (let i = 0; i < MN; i++) {
      mp.array[i * 3 + 1] += 0.006;
      if (mp.array[i * 3 + 1] > 24) mp.array[i * 3 + 1] = -4;
    }
    mp.needsUpdate = true;

    // Globe rises/falls with its stage
    globeOpacity += (globeTarget - globeOpacity) * 0.045;
    gMat.opacity = 0.8 * globeOpacity;
    globe.visible = globeOpacity > 0.02;
    globe.position.set(pathX(camZ - 40), 2.2 - (1 - globeOpacity) * 6, camZ - 40);
    globe.rotation.y = t * 0.1;
    markers.children.forEach((m, i) => {
      if (m.geometry.type === "RingGeometry") m.material.opacity = 0.25 + 0.35 * Math.abs(Math.sin(t * 2 + i));
    });

    renderer.render(scene, camera);
  })();
}

flush();
