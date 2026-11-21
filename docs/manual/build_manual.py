# -*- coding: utf-8 -*-
"""프레임 대기열 시뮬레이터 사용자 매뉴얼(PPTX · PDF) 생성기. llm-pulse docs/manual/build_manual.py 양식을 이 앱에 맞게 고쳐 쓴다.

    python docs/manual/build_manual.py          # PPTX
    python docs/manual/build_manual.py --pdf    # PPTX + PDF (PowerPoint 필요, Windows)

스크린샷은 docs/manual/capture.mjs 로 만든 shots/*.png (1280x800 CSS px, 배율 1.5) 와
말풍선 자리 shots/marks.json (CSS px 사각형) 을 쓴다. 화면은 모두 합성 데이터다.
"""
import json
import os
import sys

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
ASSETS = os.path.join(HERE, "assets")
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "Frame-Backlog-Sim-User-Manual-ko.pptx")
VERSION = "1.0.0"
DATE = "2026.11.22"
NAME = "프레임 대기열 시뮬레이터"
MARKS = json.load(open(os.path.join(SHOTS, "marks.json"), encoding="utf-8"))
DIP = (1280, 800)

# ---------------------------------------------------------------- 디자인 토큰 (llm-pulse 매뉴얼과 같음, 강조색만 앱 색)
INK = RGBColor(0x1F, 0x29, 0x37)
SUB = RGBColor(0x5B, 0x65, 0x73)
BLUE = RGBColor(0xC0, 0x00, 0x00)
NAVY = RGBColor(0x14, 0x14, 0x18)
CARD = RGBColor(0xF3, 0xF5, 0xF8)
LINE = RGBColor(0xD9, 0xDE, 0xE5)
AMBER = RGBColor(0xE5, 0xA0, 0x2D)
AMBER_BG = RGBColor(0xFF, 0xF6, 0xE5)
AMBER_TX = RGBColor(0x7A, 0x4E, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT = RGBColor(0xF2, 0xB8, 0xB8)
FONT = "맑은 고딕"
MONO = "Consolas"

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
TOTAL = 24
state = {"n": 0}


def new_slide():
    state["n"] += 1
    return prs.slides.add_slide(prs.slide_layouts[6])


def box(s, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, radius=None, lw=0.75):
    sh = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        sh.adjustments[0] = radius
    return sh


def rbox(s, x, y, w, h, fill=CARD, line=None, radius=0.03, lw=0.75):
    return box(s, x, y, w, h, fill, line, MSO_SHAPE.ROUNDED_RECTANGLE, radius, lw)


def text(s, x, y, w, h, t, size=12, bold=False, color=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         shape=None, font=FONT, spacing=None):
    tb = shape or s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    lines = t if isinstance(t, list) else [t]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing:
            p.line_spacing = spacing
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = font
    return tb


def num_circle(s, x, y, n, d=0.3, size=11):
    c = box(s, x, y, d, d, fill=BLUE, line=WHITE, shape=MSO_SHAPE.OVAL, lw=1.5)
    text(s, 0, 0, 0, 0, str(n), size, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
    c.text_frame.margin_left = c.text_frame.margin_right = 0
    return c


# ---------------------------------------------------------------- 공통 틀
def header(s, section, title, bullets):
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, section, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, f"[대기열 시뮬레이터] {title}", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    for i, t in enumerate(bullets):
        box(s, 0.55, 1.37 + i * 0.36, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
        text(s, 0.72, 1.24 + i * 0.36, 12.1, 0.32, t, 13.5)
    footer(s)


def footer(s):
    box(s, 0.5, 7.05, 12.33, 0.01, fill=LINE)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.5), Inches(7.12), Inches(0.22), Inches(0.22))
    text(s, 0.78, 7.1, 6, 0.25, f"{NAME} 사용자 매뉴얼  ·  v{VERSION}  ·  배민혁", 9, False, SUB)
    text(s, 11.8, 7.1, 1.03, 0.25, f"{state['n']} / {TOTAL}", 9, True, SUB, PP_ALIGN.RIGHT)


# ---------------------------------------------------------------- 스크린샷 카드
def load_shot(name, crop=None, dip=DIP):
    """crop: CSS px 사각형 (x0,y0,x1,y1). 반환: (경로, 크기, 오프셋)"""
    path = os.path.join(SHOTS, f"{name}.png")
    im = Image.open(path)
    k = im.width / dip[0]
    if not crop:
        return path, dip, (0, 0)
    os.makedirs(CACHE, exist_ok=True)
    x0, y0, x1, y1 = crop
    out = os.path.join(CACHE, f"{name}_{x0}_{y0}_{x1}_{y1}.png")
    im.crop((round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))).save(out, optimize=True)
    return out, (x1 - x0, y1 - y0), (x0, y0)


def M(name, *idx):
    """marks.json 에서 말풍선 자리 고르기 (숫자 대신 사각형을 직접 줄 수도 있음)"""
    out = []
    for i in idx:
        r = MARKS[name][i] if isinstance(i, int) else i
        if r:
            out.append(tuple(r))
    return out


