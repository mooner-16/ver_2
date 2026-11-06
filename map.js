// 중세 마을 맵 (서버와 클라이언트가 같이 씁니다)
// 좌표: x 오른쪽, z 아래쪽(남쪽). 가운데가 (0,0). 크기 78 x 72 m.
// box: {x,z,w,d,h,kind,rot?}  circle: {x,z,r,h,kind}
// h(높이)가 낮은 물건(울타리·물·건초)은 점프로 넘을 수 있고, 화살은 높이 1.2 이상만 막힙니다.

export const MAP = {
  halfX: 39,
  halfZ: 36,
  boxes: [],
  circles: [],
  bridges: [],
  spawns: { red: [], blue: [], any: [] },
  hills: [[0, 6], [-25, 18], [25, 4]],
};

const B = (x, z, w, d, h, kind, extra = {}) => MAP.boxes.push({ x, z, w, d, h, kind, ...extra });
const C = (x, z, r, h, kind) => MAP.circles.push({ x, z, r, h, kind });

// ── 강 (북쪽 진영과 남쪽 진영을 가름, 다리 3개) ──
const RIVER_Z = -13, RIVER_D = 4;
MAP.river = { z: RIVER_Z, d: RIVER_D };
MAP.bridges = [{ x: -24, w: 5 }, { x: 0, w: 6 }, { x: 25, w: 5 }];
{
  let x0 = -MAP.halfX;
  const gaps = MAP.bridges.map((b) => [b.x - b.w / 2, b.x + b.w / 2]).sort((a, b) => a[0] - b[0]);
  for (const [g0, g1] of [...gaps, [MAP.halfX, MAP.halfX]]) {
    if (g0 > x0) B((x0 + g0) / 2, RIVER_Z, g0 - x0, RIVER_D, 0.6, 'water');
    x0 = g1;
  }
}

// ── 건물 ──
// 북쪽(붉은 진영)
B(-28, -26, 9, 6, 5, 'house', { roof: 0x8a4a32 });
B(-17, -28, 6, 6, 4.6, 'house', { roof: 0x6a4a3a });
B(-6, -24, 5, 5, 4.2, 'house', { roof: 0x7a5a3a });
B(15, -27, 6, 6, 4.8, 'house', { roof: 0x8a4a32 });
B(28, -25, 13, 8, 5.4, 'tavern', { roof: 0x5a3a2a });
// 남쪽(푸른 진영)
B(-27, 22, 8, 14, 6, 'church', { roof: 0x4a4a52 });
C(-27, 12.5, 2.2, 11, 'tower');
B(-12, 27, 7, 6, 4.6, 'house', { roof: 0x6a4a3a });
B(-3, 26, 5, 5, 4.2, 'house', { roof: 0x8a4a32 });
B(26, 24, 8, 8, 5, 'house', { roof: 0x7a5a3a });
B(14, 28, 6, 5, 4.2, 'smithy', { roof: 0x4a4a4a });
B(10, 15, 5, 5, 4.2, 'house', { roof: 0x8a4a32 });
B(-14, 12, 5, 5, 4.2, 'house', { roof: 0x6a4a3a });

// ── 광장 (우물 + 시장 노점) ──
C(0, 6, 1.6, 1.2, 'well');
B(-6.5, 3, 2.6, 1.6, 2.2, 'stall', { awning: 0xc84a4a });
B(6.5, 3, 2.6, 1.6, 2.2, 'stall', { awning: 0x4a7fe0 });
B(-6.5, 10, 2.6, 1.6, 2.2, 'stall', { awning: 0xe0c04a });
B(6.5, 10, 2.6, 1.6, 2.2, 'stall', { awning: 0x4ac07a });
B(0, 11.5, 1.2, 1.2, 1.1, 'crate');
B(-2.4, 1.2, 1.1, 1.1, 1.1, 'crate');

// ── 소품: 수레, 건초, 통 ──
B(-9, 18, 2.8, 1.4, 1.1, 'cart', { rot: 0.3 });
B(17, 8, 2.8, 1.4, 1.1, 'cart', { rot: -0.4 });
B(-20, -19, 2.8, 1.4, 1.1, 'cart', { rot: 0.1 });
for (const [x, z] of [[-33, 6], [-31.5, 7], [32, 16], [33.4, 15], [-8, -19], [22, -19.5], [-34, -6]]) B(x, z, 1.4, 1.4, 1.2, 'hay');
for (const [x, z] of [[4, -19], [-12, -19.5], [30, 9], [-30, 30], [8, 33], [-18, 8], [20, 20], [-5, -32], [12, -33]]) C(x, z, 0.5, 1.0, 'barrel');

