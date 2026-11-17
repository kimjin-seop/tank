// 화면 문구: SPEC_ADDENDUM_KO 8절 용어집 기준. 코드에서는 원문 ID(영문)를 키로 쓴다.

export const MODE = { SEQUENTIAL: '순차', SYNCHRONOUS: '동기', SIMULTANEOUS: '동시' };
export const ROOM_STATE = { waiting: '대기중', playing: '게임중' };

export const PERSONALITY = {
  moron: '모론', shooter: '슈터', poolshark: '풀샤크', tosser: '토서',
  chooser: '추저', spoiler: '스포일러', cyborg: '사이보그', unknown: '언노운',
};
export const PERSONALITY_ORDER = Object.keys(PERSONALITY);

export const TEAMS = { NONE: '없음', STANDARD: '스탠더드', CORPORATE: '코퍼레이트', VICIOUS: '바이셔스' };
export const TEAMS_HINT = { CORPORATE: '팀 공동 계좌', VICIOUS: '마지막 한 팀 남으면 개인전' };

export const SKY = {
  PLAIN: '맑음', STORMY: '폭풍', STARS: '별밤', SHADED: '그라데이션',
  SUNSET: '노을', CAVERN: '동굴', BLACK: '칠흑', RANDOM: '무작위',
};
export const WALLS = {
  NONE: '없음', CONCRETE: '콘크리트', PADDED: '패디드', RUBBER: '러버',
  SPRING: '스프링', WRAP: '랩어라운드', RANDOM: '무작위', ERRATIC: '에러틱',
};
export const WALLS_HINT = { CONCRETE: '막힘', PADDED: '일부 흡수', RUBBER: '반사', SPRING: '튕김', WRAP: '좌우 이어짐', ERRATIC: '샷마다 변경' };

export const SCORING = { BASIC: '기본', STANDARD: '표준', GREEDY: '탐욕' };
export const PLAY_ORDER = { RANDOM: '무작위', LOSERS_FIRST: '꼴찌 먼저', WINNERS_FIRST: '1등 먼저', ROUND_ROBIN: '라운드 로빈' };
export const TALKING = { OFF: '끔', COMPUTERS: '컴퓨터만', ALL: '모두' };
export const BOMB_ICON = { INVISIBLE: '안 보임', SMALL: '작게', BIG: '크게' };
export const SCALE = { NORMAL: '보통', MEDIUM: '중간', LARGE: '대형' };

export const GUIDANCE = { none: '없음', heat_guidance: 'Ht', ballistic_guidance: 'B', horz_guidance: 'H', vert_guidance: 'V', lazy_boy: 'L' };
/** 엔진 fire.guidance 값 */
export const GUIDANCE_TYPE = { heat_guidance: 'heat', ballistic_guidance: 'ballistic', horz_guidance: 'horz', vert_guidance: 'vert', lazy_boy: 'lazy' };
export const UNGUIDABLE = new Set(['mirv', 'deaths_head', 'riot_charge', 'riot_blast', 'plasma_blast', 'laser']);
export const ENERGY_WEAPONS = new Set(['plasma_blast', 'laser']);
export const SHIELD_MAX = { mag_deflector: 55, shield: 100, force_shield: 100, heavy_shield: 150, super_mag: 200 };
export const PERSONALITY_HINT = { moron: '초급', shooter: '직선 사격', poolshark: '벽 반사', tosser: '보정 사격', chooser: '방법 선택', spoiler: '정밀 사격', cyborg: '정밀·표적 우선', unknown: '정체 비공개' };
export const SHIELD_ITEMS = ['mag_deflector', 'shield', 'force_shield', 'heavy_shield', 'super_mag'];
/** 서버 실드 아이템 ID → 캔버스 방어막 에셋 키 */
export const SHIELD_FX = { mag_deflector: 'shield', shield: 'shield', force_shield: 'force', heavy_shield: 'heavy', super_mag: 'supermag' };

export const CATEGORY_WEAPON = ['일반', '지형 파괴', '지형 생성', '에너지'];
export const CATEGORY_LABEL = { '일반': '일반 무기', '지형 파괴': '지형 파괴 무기', '지형 생성': '지형 생성 무기', '에너지': '에너지 무기', '유도': '유도 장치', '방어': '방어 장치', '기타': '기타 보급품' };

// 서버 오류 코드 → 토스트 문구 (서버 msg 우선, 없을 때 사용)
export const ERR = {
  NICK_TAKEN: '이미 사용 중인 닉네임입니다',
  NICK_INVALID: '닉네임은 2~12자 한글·영문·숫자만 쓸 수 있습니다',
  ROOM_FULL: '방이 가득 찼습니다',
  ROOM_PLAYING: '게임중인 방에는 들어갈 수 없습니다',
  BAD_PASSWORD: '비밀번호가 맞지 않습니다',
  KICKED: '방에서 강퇴되었습니다',
  BANNED: '강퇴된 방에는 다시 들어갈 수 없습니다',
  NOT_HOST: '방장만 할 수 있습니다',
  CANNOT_START: '아직 시작할 수 없습니다',
  NOT_YOUR_TURN: '내 턴이 아닙니다',
  NO_FUNDS: '현금이 부족합니다',
  MAX_OWNED: '보유 한도(99개)입니다',
  TIMEOUT: '시간이 지났습니다',
  RATE_LIMIT: '너무 빠르게 보내고 있습니다',
  DISCONNECTED: '서버와 연결이 끊겼습니다',
  UNKNOWN: '요청이 거절되었습니다',
};
