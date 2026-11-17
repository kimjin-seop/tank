# 로비·방·게임 네트워크 프로토콜 (v1)

클라이언트 담당이 이 문서만 보고 붙을 수 있도록 쓴 계약서. 근거: `docs/SPEC.md` 5절, 화면 문구는 `docs/SPEC_ADDENDUM_KO.md` 8절 용어집. 엔진 쪽 계약은 `docs/ENGINE_API.md`.
구현: `server/net/protocol.js`(코드·옵션 스키마), `server/lobby/lobby.js`(로비·방), `server/game/roomGame.js`(게임 진행), `server/game/engineAdapter.js`(엔진 연결).

## 0. 전송
- WebSocket `ws://<host>:<PORT>/ws` (HTTP와 같은 포트, 기본 3000). 텍스트 프레임 1개 = JSON 객체 1개, 항상 `{t:'종류', ...}`. 최대 16KB.
- HTTP 정적 서빙: `/` -> `public/`, `/assets/` -> `assets/`, `/data/` -> `data/`.
- 서버는 15초마다 WS ping을 보낸다(브라우저가 자동 응답). 연결당 초당 60개 초과 메시지는 `RATE_LIMITED`.
- 모든 요청은 선택 필드 `ref`(아무 값)를 달 수 있고, 그 요청이 실패하면 `error.ref`로 돌아온다.
- 시간 값은 전부 **서버 epoch ms**. 타이머 메시지에는 항상 `serverTime`(보낸 시점)과 `deadline`(마감)이 같이 오므로 남은 시간 = `deadline - serverTime`(수신 시점 기준 차이만 보정). 클라이언트 시계는 서버 판정에 쓰이지 않는다. 시계 보정이 필요하면 `ping`.
- 이름 규칙: 옵션 키는 camelCase, 열거값은 원문 대문자 코드(`SEQUENTIAL`, `LOSERS_FIRST` …).

## 1. 오류와 토스트
모든 거절은 `{t:'error', code, msg, params?, ref?}` 로 온다. `msg`는 한글 기본 문구이고 `code`가 문구 키다(클라이언트가 자체 문구로 덮어써도 됨). **인라인 박스 금지, 토스트로 표시.**
서버 주도 알림은 `{t:'toast', code, msg, params}` (시간 초과 등, 6절).

| code | 기본 문구 |
|---|---|
| BAD_MESSAGE / UNKNOWN_TYPE / RATE_LIMITED | 잘못된 요청입니다 / 알 수 없는 요청입니다 / 요청이 너무 빠릅니다 |
| NOT_LOGGED_IN / ALREADY_LOGGED_IN | 먼저 닉네임을 입력하세요 / 이미 접속한 상태입니다 |
| NICK_INVALID | 닉네임은 2~12자의 한글·영문·숫자만 쓸 수 있습니다 (`컴퓨터`, `컴퓨터N` 예약) |
| NICK_TAKEN | 이미 사용 중인 닉네임입니다 |
| SESSION_REPLACED | 다른 곳에서 접속하여 연결이 종료됩니다 (이전 연결에 전송 후 close) |
| NOT_IN_ROOM / ALREADY_IN_ROOM | 방에 들어가 있지 않습니다 / 이미 방에 들어가 있습니다 |
| ROOM_NOT_FOUND / ROOM_FULL / ROOM_IN_GAME | 방을 찾을 수 없습니다 / 방이 가득 찼습니다 / 게임이 진행 중인 방입니다 |
| ROOM_KICKED | 강퇴되어 이 방에 다시 들어갈 수 없습니다 |
| PASSWORD_UNSUPPORTED | 비밀번호방은 아직 지원하지 않습니다 (1차 제외) |
| TITLE_INVALID / MAX_PLAYERS_INVALID / MAX_PLAYERS_TOO_SMALL / OPTION_INVALID | 방 제목은 1~30자 / 최대 인원은 2~10명 / 현재 참가자 수보다 작게 줄일 수 없음 / 방 설정 값이 올바르지 않음(`params.key`) |
| NOT_HOST / IN_GAME / NOT_IN_GAME / HOST_NO_READY | 방장만 할 수 있습니다 / 게임 중에는 할 수 없습니다 / 게임 중이 아닙니다 / 방장은 준비할 필요가 없습니다 |
| TARGET_NOT_FOUND / CANNOT_KICK_SELF | 대상을 찾을 수 없습니다 / 자신을 강퇴할 수 없습니다 |
| TANK_INVALID / TEAM_INVALID / PERSONALITY_INVALID | 탱크 모양 / 팀 번호 / 컴퓨터 성향이 올바르지 않습니다 |
| START_NEED_PLAYERS / START_NOT_READY / START_TEAMS | 2명 이상이어야 시작할 수 있습니다 / 준비하지 않은 참가자가 있습니다 / 팀이 둘 이상이어야 시작할 수 있습니다 |
| CHAT_EMPTY / CHAT_TOO_LONG / CHAT_RATE | 메시지를 입력하세요 / 200자까지 / 너무 빨리 보내고 있습니다 |
| NOT_YOUR_TURN / TURN_EXPIRED / WRONG_PHASE | 당신의 턴이 아닙니다 / 제한시간이 지났습니다 / 지금은 할 수 없는 행동입니다 |
| INVALID_INPUT / ALREADY_READY | 입력 값이 올바르지 않습니다 / 이미 발사를 준비했습니다 |
| NOT_YOUR_SHOP / SHOP_EXPIRED | 지금은 당신의 상점 차례가 아닙니다 / 상점 제한시간이 지났습니다 |
| ENGINE_REJECT / ENGINE_UNSUPPORTED | 엔진이 거절(`msg`=엔진 한글 사유, `params.reason`=엔진 코드 `NO_WEAPON`·`BAD_POWER` 등) / 지원하지 않는 기능 |
| INTERNAL | 서버 오류가 발생했습니다 |

