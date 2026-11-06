// 서버 핵심 상태와 공통 도구: 플레이어 목록, 피해/치유/상태이상, 부활
import { CLASSES, SKILLS, PLAYER, MODES } from './classes.js';
import { MAP, resolveMove, lineBlocked } from './map.js';

export const G = {
  players: new Map(),
  nextId: 1,
  mode: 'tdm', // 현재 모드
  phase: 'wait', // wait(대기) → ready(카운트다운) → play → over(결과)
  hooks: { onKill: () => {} },
};

export const now = () => Date.now();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const teamsOn = () => !!MODES[G.mode].teams;
export const live = () => [...G.players.values()];

export function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
export function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const p of G.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}
export function broadcastTeam(team, msg) {
  const s = JSON.stringify(msg);
  for (const p of G.players.values()) if (p.team === team && p.ws.readyState === 1) p.ws.send(s);
}

export function roster() {
  return live().map((p) => ({ id: p.id, name: p.name, cls: p.cls, team: p.team, kills: p.kills, deaths: p.deaths }));
}

// 적/아군 판별 (난전에서는 모두가 적)
export const isEnemy = (a, b) => a !== b && (!teamsOn() || a.team !== b.team);
export const isAlly = (a, b) => a !== b && teamsOn() && a.team === b.team;
export const enemiesOf = (p) => live().filter((q) => q.alive && isEnemy(p, q));
export const alliesOf = (p) => live().filter((q) => q.alive && isAlly(p, q));

// 상태 확인
export const isStunned = (p) => p.stunUntil > now();
export const isStaggered = (p) => p.staggerUntil > now();
export const cantAct = (p) => !p.alive || isStunned(p) || isStaggered(p);
export const buffDmg = (p) => (p.buff.until > now() ? p.buff.dmg : 1);
export const buffSpeed = (p) => (p.buff.until > now() ? p.buff.speed : 1);

export function spawnFor(p) {
  const list = teamsOn() ? (p.team === 0 ? MAP.spawns.red : MAP.spawns.blue) : MAP.spawns.any;
  // 가장 가까운 적이 먼 곳을 고름
  let best = null, bestScore = -1;
  for (let i = 0; i < 6; i++) {
    const [sx, sz] = list[Math.floor(Math.random() * list.length)];
    let nearest = 99;
    for (const q of live()) if (q !== p && q.alive && isEnemy(p, q)) nearest = Math.min(nearest, Math.hypot(q.x - sx, q.z - sz));
    if (nearest > bestScore) { bestScore = nearest; best = [sx, sz]; }
  }
  const [x, z] = best;
  const yaw = Math.atan2(x, z); // 가운데를 바라봄
  return { x, y: 0, z, yaw };
}

export function resetCombat(p) {
  Object.assign(p, {
    blocking: false, blockUntilOk: 0, parryUntil: 0, parryLockUntil: 0, counterUntil: 0, noBlockUntil: 0,
    stunUntil: 0, staggerUntil: 0, rootUntil: 0, slowUntil: 0, slowMult: 1, stunImmuneUntil: 0,
    buff: { until: 0, dmg: 1, speed: 1, steal: 0 }, stealthUntil: 0, stealthNext: null, shield: 0,
    dots: [], dotAcc: 0, dashUntil: 0, cds: {}, trapCount: 0,
  });
}

export function respawn(id) {
  const q = G.players.get(id);
  if (!q) return;
  let changed = false;
  if (q.nextCls && q.nextCls !== q.cls) { q.cls = q.nextCls; changed = true; }
  q.nextCls = null;
  const s = spawnFor(q);
  resetCombat(q);
  Object.assign(q, { x: s.x, y: 0, z: s.z, yaw: s.yaw, pitch: 0, hp: CLASSES[q.cls].hp, alive: true, spawnAt: now(), invulnUntil: now() + PLAYER.spawnInvulnMs });
  q.lastState = now();
  if (changed) broadcast({ t: 'roster', list: roster() });
  broadcast({ t: 'respawn', id: q.id, cls: q.cls, team: q.team, x: s.x, y: 0, z: s.z, yaw: s.yaw, hp: q.hp, inv: PLAYER.spawnInvulnMs });
}

