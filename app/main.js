import * as THREE from 'three';

/* ============================================================
   NeurIPS 2026 Workshop Hall — 107 workshops, 3 wings
   ============================================================ */

const VENUE_DATES = {
  Sydney:  'Sydney · Dec 11–12, 2026',
  Paris:   'Paris · Dec 12–13, 2026',
  Atlanta: 'Atlanta · Dec 12–13, 2026',
};

/* ---- walkable rects (xmin,xmax,zmin,zmax) ---- */
const RECTS = {
  hall:    [-16, 16, -11, 11],
  sydney:  [-96, -16, -8, 8],
  paris:   [ 16, 64, -8, 8],
  atlanta: [ -9, 9, 11, 56],
};
// workshop room: 14 x 10 m single room far from the hall (same scene, camera teleport)
const ROOM = { cx: 0, cz: 200, w: 14, d: 10, h: 4.4 };
ROOM.x0 = ROOM.cx - ROOM.w / 2; ROOM.x1 = ROOM.cx + ROOM.w / 2;
ROOM.z0 = ROOM.cz - ROOM.d / 2; ROOM.z1 = ROOM.cz + ROOM.d / 2;
ROOM.doorX = 1.15;               // door half-width on south wall (z1 side)

const HALL_H = 6.2, WING_H = 5.2;
const R = 0.38;                 // player radius
const EYE = 1.65;

const WING_STYLE = {
  Sydney:  { accent: 0xa8895a, carpet: 0xd9cbb2 },
  Paris:   { accent: 0x9d8f74, carpet: 0xd5cdc0 },
  Atlanta: { accent: 0x9c7e5e, carpet: 0xdccab4 },
};

let scene, camera, renderer, clock;
let booths = [];               // {mesh targets, data, pos}
let blocked = [];              // AABBs for collision
let yaw = 0, pitch = 0;
let keys = {};
let locked = false;
let isTouch = false;
let joyVec = { x: 0, y: 0 };
let targeted = null;
let data = [];
let roomsData = [];              // rooms_data.json, same order as data
let mode = 'hall';               // 'hall' | 'room'
let currentWs = null;            // workshop whose room is open
let returnSpot = null;           // {x,z,yaw} to restore in hall
let roomBuilt = false;
let roomTargets = { front: null, portal: null };
let roomParts = {};              // meshes whose textures/colors are swapped per workshop
const roomTexCache = new Map();  // `${venue}:${idx}` -> {title, desc, topics}

const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);

/* =========================== boot =========================== */
init().catch(err => {
  document.getElementById('loadInfo').textContent = '加载失败: ' + err.message;
  console.error(err);
});

async function init() {
  data = await (await fetch('hall_data.json')).json();
  try {
    roomsData = await (await fetch('rooms_data.json')).json();
  } catch { roomsData = []; }
  const roomByKey = new Map(roomsData.map(r => [r.venue + ':' + r.idx, r]));
  for (const ws of data) ws.room = roomByKey.get(ws.venue + ':' + ws.idx) || null;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xded4c2);
  scene.fog = new THREE.Fog(0xded4c2, 60, 140);

  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 300);
  camera.position.set(0, EYE, 8);
  camera.rotation.order = 'YXZ';

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.getElementById('app').appendChild(renderer.domElement);

  clock = new THREE.Clock();

  buildLights();
  buildArchitecture();
  await buildBooths();
  buildBanners();
  bindUI();

  // optional debug spawn: #pos=x,z,yaw
  const m = location.hash.match(/pos=([-\d.]+),([-\d.]+),([-\d.]+)/);
  if (m) {
    camera.position.set(+m[1], EYE, +m[2]); yaw = +m[3];
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('hud').classList.add('on');
  }

  const vc = {};
  for (const ws of data) vc[ws.venue] = (vc[ws.venue] || 0) + 1;
  document.getElementById('counter').textContent =
    `${data.length} 个展位 · Sydney ${vc.Sydney || 0} · Paris ${vc.Paris || 0} · Atlanta ${vc.Atlanta || 0}`;
  for (const btn of document.querySelectorAll('#topbar .tbtn[data-tp]')) {
    const v = btn.dataset.tp.charAt(0).toUpperCase() + btn.dataset.tp.slice(1);
    const small = btn.querySelector('small');
    if (small) small.textContent = vc[v] || 0;
  }

  // debug/testing hook
  window.__hall = {
    enterRoomByIdx(idx) { const ws = data.find(d => d.idx === idx); if (ws) enterRoom(ws); },
    returnToHall, getMode: () => mode,
    getPos: () => ({ x: camera.position.x, z: camera.position.z, yaw }),
    setPos(x, z, y) { camera.position.set(x, EYE, z); yaw = y; },
  };

  animate();
}

/* ======================= lights ======================= */
function buildLights() {
  scene.add(new THREE.HemisphereLight(0xfff6e6, 0xb8a888, 0.85));

  const dir = new THREE.DirectionalLight(0xfff2dd, 0.5);
  dir.position.set(30, 40, 20);
  scene.add(dir);

  const pts = [
    [0, HALL_H - 1, 0, 1.0, 42],
    [-35, WING_H - 0.8, 0, 0.9, 40], [-70, WING_H - 0.8, 0, 0.9, 40],
    [30, WING_H - 0.8, 0, 0.9, 36], [52, WING_H - 0.8, 0, 0.9, 36],
    [0, WING_H - 0.8, 25, 0.9, 36], [0, WING_H - 0.8, 46, 0.9, 36],
  ];
  for (const [x, y, z, i, d] of pts) {
    const p = new THREE.PointLight(0xffe9c8, i, d, 1.6);
    p.position.set(x, y, z);
    scene.add(p);
  }
}