## 2. 접속·세션·재접속

### 클라이언트 -> 서버
- `{t:'hello', nickname}` 최초 접속. 규칙: 서버 전체 동시 유일(대소문자 무시), 2~12자 한글·영문·숫자.
- `{t:'hello', token}` 재접속(아래). `nickname`은 무시된다.
- `{t:'ping', clientTime}` -> `{t:'pong', clientTime, serverTime}`.

### 서버 -> 클라이언트 `welcome`
```js
{ t:'welcome', protocol:1, token, nickname, resumed:boolean, location:'lobby'|'room'|'game', serverTime,
  limits:{chatMax:200, titleMax:30, maxPlayers:[2,10]},
  defaults:{...옵션 기본값}, schema:{옵션키:{type:'enum'|'int'|'num'|'bool', def, values?|min,max}},   // 방 옵션 폼 생성용
  tanks:[...전체], humanTanks:[...사람 선택 가능], personalities:[...8종] }
```
- `token`을 `sessionStorage`(또는 localStorage)에 저장한다. 서버가 발급하는 불투명 문자열.
- `welcome` 직후: `location==='lobby'`이면 `room_list`, `'room'`이면 `room_joined`, `'game'`이면 `room_joined` + `game_resume`.

### 재접속 흐름
1. 연결이 끊기면 서버는 세션과 좌석을 **30초** 유지한다(유예).
2. 클라이언트는 새 WS를 열고 `{t:'hello', token}`을 보낸다. 성공하면 `welcome.resumed=true`와 현재 위치의 상태를 받는다.
3. 게임 중이면 `game_resume`(지형·탱크·인벤토리 스냅샷, 현재 단계, `turn.deadline`/`shop.deadline`, `serverTime`, 연속 초과 `timeouts`)을 받아 화면을 복구한다. 대행 중이었다면 즉시 제어를 되찾는다(`chat` 시스템 메시지 `RECLAIM`).
4. 유예가 지나 세션이 사라졌으면 토큰이 무효이므로 `hello`에 `nickname`이 없으면 `NICK_INVALID`가 온다 -> 토큰을 버리고 닉네임 입력 화면으로.
5. 같은 토큰으로 다른 연결이 접속하면 이전 연결은 `SESSION_REPLACED` 후 닫힌다.
- 닉네임 재사용: 끊겨 있고 방에도 없는 세션의 닉네임은 새 `hello`로 즉시 가져갈 수 있다. 방/게임 중이던 세션의 닉네임은 유예·게임 종료 전까지 `NICK_TAKEN`.

