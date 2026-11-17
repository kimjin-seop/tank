# Scorched Earth v1.5 정적 리버스 엔지니어링 결과

- 대상: `_reference/scorch_original/SCORCH.EXE` (415,456바이트). **실행하지 않고 정적 분석만** 수행.
- 교차 검증: 같은 폴더 `SCORCH.DOC`(정규화본 `_reference/tools/scorch_doc_norm.txt`).
- 기계 판독용 테이블: `docs/scorch_data.json` (모든 이름·설명·메시지에 `name_en`/`name_ko` 쌍).
- 분석 도구: `_reference/tools/` (`exeimg.py`, `d16.py`, `show.py`, `xref.py`, `xcall.py`, `build_scorch_data.py` 등). Python은 `-I` 로 실행.
- 구현 코드는 포함하지 않는다. 의사코드는 동작 설명용.

## 0. 신뢰도 표기 규칙

| 표기 | 의미 |
|---|---|
| **확인됨(EXE)** | 디스어셈블리에서 직접 읽음. 위치를 `seg:off`(코드) 또는 `DS:xxxx`(데이터)로 병기 |
| **매뉴얼** | SCORCH.DOC 에만 근거 |
| **추정** | 코드 정황에서 유추, 직접 확인 못함 |
| **미상** | 확인하지 못함 |

주소 규칙: EXE 는 압축되지 않은 Borland C++ 1993(16비트 real mode, large model, 8087 에뮬레이션 INT 34h~3Dh)이며 LZEXE/PKLITE/DOS4G 모두 아님. MZ 헤더 0x6A00바이트, 이미지 오프셋 `img = file - 0x6A00`. 코드 세그먼트 `s:o` 의 파일 위치는 `0x6A00 + s*16 + o`. 데이터 세그먼트 DS=`0x4F38`(상대값), DS 오프셋 `o` 의 파일 위치는 `0x6A00 + 0x4F380 + o = 0x55D80 + o`.

---

## 1. 핵심 결론 (엔진 구현자용 요약)

1. **연산은 IEEE 754 double 부동소수점**(8087 코프로세서/에뮬레이터). 고정소수점이 아니다. 발사 초기 속도만 `(int)` 로 절단되어 정수다. `sin`/`cos` 는 RTL `fsin`/`fcos` (확인됨(EXE) seg0:1204/13d1).
2. **난수는 R250 시프트 레지스터**(시드 = `time()` 하위 16비트). 같은 시드로 서버/클라이언트가 같은 열을 낼 수 있다(§9).
3. 지형은 **높이 배열이 없고 비디오 메모리 픽셀**이다. 폭발 분화구는 반경 R 의 **꽉 찬 원판**, 흙 낙하는 **열 단위 1픽셀/프레임**(§6).
4. 시간 스케일(`FIRE_DELAY`×BogoMips)이 발사체 적분 간격에 영향을 주므로 **원본은 기계 속도에 따라 비트 단위로 달라질 수 있다**. 기본 분기(dt=0.02)를 정본으로 삼는 것을 권장(§3.3).

---

## 2. 실행 파일 구조 (확인됨(EXE))

- 압축/패킹 없음. 전용 DOS 확장기 없음. Fastgraph V4.02 그래픽 라이브러리 링크(세그 44e7/456b/4571/4589 부근).
- 호출 규약: far call(`9A off seg`), cdecl, 인자는 오른쪽부터 push.
- 주요 모듈(세그먼트): `1a4a` 발사/비행 시뮬, `12a5` 설정 로더, `223a` 레벨·바람·지형, `23a1` 메인/탱크 배치, `28b5` 플레이어 턴, `2a16` 탱크 처리, `3912`/`3191` 피해·방패, `3d1e`(=`3c70`) 표준 폭발, `162c`/`1a1e` 흙 낙하, `11b5`·`1276`·`1e50` AI, `2bf9` 난수·MTN 로더, `32c2` 하늘.
- 문자열: 한 개의 언어 테이블(DS:0x1F84, 289개 far 포인터)에 메뉴·무기 이름·메시지가 모여 있음(`~Language` 메뉴 기능). 전체는 JSON `language_table`.
- 등록판 전용 문자열만 존재(레코드 없음): Teleporter, Jump Jets, Popcorn Bomb, Dirt Tower, Plasma Laser, Warp/Teleport/Flicker Shield, Patriot Missiles, Sentient AI. 공유웨어 EXE 의 게임플레이에는 없음(추정).

---

## 3. 물리

### 3.1 발사 (확인됨(EXE) 1a4a:02f2 `Fire`, 호출 28b5:1219)

```c
// 탱크: x=tank+0x12, y=tank+0x14, angle=tank+0x92, facing=tank+0x94, power=tank+0x9e
a_deg  = (facing == 1) ? angle : 180 - angle;      // 0=오른쪽, 90=위, 180=왼쪽
a      = a_deg * 0.017453293;                      // DS:0x1d08 (double)
vx     = (int)(cos(a) * power);                    // 정수 절단 (seg0:14df)
vy     = (int)(sin(a) * power);
pos    = (x, y)                                    // 투사체는 이 정수 좌표를 double 로 변환해 시작
```

- 파워 범위 0..1000, 상한은 `에너지*10`(탱크 에너지 최대 100 → 파워 최대 1000). 라운드 시작 파워 200(확인됨(EXE) tank+0x9e).
- 각도 범위 0..180. 키: ↑↓ 파워 ±1, PgUp/PgDn ±15, ←→ 각도 ±1, Tab 무기 순환, Enter/Space 발사(확인됨(EXE) 28b5).
- 3연장 포탑(등록판)은 같은 코드에서 `×1.02`/`×0.98` 파워, 각 ±오프셋으로 추가 발사체 생성(1a4a:059a~06de). 공유웨어에서는 비활성(추정).