/* ======================= architecture ======================= */
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function floorTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#cdb894'; g.fillRect(0, 0, w, h);
    const tones = ['#d3bf9e', '#c8b28c', '#d0ba97', '#c4ae88'];
    const pw = 128, ph = 64;
    for (let y = 0; y < h / ph; y++) {
      for (let x = -1; x < w / pw + 1; x++) {
        const ox = (y % 2) * pw / 2;
        g.fillStyle = tones[(x + y * 3 + 8) % tones.length];
        g.fillRect(x * pw + ox + 1, y * ph + 1, pw - 2, ph - 2);
        g.strokeStyle = 'rgba(120,95,60,.10)';
        for (let i = 0; i < 4; i++) {
          const yy = y * ph + 6 + Math.random() * (ph - 12);
          g.beginPath(); g.moveTo(x * pw + ox + 4, yy); g.lineTo(x * pw + ox + pw - 4, yy); g.stroke();
        }
      }
    }
  });
}

function buildArchitecture() {
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xefe8da });
  const wallMat2 = new THREE.MeshLambertMaterial({ color: 0xe6ddcb });
  const ceilMat = new THREE.MeshLambertMaterial({ color: 0xf4efe4 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xfff1d4 });

  // floors
  const fTex = floorTexture();
  fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping;
  for (const key of Object.keys(RECTS)) {
    const [x0, x1, z0, z1] = RECTS[key];
    const w = x1 - x0, d = z1 - z0;
    const t = fTex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / 8, d / 8);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshLambertMaterial({ map: t }));
    f.rotation.x = -Math.PI / 2;
    f.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    scene.add(f);
  }

  // ceilings
  for (const key of Object.keys(RECTS)) {
    const [x0, x1, z0, z1] = RECTS[key];
    const h = key === 'hall' ? HALL_H : WING_H;
    const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), ceilMat);
    c.rotation.x = Math.PI / 2;
    c.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    scene.add(c);
  }

  // ceiling light strips (emissive boxes)
  function strip(x, y, z, len, alongX) {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? len : 0.5, 0.08, alongX ? 0.5 : len), stripMat);
    s.position.set(x, y, z);
    scene.add(s);
  }
  for (let x = -88; x <= -24; x += 12.8) { strip(x, WING_H - 0.05, -3, 6, true); strip(x, WING_H - 0.05, 3, 6, true); }
  for (let x = 22; x <= 60; x += 12.8)   { strip(x, WING_H - 0.05, -3, 6, true); strip(x, WING_H - 0.05, 3, 6, true); }
  for (let z = 16; z <= 52; z += 12)     { strip(-4, WING_H - 0.05, z, 6, false); strip(4, WING_H - 0.05, z, 6, false); }
  for (let x = -10; x <= 10; x += 10) for (let z = -6; z <= 6; z += 6) strip(x, HALL_H - 0.05, z, 4.5, true);

  // ---- walls (hand-authored with openings) ----
  // wall(cx, cz, len, alongX, h, mat)
  const walls = [];
  function wall(x0, z0, x1, z1, h, mat) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(
      Math.abs(x1 - x0) || 0.3, h, Math.abs(z1 - z0) || 0.3), mat || wallMat);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    scene.add(m);
  }
  // hall
  wall(-16, -11, 16, -11, HALL_H);                        // south
  wall(-16, -11, -16, -6, HALL_H); wall(-16, 6, -16, 11, HALL_H);  // west w/ opening
  wall(16, -11, 16, -6, HALL_H);  wall(16, 6, 16, 11, HALL_H);     // east w/ opening
  wall(-16, 11, -7, 11, HALL_H);  wall(7, 11, 16, 11, HALL_H);     // north w/ opening
  // sydney wing
  wall(-96, -8, -96, 8, WING_H, wallMat2);
  wall(-96, -8, -16, -8, WING_H, wallMat2);
  wall(-96, 8, -16, 8, WING_H, wallMat2);
  // paris wing
  wall(64, -8, 64, 8, WING_H, wallMat2);
  wall(16, -8, 64, -8, WING_H, wallMat2);
  wall(16, 8, 64, 8, WING_H, wallMat2);
  // atlanta wing
  wall(-9, 56, 9, 56, WING_H, wallMat2);
  wall(-9, 11, -9, 56, WING_H, wallMat2);
  wall(9, 11, 9, 56, WING_H, wallMat2);

  // baseboards (warm wood strip along walls)
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });

  // central feature: round info desk in hall
  const desk = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 1.05, 40),
    new THREE.MeshLambertMaterial({ color: 0xb59a72 }));
  desk.position.set(0, 0.52, 0);
  scene.add(desk);
  const deskTop = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.08, 40),
    new THREE.MeshLambertMaterial({ color: 0xd8c39c }));
  deskTop.position.set(0, 1.08, 0);
  scene.add(deskTop);
  blocked.push([-2.6, 2.6, -2.6, 2.6]);

  // ring light above desk
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.09, 10, 48), stripMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, HALL_H - 0.6, 0);
  scene.add(ring);
}

/* ======================= wing banners ======================= */
function bannerTex(title, sub, accent) {
  return canvasTex(1600, 400, (g, w, h) => {
    g.fillStyle = '#f5efe2'; g.fillRect(0, 0, w, h);
    g.fillStyle = accent; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#42351f';
    g.font = '700 150px Georgia, "Times New Roman", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, w / 2, h / 2 - 55);
    g.fillStyle = '#8a7450';
    g.font = '500 74px Georgia, serif';
    g.fillText(sub, w / 2, h / 2 + 95);
  });
}