## 3. 방 목록 (로비 화면)
- `{t:'list_rooms'}` -> `room_list`. 로비에 있는 접속자(방에 안 들어간 사람)는 방 생성·삭제·인원·상태가 바뀔 때마다 **서버가 `room_list`를 푸시**한다(전체 목록, 최근 생성 순).
```js
{ t:'room_list', rooms:[{ id, title, players /*사람+컴퓨터*/, maxPlayers, mode:'SEQUENTIAL'|..., status:'waiting'|'playing', locked:false, host:'방장닉네임' }] }
```
- 입장 불가 표시는 클라이언트가 `status==='playing'` 또는 `players>=maxPlayers`로 한다. 서버는 최종 판정(`ROOM_IN_GAME`, `ROOM_FULL`).

## 4. 대기실

### 방 CRUD
| 요청 | 필드 | 설명 |
|---|---|---|
| `create_room` | `title`(1~30), `maxPlayers`(2~10, 기본 2), `options?`(부분 옵션, 5절) | 만든 사람이 방장. -> `room_joined`. `password`를 보내면 `PASSWORD_UNSUPPORTED` |
| `join_room` | `roomId` | -> `room_joined`. 게임 중/가득/강퇴 시 거절 |
| `leave_room` | | -> `room_left{reason:'leave'}` 후 `room_list`. 게임 중 나가면 그 좌석은 컴퓨터 대행으로 계속 |

### 대기실 조작 (방장 전용 표시: H)
| 요청 | 필드 | 설명 |
|---|---|---|
| `ready` | `ready:boolean` | 방장 제외 본인. 방장은 `HOST_NO_READY` |
| `set_options` (H) | `options?`, `title?`, `maxPlayers?` | 값이 실제로 바뀌면 **전원 준비 해제** + 시스템 채팅 `OPTIONS` |
| `set_profile` | `tank?`, `team?`(1~5), `target?` | 본인 탱크 모양·팀. `target`(참가자 id)을 주면 방장이 그 참가자의 팀만 변경 |
| `add_computer` (H) | `personality?`(기본 `moron`) | 빈 자리에 컴퓨터. 이름은 `컴퓨터N` 자동. 항상 준비 상태. 탱크 모양은 자동 배정(`triple`·`fixed` 제외, 방에서 안 쓰인 모양 우선, 모두 쓰였으면 순환). `set_profile`로 바꿀 수 있음 |
| `set_computer` (H) | `id`, `personality` | 성향 변경 |
| `remove_computer` (H) | `id` | |
| `kick` (H) | `id` | 대상에게 `kicked{msg}` -> `room_left{reason:'kicked'}` -> `room_list`. 그 방이 존재하는 동안 토큰·닉네임 모두 재입장 차단 |
| `transfer_host` (H) | `id` | 수동 위임(SPEC 5.12-5 미결, 임시 제공). 자동 위임: 방장이 나가거나 유예 초과 시 가장 오래 있던 사람 |
| `start` (H) | | 조건: 방장 제외 사람 전원 준비 + 사람+컴퓨터 >= 2 + (팀 모드면 팀 2개 이상). 실패 시 `START_*` |
| `chat` | `text` | 대기실 전용(게임 중 `IN_GAME`). 200자, 400ms 간격 + 10초 6건 제한 |

### 서버 -> 클라이언트
- `room_joined {you, room, chat:[최근 30개]}` : `you`는 내 참가자 id.
- `room_state {room}` : 대기실 상태가 바뀔 때마다 전체 상태를 방 전원에게.
- `chat {from:{id,name}, text, ts}` / 시스템 `chat {system:true, key, text, ts}` (`key`: JOIN LEAVE HOST OPTIONS KICK COMPUTER START AUTO_PASS PROXY RECLAIM).
- `room_left {reason:'leave'|'kicked'|'closed'}` : 방 목록 화면으로 이동(이어서 `room_list`).
- `kicked {roomId, msg}` : 토스트로 표시.
- `back_to_room` : 게임 종료 후 대기실 복귀(직후 `room_state`).

