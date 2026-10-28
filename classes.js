// 서버와 클라이언트가 함께 쓰는 설정 파일입니다.
// 기사(클래스)를 추가하거나 능력치를 바꾸려면 여기만 고치면 됩니다.

export const ARENA = {
  half: 40, // 경기장 한 변의 절반 (80 x 80)
  pillars: [
    { x: -12, z: -12, r: 1.6 },
    { x: 12, z: -12, r: 1.6 },
    { x: -12, z: 12, r: 1.6 },
    { x: 12, z: 12, r: 1.6 },
    { x: 0, z: 0, r: 2.2 },
    { x: -24, z: 0, r: 1.4 },
    { x: 24, z: 0, r: 1.4 },
    { x: 0, z: -24, r: 1.4 },
    { x: 0, z: 24, r: 1.4 },
  ],
};

export const PLAYER = {
  radius: 0.5,
  eye: 1.7,
  gravity: 22,
  jump: 7.5,
  respawnMs: 3000,
  maxNameLen: 16,
};

// hp: 체력 / speed: 이동속도(m/s) / damage: 공격력 / cooldown: 공격 간격(초)
// reach: 사거리(m) / windup: 휘두르고 타격이 들어가기까지(초) / block: 방어 시 피해 감소율(0~1)
export const CLASSES = {
  knight: {
    id: 'knight',
    name: '기사',
    desc: '균형 잡힌 롱소드 기사',
    hp: 100, speed: 5.2, damage: 22, cooldown: 0.7, reach: 2.6, windup: 0.18, block: 0.6,
    color: 0x4a6fa5,
  },
  greatsword: {
    id: 'greatsword',
    name: '대검 전사',
    desc: '느리지만 한 방이 묵직하다',
    hp: 120, speed: 4.2, damage: 40, cooldown: 1.2, reach: 3.2, windup: 0.35, block: 0.4,
    color: 0x8b2f2f,
  },
  duelist: {
    id: 'duelist',
    name: '결투가',
    desc: '빠른 발과 연속 찌르기',
    hp: 80, speed: 6.4, damage: 13, cooldown: 0.38, reach: 2.3, windup: 0.1, block: 0.35,
    color: 0x3f8f5a,
  },
  shield: {
    id: 'shield',
    name: '방패 기사',
    desc: '단단한 방어, 느린 움직임',
    hp: 150, speed: 3.8, damage: 17, cooldown: 0.85, reach: 2.3, windup: 0.2, block: 0.85,
    color: 0xb08d2a,
  },
};
