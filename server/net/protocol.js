// 프로토콜 정의: 메시지 타입, 오류 코드(+한글 문구), 옵션 스키마, 입력 검증.
// 상세 명세는 docs/PROTOCOL.md. 화면 문구는 docs/SPEC_ADDENDUM_KO.md 8절 용어집 기준.

export const PROTOCOL_VERSION = 1;

export const NICK_RE = /^[가-힣a-zA-Z0-9]{2,12}$/;
export const RESERVED_NICK_RE = /^컴퓨터\d*$/; // 컴퓨터 자동 이름과 충돌 방지
export const TITLE_MAX = 30;
export const CHAT_MAX = 120;
export const MAX_PLAYERS_MIN = 2;
export const MAX_PLAYERS_MAX = 10;

export const TANK_TYPES = ['classic', 'fixed', 'heavy', 'scout', 'triple', 'wedge', 'wheeled'];
export const HUMAN_TANK_TYPES = TANK_TYPES.filter((t) => t !== 'triple'); // 트리플 터렛은 컴퓨터 전용(A7)
export const PERSONALITIES = ['moron', 'shooter', 'poolshark', 'tosser', 'chooser', 'spoiler', 'cyborg', 'unknown'];
export const PERSONALITY_KO = {
  moron: '모론', shooter: '슈터', poolshark: '풀샤크', tosser: '토서',
  chooser: '추저', spoiler: '스포일러', cyborg: '사이보그', unknown: '언노운',
};
export const TEAM_MIN = 1;
export const TEAM_MAX = 5;

// 오류 코드 → 한글 문구(토스트용). 클라이언트는 code로 자체 문구를 덮어써도 된다.
export const ERRORS = {
  BAD_MESSAGE: '잘못된 요청입니다',
  UNKNOWN_TYPE: '알 수 없는 요청입니다',
  RATE_LIMITED: '요청이 너무 빠릅니다',
  NOT_LOGGED_IN: '먼저 닉네임을 입력하세요',
  ALREADY_LOGGED_IN: '이미 접속한 상태입니다',
  NICK_INVALID: '닉네임은 2~12자의 한글·영문·숫자만 쓸 수 있습니다',
  NICK_TAKEN: '이미 사용 중인 닉네임입니다',
  SESSION_REPLACED: '다른 곳에서 접속하여 연결이 종료됩니다',
  NOT_IN_ROOM: '방에 들어가 있지 않습니다',
  ALREADY_IN_ROOM: '이미 방에 들어가 있습니다',
  ROOM_NOT_FOUND: '방을 찾을 수 없습니다',
  ROOM_FULL: '방이 가득 찼습니다',
  ROOM_IN_GAME: '게임이 진행 중인 방입니다',
  ROOM_KICKED: '강퇴되어 이 방에 다시 들어갈 수 없습니다',
  PASSWORD_UNSUPPORTED: '비밀번호방은 아직 지원하지 않습니다',
  TITLE_INVALID: '방 제목은 1~30자로 입력하세요',
  MAX_PLAYERS_INVALID: '최대 인원은 2~10명입니다',
  MAX_PLAYERS_TOO_SMALL: '현재 참가자 수보다 작게 줄일 수 없습니다',
  OPTION_INVALID: '방 설정 값이 올바르지 않습니다',
  NOT_HOST: '방장만 할 수 있습니다',
  IN_GAME: '게임 중에는 할 수 없습니다',
  NOT_IN_GAME: '게임 중이 아닙니다',
  HOST_NO_READY: '방장은 준비할 필요가 없습니다',
  TARGET_NOT_FOUND: '대상을 찾을 수 없습니다',
  CANNOT_KICK_SELF: '자신을 강퇴할 수 없습니다',
  TANK_INVALID: '선택할 수 없는 탱크 모양입니다',
  TEAM_INVALID: '팀 번호가 올바르지 않습니다',
  PERSONALITY_INVALID: '컴퓨터 성향이 올바르지 않습니다',
  START_NEED_PLAYERS: '2명 이상이어야 시작할 수 있습니다',
  START_NOT_READY: '준비하지 않은 참가자가 있습니다',
  START_TEAMS: '팀이 둘 이상이어야 시작할 수 있습니다',
  CHAT_EMPTY: '메시지를 입력하세요',
  CHAT_TOO_LONG: '메시지는 120자까지 입력할 수 있습니다',
  CHAT_RATE: '메시지를 너무 빨리 보내고 있습니다',
  // 게임 중
  NOT_YOUR_TURN: '당신의 턴이 아닙니다',
  TURN_EXPIRED: '제한시간이 지났습니다',
  WRONG_PHASE: '지금은 할 수 없는 행동입니다',
  INVALID_INPUT: '입력 값이 올바르지 않습니다',
  ALREADY_READY: '이미 발사를 준비했습니다',
  NOT_YOUR_SHOP: '지금은 당신의 상점 차례가 아닙니다',
  SHOP_EXPIRED: '상점 제한시간이 지났습니다',
  ENGINE_REJECT: '요청을 처리할 수 없습니다',
  ENGINE_UNSUPPORTED: '지원하지 않는 기능입니다',
  INTERNAL: '서버 오류가 발생했습니다',
};