// 밀어내기: 장애물을 넘지 않게 보정하고 당사자에게 새 위치 통보
export function push(q, nx, nz, dist) {
  const p = { x: q.x + nx * dist, z: q.z + nz * dist };
  // 벽을 뚫지 않도록 짧게 쪼개서 이동
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  const cur = { x: q.x, z: q.z };
  for (let i = 0; i < steps; i++) {
    cur.x += (nx * dist) / steps;
    cur.z += (nz * dist) / steps;
    resolveMove(cur, PLAYER.radius, q.y);
  }
  void p;
  q.x = cur.x; q.z = cur.z;
  send(q.ws, { t: 'correct', x: q.x, y: q.y, z: q.z });
}

// 상태이상: kind = stun(기절) | stagger(휘청) | root(속박) | slow(둔화)
export function status(q, kind, ms, extra = {}) {
  const t = now();
  if (kind === 'stun') {
    if (q.stunImmuneUntil > t) return;
    q.stunUntil = Math.max(q.stunUntil, t + ms);
    q.stunImmuneUntil = q.stunUntil + PLAYER.stunImmuneMs;
    q.blocking = false;
  } else if (kind === 'stagger') {
    q.staggerUntil = Math.max(q.staggerUntil, t + ms);
    q.blocking = false;
  } else if (kind === 'root') {
    q.rootUntil = Math.max(q.rootUntil, t + ms);
  } else if (kind === 'slow') {
    const prev = q.slowUntil > t ? q.slowMult : 1; // 아직 남아 있는 둔화 중 더 센 쪽을 따름
    q.slowUntil = Math.max(q.slowUntil, t + ms);
    q.slowMult = Math.min(prev, extra.mult ?? 0.6);
  }
  broadcast({ t: 'status', id: q.id, kind, ms, mult: extra.mult ?? 1 });
}

export function heal(target, amount, by) {
  if (!target.alive || amount <= 0) return 0;
  const max = CLASSES[target.cls].hp;
  const before = target.hp;
  target.hp = Math.min(max, target.hp + amount);
  const got = Math.round(target.hp - before);
  if (got > 0) broadcast({ t: 'heal', id: target.id, by: by?.id ?? target.id, amt: got, hp: target.hp });
  return got;
}

export function addShield(p, amount) {
  p.shield = Math.min(60, (p.shield || 0) + amount);
  broadcast({ t: 'shield', id: p.id, sh: p.shield });
}

export function applyBuff(p, def) {
  const dur = def.dur;
  p.buff = {
    until: now() + dur,
    dmg: def.dmgMult ?? 1,
    speed: def.speedMult ?? 1,
    steal: def.lifesteal ?? 0,
  };
  broadcast({ t: 'buff', id: p.id, ms: dur, dmg: p.buff.dmg, speed: p.buff.speed, steal: p.buff.steal });
}

export function facing(victim, ax, az) {
  const dx = ax - victim.x, dz = az - victim.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return 1;
  return (-Math.sin(victim.yaw) * dx + -Math.cos(victim.yaw) * dz) / d;
}

