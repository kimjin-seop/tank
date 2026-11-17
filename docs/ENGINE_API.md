# 게임 엔진 코어 API (server/engine)

로비/네트워크 서버와 클라이언트가 이 문서만 읽고 붙을 수 있도록 쓴 계약서. 규칙의 근거는 `docs/REVERSE_ENGINEERING.md`(이하 RE), 구현 상태(원본확인/추정구현/미구현)는 `docs/ENGINE_STATUS.md`.

- Node 20+ ESM, 외부 의존성 없음. 테스트: `cd server/engine && node --test test/`.
- 서버 전용 권위 시뮬레이션. **결정론**: 같은 `seed`, 같은 옵션·플레이어, 같은 호출 순서 → 완전히 같은 결과(이벤트 포함). 난수는 원본 R250(RE §9) 하나만 쓴다. 시드는 `seed & 0xFFFF`(원본은 16비트).
- 모드(순차/동기/동시)에 종속되지 않는다. 턴·타이머·동시성은 로비 서버가 관리한다. 엔진은 `fire`(1발) 와 `fireVolley`(동시에 여러 발)를 모두 제공한다.
- 단위: 좌표 정수 픽셀(원점 좌상단, y 아래 +), 시간 `tick` 1 = 시뮬레이션 0.02초(투사체는 tick 당 round(s)≈299 서브스텝으로 원본 dt=1/(50s)로 적분, PLAYBACK_TIMING.md. `proj.pts` 는 tick 끝 위치만 내보냄 = 이벤트 의미 불변). 각도 0=오른쪽, 90=위, 180=왼쪽(RE §3.1).

```js
import { createGame, decodeTerrain } from './server/engine/index.js';
```

## 1. createGame

```js
const game = createGame({
  options: { /* 아래 표, 전부 선택. 생략 시 기본값 */ },
  players: [{ id, name, colorIndex /*0..9*/, tankType /*'classic'|'wedge'|'heavy'|'wheeled'|'scout'|'fixed'|'triple'*/,
              cpu: false | 'moron'|'shooter'|'poolshark'|'tosser'|'chooser'|'spoiler'|'cyborg'|'unknown',
              team /*정수|문자열, teams!=='none' 일 때*/ }],
  seed,
});
```

`players` 2~10명. `tankType:'fixed'` 는 이동·연료 불가, `'triple'` 은 Missile/Baby Missile 3연발(컴퓨터 전용, 추정구현).

### options (camelCase, 범위는 RE §3.4 / SPEC 1.12)

| 키 | 기본 | 설명 |
|---|---|---|
| width, height | 360, 480 | 필드 크기(좌표 0..width-1, 0..height-1). HUD/테두리는 엔진에 없음 |
| rounds | 10 | 총 라운드 |
| gravity | 0.2 | 0.05~10 |
| airViscosity | 0 | 0~20 |
| maxWind / changingWind | 200 / false | 0~500 |
| wall | 'none' | 'none','wrap','padded','rubber','spring','concrete','random'(라운드당),'erratic'(발사마다) |
| edgesExtend | 75 | 0~10000 |
| sky | 'random' | 'plain','shaded','stars','stormy','sunset','cavern','black','random' |
| hostile | true | 번개 피해 |
| land1 / land2 / flatland / randomLand | 20 / 20 / false / false | 울퉁불퉁 / 경사 / 봉우리 평탄화 / 무작위 |
| mtnPercent | 20 | 스캔 산 확률(0~100). `mtnDir` 로 폴더 변경(기본 `data/mtn`) |
| suspendDirt | 0 | 0~100 |
| tanksFall / impactDamage | true / true | |
| scale | 'normal' | 'normal','medium','large' (폭발 반경 배율, RE §5.1) |
| armsLevel | 4 | 0~4 |
| tunneling, traceBomb(Trace Paths) | true / false | 표시용 옵션(ENGINE_STATUS 참고) |
| extraDirt | false | Dirt Charge 양 증가 |
| interestRate | 0.05 | 0~0.30 |
| initialCash | 0 | |
| computersBuy / freeMarket | true / false | |
| scoring | 'standard' | 'basic','standard','greedy' |
| teams | 'none' | 'none','standard','corporate','vicious' |
| playOrder | 'random' | 'random','losers','winners','roundrobin' |
| fireDelay / bogoMips | 100 / 299 | 비행 시간 스케일 s=fireDelay*bogoMips/(발사체수*100). bogoMips 299 = 골든 환경 |
| fallingDelay | 10 | 낙하 1픽셀당 tick = max(1, round(v/10)) |
| market | null | `exportMarket()` 로 얻은 객체(자유 시장 가격 이어받기) |