function buildBanners() {
  // entrance banners: two single-sided planes back-to-back (avoid mirrored text)
  function banner(title, sub, accent, w, h, x, y, z, rotY) {
    const tex = bannerTex(title, sub, accent);
    for (const s of [0, Math.PI]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(x, y, z);
      m.rotation.y = rotY + s;
      scene.add(m);
    }
  }
  const vc = {};
  for (const ws of data) vc[ws.venue] = (vc[ws.venue] || 0) + 1;
  banner('SYDNEY', `Dec 11–12, 2026 · ${vc.Sydney || 0} Workshops`, '#a8895a', 11, 2.75, -16.5, 4.1, 0, Math.PI / 2);
  banner('PARIS', `Dec 12–13, 2026 · ${vc.Paris || 0} Workshops`, '#9d8f74', 11, 2.75, 16.5, 4.1, 0, Math.PI / 2);
  banner('ATLANTA', `Dec 12–13, 2026 · ${vc.Atlanta || 0} Workshops`, '#9c7e5e', 10, 2.5, 0, 4.1, 11.5, 0);

  // large end-wall titles inside each wing
  const e1 = endTitle('SYDNEY', 'Dec 11–12, 2026');
  e1.position.set(-95.6, 3.1, 0); e1.rotation.y = Math.PI / 2; scene.add(e1);
  const e2 = endTitle('PARIS', 'Dec 12–13, 2026');
  e2.position.set(63.6, 3.1, 0); e2.rotation.y = -Math.PI / 2; scene.add(e2);
  const e3 = endTitle('ATLANTA', 'Dec 12–13, 2026');
  e3.position.set(0, 3.1, 55.6); e3.rotation.y = Math.PI; scene.add(e3);
}