```js
room = { id, title, maxPlayers, status:'waiting'|'playing', hostId, options:{...5절}, serverTime,
  start:{ok:true} | {ok:false, code:'START_NEED_PLAYERS'|'START_NOT_READY'|'START_TEAMS', msg},   // 시작 버튼 활성/툴팁
  slots:[ {slot:0, empty:true} | {slot, id, kind:'human'|'computer', name, ready, tank, team, color:slot번호, personality|null, connected, host} ] }  // maxPlayers 개
```
- `color`는 슬롯 번호(0~9, 서버 자동 배정, 변경 불가).
- 방 인원이 0(사람 기준)이 되면 방이 삭제되고 목록에서 사라진다. 사람이 0명이 되면 컴퓨터만 남은 방은 유지하지 않는다.
- 게임이 끝나면 준비 해제, 옵션·방장 유지, 이탈자 정리 후 `status:'waiting'`.

## 5. 방 옵션 (`options`, `set_options`, `create_room`)
`welcome.defaults/schema`가 정본이다. 부분 객체만 보내면 병합되며, 모르는 키·범위 밖 값은 `OPTION_INVALID{key}`.

| 키 | 값/범위 | 기본 |
|---|---|---|
| mode | SEQUENTIAL / SYNCHRONOUS / SIMULTANEOUS | SEQUENTIAL |
| teams | NONE / STANDARD / CORPORATE / VICIOUS | NONE |
| rounds | 1~1000 | 10 |
| turnLimitSec | 30 / 45 / 60 / 90 (무제한 없음) | 60 |
| shopLimitSec | 60 / 90 / 120 (무제한 없음) | 90 |
| interestRate / cashAtStart / computersBuy / freeMarket / scoringMode | 0~0.30 / 0~1000000 / bool / bool / BASIC·STANDARD·GREEDY | 0.05 / 0 / true / false / STANDARD |
| airViscosity / gravity / suspendDirt / tanksFall / bordersExtend | 0~20 / 0.05~10 / 0~100 / bool / 0~10000 | 0 / 0.2 / 0 / true / 75 |
| wallEffect | NONE CONCRETE PADDED RUBBER SPRING WRAP RANDOM ERRATIC | NONE |
| sky | PLAIN STORMY STARS SHADED SUNSET CAVERN BLACK RANDOM | RANDOM |
| maxWind / changingWind / hostileEnvironment | 0~500 / bool / bool | 200 / false / true |
| bumpiness / slope / flattenPeaks / randomLand / scannedMountains | 0~100 / 0~100 / bool / bool / 0~100 | 20 / 20 / false / false / 20 |
| statusBar / playOrder / fastComputers | bool / RANDOM·LOSERS_FIRST·WINNERS_FIRST·ROUND_ROBIN / bool | false / RANDOM / false |
| talkingTanks / talkProbability | OFF·COMPUTERS·ALL / 0~100 | OFF / 100 |
| armsLevel / bombIcon / tunneling / scale | 0~4 / INVISIBLE·SMALL·BIG / bool / NORMAL·MEDIUM·LARGE | 4 / BIG / true / NORMAL |
| tracePaths / extraDirt / uselessItems / impactDamage | bool | false / false / false / true |

효과음(sound/flightSounds)은 클라이언트 로컬 설정이라 방 옵션에 없다. 어댑터가 엔진 옵션 키로 변환하며(`wallEffect`->`wall` 등) 엔진이 모르는 표시용 옵션은 엔진에 넘기지 않는다.

## 6. 게임

### 6.1 진행 순서 (서버 -> 방 전원 브로드캐스트)
```
game_start -> [shop_turn... shop_end]  (cashAtStart>0 이면 1라운드 전 상점) -> round_start -> (turn/shot 반복) -> round_end
 -> (마지막 라운드가 아니면) shop_turn... shop_end -> round_start ... -> game_over -> back_to_room
```
- `game_start {seats, options, serverTime}` : `seats:[{id,name,kind,color,tank,team,personality,proxy,connected}]`.
- `round_start {round, rounds, info, events, serverTime}` : `info`는 엔진 `startRound()`의 RoundInfo(지형 RLE·탱크·바람·벽·하늘·순서 등, ENGINE_API §2)에서 **비공개 필드를 뺀 공개판**이다(`interest` 제거, `tanks[]`는 6.7 공개 탱크 필드만). 이 메시지로 라운드 화면을 구성한다. 본인 이자·현금은 직후 `me`로 온다.
- `round_end {round, events, state, ranking, serverTime}` : `state`는 엔진 Settlement의 공개판(`winners, payouts, gains, scores:[{id,score}], gameOver, ranking`; 현금·순자산 제거). `payouts`={id:금액}은 생존자 풀 분배분만, `gains:[{id, payout(풀 분배분, 없으면 0), earned(이번 라운드 점수 증가 = 피해·처치·분배 합계)}]`는 전 플레이어의 이번 라운드 획득액이다. 정산 반영 현금은 직후 `me`로 온다. 약 4초 후 다음 단계.
- `game_over {ranking, serverTime}` : 최종 순위 표시(이 시점에만 `cash`·`netWorth` 포함, GREEDY 순위 표시용). 약 8초 후 `back_to_room`.