## 2. 라운드

### game.startRound() → RoundInfo
```js
{ round, terrain: {w,h,cols:[...]}, tanks:[Tank...], wind, wall:'rubber', wallCode, sky:'stormy', palette:{ground:[r,g,b], mtn:[[r,g,b]x16]|null, mountain:'ROCK001'|null},
  order:[id...], interest:{id:amount}, events:[] }
```
- **terrain 압축**: `cols[x]` = 평탄 배열 `[y0,y1,c, y0,y1,c, ...]`: x열에서 y0..y1(포함)이 색 c(흙, 0x50..0x68)인 구간. 나머지는 하늘. `decodeTerrain(rle)` → `Uint8Array(w*h)` (0=하늘, idx=y*w+x).
- 이자는 여기서 지급(쇼핑 후, RE §7). 첫 라운드도 `initialCash` 에 이자가 붙는다.
- 바람·벽 6종 중 'random' 은 여기서 확정.

### Tank 객체 (모든 응답 공통)
```js
{ id, name, colorIndex, tankType, team, cpu, x, y /*발바닥(지면 접점) 행*/, alive, hp /*0..100*/,
  angle /*0..180 (RE 의 angle 과 facing 을 합친 값, 0=오른쪽)*/, power, weapon /*item id*/,
  shield: {item:'shield'|..., hp}|null, parachute:{on, threshold}, trigger:bool, fuel, guidance:{...}|null,
  cash, score }
```
판정 크기(추정, ENGINE_STATUS): 몸체 폭 9(x±4) 높이 6(y-5..y), 포탑 축 (x, y-5), 포신 길이 8, 방어막 반경 10(중심 (x,y-3)).

### game.beginTurn(playerId) → {events, wind, wall, state}
한 플레이어의 턴 시작 처리(순차 모드는 매 턴, 동기 모드는 매 조준 단계에 호출; 동시 모드는 호출 불필요): CHANGING_WIND 변동(RE §8.4), STORMY 번개(RE §8.6), SUSPEND_DIRT 턴당 1회 플래그 해제, 'erratic' 벽 결정.

### game.roundOver() → {over, aliveIds, winnerTeam}
### game.endRound() → Settlement
라운드 정산(RE §7): 생존자 풀 균등 분배, 점수/현금 변동 후 `{round, winners:[ids], payouts:{id:amount}, scores:[{id,cash,score}], gameOver:boolean, ranking:[...]}`. 모든 라운드가 끝나면 `gameOver:true`.
### game.nextOrder() → [ids]
playOrder 에 따른 다음 발사 순서(살아있는 탱크). startRound 의 `order` 와 같은 규칙.

## 3. 발사

### game.fire(playerId, input) → Result
```js
input = { weapon:'missile', angle:0..180, power:0..hp*10, target?:{x,y}|tankId, batteries?:0..10, guidance?:'heat'|'ballistic'|'horz'|'vert'|'lazy', trigger?:bool }
```
- `weapon` 은 `items_ko.json` 의 id 문자열(예 `'baby_missile'`). `angle`/`power` 생략 시 탱크 현재값.
- `guidance` 지정 시 해당 유도 아이템 1개 소모(MIRV/DH/Riot/Plasma 는 소모 없음), `target` 은 ballistic/horz/vert/lazy 에 필요(heat 는 불필요).
- `trigger:true` 이면 Contact Trigger 1개 소모(터널링 없이 즉시 폭발).
- Result: `{ok:true, events:[...], state, ticks, roundOver:boolean}` 또는 `{ok:false, error:'NOT_ALIVE'|'NO_WEAPON'|'BAD_POWER'|'BAD_ARGS'|'ROUND_OVER'|..., message}`. 오류 시 상태 변화 없음.
- `state`: 변화한 것만 `{tanks:{id:{필드...}}, players:{id:{cash,score}}, wind}`.