def shot_card(s, x, y, w, h, title, name, callouts=(), crop=None, dip=DIP, d=0.24):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    path, (dw, dh), (ox, oy) = load_shot(name, crop, dip)
    bw, bh = w - 0.4, h - 0.82  # 아래 0.2in 는 "합성 데이터" 표기 자리
    k = min(bw / dw, bh / dh)
    iw, ih = dw * k, dh * k
    ix, iy = x + (w - iw) / 2, y + 0.5
    box(s, ix - 0.02, iy - 0.02, iw + 0.04, ih + 0.04, fill=WHITE, line=LINE)
    s.shapes.add_picture(path, Inches(ix), Inches(iy), Inches(iw), Inches(ih))
    for n, r in enumerate(callouts, 1):
        x0, y0, x1, y1 = r
        x0, y0, x1, y1 = max(x0, ox), max(y0, oy), min(x1, ox + dw), min(y1, oy + dh)
        box(s, ix + (x0 - ox) * k, iy + (y0 - oy) * k, max(0.05, (x1 - x0) * k), max(0.05, (y1 - y0) * k), fill=None, line=BLUE,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08, lw=1.75)
        c = box(s, ix + (x0 - ox) * k - d / 2, iy + (y0 - oy) * k - d / 2, d, d, fill=BLUE, line=WHITE,
                shape=MSO_SHAPE.OVAL, lw=1.25)
        text(s, 0, 0, 0, 0, str(n), 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
        c.text_frame.margin_left = c.text_frame.margin_right = 0
    text(s, x + w - 3.0, y + h - 0.27, 2.85, 0.22, "※ 합성 데이터로 찍은 화면", 8.5, False, SUB, PP_ALIGN.RIGHT)


def steps_card(s, x, y, w, h, steps, title="사용 순서", tip=None, desc_size=10):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    n = len(steps)
    top = y + 0.52
    avail = h - 0.52 - (0.62 if tip else 0.15)
    pitch = min(0.8, avail / n)
    for i, (hd, ds) in enumerate(steps):
        yy = top + i * pitch
        num_circle(s, x + 0.2, yy + 0.03, i + 1)
        text(s, x + 0.62, yy - 0.02, w - 0.8, 0.28, hd, 12, True)
        text(s, x + 0.62, yy + 0.24, w - 0.8, pitch - 0.22, ds, desc_size, False, SUB)
    if tip:
        t = rbox(s, x + 0.15, y + h - 0.55, w - 0.3, 0.42, fill=AMBER_BG, line=AMBER, radius=0.15)
        text(s, 0, 0, 0, 0, "Tip  " + tip, 9.5, False, AMBER_TX, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, shape=t)
        t.text_frame.margin_left = Inches(0.12)


CY, CH = 2.45, 4.5      # 카드 영역
LX, LW = 0.5, 7.0       # 왼쪽(스크린샷) 카드
RX, RW = 7.65, 5.18     # 오른쪽(순서) 카드


def from_mark(name, idx, top=60, bottom=800):
    """화면 아래쪽에 있는 패널만 보이게 자른다: 그 표지 위 top px 부터"""
    r = MARKS[name][idx]
    return (30, max(0, r[1] - top), 1250, bottom)


def shot_steps(section, title, bullets, shot, callouts, steps, tip=None, card_title=None, crop=None, desc_size=10):
    s = new_slide()
    header(s, section, title, bullets)
    shot_card(s, LX, CY, LW, CH, card_title or title, shot, callouts, crop)
    steps_card(s, RX, CY, RW, CH, steps, tip=tip, desc_size=desc_size)
    return s



def backlog_art(s, x0, y0, w, h):
    """표지용 그림: '모든 프레임을 차례로'는 쌓이는 막대(회색), '최신만'은 바닥의 낮은 막대(빨강)"""
    n = 46
    bw = w / n
    for i in range(n):
        hh = h * (0.06 + 0.9 * i / n)
        box(s, x0 + i * bw, y0 + h - hh, bw * 0.62, hh, fill=RGBColor(0x3A, 0x3D, 0x46))
        box(s, x0 + i * bw + bw * 0.62, y0 + h - h * 0.06, bw * 0.3, h * 0.06, fill=BLUE)


# ================================================================ 1. 표지
def cover():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    backlog_art(s, 0.4, 5.45, 12.5, 1.7)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.8), Inches(0.9), Inches(0.9), Inches(0.9))
    text(s, 0.75, 2.05, 6.0, 1.0, NAME, 34, True, WHITE)
    text(s, 0.8, 2.95, 7, 0.6, "사용자 매뉴얼", 26, False, SOFT)
    box(s, 0.85, 3.7, 0.9, 0.06, fill=BLUE)
    text(s, 0.8, 3.9, 6.0, 0.9, ["이 설정이면 대기열이 쌓이는가,", "몇 시간 뒤 메모리가 넘치는가를 장비에 올리기 전에"], 15, False, RGBColor(0xC9, 0xD3, 0xE0))
    text(s, 0.8, 4.85, 7, 0.3, f"Version {VERSION}   ·   {DATE}   ·   배민혁", 11, False, RGBColor(0x8A, 0x97, 0xA8))
    path, _, _ = load_shot("Charts")
    box(s, 6.88, 0.78, 6.0, 3.77, fill=None, line=RGBColor(0x3A, 0x3A, 0x44), lw=1.5)
    s.shapes.add_picture(path, Inches(6.9), Inches(0.8), Inches(5.96), Inches(3.725))


# ================================================================ 2. 목차
def toc():
    s = new_slide()
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, "목차", 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, "목차", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    text(s, 0.55, 1.2, 12, 0.35, "처음 쓰는 분은 1~2번, 필요한 화면만 찾는 분은 오른쪽 쪽수를 보세요.", 13.5, False, SUB)
    groups = [
        ("1", "시작하기", [("3", "이 앱이 푸는 문제"), ("4", "설치와 첫 실행"), ("5", "화면 구성")]),
        ("2", "화면별 사용법", [("6", "합성 시나리오 3종"), ("7", "단계 · 장비 설정"), ("8", "실행 전 점검"), ("9", "결과: 판정 · 단계 표"), ("10", "차트"), ("11", "결과 읽는 법 · 정확도")]),
        ("3", "현장 검증 절차", [("12", "4단계 한눈에"), ("13", "재현"), ("14", "비교"), ("15", "Shadow"), ("16", "전환 · 롤백")]),
        ("4", "내 데이터", [("17", "타이밍 로그 형식 · 읽기 설정"), ("18", "읽은 결과 · 읽지 못한 줄"), ("19", "로그로 계산하기"), ("20", "넘칠 때 정책")]),
        ("5", "부록", [("21", "개인정보 · 저장 · 백업"), ("22", "영어 · 다크 · 모바일 · 키보드"), ("23", "FAQ · 문제 해결"), ("24", "버전 정보")]),
    ]
    pos = [(0.5, 1.9, 3.95, 2.45), (4.69, 1.9, 3.95, 2.45), (8.88, 1.9, 3.95, 2.45),
           (0.5, 4.5, 6.05, 2.4), (6.78, 4.5, 6.05, 2.4)]
    for (no, name, items), (x, y, w, h) in zip(groups, pos):
        rbox(s, x, y, w, h)
        num_circle(s, x + 0.2, y + 0.2, no, 0.38, 13)
        text(s, x + 0.7, y + 0.2, w - 0.9, 0.4, name, 16, True, anchor=MSO_ANCHOR.MIDDLE)
        for i, (pg, nm) in enumerate(items):
            yy = y + 0.72 + i * 0.27
            text(s, x + 0.3, yy, 0.9, 0.28, pg, 11, True, BLUE)
            text(s, x + 1.2, yy, w - 1.4, 0.28, nm, 11, False, INK)
    footer(s)


