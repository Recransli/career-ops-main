/* journey-bg.js — immersive three.js background for Career-Ops Studio.
 *
 * A warm particle field you travel *through*: each journey stage eases the
 * camera forward along the path, so progressing through the app literally
 * feels like moving toward the destination. During the interview (location)
 * stage a dotted globe fades in, with markers for the user's target cities.
 *
 * Palette matches the UI: ivory sky, terracotta + sand particles.
 * Degrades gracefully: if WebGL or the CDN fails, the canvas stays empty
 * and the app works exactly the same.
 */

const API = {
  setStage(i) { queue.push(() => scene && setStage(i)); flush(); },
  setCities(names) { queue.push(() => scene && setCities(names)); flush(); },
  setGlobe(on) { queue.push(() => scene && (globeTarget = on ? 1 : 0)); flush(); },
};
window.journeyBg = API;

const queue = [];
let ready = false;
function flush() { if (ready) while (queue.length) queue.shift()(); }

// Rough lat/lon for popular hubs — enough to drop a marker when the user
// types a city or country during onboarding. Matching is fuzzy substring.
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

let THREE, scene, camera, renderer, particles, globe, markers;
let camZ = 60, camZTarget = 60, globeOpacity = 0, globeTarget = 0;

try {
  THREE = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
} catch {
  console.warn("[journey-bg] three.js unavailable — background disabled.");
}

if (THREE) {
  const canvas = document.getElementById("bg");
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xfaf9f5, 0.012);
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  camera.position.set(0, 0, camZ);

  // ── Particle field: a long corridor of warm dust to travel through ──
  const COUNT = 1400;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const palette = [new THREE.Color(0xd97757), new THREE.Color(0xe8c4a0), new THREE.Color(0xb8a88f), new THREE.Color(0xc98a6b)];
  for (let i = 0; i < COUNT; i++) {
    const r = 14 + Math.random() * 42;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r * 0.55;
    pos[i * 3 + 2] = 70 - Math.random() * 360;
    const c = palette[(Math.random() * palette.length) | 0];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  particles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.65, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
  scene.add(particles);

  // ── Dotted globe (shown during the interview/location stage) ──
  globe = new THREE.Group();
  const R = 11;
  const gpts = [];
  for (let i = 0; i < 900; i++) {
    // Fibonacci sphere for even dot coverage
    const y = 1 - (i / 899) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    gpts.push(Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R);
  }
  const ggeo = new THREE.BufferGeometry();
  ggeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(gpts), 3));
  const gmat = new THREE.PointsMaterial({ size: 0.22, color: 0xb8a88f, transparent: true, opacity: 0 });
  globe.add(new THREE.Points(ggeo, gmat));
  markers = new THREE.Group();
  globe.add(markers);
  globe.position.set(0, 1.5, 18);
  scene.add(globe);
  globe.userData.mat = gmat;

  function latLonToVec(lat, lon, r = R) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }

  window.__setCitiesImpl = (names) => {
    markers.clear();
    const seen = new Set();
    for (const raw of names || []) {
      const q = String(raw).toLowerCase();
      for (const [name, ll] of Object.entries(CITIES)) {
        if (!ll || seen.has(name) || !q.includes(name)) continue;
        seen.add(name);
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.34, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xd97757, transparent: true })
        );
        m.position.copy(latLonToVec(ll[0], ll[1], R + 0.15));
        markers.add(m);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.62, 24),
          new THREE.MeshBasicMaterial({ color: 0xd97757, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
        );
        ring.position.copy(m.position);
        ring.lookAt(0, 0, 0);
        markers.add(ring);
      }
    }
  };

  // ── Stage → camera depth. Each stage moves you ~34 units down the path. ──
  window.__setStageImpl = (i) => { camZTarget = 60 - i * 34; };

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();

  let mouseX = 0, mouseY = 0;
  addEventListener("pointermove", (e) => {
    mouseX = (e.clientX / innerWidth - 0.5) * 2;
    mouseY = (e.clientY / innerHeight - 0.5) * 2;
  });

  const clock = new THREE.Clock();
  (function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    camZ += (camZTarget - camZ) * 0.03;
    camera.position.z = camZ;
    camera.position.x += (mouseX * 2.2 - camera.position.x) * 0.04;
    camera.position.y += (-mouseY * 1.4 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, camZ - 40);
    particles.rotation.z = t * 0.012;

    globeOpacity += (globeTarget - globeOpacity) * 0.05;
    globe.userData.mat.opacity = 0.85 * globeOpacity;
    globe.visible = globeOpacity > 0.02;
    globe.position.z = camZ - 42;
    globe.rotation.y = t * 0.12;
    markers.children.forEach((m, i) => {
      if (m.geometry.type === "RingGeometry") m.material.opacity = 0.25 + 0.35 * Math.abs(Math.sin(t * 2 + i));
    });

    renderer.render(scene, camera);
  })();
}

function setStage(i) { window.__setStageImpl?.(i); }
function setCities(n) { window.__setCitiesImpl?.(n); }

ready = true;
flush();
