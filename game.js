import * as THREE from 'three';
import { CLASSES, ARENA, PLAYER } from '/classes.js';

const $ = (id) => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const lerpAngle = (a, b, k) => {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * k;
};

/* ───────────── 렌더러 / 장면 ───────────── */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db7d1);
scene.fog = new THREE.Fog(0x9db7d1, 30, 120);

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
camera.rotation.order = 'YXZ';
scene.add(camera);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a4a3a, 1.3));
const sun = new THREE.DirectionalLight(0xfff1d0, 2.2);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 150 });
scene.add(sun);

// 바닥
{
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#4f7a3a';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `hsl(${90 + Math.random() * 30}, ${35 + Math.random() * 20}%, ${25 + Math.random() * 18}%)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.half * 2, ARENA.half * 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const dirt = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshStandardMaterial({ color: 0x7a6446, roughness: 1 }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.01;
  dirt.receiveShadow = true;
  scene.add(dirt);
}

// 성벽 + 기둥
const stone = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95 });
{
  const h = ARENA.half, len = h * 2 + 4;
  const walls = [[0, -h - 1, len, 2], [0, h + 1, len, 2], [-h - 1, 0, 2, len], [h + 1, 0, 2, len]];
  for (const [x, z, w, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), stone);
    m.position.set(x, 3, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    // 총안(성가퀴)
    const horizontal = w > d;
    for (let i = -h; i <= h; i += 4) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 2 : 2.2, 1.2, horizontal ? 2.2 : 2), stone);
      b.position.set(horizontal ? i : x, 6.6, horizontal ? z : i);
      b.castShadow = true;
      scene.add(b);
    }
  }
  for (const p of ARENA.pillars) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.15, 6, 18), stone);
    col.position.set(p.x, 3, p.z);
    col.castShadow = col.receiveShadow = true;
    scene.add(col);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.3, p.r * 1.3, 0.4, 18), stone);
    cap.position.set(p.x, 6.2, p.z);
    cap.castShadow = true;
    scene.add(cap);
  }
}

/* ───────────── 칼 / 기사 모델 ───────────── */
function makeSword(len) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.85, roughness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc79a3a, metalness: 0.6, roughness: 0.4 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.9 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.014), steel);
  blade.position.y = len / 2 + 0.1;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.045, 0.06), gold);
  guard.position.y = 0.1;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8), leather);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), gold);
  pommel.position.y = -0.12;
  g.add(blade, guard, grip, pommel);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const swordLen = (c) => 1.0 * (c.reach / 2.6);

function nameSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 30px Georgia, serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, 128, 40);
  g.fillStyle = color;
  g.fillText(text, 128, 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
  s.scale.set(1.8, 0.45, 1);
  s.position.y = 2.35;
  return s;
}

function makeKnight(clsId, name) {
  const c = CLASSES[clsId];
  const g = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.4 });
  const cloth = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.22, 0.8, 0.26), armor, -0.15, 0.4, 0);
  add(new THREE.BoxGeometry(0.22, 0.8, 0.26), armor, 0.15, 0.4, 0);
  add(new THREE.BoxGeometry(0.62, 0.72, 0.34), cloth, 0, 1.15, 0);
  add(new THREE.BoxGeometry(0.7, 0.2, 0.4), armor, 0, 1.5, 0);
  add(new THREE.BoxGeometry(0.3, 0.34, 0.32), armor, 0, 1.76, 0);
  add(new THREE.BoxGeometry(0.24, 0.04, 0.02), dark, 0, 1.78, -0.17);
  add(new THREE.BoxGeometry(0.06, 0.2, 0.32), cloth, 0, 1.99, 0);
  add(new THREE.BoxGeometry(0.14, 0.6, 0.14), armor, -0.42, 1.18, 0);

  const arm = new THREE.Group();
  arm.position.set(0.42, 1.48, 0);
  add(new THREE.BoxGeometry(0.14, 0.6, 0.14), armor, 0, -0.3, 0, arm);
  const sword = makeSword(swordLen(c));
  sword.position.set(0, -0.6, 0);
  sword.rotation.x = -Math.PI / 2; // 팔 기준 앞쪽을 향하게
  arm.add(sword);
  g.add(arm);

  if (clsId === 'shield') {
    const sh = add(new THREE.BoxGeometry(0.08, 0.8, 0.55), cloth, -0.58, 1.15, -0.12);
    add(new THREE.BoxGeometry(0.1, 0.84, 0.05), armor, -0.58, 1.15, -0.4);
    add(new THREE.BoxGeometry(0.1, 0.84, 0.05), armor, -0.58, 1.15, 0.16);
    sh.rotation.y = 0.15;
  }
  const label = nameSprite(name, '#ffe9a8');
  g.add(label);
  scene.add(g);
  return { group: g, arm, label };
}

