// 화면 문자열 (한국어 · 영어). 키가 두 언어에 모두 있는지 test/i18n.test.js 가 확인한다.
const help = {
  ko: `
<h3>무엇을 계산하나</h3>
<p>카메라가 프레임을 보내는 방식(fps · 버스트 · 로그 시각)과 단계별 처리 시간, 그리고 장비 설정(작업자 수 · 큐 크기 · 넘칠 때 정책 · 메모리 한도)을 넣으면, 이산 사건 시뮬레이션으로 프레임 하나하나의 도착 · 대기 · 처리를 따라갑니다. 결과는 대기열 길이, 지연 p50/p95/p99, 버린 프레임, 메모리 정점과 한도 도달 시각입니다.</p>
<h3>사용 순서</h3>
<ol><li><b>데이터</b>: 합성 시나리오 3종 중 하나를 고르거나, 내 타이밍 로그(CSV)를 엽니다.</li>
<li><b>단계 · 장비 설정</b>: 회색 칸(작업 데이터)은 입력 · 처리 시간 · 버리면 안 됨, 흰 칸(장비 설정 초안)은 작업자 · 큐 크기 · 넘칠 때 정책입니다. 바꾸면 아래 점검이 바로 갱신됩니다.</li>
<li><b>실행</b> (Ctrl+Enter): 결과 카드 · 단계 표 · 차트가 나옵니다. 같은 시드면 같은 결과입니다.</li>
<li><b>현장 검증</b>: 초안을 장비 설정과 같은 데이터로 비교하고, 여러 데이터에서 Shadow 로 기준을 통과하면 전환합니다.</li></ol>
<h3>넘칠 때 정책</h3>
<table class="tbl"><thead><tr><th>정책</th><th>동작</th><th>카메라 SDK 의 비슷한 설정</th></tr></thead><tbody>
<tr><td>전부 처리</td><td>모든 프레임을 차례로 처리. 큐 크기 제한 없음</td><td>Basler OneByOne, GStreamer queue 기본(막기)에 큰 버퍼</td></tr>
<tr><td>최신만</td><td>기다리는 프레임은 1장. 새 프레임이 오면 기다리던 것을 버림</td><td>Basler LatestImageOnly</td></tr>
<tr><td>오래된 것 버림</td><td>큐가 차면 가장 오래 기다린 프레임을 버림</td><td>Basler LatestImages, GStreamer leaky=downstream</td></tr>
<tr><td>새 것 버림 (놓침)</td><td>큐가 차면 새로 온 프레임을 받지 않음</td><td>그래버 버퍼가 없을 때 놓친 프레임, GStreamer leaky=upstream</td></tr>
<tr><td>막기</td><td>큐가 차면 앞 단계 작업자가 프레임을 쥔 채 기다림. 카메라 바로 뒤에서는 카메라가 기다리지 않으므로 '새 것 버림'과 같음</td><td>GStreamer queue 기본</td></tr></tbody></table>
<p><b>버리면 안 됨</b> 표시: 검사 결과 · 저장 영상처럼 버리면 안 되는 단계입니다. 이 단계에서 버린 프레임이 있으면 실패로 봅니다. 화면 표시처럼 지금 상태만 보면 되는 단계는 표시를 끄고 '최신만'을 씁니다.</p>
<h3>내 타이밍 로그 (CSV)</h3>
<p>한 줄 = 한 프레임. 촬영 시각 열(선택)과 단계별 처리 시간 열을 둡니다. 머리글이 있으면 자동으로 찾습니다.</p>
<pre>frame,grab_time,proc_start,proc_end,draw_ms,save_ms
1,2026-11-10 09:00:00.000000,2026-11-10 09:00:00.000500,2026-11-10 09:00:00.022100,35.2,24.9</pre>
<ul><li>시각: 날짜 시각(µs 까지) 또는 숫자(ms · 초 · µs). 시각 열이 있으면 '로그의 촬영 시각'으로 도착을 그대로 재생합니다.</li>
<li>처리 시간: 숫자 열, 또는 X_start · X_end 쌍(끝 - 시작). 직접 지정은 <code>proc_end-proc_start, draw_ms</code> 처럼.</li>
<li>읽지 못한 줄은 줄 번호와 이유(열 부족 · 숫자 아님 · 0 이하 · 시각 역전)를 보여 주고 건너뜁니다.</li>
<li>단계의 처리 시간은 '로그 그대로 재생'(프레임 순서대로, 끝나면 처음부터), '로그에서 무작위', '적합 분포'(정규 · 로그정규 · 감마 중 KS 거리가 가장 작은 것) 중에서 고릅니다.</li></ul>
<h3>결과 읽기</h3>
<ul><li><b>ρ (부하)</b> = 들어오는 비율 × 평균 처리 시간 ÷ 작업자 수. '전부 처리' 단계에서 ρ ≥ 1 이면 대기열은 줄어들 수 없고 시간에 비례해 쌓입니다. 큐를 키우면 넘치는 시점만 늦춰집니다.</li>
<li><b>평균이 아니라 p99</b>: 평균 처리 시간이 도착 간격보다 짧아도 p99 가 길면 가끔 밀립니다. 큐가 그만큼 흡수해야 합니다.</li>
<li><b>메모리</b> = (대기열 + 처리 중인 프레임 수) × 프레임 크기 + 기본 사용량. 기간 안에 한도에 닿으면 그 시각, 닿지 않았지만 계속 쌓이는 단계가 있으면 끝 절반 구간의 기울기로 외삽한 시각(추정)을 보여 줍니다. 한도에 닿은 뒤에도 계산은 계속합니다 (실제 장비는 그 전에 멈춥니다).</li>
<li><b>손실 0 필요 큐</b>: 같은 도착열 · 같은 처리 시간을 모든 단계 '전부 처리'로 다시 돌렸을 때의 최대 대기 수입니다. 그래버 버퍼 수를 정할 때 씁니다.</li>
<li><b>분석식</b>: 카메라 바로 뒤 '전부 처리' 단계는 M/G/1(Pollaczek-Khinchine) · M/M/c(Erlang C) · D/M/1(고정 fps + 지수 처리) 정확식, 그 밖에는 Kingman · Allen-Cunneen 근사와 시뮬 평균 대기를 나란히 보여 줍니다. 근사는 도착이 고를수록(고정 fps) 대기를 크게 잡는 편이라, 시뮬이 근사보다 작게 나오는 것이 보통입니다.</li></ul>
<h3>엔진 정확도 확인</h3>
<p>포아송 도착 M/M/1 · M/D/1 · M/M/3 과 고정 fps 도착 D/M/1 을 ρ 0.5 · 0.7 · 0.9 로, 10만 프레임 × 시드 10개씩 돌려 분석식과 비교합니다 (약 10초).</p>
<p><button class="btn sm" type="button" id="acc-run">정확도 확인 실행</button></p><div id="acc-out"></div>
<h3>현장 검증 절차</h3>
<ol><li><b>재현</b>: 합성 시나리오 3종과 내가 저장한 데이터를 지금 장비 설정 · 초안으로 한 번에 다시 계산합니다.</li>
<li><b>비교</b>: 같은 도착열 · 같은 프레임별 처리 시간으로 장비 설정과 초안을 나란히, 바뀐 칸만 강조합니다.</li>
<li><b>Shadow</b>: 실행할 때마다 초안도 옆에서 계산해 기록합니다. 판정은 장비 설정 기준으로 하고, 판정이 다른 경우만 모아 볼 수 있습니다.</li>
<li><b>전환 · 롤백</b>: 초안이 서로 다른 데이터 3개 이상에서 기준(버리면 안 되는 단계 손실 0, 메모리 한도 N 시간 안에 도달 없음, 표시 p99 기준 이하)을 통과하면 전환 버튼이 켜집니다. 모든 버전은 남고 한 번에 되돌립니다. 가져온 설정은 초안으로만 들어옵니다.</li></ol>
<h3>개인정보</h3>
<p>로그는 이 브라우저 안에서만 읽고, 작업 데이터 · 설정 · 기록은 이 기기의 IndexedDB 에만 저장합니다. 서버 · 외부 서비스로 보내는 것은 없습니다. 설정 → 백업 내보내기로 옮길 수 있습니다.</p>
<h3>키보드</h3>
<ul><li>Ctrl+Enter: 실행 · Tab: 칸 이동 · 현장 검증 탭: ← → Home End</li><li>차트마다 '표로 보기'로 같은 값을 표로 봅니다.</li></ul>
<h3>FAQ</h3>
<p><b>장비에서 잰 것과 결과가 다릅니다.</b> 시뮬레이션은 단계 사이의 독립된 처리 시간을 가정합니다. 공유 자원(CPU 코어 · 메모리 대역 · 락)으로 단계끼리 서로 느려지는 효과는 들어 있지 않습니다. 장비의 타이밍 로그를 '그대로 재생'하면 그 효과가 들어간 측정값으로 계산합니다.</p>
<p><b>시드는 왜 있나요?</b> 같은 시드면 프레임마다 같은 도착 시각 · 같은 처리 시간을 씁니다. 그래서 설정 A 와 B 의 차이는 설정 때문입니다. 시드를 바꿔 여러 번 돌리면 우연의 폭을 봅니다.</p>
<p><b>몇 프레임까지 되나요?</b> 100만 프레임 · 3단계가 PC 브라우저에서 약 1~2초입니다. 8시간 30fps 는 86만 프레임입니다.</p>`,
  en: `
<h3>What it computes</h3>
<p>Give it how the camera delivers frames (fps, bursts or the log's timestamps), the processing time of each stage, and the equipment settings (workers, queue size, overflow policy, memory limit). A discrete-event simulation follows every frame's arrival, wait and processing. You get queue length, latency p50/p95/p99, dropped frames, peak memory and when the memory limit is reached.</p>
<h3>How to use</h3>
<ol><li><b>Data</b>: pick one of three synthetic scenarios or open your own timing log (CSV).</li>
<li><b>Stages and settings</b>: grey cells are workload data (input, processing time, must-keep); white cells are the draft equipment settings (workers, queue size, overflow policy). Checks below update as you type.</li>
<li><b>Run</b> (Ctrl+Enter): verdict cards, stage table and charts. Same seed, same result.</li>
<li><b>Field verification</b>: compare the draft with the equipment settings on the same data, collect Shadow runs across data sets, then switch.</li></ol>
<h3>Overflow policies</h3>
<table class="tbl"><thead><tr><th>Policy</th><th>Behavior</th><th>Similar camera SDK setting</th></tr></thead><tbody>
<tr><td>Process all</td><td>Every frame in order, unbounded queue</td><td>Basler OneByOne, GStreamer queue default (block) with a large buffer</td></tr>
<tr><td>Latest only</td><td>One waiting frame; a new frame replaces it</td><td>Basler LatestImageOnly</td></tr>
<tr><td>Drop oldest</td><td>When full, drop the frame that waited longest</td><td>Basler LatestImages, GStreamer leaky=downstream</td></tr>
<tr><td>Drop newest (miss)</td><td>When full, refuse the incoming frame</td><td>Frame grabber with no free buffer, GStreamer leaky=upstream</td></tr>
<tr><td>Block</td><td>When full, the upstream worker holds its frame and waits. Right after the camera it equals drop newest, because a camera does not wait</td><td>GStreamer queue default</td></tr></tbody></table>
<p><b>Must keep</b>: stages such as inspection results or saved images that must not lose frames. Any drop there fails the run. Display stages only need the current state, so untick it and use latest only.</p>
<h3>Your timing log (CSV)</h3>
<p>One row per frame: an optional capture-time column and one column per stage duration. With a header row, columns are detected automatically.</p>
<pre>frame,grab_time,proc_start,proc_end,draw_ms,save_ms
1,2026-11-10 09:00:00.000000,2026-11-10 09:00:00.000500,2026-11-10 09:00:00.022100,35.2,24.9</pre>
<ul><li>Time: date-time (down to µs) or a number (ms, s, µs). With a time column, arrivals replay the log's capture times.</li>
<li>Durations: numeric columns or X_start / X_end pairs (end − start). Specify manually as <code>proc_end-proc_start, draw_ms</code>.</li>
<li>Unreadable rows are listed with line number and reason (too few columns, not a number, zero or negative, time going backwards) and skipped.</li>
<li>Each stage can replay the log in order (looping), sample from it at random, or use the fitted distribution (normal, lognormal or gamma, smallest KS distance).</li></ul>
<h3>Reading the results</h3>
<ul><li><b>ρ (load)</b> = arrival rate × mean processing time ÷ workers. For a process-all stage with ρ ≥ 1 the queue cannot shrink and grows with time. A bigger queue only delays the overflow.</li>
<li><b>p99, not the mean</b>: even when the mean is shorter than the arrival interval, a long p99 means occasional backlog that the queue must absorb.</li>
<li><b>Memory</b> = (queued + in-process frames) × frame size + base usage. If the limit is hit within the run, you get that time; if not but a stage keeps growing, you get a time extrapolated from the slope of the last half (estimate). The run continues past the limit (real equipment would stop before).</li>
<li><b>Queue for zero loss</b>: the maximum wait count when the same arrivals and processing times are rerun with every stage on process all. Use it to size frame-grabber buffers.</li>
<li><b>Analytic</b>: for process-all stages right after the camera, the simulated mean wait is shown next to the exact M/G/1 (Pollaczek-Khinchine), M/M/c (Erlang C) or D/M/1 (fixed fps + exponential service) result, otherwise the Kingman or Allen-Cunneen approximation. The approximations overstate the wait when arrivals are regular (fixed fps), so a simulated value below them is normal.</li></ul>
<h3>Engine accuracy check</h3>
<p>Runs M/M/1, M/D/1 and M/M/3 with Poisson arrivals and D/M/1 with fixed-fps arrivals at ρ 0.5, 0.7 and 0.9, 100,000 frames × 10 seeds each, against the formulas (about 10 s).</p>
<p><button class="btn sm" type="button" id="acc-run">Run accuracy check</button></p><div id="acc-out"></div>
<h3>Field verification</h3>
<ol><li><b>Reproduce</b>: rerun the three synthetic scenarios and your saved data with the equipment settings and the draft.</li>
<li><b>Compare</b>: equipment settings and draft side by side on the same arrivals and the same per-frame processing times; only changed cells are highlighted.</li>
<li><b>Shadow</b>: every run also computes the draft and records it. The verdict follows the equipment settings; you can list only runs where the verdicts differ.</li>
<li><b>Switch and roll back</b>: when the draft passes the criteria on 3 or more different data sets (no loss on must-keep stages, memory limit not reached within N hours, display p99 within target), the switch button turns on. Every version is kept and can be restored in one step. Imported settings only become the draft.</li></ol>
<h3>Privacy</h3>
<p>Logs are read inside this browser. Workloads, settings and records are stored only in this device's IndexedDB. Nothing is sent to a server or outside service. Use Settings → Export backup to move them.</p>
<h3>Keyboard</h3>
<ul><li>Ctrl+Enter: run · Tab: move between fields · Verification tabs: ← → Home End</li><li>Every chart has "Show table" with the same values.</li></ul>
<h3>FAQ</h3>
<p><b>The equipment measures something else.</b> The simulation assumes independent processing times per stage. Slowdowns between stages through shared resources (CPU cores, memory bandwidth, locks) are not modeled. Replaying the equipment's own timing log uses measurements that already include them.</p>
<p><b>Why a seed?</b> The same seed gives every frame the same arrival time and processing time, so the difference between settings A and B comes from the settings. Change the seed and rerun to see the spread due to chance.</p>
<p><b>How many frames?</b> One million frames with three stages take about 1–2 s in a desktop browser. Eight hours at 30 fps is 864,000 frames.</p>`,
};