### 6.2 턴 `turn` (조준 단계 시작)
```js
{ t:'turn', mode:'seq'|'sync'|'sim', playerId /*seq만*/, deadline /*ms, null이면 타이머 없음*/, limitMs, auto:boolean, timeouts?, events:[...턴 시작 이벤트], serverTime }
```
- `seq`(순차): `playerId`의 턴. `auto:true`(컴퓨터·대행·이탈자)면 `deadline:null`이며 서버가 곧 대신 쏜다(`shot` 도착).
- `sync`(동기): 전원 공통 조준 타이머 1개. 나는 `fire`로 "준비"하고, 전원이 준비하면 만료 전에 즉시 발사된다. 만료 시 준비한 샷만 발사. 다른 사람 조준값은 노출되지 않고 `ready{playerId, readyIds}`만 온다.
- `sim`(동시): 타이머 없음, 누구나 언제든 `fire`. 컴퓨터는 서버가 약 2초 간격으로 쏜다.
- 타이머는 현재 턴 플레이어의 조준·이동·패널 조작 중에도 계속 간다. `fire`가 서버에서 확정되는 순간 멈춘다. 마감 이후 도착한 입력은 `TURN_EXPIRED`로 거부된다(서버 수신 시각 기준).
- 시간 초과(5.7.1): 그 턴은 발사 없이 넘어가고 소모품은 줄지 않는다. 서버가 `toast{code:'TURN_TIMEOUT', msg:'시간 초과! ○○님의 턴이 넘어갑니다', params:{playerId,name}}` + 시스템 채팅 `AUTO_PASS`. **연속 3회**: 접속 중이면 `toast{code:'IDLE_RETREAT'}` 후 후퇴, 끊겨 있으면 컴퓨터 대행(`PROXY`). 유효한 발사를 하면 횟수는 0.
- 다음 턴 타이머는 직전 샷의 재생이 끝난 뒤 시작한다. 재생 길이 = `엔진 ticks * 20ms + 800ms`(임시 값, SPEC 5.7.1-1 [확인 필요]).

### 6.3 클라이언트 입력
| 요청 | 필드 | 설명 |
|---|---|---|
| `fire` | `weapon`(items id), `angle`(0~180), `power`(0~1000), `target?`({x,y}\|탱크id), `batteries?`(0~10), `guidance?`(heat·ballistic·horz·vert·lazy), `trigger?` | 서버가 현재 턴/마감/타입 검증 후 엔진이 보유·범위 검증. 실패 시 `error`. 표적·배터리 수가 필요한 무기는 선택을 마친 **최종 `fire` 한 번**에 담아 보낸다(그때까지 타이머는 계속 감). |
| `aim` | `angle`, `power`, `weapon?` | 조준 중계(최대 12회/초). 다른 플레이어에게 `aim{playerId,angle,power,weapon}`로 전달(순차: 현재 턴 플레이어만, 동기: 중계 안 함, 동시: 전원). 서버 상태에는 영향 없음 |
| `act` | `action`: `battery` `parachute`{on,threshold} `shield`{item\|null} `trigger`{on} `guidance`{type,target} `move`{dir:-1\|1,steps} `aim` | 발사 외 조작. 타이머는 멈추지 않음. 결과는 `act_result{playerId, events, state}`: **본인에게는 전체 상태**(낙하산·방아쇠·유도·연료 포함), 다른 사람에게는 **이벤트와 공개 필드 변화만**(보이는 변화가 없으면 아예 보내지 않음) |
| `retreat` | | 순차 모드 내 턴에 후퇴 |