### game.fireVolley([{playerId, ...input}]) → Result
동기 모드용. 여러 발을 같은 tick 에 동시에 발사해 한 번에 해결한다(결과 형식 동일). 발사자 순서는 배열 순서(해결 순서 결정에 사용). 검증 실패 항목은 건너뛰고 `result.rejected:[{playerId,error,message}]` 로 알린다(전부 실패하면 `ok:false`). `fire` 오류 응답에도 같은 `rejected` 가 들어 있다.

### 이벤트 (시간순, `tick` = 샷 시작 0 기준, 정렬됨)
공통 필드 `t`(종류), `tick`. 클라이언트는 `tick*20ms` 에 맞춰 재생한다.

| t | 필드 | 의미 |
|---|---|---|
| `fire` | pid, weapon, x,y(포구), angle, power | 발사 순간(tick 0) |
| `proj` | id, pid, weapon, tick(시작), dur, pts:[x0,y0,x1,y1,..](1스텝=1tick, 시작점 포함), end:'ground'/'tank'/'shield'/'out', parent?, smoke? | 투사체 경로. 도착 tick = tick+dur |
| `bounce` / `wrap` | id, x,y, wall:'left'/'right'/'top' / id, x | 벽 반사·랩 |
| `split` | id, x,y, children:[id..] | MIRV/DH 정점 분리(자식 `proj` 는 parent 필드) |
| `guide` | id, mode:'heat'/'horz'/'vert' | 유도 전환 시점 |
| `explode` | x,y,r,kind(무기 id, 'death','funky','plasma'), dur, color?, fireballOnly?, harmless?, batteries? | 불덩이. `fireballOnly`=분화구는 나중에(MIRV), `harmless`=피해 없음(흙/라이엇 폭탄/흙 장약) |
| `terrain` | spans:[[x,y0,y1,c],..] | 열 x 의 y0..y1 을 색 c(0=하늘, 0x50..0x68=흙)로 덮어쓴다. 이벤트 순서대로 적용하면 서버 지형과 같아진다(테스트로 검증) |
| `dirtFall` | dur, rate, spans:[{x,y0,y1,dy,t0}] | 흙덩이 낙하 연출 힌트(열 x 의 y0..y1 덩어리가 t0 tick(소수 가능) 부터 tick 당 `rate` px 씩 dy 만큼 하강). `rate = DIRT_FALL_RATE(config.js, 기본 3) / (fallingDelay/10)`, `dur = ceil(낙하 프레임 수 / rate)`. 배율은 재생 시간만 바꾸며 시뮬레이션·난수·최종 지형은 그대로. 결과 지형은 이어지는 `terrain` 이벤트 |
| `hit` | tank, kind:'direct'/'shieldDirect', x,y | 직격 |
| `hp` | tank, hp, delta, shield, shieldDelta, src(발사자 id 또는 null), kind | 체력/방패 변화 |
| `shield` | tank, item, hp, kind:'on'/'off'/'break'/'reflect' | 방패 상태 |
| `tankFall` | tank, x0,y0 -> x,y1, ticks, chute, dmg, pts? | 탱크 낙하(낙하산 표류 시 pts 경로) |
| `death` | tank, killer, x,y, retreat? | 탱크 파괴(파괴 폭발은 이어지는 `explode` kind:'death') |
| `deathFx` | tank, variant(0..10, 8 제외), radii[], modeled, last, discCount?/pixelCount?/boltCount? | 사망 연출 종류(원본 171b:0005: `rand(11)`). variant 0=섬광만, 1=반경 20, 2=20→40, 3=20→40→75(미사일/아기 핵/핵 반경, 이어지는 `explode` kind:'death'). 4=번개 폭풍(볼트 `boltCount`개, 끝점 분화구 + 아기 핵 폭발, 볼트 난수 미모델 -> `modeled:false`), 5=고리 분출(`radii:[L]`, 복원 픽셀 `pixelCount`), 6=흙 장약(쐐기 기하 추정, `modeled:false`, radii 빈 배열), 7=불덩이 분수(지형 영향 없음), 9=충격파 덩어리(반경 30 + 소원판 `discCount`개, 골든 일치), 10=파편(시각, `modeled:false`, radii 빈 배열). 4·6·10 은 추정 구현. 이어지는 `terrain` 이벤트가 지형 변화. `last`=이 사망으로 라운드가 끝나는가. 숫자 필드는 개수이며 napalm `pixels`(좌표 배열)와 무관. 연출 그림은 클라이언트 몫 |
| `roller` | id, pts, weapon, x,y | 롤러 이동 경로(1픽셀/tick), 끝에서 `explode` |
| `digger` | kind, worms:[{pts}], dur | 굴착 벌레 경로(이어서 `terrain`, Sandhog 는 `explode`) |
| `fizzle` | x,y,weapon,contact? | 불발(정점 전 MIRV, 탱크에 맞은 디거 등) |
| `napalm` | kind:'napalm'/'hot'/'liquid', pixels:[x,y,..](정착 순서), records:[[x,y]], dur, weapon | 네이팜/액체 흙 입자 |
| `riot` | x,y,r,angle,half,weapon,dur | 라이엇 차지/블라스트 부채꼴(이어서 `terrain`) |
| `disrupt` | x,y,dur | 대지 교란기 점멸 |
| `laser` | x0,y0,x1,y1,batteries,dur | 레이저 빔 |
| `lightning` / `flash` | x,y,tank? / 없음 | 번개(beginTurn 결과의 events) |
| `retreat` | tank | 후퇴 |
| `roundEnd` | winners:[ids] | 이 샷으로 라운드 종료 조건 성립 |