function endTitle(title, sub) {
  const t = canvasTex(1400, 380, (g, w, h) => {
    g.fillStyle = '#efe8d8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b39d6f'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#4a3a22'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 150px Georgia, serif';
    g.fillText(title, w / 2, h / 2 - 45);
    g.fillStyle = '#937c52'; g.font = '500 66px Georgia, serif';
    g.fillText(sub, w / 2, h / 2 + 100);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(10, 2.72), new THREE.MeshBasicMaterial({ map: t }));
}

/* ======================= booths ======================= */
function nameStripTex(name) {
  return canvasTex(1024, 240, (g, w, h) => {
    g.fillStyle = '#f7f1e4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b39d6f'; g.fillRect(0, 0, w, 8); g.fillRect(0, h - 8, w, 8);
    g.fillStyle = '#41331d'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 64, lines;
    do {
      lines = wrapLines(g, name, w - 90, () => {
        g.font = `600 ${size}px Georgia, "Times New Roman", serif`;
      });
      if (lines.length <= 2) break;
      size -= 6;
    } while (size > 30);
    lines = lines.slice(0, 3);
    g.font = `600 ${size}px Georgia, serif`;
    const lh = size * 1.18;
    const y0 = h / 2 - lh * (lines.length - 1) / 2;
    lines.forEach((ln, i) => g.fillText(ln, w / 2, y0 + i * lh));
  });
}

function wrapLines(g, text, maxW, setFont) {
  setFont();
  const words = text.split(/\s+/);
  const lines = []; let cur = '';
  for (const wd of words) {
    const t = cur ? cur + ' ' + wd : wd;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function placeholderTex(ws) {
  // elegant warm, low-saturation poster
  const palettes = [
    ['#e8dcc6', '#d9c8a8', '#8a6d3f'], ['#e6ddd2', '#d5c5b0', '#7e6a4c'],
    ['#eae2d0', '#dccfb4', '#96794e'], ['#e4dccb', '#d2c3a6', '#857051'],
    ['#e9dfce', '#d8c9ae', '#8f7350'],
  ];
  const p = palettes[(ws.idx + ws.venue.length) % palettes.length];
  return canvasTex(512, 640, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, p[0]); grad.addColorStop(1, p[1]);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    // subtle decorative arcs
    g.strokeStyle = 'rgba(255,252,244,.35)'; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      g.beginPath(); g.arc(w / 2, h * 0.34, 46 + i * 26, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = p[2]; g.lineWidth = 5;
    g.strokeRect(16, 16, w - 32, h - 32);
    g.fillStyle = p[2]; g.textAlign = 'center';
    g.font = '600 26px Georgia, serif';
    g.fillText('NeurIPS 2026 Workshop', w / 2, 62);
    g.fillText('· ' + ws.venue + ' ·', w / 2, 96);
    // name
    g.fillStyle = '#40331e';
    const lines = wrapLines(g, ws.name, w - 80, () => {
      g.font = '600 33px Georgia, serif';
    }).slice(0, 5);
    const y0 = h * 0.60 - (lines.length - 1) * 21;
    g.font = '600 33px Georgia, serif';
    lines.forEach((ln, i) => g.fillText(ln, w / 2, y0 + i * 42));
    g.fillStyle = p[2]; g.font = 'italic 22px Georgia, serif';
    g.fillText('NeurIPS 2026', w / 2, h - 46);
  });
}

const texLoader = new THREE.TextureLoader();
function loadTex(url) {
  return new Promise(resolve => {
    texLoader.load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

async function buildBooths() {
  const panelGeo = new THREE.BoxGeometry(3.05, 3.45, 0.16);
  const panelMat = new THREE.MeshLambertMaterial({ color: 0xf2ebdc });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
  const frameGeo = new THREE.BoxGeometry(3.2, 3.6, 0.1);
  const imgGeo = new THREE.PlaneGeometry(2.55, 1.72);
  const stripGeo = new THREE.PlaneGeometry(2.85, 0.67);

  // layout: per wing, booths along both long side walls
  const layout = {
    sydney:  { axis: 'x', from: -92.5, to: -19.5, wallZ: 8, h: WING_H },
    paris:   { axis: 'x', from: 19.5, to: 60.5, wallZ: 8, h: WING_H },
    atlanta: { axis: 'z', from: 14.5, to: 52.5, wallX: 9, h: WING_H },
  };

  const groups = { sydney: [], paris: [], atlanta: [] };
  for (const ws of data) groups[ws.venue.toLowerCase()].push(ws);

  const total = data.length;
  let done = 0;
  const loadInfo = document.getElementById('loadInfo');
  const enterBtn = document.getElementById('enterBtn');

  const jobs = [];
  for (const wkey of Object.keys(groups)) {
    const L = layout[wkey];
    const list = groups[wkey];
    const perSide = Math.ceil(list.length / 2);
    const span = (L.to - L.from);
    const step = span / perSide;
    list.forEach((ws, i) => {
      const side = i < perSide ? -1 : 1;   // which wall
      const k = i < perSide ? i : i - perSide;
      const c = L.from + step * (k + 0.5);
      let x, z, rotY;
      if (L.axis === 'x') { x = c; z = side * (L.wallZ - 0.35); rotY = side > 0 ? Math.PI : 0; }
      else { x = side * (L.wallX - 0.35); z = c; rotY = side > 0 ? -Math.PI / 2 : Math.PI / 2; }
      jobs.push({ ws, x, z, rotY });
    });
  }

  await Promise.all(jobs.map(async j => {
    const { ws, x, z, rotY } = j;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;

    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 1.85, -0.03);
    g.add(frame);

    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 1.85, 0.04);
    g.add(panel);

    let tex = ws.image ? await loadTex(ws.image) : null;
    if (!tex) tex = placeholderTex(ws);
    const img = new THREE.Mesh(imgGeo,
      new THREE.MeshLambertMaterial({ map: tex }));
    img.position.set(0, 1.68, 0.13);
    g.add(img);

    const strip = new THREE.Mesh(stripGeo,
      new THREE.MeshBasicMaterial({ map: nameStripTex(ws.name) }));
    strip.position.set(0, 3.06, 0.13);
    g.add(strip);

    scene.add(g);
    booths.push({ group: g, data: ws, targets: [img, panel, strip] });
    for (const t of [img, panel, strip]) t.userData.ws = ws;

    done++;
    loadInfo.textContent = `正在加载展位资源… ${done}/${total}`;
  }));

  // collision AABBs for booths (thin boxes behind, counters in front)
  for (const b of booths) {
    const { x, z } = b.group.position;
    const rotY = b.group.rotation.y;
    // panel footprint 3.2 x 0.3 in local (x,z) -> world AABB
    if (Math.abs(Math.sin(rotY)) > 0.5) { // facing ±x
      blocked.push([x - 0.25, x + 0.25, z - 1.7, z + 1.7]);
    } else {
      blocked.push([x - 1.7, x + 1.7, z - 0.25, z + 0.25]);
    }
  }

  enterBtn.disabled = false;
  enterBtn.textContent = '进 入 展 厅';
  loadInfo.textContent = `就绪 · ${total} 个展位已加载`;
}

/* ======================= UI / input ======================= */
function bindUI() {
  const overlay = document.getElementById('overlay');
  const hud = document.getElementById('hud');
  const enterBtn = document.getElementById('enterBtn');

  isTouch = 'ontouchstart' in window && matchMedia('(pointer:coarse)').matches;
  if (isTouch) document.body.classList.add('touch');

  const resume = document.getElementById('resume');

  enterBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    hud.classList.add('on');
    resume.classList.remove('on');
    if (!isTouch) renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (!locked && !isTouch && hud.classList.contains('on')) {
      // show a slim paused hint instead of the full overlay, so the
      // wing teleport buttons in the top bar stay clickable
      resume.classList.add('on');
    } else if (locked) {
      resume.classList.remove('on');
    }
  });

  renderer.domElement.addEventListener('click', () => {
    if (!isTouch && !locked) { renderer.domElement.requestPointerLock(); resume.classList.remove('on'); return; }
    if (locked && targeted) activateTarget();
  });

  document.addEventListener('mousemove', e => {
    if (!locked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
  });

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyE' && targeted) activateTarget();
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => keys[e.code] = false);

  // teleport buttons
  const TP = {
    hall:    [0, 8, Math.PI],
    sydney:  [-22, 0, Math.PI / 2],
    paris:   [22, 0, -Math.PI / 2],
    atlanta: [0, 16, Math.PI],
  };
  document.querySelectorAll('.tbtn[data-tp]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [x, z, ry] = TP[btn.dataset.tp];
      if (mode !== 'hall') { mode = 'hall'; currentWs = null; targeted = null; setModeUI(); }
      camera.position.set(x, EYE, z);
      yaw = ry; pitch = 0;
      overlay.classList.add('hidden');
      hud.classList.add('on');
      resume.classList.remove('on');
      if (!isTouch && !locked) renderer.domElement.requestPointerLock();
    });
  });

  document.getElementById('backBtn').addEventListener('click', e => {
    e.stopPropagation();
    returnToHall();
    if (!isTouch && !locked) renderer.domElement.requestPointerLock();
  });

  // ---- room directory: enter any room without walking to its booth ----
  const dirPanel = document.getElementById('dirPanel');
  const dirList = document.getElementById('dirList');
  const dirSearch = document.getElementById('dirSearch');
  let dirBuilt = false;

  function buildDir(filter = '') {
    dirList.innerHTML = '';
    const q = filter.trim().toLowerCase();
    let lastVenue = null;
    for (const ws of data) {
      const r = ws.room || {};
      const hay = (ws.name + ' ' + (r.topics || []).join(' ') + ' ' + ws.venue).toLowerCase();
      if (q && !hay.includes(q)) continue;
      if (ws.venue !== lastVenue) {
        lastVenue = ws.venue;
        const h = document.createElement('div');
        h.className = 'dirVenue';
        h.textContent = `${ws.venue} · ${VENUE_DATES[ws.venue].split('·')[1].trim()}`;
        dirList.appendChild(h);
      }
      const b = document.createElement('button');
      b.className = 'dirItem';
      const tag = document.createElement('span');
      tag.className = 'v';
      tag.textContent = '#' + ws.idx;
      b.appendChild(tag);
      b.appendChild(document.createTextNode(ws.name));
      b.addEventListener('click', () => {
        dirPanel.classList.remove('on');
        enterRoom(ws);
        if (!isTouch && !locked) renderer.domElement.requestPointerLock();
      });
      dirList.appendChild(b);
    }
    if (!dirList.children.length) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:20px;color:#a08c60;font-size:13px';
      d.textContent = '没有匹配的 Workshop';
      dirList.appendChild(d);
    }
  }

  function openDir() {
    if (document.pointerLockElement) document.exitPointerLock();
    if (!dirBuilt) { buildDir(); dirBuilt = true; }
    dirPanel.classList.add('on');
    dirSearch.value = '';
    dirSearch.focus();
  }
  document.getElementById('dirBtn').addEventListener('click', e => { e.stopPropagation(); openDir(); });
  document.getElementById('dirClose').addEventListener('click', () => dirPanel.classList.remove('on'));
  dirPanel.addEventListener('click', e => { if (e.target === dirPanel) dirPanel.classList.remove('on'); });
  dirSearch.addEventListener('input', () => buildDir(dirSearch.value));

  // ---- in-room prev / next navigation ----
  function stepRoom(delta) {
    if (!currentWs) return;
    const i = data.indexOf(currentWs);
    enterRoom(data[(i + delta + data.length) % data.length]);
  }
  document.getElementById('prevRoom').addEventListener('click', e => { e.stopPropagation(); stepRoom(-1); });
  document.getElementById('nextRoom').addEventListener('click', e => { e.stopPropagation(); stepRoom(1); });
  // PageUp/PageDown or [ ] also switch rooms while inside one
  addEventListener('keydown', e => {
    if (mode !== 'room') return;
    if (e.code === 'PageUp' || e.code === 'BracketLeft') stepRoom(-1);
    if (e.code === 'PageDown' || e.code === 'BracketRight') stepRoom(1);
  });

  // ---- touch: left joystick + right look ----
  const joy = document.getElementById('joy');
  const knob = document.getElementById('joyKnob');
  let joyId = null, lookId = null, lookLast = null;
  addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth / 2 && joyId === null) {
        joyId = t.identifier;
      } else if (lookId === null) {
        lookId = t.identifier;
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: false });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        const r = joy.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let dx = (t.clientX - cx) / (r.width / 2), dy = (t.clientY - cy) / (r.height / 2);
        const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        joyVec = { x: dx, y: dy };
        knob.style.transform = `translate(${dx * 30}px,${dy * 30}px)`;
      } else if (t.identifier === lookId) {
        yaw -= (t.clientX - lookLast.x) * 0.005;
        pitch -= (t.clientY - lookLast.y) * 0.005;
        pitch = Math.max(-1.45, Math.min(1.45, pitch));
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
    if (overlay.classList.contains('hidden')) e.preventDefault();
  }, { passive: false });
  addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; joyVec = { x: 0, y: 0 }; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* ======================= workshop rooms ======================= */