#### 각도 규약 (클라이언트 변환 규칙)
서버·엔진·`fire`/`aim`/`shot`/탱크 상태의 `angle`은 모두 **0..180 단일 값**이다: 0=오른쪽 수평, 90=수직 위, 180=왼쪽 수평(반시계 증가). 원본 UI의 "0~90도 + 좌/우 방향"과는 다음처럼 변환한다.
```js
// 엔진 값 -> UI
const dir = angle <= 90 ? 'right' : 'left';   // 90(수직)은 right 로 표기
const uiAngle = angle <= 90 ? angle : 180 - angle;   // 0..90
// UI -> 엔진 값(fire/aim 전송)
const angle = dir === 'right' ? uiAngle : 180 - uiAngle;
```
- 방향 전환(좌/우 키)은 `angle = 180 - angle`. 각도 조절 키: 오른쪽을 보고 있으면 `angle±1`, 왼쪽이면 `angle∓1`(UI 각도를 키우는 방향이 반대).
- 포신 화면 각도(캔버스 y 아래+)는 `x = cos(angle*PI/180)`, `y = -sin(angle*PI/180)` 방향. 파워는 0..`hp*10`(체력 100이면 최대 1000), 범위를 벗어나면 `ENGINE_REJECT{reason:'BAD_POWER'}`.

### 6.4 샷 이벤트 스트림 `shot`
```js
{ t:'shot', playerId /*동기 일제사격이면 null*/, events:[...엔진 이벤트, tick순], state:{tanks:{...},players:{...},wind}, serverTime }
```
- `events`는 ENGINE_API §3 형식(`t`,`tick`; 1tick=20ms). 클라이언트는 수신 즉시 `tick*20ms`에 맞춰 재생한다. 판정은 서버 확정이며 `state`는 샷 후 변화분이다.
- 샷 하나가 끝난 뒤 서버가 재생 시간만큼 기다렸다가 다음 `turn`을 보낸다.
- 엔진 `deathFx` 이벤트(`{t:'deathFx', tick, tank, variant:0..10, radii:[...], modeled, last}`)가 `death` 뒤 `shot.events`에 그대로 전달된다(ENGINE_API §3). `shot.state`는 **공개판**이다(6.7). 샷 직후 서버는 각 사람 플레이어에게 개인용 `me`를 따로 보낸다.

#### 서버가 삽입하는 `talk` 이벤트 (말하는 탱크)
- 방 옵션 `talkingTanks`가 `COMPUTERS`(컴퓨터 좌석 탱크만) 또는 `ALL`(전원)이면, `talkProbability`(%)에 따라 `shot.events`에 `{t:'talk', tick, tank, text}`가 끼어든다. `OFF`면 없음. 엔진 이벤트가 아니라 서버가 만든다(`server/game/talk.js`).
- 공격 대사: `fire` 이벤트 바로 뒤(같은 `tick`, 발사자 = `tank`). 사망 대사: `death` 이벤트 바로 뒤(같은 `tick`, 죽은 탱크 = `tank`; 후퇴 `retreat:true` 사망은 제외). 대사 데이터는 `data/talk_ko.json`(`attack` 54, `death` 60; 원본 TALK1/TALK2 한국어 의역). 빈 줄은 침묵(그 발화 없음), 중복 줄은 가중치(균등 추첨이라 자연 반영).
- 난수는 엔진과 별개인 서버측 결정론 RNG(게임 시드에서 파생)라 엔진 결과에 영향이 없다. 확률 판정에 실패하거나 침묵 줄이면 이벤트가 생기지 않는다. 클라이언트는 `talk`를 `tick*20ms`에 맞춰 말풍선으로 표시하면 된다.
- `turn.events`(턴 시작 이벤트)·`act_result.events`에는 삽입하지 않는다.