## 4. 장비 조작 (제어판)
모두 `{ok, ...}` 또는 `{ok:false,error,message}` 반환.

- `game.aim(pid, {angle,power,weapon})` 조준값 저장(클램프, power ≤ hp*10).
- `game.useBattery(pid)`: 배터리 1개, hp +10(100 이상이면 거부).
- `game.parachute(pid, {on:true|false, threshold:0..100})`
- `game.shield(pid, item|null)`: 방어구 가동(1개 소모, hp 만땅, 같은 종류 만땅 재가동 거부). `null` 로 해제.
- `game.trigger(pid, on)`: Contact Trigger 켜기(발사 시 소모).
- `game.guidance(pid, {type,target}|null)`: 유도 사전 선택(발사 시 소모).
- `game.fuelMove(pid, {dir:-1|1, steps:1})`: 연료 이동(1픽셀=1 단위, 연료 통 1개=10). 결과 `{ok, x, y, fuel, moved, events, state, roundOver}`(이벤트에 `tankFall`/`hp` 포함 가능). 이동 불가면 `{ok:false,error:'NO_FUEL'|'IMMOBILE'}`.
- `game.retreat(pid)`: 후퇴(점수 없음, 탱크 폭발).

## 5. 상점/경제 (RE §7)
- `game.inventory(pid)` → `{cash, score, items:{id:n}, autoDefense}`
- `game.shopList(pid)` → `[{id, price, bundle, unitPrice, owned, arms, allowed, affordable}]` (자유 시장이면 현재가)
- `game.buy(pid, itemId, qty=1)` (qty = 묶음 수) → `{ok, cost, added, cash}`. 재고 99 초과분은 환불, 부분 구매분 +20% 가산.
- `game.sellOffer(pid, itemId, qty)` → `{ok, offer}` (정가 80%, 자유 시장 65%). `game.sell(pid,itemId,qty)` 가 같은 값으로 실행. Baby Missile 은 판매 불가.
- `game.aiShop(pid)` 컴퓨터 구매(RE §7).
- `game.market()` / `game.exportMarket()`: 자유 시장 현재가/저장용 객체.

