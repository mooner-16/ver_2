// 공격·스킬·투사체·지면 효과 (서버 판정)
import { CLASSES, SKILLS, PLAYER, KICK, PROJ } from './classes.js';
import { solidAt, lineBlocked, blocksShot, MAP } from './map.js';
import {
  G, now, clamp, send, broadcast, broadcastTeam, live, teamsOn, isEnemy, isAlly, enemiesOf, alliesOf,
  cantAct, isStunned, isStaggered, buffDmg, damage, heal, addShield, applyBuff, status, addDot, push,
} from './core.js';

const HIT_CONE = Math.cos((50 * Math.PI) / 180);
const EYE = PLAYER.eye;
const rad = (d) => (d * Math.PI) / 180;

export const projs = [];
export const zones = [];
let nextPid = 1, nextZid = 1;

function aim(p, m) {
  if (m && Number.isFinite(m.yaw) && Number.isFinite(m.pitch)) { p.yaw = m.yaw; p.pitch = clamp(m.pitch, -1.5, 1.5); }
}
function dirOf(yaw, pitch) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}
const later = (sec, fn) => setTimeout(fn, sec * 1000);

// ───────── 근접 판정 ─────────
export function strike(p, o) {
  if (!p.alive) return 0;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let n = 0;
  for (const q of enemiesOf(p)) {
    const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > o.reach + PLAYER.radius) continue;
    if (Math.abs(q.y - p.y) > 1.8) continue;
    if (o.cos > -1 && dist > 0.6 && (dx * fx + dz * fz) / dist < o.cos) continue;
    if (lineBlocked(p.x, p.z, q.x, q.z)) continue;
    const r = damage(p, q, o.dmg, {
      kind: o.kind || 'melee', ignoreBlock: o.ignoreBlock, skill: o.skill, counter: o.counter,
      knock: o.knock, stun: o.stun, guardBreak: o.guardBreak, ax: p.x, az: p.z,
    });
    if (!r) continue;
    n++;
    if (o.dot && !r.parried && q.alive) addDot(q, p, o.dot);
  }
  return n;
}

// ───────── 기본 공격 (좌클릭) ─────────
export function basicAttack(p, m) {
  if (cantAct(p)) return;
  aim(p, m);
  const c = CLASSES[p.cls], t = now();
  const counter = p.counterUntil > t && c.reach > 0;
  if (!counter && t - p.lastAttack < c.cooldown * 1000 - 30) return;
  p.lastAttack = t;
  p.blocking = false;
  p.counterUntil = 0;
  let mult = buffDmg(p) * (counter ? PLAYER.counterMult : 1);
  let ignoreBlock = counter, dot = null;
  if (p.stealthUntil > t && p.stealthNext) {
    mult *= p.stealthNext.nextMult; ignoreBlock = true; dot = p.stealthNext.dot;
    p.stealthUntil = 0; p.stealthNext = null;
    broadcast({ t: 'stealth', id: p.id, ms: 0 });
  }
  broadcast({ t: 'swing', id: p.id, counter });
  const wind = c.windup * (counter ? PLAYER.counterWindupMult : 1);
  later(wind, () => {
    if (!p.alive || isStunned(p) || isStaggered(p)) return;
    if (c.reach > 0) {
      strike(p, { reach: c.reach, cos: HIT_CONE, dmg: Math.round(c.damage * mult), ignoreBlock, counter, dot, kind: 'melee' });
    } else {
      fireProj(p, c.basic.proj, c.damage * mult, 0);
    }
  });
}

// ───────── 발차기 (E, 쿨타임 없음) ─────────
export function kick(p, m) {
  if (cantAct(p)) return;
  aim(p, m);
  const t = now();
  if (t - p.lastKick < PLAYER.kickGap) return;
  p.lastKick = t;
  p.blocking = false;
  broadcast({ t: 'kick', id: p.id });
  later(KICK.windup, () => {
    if (!p.alive || isStunned(p) || isStaggered(p)) return;
    strike(p, { reach: KICK.reach, cos: Math.cos(rad(KICK.cone)), dmg: KICK.dmg, kind: 'kick', ignoreBlock: true, knock: KICK.knock, guardBreak: KICK.guardBreak, skill: 'kick' });
  });
}