# ================================================================ 3. 소개
def intro():
    s = new_slide()
    header(s, "시작하기", "이 앱이 푸는 문제", [
        "관점: 검사 설비 SW 엔지니어가 단계별 처리 시간을 보고, 장비에 올리기 전에 대기열 · 메모리 문제를 찾는다",
        "카메라 33 ms 마다 한 장, 그리기 평균 36 ms 처럼 '조금 느린 것'이 몇 분 · 몇 시간 뒤에 끝없이 쌓여 프로그램을 멈춘다",
        "서버 없이 브라우저에서 계산하고, 타이밍 로그는 이 기기 밖으로 나가지 않는다",
    ])
    cards = [
        ("비전 단계 · 넘침 정책", "단계를 칸으로 채우면 됩니다. 넘칠 때 정책은 카메라 SDK 와 같은 5가지, 단계마다 '버리면 안 됨'을 표시합니다."),
        ("내 타이밍 로그 재생", "단계별 처리 시간 CSV 를 열 지정만으로 그대로 재생해, 같은 도착 순서에서 설정 전 / 후를 나란히 봅니다."),
        ("메모리 한도 도달 시각", "대기열 × 프레임 크기로 메모리를 따라가, 한도에 몇 분 · 몇 시간 뒤 닿는지 장비에 올리기 전에 냅니다."),
    ]
    for i, (hd, ds) in enumerate(cards):
        x = 0.5 + i * 4.19
        rbox(s, x, 2.45, 3.95, 1.95)
        num_circle(s, x + 0.2, 2.65, i + 1, 0.36)
        text(s, x + 0.68, 2.64, 3.1, 0.38, hd, 15, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.25, 3.18, 3.5, 1.1, ds, 11, False, SUB)
    text(s, 0.5, 4.62, 6, 0.3, "설정이 판단이 되기까지", 13, True)
    flow = [
        ("데이터", ["합성 시나리오 3종", "내 타이밍 로그 (CSV)"]),
        ("단계 · 장비 설정", ["작업자 · 큐 크기", "넘칠 때 정책 · 메모리 한도"]),
        ("시뮬레이션", ["대기열 · p50/p95/p99", "버린 프레임 · 한도 도달 시각"]),
        ("현장 검증", ["재현 → 비교", "Shadow → 전환 · 롤백"]),
    ]
    w, gap = 2.78, 0.4
    for i, (hd, ln) in enumerate(flow):
        x = 0.5 + i * (w + gap)
        hl = i == 2
        rbox(s, x, 5.0, w, 1.75, fill=WHITE if hl else CARD, line=BLUE if hl else None, radius=0.04, lw=2)
        text(s, x + 0.1, 5.1, w - 0.2, 0.4, hd, 14, True, BLUE if hl else INK, PP_ALIGN.CENTER)
        text(s, x + 0.1, 5.6, w - 0.2, 1.0, ln, 10.5, False, SUB, PP_ALIGN.CENTER)
        if i < 3:
            box(s, x + w + 0.06, 5.72, gap - 0.12, 0.34, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


# ================================================================ 4. 설치
def install():
    s = new_slide()
    header(s, "시작하기", "설치와 첫 실행", [
        "웹 주소를 열면 바로 쓸 수 있고, 브라우저의 '앱 설치'로 PWA 로 설치하면 오프라인에서도 열림",
        "처음 열면 안내 창이 뜨고, 합성 시나리오 '그리기 느림'이 이미 계산되어 있음",
        "서버가 없으므로 계정 · 로그인이 없음. 데이터는 이 브라우저(IndexedDB)에만 저장",
    ])
    steps_card(s, 0.5, CY, 6.0, CH, [
        ("주소 열기", "Chrome · Edge · Firefox 최신판에서 앱 주소를 엽니다."),
        ("앱 설치 (선택)", "주소창 오른쪽 '앱 설치' 아이콘 → 설치. 시작 메뉴 · 바탕 화면에서 창으로 열립니다."),
        ("첫 실행 안내", "합성 시나리오 · 최신만으로 바꿔 보기 · 내 로그 끌어다 놓기 3가지를 안내합니다."),
        ("내 PC 에서 직접 실행", "저장소 폴더에서  python -m http.server 8748 --bind 127.0.0.1  → http://127.0.0.1:8748/"),
    ], title="설치 순서", tip="새 버전이 나오면 화면 아래에 '새로고침하면 적용' 안내가 뜹니다", desc_size=10.5)
    shot_card(s, 6.75, CY, 6.08, CH, "첫 실행 안내", "Onboard", crop=(320, 200, 960, 600))


# ================================================================ 본문
def screens():
    shot_steps("시작하기", "화면 구성", [
        "오른쪽 위: 언어(한국어 · English) · 테마(시스템 · 밝게 · 어둡게) · 도움말 · 설정",
        "위에서 아래로: 1. 데이터 → 2. 단계 · 장비 설정 → 3. 결과 → 4. 현장 검증 절차",
        "단축키  Ctrl+Enter  실행",
    ], "Home", M("Home", 4, 5, 6, 7, 2), [
        ("합성 시나리오", "그리기 느림 · 버스트 촬영 · 메모리 누적. 누르면 바로 계산합니다"),
        ("내 타이밍 로그 열기", "CSV 를 고르거나 페이지에 끌어다 놓습니다"),
        ("예시 로그 (합성)", "30fps 10분 · 깨진 줄 4개가 섞인 예시. 내려받기도 됩니다"),
        ("로그 읽기 설정", "구분자 · 인코딩 · 시각 열 · 단위 · 처리 시간 열"),
        ("도움말", "정책 설명 · 로그 형식 · 결과 읽는 법 · 엔진 정확도 확인"),
    ], tip="새로고침해도 작업 데이터 · 초안 · 마지막 결과가 그대로 다시 열립니다", card_title="첫 화면")

    SEC = "화면별 사용법"
    s = new_slide()
    header(s, SEC, "합성 시나리오 3종", [
        "세 시나리오는 단계 이름(처리 · 그리기 · 저장)이 같아, 하나의 장비 설정을 셋에 그대로 적용해 비교할 수 있음",
        "처음 장비 설정(v1): 그래버 버퍼 24장 · 놓치면 새 것 버림, 그리기 · 저장은 모든 프레임을 차례로, 메모리 한도 16 GB",
        "수치는 설명용으로 만든 값이며 특정 장비의 측정값이 아님",
    ])
    sc = [
        ("그리기 느림", "30fps 고정, 그리기 평균 36 ms (감마)", ["v1: 화면 대기열 30분에 4,068장", "메모리 한도 16 GB 에 25.8분", "표시 p99 2분 14초"], "그리기 '최신만' → 대기 1장, 정점 2.45 GB, p99 88 ms"),
        ("버스트 촬영", "100장 × 120fps, 1.5초 쉼 (슬롯 촬영)", ["v1: 버스트마다 약 45장 쌓임", "버퍼 24장이라 검사 놓침 5,213장", "손실 0 필요 큐 = 50장"], "처리 큐 64장 → 놓침 0"),
        ("메모리 누적", "30fps, 저장 평균 33.7 ms (촬영 33.3 ms)", ["v1: 평균 차이 1% 뿐", "8시간 중 2.97시간에 한도 16 GB", "몇 시간 뒤 멈추는 유형"], "저장 작업자 2개 → 정점 2.45 GB"),
    ]
    for i, (hd, sub, items, fix) in enumerate(sc):
        x = 0.5 + i * 4.19
        rbox(s, x, 2.45, 3.95, 4.45, fill=WHITE, line=LINE, radius=0.03, lw=1.25)
        num_circle(s, x + 0.2, 2.62, i + 1, 0.38, 13)
        text(s, x + 0.7, 2.62, 3.1, 0.38, hd, 16, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.25, 3.12, 3.5, 0.5, sub, 11, True, SUB)
        for j, it in enumerate(items):
            box(s, x + 0.3, 3.82 + j * 0.5, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
            text(s, x + 0.45, 3.68 + j * 0.5, 3.35, 0.46, it, 11)
        t = rbox(s, x + 0.2, 5.6, 3.55, 1.05, fill=RGBColor(0xE6, 0xF4, 0xE7), line=RGBColor(0x1B, 0x6E, 0x20), radius=0.1)
        text(s, 0, 0, 0, 0, ["고친 설정", fix], 10.5, False, RGBColor(0x1B, 0x6E, 0x20), PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, shape=t)
        t.text_frame.paragraphs[0].runs[0].font.bold = True
        t.text_frame.margin_left = Inches(0.12)
    footer(s)

    shot_steps(SEC, "단계 · 장비 설정", [
        "회색 칸 = 작업 데이터(장비에서 바꿀 수 없는 것): 도착 방식 · 단계 연결 · 처리 시간 · 버리면 안 됨",
        "흰 칸 = 장비 설정(초안): 작업자 수 · 큐 크기 · 넘칠 때 정책 · 메모리 한도. 현장 검증에서 버전으로 관리",
        "입력은 카메라 또는 위쪽 단계. 한 단계를 여러 단계가 받을 수 있음 (카메라 → 처리 · 그리기)",
    ], "Config", M("Config", 0, 1, 2, 3, 4, 5, 6), [
        ("도착 방식", "고정 fps · 흔들림 · 포아송 · 버스트 · 로그의 촬영 시각"),
        ("메모리 한도", "장비 설정. 32bit 프로세스면 2 GB 안팎"),
        ("운영 시간", "몇 분 · 몇 시간을 돌릴지. 100만 프레임 약 1초"),
        ("작업 데이터", "입력 · 처리 시간 분포 · 평균 · σ"),
        ("장비 설정 (초안)", "작업자 · 큐 크기 · 넘칠 때"),
        ("넘칠 때 정책", "전부 처리 · 최신만 · 오래된 것 버림 · 새 것 버림 · 막기"),
        ("버리면 안 됨", "검사 · 저장처럼 손실이 실패인 단계"),
    ], card_title="단계 표", desc_size=9.5)

    shot_steps(SEC, "실행 전 점검", [
        "칸을 바꾸는 즉시 분포만으로 점검해 아래에 알려 줌 (실행하지 않아도 됨)",
        "빨강: 평균 처리 시간이 들어오는 간격보다 길어 끝없이 쌓임 (ρ ≥ 1)",
        "노랑: 평균은 되지만 p99 가 간격보다 길어 가끔 밀림 · 버리면 안 되는 단계에 버리는 정책",
    ], "Pre", M("Pre", 0, 1, 2, 3), [
        ("버리는 정책 경고", "필수 단계인데 큐가 넘치면 프레임을 잃습니다"),
        ("끝없이 쌓임", "평균 36.0 ms > 간격 33.3 ms, ρ 1.08"),
        ("p99 경고", "평균 24 ms 지만 p99 38 ms 가 33.3 ms 보다 김"),
        ("실행", "Ctrl+Enter. 계산 중에는 진행률과 [취소]"),
    ], tip="버스트 도착이면 '버스트 한 번에 약 N장 쌓임'으로 필요한 버퍼 수를 미리 알려 줍니다", card_title="점검 메시지")

    shot_steps(SEC, "결과: 판정 · 단계 표", [
        "맨 위 띠: Shadow 기준(필수 단계 손실 0 · 메모리 한도 · 표시 p99) 통과 여부",
        "카드 4장: 대기열 안정 · 메모리 · 버린 프레임 · 표시 지연",
        "단계 표: ρ · 대기 평균 · 분석식 · 지연 p50/p95/p99/최대 · 버림 · 끝에 남음 · 최대 대기 · 손실 0 필요 큐",
    ], "Results", M("Results", 0, 2, 3, 4, 5, 6), [
        ("판정", "실패하면 실패한 기준 이름"),
        ("대기열 · 메모리", "끝없이 쌓이는 단계, 한도 도달 시각"),
        ("버린 프레임 · 지연", "필수 단계 손실과 표시 p99"),
        ("ρ (부하)", "1 이상이면 빨강 (전부 처리 · 필수 단계)"),
        ("손실 0 필요 큐", "같은 도착열을 모두 '전부 처리'로 돌렸을 때 최대 대기"),
        ("내보내기", "HTML 보고서 · CSV · JSON"),
    ], card_title="결과", desc_size=9.5)

    shot_steps(SEC, "차트", [
        "대기열 길이: 단계마다 구간 최대. 직선으로 올라가면 끝없이 쌓이는 중",
        "메모리: 점선은 한도, 세로선은 도달 시각",
        "지연 분포: 고른 단계의 촬영 → 끝 지연 히스토그램과 p50 · p95 · p99",
    ], "Charts", M("Charts", 0, 1, 2, 3, 4), [
        ("대기열 길이", "그리기(빨강)가 30분에 4,068장까지"),
        ("메모리", "25분 46초에 16 GB 한도 도달"),
        ("지연 분포", "단계를 바꿔 볼 수 있습니다"),
        ("단계 고르기", "처리 · 그리기 · 저장"),
        ("표로 보기", "같은 값을 표로 (화면 낭독기 · 복사용)"),
    ], card_title="대기열 · 메모리 · 지연")

    s = new_slide()
    header(s, SEC, "결과 읽는 법 · 정확도", [
        "ρ = 들어오는 비율 × 평균 처리 시간 ÷ 작업자 수. '전부 처리'에서 ρ ≥ 1 이면 큐를 키워도 넘치는 시점만 늦춰짐",
        "메모리 = (대기열 + 처리 중인 프레임) × 프레임 크기 + 기본 사용량. 기간 밖이면 끝 절반 기울기로 외삽(추정)",
        "같은 시드면 프레임마다 같은 도착 · 같은 처리 시간 → 설정 A 와 B 의 차이는 설정 때문",
    ])
    shot_card(s, LX, CY, LW, CH, "도움말 → 엔진 정확도 확인", "Accuracy", M("Accuracy", 0))
    steps_card(s, RX, CY, RW, CH, [
        ("분석식과 대조", "M/M/1 · M/D/1 · M/M/3 (포아송) · D/M/1 (고정 fps), ρ 0.5 · 0.7 · 0.9, 10만 프레임 × 시드 10개"),
        ("95% 구간 판정", "1회 결과는 ρ 0.9 에서 ±5% 흔들립니다. 평균 오차가 95% 구간 안이면 ✓"),
        ("저장소 측정", "tools/accuracy.mjs (시드 100개): 모든 경우 1.45% 이내"),
        ("결과 표의 분석식", "카메라 바로 뒤 '전부 처리' 단계만. 근사(Kingman)는 고정 fps 에서 크게 잡는 편"),
    ], title="정확도", desc_size=10)


def flow_overview():
    s = new_slide()
    header(s, "현장 검증 절차", "4단계 한눈에", [
        "바꾸기 전에 같은 데이터로 확인하고, 새 설정은 옆에서 먼저 돌려 보고, 언제든 되돌린다",
        "'장비 설정'은 버전으로 관리되는 지금 설정, '초안'은 단계 표의 흰 칸에서 고치는 설정",
        "오른쪽 위 배지: '장비 설정 v1 와 같음' 또는 '초안 · 장비 설정 v1 와 3곳 다름'",
    ])
    st = [
        ("재현", "재현 세트를 한 번에 다시 계산", ["합성 시나리오 3종 기본", "내 데이터는 '재현 세트에 저장'", "장비 설정 · 초안 판정을 나란히"]),
        ("비교", "같은 도착열로 A / B", ["바뀐 설정만 표로", "바뀐 결과 칸 강조", "메모리 곡선 겹쳐 보기"]),
        ("Shadow", "초안은 옆 칸에서만", ["실행마다 초안도 계산해 기록", "판정은 장비 설정이", "판정이 다른 것만 모아 보기"]),
        ("전환 · 롤백", "기준을 넘으면 전환", ["서로 다른 데이터 3개 이상 통과", "모든 버전이 남음", "한 번에 되돌리기 · 내보내기"]),
    ]
    w, gap = 2.85, 0.31
    for i, (hd, sub, items) in enumerate(st):
        x = 0.5 + i * (w + gap)
        rbox(s, x, 2.6, w, 3.9, fill=WHITE, line=BLUE if i == 0 else LINE, radius=0.04, lw=1.5)
        num_circle(s, x + 0.2, 2.8, i + 1, 0.42, 14)
        text(s, x + 0.75, 2.8, w - 0.9, 0.42, hd, 17, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.2, 3.4, w - 0.4, 0.6, sub, 11.5, True, SUB)
        for j, it in enumerate(items):
            box(s, x + 0.25, 4.22 + j * 0.55, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
            text(s, x + 0.4, 4.08 + j * 0.55, w - 0.55, 0.5, it, 11)
        if i < 3:
            box(s, x + w + 0.03, 4.3, gap - 0.06, 0.3, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


def verify():
    SEC = "현장 검증 절차"
    shot_steps(SEC, "① 재현", [
        "재현 세트 = 합성 시나리오 3종 + '재현 세트에 저장'한 내 데이터 (로그로 만든 데이터도 포함)",
        "'모두 다시 계산'은 세트 전체를 지금 장비 설정과 초안으로 계산해 판정을 나란히 보여 줌",
        "초안이 장비 설정과 다르면 계산 결과가 Shadow 기록에도 쌓임",
    ], "Repro", M("Repro", 0, 1, 2, 3, 4, 5), [
        ("재현 탭", "현장 검증 절차의 첫 단계"),
        ("모두 다시 계산", "3종이면 약 3~4초"),
        ("장비 설정 판정", "v1: 필수 단계 손실 · 메모리 한도 · 표시 지연"),
        ("초안 판정", "고친 초안: 통과"),
        ("열기", "그 데이터를 단계 표로 열고 계산합니다"),
        ("이름 · 저장", "지금 데이터를 재현 세트에 넣습니다"),
    ], card_title="재현 세트", desc_size=9.5, crop=from_mark("Repro", 0))

    shot_steps(SEC, "② 비교", [
        "같은 시드 · 같은 로그라 프레임마다 도착 시각 · 처리 시간이 같음. 차이는 설정 때문",
        "왼쪽: 바뀐 설정만. 오른쪽: 판정 · 메모리 · 한도 도달 · 손실 · p99 · 단계별 버림 · 최대 대기",
        "'초안 버리기'로 초안을 지금 장비 설정으로 되돌림",
    ], "Compare", M("Compare", 0, 1, 2, 3), [
        ("배지", "초안이 장비 설정과 몇 곳 다른지"),
        ("바뀐 설정", "처리 큐 24 → 64, 그리기 전부 처리 → 최신만, 저장 작업자 1 → 2"),
        ("판정", "실패 → 통과"),
        ("한도 도달", "25분 46초 → 도달 안 함"),
    ], tip="그리기에서 5,695장을 버려도 '표시' 단계라 실패가 아닙니다", card_title="장비 설정 v1 vs 초안")

    shot_steps(SEC, "③ Shadow", [
        "실행할 때마다(합성 · 로그 · 재현 세트) 초안도 같은 데이터로 계산해 기록. 결정은 장비 설정",
        "기준: 필수 단계 손실 0 · 메모리 한도 N 시간 안에 도달 없음 · 표시 p99 기준 이하",
        "기준 값과 전환에 필요한 데이터 수는 이 탭에서 바꿈",
    ], "Shadow", M("Shadow", 0, 1, 2, 3, 4), [
        ("기준", "24시간 · 250 ms · 데이터 3개 (기본)"),
        ("판정이 다른 것만", "장비 설정과 초안의 판정이 갈린 기록만"),
        ("장비 설정 (판정)", "그때의 버전과 실패 이유"),
        ("초안 (Shadow)", "옆 칸의 결과"),
        ("차이", "판정이 다르면 '다름'"),
    ], card_title="Shadow 기록", crop=from_mark("Shadow", 0, 120))

    s = new_slide()
    header(s, SEC, "④ 전환 · 롤백", [
        "지금 초안이 서로 다른 데이터 3개 이상에서 기준을 통과하면 전환 버튼이 켜짐",
        "전환하면 초안이 새 장비 설정 버전(v2)이 되고, 모든 버전 · 메모가 남음",
        "'이 버전으로 되돌리기'는 그 버전의 설정을 새 버전으로 다시 적용 (되돌림도 이력에 남음)",
    ])
    shot_card(s, 0.5, CY, 6.08, CH, "전환 가능", "SwitchReady", M("SwitchReady", 0, 1, 2), crop=from_mark("SwitchReady", 0, 140, 720))
    shot_card(s, 6.75, CY, 6.08, CH, "전환 뒤 이력", "Switch", M("Switch", 1, 2, 3, 4), crop=from_mark("Switch", 0, 30, 760))


def data():
    SEC = "내 데이터"
    shot_steps(SEC, "타이밍 로그 형식 · 읽기 설정", [
        "한 줄 = 한 프레임. 촬영 시각 열(선택)과 단계별 처리 시간 열",
        "시각: 날짜 시각(µs 까지) 또는 숫자(ms · 초 · µs). 처리 시간: 숫자 열 또는 X_start · X_end 쌍(끝 - 시작)",
        "예: frame,grab_time,proc_start,proc_end,draw_ms,save_ms",
    ], "ReadOpts", M("ReadOpts", 0, 1, 2, 3, 4, 5, 6), [
        ("구분자", "자동 · 쉼표 · Tab · ; · |"),
        ("인코딩", "자동 (UTF-8 → EUC-KR)"),
        ("촬영 시각 열", "이름 · 번호, 쓰지 않으려면 none"),
        ("시각 단위", "자동 · ms · 초 · µs · 날짜 시각"),
        ("처리 시간 단위", "ms · 초 · µs"),
        ("처리 시간 열", "예: proc_end-proc_start, draw_ms"),
        ("다시 읽기", "같은 파일을 바뀐 설정으로"),
    ], tip="비워 두면 머리글로 찾습니다: time · timestamp · grab_time, frame · id 는 뺌", card_title="로그 읽기 설정", desc_size=9.5)

    shot_steps(SEC, "읽은 결과 · 읽지 못한 줄", [
        "읽은 줄 수 · 시각 열 · 처리 시간 열 · 읽지 못한 줄 수를 요약",
        "읽지 못한 줄은 줄 번호 · 이유 · 내용을 보여 주고 건너뜀 (처음 200줄, 나머지는 개수)",
        "열마다 n · 평균 · σ · p50/p95/p99 · 최대와 정규 · 로그정규 · 감마 적합(KS 거리)",
    ], "LogData", M("LogData", 0, 1, 2, 3, 4, 5), [
        ("촬영 시각 열", "grab_time · 10분"),
        ("처리 시간 열", "proc(시작/끝 쌍) · draw · save"),
        ("읽지 못한 줄", "숫자 아님 · 열 부족 · 0 이하 · 시각 역전"),
        ("줄 번호 · 이유", "펼쳐서 봅니다"),
        ("가장 잘 맞는 분포", "KS 거리가 가장 작은 것"),
        ("적합 분포 쓰기", "로그 재생 대신 분포로 (기간을 늘릴 때)"),
    ], card_title="예시 로그 (합성)", desc_size=9.5)

    shot_steps(SEC, "로그로 계산하기", [
        "로그를 열면 열마다 단계가 하나씩 생기고, 촬영 시각이 있으면 도착은 '로그의 촬영 시각'",
        "처리 시간: '로그 그대로'(프레임 순서대로, 끝나면 처음부터) · '로그 무작위' · 적합 분포",
        "이름이 proc · draw · save 면 합성 시나리오와 같은 장비 설정이 그대로 적용됨",
    ], "LogConfig", M("LogConfig", 0, 1, 3), [
        ("처리 시간", "로그 proc 그대로 · 로그 proc 무작위 · 분포"),
        ("로그 요약", "그 열의 평균 · p99"),
        ("실행", "같은 도착 순서로 장비 설정 · 초안을 계산"),
    ], tip="몇 시간 운영을 보려면 운영 시간을 늘리세요. 로그는 반복 재생됩니다", card_title="로그 재생")

    s = new_slide()
    header(s, SEC, "넘칠 때 정책", [
        "큐 크기 = 기다릴 수 있는 프레임 수 (처리 중인 것 제외). '전부 처리'는 제한 없음, '최신만'은 1",
        "카메라는 기다리지 않으므로 카메라 바로 뒤의 '막기'는 '새 것 버림'과 같음",
        "버려도 되는 것(화면 표시)과 버리면 안 되는 것(검사 결과 · 저장 영상)은 다른 단계로 나눔",
    ])
    rows = [
        ("전부 처리", "모든 프레임을 차례로. 큐 제한 없음", "검사 · 저장 (처리 능력이 충분할 때)", "Basler OneByOne"),
        ("최신만", "기다리는 프레임 1장. 새 프레임이 오면 기다리던 것을 버림", "화면 표시", "Basler LatestImageOnly"),
        ("오래된 것 버림", "큐가 차면 가장 오래 기다린 프레임을 버림", "최근 N장만 보면 되는 미리보기", "Basler LatestImages, GStreamer leaky=downstream"),
        ("새 것 버림 (놓침)", "큐가 차면 새로 온 프레임을 받지 않음", "그래버 버퍼 수 검토", "그래버 놓친 프레임, GStreamer leaky=upstream"),
        ("막기", "큐가 차면 앞 단계 작업자가 프레임을 쥐고 기다림", "단계 사이 흐름 제어", "GStreamer queue 기본"),
    ]
    cols = [("정책", 2.0), ("동작", 4.1), ("어울리는 곳", 3.0), ("카메라 SDK 의 비슷한 설정", 3.23)]
    y = CY
    x = 0.5
    rbox(s, 0.5, y, 12.33, 0.42, fill=INK, radius=0.05)
    for name, w in cols:
        text(s, x + 0.1, y + 0.06, w - 0.2, 0.3, name, 11.5, True, WHITE)
        x += w
    for i, r in enumerate(rows):
        yy = y + 0.5 + i * 0.78
        rbox(s, 0.5, yy, 12.33, 0.7, fill=CARD if i % 2 == 0 else WHITE, line=LINE, radius=0.05)
        x = 0.5
        for j, (cell, (_, w)) in enumerate(zip(r, cols)):
            text(s, x + 0.1, yy + 0.08, w - 0.2, 0.56, cell, 12 if j == 0 else 10.5, j == 0, BLUE if j == 0 else INK, anchor=MSO_ANCHOR.MIDDLE)
            x += w


def appendix():
    s = new_slide()
    header(s, "부록", "개인정보 · 저장 · 백업", [
        "로그는 이 브라우저 안에서만 읽고, 작업 데이터 · 재현 세트 · 설정 이력 · Shadow 기록 · 읽은 로그는 이 기기의 IndexedDB 에만 저장",
        "서버 · 외부 서비스로 보내는 것이 없고, LLM 도 쓰지 않음 (계산만 하는 앱이라 API 키가 필요 없음)",
        "다른 PC 로 옮기려면 설정 → 백업 내보내기(JSON) → 그 PC 에서 백업 가져오기",
    ])
    shot_card(s, LX, CY, LW, CH, "설정 → 데이터", "Settings", M("Settings", 0, 1, 2, 3), crop=(320, 200, 960, 600))
    steps_card(s, RX, CY, RW, CH, [
        ("백업 내보내기 (JSON)", "로그 숫자 배열까지 모두 한 파일로"),
        ("백업 가져오기", "가져온 뒤 다시 엽니다"),
        ("오류 기록 내보내기", "예기치 않은 오류는 이 기기에만 최근 200건 남습니다"),
        ("모두 지우기", "확인 창을 거쳐 이 기기의 데이터를 모두 지웁니다"),
    ], title="데이터 관리", tip="사생활 보호 창처럼 IndexedDB 를 못 쓰면 안내가 뜨고, 새로고침하면 작업이 사라집니다", desc_size=10)

    s = new_slide()
    header(s, "부록", "영어 · 다크 · 모바일 · 키보드", [
        "오른쪽 위에서 한국어 · English 를 바꾸면 화면 문구 · 점검 메시지 · 판정 · 도움말이 함께 바뀜",
        "테마 버튼: 시스템 → 밝게 → 어둡게. 휴대폰 폭에서도 같은 기능 (표는 옆으로 밀어 봄)",
        "차트는 '표로 보기'로 같은 값을 표로 볼 수 있음 (화면 낭독기용)",
    ])
    path, _, _ = load_shot("EnResults")
    rbox(s, 0.5, CY, 6.6, CH)
    text(s, 0.65, CY + 0.1, 6, 0.32, "English", 13, True)
    s.shapes.add_picture(path, Inches(0.7), Inches(CY + 0.5), Inches(6.2), Inches(3.875))
    p2, _, _ = load_shot("MobileDark", dip=(390, 844))
    rbox(s, 7.3, CY, 2.3, CH)
    text(s, 7.45, CY + 0.1, 2.0, 0.32, "모바일 · 다크", 13, True)
    s.shapes.add_picture(p2, Inches(7.55), Inches(CY + 0.5), Inches(1.8), Inches(1.8 * 844 / 390))
    rbox(s, 9.8, CY, 3.03, CH)
    text(s, 9.95, CY + 0.1, 2.8, 0.32, "단축키", 13, True)
    keys = [("Ctrl+Enter", "실행"), ("Tab", "칸 이동"), ("← →", "현장 검증 탭 이동"), ("Home End", "첫 · 끝 탭"), ("Esc", "대화상자 닫기")]
    for i, (k, d) in enumerate(keys):
        yy = CY + 0.6 + i * 0.6
        chip = rbox(s, 9.95, yy, 1.25, 0.38, fill=INK, radius=0.2)
        text(s, 0, 0, 0, 0, k, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=chip, font=MONO)
        text(s, 11.3, yy, 1.5, 0.38, d, 10.5, False, INK, anchor=MSO_ANCHOR.MIDDLE)


def faq():
    s = new_slide()
    header(s, "부록", "FAQ · 문제 해결", [
        "대부분은 '로그 읽기 설정'과 단계 표로 해결. 도움말 창에도 같은 내용이 있음",
        "예기치 않은 오류는 설정 → 오류 기록에 이 기기에만 남음 (외부로 보내지 않음)",
        "데이터 백업 · 가져오기 · 전체 삭제는 설정 → 데이터",
    ])
    qa = [
        ("장비에서 잰 것과 결과가 달라요", "단계끼리 CPU · 메모리 대역 · 락을 나눠 쓰며 느려지는 효과는 모델에 없습니다. 장비 타이밍 로그를 '그대로 재생'하면 그 효과가 든 측정값으로 계산합니다."),
        ("처리 시간 열을 못 찾아요", "로그 읽기 설정의 '처리 시간 열'에 이름 · 번호를 쉼표로 적으세요. 끝-시작은 proc_end-proc_start 처럼."),
        ("시각이 이상하게 읽혀요", "'시각 단위'를 ms · 초 · µs · 날짜 시각 중에서 직접 고르세요. 시각이 앞 줄보다 이른 줄은 건너뜁니다."),
        ("한글 머리글이 깨져요", "인코딩을 EUC-KR 로 고정하고 '다시 읽기'를 누르세요."),
        ("한도 도달이 '추정'이에요", "운영 시간 안에 한도에 닿지 않아 끝 절반 기울기로 외삽했습니다. 운영 시간을 늘리면 시뮬 값이 됩니다."),
        ("결과가 실행마다 같아요", "같은 시드면 같은 결과입니다. 우연의 폭을 보려면 시드를 바꿔 여러 번 돌리세요."),
        ("표시 단계에서 많이 버려도 되나요?", "화면은 지금 상태만 보여 주면 되므로 '최신만'이 정상입니다. 판정은 표시 지연 p99 로 합니다."),
        ("오프라인에서도 되나요?", "한 번 열면 앱 파일이 저장되어 오프라인으로 열고 계산합니다."),
    ]
    cw, ch = 6.05, 1.02
    for i, (q, a) in enumerate(qa):
        col, row = i % 2, i // 2
        x = 0.5 + col * (cw + 0.23)
        y = CY + row * (ch + 0.13)
        rbox(s, x, y, cw, ch)
        text(s, x + 0.15, y + 0.08, 0.4, 0.32, "Q", 13, True, BLUE)
        text(s, x + 0.5, y + 0.08, cw - 0.65, 0.32, q, 12, True)
        text(s, x + 0.5, y + 0.42, cw - 0.65, 0.56, a, 10, False, SUB)


def back():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    backlog_art(s, 0.4, 2.2, 12.5, 1.6)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(6.2), Inches(0.9), Inches(0.9), Inches(0.9))
    text(s, 0, 4.4, 13.333, 0.6, NAME, 30, True, WHITE, PP_ALIGN.CENTER)
    text(s, 0, 5.05, 13.333, 0.4, "대기열 · 지연 p50/p95/p99 · 버린 프레임 · 메모리 한도 도달 시각을 장비에 올리기 전에", 13, False, RGBColor(0xC9, 0xD3, 0xE0), PP_ALIGN.CENTER)
    text(s, 0, 5.7, 13.333, 0.6, [f"v{VERSION}   ·   만든 사람 배민혁   ·   MIT License   ·   © 2026",
                                  "포함: Pretendard (SIL OFL 1.1) · 합성 시나리오 · 예시 로그와 화면은 모두 합성 데이터"],
         10, False, RGBColor(0x8A, 0x97, 0xA8), PP_ALIGN.CENTER)


def to_pdf(pptx):
    """PowerPoint(COM)로 PDF 저장. Windows + PowerPoint 필요"""
    import subprocess
    pdf = pptx[:-5] + ".pdf"
    ps = ("$p = New-Object -ComObject PowerPoint.Application; "
          f"$d = $p.Presentations.Open('{pptx}', $true, $false, $false); "
          f"$d.SaveAs('{pdf}', 32); $d.Close(); $p.Quit()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    print("saved", pdf)


def main():
    cover()            # 1
    toc()              # 2
    intro()            # 3
    install()          # 4
    screens()          # 5–11
    flow_overview()    # 12
    verify()           # 13–16
    data()             # 17–20
    appendix()         # 21–22
    faq()              # 23
    back()             # 24
    assert state["n"] == TOTAL, state["n"]
    prs.save(OUT)
    print("saved", OUT)
    if "--pdf" in sys.argv:
        to_pdf(OUT)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