#### 이벤트 필드 확정표 (엔진 `server/engine/shot.js` 코드 기준)
`explode {t,tick,x,y,r,kind,dur,color?,fireballOnly?,harmless?,batteries?,pid?}`
| kind | 발생 | 비고 |
|---|---|---|
| 무기 id: `baby_missile` `missile` `baby_nuke` `nuke` | 일반 폭발 | 피해·분화구 있음 |
| `leap_frog` | 3연속 폭발(반경 30·25·20×scale) | 각 폭발마다 이벤트 |
| `baby_roller` `roller` `heavy_roller` | 탱크 직격 또는 굴러간 끝 지점 | |
| `baby_sandhog` `sandhog` `heavy_sandhog` | 벌레가 죽는 지점마다(반경 10×scale) | 일반 digger(`*_digger`)는 explode 없음 |
| `mirv` `deaths_head` | 하위탄 폭발, `fireballOnly:true` | 분화구는 나중에 `terrain`으로 |
| `riot_bomb` `heavy_riot_bomb` | `harmless:true`, `dur:8` | |
| `dirt_clod` `dirt_ball` `ton_of_dirt` | `harmless:true`, `dur:min(r,30)` | |
| `dirt_charge` | 반경 6, `dur:50`, `harmless:true` | |
| `funky` | 무기 id가 아니라 문자열 `funky`(Funky Bomb 파편, `color` 포함) | |
| `plasma` | 무기 id가 아니라 문자열 `plasma`(Plasma Blast, `batteries` 포함) | |
| `death` | 탱크 파괴 폭발(반경 30×scale, 쏜 사람 없음) | 직전 `death` 이벤트와 쌍 |
- `pid`(쏜 사람): **엔진 explode 이벤트에는 `pid` 필드가 없다.** 어댑터가 단발 사격(`fire`/컴퓨터·대행 `aiAct`)에서 `kind!=='death'`인 explode에 발사자 id를 `pid`로 덧붙인다. 동기 모드 일제 사격(`shot.playerId:null`)은 구분할 수 없어 `pid`가 없다. `kind:'death'`도 `pid` 없음. 신뢰 기준은 `fire`/`proj` 이벤트의 `pid` 또는 `shot.playerId`.
- `napalm {t,tick,kind:'napalm'|'hot'|'liquid',pixels,records,dur,weapon}`: `dur`의 단위는 **틱(1tick=20ms)**. 값은 입자 정착 시뮬레이션 반복 횟수(`iters`, 최소 1)로, 엔진은 이 값을 곧바로 `end = start + dur` 틱으로 쓴다(`shot.cursor`, 샷 전체 `ticks = max(tick+dur)`). 즉 네이팜 불길 연출은 `tick`부터 `dur`틱(= `dur*20ms`) 동안. 입자(`pixels`)는 정착 순서대로이므로 시간에 균등 분배해 그리면 된다. `kind`: `napalm`(napalm), `hot`(hot_napalm), `liquid`(liquid_dirt).
- 다른 이벤트의 `dur`도 모두 틱 단위(`explode`·`digger`·`dirtFall`·`laser`·`riot`·`disrupt`).

### 6.5 상점 (라운드 사이)
- 현금이 있는 플레이어만, 한 명씩. 컴퓨터·대행·이탈 좌석은 타이머 없이 서버가 즉시 구매(`computersBuy` 반영).
- `shop_turn {playerId, deadline, limitMs, serverTime}` : 방 전원에게. 본인은 상점 화면, 다른 사람은 "구매 중: ○○ n초". 구매·판매 조작 중에도 타이머는 계속 감.
- **가격 목록**: `shop_turn` 직후 상점 차례 본인에게만 `me`가 오며 `shop:[{id, price, bundle, unitPrice, owned, arms, allowed, affordable}]`가 붙는다(엔진 `game.shopList(pid)` 결과 그대로). `price`는 묶음(bundle) 가격이고 자유 시장이면 현재가, `unitPrice=price/bundle`, `owned`는 보유 수(Auto Defense는 0/1), `arms`는 무기 등급, `allowed=arms<=armsLevel`, `affordable`은 현금으로 살 수 있는지. 같은 목록이 본인의 `shop_result.shop`에도 갱신되어 온다(구매·판매 직후). 타인·방 전원 메시지에는 싣지 않는다. 쓸모없는 아이템 숨김(`uselessItems`)은 엔진 목록에 반영되지 않으므로 클라이언트가 `allowed`/보유 기준으로 필터링한다.
- 요청(본인 차례에만, 마감 후 `SHOP_EXPIRED`): `buy {item, qty?}` -> `shop_result{ok,action:'buy',item,qty,state,snapshot}`. 판매는 2단계: `sell_quote {item, qty}` -> `sell_quote{item,qty,quote}` -> `sell_accept` / `sell_reject` -> `shop_result`. `shop_done`으로 완료.
- 만료: 확정된 구매·판매는 유지, 수락 전 판매 제시는 거절 처리, `toast{code:'SHOP_TIMEOUT', msg:'상점 시간 초과! ○○님의 구매가 종료됩니다'}`. 끊긴 플레이어도 같은 타이머.
- `shop_end` 후 곧바로 `round_start`.

