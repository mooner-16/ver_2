// 서버 통합 테스트: 명중 / 사거리 밖 / 방어 / 처치 / 부활
process.env.PORT = '3111';
process.env.NO_MOVE_CHECK = '1'; // 테스트에서는 순간이동 허용
await import('./server.js');
const { default: WebSocket } = await import('ws');
import { CLASSES } from './classes.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(log, pred, ms = 2000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const m = log.find(pred);
    if (m) return m;
    await sleep(20);
  }
  throw new Error('timeout');
}
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('ok  ', msg);
}

async function open(cls, name) {
  const ws = new WebSocket('ws://localhost:3111');
  const log = [];
  ws.on('message', (d) => log.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'join', cls, name }));
  const w = await waitFor(log, (m) => m.t === 'welcome');
  const place = (x, z, yaw, b = false) => ws.send(JSON.stringify({ t: 'state', x, y: 0, z, yaw, pitch: 0, b }));
  return { ws, log, id: w.id, place, attack: () => ws.send(JSON.stringify({ t: 'attack' })) };
}

const A = await open('duelist', 'Alice');
const B = await open('knight', 'Bob');
const dmgA = CLASSES.duelist.damage;

// 1) 정면 2m 명중
A.place(0, 0, 0);               // 앞쪽 = -z
B.place(0, -2, Math.PI);
await sleep(120);
B.log.length = 0;
A.attack();
let hit = await waitFor(B.log, (m) => m.t === 'hit' && m.id === B.id);
assert(hit.dmg === dmgA && hit.hp === 100 - dmgA && !hit.blocked, `정면 명중 (피해 ${hit.dmg}, 남은 체력 ${hit.hp})`);

// 2) 사거리 밖
B.place(0, -6, Math.PI);
await sleep(500);
B.log.length = 0;
A.attack();
await sleep(400);
assert(!B.log.some((m) => m.t === 'hit'), '사거리 밖에서는 명중하지 않음');

// 3) 뒤돌아 있을 때 (공격자가 반대 방향)
B.place(0, -2, Math.PI);
A.place(0, 0, Math.PI); // 반대쪽을 봄
await sleep(500);
B.log.length = 0;
A.attack();
await sleep(400);
assert(!B.log.some((m) => m.t === 'hit'), '공격 방향 밖에서는 명중하지 않음');

// 4) 방어
A.place(0, 0, 0);
B.place(0, -2, Math.PI, true);
await sleep(500);
B.log.length = 0;
A.attack();
hit = await waitFor(B.log, (m) => m.t === 'hit' && m.id === B.id);
const expect = Math.max(1, Math.round(dmgA * (1 - CLASSES.knight.block)));
assert(hit.blocked && hit.dmg === expect, `방어 시 피해 감소 (${dmgA} → ${hit.dmg})`);

// 5) 쿨다운: 즉시 재공격은 무시
B.place(0, -2, Math.PI, false);
await sleep(500);
B.log.length = 0;
A.attack(); A.attack(); A.attack();
await sleep(300);
assert(B.log.filter((m) => m.t === 'hit' && m.id === B.id).length === 1, '쿨다운 중 연타는 1회만 인정');

// 6) 처치와 부활
B.log.length = 0;
let kill;
for (let i = 0; i < 20 && !kill; i++) {
  await sleep(430);
  A.attack();
  kill = B.log.find((m) => m.t === 'kill');
}
assert(kill && kill.killer === A.id && kill.victim === B.id, '처치 이벤트 발생');
const rs = await waitFor(B.log, (m) => m.t === 'respawn' && m.id === B.id, 4000);
assert(rs.hp === CLASSES.knight.hp, `부활 후 체력 ${rs.hp}`);
const ro = [...B.log].reverse().find((m) => m.t === 'roster');
assert(ro.list.find((p) => p.id === A.id).kills === 1, '점수판 처치 수 반영');

console.log('\n모든 테스트 통과');
process.exit(0);