// word wrap with CJK-safe fallback (splits overlong words by character)
function wrapText(g, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (let wd of words) {
      // split words that alone exceed maxW (e.g. long CJK runs)
      while (g.measureText(wd).width > maxW && wd.length > 1) {
        let k = wd.length;
        while (k > 1 && g.measureText(wd.slice(0, k)).width > maxW) k--;
        if (cur) { out.push(cur); cur = ''; }
        out.push(wd.slice(0, k)); wd = wd.slice(k);
      }
      const t = cur ? cur + ' ' + wd : wd;
      if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = wd; }
      else cur = t;
    }
    if (cur) out.push(cur);
  }
  return out;
}

function roomTitleTex(r) {
  return canvasTex(1500, 260, (g, w, h) => {
    g.fillStyle = '#f6f0e2'; g.fillRect(0, 0, w, h);
    g.fillStyle = r.accent; g.fillRect(0, 0, w, 12); g.fillRect(0, h - 12, w, 12);
    g.fillStyle = '#3f331e'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 78, lines;
    do {
      g.font = `600 ${size}px Georgia, "PingFang SC", "Microsoft YaHei", serif`;
      lines = wrapText(g, r.name, w - 120);
      if (lines.length <= 2) break;
      size -= 6;
    } while (size > 30);
    lines = lines.slice(0, 2);
    g.font = `600 ${size}px Georgia, "PingFang SC", serif`;
    const lh = size * 1.22, y0 = h / 2 - lh * (lines.length - 1) / 2;
    lines.forEach((ln, i) => g.fillText(ln, w / 2, y0 + i * lh));
  });
}

function roomDescTex(r) {
  return canvasTex(900, 620, (g, w, h) => {
    g.fillStyle = '#f7f2e6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = r.accent; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = r.accent; g.fillRect(34, 34, 92, 8);
    g.fillStyle = '#5c4a2c'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '700 40px Georgia, "PingFang SC", serif';
    g.fillText('简介 · ABOUT', 34, 100);
    g.fillStyle = '#463921';
    const font = () => g.font = '500 31px "Avenir Next", "PingFang SC", "Microsoft YaHei", Georgia, serif';
    font();
    const lines = wrapText(g, r.desc || '—', w - 90).slice(0, 9);
    font();
    lines.forEach((ln, i) => g.fillText(ln, 45, 165 + i * 46));
    // footer
    g.fillStyle = '#9a8a66'; g.font = 'italic 26px Georgia, serif';
    g.fillText('NeurIPS 2026 Workshop · ' + r.venue, 45, h - 46);
  });
}