/* ───────────── 상태 ───────────── */
const me = {
  id: null, cls: 'knight', x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0,
  hp: 100, alive: false, blocking: false, swingT: -1, lastAtk: 0, onGround: true,
};
let joined = false;
let roster = [];
const remotes = new Map();
let selectedCls = 'knight';
let deadUntil = 0;
let killerName = '';

const THETA = { idle: 0.7, raised: 2.6, end: 0.3 };
const POSE = {
  idle: { p: [0.34, -0.34, -0.55], r: [-0.45, 0.1, 0.35] },
  raised: { p: [0.5, -0.05, -0.4], r: [0.5, 0, -0.5] },
  end: { p: [-0.12, -0.45, -0.7], r: [-1.3, 0, 0.9] },
  block: { p: [0.02, -0.22, -0.5], r: [-0.2, 0, 0.25] },
};
const mixPose = (a, b, k) => ({
  p: a.p.map((v, i) => lerp(v, b.p[i], k)),
  r: a.r.map((v, i) => lerp(v, b.r[i], k)),
});

function swingParams(c) {
  const raise = Math.max(c.windup, 0.08);
  const strike = 0.12;
  const rec = Math.max(0.1, c.cooldown - raise - strike);
  return { raise, strike, rec, total: raise + strike + rec };
}
function swingKeys(t, c) {
  const s = swingParams(c);
  if (t < s.raise) return ['idle', 'raised', easeOut(t / s.raise)];
  if (t < s.raise + s.strike) return ['raised', 'end', (t - s.raise) / s.strike];
  if (t < s.total) return ['end', 'idle', (t - s.raise - s.strike) / s.rec];
  return null;
}

/* 1인칭 칼 */
const vm = new THREE.Group();
camera.add(vm);
let vmBlend = 0;
function buildViewmodel() {
  vm.clear();
  const s = makeSword(swordLen(CLASSES[me.cls]));
  s.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  vm.add(s);
}

/* ───────────── 사운드 ───────────── */
let ac;
const audio = () => (ac ??= new (window.AudioContext || window.webkitAudioContext)());
function clang(vol = 0.3) {
  try {
    const a = audio(), t = a.currentTime;
    [1400, 2100, 3300].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle';
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      g.gain.setValueAtTime(vol / (i + 1.5), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + 0.4);
    });
  } catch {}
}
function thud(vol = 0.4) {
  try {
    const a = audio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + 0.25);
  } catch {}
}
function whoosh(vol = 0.15) {
  try {
    const a = audio(), t = a.currentTime;
    const buf = a.createBuffer(1, a.sampleRate * 0.25, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.2);
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  } catch {}
}
function volFor(id, base) {
  if (id === me.id) return base;
  const r = remotes.get(id);
  if (!r) return 0;
  const d = Math.hypot(r.group.position.x - me.x, r.group.position.z - me.z);
  return base * clamp(1 - d / 40, 0, 1);
}