const STR = {
  ko: {
    skip: "본문으로 건너뛰기", appName: "프레임 대기열 시뮬레이터", language: "언어", theme: "화면 테마", theme_auto: "시스템", theme_light: "밝게", theme_dark: "어둡게",
    help: "도움말", settings: "설정", close: "닫기", cancel: "취소", auto: "자동",
    heroTitle: "이 설정이면 대기열이 쌓이는가, 몇 시간 뒤 메모리가 넘치는가",
    heroText: "촬영 · 처리 · 그리기 · 저장 단계의 처리 시간과 <b>작업자 수 · 큐 크기 · 넘칠 때 정책</b>을 넣으면, 장비에 올리기 전에 대기열 길이 · 지연 p50/p95/p99 · 버린 프레임 · <b>메모리 한도 도달 시각</b>을 계산합니다. 내 타이밍 로그를 그대로 재생해 같은 도착 순서에서 설정 전 / 후를 비교합니다. 계산은 이 브라우저 안에서만 합니다.",
    step1: "데이터 고르기", step2: "단계 · 장비 설정", step3: "대기열 · 지연 · 메모리", step4: "현장 검증 (재현 → 비교 → Shadow → 전환)",
    sourceTitle: "1. 데이터", sourceHint: "합성 시나리오를 고르거나 내 타이밍 로그(CSV)를 엽니다",
    scSlowDraw: "그리기 느림", scBurst: "버스트 촬영", scMemCreep: "메모리 누적 (몇 시간 뒤)",
    openLog: "내 타이밍 로그 열기", openSampleLog: "예시 로그 (합성)", downloadSample: "예시 로그 내려받기", dropHint: "CSV 파일을 이 페이지에 끌어다 놓아도 됩니다", dropHere: "여기에 놓으면 타이밍 로그로 읽습니다",
    readOpts: "로그 읽기 설정 (열 · 단위 · 인코딩)", optDelim: "구분자", optHeader: "첫 줄", headerYes: "머리글", headerNo: "자료", optEnc: "인코딩", encAuto: "자동 (UTF-8 → EUC-KR)",
    optTime: "촬영 시각 열", optTimeUnit: "시각 단위", optDurUnit: "처리 시간 단위", unitS: "초", unitDt: "날짜 시각", optCols: "처리 시간 열 (쉼표로, 끝-시작은 a-b)",
    colsHint: "비우면 머리글로 찾습니다: 시각 열(time · timestamp · grab_time …), 번호 열(frame · id)은 빼고, X_start · X_end 쌍은 끝 - 시작으로 바꿉니다. 번호는 1부터. 시각 열을 쓰지 않으려면 none.",
    formatEx: "예: <code>frame,grab_time,proc_start,proc_end,draw_ms,save_ms</code>", reread: "이 설정으로 다시 읽기", reading: "읽는 중…", rereadNone: "다시 읽을 파일이 없습니다. 파일을 먼저 여세요.",
    logFile: "파일", logRows: "프레임 (읽은 줄)", logTime: "촬영 시각 열", logCols: "처리 시간 열", logBad: "읽지 못한 줄", logTag: "로그",
    badSum: "읽지 못한 줄 {n}개 (줄 번호 · 이유)", badMore: "그 밖에 {n}개", thLine: "줄", thReason: "이유", thText: "내용",
    bad_B_COLS: "열 부족 ({arg})", bad_B_TIME: "시각을 읽지 못함 ({arg})", bad_B_BACK: "시각이 앞 줄보다 이름 ({arg})", bad_B_NUM: "숫자가 아님 ({arg})", bad_B_NEG: "0 이하 처리 시간 ({arg})",
    fitTitle: "열별 분포", fitHint: "단위 ms. KS 거리가 작을수록 잘 맞음", thCol: "열", thMean: "평균", thMax: "최대", thBestFit: "가장 잘 맞는 분포", thOthers: "다른 후보 (KS)", useFit: "적합 분포 쓰기", fitApplied: "{col}: 로그 재생 대신 적합 분포를 씁니다",
    configTitle: "2. 단계 · 장비 설정", configHint: "회색 칸은 작업 데이터, 흰 칸은 장비 설정(초안)입니다",
    camTitle: "촬영 (카메라)", camMode: "도착 방식", camFixed: "고정 fps", camJitter: "고정 fps + 흔들림", camPoisson: "무작위 (포아송)", camBurst: "버스트 (슬롯 촬영)", camLog: "로그의 촬영 시각",
    camJitterMs: "흔들림 σ (ms)", camBurstN: "버스트 한 번에 (장)", camBurstFps: "버스트 중 fps", camGap: "버스트 사이 쉬는 시간 (ms)",
    camSum: "촬영 간격 {iv} ms", camBurstSum: "평균 {avg} fps, 버스트 중 간격 {iv} ms", camLogSum: "로그의 촬영 시각을 그대로 재생합니다 (끝나면 처음부터 반복)",
    memTitle: "메모리", frameMB: "프레임 1장 (MB)", baseMB: "프로그램 기본 사용량 (MB)", limitGB: "메모리 한도 (GB, 장비 설정)", memHint: "대기열 · 처리 중인 프레임 수 × 프레임 크기 + 기본 사용량. 한도 0 은 확인하지 않음.",
    runTitle: "계산", duration: "운영 시간 (분)", seed: "시드 (같은 값이면 같은 결과)", runSum: "약 {n} 프레임 · {dur}",
    stagesCap: "단계 목록", grpData: "작업 데이터", grpSet: "장비 설정 (초안)", thStage: "단계", thFrom: "입력", thDist: "처리 시간", thParams: "평균 · σ (ms)", thKeep: "버리면 안 됨",
    thWorkers: "작업자", thCap: "큐 크기", thPolicy: "넘칠 때", thActions: "작업", fromCamera: "카메라", delStage: "단계 삭제",
    dist_fixed: "고정", dist_normal: "정규", dist_lognormal: "로그정규", dist_gamma: "감마", dist_exp: "지수 (무작위)", dist_log: "로그",
    distLogReplay: "로그 {col} 그대로", distLogSample: "로그 {col} 무작위", logParam: "평균 {m} · p99 {p}", logMissing: "로그 없음",
    pol_all: "전부 처리", pol_latest: "최신만", pol_dropOld: "오래된 것 버림", pol_dropNew: "새 것 버림 (놓침)", pol_block: "막기",
    stage_proc: "처리 (검사)", stage_draw: "그리기 (화면)", stage_save: "저장",
    addStage: "+ 단계 추가", loadActive: "장비 설정 불러오기", saveWorkload: "재현 세트에 저장", nameDup: "비어 있거나 다른 단계와 이름이 같습니다",
    draftDiff: "초안 · 장비 설정 v{v} 와 {n}곳 다름", draftSame: "장비 설정 v{v} 와 같음", loadedActive: "장비 설정 v{v} 를 초안으로 불러왔습니다",
    pre_P_GROW: "평균 처리 {a} ms (작업자 수로 나눔)가 들어오는 간격 {b} ms 보다 길어 대기열이 끝없이 쌓입니다 (ρ {rho}).",
    pre_P_LOSS_KEEP: "처리 능력이 모자라 프레임을 버리게 됩니다 (ρ {rho}). 버리면 안 되는 단계입니다.",
    pre_P_DROP_OK: "처리 능력이 모자라 프레임을 버립니다 (ρ {rho}). 표시 단계라면 괜찮습니다.",
    pre_P_P99: "평균은 따라가지만 p99 {a} ms 가 들어오는 간격 {b} ms (작업자 수 반영)보다 길어 가끔 밀립니다. 큐가 흡수해야 합니다.",
    pre_P_KEEP_DROP: "버리면 안 되는 단계인데 버리는 정책입니다. 큐가 넘치면 프레임을 잃습니다.",
    pre_P_CAM_BLOCK: "카메라는 기다리지 않으므로 카메라 바로 뒤의 '막기'는 '새 것 버림'과 같습니다.",
    pre_P_BURST: "버스트 한 번에 약 {n}장이 쌓입니다 (큐 크기 {cap}).",
    run: "실행", running: "계산 중", stale: "설정이 바뀌었습니다. 실행을 누르면 다시 계산합니다.", canceled: "취소했습니다",
    resultsTitle: "3. 결과", exportLabel: "내보내기", expHtml: "HTML 보고서", noResult: "아직 결과가 없습니다. 실행을 누르세요.",
    resMeta: "{w} · {n} 프레임 · {dur} · 계산 {ms} ms", verdictTitle: "판정",
    passAll: "Shadow 기준 통과", failSome: "기준 실패: {list}", pass: "통과", fail: "실패",
    crit_keepLoss: "필수 단계 손실", crit_memory: "메모리 한도", crit_p99: "표시 지연", crit_pass: "판정",
    vQueueBad: "끝없이 쌓이는 단계", vQueueOk: "대기열 안정", vQueueOkB: "'전부 처리' 단계는 모두 ρ < 1",
    vMemHit: "메모리 한도 {lim} 에 {at} 뒤 도달", vMemHitB: "기간 안 정점 {peak} (한도 뒤에도 계속 계산)",
    vMemExtrap: "메모리 한도 {lim} 에 약 {at} 뒤 도달 (추정)", vMemExtrapB: "끝 절반 구간 기울기 {rate} / 시간으로 외삽",
    vMemOk: "메모리 정점 {peak} / 한도 {lim}", vMemOkB: "계속 쌓이는 단계 없음", vMemNoLimit: "메모리 정점 {peak}", vMemNoLimitB: "한도를 정하지 않음 (0)",
    vLossBad: "버리면 안 되는 단계에서 {n}장 버림", vLossBadB: "큐 크기 · 작업자 수 · 정책을 바꾸세요. '손실 0 필요 큐'를 참고",
    vLossDisp: "표시 단계에서 {n}장 버림", vLossDispB: "최신 상태만 보여 주므로 괜찮음", vLossNone: "버린 프레임 없음", vLossNoneB: "모든 단계가 모든 프레임을 처리",
    vLat: "표시 지연 p99 {p}", vLatB: "기준 {c} (촬영부터 화면에 그려질 때까지)", vLatNone: "표시 단계 없음", vLatNoneB: "'버리면 안 됨'을 끈 단계가 표시 단계입니다",
    thRho: "ρ", thWait: "대기 평균", thAna: "분석식 대기", thDropped: "버림", thRemain: "끝에 남음", thMaxQ: "최대 대기", thNeedQ: "손실 0 필요 큐",
    approx: "근사", needGrow: "끝없이 증가", keepTag: "필수", dispTag: "표시", resTableCap: "단계별 결과",
    chQueue: "대기열 길이", chQueueHint: "구간마다 최대, 기다리는 프레임 수", chMem: "메모리", chMemHint: "구간마다 최대, 점선은 한도", chLat: "지연 분포", chLatHint: "촬영부터 이 단계가 끝날 때까지",
    asTable: "표로 보기", asChart: "차트로 보기", thRange: "구간", thCount: "프레임 수", thTime: "시각",
    limitLine: "한도 {v}", hitLine: "{at} 한도 도달", ariaQ: "대기열 길이 차트. 단계별 최대 대기: {list}", ariaMem: "메모리 차트. 정점 {peak}, 한도 {lim}", ariaLat: "{s} 지연 분포. p50 {p50}, p95 {p95}, p99 {p99}",
    verifyTitle: "4. 현장 검증 절차", verifyHint: "바꾸기 전에 같은 데이터로 확인하고, 새 설정은 옆에서 먼저 돌려 보고, 언제든 되돌립니다",
    vtRepro: "재현", vtCompare: "비교", vtSwitch: "전환 · 롤백",
    reproHint: "합성 시나리오 3종과 내가 저장한 데이터(재현 세트)를 지금 장비 설정과 초안으로 다시 계산합니다. 초안이 장비 설정과 다르면 결과는 Shadow 기록에도 쌓입니다.",
    reproRun: "모두 다시 계산 (장비 설정 v{v} · 초안)", reproRunning: "재현 세트 계산 중", reproDone: "{n}개 계산 완료",
    thWorkload: "데이터", thData: "내용", thActiveV: "장비 설정 v{v}", thDraft: "초안", builtinTag: "합성", open: "열기", delete: "삭제",
    wlLabel: "이름", wlPh: "예: 11월 10일 2호기 Down 직전 로그", savedWorkload: "재현 세트에 저장: {label}",
    sumBurst: "버스트 {n}장 · {fps} fps · 쉼 {gap} ms", edited: " (수정)",
    cmpSame: "초안이 장비 설정 v{v} 와 같습니다. 단계 표의 흰 칸(작업자 · 큐 크기 · 넘칠 때) 또는 메모리 한도를 바꾸고 실행하면 여기서 전 / 후를 나란히 봅니다.",
    cmpHint: "데이터: {w}. 같은 시드라 프레임마다 도착 시각 · 처리 시간이 같습니다. 차이는 설정 때문입니다.",
    cmpSettings: "바뀐 설정", cmpResults: "결과", cmpOnlyChg: "바뀐 칸 강조", cmpMemPeak: "메모리 정점", cmpMemHit: "한도 도달", cmpKeepLoss: "필수 단계 손실", cmpDispP99: "표시 p99",
    cmpMemChart: "메모리 (장비 설정 점선 · 초안 실선)", ariaCmp: "메모리 비교 차트. 장비 설정 정점 {a}, 초안 정점 {b}", discardDraft: "초안 버리기 (장비 설정으로)", noLimit: "한도 없음", notReached: "도달 안 함",
    shadowHint: "실행할 때마다 초안도 같은 데이터로 계산해 여기에 쌓습니다. 판정은 장비 설정이 하고, 초안은 옆 칸에만 있습니다.",
    critTitle: "기준", critKeep: "필수 단계 손실 0", critHold: "메모리 한도 도달 없음 (시간)", critP99: "표시 p99 이하 (ms)", critCases: "전환에 필요한 데이터 수", critSaved: "기준을 저장했습니다",
    onlyDiff: "판정이 다른 것만", clearShadow: "기록 지우기", thWhen: "시각", thActiveCol: "장비 설정 (판정)", thDraftCol: "초안 (Shadow)", thDiff: "차이", differs: "다름", oldDraft: "이전 초안", noShadow: "아직 기록이 없습니다. 초안을 바꾸고 실행하거나 재현 세트를 다시 계산하세요.",
    swOk: "전환할 수 있습니다: 지금 초안이 서로 다른 데이터 {n}개에서 기준을 통과했습니다.",
    sw_same: "초안이 지금 장비 설정과 같습니다.", sw_few: "지금 초안으로 계산한 데이터가 {n}개입니다. {need}개 이상이 필요합니다 (재현 탭의 '모두 다시 계산').", sw_fail: "지금 초안이 기준을 통과하지 못한 데이터가 {n}개 있습니다.",
    swNote: "메모", swNotePh: "예: 그리기 최신만 · 저장 작업자 2", doSwitch: "초안으로 전환 (v{v})", switched: "장비 설정 v{v} 로 전환했습니다", rolledBack: "v{from} 설정으로 되돌려 v{v} 를 만들었습니다",
    thVersion: "버전", thKind: "변경", thSettings: "설정", inUse: "사용 중", rollback: "이 버전으로 되돌리기",
    kind_first: "처음 설정", kind_switch: "v{from} 에서 전환", kind_rollback: "v{from} 로 되돌림",
    expSettings: "장비 설정 v{v} 내보내기 (JSON)", impSettings: "설정 가져오기", impHint: "가져온 설정은 초안으로만 들어갑니다", importedDraft: "가져온 설정을 초안으로 넣었습니다", limitShort: "한도",
    footer: "합성 시나리오 · 예시 로그의 수치는 설명용으로 만든 값입니다 (특정 장비 측정값 아님). 데이터는 이 기기에만 저장됩니다.",
    dataSection: "데이터", backupExport: "백업 내보내기 (JSON)", backupImport: "백업 가져오기", errorsExport: "오류 기록 내보내기", resetAll: "이 기기의 데이터 모두 지우기",
    dataHint: "저장 위치: 이 브라우저의 IndexedDB (작업 데이터 · 재현 세트 · 장비 설정 이력 · Shadow 기록 · 읽은 로그). 서버로 보내지 않습니다.",
    backupDone: "백업을 가져왔습니다. 다시 엽니다.", resetConfirm: "이 기기에 저장된 작업 데이터 · 재현 세트 · 설정 이력 · Shadow 기록 · 로그를 모두 지웁니다. 계속할까요?",
    obTitle: "처음 오셨나요?",
    ob1: "<b>합성 시나리오 '그리기 느림'</b>이 이미 계산되어 있습니다. 30fps 촬영에 그리기 평균 36 ms 면 화면 대기열이 끝없이 쌓여 메모리 한도에 닿습니다.",
    ob2: "단계 표의 <b>그리기 · 넘칠 때</b>를 '최신만'으로 바꾸고 실행해 보세요. '현장 검증 → 비교'에 전 / 후가 나란히 나옵니다.",
    ob3: "<b>내 타이밍 로그(CSV)</b>를 끌어다 놓으면 같은 도착 순서 그대로 재생합니다. 형식은 도움말을 보세요.",
    obPrivacy: "로그는 이 브라우저 안에서만 읽고 이 기기에만 저장합니다. 서버 · 외부 서비스로 보내는 것은 없습니다.", obStart: "시작하기",
    noIdb: "이 브라우저에서는 저장소(IndexedDB)를 쓸 수 없어, 새로고침하면 작업이 사라집니다.", updateReady: "새 버전이 준비됐습니다. 새로고침하면 적용됩니다.",
    accRunning: "계산 중…", thModel: "모델", thAnaWq: "분석식 대기 (ms)", thSimWq: "시뮬 대기 평균 (ms)", thErr10: "오차 (10회 평균)", thErr1: "오차 (1회)", thSdRun: "1회의 흔들림 (σ)", thCi: "95% 구간 안",
    accNote: "10만 프레임 1회는 ρ 0.9 에서 우연에 의한 흔들림이 ±5% 안팎입니다 (대기 시간이 서로 강하게 이어지기 때문). 그래서 시드 10개 평균의 오차가 그 평균의 95% 구간(±1.96 σ/√10) 안에 드는지로 판정합니다. 저장소의 tools/accuracy.mjs 는 시드 100개로 돌려 모든 경우 1.5% 이내입니다.",
    err_E_POS: "0 보다 큰 수가 필요합니다", err_E_NONNEG: "0 이상이어야 합니다", err_E_ARRIVAL: "도착 방식을 알 수 없습니다", err_E_LOG_TIME: "촬영 시각이 있는 로그가 필요합니다",
    err_E_NO_STAGE: "단계가 하나 이상 필요합니다", err_E_FROM: "입력은 카메라 또는 위쪽 단계여야 합니다", err_E_WORKERS: "작업자는 1 ~ 256", err_E_POLICY: "정책을 알 수 없습니다",
    err_E_CAP: "큐 크기는 1 이상의 정수", err_E_DIST: "분포를 알 수 없습니다", err_E_LOG_COL: "로그 열이 없습니다 (로그를 다시 여세요)",
    err_E_EMPTY: "빈 파일입니다", err_E_COL: "열을 찾지 못했습니다: {arg}", err_E_NO_COLS: "처리 시간 열을 찾지 못했습니다. 읽기 설정에서 열을 지정하세요.",
    err_E_NO_ROWS: "읽을 수 있는 줄이 없습니다. 읽지 못한 줄의 이유를 확인하세요.", err_E_LOG_MISSING: "저장된 로그를 찾지 못했습니다. 로그를 다시 여세요.",
    err_E_CANCELED: "취소했습니다", err_E_WORKER: "계산 Worker 가 멈췄습니다. 다시 실행하세요.", err_E_BACKUP: "이 앱의 백업 파일이 아닙니다", err_E_SETTINGS: "이 앱의 장비 설정 파일이 아닙니다", err_unknown: "오류: {msg}",
    helpHtml: help.ko,
  },
  en: {
    skip: "Skip to content", appName: "Frame Backlog Simulator", language: "Language", theme: "Theme", theme_auto: "System", theme_light: "Light", theme_dark: "Dark",
    help: "Help", settings: "Settings", close: "Close", cancel: "Cancel", auto: "Auto",
    heroTitle: "Will the queue pile up with these settings, and when does memory run out?",
    heroText: "Enter processing times for capture, processing, drawing and saving plus <b>workers, queue size and overflow policy</b>. Before anything goes on the equipment you get queue length, latency p50/p95/p99, dropped frames and <b>when the memory limit is reached</b>. Replay your own timing log to compare settings on the same arrival order. Everything runs inside this browser.",
    step1: "Pick data", step2: "Stages and settings", step3: "Queue, latency, memory", step4: "Field verification (reproduce → compare → Shadow → switch)",
    sourceTitle: "1. Data", sourceHint: "Pick a synthetic scenario or open your timing log (CSV)",
    scSlowDraw: "Slow drawing", scBurst: "Burst capture", scMemCreep: "Memory creep (hours later)",
    openLog: "Open my timing log", openSampleLog: "Sample log (synthetic)", downloadSample: "Download sample log", dropHint: "You can also drop a CSV file on this page", dropHere: "Drop to read as a timing log",
    readOpts: "Log reading options (columns, units, encoding)", optDelim: "Delimiter", optHeader: "First row", headerYes: "Header", headerNo: "Data", optEnc: "Encoding", encAuto: "Auto (UTF-8 → EUC-KR)",
    optTime: "Capture-time column", optTimeUnit: "Time unit", optDurUnit: "Duration unit", unitS: "s", unitDt: "Date-time", optCols: "Duration columns (comma separated, end-start as a-b)",
    colsHint: "Leave empty to detect from the header: a time column (time, timestamp, grab_time …), id columns (frame, id) are skipped, X_start / X_end pairs become end − start. Numbers start at 1. Use none to ignore the time column.",
    formatEx: "Example: <code>frame,grab_time,proc_start,proc_end,draw_ms,save_ms</code>", reread: "Read again with these options", reading: "Reading…", rereadNone: "No file to read again. Open a file first.",
    logFile: "File", logRows: "Frames (rows read)", logTime: "Capture-time column", logCols: "Duration columns", logBad: "Unreadable rows", logTag: "log",
    badSum: "{n} unreadable rows (line number and reason)", badMore: "{n} more", thLine: "Line", thReason: "Reason", thText: "Text",
    bad_B_COLS: "Too few columns ({arg})", bad_B_TIME: "Cannot read time ({arg})", bad_B_BACK: "Time earlier than previous row ({arg})", bad_B_NUM: "Not a number ({arg})", bad_B_NEG: "Duration zero or negative ({arg})",
    fitTitle: "Column distributions", fitHint: "ms. Smaller KS distance fits better", thCol: "Column", thMean: "Mean", thMax: "Max", thBestFit: "Best fit", thOthers: "Other candidates (KS)", useFit: "Use fit", fitApplied: "{col}: using the fitted distribution instead of log replay",
    configTitle: "2. Stages and equipment settings", configHint: "Grey cells are workload data, white cells are the (draft) equipment settings",
    camTitle: "Capture (camera)", camMode: "Arrivals", camFixed: "Fixed fps", camJitter: "Fixed fps + jitter", camPoisson: "Random (Poisson)", camBurst: "Burst (slot capture)", camLog: "Log capture times",
    camJitterMs: "Jitter σ (ms)", camBurstN: "Frames per burst", camBurstFps: "fps during burst", camGap: "Pause between bursts (ms)",
    camSum: "Interval {iv} ms", camBurstSum: "Average {avg} fps, {iv} ms apart during a burst", camLogSum: "Replays the log's capture times (loops at the end)",
    memTitle: "Memory", frameMB: "One frame (MB)", baseMB: "Program base usage (MB)", limitGB: "Memory limit (GB, equipment setting)", memHint: "(Queued + in-process frames) × frame size + base usage. Limit 0 means no check.",
    runTitle: "Run", duration: "Operating time (min)", seed: "Seed (same value, same result)", runSum: "about {n} frames · {dur}",
    stagesCap: "Stages", grpData: "Workload data", grpSet: "Equipment settings (draft)", thStage: "Stage", thFrom: "Input", thDist: "Processing time", thParams: "Mean · σ (ms)", thKeep: "Must keep",
    thWorkers: "Workers", thCap: "Queue size", thPolicy: "When full", thActions: "Actions", fromCamera: "Camera", delStage: "Delete stage",
    dist_fixed: "Fixed", dist_normal: "Normal", dist_lognormal: "Lognormal", dist_gamma: "Gamma", dist_exp: "Exponential (random)", dist_log: "Log",
    distLogReplay: "Log {col} as is", distLogSample: "Log {col} random", logParam: "mean {m} · p99 {p}", logMissing: "no log",
    pol_all: "Process all", pol_latest: "Latest only", pol_dropOld: "Drop oldest", pol_dropNew: "Drop newest (miss)", pol_block: "Block",
    stage_proc: "Process (inspect)", stage_draw: "Draw (display)", stage_save: "Save",
    addStage: "+ Add stage", loadActive: "Load equipment settings", saveWorkload: "Save to reproduction set", nameDup: "Empty or same name as another stage",
    draftDiff: "Draft · {n} differences from equipment v{v}", draftSame: "Same as equipment settings v{v}", loadedActive: "Loaded equipment settings v{v} into the draft",
    pre_P_GROW: "Mean processing {a} ms (divided by workers) is longer than the {b} ms arrival interval, so the queue grows without end (ρ {rho}).",
    pre_P_LOSS_KEEP: "Not enough capacity, frames will be dropped (ρ {rho}). This stage must keep every frame.",
    pre_P_DROP_OK: "Not enough capacity, frames are dropped (ρ {rho}). Fine for a display stage.",
    pre_P_P99: "The mean keeps up, but p99 {a} ms is longer than the {b} ms arrival interval (workers counted), so it falls behind at times. The queue must absorb it.",
    pre_P_KEEP_DROP: "This stage must keep every frame but uses a dropping policy. Frames are lost when the queue overflows.",
    pre_P_CAM_BLOCK: "A camera does not wait, so block right after the camera equals drop newest.",
    pre_P_BURST: "About {n} frames pile up per burst (queue size {cap}).",
    run: "Run", running: "Running", stale: "Settings changed. Press Run to recompute.", canceled: "Canceled",
    resultsTitle: "3. Results", exportLabel: "Export", expHtml: "HTML report", noResult: "No result yet. Press Run.",
    resMeta: "{w} · {n} frames · {dur} · computed in {ms} ms", verdictTitle: "Verdict",
    passAll: "Passes the Shadow criteria", failSome: "Fails: {list}", pass: "Pass", fail: "Fail",
    crit_keepLoss: "must-keep loss", crit_memory: "memory limit", crit_p99: "display latency", crit_pass: "Verdict",
    vQueueBad: "Stages that grow without end", vQueueOk: "Queues are stable", vQueueOkB: "Every process-all stage has ρ < 1",
    vMemHit: "Memory limit {lim} reached after {at}", vMemHitB: "Peak in run {peak} (the run continues past the limit)",
    vMemExtrap: "Memory limit {lim} reached after about {at} (estimate)", vMemExtrapB: "Extrapolated from the last-half slope, {rate} per hour",
    vMemOk: "Peak memory {peak} / limit {lim}", vMemOkB: "No stage keeps growing", vMemNoLimit: "Peak memory {peak}", vMemNoLimitB: "No limit set (0)",
    vLossBad: "{n} frames dropped on must-keep stages", vLossBadB: "Change queue size, workers or policy. See 'queue for zero loss'",
    vLossDisp: "{n} frames dropped on display stages", vLossDispB: "Fine, the display only shows the latest state", vLossNone: "No dropped frames", vLossNoneB: "Every stage processed every frame",
    vLat: "Display latency p99 {p}", vLatB: "Target {c} (from capture until drawn)", vLatNone: "No display stage", vLatNoneB: "Stages without 'must keep' are display stages",
    thRho: "ρ", thWait: "Mean wait", thAna: "Analytic wait", thDropped: "Dropped", thRemain: "Left at end", thMaxQ: "Max waiting", thNeedQ: "Queue for zero loss",
    approx: "approx.", needGrow: "grows without end", keepTag: "must keep", dispTag: "display", resTableCap: "Results by stage",
    chQueue: "Queue length", chQueueHint: "max per interval, frames waiting", chMem: "Memory", chMemHint: "max per interval, dashed line is the limit", chLat: "Latency distribution", chLatHint: "from capture until this stage finishes",
    asTable: "Show table", asChart: "Show chart", thRange: "Range", thCount: "Frames", thTime: "Time",
    limitLine: "limit {v}", hitLine: "limit reached at {at}", ariaQ: "Queue length chart. Max waiting by stage: {list}", ariaMem: "Memory chart. Peak {peak}, limit {lim}", ariaLat: "{s} latency distribution. p50 {p50}, p95 {p95}, p99 {p99}",
    verifyTitle: "4. Field verification", verifyHint: "Check on the same data before changing, run the new settings alongside first, and roll back at any time",
    vtRepro: "Reproduce", vtCompare: "Compare", vtSwitch: "Switch · roll back",
    reproHint: "Recompute the three synthetic scenarios and your saved data (reproduction set) with the equipment settings and the draft. When the draft differs, the results are also added to the Shadow records.",
    reproRun: "Recompute all (equipment v{v} · draft)", reproRunning: "Computing the reproduction set", reproDone: "{n} computed",
    thWorkload: "Data", thData: "Contents", thActiveV: "Equipment v{v}", thDraft: "Draft", builtinTag: "synthetic", open: "Open", delete: "Delete",
    wlLabel: "Name", wlPh: "e.g. Tool 2 log before the Nov 10 down", savedWorkload: "Saved to the reproduction set: {label}",
    sumBurst: "bursts of {n} at {fps} fps, {gap} ms pause", edited: " (edited)",
    cmpSame: "The draft equals equipment settings v{v}. Change a white cell (workers, queue size, when full) or the memory limit and run to see before and after side by side here.",
    cmpHint: "Data: {w}. Same seed, so every frame has the same arrival and processing time. Differences come from the settings.",
    cmpSettings: "Changed settings", cmpResults: "Results", cmpOnlyChg: "changed cells highlighted", cmpMemPeak: "Peak memory", cmpMemHit: "Limit reached", cmpKeepLoss: "Must-keep loss", cmpDispP99: "Display p99",
    cmpMemChart: "Memory (equipment dashed, draft solid)", ariaCmp: "Memory comparison chart. Equipment peak {a}, draft peak {b}", discardDraft: "Discard draft (back to equipment)", noLimit: "no limit", notReached: "not reached",
    shadowHint: "Every run also computes the draft on the same data and records it here. The equipment settings decide; the draft stays in the side column.",
    critTitle: "Criteria", critKeep: "No must-keep loss", critHold: "Memory limit not reached within (hours)", critP99: "Display p99 at most (ms)", critCases: "Data sets needed to switch", critSaved: "Criteria saved",
    onlyDiff: "Only where verdicts differ", clearShadow: "Clear records", thWhen: "When", thActiveCol: "Equipment (decides)", thDraftCol: "Draft (Shadow)", thDiff: "Difference", differs: "differs", oldDraft: "earlier draft", noShadow: "No records yet. Change the draft and run, or recompute the reproduction set.",
    swOk: "Ready to switch: the current draft passed on {n} different data sets.",
    sw_same: "The draft equals the current equipment settings.", sw_few: "The current draft has run on {n} data sets; {need} or more are needed ('Recompute all' on the Reproduce tab).", sw_fail: "The current draft failed the criteria on {n} data sets.",
    swNote: "Note", swNotePh: "e.g. draw latest only, save ×2", doSwitch: "Switch to draft (v{v})", switched: "Switched to equipment settings v{v}", rolledBack: "Restored the v{from} settings as v{v}",
    thVersion: "Version", thKind: "Change", thSettings: "Settings", inUse: "in use", rollback: "Roll back to this version",
    kind_first: "First settings", kind_switch: "switched from v{from}", kind_rollback: "rolled back to v{from}",
    expSettings: "Export equipment v{v} (JSON)", impSettings: "Import settings", impHint: "Imported settings only become the draft", importedDraft: "Imported settings into the draft", limitShort: "limit",
    footer: "Numbers in the synthetic scenarios and sample log are made up for illustration (not measurements of any equipment). Data stays on this device.",
    dataSection: "Data", backupExport: "Export backup (JSON)", backupImport: "Import backup", errorsExport: "Export error log", resetAll: "Erase all data on this device",
    dataHint: "Stored in this browser's IndexedDB (workloads, reproduction set, settings history, Shadow records, logs read). Nothing is sent to a server.",
    backupDone: "Backup imported. Reopening.", resetConfirm: "Erase all workloads, the reproduction set, settings history, Shadow records and logs stored on this device?",
    obTitle: "New here?",
    ob1: "The synthetic scenario <b>Slow drawing</b> is already computed. At 30 fps with a 36 ms mean draw time, the display queue grows without end and hits the memory limit.",
    ob2: "Set <b>Draw · When full</b> to Latest only in the stage table and run. 'Field verification → Compare' shows before and after side by side.",
    ob3: "Drop <b>your timing log (CSV)</b> to replay it in the same arrival order. See Help for the format.",
    obPrivacy: "Logs are read inside this browser and stored only on this device. Nothing goes to a server or outside service.", obStart: "Start",
    noIdb: "Storage (IndexedDB) is not available in this browser; your work disappears on reload.", updateReady: "A new version is ready. Reload to apply it.",
    accRunning: "Running…", thModel: "Model", thAnaWq: "Analytic wait (ms)", thSimWq: "Simulated mean wait (ms)", thErr10: "Error (mean of 10)", thErr1: "Error (1 run)", thSdRun: "Spread of 1 run (σ)", thCi: "Within 95% interval",
    accNote: "A single 100,000-frame run at ρ 0.9 varies by about ±5% from chance alone (waits are strongly correlated), so the check is whether the error of the 10-seed mean lies within that mean's 95% interval (±1.96 σ/√10). tools/accuracy.mjs in the repository runs 100 seeds and stays within 1.5% for every case.",
    err_E_POS: "Must be greater than 0", err_E_NONNEG: "Must be 0 or more", err_E_ARRIVAL: "Unknown arrival mode", err_E_LOG_TIME: "Needs a log with capture times",
    err_E_NO_STAGE: "At least one stage is needed", err_E_FROM: "Input must be the camera or a stage above", err_E_WORKERS: "Workers 1–256", err_E_POLICY: "Unknown policy",
    err_E_CAP: "Queue size must be an integer of 1 or more", err_E_DIST: "Unknown distribution", err_E_LOG_COL: "Log column missing (open the log again)",
    err_E_EMPTY: "The file is empty", err_E_COL: "Column not found: {arg}", err_E_NO_COLS: "No duration columns found. Specify them in the reading options.",
    err_E_NO_ROWS: "No readable rows. Check the reasons for unreadable rows.", err_E_LOG_MISSING: "The saved log was not found. Open the log again.",
    err_E_CANCELED: "Canceled", err_E_WORKER: "The compute worker stopped. Run again.", err_E_BACKUP: "Not a backup file of this app", err_E_SETTINGS: "Not an equipment settings file of this app", err_unknown: "Error: {msg}",
    helpHtml: help.en,
  },
};