// ───────── 투사체 ─────────
export function fireProj(p, type, dmg, yawOff = 0, pitchOff = 0, extra = {}) {
  const def = PROJ[type];
  const yaw = p.yaw + yawOff, pitch = p.pitch + pitchOff;
  const [dx, dy, dz] = dirOf(yaw, pitch);
  const o = { x: p.x + dx * 0.7, y: p.y + EYE - 0.15 + dy * 0.7, z: p.z + dz * 0.7 };
  const pr = {
    pid: nextPid++, owner: p.id, type, def, dmg, sx: p.x, sz: p.z, born: now(),
    x: o.x, y: o.y, z: o.z, vx: dx * def.speed, vy: dy * def.speed, vz: dz * def.speed, ...extra,
  };
  projs.push(pr);
  broadcast({ t: 'proj', pid: pr.pid, o: p.id, type, x: pr.x, y: pr.y, z: pr.z, vx: pr.vx, vy: pr.vy, vz: pr.vz });
  return pr;
}

function explode(pr, owner, skipId) {
  const sp = pr.def.splash;
  if (!sp || !owner) return;
  for (const q of enemiesOf(owner)) {
    if (q.id === skipId) continue;
    const d = Math.hypot(q.x - pr.x, q.z - pr.z);
    if (d > sp.r + 0.4 || Math.abs(q.y + 1 - pr.y) > 3.2) continue;
    damage(owner, q, pr.dmg * sp.mult, { kind: 'proj', skill: pr.type, ignoreBlock: false, ax: pr.x, az: pr.z, knock: 1.2 });
  }
}

function endProj(pr, i, hit) {
  projs.splice(i, 1);
  broadcast({ t: 'projend', pid: pr.pid, x: pr.x, y: pr.y, z: pr.z, hit: !!hit, type: pr.type, splash: pr.def.splash ? pr.def.splash.r : 0 });
}

export function stepProjs(dt) {
  const t = now();
  for (let i = projs.length - 1; i >= 0; i--) {
    const pr = projs[i], d = pr.def, owner = G.players.get(pr.owner);
    if (!owner || t - pr.born > d.life * 1000) { endProj(pr, i, false); continue; }
    const n = Math.max(1, Math.ceil((d.speed * dt) / 0.4)), h = dt / n;
    let ended = false;
    for (let s = 0; s < n && !ended; s++) {
      pr.vy -= d.gravity * h;
      pr.x += pr.vx * h; pr.y += pr.vy * h; pr.z += pr.vz * h;
      if (blocksShot(pr.x, pr.y, pr.z)) {
        if (pr.y < 0) pr.y = 0;
        if (d.splashOnWorld || d.splash) explode(pr, owner, -1);
        endProj(pr, i, true); ended = true; break;
      }
      for (const q of live()) {
        if (!q.alive || q.id === pr.owner) continue;
        const ally = isAlly(owner, q);
        if (!isEnemy(owner, q) && !(d.healAlly && ally)) continue;
        if (Math.hypot(q.x - pr.x, q.z - pr.z) > d.radius + 0.45) continue;
        if (pr.y < q.y - 0.1 || pr.y > q.y + 1.9 + d.radius) continue;
        if (ally) { heal(q, Math.round(pr.dmg), owner); endProj(pr, i, true); ended = true; break; }
        const head = d.headshot && pr.y > q.y + 1.45;
        const r = damage(owner, q, pr.dmg, { kind: 'proj', skill: pr.type, head, ax: pr.sx, az: pr.sz });
        if (r && !r.parried) {
          if (d.slow) status(q, 'slow', d.slow.ms, { mult: d.slow.mult });
          if (d.dot && q.alive) addDot(q, owner, d.dot);
        }
        explode(pr, owner, q.id);
        endProj(pr, i, true); ended = true; break;
      }
    }
  }
}