function roomTopicsTex(r) {
  return canvasTex(900, 620, (g, w, h) => {
    g.fillStyle = '#f7f2e6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = r.accent; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = r.accent; g.fillRect(34, 34, 92, 8);
    g.fillStyle = '#5c4a2c'; g.textAlign = 'left';
    g.font = '700 40px Georgia, "PingFang SC", serif';
    g.fillText('关键词 · TOPICS', 34, 100);
    // topic chips
    let x = 45, y = 130;
    g.font = '600 27px "PingFang SC", "Avenir Next", Georgia, serif';
    for (const t of (r.topics || []).slice(0, 12)) {
      const tw = g.measureText(t).width + 44;
      if (x + tw > w - 45) { x = 45; y += 58; }
      if (y > h - 200) break;
      g.fillStyle = '#efe5cf'; g.strokeStyle = r.accent; g.lineWidth = 2.5;
      g.beginPath(); g.roundRect(x, y, tw, 44, 22); g.fill(); g.stroke();
      g.fillStyle = '#54421f';
      g.fillText(t, x + 22, y + 31);
      x += tw + 14;
    }
    // meta info
    g.fillStyle = r.accent; g.fillRect(34, h - 168, 92, 8);
    g.fillStyle = '#5c4a2c'; g.font = '700 34px Georgia, serif';
    g.fillText('INFO', 34, h - 118);
    g.fillStyle = '#463921'; g.font = '500 28px Georgia, serif';
    g.fillText(VENUE_DATES[r.venue] || r.venue, 45, h - 74);
    let meta = 'Booth #' + r.idx;
    if (r.deadline) meta += ' · 截止 ' + r.deadline;
    else if (!r.url) meta += ' · 官网待公布';
    g.fillText(meta, 45, h - 38);
  });
}

function portalTex() {
  return canvasTex(700, 220, (g, w, h) => {
    g.fillStyle = '#3d3120'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd98f'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffe3a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 78px "PingFang SC", Georgia, serif';
    g.fillText('← 返回大厅', w / 2, h / 2 - 32);
    g.font = '500 40px Georgia, serif';
    g.fillText('BACK TO HALL', w / 2, h / 2 + 52);
  });
}

// Build the reusable room shell once; per-workshop content is swapped in enterRoom().
function buildRoom() {
  if (roomBuilt) return;
  roomBuilt = true;
  const { x0, x1, z0, z1, h } = ROOM;
  const g = new THREE.Group();

  const wallMat = new THREE.MeshLambertMaterial({ color: 0xefe7d7 });
  const ceilMat = new THREE.MeshLambertMaterial({ color: 0xf4efe4 });
  function box(xa, za, xb, zb, hh, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(
      Math.abs(xb - xa) || 0.3, hh, Math.abs(zb - za) || 0.3), mat || wallMat);
    m.position.set((xa + xb) / 2, hh / 2, (za + zb) / 2);
    g.add(m);
  }
  box(x0, z0, x1, z0, h);                                       // front wall
  box(x0, z0, x0, z1, h); box(x1, z0, x1, z1, h);               // side walls
  box(x0, z1, -ROOM.doorX, z1, h); box(ROOM.doorX, z1, x1, z1, h); // back wall w/ door gap
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(ROOM.doorX * 2, h - 3.1, 0.3), wallMat);
  lintel.position.set(0, 3.1 + (h - 3.1) / 2, z1); g.add(lintel);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ceilMat);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(ROOM.cx, h, ROOM.cz); g.add(ceil);

  // floor: warm wood reuse + accent carpet
  const fTex = floorTexture();
  fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping; fTex.repeat.set(2, 1.4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    new THREE.MeshLambertMaterial({ map: fTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(ROOM.cx, 0, ROOM.cz); g.add(floor);

  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.6),
    new THREE.MeshLambertMaterial({ color: 0xd9cbb2 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(ROOM.cx, 0.012, ROOM.cz + 0.3);
  g.add(carpet);
  roomParts.carpet = carpet;

  // accent baseboards along 4 walls
  const baseMat = new THREE.MeshLambertMaterial({ color: 0xa8895a });
  function baseboard(x, z, len, alongX) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.1, 0.16, alongX ? 0.1 : len), baseMat);
    b.position.set(x, 0.08, z); g.add(b);
  }
  baseboard(0, z0 + 0.2, ROOM.w - 0.4, true);
  baseboard(-ROOM.doorX - (ROOM.w / 2 - ROOM.doorX) / 2, z1 - 0.2, ROOM.w / 2 - ROOM.doorX, true);
  baseboard(ROOM.doorX + (ROOM.w / 2 - ROOM.doorX) / 2, z1 - 0.2, ROOM.w / 2 - ROOM.doorX, true);
  baseboard(x0 + 0.2, ROOM.cz, ROOM.d - 0.4, false);
  baseboard(x1 - 0.2, ROOM.cz, ROOM.d - 0.4, false);
  roomParts.baseMat = baseMat;

  // ceiling light strips (accent glow)
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffe9c0 });
  for (const sx of [-3.6, 3.6]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.07, 0.4), stripMat);
    s.position.set(sx, h - 0.05, ROOM.cz); g.add(s);
  }
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xa8895a });
  for (const zz of [z0 + 0.15, z1 - 0.15]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w - 0.5, 0.06, 0.06), edgeMat);
    s.position.set(0, h - 0.28, zz); g.add(s);
  }
  roomParts.edgeMat = edgeMat;

  // front wall: big image + frame + title below
  const frame = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.4, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x8a6f4d }));
  frame.position.set(0, 2.45, z0 + 0.22); g.add(frame);
  roomParts.frameMat = frame.material;
  const img = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 3.1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }));
  img.position.set(0, 2.45, z0 + 0.3); g.add(img);
  roomParts.frontImg = img;
  const title = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 1.09),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  title.position.set(0, 0.62, z0 + 0.29); g.add(title);
  roomParts.title = title;

  // left wall: desc panel
  const descP = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  descP.rotation.y = Math.PI / 2; descP.position.set(x0 + 0.24, 1.95, ROOM.cz); g.add(descP);
  roomParts.desc = descP;
  const descBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.15, 4.55),
    new THREE.MeshLambertMaterial({ color: 0x8a6f4d }));
  descBack.position.set(x0 + 0.17, 1.95, ROOM.cz); g.add(descBack);

  // right wall: topics + info panel
  const topP = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  topP.rotation.y = -Math.PI / 2; topP.position.set(x1 - 0.24, 1.95, ROOM.cz); g.add(topP);
  roomParts.topics = topP;
  const topBack = descBack.clone(); topBack.position.set(x1 - 0.17, 1.95, ROOM.cz); g.add(topBack);

  // return portal above door (glowing sign) + accent door frame
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75),
    new THREE.MeshBasicMaterial({ map: portalTex() }));
  portal.position.set(0, 2.72, z1 - 0.18); portal.rotation.y = Math.PI; g.add(portal);
  portal.userData.kind = 'portal';
  const doorFrameMat = new THREE.MeshBasicMaterial({ color: 0xffd98f });
  for (const sx of [-ROOM.doorX - 0.05, ROOM.doorX + 0.05]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.1, 0.12), doorFrameMat);
    d.position.set(sx, 1.55, z1 - 0.1); g.add(d);
  }
  const dTop = new THREE.Mesh(new THREE.BoxGeometry(ROOM.doorX * 2 + 0.2, 0.1, 0.12), doorFrameMat);
  dTop.position.set(0, 3.14, z1 - 0.1); g.add(dTop);

  // lights
  const pl = new THREE.PointLight(0xffe9c8, 1.1, 26, 1.5);
  pl.position.set(0, h - 0.7, ROOM.cz); g.add(pl);
  const plDoor = new THREE.PointLight(0xffd98f, 0.7, 8, 1.6);
  plDoor.position.set(0, 2.4, z1 - 1.2); g.add(plDoor);

  scene.add(g);
  roomTargets.front = img; img.userData.kind = 'front';
  roomTargets.portal = portal;

  // collision: front board, side panels (walls handled by walkable rect)
  blocked.push([-3.5, 3.5, z0 - 0.1, z0 + 0.5]);               // front display
  blocked.push([x0 - 0.1, x0 + 0.45, ROOM.cz - 2.4, ROOM.cz + 2.4]); // left panel
  blocked.push([x1 - 0.45, x1 + 0.1, ROOM.cz - 2.4, ROOM.cz + 2.4]); // right panel
}