### 3.2 비행 한 스텝 (확인됨(EXE) 1a4a:0b1f 루프, 0c0d~0e64)

```c
// 발사체 레코드 0x6c바이트 @far ptr DS:0xceb8, 최대 100개
// +4 vx(double) +0xc vy(double) +0x14 x(double) +0x1c y(double)
s2 = vx*vx + vy*vy;
if (s2 > 1000000.0f) {            // DS:0x1d2c
    s = sqrt(s2) / 1000.0f;       // DS:0x1d30
    vx /= s;  vy /= s;            // 속도 상한 1000
}
x += vx * dt;                     // dt = DS:0xceac = 0.02
y -= vy * dt;                     // 화면 y 는 아래가 +, vy 는 위가 +
if (visc != 1.0) { vx *= visc; vy *= visc; }   // visc = DS:0x5178 = 1 - AIR_VISCOSITY/10000
vy -= gravStep;                   // DS:0xce9c = 50 * GRAVITY (기본 0.2 -> 10.0)
vx += windStep;                   // DS:0xcea4 = wind / 40   (wind = DS:0x515a, int)
```

- 갱신 순서: 위치 → 점성 → 중력 → 바람(오일러, 기존 속도로 위치를 먼저 갱신).
- 정수 좌표 = `(int)x, (int)y`(절단) 로 픽셀 충돌 판정(1a4a:0e75~0ec4).
- 충돌 = 해당 픽셀 색이 0x69 미만(흙 0x50~0x68 또는 탱크 <0x50), 화면 경계 처리는 §8.
- 환산: 기본값에서 중력 가속 500 px/s², 바람 가속 `wind×1.25` px/s².

### 3.3 시간 스케일 (확인됨(EXE) 1a4a:01c4) — 주의

```c
// 투사체 생성 시마다 호출
if (liveProjectiles == 0) return;
s = FIRE_DELAY * BogoMips / (liveProjectiles * 100.0);   // DS:0x5140, DS:0x1c86(long)
if (s > 0 && FAST_COMPUTERS(DS:0x50f0) == 0) {
    gravStep = 50*G / s;  windStep = wind / (40*s);  dt = 1 / (50*s);
} else { gravStep = 50*G;  windStep = wind/40;  dt = 0.02; }  // s==1 과 동일
```

- 두 분기는 같은 연속 궤적을 다른 간격으로 적분한다. 원본은 기계 속도/발사체 수에 따라 궤적이 미세하게 달라질 수 있다. 클라이언트-서버 일치를 위해 **정본 = 기본 분기(dt=0.02, 위 값)** 로 권장한다(정본 선택은 추정).
- BogoMips 실측값(기계별)은 미상.

### 3.4 설정 기본값/범위 (확인됨(EXE) 설정 로더 12a5, 매뉴얼과 일치)

| 항목 | 기본 | 범위 | DS |
|---|---|---|---|
| GRAVITY | 0.2 | 0.05~10 | 0x512A(double) |
| AIR_VISCOSITY | 0 | 0~20 | 0x5180 |
| MAX_WIND | 200 | 0~500 | 0x515C |
| EDGES_EXTEND | 75 | 0~10000 | 0x513E |
| FIRE_DELAY | 100 | 0~500 | 0x5140 |
| FALLING_DELAY | 10 | 0~1000 | 0x5116 |
| INTEREST_RATE | 0.05 | 0~0.30 | 0x5190 |
| INITIAL_CASH | 0 | 0~1,000,000 | 0x516A |
| SUSPEND_DIRT | 0 | 0~100 | 0x5158=100−값 |
| MTN_PERCENT | 20 | 0~100 | 0x5132 |
| LAND1(울퉁불퉁) / LAND2(경사) | 20 / 20 | 0~100 | 0x516E/0x5170 |
| TALK_PROBABILITY / TALK_DELAY | 100 / 18 | 0~100 | 0x511A/0x511C |
| MAXROUNDS | 10 | — | 0x5160 |

나머지(FLATLAND OFF, RANDOM_LAND OFF, HOSTILE ON, TANKS FALL ON, IMPACT DAMAGE ON, COMPUTERS_BUY ON, FREE_MARKET OFF, SCORING STANDARD 등)는 매뉴얼 표와 EXE 설정 키가 일치. 전체는 JSON `physics.defaults`.

---

## 4. 무기·방어구·아이템 표 (확인됨(EXE) DS:0x11F6 + 0x34×i, 48개)

레코드: `+0 이름 far ptr(런타임 채움) +4 가격 +6 묶음 +8 무장 등급(Arms) +0xA/+0xC 핸들러 far ptr +0xE 반경/매개변수 +0x14 런타임 반경(배율 적용)`.
가격·묶음·Arms 는 EXE 값이 SCORCH.DOC 표와 **전부 일치**하되 아래 한 건만 다르다: EXE 는 Liquid Dirt(묶음 5, Arms 2)·Dirt Charge(묶음 10, Arms 1), 매뉴얼은 반대로 표기(묶음 10/Arms 2, 묶음 5/Arms 1). 핸들러 정황상(Liquid Dirt = 네이팜 계열 핸들러) EXE 값을 신뢰.

반경 열은 레코드 매개변수(핸들러별 의미가 다름, §5). 단위는 픽셀, 360폭 이상 모드 NORMAL 기준(§5.1).