// ───────── 지면 효과 ─────────
function aimPoint(p, range) {
  const [dx, dy, dz] = dirOf(p.yaw, p.pitch);
  const hz = Math.hypot(dx, dz) || 1;
  let dist = range;
  if (dy < -0.02) dist = Math.min(range, (p.y + EYE) * (hz / -dy));
  let x = p.x + (dx / hz) * dist, z = p.z + (dz / hz) * dist;
  // 건물 앞에서 멈춤
  const steps = Math.ceil(dist / 0.5);
  for (let i = 1; i <= steps; i++) {
    const tx = p.x + (dx / hz) * (dist * i) / steps, tz = p.z + (dz / hz) * (dist * i) / steps;
    if (blocksShot(tx, 1.4, tz)) { x = p.x + (dx / hz) * (dist * (i - 1)) / steps; z = p.z + (dz / hz) * (dist * (i - 1)) / steps; break; }
  }
  return [clamp(x, -MAP.halfX + 1, MAP.halfX - 1), clamp(z, -MAP.halfZ + 1, MAP.halfZ - 1)];
}

function castGround(p, def) {
  const [x, z] = def.at === 'self' ? [p.x, p.z] : aimPoint(p, def.range);
  if (def.mode === 'trap') {
    const mine = zones.filter((zn) => zn.owner === p.id && zn.mode === 'trap');
    if (mine.length >= (def.max || 3)) { const old = mine[0]; zones.splice(zones.indexOf(old), 1); broadcast({ t: 'zoneend', zid: old.zid }); }
  }
  const zn = {
    zid: nextZid++, owner: p.id, team: p.team, mode: def.mode, skill: def.id, x, z, r: def.radius,
    dmg: def.dmg || 0, dps: def.dps || 0, heal: def.heal || 0, knock: def.knock || 0, root: def.root || 0, slow: def.slow || null,
    armAt: now() + (def.delay || 0) * 1000, until: now() + (def.dur ? def.dur * 1000 : 0) + (def.delay || 0) * 1000, nextTick: 0,
    mult: buffDmg(p),
  };
  zones.push(zn);
  const msg = { t: 'zone', zid: zn.zid, fx: def.fx, mode: def.mode, x, z, r: def.radius, color: def.color, delay: def.delay || 0, dur: def.dur || 0, o: p.id, team: p.team };
  if (def.mode === 'trap') {
    if (teamsOn()) broadcastTeam(p.team, msg); else send(p.ws, msg);
  } else broadcast(msg);
}

export function stepZones() {
  const t = now();
  for (let i = zones.length - 1; i >= 0; i--) {
    const zn = zones[i], owner = G.players.get(zn.owner);
    if (!owner) { zones.splice(i, 1); broadcast({ t: 'zoneend', zid: zn.zid }); continue; }
    if (t < zn.armAt) continue;
    const inside = (q, extra = 0.4) => q.alive && Math.hypot(q.x - zn.x, q.z - zn.z) < zn.r + extra && q.y < 3;
    if (zn.mode === 'burst') {
      for (const q of enemiesOf(owner)) {
        if (!inside(q)) continue;
        damage(owner, q, zn.dmg * zn.mult, { kind: 'skill', skill: zn.skill, ignoreBlock: true, knock: zn.knock, ax: zn.x, az: zn.z });
        if (zn.root && q.alive) status(q, 'root', zn.root);
      }
      zones.splice(i, 1); broadcast({ t: 'zoneend', zid: zn.zid, boom: true });
    } else if (zn.mode === 'trap') {
      const victim = enemiesOf(owner).find((q) => inside(q, 0));
      if (victim) {
        for (const q of enemiesOf(owner)) if (inside(q, 0.2)) {
          damage(owner, q, zn.dmg * zn.mult, { kind: 'skill', skill: zn.skill, ignoreBlock: true, ax: zn.x, az: zn.z });
          if (q.alive) status(q, 'root', zn.root);
        }
        zones.splice(i, 1); broadcast({ t: 'zoneend', zid: zn.zid, boom: true });
      } else if (t > zn.until) { zones.splice(i, 1); broadcast({ t: 'zoneend', zid: zn.zid }); }
    } else if (zn.mode === 'field') {
      if (t > zn.until) { zones.splice(i, 1); broadcast({ t: 'zoneend', zid: zn.zid }); continue; }
      if (t >= zn.nextTick) {
        zn.nextTick = t + 500;
        for (const q of live()) {
          if (!inside(q)) continue;
          if (q === owner || isAlly(owner, q)) { if (zn.heal) heal(q, Math.round(zn.heal * 0.5), owner); }
          else if (isEnemy(owner, q)) {
            if (zn.dps) damage(owner, q, Math.max(1, Math.round(zn.dps * 0.5 * zn.mult)), { kind: 'dot', ignoreBlock: true });
            if (zn.slow && q.alive) status(q, 'slow', zn.slow.ms, { mult: zn.slow.mult });
          }
        }
      }
    }
  }
}

