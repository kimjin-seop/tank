// 방 옵션 스키마 (SPEC 1.12 기본값, 8.5 용어). key는 서버 옵션 키(가정, PROTOCOL.md 확정 시 맞춤)
import * as T from './i18n.js';

const enumOf = (map, keys) => (keys || Object.keys(map)).map(k => ({ v: k, label: map[k] }));
const onoff = [{ v: true, label: '켬' }, { v: false, label: '끔' }];

export const OPTION_TABS = [
  {
    id: 'economy', label: '경제', items: [
      { key: 'interestRate', label: '이자율', type: 'range', min: 0, max: 0.3, step: 0.01, def: 0.05, fmt: v => (v * 100).toFixed(0) + '%' },
      { key: 'cashAtStart', label: '시작 자금', type: 'number', min: 0, max: 1000000, step: 1000, def: 0, presets: [0, 10000, 100000, 1000000], fmt: v => '$' + Number(v).toLocaleString('en-US') },
      { key: 'computersBuy', label: '컴퓨터 구매', type: 'switch', def: true },
      { key: 'freeMarket', label: '자유 시장', type: 'switch', def: false },
      { key: 'scoringMode', label: '점수 방식', type: 'segment', choices: enumOf(T.SCORING), def: 'STANDARD' },
    ],
  },
  {
    id: 'physics', label: '물리', items: [
      { key: 'airViscosity', label: '공기 점성', type: 'range', min: 0, max: 20, step: 1, def: 0 },
      { key: 'gravity', label: '중력', type: 'range', min: 0.05, max: 10, step: 0.05, def: 0.2, fmt: v => Number(v).toFixed(2) },
      { key: 'suspendDirt', label: '흙 공중 부유', type: 'range', min: 0, max: 100, step: 1, def: 0, fmt: v => v + '%', hint: '0보다 크면 파인 지형 위 흙이 무너지지 않고 떠 있을 수 있습니다' },
      { key: 'tanksFall', label: '탱크 낙하', type: 'switch', def: true },
      { key: 'bordersExtend', label: '경계 확장', type: 'range', min: 0, max: 10000, step: 25, def: 75 },
      { key: 'wallEffect', label: '벽 효과', type: 'walls', choices: enumOf(T.WALLS), def: 'NONE' },
      { key: 'impactDamage', label: '착지 시 피해', type: 'switch', def: true, advanced: true },
    ],
  },
  {
    id: 'landscape', label: '지형·환경', items: [
      { key: 'sky', label: '하늘', type: 'sky', choices: enumOf(T.SKY), def: 'RANDOM' },
      { key: 'maxWind', label: '최대 풍속', type: 'range', min: 0, max: 500, step: 5, def: 200 },
      { key: 'changingWind', label: '바람 변화', type: 'switch', def: false },
      { key: 'hostileEnvironment', label: '위험 환경', type: 'switch', def: true },
      { key: 'bumpiness', label: '울퉁불퉁함', type: 'range', min: 0, max: 100, step: 1, def: 20 },
      { key: 'slope', label: '경사', type: 'range', min: 0, max: 100, step: 1, def: 20 },
      { key: 'flattenPeaks', label: '봉우리 평탄화', type: 'switch', def: false },
      { key: 'randomLand', label: '지형 무작위', type: 'switch', def: false },
      { key: 'scannedMountains', label: '스캔 산 비율', type: 'range', min: 0, max: 100, step: 1, def: 20, fmt: v => v + '%' },
    ],
  },
  {
    id: 'play', label: '플레이', items: [
      { key: 'mode', label: '진행 방식', type: 'segment', choices: enumOf(T.MODE), def: 'SEQUENTIAL' },
      { key: 'teams', label: '팀', type: 'segment', choices: enumOf(T.TEAMS), def: 'NONE' },
      { key: 'turnLimitSec', label: '턴 제한시간', type: 'segment', choices: [30, 45, 60, 90].map(v => ({ v, label: v + '초' })), def: 60 },
      { key: 'shopLimitSec', label: '상점 제한시간', type: 'segment', choices: [60, 90, 120].map(v => ({ v, label: v + '초' })), def: 90 },
      { key: 'playOrder', label: '발사 순서', type: 'select', choices: enumOf(T.PLAY_ORDER), def: 'RANDOM' },
      { key: 'statusBar', label: '상태바', type: 'switch', def: false },
      { key: 'fastComputers', label: '컴퓨터 빠른 진행', type: 'switch', def: false },
      { key: 'talkingTanks', label: '말하는 탱크', type: 'segment', choices: enumOf(T.TALKING), def: 'OFF' },
      { key: 'talkProbability', label: '말할 확률', type: 'range', min: 0, max: 100, step: 1, def: 100, fmt: v => v + '%' },
    ],
  },
  {
    id: 'weapons', label: '무기', items: [
      { key: 'armsLevel', label: '무장 등급', type: 'range', min: 0, max: 4, step: 1, def: 4 },
      { key: 'bombIcon', label: '탄 아이콘', type: 'segment', choices: enumOf(T.BOMB_ICON), def: 'BIG' },
      { key: 'tunneling', label: '터널링', type: 'switch', def: true },
      { key: 'scale', label: '스케일', type: 'segment', choices: enumOf(T.SCALE), def: 'NORMAL' },
      { key: 'tracePaths', label: '궤적 표시', type: 'switch', def: false },
      { key: 'extraDirt', label: '추가 흙', type: 'switch', def: false },
      { key: 'uselessItems', label: '쓸모없는 아이템 표시', type: 'switch', def: false },
    ],
  },
];

export const BASE_FIELDS = { maxPlayers: { min: 2, max: 10, def: 4 }, rounds: { min: 1, max: 1000, def: 10, presets: [5, 10, 20, 50] } };

export function defaultOptions() {
  const o = { rounds: BASE_FIELDS.rounds.def };
  for (const tab of OPTION_TABS) for (const it of tab.items) o[it.key] = it.def;
  return o;
}
export function tabDefaults(tabId) {
  const o = {};
  for (const it of OPTION_TABS.find(t => t.id === tabId).items) o[it.key] = it.def;
  return o;
}
export function findItem(key) {
  for (const tab of OPTION_TABS) for (const it of tab.items) if (it.key === key) return it;
  return null;
}
export function fmtValue(it, v) {
  if (it.choices) return (it.choices.find(c => c.v === v) || {}).label ?? String(v);
  if (it.type === 'switch') return v ? '켬' : '끔';
  return it.fmt ? it.fmt(v) : String(v);
}
export { onoff };
