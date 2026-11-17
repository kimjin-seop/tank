# 무기·탄·폭발 연출 스펙

연출만 다룬다. 지형 파괴 반경·피해·궤도는 엔진 결과를 그대로 받는다. 모든 수치는 `assets/fx/effects.json`이 기준이며 이 문서는 읽는 법과 요약이다. `assets/tanks/preview.html` 7·8절이 이 파라미터로 그린 참조 구현(`runFx`)이다.

## 1. 단위·공통 규칙
- 길이 game px, 시간 s, 각도 deg(0=오른쪽, 90=위), 속도 px/s, 중력 px/s²(+아래, −는 상승).
- `r` = 엔진이 준 폭발 반경(Scale 적용 후). 레이어 크기는 `r` 배수.
- `scaleWithR: true`면 속도 × sqrt(r/20).
- `count`는 식 문자열 가능(`"10 + r*0.8"`), `size`의 `"0.3r"` = 0.3·r.
- `colors`: 수명에 걸쳐 균등 보간. `alpha` 생략 시 수명 70%부터 선형 소멸.
- `blend: lighter` = `globalCompositeOperation='lighter'`(가산). 밝은 하늘에서 큰 가산 입자는 흰색으로 뭉개지므로 불꽃 몸통은 normal, 심만 가산.
- `soft: true` = 원판 대신 방사 그라데이션(중심 색 → 가장자리 0).
- 토큰: `$player` 쏜 사람 색, `$terrainRim`/`$terrainLayer0~2` 현재 하늘의 지형 색, `$shieldRim`/`$shieldCore`, `$wall`.
- 난수는 샷 id 시드 → 재접속·리플레이 시 같은 그림.
- 상한 입자 1500. 저사양: 입자 ×0.4, 흔들림·열 왜곡·연기 기둥 끔. reduced-motion: 흔들림 0, 섬광 ×0.35.

## 2. 레이어 타입
| type | 파라미터 | 그리기 |
|---|---|---|
| flash | r, color, alpha[2], t[2] | 방사 그라데이션 원, t 구간 alpha 보간 |
| screenFlash | color, alpha, t | 화면 전체 사각 |
| fireball | r[3], t[3], stops, alpha[3] | 반경 키프레임 3개(팽창→최대→수축), 방사 그라데이션 |
| ring | r[2], t[2], w[2], color, alpha | 충격파 원 테두리 |
| particles | count, spawn, angle, speed, life, gravity, drag, size, colors, alpha, blend, delay, stretch, soft | 매 프레임 v+=g·dt, v*=exp(−drag·dt). stretch>0이면 속도 방향 선분 |
| arcs | count, segments, jitter, core, glow, w, glowW, life, regenHz | 중심→대상 지그재그 선, glow 굵게 후 core 얇게, regenHz로 모양 재생성 |

spawn: `point` 중심, `disc k` 반경 k·r 위쪽 반원, `rim k` 반경 k·r 위쪽 호, `column` 폭 0.5r·높이 1.4r 기둥, `ellipse` 버섯 갓(높이 −1.4r).

## 3. 탄(projectiles)
| 키 | 대상 | 모양 | 꼬리 |
|---|---|---|---|
| missile | 미사일류, MIRV, Death's Head, Leap Frog, Funky | 흰 심 캡슐 3×1.6, 자기 색 글로우 3 | 자기 색 리본 0.35s, 가산 |
| nuke | Baby Nuke, Nuke | 연노랑 캡슐 4×2.2, 주황 글로우 4Hz 맥동 | 주황 리본 0.5s |
| napalm | Napalm, Hot Napalm | 주황 덩어리, 깜빡임 | 불씨 입자 60/s 상승 |
| roller | Roller 3종 | 강철 공 + 자기 색 줄무늬, 회전각 = 이동거리/r | 구를 때 불티 8/s |
| digger | Digger·Sandhog류 | 드릴 탄, 자기 색 글로우 | 짧은 리본 |
| dirt | 흙 무기 | 지형 림 색 덩어리 + 외곽선 | 흙 부스러기 |
| tracer / smokeTracer | Tracer / Smoke Tracer | 자기 색 점 | 점선 1.2s / 영구 연기(화면 지우기까지) |

Bomb Icon: INVISIBLE=몸체 없음, SMALL=×0.6, BIG=×1.
Trace Paths: 자기 색 1.2px, alpha 0.75, glow 6px, 라운드 끝까지 유지.