function enterRoom(ws) {
  buildRoom();
  currentWs = ws;
  const r = ws.room || { venue: ws.venue, idx: ws.idx, name: ws.name, url: ws.url,
    desc: '', topics: [], accent: '#a8895a' };
  const key = ws.venue + ':' + ws.idx;
  if (!roomTexCache.has(key)) {
    roomTexCache.set(key, { title: roomTitleTex(r), desc: roomDescTex(r), topics: roomTopicsTex(r) });
    if (roomTexCache.size > 24) { // simple LRU: evict oldest, dispose textures
      const [k, v] = roomTexCache.entries().next().value;
      if (k !== key) { v.title.dispose(); v.desc.dispose(); v.topics.dispose(); roomTexCache.delete(k); }
    }
  }
  const tex = roomTexCache.get(key);
  roomParts.title.material.map = tex.title; roomParts.title.material.needsUpdate = true;
  roomParts.desc.material.map = tex.desc; roomParts.desc.material.needsUpdate = true;
  roomParts.topics.material.map = tex.topics; roomParts.topics.material.needsUpdate = true;
  // big front image: reuse the already-loaded booth texture (or its placeholder)
  const booth = booths.find(b => b.data === ws);
  const imgTex = booth ? booth.targets[0].material.map : null;
  roomParts.frontImg.material.map = imgTex;
  roomParts.frontImg.material.color.set(imgTex ? 0xffffff : 0xefe6d4);
  roomParts.frontImg.material.needsUpdate = true;
  // accent tint
  const ac = new THREE.Color(r.accent || '#a8895a');
  roomParts.baseMat.color.copy(ac);
  roomParts.edgeMat.color.copy(ac);
  roomParts.frameMat.color.copy(ac.clone().multiplyScalar(0.85));
  roomParts.carpet.material.color.copy(ac.clone().lerp(new THREE.Color(0xffffff), 0.72));

  // remember where to return: in front of this booth, facing the wing aisle
  const bg = booth ? booth.group : null;
  if (bg) {
    const dx = Math.sin(bg.rotation.y), dz = Math.cos(bg.rotation.y);
    returnSpot = { x: bg.position.x + dx * 2.8, z: bg.position.z + dz * 2.8, yaw: bg.rotation.y };
  } else returnSpot = { x: 0, z: 8, yaw: Math.PI };

  mode = 'room';
  camera.position.set(0, EYE, ROOM.z1 - 1.6);
  yaw = 0; pitch = 0;             // face the front wall
  targeted = null;
  document.getElementById('infocard').classList.remove('on');
  setModeUI();
}

function returnToHall() {
  if (mode !== 'room') return;
  mode = 'hall';
  const s = returnSpot || { x: 0, z: 8, yaw: Math.PI };
  camera.position.set(s.x, EYE, s.z);
  yaw = s.yaw; pitch = 0;
  currentWs = null;
  targeted = null;
  document.getElementById('infocard').classList.remove('on');
  setModeUI();
}

function setModeUI() {
  const inRoom = mode === 'room';
  document.querySelectorAll('.tbtn').forEach(b => b.style.display = inRoom ? 'none' : '');
  document.getElementById('dirBtn').style.display = '';          // directory stays available in rooms
  document.getElementById('counter').style.display = inRoom ? 'none' : '';
  document.getElementById('roomNav').classList.toggle('on', inRoom);
  document.getElementById('backBtn').style.display = inRoom ? 'block' : 'none';
  const crumb = document.getElementById('crumb');
  if (inRoom && currentWs) {
    const r = currentWs.room;
    const short = (r ? r.name : currentWs.name);
    crumb.innerHTML = `大厅 / ${currentWs.venue} / <b></b>`;
    crumb.querySelector('b').textContent =
      short.length > 46 ? short.slice(0, 45) + '…' : short;
    crumb.classList.add('on');
  } else crumb.classList.remove('on');
  document.getElementById('hint').textContent = inRoom
    ? 'WASD 移动 · 对准正墙大图按 E 访问官网 · 对准「返回大厅」按 E 或走出房门返回大厅'
    : 'WASD 移动 · Shift 加速 · 对准展位按 E 进入专属房间 · Esc 释放鼠标';
}

