// 말하는 탱크: 샷 이벤트 스트림에 {t:'talk', tick, tank, text} 를 삽입한다.
// 대사는 data/talk_ko.json(원본 TALK1/TALK2 한국어 의역). 빈 줄=침묵, 중복 줄=가중치(균등 추첨이라 자연히 가중됨).
// 난수는 엔진 시드와 별개인 서버측 결정론 RNG(mulberry32, 게임 시드에서 파생)를 쓴다 -> 엔진 결과에 영향 없음.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let cache = null;

export function loadTalk(file = path.join(here, '..', '..', 'data', 'talk_ko.json')) {
  if (cache && file === cache.file) return cache.data;
  let data = { attack: [], death: [] };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { attack: Array.isArray(j.attack) ? j.attack.map(String) : [], death: Array.isArray(j.death) ? j.death.map(String) : [] };
  } catch { /* 대사 파일이 없으면 말하는 탱크는 조용히 꺼진다 */ }
  cache = { file, data };
  return data;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * createTalker({mode:'OFF'|'COMPUTERS'|'ALL', probability:0..100, seed, isComputer(id)->bool, lines?})
 * -> insert(events) : 새 배열 반환. fire 이벤트 뒤에 공격 대사, death 이벤트(후퇴 제외) 뒤에 사망 대사.
 */
export function createTalker({ mode, probability, seed, isComputer, lines = loadTalk() }) {
  if (mode !== 'COMPUTERS' && mode !== 'ALL') return { insert: (ev) => ev };
  const rng = mulberry32(seed);
  const pct = Number.isFinite(probability) ? probability : 100;
  const can = (id) => mode === 'ALL' || isComputer(id);
  const say = (list, tank, tick) => {
    if (!list.length || !can(tank)) return null;
    if (rng() * 100 >= pct) return null;
    const text = list[Math.floor(rng() * list.length)];
    return text && text.trim() ? { t: 'talk', tick, tank, text } : null; // 빈 줄 = 침묵
  };
  return {
    insert(events) {
      const out = [];
      for (const e of events || []) {
        out.push(e);
        if (!e) continue;
        let talk = null;
        if (e.t === 'fire' && e.pid != null) talk = say(lines.attack, e.pid, e.tick ?? 0);
        else if (e.t === 'death' && !e.retreat && e.tank != null) talk = say(lines.death, e.tank, e.tick ?? 0);
        if (talk) out.push(talk);
      }
      return out;
    },
  };
}