### 6.6 이탈·재접속·방장
- 게임 중 끊김: 좌석 유지, **같은 타이머 그대로**(현재 턴이면 만료 시 자동 패스). 유예 30초 후 컴퓨터 대행(성향 모론), 재접속하면 즉시 회수.
- 방장이 끊겨 유예가 지나거나 나가면 방장 자동 위임(게임은 계속). 게임 중 입장 불가·관전 없음(재접속만).
- 사람이 전원 유예 초과로 끊기면 게임을 종료하고 방을 삭제한다.
- `game_resume {seats, options, phase:'shop'|'aim'|'resolving'|'roundEnd'|'over', round, rounds, mode, turn?, shop?, readyIds?, timeouts:{id:n}, snapshot, serverTime}`: `snapshot`은 엔진 `snapshot()` + 본인 `inventory`.

### 6.7 공개 상태 / 개인 상태 (`me`)
방 전원에게 가는 메시지(`round_start`, `shot`, `act_result`(타인), `round_end`, `game_resume.snapshot`의 타인 탱크)에는 **공개 필드만** 들어간다. 비공개 정보(현금·인벤토리·연료·선택 무기·유도/방아쇠/낙하산 설정·이자)는 본인에게만 간다.
- 공개 탱크 필드: `id, name, colorIndex, tankType, team, cpu, x, y, alive, hp, angle, power, shield, score`. `shot.state`는 `{tanks:{id:{변경된 공개 필드}}, players:{id:{score}}, wind?}`.
- `me {inventory:{cash,score,items:{id:n},autoDefense}, tank:{본인 탱크 전체 뷰}, interest?, serverTime}` : 본인에게만. 전송 시점: `round_start` 직후(`interest`=이번 라운드 이자), 상점 단계 시작, 모든 `shot`/`round_end` 직후, 본인 `act` 직후, 상점 차례 시작 시(`shop` 포함). 클라이언트는 최신 `me`로 본인 현금·보유 무기·연료를 표시한다.
- **`round_end` 직후 `me` 보장**: 서버는 `round_end`를 브로드캐스트한 같은 동기 처리 안에서 곧바로 모든 사람 플레이어(이탈 좌석 제외)에게 `me`를 보낸다(`_endRound`: `round_end` -> `me`). 그 사이 다른 메시지가 끼지 않으므로 `round_end` 수신 직후 `me`(정산·이자 반영 현금)가 온다. 그 다음 약 4초 뒤 상점(`me`+`shop`)이나 `game_over`가 이어진다. 연결이 끊긴 사람은 못 받으므로 재접속 시 `game_resume.snapshot.inventory`로 복구한다.
- `shop_result.snapshot`/`game_resume.snapshot`은 공개 스냅샷 + 본인 `you`(전체 탱크 뷰) + 본인 `inventory`.
- 컴퓨터(및 대행 중인 사람) 탱크의 자동 조작·구매는 서버가 엔진 `aiAct`/`aiShop`(성향 `moron`)으로 수행한다.

## 7. 클라이언트 구현 체크리스트
1. `hello` -> `welcome`(token 저장) -> 위치별 화면. 모든 화면 전환은 서버 메시지(`room_joined`, `room_left`, `game_start`, `back_to_room`)로 한다.
2. 시작 버튼 활성/툴팁은 `room.start`를 그대로 쓴다.
3. 모든 `error`/`toast`는 토스트로 표시. 카운트다운은 `deadline - serverTime` 기준으로 로컬 단조 시계(`performance.now`)로 표시만 한다.
4. 끊기면 지수 백오프로 재연결하며 `{t:'hello', token}`.