let LANG = "ko";
export const setLang = (l) => { LANG = l === "en" ? "en" : "ko"; document.documentElement.lang = LANG; };
export const getLang = () => LANG;
export function t(key, vars) {
  let s = STR[LANG][key] ?? STR.ko[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
export function applyI18n(root) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-attr]"))
    for (const pair of el.dataset.i18nAttr.split(";")) { const [a, k] = pair.split(":"); el.setAttribute(a, t(k)); }
}
export const stageLabel = (name) => STR[LANG]["stage_" + name] ?? name;
export const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : new Intl.NumberFormat(LANG).format(v));

export function fmtDur(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const ko = LANG === "ko";
  if (ms === 0) return "0";
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(ms < 100 ? 1 : 0)} ms`;
  const s = ms / 1000;
  if (s < 59.95) return ko ? `${s.toFixed(1)}초` : `${s.toFixed(1)} s`;
  const ts = Math.round(s);
  if (ts < 3600) { const m = Math.floor(ts / 60), sec = ts % 60; return ko ? `${m}분${sec ? " " + sec + "초" : ""}` : `${m} min${sec ? " " + sec + " s" : ""}`; }
  const tm = Math.round(s / 60), h = Math.floor(tm / 60), mm = tm % 60;
  if (h < 1000) return ko ? `${h}시간${mm ? " " + mm + "분" : ""}` : `${h} h${mm ? " " + mm + " min" : ""}`;
  return ko ? `${num(h)}시간 넘음` : `over ${num(h)} h`;
}
export const fmtMs = (ms) => (ms === null || ms === undefined ? "—" : ms < 1000 ? fmtDur(ms) : fmtDur(ms));
export function fmtMB(mb, axis) {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) return "—";
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(axis ? (mb >= 10240 ? 0 : 1) : 2)} GB`;
}
export const _strings = STR;