// ── 나무 ──
for (const [x, z] of [[-35, -20], [-34, 27], [35, 31], [35, -8], [-23, -8], [20, 35], [-8, 34], [8, -35], [33, 4], [-36, 14], [36, 22], [-2, -31]]) C(x, z, 0.7, 6, 'tree');

// ── 울타리 (낮아서 점프로 넘을 수 있음) ──
const fenceRun = (x0, z0, x1, z1) => {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  B((x0 + x1) / 2, (z0 + z1) / 2, horizontal ? len : 0.25, horizontal ? 0.25 : len, 1.1, 'fence');
};
fenceRun(-39, -3, -30, -3);
fenceRun(-30, -3, -30, 3);
fenceRun(30, -4, 39, -4);
fenceRun(30, -4, 30, 1);
fenceRun(-16, 17, -10, 17);
fenceRun(18, 12, 18, 18);
fenceRun(-38, 32, -30, 32);
fenceRun(2, 31, 8, 31);

// ── 스폰 위치 ──
for (let x = -30; x <= 30; x += 6) MAP.spawns.red.push([x + 1, -33]);
for (let x = -30; x <= 30; x += 6) MAP.spawns.blue.push([x - 1, 33]);
MAP.spawns.any = [...MAP.spawns.red, ...MAP.spawns.blue, [-16, 2], [16, -8], [-6, 20], [6, 20], [0, -6]];

// ── 충돌 유틸 ──
// 점 (x,z)에 반경 r인 원이 높이 y에서 장애물과 겹치는지
export function solidAt(x, z, r, y = 0) {
  for (const b of MAP.boxes) {
    if (y > b.h - 0.3) continue;
    if (b.rot) {
      const dx = x - b.x, dz = z - b.z, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.w / 2 + r && Math.abs(lz) < b.d / 2 + r) return true;
    } else if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true;
  }
  for (const c of MAP.circles) {
    if (y > c.h - 0.3) continue;
    if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
  }
  return false;
}

// 이동 후 위치를 장애물 밖으로 밀어냄 (자기 높이 y 기준)
export function resolveMove(p, r, y = 0) {
  for (const b of MAP.boxes) {
    if (y > b.h - 0.3) continue;
    let dx = p.x - b.x, dz = p.z - b.z, c = 1, s = 0;
    if (b.rot) { c = Math.cos(-b.rot); s = Math.sin(-b.rot); const lx = dx * c - dz * s, lz = dx * s + dz * c; dx = lx; dz = lz; }
    const hx = b.w / 2 + r, hz = b.d / 2 + r;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      if (px < pz) dx = Math.sign(dx || 1) * hx; else dz = Math.sign(dz || 1) * hz;
      if (b.rot) { const c2 = Math.cos(b.rot), s2 = Math.sin(b.rot); p.x = b.x + dx * c2 - dz * s2; p.z = b.z + dx * s2 + dz * c2; }
      else { p.x = b.x + dx; p.z = b.z + dz; }
    }
  }
  for (const c of MAP.circles) {
    if (y > c.h - 0.3) continue;
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
    if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
  }
  p.x = Math.max(-MAP.halfX + r, Math.min(MAP.halfX - r, p.x));
  p.z = Math.max(-MAP.halfZ + r, Math.min(MAP.halfZ - r, p.z));
}

// 투사체(점)가 높이 y에서 단단한 물체에 부딪히는지 (낮은 울타리·물은 통과)
export function blocksShot(x, y, z) {
  if (y < 0) return true;
  for (const b of MAP.boxes) {
    if (b.h < 1.2 || y > b.h) continue;
    if (b.rot) {
      const dx = x - b.x, dz = z - b.z, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      if (Math.abs(dx * c - dz * s) < b.w / 2 && Math.abs(dx * s + dz * c) < b.d / 2) return true;
    } else if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return true;
  }
  for (const c of MAP.circles) {
    if (c.h < 1.2 || y > c.h) continue;
    if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
  }
  return Math.abs(x) > MAP.halfX || Math.abs(z) > MAP.halfZ;
}

// 두 점 사이가 건물 등으로 막혔는지 (근접·즉발 스킬이 벽 너머로 안 맞게)
export function lineBlocked(x0, z0, x1, z1, y = 1.2) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blocksShot(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t)) return true;
  }
  return false;
}