export class ProtocolError extends Error {
  constructor(code, params = {}, msg) {
    super(msg || ERRORS[code] || code);
    this.code = code;
    this.params = params;
  }
}

export function errorMsg(code, ref, params, msg) {
  const m = { t: 'error', code, msg: msg || ERRORS[code] || code };
  if (ref !== undefined) m.ref = ref;
  if (params && Object.keys(params).length) m.params = params;
  return m;
}

// ---- 옵션 스키마 (SPEC 1.12 / 5.5). 키는 camelCase, 열거값은 원문 대문자 코드. ----
const E = (def, values) => ({ type: 'enum', def, values });
const I = (def, min, max) => ({ type: 'int', def, min, max });
const N = (def, min, max) => ({ type: 'num', def, min, max });
const B = (def) => ({ type: 'bool', def });

export const OPTION_SCHEMA = {
  mode: E('SEQUENTIAL', ['SEQUENTIAL', 'SYNCHRONOUS', 'SIMULTANEOUS']),
  teams: E('NONE', ['NONE', 'STANDARD', 'CORPORATE', 'VICIOUS']),
  rounds: I(10, 1, 1000),
  turnLimitSec: E(60, [30, 45, 60, 90]),
  shopLimitSec: E(90, [60, 90, 120]),
  interestRate: N(0.05, 0, 0.3),
  cashAtStart: I(0, 0, 1000000),
  computersBuy: B(true),
  freeMarket: B(false),
  scoringMode: E('STANDARD', ['BASIC', 'STANDARD', 'GREEDY']),
  airViscosity: N(0, 0, 20),
  gravity: N(0.2, 0.05, 10),
  suspendDirt: I(0, 0, 100),
  tanksFall: B(true),
  bordersExtend: I(75, 0, 10000),
  wallEffect: E('NONE', ['NONE', 'CONCRETE', 'PADDED', 'RUBBER', 'SPRING', 'WRAP', 'RANDOM', 'ERRATIC']),
  sky: E('RANDOM', ['PLAIN', 'STORMY', 'STARS', 'SHADED', 'SUNSET', 'CAVERN', 'BLACK', 'RANDOM']),
  maxWind: I(200, 0, 500),
  changingWind: B(false),
  hostileEnvironment: B(true),
  bumpiness: I(20, 0, 100),
  slope: I(20, 0, 100),
  flattenPeaks: B(false),
  randomLand: B(false),
  scannedMountains: I(20, 0, 100),
  statusBar: B(false),
  playOrder: E('RANDOM', ['RANDOM', 'LOSERS_FIRST', 'WINNERS_FIRST', 'ROUND_ROBIN']),
  fastComputers: B(false),
  talkingTanks: E('OFF', ['OFF', 'COMPUTERS', 'ALL']),
  talkProbability: I(100, 0, 100),
  armsLevel: I(4, 0, 4),
  bombIcon: E('BIG', ['INVISIBLE', 'SMALL', 'BIG']),
  tunneling: B(true),
  scale: E('NORMAL', ['NORMAL', 'MEDIUM', 'LARGE']),
  tracePaths: B(false),
  extraDirt: B(false),
  uselessItems: B(false),
  impactDamage: B(true),
};

export function defaultOptions() {
  const o = {};
  for (const [k, s] of Object.entries(OPTION_SCHEMA)) o[k] = s.def;
  return o;
}

// 부분 옵션을 검증해 기존 옵션과 병합한 새 객체를 반환. 알 수 없는 키/값은 거절.
export function mergeOptions(current, patch) {
  if (patch === undefined || patch === null) return { ...current };
  if (typeof patch !== 'object' || Array.isArray(patch)) throw new ProtocolError('OPTION_INVALID');
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    const s = OPTION_SCHEMA[k];
    if (!s) throw new ProtocolError('OPTION_INVALID', { key: k });
    let ok = false;
    if (s.type === 'enum') ok = s.values.includes(v);
    else if (s.type === 'bool') ok = typeof v === 'boolean';
    else if (s.type === 'int') ok = Number.isInteger(v) && v >= s.min && v <= s.max;
    else if (s.type === 'num') ok = typeof v === 'number' && Number.isFinite(v) && v >= s.min && v <= s.max;
    if (!ok) throw new ProtocolError('OPTION_INVALID', { key: k });
    out[k] = v;
  }
  return out;
}

export function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseMessage(raw) {
  let obj = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try { obj = JSON.parse(raw.toString()); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.t !== 'string') return null;
  return obj;
}
