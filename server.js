// IRON OATH 게임 서버
// - 명중 판정, 체력, 쿨다운, 부활은 모두 서버가 결정합니다(클라이언트 치팅 방지).
// - 이동은 클라이언트가 보내되, 서버가 속도/경계를 검사합니다.

import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { CLASSES, ARENA, PLAYER } from './classes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const MOVE_CHECK = process.env.NO_MOVE_CHECK !== '1';
const TICK_MS = 50; // 스냅샷 20Hz
const HIT_CONE = Math.cos((50 * Math.PI) / 180);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/three', express.static(path.join(__dirname, 'node_modules/three')));
app.get('/classes.js', (_q, r) => r.sendFile(path.join(__dirname, 'classes.js')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

const players = new Map(); // id -> player
let nextId = 1;
const now = () => Date.now();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}
function roster() {
  return [...players.values()].map((p) => ({
    id: p.id, name: p.name, cls: p.cls, kills: p.kills, deaths: p.deaths,
  }));
}
function spawnPoint() {
  const a = Math.random() * Math.PI * 2;
  const r = 26 + Math.random() * 8;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  return { x, y: 0, z, yaw: Math.atan2(x, z) }; // 중앙을 바라보게
}

function resolveAttack(attackerId) {
  const p = players.get(attackerId);
  if (!p || !p.alive) return;
  const c = CLASSES[p.cls];
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);

  for (const q of players.values()) {
    if (q === p || !q.alive) continue;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > c.reach + PLAYER.radius) continue;
    if (Math.abs(q.y - p.y) > 1.8) continue;
    if (dist > 0.6 && (dx * fx + dz * fz) / dist < HIT_CONE) continue;

    // 방어 판정: 방어 중이고, 공격자가 방어자의 정면에 있을 때
    const qc = CLASSES[q.cls];
    const tfx = -Math.sin(q.yaw);
    const tfz = -Math.cos(q.yaw);
    const facing = dist > 0.01 ? (tfx * -dx + tfz * -dz) / dist : 1;
    const blocked = q.blocking && facing > 0.3;
    const dmg = Math.max(1, Math.round(c.damage * (blocked ? 1 - qc.block : 1)));

    q.hp = Math.max(0, q.hp - dmg);
    broadcast({ t: 'hit', id: q.id, by: p.id, dmg, hp: q.hp, blocked });

    if (q.hp <= 0) {
      q.alive = false;
      q.blocking = false;
      q.deaths++;
      p.kills++;
      broadcast({ t: 'kill', killer: p.id, victim: q.id });
      broadcast({ t: 'roster', list: roster() });
      setTimeout(() => respawn(q.id), PLAYER.respawnMs);
    }
  }
}

function respawn(id) {
  const q = players.get(id);
  if (!q) return;
  const s = spawnPoint();
  Object.assign(q, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, hp: CLASSES[q.cls].hp, alive: true, blocking: false });
  q.lastState = now();
  broadcast({ t: 'respawn', id: q.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: q.hp });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (ws.pid) return;
      if (players.size >= MAX_PLAYERS) return send(ws, { t: 'full' });
      const id = nextId++;
      const cls = CLASSES[m.cls] ? m.cls : 'knight';
      const name = String(m.name ?? '').replace(/[<>&"'`]/g, '').trim().slice(0, PLAYER.maxNameLen) || `Knight${id}`;
      const s = spawnPoint();
      const p = {
        id, ws, name, cls, ...s, pitch: 0, hp: CLASSES[cls].hp, alive: true, blocking: false,
        kills: 0, deaths: 0, lastAttack: 0, lastState: now(),
      };
      players.set(id, p);
      ws.pid = id;
      send(ws, { t: 'welcome', id, cls, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: p.hp, roster: roster() });
      broadcast({ t: 'roster', list: roster() });
      console.log(`[+] ${name} (${cls}) 입장 — 현재 ${players.size}명`);
      return;
    }

    const p = players.get(ws.pid);
    if (!p) return;

    if (m.t === 'state') {
      if (!p.alive) return;
      const { x, y, z, yaw, pitch } = m;
      if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
      const t = now();
      const dt = Math.min((t - p.lastState) / 1000, 0.5);
      p.lastState = t;
      const maxDist = CLASSES[p.cls].speed * 1.5 * dt + 0.6;
      if (MOVE_CHECK && Math.hypot(x - p.x, z - p.z) > maxDist) {
        return send(ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
      }
      const lim = ARENA.half - PLAYER.radius;
      p.x = Math.max(-lim, Math.min(lim, x));
      p.z = Math.max(-lim, Math.min(lim, z));
      p.y = Math.max(0, Math.min(20, y));
      p.yaw = yaw;
      p.pitch = Math.max(-1.6, Math.min(1.6, pitch));
      p.blocking = !!m.b;
    } else if (m.t === 'attack') {
      if (!p.alive) return;
      const c = CLASSES[p.cls];
      const t = now();
      if (t - p.lastAttack < c.cooldown * 1000 - 30) return;
      p.lastAttack = t;
      p.blocking = false;
      broadcast({ t: 'swing', id: p.id });
      setTimeout(() => resolveAttack(p.id), c.windup * 1000);
    }
  });

  ws.on('close', () => {
    const p = players.get(ws.pid);
    if (!p) return;
    players.delete(p.id);
    broadcast({ t: 'roster', list: roster() });
    console.log(`[-] ${p.name} 퇴장 — 현재 ${players.size}명`);
  });
});

setInterval(() => {
  if (!players.size) return;
  broadcast({
    t: 'snap',
    p: [...players.values()].map((p) => ({
      id: p.id,
      x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
      b: p.blocking, hp: p.hp, alive: p.alive,
    })),
  });
}, TICK_MS);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n⚔  IRON OATH 서버가 열렸습니다!');
  console.log(`   이 컴퓨터:        http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`   같은 와이파이/LAN: http://${i.address}:${PORT}`);
    }
  }
  console.log(`   최대 인원: ${MAX_PLAYERS}명\n`);
});