## 4. 폭발 요약
| 키 | 대상 | 구성 | 길이 | 흔들림 |
|---|---|---|---|---|
| blast | 미사일·롤러·MIRV·Sandhog 탄두 | 섬광 → 화구(흰→노랑→주황) → 충격파 링 → 불티 → 연기(soft) → 흙 파편 | 0.7s | min(6, r/12)px 0.25s |
| nuke | Baby Nuke, Nuke | 화면 섬광 0.65 → 대형 화구 1.1s → 링 2개(2.4r) → 불티 → 연기 기둥 + 버섯 갓 | 2.2s | 8px 0.6s |
| funky | Funky Bomb | blast 자식들을 6색(#FF3BD4 #3BFFD9 #FFE53B #7A3BFF #3BFF6E #FF7A3B)으로 0.07s 간격. 위치·개수는 엔진 | — | 자식별 |
| napalm | Napalm, Hot | 튀김 입자 → 엔진이 준 연소 셀마다 불꽃(4+heat·10 /s, 상승, 좌우 흔들림) + 바닥 글로우 + 연기. Hot은 흰 청색 심, 발생 ×1.4 | 연소 동안 | 없음 |
| riot | Riot Charge/Blast/Bomb | 흙먼지 구름(불 없음), Charge·Blast는 포신 방향 ±36°/±60° 쐐기 | 0.9s | 없음 |
| dirtAdd | Dirt Clod/Ball/Ton | 지형 색 링 + 흙덩이, 새 흙 0.15s 페이드 인 | 0.5s | 없음 |
| liquidDirt / dirtCharge | Liquid Dirt / Dirt Charge | 흐름 앞면 광택·방울 / 포신 방향 ±25° 흙 분출 | — | 없음 |
| tunnel | Digger·Sandhog류 | 진입 흙먼지 → 지하 탄두 글로우+부스러기 → 터널 벽 어둡게, 0.5s 주황 테두리. 탱크 직격 불발은 회색 연기 | — | 없음 |
| laser | Laser | 엔진 광선 경로에 자기 색 글로우 3px + 흰 심 1.2px, 30Hz 깜빡임, 0.45s. 맞은 점마다 불티, 그을림 선 0.8s. 초자력에 막히면 방어막 테두리에서 끝 | 0.45s | 없음 |
| plasma | Plasma Blast | 시안→보라 구체, 흰 링, 대상까지 전기 아크(20Hz 재생성), 반경은 엔진(배터리 수) | 0.6s | 3px |
| lightning | 적대 환경 | 하늘 위→타격점 지그재그 번개(가지 30%, 재타격 2회) + 화면 섬광 #CFE6FF | 0.25s | 4px |
| tankDeath | 탱크 파괴 | blast → 0.1s에 잔해 스프라이트로 교체 → 연기 3s + 불씨 | 3s | blast 기준 |
| mirvSplit | MIRV 분리 | 정점 섬광 4px, 자식은 missile 꼬리 | 0.1s | 없음 |
| landingDust | 탱크 낙하 착지 | 좌우 흙먼지 | 0.6s | 없음 |

분화구 테두리: 폭발 후 새 표면 림을 주황 가산선으로 1.2s(핵 2s) 식혀 감.

## 5. 방어막 히트
| 종류 | 공통 | 고유 |
|---|---|---|
| 방어막 | 맞은 각도 중심 70° 호가 밝아짐(0.3s) | 하늘색 불티 6 |
| 역장 | | 육각 격자 섬광 0.25s + 링이 1.25배로 밀려나는 맥동(튕김 표현) |
| 중장갑 | | 금속 불티 10(중력), 맞은 쪽 이음매 0.2s 밝아짐 |
| 초자력 | | 테두리 전기 아크 3개 + 테두리 따라 도는 분홍·보라 입자(빗나감 표현) |
| 파괴 | | 방어막 색 삼각 파편 12개, 회전·낙하 |

방어막 상시 표시: alpha = 0.35 + 0.65·남은 비율, 25% 미만 6Hz 깜빡임.

## 6. 벽
좌우 2px 막대 + 외광. 맞을 때 흰색+벽 색 불티 6개. WRAP은 넘어가는 0.1s 동안 양쪽 끝에 탄을 함께 그림.

## 7. 탱크 사망 연출 변종 (설계, 엔진 스키마 확정 전)
- 입력: 엔진 `explode {kind:'death', r, ...}` 의 변종 필드. 필드명 미확정(박백엔 원본 분석 중) — 클라이언트는 `e.variant` → `e.deathKind` 순으로 읽고 없으면 `fireball`.
- 구현: `public/js/game/fx.js` 의 `DEATH_VARIANTS`(변종 ID → 연출 함수) 맵. `FxSystem.tankDeathBlast(x, y, r, seed, variant)` 가 호출. 모르는 ID 는 `fireball`.
- 반경 r 은 엔진 값 그대로(월드 기준, 가로로 넓게 보임). 입자는 화면 기준 정상 비율.
- 데이터 덮어쓰기: `assets/fx/effects.json` 의 `explosions.tankDeathVariants.<id>` 객체가 있으면 함수의 cfg 로 전달(예: `scale`, `flash`, `ring`, `count`, `bursts`).
- 사망 시점(`death` 이벤트)에는 잔해 스프라이트 교체 + 연기 3s·불씨만, 폭발은 뒤따르는 `explode kind:'death'` 가 담당.

| ID | 연출 | 흔들림 | cfg |
|---|---|---|---|
| fireball | blast(r) + 섬광 1.6r + 충격파 링 0.2→2.2r(0.5s) | min(8, 2+r/8), 0.45s | scale, flash, ring |
| dirtSpout | 작은 섬광 + 지형색 흙 입자 기둥(위로 70~110°, 중력) + 흙먼지 | min(6, 1.5+r/10), 0.35s | count |
| debris | 0.6r 폭발 + 0.12s 간격 소형 화염구 n회(기본 4) + 금속 파편(꼬리) | min(7, 2+r/9), 0.6s | bursts |
| mushroom | nuke 레이어(없으면 blast) + 솟는 연기 기둥 + 갓(타원 분포 연기) | min(10, 3+r/6), 0.8s | — |

- 개발용 미리보기: 게임 화면 콘솔 `__deathFx('mushroom', 30)`.
- 미정: 원본의 변종 목록·선택 규칙(무작위/무기별), 변종별 반경·지형 변형(흙 분출이 실제 흙을 추가하는지)은 엔진 이벤트(terrain)로 받는다.