// 모든 피해는 이 함수를 거칩니다.
// o: { kind: 'melee'|'proj'|'skill'|'dot'|'kick', ignoreBlock, skill, knockDir:[x,z], knock, stun, head, ax, az }
export function damage(attacker, victim, dmg, o = {}) {
  if (!victim.alive || !attacker) return null;
  if (attacker !== victim && !isEnemy(attacker, victim)) return null;
  const t = now();
  if (victim.invulnUntil > t) return null;
  const vc = CLASSES[victim.cls];
  const ax = o.ax ?? attacker.x, az = o.az ?? attacker.z;
  const front = facing(victim, ax, az) > 0.3;
  const blockedState = !o.ignoreBlock && victim.blocking && front && victim.noBlockUntil <= t;

  // 패링: 방어를 올린 직후 근접 공격을 받으면 피해 없이 상대를 휘청이게 하고 반격 기회를 얻음
  if (blockedState && o.kind === 'melee' && victim.parryUntil > t) {
    victim.parryUntil = 0;
    victim.blocking = false;
    if (CLASSES[victim.cls].reach > 0) victim.counterUntil = t + PLAYER.counterMs;
    status(attacker, 'stagger', PLAYER.parryStagger);
    attacker.lastAttack = t; // 공격 쿨다운도 다시 시작
    broadcast({ t: 'parry', id: victim.id, by: attacker.id, counter: victim.counterUntil > t ? PLAYER.counterMs : 0 });
    return { parried: true, dmg: 0 };
  }

  let amount = dmg;
  if (o.head) amount *= 1.5;
  if (blockedState) amount *= 1 - vc.block;
  amount = Math.max(1, Math.round(amount));

  // 보호막이 먼저 흡수
  let absorbed = 0;
  if (victim.shield > 0) {
    absorbed = Math.min(victim.shield, amount);
    victim.shield -= absorbed;
    amount -= absorbed;
    send(victim.ws, { t: 'shield', id: victim.id, sh: victim.shield });
  }
  victim.hp = Math.max(0, victim.hp - amount);
  if (victim.stealthUntil > t && o.kind !== 'dot') { victim.stealthUntil = 0; broadcast({ t: 'stealth', id: victim.id, ms: 0 }); }

  // 생명 흡수(광란)
  if (attacker.buff.until > t && attacker.buff.steal > 0 && o.kind !== 'dot') heal(attacker, Math.round((amount + absorbed) * attacker.buff.steal), attacker);

  broadcast({
    t: 'hit', id: victim.id, by: attacker.id, dmg: amount + absorbed, hp: victim.hp, blocked: blockedState,
    skill: o.skill || null, head: !!o.head, dot: o.kind === 'dot', counter: !!o.counter,
  });

  if (victim.hp > 0) {
    if (o.knock) {
      const dx = victim.x - ax, dz = victim.z - az, d = Math.hypot(dx, dz) || 1;
      push(victim, dx / d, dz / d, o.knock * (blockedState ? 0.4 : 1));
    }
    if (o.stun && !blockedState) status(victim, 'stun', o.stun);
    if (o.guardBreak && victim.blocking) {
      victim.blocking = false;
      victim.noBlockUntil = t + o.guardBreak;
      status(victim, 'stagger', Math.min(o.guardBreak, 500));
    }
  } else {
    die(attacker, victim);
  }
  return { dmg: amount, blocked: blockedState };
}

export function die(killer, victim) {
  victim.alive = false;
  victim.blocking = false;
  victim.deaths++;
  if (killer !== victim) killer.kills++;
  resetCombat(victim);
  broadcast({ t: 'kill', killer: killer.id, victim: victim.id });
  broadcast({ t: 'roster', list: roster() });
  G.hooks.onKill(killer, victim);
  setTimeout(() => respawn(victim.id), PLAYER.respawnMs);
}

// 독/저주 같은 지속 피해 (매 틱 호출)
export function tickDots(dt) {
  const t = now();
  for (const p of live()) {
    if (!p.alive || !p.dots.length) continue;
    p.dots = p.dots.filter((d) => d.until > t);
    let dps = 0, owner = null;
    for (const d of p.dots) { dps += d.dps; owner = G.players.get(d.by) || owner; }
    if (!owner) continue;
    p.dotAcc += dps * dt;
    if (p.dotAcc >= 1) {
      const n = Math.floor(p.dotAcc);
      p.dotAcc -= n;
      damage(owner, p, n, { kind: 'dot', ignoreBlock: true });
    }
  }
}

export function addDot(victim, by, def) {
  const t = now();
  victim.dots = victim.dots.filter((d) => !(d.kind === def.kind && d.by === by.id));
  victim.dots.push({ kind: def.kind, dps: def.dps, until: t + def.ms, by: by.id });
  broadcast({ t: 'status', id: victim.id, kind: def.kind, ms: def.ms, mult: 1 });
}

export { SKILLS, lineBlocked };