## 6. 컴퓨터 AI (RE §10)
- `game.aiAct(pid)` → fire 입력 `{weapon, angle, power, guidance?, target?, batteries?, pre:[...]}`. 에너지 85 미만 배터리·방어구·낙하산 자동 조작은 `aiAct` 가 직접 적용하고 `pre` 에 결과 이벤트를 담는다. 발사는 호출자가 `fire(pid, input)`.
- `game.aiTurn(pid)` = `aiAct` + `fire`, `Result` 에 `pre` 포함.

## 7. 기타
- `game.snapshot()` 전체 상태(지형 RLE 포함). `game.state()` 탱크/플레이어 요약.
- `game.ranking()` 점수 순위(GREEDY 는 순자산).
- `game.round`, `game.options`, `game.wind`, `game.wall` 읽기 전용 공개.
- `game.rngState()` 디버그용 R250 인덱스/체크섬.

변경 이력은 문서 하단에 추가한다.

## 8. 계약 변경점/주의 (구현 후 확정)

- 초안 대비 추가: `fireVolley`, `beginTurn`, `nextOrder`, `roundOver`, `aim`, `aiTurn`, `state`, `snapshot`, `rngState`, `exportMarket`, `decodeTerrain`/`applySpans`(클라이언트 헬퍼, `index.js` 에서 export), `encodeMkt`/`decodeMkt`.
- 각도는 0..180 한 값(0=오른쪽, 90=위, 180=왼쪽)이다. SPEC UI 의 0~90+좌우 방향 표현은 클라이언트에서 변환한다(RE §3.1 의 angle+facing 을 합친 값).
- 엔진은 HUD/테두리를 모른다. 필드 좌표는 0..width-1, 0..height-1 전체이며 절차 지형의 최소 높이는 위에서 40px.
- `fire` 결과의 `state.tanks[id]` 는 변경된 필드만, `state.players[id]` 는 `{cash,score}`. 라운드 종료는 `result.roundOver`/`roundEnd` 이벤트로 알려 주며 `endRound()` 는 로비가 호출한다.
- 죽은 플레이어에게 `beginTurn`/`fire` 는 `NOT_ALIVE` 오류를 낸다. `order` 배열의 사망자는 로비가 건너뛴다.
- `startRound()` 는 쇼핑 후 이자 지급을 포함한다. 첫 라운드 전 상점(initialCash)은 `startRound` 이전에 `buy` 로 처리한다.
- 컴퓨터 구매는 로비가 상점 단계에서 `aiShop(id)` 를 호출해야 한다(자동 호출 없음).
- 동기 모드 동시 발사는 `fireVolley` 로 한 번에 해결한다. 동시 모드는 `fire` 를 플레이어별로 호출한다. 엔진은 한 번의 호출 안에서 샷(폭발·흙 낙하·탱크 낙하·사망 폭발 연쇄)이 완전히 끝날 때까지 계산한다(비행 중 상태가 호출 사이에 남지 않음).
- 이벤트 tick 은 호출마다 0 에서 시작한다. 클라이언트는 결과를 받은 시점을 tick 0 으로 재생한다. 1 tick = 20 ms.
- 사람 플레이어에게 `tankType:'triple'` 을 주면 `classic` 으로 바뀐다. `fixed` 는 이동·연료 구매 불가.
- 알려진 한계·추정 값은 `docs/ENGINE_STATUS.md` 참조.


### 추가(2026-11-16 원본 대조)
- 탱크 view 에 `maxPower`(= hp*10) 포함. 낙하/폭발 피해로 hp 가 줄면 `hp` 이벤트(delta)와 shot `state.tanks[id]`의 `hp`·`maxPower`·(상한 초과 시) `power` 가 함께 온다. `power > hp*10` 인 fire 는 `BAD_POWER` 로 거부.
- `createGame({..., seed, rngSkip})`: rngSkip 만큼 난수를 버리고 시작(원본 대조 전용).
- 놀이장 경계가 화면 안쪽(x 3..w-4, y 24..h-4)이다. 지형 RLE 의 바깥 테두리는 항상 하늘(빈 칸). 표준 폭발 무기는 Tunneling(ON) 시 흙을 뚫고 들어가 속도가 줄면 그 자리에서 터진다(`terrain` 이벤트로 지워진 픽셀 전달).