/* ───────────── 로비 UI ───────────── */
const STATS = [
  ['체력', (c) => c.hp / 150], ['속도', (c) => c.speed / 6.5], ['공격력', (c) => c.damage / 40],
  ['공속', (c) => 1 / c.cooldown / 2.7], ['사거리', (c) => c.reach / 3.2], ['방어', (c) => c.block],
];
for (const c of Object.values(CLASSES)) {
  const el = document.createElement('div');
  el.className = 'card' + (c.id === selectedCls ? ' sel' : '');
  el.innerHTML = `<h3></h3><p class="d"></p>` + STATS.map(([n, f]) => `<div class="stat"><span>${n}</span><div class="bar"><i style="width:${Math.round(clamp(f(c), 0.05, 1) * 100)}%"></i></div></div>`).join('');
  el.querySelector('h3').textContent = c.name;
  el.querySelector('.d').textContent = c.desc;
  el.onclick = () => {
    selectedCls = c.id;
    document.querySelectorAll('.card').forEach((x) => x.classList.remove('sel'));
    el.classList.add('sel');
  };
  $('cards').appendChild(el);
}
$('name').value = localStorage.getItem('ironoath_name') || '';

/* ───────────── 네트워크 ───────────── */
let ws;
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  const name = $('name').value.trim() || 'Knight';
  localStorage.setItem('ironoath_name', name);
  $('join').disabled = true;
  $('lobmsg').textContent = '접속 중…';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => send({ t: 'join', name, cls: selectedCls });
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onerror = () => {};
  ws.onclose = () => {
    if (joined) {
      document.exitPointerLock?.();
      $('pause').style.display = 'flex';
      $('pause').innerHTML = '<div>서버와 연결이 끊어졌습니다</div><small>클릭하면 새로고침합니다</small>';
      $('pause').onclick = () => location.reload();
    } else {
      $('lobmsg').textContent = '서버에 연결하지 못했습니다.';
      $('join').disabled = false;
    }
  };
}
$('join').onclick = () => {
  audio();
  connect();
  canvas.requestPointerLock?.();
};

const nameOf = (id) => roster.find((r) => r.id === id)?.name ?? '???';

function syncRemotes() {
  const ids = new Set(roster.map((r) => r.id));
  for (const [id, r] of remotes) {
    if (!ids.has(id)) { scene.remove(r.group); remotes.delete(id); }
  }
  for (const p of roster) {
    if (p.id === me.id || remotes.has(p.id)) continue;
    const k = makeKnight(p.cls, p.name);
    remotes.set(p.id, {
      id: p.id, cls: p.cls, ...k, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0,
      th: THETA.idle, swingT: -1, blocking: false, alive: true, init: false, fall: 0,
    });
  }
  renderBoard();
}

function renderBoard() {
  const body = $('boardbody');
  body.textContent = '';
  const rows = [...roster].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r.id === me.id) tr.className = 'me';
    for (const [txt, cls] of [[r.name, ''], [CLASSES[r.cls]?.name ?? r.cls, ''], [r.kills, 'n'], [r.deaths, 'n']]) {
      const td = document.createElement('td');
      td.textContent = txt;
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  const mine = roster.find((r) => r.id === me.id);
  $('kd').textContent = mine ? `처치 ${mine.kills}  /  사망 ${mine.deaths}` : '';
}

function updateHud() {
  const c = CLASSES[me.cls];
  $('clsname').textContent = c.name;
  $('hpfill').style.width = `${clamp((me.hp / c.hp) * 100, 0, 100)}%`;
  $('hptext').textContent = `${Math.ceil(me.hp)} / ${c.hp}`;
}

function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('feed').appendChild(d);
  setTimeout(() => d.remove(), 6000);
  while ($('feed').children.length > 6) $('feed').firstChild.remove();
}

