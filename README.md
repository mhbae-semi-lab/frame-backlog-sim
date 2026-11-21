# 프레임 대기열 시뮬레이터 (frame-backlog-sim)

검사 설비의 촬영 · 처리 · 그리기 · 저장 단계마다 처리 시간과 **작업자 수 · 큐 크기 · 넘칠 때 정책**을 넣으면, 장비에 올리기 전에 **대기열이 쌓이는지, 몇 시간 뒤 메모리가 넘치는지**를 계산하는 웹 앱(PWA)입니다. 서버가 없고, 타이밍 로그는 브라우저 밖으로 나가지 않습니다.

**바로 열기: https://mhbae-semi-lab.github.io/frame-backlog-sim/** (설치 없음, 합성 시나리오가 계산되어 있음)

[English summary](#english)

## 1. 관점

검사 설비 SW 엔지니어는 카메라가 33 ms 마다 프레임을 보내는데 화면 그리기가 평균 36 ms 걸리는 것처럼, **조금 느린 단계 하나가 몇 분 · 몇 시간 뒤에 대기열과 메모리를 터뜨리는** 문제를 장비에서 늦게 발견합니다. 범용 대기행렬 도구는 도착 · 서버 · 큐를 직접 모델로 짜야 하고, 카메라 SDK 는 넘침 정책을 갖고 있지만 미리 계산해 주지는 않습니다. 이 앱은 **비전 파이프라인 단계, 카메라 SDK 와 같은 넘침 정책, '버려도 되는 단계 / 버리면 안 되는 단계'** 를 기본 개념으로 둡니다.

## 2. 해결

- 단계별 처리 시간 분포(고정 · 정규 · 로그정규 · 감마 · 지수, 또는 **내 타이밍 로그 그대로**)와 도착(고정 fps · 흔들림 · 포아송 · 버스트 · 로그의 촬영 시각)으로 **이산 사건 시뮬레이션**을 돌립니다.
- 넘칠 때 정책 5가지: 전부 처리 · 최신만 · 오래된 것 버림 · 새 것 버림(놓침) · 막기(앞 단계가 기다림). 단계는 갈래로 이어집니다 (예: 카메라 → 검사 → 저장, 카메라 → 화면).
- 결과: 대기열 길이(시계열) · 지연 p50 / p95 / p99 · 버린 프레임 · **메모리 정점과 한도 도달 시각**(기간 안이면 시뮬 값, 계속 쌓이면 외삽) · **손실 0 에 필요한 큐 크기**(그래버 버퍼 수).
- 실행 전 점검: ρ ≥ 1 이면 "끝없이 쌓임", 평균은 되지만 p99 가 도착 간격보다 길면 "가끔 밀림", 버리면 안 되는 단계에 버리는 정책이면 경고, 버스트 한 번에 쌓이는 장수.
- 분석식 대조: 카메라 바로 뒤 '전부 처리' 단계는 M/G/1(Pollaczek-Khinchine) · M/M/c(Erlang C) · D/M/1(고정 fps + 지수 처리) 정확식 또는 Kingman · Allen-Cunneen 근사와 시뮬 평균 대기를 나란히 보여 줍니다.
- 현장 검증 절차: **재현**(합성 시나리오 3종 + 내가 저장한 데이터) → **비교**(같은 도착열 · 같은 프레임별 처리 시간으로 장비 설정 vs 초안) → **Shadow**(실행마다 초안을 옆에서 계산해 기록, 판정은 장비 설정) → **전환 · 롤백**(서로 다른 데이터 3개 이상에서 기준 통과 시 전환, 버전 이력과 되돌리기).

## 3. 상용 비교 · 차별점 (조사 2026-11-22)

| 제품 | 형태 | 이 앱과 관련된 기능 |
|---|---|---|
| Basler pylon, GStreamer, Matrox MIL, Teledyne Sapera, NI | 카메라 SDK · 그래버 | 넘침 정책을 **구현**으로 가짐 (OneByOne · LatestImageOnly · LatestImages, leaky upstream/downstream, 놓친 프레임 카운터, trash 버퍼). 버퍼 수는 "손실이 0 이 될 때까지 늘리라"는 안내. 미리 계산하는 시뮬레이터는 아님 |
| SimPy, Ciw | 파이썬 DES 라이브러리 | 무엇이든 모델링 가능하지만 코드를 짜야 함. Ciw 는 순서대로 쓰는 분포 · 막기(Type I blocking) 지원 |
| AnyLogic, Arena, Simul8, MATLAB SimEvents | 유료 범용 시뮬레이터 | 도착 시각 표 읽기(AnyLogic), 큐가 차면 막기 · 가장 오래된 것 덮어쓰기(SimEvents), 분포 적합(Arena Input Analyzer · Stat::Fit). 비전 단계 · 정책은 직접 모델로 짜야 함 |
| Queueing Laboratory, Bluffton Queueing Simulator | 브라우저 대기행렬 도구 | 단일 창구 M/M/c/K 등, 내 데이터 업로드 · 정책 이름 · p99 · 메모리 없음 |
| MetricGate, SMU QCalc, Omni 계산기 | 온라인 계산기 | M/M/1 · M/M/c · M/M/c/K 분석식만 |
| Prometheus `predict_linear` · Grafana 예측 알림 | 운영 감시 | 운영 중인 지표의 추세로 고갈 시각 예측 (장비에 올린 뒤) |

출처: [Basler GrabStrategy](https://docs.baslerweb.com/net/T_Basler_Pylon_GrabStrategy.html) · [GStreamer queue](https://gstreamer.freedesktop.org/documentation/coreelements/queue.html) · [Matrox MIL 놓친 프레임](https://aurorahelp.zebra.com/aurorail/MILPP1/HelpFilesPP1/extfile/z_MIL_BSN_vio/BoardSpecificNotes/vio/Minimum_latency_and_grabbing_all_frames.htm) · [Teledyne 버퍼 처리](https://teledynevisionsolutions.com/support/support-center/application-note/iis/understanding-buffer-handling) · [NI 수집 모드](https://www.ni.com/en/support/documentation/supplemental/06/choosing-an-acquisition-mode.html) · [Ciw](https://github.com/CiwPython/Ciw) · [AnyLogic 도착 표](https://anylogic.help/anylogic/connectivity/source-db.html) · [SimEvents 큐](https://au.mathworks.com/help/simevents/gs/role-of-queues-in-simevents-models.html) · [Simul8 Stat::Fit](https://blog.simul8.com/?p=4920) · [Queueing Laboratory](https://robertwwalker.github.io/AI-Tools/ClaudeQueues) · [Bluffton](https://homepages.bluffton.edu/~nesterd/apps/queueingsimulator.html) · [MetricGate M/M/c/K](https://metricgate.com/docs/queue-mmck-finite-capacity/) · [Grafana 예측 알림](https://grafana.com/docs/grafana/latest/alerting/guides/alerting-on-forecasts/)

**이 앱이 다른 점** (조사한 제품 중에서 찾지 못함, 2026-11 기준)

1. **비전 파이프라인 단계와 카메라 SDK 와 같은 넘침 정책, '버리면 안 되는 단계' 표시를 기본 모델로** 둡니다. 모델을 짜지 않고 칸만 채우면, 버리면 안 되는 단계의 손실 · 표시 지연 p99 · 손실 0 필요 큐까지 판정합니다. 넘침 정책 자체는 카메라 SDK · SimEvents 에도 있습니다.
2. **단계별 타이밍 로그 CSV 를 열 지정만으로 그대로 재생**하고, 같은 도착열 · 같은 프레임별 처리 시간으로 정책 전 / 후를 나란히 봅니다. 도착 시각 표를 읽는 기능 자체는 AnyLogic 등에도 있습니다.
3. **장비에 올리기 전에** 설정 · 로그만으로 **메모리 한도 도달 시각**(몇 시간 운영하면 넘치는가)을 냅니다. 운영 중 지표로 고갈 시각을 예측하는 기능은 Prometheus 등에 있습니다.

## 4. 설치 · 사용

- 웹 주소에서 바로 열거나 브라우저의 "앱 설치"로 PWA 를 설치합니다. 한 번 열면 오프라인에서도 열립니다.
- 로컬 실행 (빌드 없음):
  ```
  python -m http.server 8748 --bind 127.0.0.1
  ```
  → `http://127.0.0.1:8748/`
- 사용 순서: 합성 시나리오 '그리기 느림'이 처음부터 계산되어 있습니다 → 단계 표의 흰 칸(작업자 · 큐 크기 · 넘칠 때)을 바꾸고 실행(Ctrl+Enter) → '현장 검증'에서 비교 · Shadow · 전환.
- 내 타이밍 로그(CSV): 한 줄 = 한 프레임. 촬영 시각 열(선택, 날짜 시각 µs 또는 ms · 초 · µs 숫자)과 단계별 처리 시간 열(숫자, 또는 `X_start` · `X_end` 쌍). 머리글로 자동 감지하고, 열 · 단위를 직접 지정할 수도 있습니다. 읽지 못한 줄은 줄 번호와 이유를 보여 줍니다. 예시 로그(합성)를 앱에서 내려받을 수 있습니다.
  ```
  frame,grab_time,proc_start,proc_end,draw_ms,save_ms
  1,2026-11-10 09:00:00.000000,2026-11-10 09:00:00.000500,2026-11-10 09:00:00.022100,35.2,24.9
  ```
- 저장: 이 브라우저의 IndexedDB (작업 데이터 · 재현 세트 · 장비 설정 이력 · Shadow 기록 · 읽은 로그). 설정에서 JSON 백업 · 가져오기 · 전체 삭제.
- 내보내기: HTML 보고서(단일 파일) · CSV(단계 요약 + 시계열) · JSON(설정 · 결과 전체), 장비 설정 JSON.
- 사용자 매뉴얼: [docs/manual/Frame-Backlog-Sim-User-Manual-ko.pdf](docs/manual/Frame-Backlog-Sim-User-Manual-ko.pdf)

### 개발

```
node --test                      # 단위 · 회귀 테스트 (의존성 없음, Node 20+)
node tools/bench.mjs             # 100만 프레임 · 3단계 시뮬 시간 (5회 최소 · 중앙값)
node tools/accuracy.mjs          # 분석식 대조 (M/M/1 · M/D/1 · M/M/3 · D/M/1, ρ 0.5 · 0.7 · 0.9, 10만 프레임 × 시드 100)
node tools/scenarios.mjs         # 합성 시나리오 3종 결과표 (처음 설정 vs 고친 설정)
node docs/manual/capture.mjs     # 매뉴얼 화면 캡처 (로컬 서버 실행 중, Chrome 필요)
python docs/manual/build_manual.py --pdf   # 매뉴얼 PPTX · PDF 생성 (python-pptx, Pillow, PDF 는 PowerPoint)
```

- 정적 파일(바닐라 JS, ES 모듈)만 있고 빌드 단계가 없습니다. 외부 CDN 을 쓰지 않습니다.
- 난수는 (시드, 단계, 프레임 번호)로 정해집니다. 그래서 설정 A 와 B 에서 같은 프레임은 같은 도착 시각 · 같은 처리 시간을 받습니다 (공통 난수).
- `vendor/pretendard/` 는 `pretendard@1.3.9` 의 `dist/web/static/woff2-subset` 중 쓰는 굵기 3종입니다.

## 5. 측정값

| 항목 | 결과 |
|---|---|
| 100만 프레임 · 3단계 시뮬, 브라우저 (Chrome 156) | 0.94 ~ 1.12초 (5회, 목표 2초) |
| 같은 측정, Node 24 (`node tools/bench.mjs`) | 최소 0.94초 · 중앙값 1.02초 |
| 분석식 대조, 10만 프레임 × 시드 100의 평균 대기 오차 (ρ ≤ 0.9, M/M/1 · M/D/1 · M/M/3 · D/M/1) | 최대 1.45% (M/M/3 ρ 0.9), ρ ≤ 0.7 은 0.36% 이내, 고정 fps 의 D/M/1 은 0.36% 이내 ([결과](docs/measurements/accuracy.json)) |
| 같은 조건 10만 프레임 1회의 흔들림 (σ) | ρ 0.9 에서 4.8 ~ 7.5% — 대기 시간끼리 강하게 이어져 1회로는 2% 를 가릴 수 없음 |
| Kingman 근사 vs D/M/1 정확식 (고정 fps, ρ 0.5 · 0.9) | 근사 5.0 · 45.0 ms vs 정확 2.55 · 41.8 ms — 도착이 고르면 근사가 크게 잡으므로 결과 표의 근사 대비 음수 오차는 정상 |
| 합성 '그리기 느림' (30fps, 그리기 평균 36 ms), 모든 프레임을 차례로 | 화면 대기열 30분에 4,068장, 메모리 한도 16 GB 에 25.8분, 표시 p99 134초 → 최신만: 대기 1장, 정점 2.45 GB, p99 88 ms |
| 합성 '버스트' (100장 × 120fps, 1.5초 쉼), 그래버 버퍼 24장 | 검사 단계 놓침 5,213장 → 손실 0 필요 큐 50장, 64장으로 놓침 0 |
| 합성 '메모리 누적' (저장 평균 33.7 ms vs 촬영 33.3 ms) | 8시간 운영 중 2.97시간에 한도 16 GB 도달 → 저장 작업자 2개로 정점 2.45 GB ([결과](docs/measurements/scenarios.json)) |

## 6. 한계

- 단계마다 처리 시간이 서로 독립이라고 가정합니다. 공유 자원(CPU 코어 · 메모리 대역 · 락)으로 단계끼리 서로 느려지는 효과는 모델에 없습니다. 장비의 타이밍 로그를 '그대로 재생'하면 그 효과가 들어간 측정값으로 계산합니다.
- 메모리는 (대기열 + 처리 중인 프레임) × 프레임 크기 + 기본 사용량입니다. 단계별 추가 버퍼 · 누수 · 단편화는 들어 있지 않습니다.
- 한도 도달 시각의 외삽은 끝 절반 구간의 기울기가 이어진다고 가정합니다. 계속 쌓이는 단계(ρ ≥ 1)가 있을 때만 외삽합니다.
- 분석식은 카메라 바로 뒤 단계에만 냅니다. 앞 단계 출력이 들어오는 단계는 시뮬 값만 봅니다. 고정 fps 에 지수 아닌 처리 시간이면 근사(Kingman)뿐이고, 근사는 대기를 크게 잡는 편입니다.
- 10만 프레임 1회 결과는 ρ 가 1 에 가까울수록 우연에 의한 흔들림이 큽니다. 시드를 바꿔 여러 번 돌려 보세요.

## 7. 만든 방법

배민혁이 설계하고, 구현 · 테스트 · 문서 작성에 AI 코딩 도구(Claude Code)를 썼습니다. 합성 시나리오 · 예시 로그의 수치는 설명용으로 만든 값이며 특정 장비의 측정값이 아닙니다.

라이선스: MIT. 포함한 서드파티: Pretendard (SIL OFL 1.1).

---

## English

**Frame Backlog Simulator** (https://mhbae-semi-lab.github.io/frame-backlog-sim/) tells an inspection-tool software engineer, before anything goes on the equipment, whether the frame queue will pile up and **when memory will run out**, given per-stage processing times and **workers, queue size and overflow policy**. It runs as a PWA in the browser; your timing logs never leave it.

- Model: camera arrivals (fixed fps, jitter, Poisson, bursts, or the log's capture times) and fan-out stages with processing times from distributions or **replayed from your timing log**. Overflow policies: process all, latest only, drop oldest, drop newest (miss), block. Stages are marked must-keep (inspection, saving) or display.
- Output: queue length over time, latency p50/p95/p99, dropped frames, peak memory and **time to memory limit** (simulated or extrapolated), and the **queue size for zero loss** (frame-grabber buffer count). Analytic M/G/1 and M/M/c checks next to the simulation.
- Field verification flow: reproduce (three synthetic scenarios plus your saved data), compare (equipment settings vs draft on the same arrivals and per-frame processing times), Shadow (the draft runs alongside every run), switch and roll back (versioned settings).
- Not found among the products surveyed (Nov 2026): vision-pipeline stages with camera-SDK-style overflow policies and must-keep stages as the default model; replaying a per-stage timing CSV by column mapping to compare policies on the same arrival order; time to the memory limit computed before deployment.
- 1,000,000 frames × 3 stages simulate in about 1 s in Chrome. Mean wait within 1.45% of the exact value (M/M/1, M/D/1, M/M/3, D/M/1) at ρ ≤ 0.9 (100,000 frames × 100 seeds).
- Run locally: `python -m http.server 8748 --bind 127.0.0.1`, tests: `node --test`.
- Built by 배민혁 with an AI coding assistant (Claude Code). All sample data is synthetic. MIT License.