| id | 이름 | 가격 | 묶음 | Arms | 매개변수 | 핸들러 |
|---|---|---|---|---|---|---|
| 0 | Baby Missile | 400 | 10 | 0 | 10 | 3d1e:0021 |
| 1 | Missile | 1,875 | 5 | 0 | 20 | 3d1e:0021 |
| 2 | Baby Nuke | 10,000 | 3 | 0 | 40 | 3d1e:0021 |
| 3 | Nuke | 12,000 | 1 | 1 | 75 | 3d1e:0021 |
| 4 | LeapFrog | 10,000 | 2 | 3 | 3(단계) | 2382:0006 |
| 5 | Funky Bomb | 7,000 | 2 | 4 | 80(산포) | 1dce:0000 |
| 6 | MIRV | 10,000 | 3 | 2 | 0 | 25d5:0239 |
| 7 | Death's Head | 20,000 | 1 | 4 | 1 | 25d5:0239 |
| 8 | Napalm | 10,000 | 10 | 2 | 15 | 26e6:01a0 |
| 9 | Hot Napalm | 20,000 | 2 | 4 | 20 | 26e6:01a0 |
| 10 | Tracer | 10 | 20 | 0 | 0 | 3d1e:0002 |
| 11 | Smoke Tracer | 500 | 10 | 1 | 1 | 3d1e:0002 |
| 12 | Baby Roller | 5,000 | 10 | 2 | 10 | 2fbd:0003 |
| 13 | Roller | 6,000 | 5 | 2 | 20 | 2fbd:0003 |
| 14 | Heavy Roller | 6,750 | 2 | 3 | 45 | 2fbd:0003 |
| 15 | Riot Charge | 2,000 | 10 | 2 | 0 | 2f76:000d |
| 16 | Riot Blast | 5,000 | 5 | 3 | 1 | 2f76:000d |
| 17 | Riot Bomb | 5,000 | 5 | 3 | 30 | 2f76:03bd |
| 18 | Heavy Riot Bomb | 4,750 | 2 | 3 | 45 | 2f76:03bd |
| 19 | Baby Digger | 3,000 | 10 | 0 | −10 | 151b:000a |
| 20 | Digger | 2,500 | 5 | 0 | −20 | 151b:000a |
| 21 | Heavy Digger | 6,750 | 2 | 1 | −35 | 151b:000a |
| 22 | Baby Sandhog | 10,000 | 10 | 0 | 10 | 151b:000a |
| 23 | Sandhog | 16,750 | 5 | 0 | 20 | 151b:000a |
| 24 | Heavy Sandhog | 25,000 | 2 | 1 | 35 | 151b:000a |
| 25 | Dirt Clod | 5,000 | 10 | 0 | 20 | 15a0:0009 |
| 26 | Dirt Ball | 5,000 | 5 | 0 | 35 | 15a0:0009 |
| 27 | Ton of Dirt | 6,750 | 2 | 1 | 70 | 15a0:0009 |
| 28 | Liquid Dirt | 5,000 | 5* | 2* | −20 | 26e6:01a0 |
| 29 | Dirt Charge | 5,000 | 10* | 1* | 0 | 15a0:0081 |
| 30 | Earth Disrupter | 5,000 | 10 | 0 | 0 | 162c:013e |
| 31 | Plasma Blast | 9,000 | 5 | 3 | 0 | 2770:0009 |
| 32 | Laser | 5,000 | 5 | 2 | 0 | 2319:0004(빈 스텁) |
| 33 | Heat Guidance | 10,000 | 6 | 2 | – | 핸들러 없음 |
| 34 | Ballistic Guidance(`Bal Guidance`) | 10,000 | 2 | 2 | – | |
| 35 | Horz Guidance | 15,000 | 5 | 1 | – | |
| 36 | Vert Guidance | 20,000 | 5 | 1 | – | |
| 37 | Lazy Boy | 20,000 | 2 | 3 | – | |
| 38 | Parachute | 10,000 | 8 | 2 | – | |
| 39 | Battery | 5,000 | 10 | 2 | – | |
| 40 | Mag Deflector | 10,000 | 2 | 2 | – | |
| 41 | Shield | 20,000 | 3 | 3 | – | |
| 42 | Force Shield | 25,000 | 3 | 3 | – | |
| 43 | Heavy Shield | 30,000 | 2 | 4 | – | |
| 44 | Super Mag | 40,000 | 2 | 4 | – | |
| 45 | Auto Defense | 1,500 | 1 | 3 | – | |
| 46 | Fuel Tank | 10,000 | 10 | 3 | – | |
| 47 | Contact Trigger | 1,000 | 25 | 3 | – | |

`*` 매뉴얼과 불일치(위 설명). 매뉴얼의 "블라스트 반경" 열은 위 매개변수와 대응(예: Nuke 75, Dirt Ball 35). 매뉴얼 Plasma Blast "10-75"는 §5.8 공식(미사일 반경~핵 반경)과 일치(핵 반경 75).
무기 지급: Baby Missile 은 무한(인덱스 0 은 인벤토리 차감 안 함, 확인됨(EXE) 28b5:113a). 재고 상한 99(구매 시 초과분 환불). 최대 HP 100(DS:0x50E4).
방패·낙하산·배터리·연료·신관·자동방어 수치는 §7. 이름/설명 한국어는 JSON `items`.

---

## 5. 폭발과 지형 파괴 (확인됨(EXE))

### 5.1 반경과 EXPLOSION_SCALE (2400:0a71)

```c
// 320폭 모드: NORMAL 0.5, MEDIUM 0.75, LARGE 1.0
// 그 외(360x480 기본 등): NORMAL 1.0, MEDIUM 2.0, LARGE 3.0
rec[i].radiusRuntime = (int)(rec[i].param * S);   // 핸들러 3d1e:0021, 2fbd:0003, 2f76:03bd 만. 그 외는 param 그대로
```
MIRV/Death's Head/LeapFrog/Riot Charge·Blast/Funky 는 각 핸들러 내부에서 별도 배율 적용(Dirt 계열은 배율 없음).