function handle(m) {
  switch (m.t) {
    case 'full':
      $('lobmsg').textContent = '서버가 가득 찼습니다.';
      $('join').disabled = false;
      break;
    case 'welcome':
      Object.assign(me, { id: m.id, cls: m.cls, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, hp: m.hp, alive: true });
      roster = m.roster;
      joined = true;
      buildViewmodel();
      syncRemotes();
      updateHud();
      $('lobby').style.display = 'none';
      $('hud').style.display = 'block';
      updatePause();
      break;
    case 'roster':
      roster = m.list;
      syncRemotes();
      break;
    case 'snap':
      for (const p of m.p) {
        if (p.id === me.id) {
          if (p.hp !== me.hp) { me.hp = p.hp; updateHud(); }
          continue;
        }
        const r = remotes.get(p.id);
        if (!r) continue;
        r.tx = p.x; r.ty = p.y; r.tz = p.z; r.tyaw = p.yaw; r.blocking = p.b; r.alive = p.alive;
        const pos = r.group.position;
        if (!r.init || Math.hypot(pos.x - p.x, pos.z - p.z) > 6) {
          pos.set(p.x, p.y, p.z); r.yaw = p.yaw; r.init = true;
        }
      }
      break;
    case 'swing': {
      if (m.id === me.id) break;
      const r = remotes.get(m.id);
      if (r) r.swingT = 0;
      whoosh(volFor(m.id, 0.15));
      break;
    }
    case 'hit':
      if (m.id === me.id) {
        me.hp = m.hp;
        updateHud();
        $('dmg').style.opacity = m.blocked ? 0.25 : 0.8;
        setTimeout(() => ($('dmg').style.opacity = 0), 120);
      }
      if (m.by === me.id && m.id !== me.id) {
        const h = $('hitmark');
        h.className = m.blocked ? 'blocked' : '';
        h.style.opacity = 1;
        setTimeout(() => (h.style.opacity = 0), 150);
      }
      m.blocked ? clang(volFor(m.id, 0.35)) : thud(volFor(m.id, 0.5));
      break;
    case 'kill': {
      feed(`${nameOf(m.killer)}  ⚔  ${nameOf(m.victim)}`);
      if (m.victim === me.id) {
        me.alive = false;
        me.blocking = false;
        killerName = nameOf(m.killer);
        deadUntil = performance.now() + PLAYER.respawnMs;
        $('death').style.display = 'block';
      }
      break;
    }
    case 'respawn':
      if (m.id === me.id) {
        Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, hp: m.hp, alive: true, vy: 0 });
        $('death').style.display = 'none';
        updateHud();
      }
      break;
    case 'correct':
      me.x = m.x; me.y = m.y; me.z = m.z;
      break;
  }
}

/* ───────────── 입력 ───────────── */
const keys = {};
const locked = () => document.pointerLockElement === canvas;