// ───────── 스킬 (Q) ─────────
function pickTarget(p, range, maxAngle, exclude = []) {
  const [dx, dy, dz] = dirOf(p.yaw, p.pitch);
  const ex = p.x, ey = p.y + EYE, ez = p.z;
  let best = null, bestAng = rad(maxAngle);
  for (const q of enemiesOf(p)) {
    if (exclude.includes(q.id)) continue;
    const vx = q.x - ex, vy = q.y + 1.2 - ey, vz = q.z - ez, d = Math.hypot(vx, vy, vz);
    if (d > range || d < 0.01) continue;
    const ang = Math.acos(clamp((vx * dx + vy * dy + vz * dz) / d, -1, 1));
    if (ang > bestAng || lineBlocked(p.x, p.z, q.x, q.z)) continue;
    bestAng = ang; best = q;
  }
  return best;
}

export function useSkill(p, m) {
  if (cantAct(p)) return;
  aim(p, m);
  const c = CLASSES[p.cls], id = c.skill, def = SKILLS[id];
  if (!def) return;
  const t = now();
  if (t < (p.cds[id] || 0) - 80) return;
  p.cds[id] = t + def.cooldown * 1000;
  p.blocking = false;
  broadcast({ t: 'skill', id: p.id, skill: id, kind: def.kind });
  const mult = buffDmg(p);

  switch (def.kind) {
    case 'buff': {
      applyBuff(p, def);
      if (def.radius) for (const q of alliesOf(p)) if (Math.hypot(q.x - p.x, q.z - p.z) < def.radius) applyBuff(q, def);
      broadcast({ t: 'nova', id: p.id, x: p.x, z: p.z, r: def.radius || 2.5, color: 0xffd45a });
      break;
    }
    case 'strike': {
      if (def.dash) p.dashUntil = t + def.dash.dur * 1000 + 300;
      const reach = def.reach ?? c.reach + (def.reachAdd || 0);
      const cos = def.cone >= 360 ? -2 : Math.cos(rad(def.cone));
      const hits = def.hits || 1;
      for (let i = 0; i < hits; i++) {
        later(def.windup + i * (def.hitGap || 0), () => {
          if (!p.alive || isStunned(p) || isStaggered(p)) return;
          const last = i === hits - 1;
          strike(p, {
            reach, cos, skill: id, kind: 'skill', dmg: Math.round(c.damage * def.dmgMult * mult),
            ignoreBlock: !!def.ignoreBlock, knock: last ? def.finalKnock ?? def.knock : def.knock, stun: last ? def.stun : 0,
          });
        });
      }
      break;
    }
    case 'proj': {
      later(def.windup ?? 0.2, () => {
        if (!p.alive || isStunned(p) || isStaggered(p)) return;
        const n = def.count || 1;
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? 0 : rad(((i / (n - 1)) - 0.5) * def.spread * 2);
          fireProj(p, def.proj, c.damage * def.dmgMult * mult, off);
        }
      });
      break;
    }
    case 'ground': castGround(p, { ...def, id }); break;
    case 'nova': {
      later(def.windup ?? 0.25, () => {
        if (!p.alive || isStunned(p) || isStaggered(p)) return;
        broadcast({ t: 'nova', id: p.id, x: p.x, z: p.z, r: def.radius, color: def.color });
        for (const q of enemiesOf(p)) {
          if (Math.hypot(q.x - p.x, q.z - p.z) > def.radius + 0.4 || lineBlocked(p.x, p.z, q.x, q.z)) continue;
          if (def.dmg) damage(p, q, def.dmg * mult, { kind: 'skill', skill: id, ignoreBlock: true, knock: def.knock, ax: p.x, az: p.z });
          if (!q.alive) continue;
          if (def.root) status(q, 'root', def.root);
          const sl = def.slow || def.enemySlow;
          if (sl) status(q, 'slow', sl.ms, { mult: sl.mult });
        }
        const near = [p, ...alliesOf(p).filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < def.radius)];
        for (const q of near) {
          if (def.heal) heal(q, def.heal, p);
          if (def.buffAllies) applyBuff(q, def.buffAllies);
        }
        if (def.selfShield) addShield(p, def.selfShield);
      });
      break;
    }
    case 'stealth': {
      p.stealthUntil = t + def.dur;
      p.stealthNext = { nextMult: def.nextMult, dot: def.dot };
      applyBuff(p, { dur: def.dur, dmgMult: 1, speedMult: def.speedMult });
      broadcast({ t: 'stealth', id: p.id, ms: def.dur });
      break;
    }
    case 'blink': {
      const x0 = p.x, z0 = p.z, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      let d = 0;
      while (d < def.dist) {
        const nx = x0 + fx * (d + 0.5), nz = z0 + fz * (d + 0.5);
        if (solidAt(nx, nz, PLAYER.radius, p.y) || Math.abs(nx) > MAP.halfX - 0.5 || Math.abs(nz) > MAP.halfZ - 0.5) break;
        d += 0.5;
      }
      p.x = x0 + fx * d; p.z = z0 + fz * d;
      send(p.ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
      p.lastState = now();
      broadcast({ t: 'blink', id: p.id, x0, z0, x1: p.x, z1: p.z });
      later(0.12, () => {
        if (!p.alive) return;
        strike(p, { reach: def.after.reach, cos: -2, skill: id, kind: 'skill', dmg: Math.round(c.damage * def.after.dmgMult * mult) });
      });
      break;
    }
    case 'drain': {
      later(def.windup ?? 0.2, () => {
        if (!p.alive || isStunned(p) || isStaggered(p)) return;
        const q = pickTarget(p, def.range, def.maxAngle);
        if (!q) return;
        broadcast({ t: 'beam', kind: 'drain', color: def.color, pts: [[p.x, p.y + 1.3, p.z], [q.x, q.y + 1.2, q.z]] });
        const r = damage(p, q, def.dmg * mult, { kind: 'skill', skill: id, ignoreBlock: true, ax: p.x, az: p.z });
        if (r && !r.parried) heal(p, def.heal, p);
      });
      break;
    }
    case 'chain': {
      later(def.windup ?? 0.2, () => {
        if (!p.alive || isStunned(p) || isStaggered(p)) return;
        let q = pickTarget(p, def.range, def.maxAngle);
        if (!q) return;
        const hit = [], pts = [[p.x, p.y + 1.3, p.z]];
        for (let j = 0; j <= def.jumps && q; j++) {
          hit.push(q.id); pts.push([q.x, q.y + 1.2, q.z]);
          damage(p, q, def.dmgs[Math.min(j, def.dmgs.length - 1)] * mult, { kind: 'skill', skill: id, ignoreBlock: true, ax: p.x, az: p.z });
          if (q.alive && def.stun) status(q, 'stun', def.stun);
          const from = q;
          q = enemiesOf(p).filter((e) => !hit.includes(e.id) && Math.hypot(e.x - from.x, e.z - from.z) < def.jumpRange)
            .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
        }
        broadcast({ t: 'beam', kind: 'chain', color: def.color, pts });
      });
      break;
    }
  }
}

export { push };