### 5.2 표준 폭발 `explode(x,y,R)` (3d1e:015a = 3c70:0c3a)

```c
fireball_palette();               // DAC200..219 상승 붉은 램프, 220..239 하강 램프
if (R >= BabyNukeRadius && explosionBitmapCache) nuke_variant();    // 텍스처 불덩이(3c70:0ec3)
else {
  step = (R < 40) ? 1 : 2;
  for (r = 1; r <= R; r += step) {                  // 성장하는 불덩이
     tone((step & r) ? 100 : 200);
     disc(x, y, r, color = 0xDC - r*20/R, 새로 칠할 환형만);   // 색 범위 밖 픽셀만 칠함
  }
  if (R > 30) { 49회: 팔레트(200..239) 1칸 회전 + delay(5ms) + 톤(i%10==5→100Hz, i%10==0→200Hz); 이후 팔레트 0..24 검정, delay(20ms) }
}
carve_disc(x, y, R, skyPixel);                      // 분화구
mark_dirty_x(x-R-1, x+R+1);
for (tank in alive) {                               // 피해
  d = sqrt(dist2(x,y,tank));
  if (R > d) { pct = (int)((R-d)*100.0/R); dmg = pct * (weaponIndex+1); if (dmg > 100) dmg = 110; DamageTank(tank, dmg, 1); }
}
```
- **분화구 = 반경 R 인 꽉 찬 원판**: 정수 중점 원 알고리즘(반지름을 2배로 놓고 8방향 대칭 스캔라인, 3c70:09ca/984/886). 지름 2R+1. 원 안의 모든 픽셀(흙이든 아니든)을 하늘색으로 되돌림(콜백 32c2:1519).
- 피해 반경 = 분화구 반경, 선형 감쇠 `(R-d)/R`.
- **무기 인덱스 곱셈**(index+1)은 코드 그대로(아기 미사일 ×1, 미사일 ×2, 아기 핵 ×3, 핵 ×4, MIRV ×7, Death's Head ×8, 롤러 ×13~15). 100 초과 시 110 으로 고정.
- 직격: 방패 픽셀 직격은 폭발 없이 방패에만 10 피해(1000Hz 10ms). 탱크 본체 직격은 대상 에너지 전체 즉사 후 폭발.
- 화면 갱신은 지연 없이 CPU 속도(애니메이션 속도가 기계 의존). 팔레트 회전 5ms/20ms 지연만 명시.

### 5.3 흙 낙하(붕괴) (1a1e:0107 + 162c:0238)

```c
// 폭발 후 settle(): 탱크 낙하 처리 → (SUSPEND 확률) → 흙 낙하
if (SUSPEND_DIRT == 0) fall = true;
else fall = (flag50ec == 0 && rand(100) < 100 - SUSPEND_DIRT);   // 턴당 최대 1회, 턴 시작에 flag 해제
if (fall) { dirtFall(); tanksSettle(); }

dirtFall():
  dirtyRange = [minX-5, maxX+5] 클립
  for each column x in range: 찾기 = "아래가 하늘인 흙 덩어리(흙 0x50..0x68 연속 구간, 바로 아래 >=0x69)"
     -> col.top = 덩어리 첫 y, col.bot = 아래 첫 하늘 y
  while (활성 열 > 0) {
     refresh();
     for each active column:
        erase(x, col.top++)                       // 맨 위 흙 픽셀을 하늘색으로
        putDirt(x, col.bot)                       // 맨 아래 하늘 칸에 새 흙 1픽셀 (색 = 흙 색 목록[rand(N)])
        col.bot++ while 아래도 흙
        착지하면 재탐색, 더 떠 있는 덩어리가 없으면 열 제거
  }
```
- 모든 열이 **병렬로 1픽셀/프레임**. 덩어리가 통째로 아래로 이동(맨 위 픽셀 제거+맨 아래 픽셀 추가). 모래가 옆으로 흘러내리는 알고리즘은 **없음**(수직 낙하만) — 구현 시 중요.
- 낙하 후 살아 있는 탱크에 낙하 피해 검사(162c:029f → 3191:06ca).
- Earth Disrupter(162c:013e): 흙 기본색(DAC 0x50) 100프레임 점멸 후 SUSPEND 무시하고 즉시 낙하.

### 5.4 MIRV / Death's Head / LeapFrog / Funky Bomb

- **MIRV/DH 분리**: 발사체에 "정점 판정 함수"(3bac:0000)가 달림 — `vy < 0` 이 되는 첫 스텝이 정점. 분리 25d5:041b:
  - N = 5(MIRV)/9(DH), 간격 S = 50/20, 반경 20/35(×EXPLOSION_SCALE).
  - `child.vx = parent.vx + S*(k - (N+1)/2)`, vy 동일, k=0..N-1 중 `k==(N+1)/2` 는 부모 자신.
  - MIRV vx 오프셋: −150,−100,−50,(부모),+50 → 4발+부모. DH: −100…−20(20 간격),(부모),+20,+40,+60 → 8발+부모. 분리 시 100Hz 15ms.
  - 정점 전에 충돌한 탄두는 불발. 각 탄두는 불덩이만 그리고 충돌점을 기록, 전부 끝나면 기록 지점마다 **모든 탱크에 피해 합산**(공식 §5.2) 후 분화구를 각각 판다.
- **LeapFrog** 2382:0006: 단계 di=2→1→0, 폭발 반경 {30,25,20}×S, 각 도약은 `속도 = 이전속도/1.5`, 같은 발사각으로 재발사(sin/cos 성분 대응은 추정).
- **Funky Bomb** 1dce:0000: 조각 `rand(6)+5`(5~10), 각 조각 착지 x = `x+rand(160)-80`, 반경 `(rand(10)+15)*S`, 색 `0xAA+(i%5)*12`, 피해 `(r-d)*100/r`(무기 곱 없음). 조각 경로 1dce:05df 는 추정.

### 5.5 롤러 (2fbd:0003)
탱크 직격이면 즉시 폭발. 아니면 충돌점에서 방향을 정한 뒤(vx 부호, 양쪽 경사 스캔으로 내리막 우선) 새 발사체를 만들고 스텝 콜백 2fbd:027b: 누적 `acc += dt*50`, `acc>1` 마다 1픽셀 — 아래가 하늘이면 낙하, 아니면 옆으로 이동, 앞 칸이 비하늘(<0x69)이면 직전 칸에서 `explode(R, fall=1)`. 벽: None 이면 소멸/폭발, Wrap 이면 반대편, 그 외 반사(1000Hz 20ms).

### 5.6 라이엇/굴착/흙 무기
- Riot Charge/Blast(2f76:000d): 반경 36/60×S, 반각 45/60°, 포탑 방향 중심 부채꼴(0.3rad 간격 호)을 0xFE 로 그린 뒤 하늘로 지움. 피해 없음. Riot Bomb/Heavy(2f76:03bd): 반경 30/45×S 전각 구형 제거, 피해 없음.
- Digger/Sandhog(151b:000a): 충돌 픽셀이 흙일 때만 작동. 분기 무작위 보행 "벌레"(최대 20마리, 8방향, 프레임당 1px)가 흙만 지나며 지움, 프레임당 1/3 확률로 양옆 2칸 추가 제거(폭 3). 8프레임마다 임의 벌레에서 분기. 예산 Digger 20/40/70, Sandhog 10/20/35. Sandhog 벌레는 죽는 자리에서 반경 10×S 폭발(일반 피해식). Sandhog 는 20스텝 방향 유지, Digger 는 매 스텝 무작위.
- Dirt Clod/Ball/Ton(15a0:0009): 반경 1..R−1 원판을 색 0x50 으로(이미 흙인 픽셀 제외) 칠함, 피해 없음, 이후 흙 낙하·탱크 낙하. 반경 배율 없음.
- Dirt Charge(15a0:0081): 불꽃 50프레임 후 쐐기 영역에 무작위 흙 색으로 채움(기하는 추정).

### 5.7 네이팜/액체 흙 (26e6:01a0)
입자 연결 리스트(최대 100슬롯, y,x 정렬)로 액체가 흐름: 아래가 비면 아래, 아니면 좌우(둘 다 비면 바람 부호 방향), 막히면 위로 쌓임. 기록점(20픽셀마다)이 매개변수 p(15/20)개가 될 때까지 최대 1000회. 네이팜 피해(기록점마다 모든 탱크): Hot(p>15) `d<40 → 50−d`, Napalm `d<25 → 30−d`, 무기 곱 없음. Liquid Dirt 는 색 0x50 으로 칠하고 끝(피해 없음).

### 5.8 Plasma Blast / Laser
- Plasma Blast(2770:0009): 배터리 n(≤10) 소모, `R = Rmissile + (Rnuke−Rmissile)*n/10`(미사일/핵 런타임 반경), **발사 탱크 중심**. 발사자 제외 모든 탱크에 `(int)((R-d)*100/R)+80`(100 초과 시 110). 배터리 0 이면 미사일 반경.
- Laser: 핸들러는 빈 스텁, 빔 코드 2319:0016/00d8/01fe(미상). 피해는 단계마다 `min(p,10)`, `p−=50`, 방패 우선(확인됨(EXE) 2319).

### 5.9 사운드(PC 스피커만, 확인됨(EXE))
`sound(Hz)`=0000:a281(분주 0x1234DD/Hz), `nosound`=a2b1, `delay(ms)`=9af6, `tone(Hz,ms)`=4571:0007. 사운드 모드 DS:0xEF46==1 일 때만. 별도 사운드 ID 없이 주파수 직접 지정:

| 사건 | 주파수/지속 |
|---|---|
| 폭발 성장 | 100/200Hz 교대(R>30 후반부 100Hz(i%10==5), 200Hz(i%10==0), 5ms) |
| 예광탄 | 200Hz 30ms |
| 방패 직격 | 1000Hz 10ms |
| 굴착기 불발 | 200Hz 40ms |
| MIRV 분리 | 100Hz 15ms |
| 롤러 반사 | 1000Hz 20ms |
| 라이엇 | r×1000Hz 10ms |
| 흙 무기 | ((si%5)+1)×100Hz 10ms |
| 네이팜 | rand(50)Hz |
| 대지 교란기 | 1000+rand(100)×100Hz |
| 펑키 | rand(3000)Hz |
| 탱크 파괴 | 6000Hz에서 100씩 하강 ×50(20ms) 후 1000Hz 10ms |

---

## 6. 피해·방어·낙하 (확인됨(EXE))

- 탱크 최대/시작 에너지 100(DS:0x50E4). 파이프라인: `DamageTank 3912:04b2 → ShieldAbsorb 3191:0034 → ApplyHealth 2a16:0fe8`. 방패는 HP 풀이며 초과분이 1:1 로 본체로 관통.
- 방패(DS:0x616C): Mag Deflector 55(flag 2), Shield 100, Force Shield 100(flag 1: 투사체 반사, 방패 HP −= int(속도/100)), Heavy Shield 150, Super Mag 200(flag 4). 활성화 시 아이템 1개 소모+방패 HP 만땅, 라운드 시작마다 0. 자기력 법칙·Heavy Shield 특수 면역·Super Mag 레이저 면역은 코드 미확인(매뉴얼만).
- 낙하(FALLING_TANKS): 2 피해/픽셀(DS:0x5164). 낙하산은 예상 피해(2×픽셀)가 임계값(기본 5, 0=항상)보다 크면 전개하고 소모. 낙하산 전개 중 `|wind|>10 && rand(100)<|wind|` 이면 바람 쪽 이동. 탱크 위로 낙하: 피격 탱크 `acc+50`, 낙하자 `acc/2+10`(확인됨(EXE) 1975).
- 배터리 +10 HP(에너지 100 이상이면 거부), AI 는 에너지<85 에서 사용. 연료 탱크 10단위(매뉴얼), 이동 1픽셀당 1(오르막 더 소모, 세부 추정). Auto Defense 가격 `P×Σ_{k=0..n}(1+r)^−k`, n=MAXROUNDS−진행라운드−1, P=1500.
- 미상: 접촉 신관 소모 규칙, Lazy Boy·유도 장치(열/탄도/수평/수직) 조향식, 자기 편향기의 힘 법칙(발사체 루프 1a4a 내부, 미분석).

---

## 7. 경제·점수 (확인됨(EXE) 3098, 1089, 0dbc, 24e0)

- 이자: `cash*int(rate*10000)/10000`(정수 절단), 쇼핑 단계 후 라운드마다. 기본 5%, 최대 30%.
- 구매: 현재가로 묶음 단위, 재고 상한 99(초과분 환불+20% 가산). 판매: 정가 80%(FREE_MARKET 65%).
- 자유 시장 24e0:035e: `A=0.7A+0.3*D/N; r=cur/base; S=0.7S+0.03*r²; cur=int(cur*(1+(A−S)*rate))`, 가격이 base×[0.1,100] 밖이면 초기화. `SCORCH.MKT`: int16 버전=2, int16 개수=48, 48×(int32 가격, int16 휴지, double S, double A)=1060바이트.
- 점수 = 현금과 함께 변동. 적에게 HP 피해 +30/포인트, 방패 피해 +2/포인트, 팀킬 HP −15/포인트. 처치 +500(BASIC +4000), 팀킬 −2000, 자살 −1500. 라운드 승리 5000(BASIC 인원수×1000). 생존자 풀: 비 BASIC `5000+500n+Σ(30·에너지+2·방패)`, BASIC `인원수×1000+n×4000`, 생존자 균등 분배.
- 컴퓨터 구매: 현금 ≥ 50,000 이면 Heavy Shield → Force Shield → Shield → Parachute → Baby Nuke/Missile(재고<5) → Battery(<8). Moron 은 가중 무작위(DS:0x52AE 가중치).
- 미상: 팀 보너스 분배, GREEDY 순자산 순위 코드.

---

## 8. 월드: 화면·지형·바람·하늘·벽·팔레트

### 8.1 해상도·좌표계 (확인됨(EXE) 3ea1, 223a:02bd)
- 기본 그래픽 모드 인덱스 4 = **360×480×256**(unchained VGA), 선택지 9개(320x200, 320x240, 320x400, 320x480, 360x480, 640x400, 640x480, 800x600, 1024x768). 픽셀 종횡비 360x480 = 0.55, 320x400/480 = 0.5, 그 외 1.0.
- 경기장 경계 변수 LEFT=DS:EF42, TOP=EF40, RIGHT=EF3C, BOTTOM=EF38(경계 포함, 원점 좌상단, y 아래 +). HUD 뒤 `LEFT+3, RIGHT−3, BOTTOM−3, TOP=rows*14+…` + 3픽셀 테두리.
- 픽셀 색 규칙: 0x00~0x4F 탱크(탱크 n 은 n×8~n×8+7), **0x50~0x68 흙(고체)**, 0x69 이상 하늘/기타.

### 8.2 지형 생성 (확인됨(EXE) 223a:0a68, 223a:04de)
```c
slope = 0;  y = rand(bottom - top - 60) + top + 40;
x = (dir == +1) ? left : right;            // dir 은 라운드마다 반전
do {
  drawColumn(x, y);                        // 위 하늘, 아래 흙색 0x50
  if (rand(100) < LAND1) {                 // 울퉁불퉁
     d = rand(3) - 1;
     if (rand(100) < LAND2) d *= 2;        // 경사
     slope += d;
     if (FLATLAND && (slope < -3 || slope > 3)) slope = 0;
  }
  y += slope;
  if (y < top+40)   { y = top+40; if (slope < 0) slope = 1; }
  if (y > bottom-1) { y = bottom-1; if (slope > 0) slope = 0; }
  x += dir;
} while (x 가 범위 안);
```
- 동굴 하늘(CAVERN)은 두 번 실행(바닥/천장). RANDOM_LAND 는 라운드 시작에 `FLATLAND=rand(2), LAND1=rand(100), LAND2=rand(100)`.
- 흙 색: 6가지 중 `rand(6)`(6비트 RGB): (38,25,17), (54,36,28), (53,53,47), (20,62,20), (9,35,9), (36,54,28).
- **미해결**: LAND1/LAND2/FLATLAND 설정값이 생성기 객체(+0xA/+0xC/+0xE, 생성자에서 20/20/0)로 복사되는 경로를 코드에서 못 찾음. 의미는 매뉴얼 기준(추정).
- 스캔 산(*.MTN): `sky!=CAVERN && frand()*100 <= MTN_PERCENT` 이고 파일이 있으면 사용. 파일 선택 `rand(n)`, 포맷 `MT BE EF`, +6 폭, +8 트림, +0xA 높이, +0xC 색수(16), +0x10 기준색, +0x12 흙색 마스크, +0x18 16×RGB(8비트, >>2 → DAC 0x58+i), 열마다 `u16 h + ceil(h/2)`바이트(하위 니블 먼저, 아래→위). 10개 파일 전부 EOF 까지 정확히 파싱 확인. 화면보다 넓으면 무작위 창, 좁으면 거울 타일링. 로더 2bf9:04b4.

### 8.3 탱크 배치 (확인됨(EXE) 23a1:0a43)
`slot=(right-left+1)/N`, `x_i = left + slot/2 + i*slot`(무작위는 순서 셔플만). y 는 탱크 폭 아래 가장 낮은 지면 높이에 맞춰 평탄 패드(위쪽 흙 제거). 초기 포탑 각 = `atan2(y-top, W/2-x)`를 도로(인수 순서 추정).

### 8.4 바람 (확인됨(EXE) 223a:069a, 223a:00f9)
```c
wind = rand(MAX_WIND/2) - MAX_WIND/4;
if (rand(100) < 20) { wind *= 2; if (rand(100) < 40) wind *= 2; }
// CHANGING_WIND: 매 턴 시작 wind += rand(11) - 5; wind = clamp(wind, -MAX_WIND, +MAX_WIND)
```
MAX_WIND=0 이면 바람 0. 표시는 "Wind: %d" + 화살촉, 0 이면 "No Wind".

### 8.5 벽(Effect of Walls, 1a4a:1349) (확인됨(EXE))
값: 0 None, 1 Wrap, 2 Padded, 3 Rubber, 4 Spring, 5 Concrete, 6 Random(라운드당 rand(6)), 7 Erratic(발사마다 rand(6)). 반사 계수: Padded −0.5, Rubber −1.0, Spring −2.0(속도 성분 곱). 6회 반사 후 추가 감쇠 ×0.8 누적. None: EDGES_EXTEND 픽셀 밖까지 추적, Concrete: 닿으면 폭발, Wrap: 반대편 x. 프레임 색(DAC 0x9D): None 회색 (50,50,50), Wrap 노랑 (63,63,23), Padded 초록 (23,63,23), Rubber 마젠타 (63,23,63), Spring 청록 (23,63,63), Concrete 흰색 (63,63,63).

### 8.6 하늘 (32c2:00ff) (확인됨(EXE), 별/구름 세부는 부분 해독)
PLAIN(9,9,31), SHADED `(29-i,29-i,63)`, STARS 바탕 (5,5,10)+별 램프, STORMY 구름+번개, SUNSET 해 (63,63,0)+3밴드, CAVERN 지형색×(i+8)/45, BLACK 전부 0. RANDOM = `rand(6)`(BLACK 제외). 번개(STORMY, HOSTILE ON): 매 턴 `rand(4)==1` 이면 번개(탱크 피격 시 10 피해), 아니면 `rand(2)==0` 섬광.

### 8.7 팔레트 (VGA DAC 6비트 0~63)
부팅 목록: 0x98 (0,0,0), 0x50 (20,63,20), 0x9E (5,5,5), 0x9C (15,15,15), 0x99 (30,30,30), 0x97 (45,45,45), 0x9F (55,55,55), 0x9B (63,63,63), 0x78 (9,9,31), 0x9A (40,40,63), 0x57 (40,40,63), 0x96 (50,50,50), 0x9D (50,50,50), 0xA1 (10,63,63). 플레이어 색(DAC 0x6E~0x77, DS:0x57E2): (63,10,10), (35,55,10), (40,20,63), (63,63,10), (10,63,63), (63,10,63), (60,60,60), (63,40,20), (20,63,40), (0,0,63). 폭발 불꽃 DAC 200~239: 0~19 `R=i*63/19`, 20~39 `R=(19-i)*63/19`(G=B=0). 탱크 색 램프(0x00~0x4F)와 일부 폭발 색은 미상. 인덱스 의미 지도는 JSON `palette_6bit_rgb.index_map`.
탱크 스프라이트 형태·크기: **미상**(탱크 반폭은 탱크 레코드 +8 에서 읽음, 값은 미확인).

---

## 9. 난수 (확인됨(EXE) 2bf9)

```c
// 게임용 R250: w[250] @DS:0xEA12, idx @DS:0xEC06
uint16 r250() { j = (idx < 147) ? idx+103 : idx-147; w[idx] ^= w[j]; v = w[idx]; idx = (idx >= 249) ? 0 : idx+1; return v; }
int    rand_n(n)  = (n == 0) ? 0 : r250() % n;        // 2bf9:048b
double frand()    = r250() / 65535.0;                  // 2bf9:00f7, [0,1] 포함
void   init(seed16) { srand_borland(seed16); idx=0;
   for k<250: w[k] = borland_rand();                   // 15비트
   for k<250: if (borland_rand() > 0x4000) w[k] |= 0x8000;
   m=0xFFFF; b=0x8000; for i<16 { j=11*i+3; w[j]=(w[j]&m)|b; m>>=1; b>>=1; } }
// Borland LCG: seed = seed*0x015A4E35 + 1 (32bit); rand = (seed>>16)&0x7FFF   (seg0:1FA5)
```
시드 = `time(NULL)` 하위 16비트(23a1:01d1). 같은 시드는 같은 열을 만든다(서버가 시드를 클라이언트에 전달하면 동기 가능). 분석 에이전트 클론으로 seed=0 의 `rand(100)` 앞 10개: 11 77 10 77 75 81 99 14 85 2 — **실제 게임 대조 검증 안 됨(추정)**. 가중 무작위 2bf9:0165 와 스피커 노이즈 4571:0085 는 Borland rand 사용.

---

## 10. AI (확인됨(EXE), 매뉴얼 교차)

유형(탱크 +0x22): 0 사람, 1 Moron, 2 Shooter, 3 Poolshark, 4 Tosser, 5 Chooser, 6 Spoiler, 7 Cyborg, 8 Unknown(`rand(7)+1`로 숨김). "Sentient"는 문자열만(미사용). 유형별 16바이트 레코드 DS:0x272+16×(t−1)(이름, 구매/턴/피드백 함수).

- **턴 구동**(11b5:0007): 에너지<85 이면 배터리 사용 → 유형별 턴 함수 → 파워를 `[0, 에너지×10]`, 각도 `[0,180]`로 clamp → 최고 방패/낙하산 자동 활성 → 파워 ≤15씩, 각 ±1씩 애니메이션(10ms 지연, FAST_COMPUTERS 면 즉시) → 무기 순환 → 발사 → 피드백.
- **탄도 풀이기**(1e50:05e9): 바람 `a=wind/2000`, 중력 `g=0.2`(설정값). 바람 있으면 좌표계를 `atan(a/g)`만큼 회전, `g_eff=√(g²+a²)`. `v² = g_eff·dx'² / (2cos²θ'·(dx'·tanθ' − dy'))`, **파워 = √v² × 50**. 풀 수 없으면 −1(도달 불가)/−2(각 퇴화). **공기 점성 항 없음**(매뉴얼과 일치).
- Moron: 파워 `(rand(에너지)+1)×10`, 각 `rand(181)`(적 없는 쪽 제외), 가중 무작위 무기. Shooter: 시선이 깨끗한 가장 가까운(|dx|) 적, `atan2` 시작 각 후 풀이, 없으면 Tosser 로 위임. Poolshark: 벽이 고무/스프링일 때만 천장 반사 조준, 아니면 Shooter. Tosser: 각 `rand(70)+10`, 이전 착탄과 비교해 파워 ±10 보정. Chooser: 시선 있음→Shooter, 고무/스프링→Poolshark, 그 외 Spoiler. Spoiler: 해석해로 정확히 풀이, 시작 각 65/115, 불가 시 재목표. Cyborg: Shooter 우선, 아니면 `피격수/(…)+…−방패−3×가림` 점수로 목표 선정, 가림 탱크가 있으면 그것을 사격.
- 무기 선택(11b5:0abc), 구매(11b5:05f7, §7). 연료 이동·유도 장치 사용 증거 없음(미상).
- 말하는 탱크(1144): 공격 대사 `talk1.cfg`(54줄)·사망 대사 `talk2.cfg`(60줄), 확률 TALK_PROBABILITY, 지연 TALK_DELAY, 탱크 위 말풍선(y=tank.y−19). 미등록판은 컴퓨터가 사람을 노릴 때 `rand(100)==2` 로 공유웨어 문구 11종(JSON `messages`). 전체 대사 en/ko 쌍은 JSON `talk`.
- 기본 플레이어 이름 67개(DS:0x53AE 포인터 표, 무작위 `rand(0x43)`), JSON `tank_default_names`.
- 미상: 팀 로직, 플레이어 순서(패자/승자 먼저/라운드 로빈) 정렬, Shooter 가 풀이 파워를 저장하는 위치, Poolshark 피드백.

---

## 11. 미상·미해결 목록

1. 탱크 스프라이트(몸체/포탑) 비트맵과 정확한 크기, 탱크 색 램프(DAC 0x00~0x4F), 일부 폭발 색.
2. 유도 장치(열/탄도/수평/수직/Lazy Boy) 조향식, 접촉 신관 소비, 자기 편향기 힘 법칙, Heavy Shield·Super Mag 특수 면역 — 비행 루프 1a4a 내부(충돌부 ~1500~1730) 미분석.
3. 레이저 빔 코드(2319:0016/00d8/01fe), 펑키 조각 경로(1dce:05df), 흙 장약 쐐기 기하.
4. LAND1/LAND2/FLATLAND → 생성기 객체 전달 경로.
5. 팀 점수 분배, GREEDY 순위, 플레이어 순서 정렬 분기.
6. FIRE_DELAY·BogoMips 기반 시간 스케일의 실제 값(기계 의존).
7. 3연장 포탑·등록판 전용 아이템 동작(공유웨어 EXE 에 레코드 없음).
8. 분석 에이전트가 만든 R250 파이썬 클론은 실제 게임 출력과 대조하지 못함.

## 12. 매뉴얼과의 교차 검증 요약

- 무기·액세서리 표 48개 가격/묶음/Arms: EXE 와 일치(예외 Liquid Dirt/Dirt Charge 한 쌍만 열이 뒤바뀜).
- 설정 범위·기본값(중력 .2, 점성 0~20, 최대 바람 200/0~500, 이자 .05/0~.30, 발사 지연 100/0~500, 낙하 지연 10/0~1000, 경계 확장 75, 산 비율 20 등): EXE 클램프/기본값과 일치.
- 매뉴얼 전용(코드 미확인): 방패별 효과 설명, Contact Trigger·유도 장치 사용법, 연료 단위 상세.
- 번역 노트: JSON 의 `name_ko`/`ko` 는 원문(`name_en`/`en`)의 의역이다. 메뉴 단축키 `~` 표기는 `name_en` 에만 남기고 `name_ko` 에서는 제거했다.