function updatePause() {
  const show = joined && !locked();
  $('pause').style.display = show ? 'flex' : 'none';
}
document.addEventListener('pointerlockchange', updatePause);
$('pause').addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  canvas.requestPointerLock?.();
});

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); $('board').style.display = 'block'; }
  keys[e.code] = true;
});
addEventListener('keyup', (e) => {
  if (e.code === 'Tab') $('board').style.display = 'none';
  keys[e.code] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('mousemove', (e) => {
  if (!locked() || !me.alive) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch = clamp(me.pitch - e.movementY * 0.0022, -1.45, 1.45);
});
addEventListener('mousedown', (e) => {
  if (!locked() || !me.alive) return;
  if (e.button === 0) tryAttack();
  if (e.button === 2) me.blocking = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) me.blocking = false;
});

function tryAttack() {
  const c = CLASSES[me.cls];
  const t = performance.now();
  if (t - me.lastAtk < c.cooldown * 1000) return;
  me.lastAtk = t;
  me.swingT = 0;
  me.blocking = false;
  send({ t: 'attack' });
  whoosh(0.18);
}

/* ───────────── 업데이트 루프 ───────────── */
const clock = new THREE.Clock();
let sendTimer = 0;

function update(dt) {
  const c = CLASSES[me.cls];

  if (joined && me.alive) {
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    let vx = 0, vz = 0;
    if (f || s) {
      const len = Math.hypot(f, s);
      const sp = c.speed * (me.blocking ? 0.55 : 1) * (me.swingT >= 0 ? 0.8 : 1);
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
      vx = ((fx * f + rx * s) / len) * sp;
      vz = ((fz * f + rz * s) / len) * sp;
    }
    me.x += vx * dt;
    me.z += vz * dt;

    if (keys.Space && me.onGround) { me.vy = PLAYER.jump; me.onGround = false; }
    me.vy -= PLAYER.gravity * dt;
    me.y += me.vy * dt;
    if (me.y <= 0) { me.y = 0; me.vy = 0; me.onGround = true; }

    // 충돌: 기둥, 경계
    for (const p of ARENA.pillars) {
      const dx = me.x - p.x, dz = me.z - p.z;
      const d = Math.hypot(dx, dz), min = p.r + PLAYER.radius;
      if (d < min && d > 0.0001) { me.x = p.x + (dx / d) * min; me.z = p.z + (dz / d) * min; }
    }
    const lim = ARENA.half - PLAYER.radius;
    me.x = clamp(me.x, -lim, lim);
    me.z = clamp(me.z, -lim, lim);

    sendTimer += dt;
    if (sendTimer >= 0.05) {
      sendTimer = 0;
      send({ t: 'state', x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, b: me.blocking });
    }
  }

  // 카메라
  const dead = joined && !me.alive;
  camera.position.set(me.x, me.y + (dead ? 0.35 : PLAYER.eye), me.z);
  camera.rotation.set(dead ? -0.2 : me.pitch, me.yaw, dead ? 0.5 : 0);

  // 1인칭 칼 애니메이션
  let pose = POSE.idle;
  if (me.swingT >= 0) {
    me.swingT += dt;
    const k = swingKeys(me.swingT, c);
    if (k) pose = mixPose(POSE[k[0]], POSE[k[1]], k[2]);
    else me.swingT = -1;
  }
  vmBlend = lerp(vmBlend, me.blocking && me.alive ? 1 : 0, Math.min(1, dt * 14));
  const fin = mixPose(pose, POSE.block, vmBlend);
  vm.position.set(...fin.p);
  vm.rotation.set(...fin.r);
  vm.visible = me.alive;

  // 다른 기사들
  const k = 1 - Math.exp(-14 * dt);
  for (const r of remotes.values()) {
    const pos = r.group.position;
    pos.x = lerp(pos.x, r.tx, k);
    pos.z = lerp(pos.z, r.tz, k);
    pos.y = lerp(pos.y, r.ty, k);
    r.yaw = lerpAngle(r.yaw, r.tyaw, k);
    r.group.rotation.y = r.yaw;

    let th = r.blocking ? 1.3 : THETA.idle;
    if (r.swingT >= 0) {
      r.swingT += dt;
      const sk = swingKeys(r.swingT, CLASSES[r.cls]);
      if (sk) th = lerp(THETA[sk[0]], THETA[sk[1]], sk[2]);
      else r.swingT = -1;
      r.th = th;
    } else {
      r.th = lerp(r.th, th, Math.min(1, dt * 14));
    }
    r.arm.rotation.x = r.th;

    r.fall = lerp(r.fall, r.alive ? 0 : 1, Math.min(1, dt * 8));
    r.group.rotation.x = r.fall * (Math.PI / 2);
    r.label.visible = r.alive;
  }

  // 사망 문구
  if (dead) {
    const left = Math.max(0, Math.ceil((deadUntil - performance.now()) / 1000));
    $('death').innerHTML = `전사했습니다<small></small>`;
    $('death').querySelector('small').textContent = `${killerName}에게 쓰러졌습니다 · ${left}초 후 부활`;
  }
}

function frame() {
  requestAnimationFrame(frame);
  update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}
frame();