// E / click on a targeted object, behavior depends on mode
function activateTarget() {
  if (mode === 'hall') {
    if (targeted) enterRoom(targeted);
  } else if (targeted.kind === 'front') {
    const u = currentWs && currentWs.url;
    if (u) window.open(u, '_blank');
  } else if (targeted.kind === 'portal') {
    returnToHall();
  }
}

/* ======================= collision ======================= */
function insideWalkable(x, z) {
  if (mode === 'room') {
    return x >= ROOM.x0 + R && x <= ROOM.x1 - R &&
           z >= ROOM.z0 + R && z <= ROOM.z1 - 0.45;
  }
  for (const key of Object.keys(RECTS)) {
    const [x0, x1, z0, z1] = RECTS[key];
    if (x >= x0 + R && x <= x1 - R && z >= z0 + R && z <= z1 - R) return true;
  }
  return false;
}
function hitsBlocked(x, z) {
  for (const [x0, x1, z0, z1] of blocked) {
    if (x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R) return true;
  }
  return false;
}
function free(x, z) { return insideWalkable(x, z) && !hitsBlocked(x, z); }

/* ======================= main loop ======================= */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // movement
  const speed = (keys.ShiftLeft || keys.ShiftRight) ? 9 : 4.2;
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz -= 1;
  if (keys.KeyS || keys.ArrowDown) mz += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  mx += joyVec.x; mz += joyVec.y;
  const mLen = Math.hypot(mx, mz);
  if (mLen > 1) { mx /= mLen; mz /= mLen; }
  if (mLen > 0.01) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin); mz=-1 means forward
    const dx = (mx * cos + mz * sin) * speed * dt;
    const dz = (-mx * sin + mz * cos) * speed * dt;
    const px = camera.position.x, pz = camera.position.z;
    if (free(px + dx, pz + dz)) { camera.position.x += dx; camera.position.z += dz; }
    else if (free(px + dx, pz)) camera.position.x += dx;
    else if (free(px, pz + dz)) camera.position.z += dz;
  }
  camera.position.y = EYE;
  camera.rotation.set(pitch, yaw, 0);

  // walking out through the door returns to the hall
  if (mode === 'room' && camera.position.z > ROOM.z1 - 0.7 &&
      Math.abs(camera.position.x) < ROOM.doorX - 0.1) returnToHall();

  // raycast targeting
  raycaster.setFromCamera(CENTER, camera);
  const card = document.getElementById('infocard');
  const cross = document.getElementById('crosshair');
  if (mode === 'hall') {
    raycaster.far = 7;
    const targets = [];
    for (const b of booths) targets.push(...b.targets);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) {
      const ws = hit.object.userData.ws;
      if (targeted !== ws) {
        targeted = ws;
        document.getElementById('icVenue').textContent = VENUE_DATES[ws.venue] + ' · Booth #' + ws.idx
          + (ws.room && ws.room.deadline ? ' · 截止 ' + ws.room.deadline : '');
        document.getElementById('icName').textContent = ws.name;
        const lk = document.getElementById('icLink');
        lk.innerHTML = ws.url
          ? `<a href="${ws.url}" target="_blank" rel="noopener">🔗 官方网站 · ${ws.url}</a>`
          : `<span class="nourl">官网链接待公布</span>`;
        document.getElementById('icHint').textContent =
          isTouch ? '点击画面进入该 Workshop 专属房间'
                  : '按 E 或点击画面进入该 Workshop 专属房间';
        card.classList.add('on');
        cross.classList.add('hot');
      }
    } else if (targeted) {
      targeted = null;
      card.classList.remove('on');
      cross.classList.remove('hot');
    }
  } else {
    raycaster.far = 16;
    const hit = raycaster.intersectObjects([roomTargets.front, roomTargets.portal], false)[0];
    const kind = hit ? hit.object.userData.kind : null;
    if (kind !== (targeted && targeted.kind)) {
      targeted = kind ? { kind } : null;
      if (kind === 'front') {
        const ws = currentWs;
        document.getElementById('icVenue').textContent = VENUE_DATES[ws.venue] + ' · Booth #' + ws.idx
          + (ws.room && ws.room.deadline ? ' · 截止 ' + ws.room.deadline : '');
        document.getElementById('icName').textContent = ws.name;
        const lk = document.getElementById('icLink');
        lk.innerHTML = ws.url
          ? `<a href="${ws.url}" target="_blank" rel="noopener">🔗 官方网站 · ${ws.url}</a>`
          : `<span class="nourl">官网链接待公布</span>`;
        document.getElementById('icHint').textContent = ws.url
          ? (isTouch ? '点击画面访问官网（新标签页）' : '按 E 或点击画面访问官网（Esc 后可点击链接）')
          : '该 Workshop 官网链接待公布';
        card.classList.add('on');
      } else if (kind === 'portal') {
        document.getElementById('icVenue').textContent = 'EXIT';
        document.getElementById('icName').textContent = '返回大厅';
        document.getElementById('icLink').innerHTML = '<span class="nourl">回到原展位附近，继续大厅漫游</span>';
        document.getElementById('icHint').textContent = isTouch ? '点击画面返回大厅' : '按 E 或点击画面返回大厅（也可直接走出房门）';
        card.classList.add('on');
      } else card.classList.remove('on');
      cross.classList.toggle('hot', !!kind);
    }
  }

  renderer.render(scene, camera);
}
