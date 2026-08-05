#!/usr/bin/env python3
from __future__ import annotations

import html
from pathlib import Path

try:
    import cairosvg
except ModuleNotFoundError:  # pragma: no cover - depends on the local render toolchain
    cairosvg = None

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'design' / 'references'
SOURCE = OUTPUT / 'source'

PAPER = '#050711'
SURFACE = '#0b1220'
INK = '#f5f7ff'
MUTED = '#9ba8c3'
LINE = '#2a3854'
SOFT_LINE = '#18243a'
BODY = '#c4cde0'
ACCENT = '#9b5cff'
BRAND = '#9b5cff'
FONT = 'Arial, Helvetica, sans-serif'


def text(
    x: float,
    y: float,
    value: str,
    size: float,
    weight: int = 400,
    fill: str = INK,
    anchor: str = 'start',
    letter: float = 0,
) -> str:
    return (
        f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" '
        f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" '
        f'letter-spacing="{letter}">{html.escape(value)}</text>'
    )


def line(x1: float, y1: float, x2: float, y2: float, color: str = LINE, width: float = 1) -> str:
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}" />'


def rect(x: float, y: float, width: float, height: float, fill: str, radius: float = 0, stroke: str | None = None) -> str:
    stroke_attr = f' stroke="{stroke}" stroke-width="1"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}"{stroke_attr}/>'


def wrap(value: str, max_chars: int) -> list[str]:
    words = value.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = ' '.join([*current, word])
        if current and len(candidate) > max_chars:
            lines.append(' '.join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(' '.join(current))
    return lines


def multiline(x: float, y: float, value: str, size: float, max_chars: int, line_height: float, weight: int = 400, fill: str = INK) -> str:
    return ''.join(text(x, y + index * line_height, entry, size, weight, fill) for index, entry in enumerate(wrap(value, max_chars)))


def shell(width: int, height: int, content: str, mobile: bool = False) -> str:
    margin = 24 if mobile else 76
    header_height = 66 if mobile else 76
    mark_size = 26 if mobile else 28
    brand_x = margin
    brand_y = header_height / 2
    nav_x = width - margin
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<rect width="{width}" height="{height}" fill="{PAPER}" />
{line(0, header_height, width, header_height, SOFT_LINE)}
{rect(brand_x, brand_y - mark_size / 2, mark_size, mark_size, BRAND, 8)}
{text(brand_x + mark_size / 2, brand_y + 4.5, 'A', 12, 700, '#ffffff', 'middle')}
{text(brand_x + mark_size + 10, brand_y + 5.5, 'AppSea', 15, 700)}
{text(nav_x, brand_y + 5, 'Leaderboard', 13, 600, MUTED, 'end')}
{content}
</svg>'''


def leaderboard(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 132 if mobile else 180
    title_size = 44 if mobile else 62
    table_top = top + (82 if mobile else 114)
    table_width = width - margin * 2
    rows = [
        ('01', 'Inbox Relay', '482', '80.3'),
        ('02', 'Receipt Vault', '371', '75.1'),
        ('03', 'Subscription Auditor', '296', '70.1'),
        ('04', 'Handoff Memory', '244', '70.1'),
        ('05', 'Form Debugger', '203', '65.6'),
        ('06', 'Decision Ledger', '187', '63.2')
    ]
    if mobile:
        columns = (margin, margin + 42, width - margin - 58, width - margin)
        row_height = 66
        content = text(margin, top, 'Leaderboard', title_size, 650, letter=-2.2)
        content += line(margin, table_top, width - margin, table_top, INK)
        content += text(columns[0], table_top + 28, 'RANK', 9, 700, MUTED, letter=0.6)
        content += text(columns[1], table_top + 28, 'OPPORTUNITY', 9, 700, MUTED, letter=0.4)
        content += text(columns[2], table_top + 28, 'COUNT', 9, 700, MUTED, 'end', 0.4)
        content += text(columns[3], table_top + 28, 'SCORE', 9, 700, MUTED, 'end', 0.4)
        content += line(margin, table_top + 42, width - margin, table_top + 42)
        for index, row in enumerate(rows):
            y = table_top + 42 + row_height * index
            content += text(columns[0], y + 40, row[0], 12, 400, MUTED)
            content += text(columns[1], y + 40, row[1], 16, 600)
            content += text(columns[2], y + 40, row[2], 12, 400, MUTED, 'end')
            content += text(columns[3], y + 40, row[3], 13, 650, INK, 'end')
            content += line(margin, y + row_height, width - margin, y + row_height)
        content += text(margin, min(height - 28, table_top + 42 + row_height * len(rows) + 28), 'Synthetic fixture ranking.', 10, 400, MUTED)
        return shell(width, height, content, mobile)

    columns = (margin, margin + 80, width - margin - 150, width - margin)
    row_height = 78
    content = text(margin, top, 'Leaderboard', title_size, 650, letter=-3.1)
    content += line(margin, table_top, width - margin, table_top, INK)
    content += text(columns[0], table_top + 29, 'RANK', 11, 700, MUTED, letter=1.0)
    content += text(columns[1], table_top + 29, 'OPPORTUNITY', 11, 700, MUTED, letter=1.0)
    content += text(columns[2], table_top + 29, 'COMPLAINTS', 11, 700, MUTED, 'end', 1.0)
    content += text(columns[3], table_top + 29, 'SCORE', 11, 700, MUTED, 'end', 1.0)
    content += line(margin, table_top + 46, width - margin, table_top + 46)
    for index, row in enumerate(rows):
        y = table_top + 46 + row_height * index
        content += text(columns[0], y + 48, row[0], 13, 400, MUTED)
        content += text(columns[1], y + 48, row[1], 23, 600, INK, letter=-0.45)
        content += text(columns[2], y + 48, row[2], 14, 400, MUTED, 'end')
        content += text(columns[3], y + 48, row[3], 19, 650, INK, 'end')
        content += line(margin, y + row_height, width - margin, y + row_height)
    content += text(margin, table_top + 46 + row_height * len(rows) + 28, 'Synthetic fixture ranking for product and interface validation.', 11, 400, MUTED)
    return shell(width, height, content, mobile)


def opportunity_header(width: int, mobile: bool, active: str) -> tuple[str, int, int]:
    margin = 24 if mobile else 220
    top = 112 if mobile else 130
    content = text(margin, top, 'Leaderboard  /  Inbox Relay', 11 if mobile else 12, 400, MUTED)
    content += text(margin, top + 52, 'OPPORTUNITY 80.3', 10 if mobile else 11, 700, MUTED, letter=1.2)
    content += text(margin, top + (96 if mobile else 104), 'Inbox Relay', 42 if mobile else 62, 650, INK, letter=-2.4 if mobile else -3.2)
    content += multiline(margin, top + (133 if mobile else 146), 'A reliable handoff layer for shared team inboxes.', 15 if mobile else 18, 42 if mobile else 64, 24 if mobile else 28, fill=MUTED)
    tabs_y = top + (205 if mobile else 224)
    labels = [('Overview', 'overview'), ('Complaints', 'complaints'), ('Competitors', 'competitors'), ('Coding plan', 'plan')]
    x = margin
    for label, key in labels:
        content += text(x, tabs_y, label, 12 if mobile else 13, 600, INK if active == key else MUTED)
        if active == key:
            content += line(x, tabs_y + 17, x + (58 if label == 'Overview' else len(label) * 7), tabs_y + 17, INK, 2)
        x += (86 if mobile else 116)
    content += line(margin, tabs_y + 18, width - margin, tabs_y + 18)
    return content, margin, tabs_y + 18


def opportunity_screen(width: int, height: int, mobile: bool) -> str:
    content, margin, base = opportunity_header(width, mobile, 'overview')
    y = base + (48 if mobile else 66)
    content += text(margin, y, 'THESIS', 10, 700, MUTED, letter=1.2)
    thesis = 'Small support teams need a clear ownership trail and shift handoff without adopting a large service platform.'
    content += multiline(margin, y + 38, thesis, 25 if mobile else 37, 29 if mobile else 56, 34 if mobile else 48, 500)
    detail_y = y + (174 if mobile else 184)
    content += line(margin, detail_y, width - margin, detail_y)
    if mobile:
        content += text(margin, detail_y + 34, 'AUDIENCE', 10, 700, MUTED, letter=1.1)
        content += multiline(margin, detail_y + 62, 'Small support and operations teams using shared email.', 14, 42, 22, fill=BODY)
        content += text(margin, detail_y + 132, 'FIRST WEDGE', 10, 700, MUTED, letter=1.1)
        content += multiline(margin, detail_y + 160, 'Read-only inbox sync, ownership history, unresolved handoffs, and a shift summary.', 14, 42, 22, fill=BODY)
    else:
        half = (width - margin * 2 - 64) / 2
        content += text(margin, detail_y + 38, 'AUDIENCE', 10, 700, MUTED, letter=1.1)
        content += multiline(margin, detail_y + 70, 'Small support, customer success, and operations teams using shared email.', 15, 48, 24, fill=BODY)
        content += text(margin + half + 64, detail_y + 38, 'FIRST WEDGE', 10, 700, MUTED, letter=1.1)
        content += multiline(margin + half + 64, detail_y + 70, 'Read-only inbox sync with ownership history, unresolved handoff queue, and shift summary.', 15, 48, 24, fill=BODY)
    return shell(width, height, content, mobile)


def complaints_screen(width: int, height: int, mobile: bool) -> str:
    content, margin, base = opportunity_header(width, mobile, 'complaints')
    y = base + (48 if mobile else 60)
    content += text(margin, y, 'Curated complaints', 25 if mobile else 28, 650, letter=-0.8)
    if not mobile:
        content += text(width - margin, y, 'Representative synthetic observations.', 13, 400, MUTED, 'end')
    content += line(margin, y + 28, width - margin, y + 28)
    items = [
        ('TeamMail · handoff loss', 'Assigned messages disappear from the team view after ownership changes.'),
        ('TeamMail · handoff loss', 'A teammate cannot see why a conversation was reassigned or what happened before.'),
        ('SupportBox · state drift', 'Solved threads return as unread and create duplicate work for the next shift.'),
        ('SupportBox · accountability gap', 'The team cannot tell who changed an owner, status, or priority during a busy handoff.')
    ]
    row_h = 105 if mobile else 116
    for index, (meta, body) in enumerate(items):
        row_y = y + 28 + index * row_h
        content += text(margin, row_y + 29, meta, 10 if mobile else 11, 400, MUTED)
        content += multiline(margin, row_y + 59, body, 15 if mobile else 18, 43 if mobile else 78, 22 if mobile else 27, 500)
        content += line(margin, row_y + row_h, width - margin, row_y + row_h)
    return shell(width, height, content, mobile)


def competitors_screen(width: int, height: int, mobile: bool) -> str:
    content, margin, base = opportunity_header(width, mobile, 'competitors')
    y = base + (48 if mobile else 60)
    content += text(margin, y, 'Competitors and alternatives', 24 if mobile else 28, 650, letter=-0.8)
    content += line(margin, y + 28, width - margin, y + 28)
    items = [
        (
            'Shared inbox suites',
            'direct',
            'Broad routing, but complex setup and weak handoff reasoning.',
            'Handoff history partial / cross-shift summary missing.'
        ),
        (
            'Email labels and rules',
            'platform',
            'Already available, but no durable ownership history.',
            'Routing rules supported / handoff history missing.'
        ),
        (
            'Shift handoff document',
            'workaround',
            'Flexible, but stale and dependent on manual discipline.',
            'Handoff summary supported / live state sync missing.'
        )
    ]
    row_h = 140 if mobile else 150
    for index, (name, kind, body, coverage) in enumerate(items):
        row_y = y + 28 + index * row_h
        content += text(margin, row_y + 37, name, 17 if mobile else 21, 650, letter=-0.3)
        content += text(width - margin, row_y + 37, kind, 10 if mobile else 11, 400, MUTED, 'end')
        content += multiline(margin, row_y + 70, body, 13 if mobile else 15, 45 if mobile else 82, 21 if mobile else 24, fill=BODY)
        content += text(margin, row_y + 105, 'FEATURE COVERAGE', 9, 700, MUTED, letter=0.8)
        content += multiline(margin, row_y + 126, coverage, 11 if mobile else 12, 48 if mobile else 92, 17 if mobile else 19, fill=MUTED)
        content += line(margin, row_y + row_h, width - margin, row_y + row_h)
    risk_y = y + 28 + row_h * len(items) + 36
    content += rect(margin, risk_y, width - margin * 2, 104 if mobile else 112, SURFACE, 0, LINE)
    content += text(margin + 22, risk_y + 29, 'CONTRARY EVIDENCE', 10, 700, MUTED, letter=1.1)
    content += multiline(margin + 22, risk_y + 59, 'Existing shared inbox suites may solve the problem through better configuration.', 13 if mobile else 14, 43 if mobile else 92, 21, fill=BODY)
    return shell(width, height, content, mobile)


def plan_screen(width: int, height: int, mobile: bool) -> str:
    content, margin, base = opportunity_header(width, mobile, 'plan')
    y = base + (48 if mobile else 60)
    content += text(margin, y, 'Coding-agent package', 25 if mobile else 28, 650, letter=-0.8)
    content += line(margin, y + 28, width - margin, y + 28)
    files = ['README.md', '01-product-brief.md', '02-mvp-scope.md', '03-architecture.md', '04-task-graph.json', '05-validation.md']
    steps = ['Define provider contracts', 'Build idempotent sync', 'Store ownership history', 'Create the handoff queue', 'Validate end to end']
    if mobile:
        content += text(margin, y + 68, 'PACKAGE FILES', 10, 700, MUTED, letter=1.1)
        for index, value in enumerate(files):
            yy = y + 102 + index * 38
            content += text(margin, yy, f'{index + 1:02d}', 10, 400, MUTED)
            content += text(margin + 34, yy, value, 12, 400)
            content += line(margin, yy + 15, width - margin, yy + 15)
        sy = y + 102 + len(files) * 38 + 34
        content += text(margin, sy, 'FIRST BUILD SEQUENCE', 10, 700, MUTED, letter=1.1)
        for index, value in enumerate(steps):
            yy = sy + 36 + index * 42
            content += text(margin, yy, f'{index + 1:02d}', 10, 400, MUTED)
            content += text(margin + 34, yy, value, 13, 500)
            content += line(margin, yy + 16, width - margin, yy + 16)
    else:
        split = margin + 390
        content += text(margin, y + 68, 'PACKAGE FILES', 10, 700, MUTED, letter=1.1)
        content += text(split + 70, y + 68, 'FIRST BUILD SEQUENCE', 10, 700, MUTED, letter=1.1)
        for index, value in enumerate(files):
            yy = y + 106 + index * 46
            content += text(margin, yy, f'{index + 1:02d}', 10, 400, MUTED)
            content += text(margin + 38, yy, value, 13, 400)
            content += line(margin, yy + 17, split, yy + 17)
        for index, value in enumerate(steps):
            yy = y + 106 + index * 54
            content += text(split + 70, yy, f'{index + 1:02d}', 10, 400, MUTED)
            content += text(split + 108, yy, value, 15, 500)
            content += line(split + 70, yy + 19, width - margin, yy + 19)
    return shell(width, height, content, mobile)


def security_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 130
    title_size = 42 if mobile else 58
    content = text(margin, top, 'Account security', 11 if mobile else 12, 400, MUTED)
    content += text(margin, top + 58, 'Active sessions', title_size, 650, INK, letter=-2.6)
    content += multiline(
        margin,
        top + (96 if mobile else 108),
        'Review where your account is signed in and revoke access you no longer recognize.',
        15 if mobile else 18,
        44 if mobile else 66,
        23 if mobile else 28,
        fill=MUTED,
    )
    box_y = top + (156 if mobile else 154)
    box_height = 132 if mobile else 104
    content += rect(margin, box_y, width - margin * 2, box_height, SURFACE, 6, LINE)
    content += text(margin + 18, box_y + 28, 'VERIFY BEFORE REVOKING ACCESS', 10, 700, MUTED, letter=1.0)
    content += text(margin + 18, box_y + 55, 'Enter your password to enable revocation for 15 minutes.', 13, 400, BODY)
    if mobile:
        content += rect(margin + 18, box_y + 76, width - margin * 2 - 36, 34, PAPER, 5, LINE)
        content += text(margin + 30, box_y + 98, 'Password', 12, 400, MUTED)
    else:
        content += rect(margin + 18, box_y + 67, 230, 32, PAPER, 5, LINE)
        content += text(margin + 30, box_y + 88, 'Password', 12, 400, MUTED)
        content += rect(margin + 262, box_y + 67, 124, 32, ACCENT, 5)
        content += text(margin + 324, box_y + 88, 'Verify password', 11, 650, '#ffffff', 'middle')
    list_y = box_y + box_height + (42 if mobile else 48)
    content += text(margin, list_y, 'ACTIVE SESSIONS', 10, 700, MUTED, letter=1.1)
    content += line(margin, list_y + 20, width - margin, list_y + 20, INK)
    sessions = [
        ('Current session', 'session:current', 'Seen now', 'This device'),
        ('AppSea session', 'session:other', 'Seen 2026-07-23 09:10 UTC', 'Revoke'),
    ]
    row_height = 108 if mobile else 90
    for index, (label, identifier, seen, action) in enumerate(sessions):
        row_y = list_y + 20 + index * row_height
        content += text(margin, row_y + 28, label, 16 if mobile else 18, 650)
        content += text(margin, row_y + 50, identifier, 11, 400, MUTED)
        if mobile:
            content += text(margin, row_y + 76, seen, 11, 400, MUTED)
            content += text(width - margin, row_y + 76, action, 11, 650 if action == 'Revoke' else 400, INK, 'end')
        else:
            content += text(margin + 390, row_y + 38, seen, 12, 400, MUTED)
            content += text(width - margin, row_y + 38, action, 12, 650 if action == 'Revoke' else 400, INK, 'end')
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    mfa_y = list_y + 20 + row_height * len(sessions) + (24 if mobile else 28)
    mfa_height = 132 if mobile else 112
    content += rect(margin, mfa_y, width - margin * 2, mfa_height, SURFACE, 6, LINE)
    content += text(margin + 18, mfa_y + 28, 'MULTI-FACTOR AUTHENTICATION', 10, 700, MUTED, letter=1.0)
    content += multiline(
        margin + 18,
        mfa_y + 55,
        'Enable TOTP sign-in with one-time recovery codes.',
        13,
        width - margin * 2 - 36,
        21,
        fill=BODY,
    )
    if mobile:
        content += text(margin + 18, mfa_y + 108, 'Password step-up required', 11, 400, MUTED)
    else:
        content += text(margin + 18, mfa_y + 88, 'Password step-up required', 12, 400, MUTED)
    return shell(width, height, content, mobile)


def seed_reviews_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 130
    title_size = 42 if mobile else 58
    content = text(margin, top, 'Private research workspace  /  Seed reviews', 11 if mobile else 12, 400, MUTED)
    content += text(margin, top + 58, 'Seed reviews', title_size, 650, INK, letter=-2.6)
    content += multiline(
        margin,
        top + (98 if mobile else 110),
        'Store explicit product, competitor, contrary-signal, and score assumptions before analysis.',
        15 if mobile else 18,
        44 if mobile else 68,
        23 if mobile else 28,
        fill=MUTED,
    )
    list_y = top + (174 if mobile else 176)
    content += text(margin, list_y, 'REGISTERED SEEDS', 10, 700, MUTED, letter=1.1)
    content += line(margin, list_y + 20, width - margin, list_y + 20, INK)
    rows = [
        ('Support handoff memory', 'seed-review:handoff', 'Approved'),
        ('Receipt reconciliation', 'seed-review:receipts', 'Reviewed'),
    ]
    row_height = 92 if mobile else 84
    for index, (name, identifier, state) in enumerate(rows):
        row_y = list_y + 20 + index * row_height
        content += text(margin, row_y + 28, name, 17 if mobile else 20, 650)
        content += text(margin, row_y + 50, identifier, 11, 400, MUTED)
        content += text(width - margin, row_y + 36, state, 11, 650, INK, 'end')
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    form_y = list_y + 20 + row_height * len(rows) + (36 if mobile else 44)
    form_height = 164 if mobile else 142
    content += rect(margin, form_y, width - margin * 2, form_height, SURFACE, 6, LINE)
    content += text(margin + 18, form_y + 28, 'REGISTER A REVIEWED SEED', 10, 700, MUTED, letter=1.0)
    content += text(margin + 18, form_y + 55, 'Seed JSON is validated and stored as immutable content.', 13, 400, BODY)
    if mobile:
        content += rect(margin + 18, form_y + 78, width - margin * 2 - 36, 34, PAPER, 5, LINE)
        content += text(margin + 30, form_y + 100, 'seed-review-new', 12, 400, MUTED)
        content += rect(margin + 18, form_y + 120, 144, 32, ACCENT, 5)
        content += text(margin + 90, form_y + 141, 'Save seed review', 11, 650, '#ffffff', 'middle')
    else:
        content += rect(margin + 18, form_y + 76, 230, 32, PAPER, 5, LINE)
        content += text(margin + 30, form_y + 97, 'seed-review-new', 12, 400, MUTED)
        content += rect(margin + 262, form_y + 76, 124, 32, ACCENT, 5)
        content += text(margin + 324, form_y + 97, 'Save seed review', 11, 650, '#ffffff', 'middle')
    return shell(width, height, content, mobile)


def campaigns_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 132
    title_size = 38 if mobile else 56
    content = text(margin, top, 'Private research workspace', 10, 700, MUTED, letter=1.1)
    content += text(margin, top + 54, 'Research campaigns', title_size, 650, INK, letter=-2.5)
    content += multiline(
        margin,
        top + (88 if mobile else 100),
        'Define the question, approved source allowlist, evidence limit, and budget before collection.',
        14 if mobile else 16,
        43 if mobile else 72,
        22 if mobile else 25,
        fill=MUTED,
    )
    list_y = top + (182 if mobile else 174)
    content += text(margin, list_y, 'REGISTERED CAMPAIGNS', 10, 700, MUTED, letter=1.1)
    content += line(margin, list_y + 20, width - margin, list_y + 20, INK)
    rows = [
        ('Billing workflow research', 'campaign:billing', 'Ready to run'),
        ('Support handoff signals', 'campaign:handoff', 'Pending policy'),
    ]
    row_height = 112 if mobile else 98
    for index, (name, identifier, state) in enumerate(rows):
        row_y = list_y + 20 + index * row_height
        content += text(margin, row_y + 30, name, 18 if mobile else 21, 650)
        content += text(margin, row_y + 55, identifier, 11, 400, MUTED)
        content += text(width - margin, row_y + 32, state, 11, 650, INK, 'end')
        if index == 0:
            button_width = 126 if mobile else 138
            button_x = width - margin - button_width
            content += rect(button_x, row_y + 62, button_width, 32, SURFACE, 5, INK)
            content += text(button_x + button_width / 2, row_y + 83, 'Start collection', 11, 650, INK, 'middle')
            content += text(margin, row_y + (98 if mobile else 84), 'Recent runs: 1 completed', 11, 400, MUTED)
        else:
            content += text(margin, row_y + 82, 'Waiting for approved source policy before collection.', 12, 400, MUTED)
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    form_y = list_y + 20 + row_height * len(rows) + (34 if mobile else 46)
    form_height = 146 if mobile else 136
    content += rect(margin, form_y, width - margin * 2, form_height, SURFACE, 6, LINE)
    content += text(margin + 18, form_y + 28, 'CREATE A DRAFT CAMPAIGN', 10, 700, MUTED, letter=1.0)
    content += text(margin + 18, form_y + 53, 'New drafts never activate a connector.', 13, 400, BODY)
    content += text(margin + 18, form_y + 72, 'Source allowlist  ·  policy state stays visible', 11, 400, MUTED)
    if mobile:
        content += rect(margin + 18, form_y + 90, width - margin * 2 - 36, 32, PAPER, 5, LINE)
        content += text(margin + 30, form_y + 111, 'campaign-name', 12, 400, MUTED)
    else:
        content += rect(margin + 18, form_y + 90, 230, 32, PAPER, 5, LINE)
        content += text(margin + 30, form_y + 111, 'campaign-name', 12, 400, MUTED)
        content += rect(margin + 262, form_y + 90, 124, 32, ACCENT, 5)
        content += text(margin + 324, form_y + 111, 'Save draft', 11, 650, '#ffffff', 'middle')
    return shell(width, height, content, mobile)


def campaign_history_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 132
    title_size = 38 if mobile else 56
    content = text(margin, top, 'Private research workspace', 10, 700, MUTED, letter=1.1)
    content += text(margin, top + 54, 'Billing workflow history', title_size, 650, INK, letter=-2.5)
    content += multiline(
        margin,
        top + (88 if mobile else 100),
        'Browse durable collection runs without exposing source payloads or workflow hashes.',
        14 if mobile else 16,
        43 if mobile else 72,
        22 if mobile else 25,
        fill=MUTED,
    )
    list_y = top + (184 if mobile else 176)
    content += text(margin, list_y, 'SINGLE-SOURCE RUNS', 10, 700, MUTED, letter=1.1)
    content += line(margin, list_y + 20, width - margin, list_y + 20, INK)
    rows = [
        ('completed  ·  10 items', 'run:billing', '2026-08-02 00:01'),
        ('running  ·  4 items', 'run:billing:next', '2026-08-03 09:14'),
    ]
    row_height = 102 if mobile else 86
    for index, (state, run_id, requested) in enumerate(rows):
        row_y = list_y + 20 + index * row_height
        content += text(margin, row_y + 28, state, 13 if mobile else 15, 600)
        content += text(margin, row_y + 52, run_id, 11, 400, MUTED)
        content += text(width - margin, row_y + 30, requested, 11, 400, MUTED, 'end')
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    multi_y = list_y + 20 + row_height * len(rows) + (42 if mobile else 52)
    content += text(margin, multi_y, 'MULTI-SOURCE RUNS', 10, 700, MUTED, letter=1.1)
    content += line(margin, multi_y + 20, width - margin, multi_y + 20, INK)
    content += multiline(
        margin,
        multi_y + 58,
        'Parent and child states use the same private cursor boundary. Older pages remain available without changing the public leaderboard.',
        13 if mobile else 15,
        43 if mobile else 78,
        21 if mobile else 24,
        fill=BODY,
    )
    return shell(width, height, content, mobile)


def source_coverage_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 132
    title_size = 38 if mobile else 56
    content = text(margin, top, 'Private research workspace', 10, 700, MUTED, letter=1.1)
    content += text(margin, top + 54, 'Source coverage', title_size, 650, INK, letter=-2.5)
    content += multiline(
        margin,
        top + (88 if mobile else 100),
        'Review policy readiness, quotas, deletion duties, and visible gaps before planning research.',
        14 if mobile else 16,
        43 if mobile else 72,
        22 if mobile else 25,
        fill=MUTED,
    )
    list_y = top + (184 if mobile else 176)
    content += text(margin, list_y, 'REGISTERED SOURCES', 10, 700, MUTED, letter=1.1)
    content += line(margin, list_y + 20, width - margin, list_y + 20, INK)
    rows = [
        ('CFPB Consumer Complaint Database', 'cfpb-consumer-complaints', 'Pending review'),
        ('Synthetic community fixture', 'fixture-community-feed', 'Fixture enabled'),
    ]
    row_height = 166 if mobile else 126
    for index, (name, identifier, state) in enumerate(rows):
        row_y = list_y + 20 + index * row_height
        content += text(margin, row_y + 30, name, 17 if mobile else 21, 650)
        content += text(margin, row_y + 54, identifier, 11, 400, MUTED)
        content += text(width - margin, row_y + 32, state, 11, 650, INK, 'end')
        content += multiline(
            margin,
            row_y + (84 if mobile else 80),
            'Official API · 6 requests/minute · deletion required' if index == 0 else 'Synthetic only · not market research',
            12,
            43 if mobile else 82,
            20,
            fill=BODY,
        )
        if index == 0:
            content += text(margin, row_y + (126 if mobile else 106), 'Coverage gap: historical export is not covered.', 11, 400, MUTED)
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    note_y = list_y + 20 + row_height * len(rows) + (34 if mobile else 44)
    note_height = 118 if mobile else 92
    content += rect(margin, note_y, width - margin * 2, note_height, SURFACE, 6, LINE)
    content += text(margin + 18, note_y + 28, 'READ-ONLY POLICY VIEW', 10, 700, MUTED, letter=1.0)
    content += multiline(
        margin + 18,
        note_y + 55,
        'This page cannot activate a connector or override legal, privacy, security, quota, or deletion review.',
        12,
        43 if mobile else 88,
        20,
        fill=BODY,
    )
    return shell(width, height, content, mobile)


def campaign_status_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 132
    title_size = 40 if mobile else 58
    content = text(margin, top, 'Private research workspace', 10, 700, MUTED, letter=1.1)
    content += text(margin, top + 54, 'Collection status', title_size, 650, INK, letter=-2.5)
    content += text(margin, top + (88 if mobile else 100), 'source:cfpb  /  policy cfpb-v1', 14, 400, MUTED)
    status_y = top + (148 if mobile else 160)
    content += text(width - margin, status_y, 'COMPLETED', 11, 700, INK, 'end', 1.0)
    content += line(margin, status_y + 24, width - margin, status_y + 24, INK)
    rows = [
        ('CAMPAIGN', 'campaign:billing'),
        ('RESEARCH RUN', 'run:billing'),
        ('CHECKPOINT', 'completed'),
        ('SOURCE ITEMS', '10'),
        ('COST MICROS', '0'),
    ]
    row_height = 54 if mobile else 48
    for index, (label, value) in enumerate(rows):
        row_y = status_y + 24 + index * row_height
        content += text(margin, row_y + 30, label, 10, 700, MUTED, letter=1.0)
        content += text(width - margin, row_y + 30, value, 14, 600, INK, 'end')
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    action_y = status_y + 24 + row_height * len(rows) + (38 if mobile else 46)
    content += rect(margin, action_y, 170, 34, ACCENT, 5)
    content += text(margin + 85, action_y + 22, 'Inspect retained evidence', 11, 650, '#ffffff', 'middle')
    return shell(width, height, content, mobile)


def analysis_status_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 132
    title_size = 40 if mobile else 58
    content = text(margin, top, 'Private research workspace', 10, 700, MUTED, letter=1.1)
    content += text(margin, top + 54, 'Analysis status', title_size, 650, INK, letter=-2.5)
    content += text(margin, top + (88 if mobile else 100), 'Reviewed evidence  /  opportunity package', 14, 400, MUTED)
    status_y = top + (148 if mobile else 160)
    content += text(width - margin, status_y, 'RUNNING', 11, 700, INK, 'end', 1.0)
    content += line(margin, status_y + 24, width - margin, status_y + 24, INK)
    rows = [
        ('ANALYSIS RUN', 'analysis:billing'),
        ('COLLECTION RUN', 'run:billing'),
        ('CHECKPOINT', 'persisting'),
        ('ACTIVITY ATTEMPTS', '1'),
        ('AVAILABILITY', 'pending'),
    ]
    row_height = 54 if mobile else 48
    for index, (label, value) in enumerate(rows):
        row_y = status_y + 24 + index * row_height
        content += text(margin, row_y + 30, label, 10, 700, MUTED, letter=1.0)
        content += text(width - margin, row_y + 30, value, 14, 600, INK, 'end')
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    action_y = status_y + 24 + row_height * len(rows) + (38 if mobile else 46)
    content += multiline(
        margin,
        action_y,
        'Refresh this private projection while the worker builds the governed report and coding plan.',
        13 if mobile else 14,
        44 if mobile else 74,
        22,
        fill=MUTED,
    )
    return shell(width, height, content, mobile)


def workspace_members_screen(width: int, height: int, mobile: bool) -> str:
    margin = 24 if mobile else 220
    top = 112 if mobile else 132
    title_size = 38 if mobile else 56
    content = text(margin, top, 'Private workspace', 10, 700, MUTED, letter=1.1)
    content += text(margin, top + 54, 'Members', title_size, 650, INK, letter=-2.5)
    content += text(
        margin,
        top + (88 if mobile else 100),
        'Workspace access and reviewed retention controls.',
        14 if mobile else 16,
        400,
        MUTED,
    )
    list_y = top + (170 if mobile else 164)
    content += text(margin, list_y, 'WORKSPACE ACCESS', 10, 700, MUTED, letter=1.1)
    content += line(margin, list_y + 20, width - margin, list_y + 20, INK)
    members = [('Owner account', 'owner@example.test', 'owner'), ('Research editor', 'editor@example.test', 'editor')]
    row_height = 74 if mobile else 66
    for index, (name, email, role) in enumerate(members):
        row_y = list_y + 20 + index * row_height
        content += text(margin, row_y + 26, name, 16 if mobile else 18, 650)
        content += text(margin, row_y + 48, email, 11, 400, MUTED)
        content += text(width - margin, row_y + 30, role, 11, 650, INK, 'end')
        content += line(margin, row_y + row_height, width - margin, row_y + row_height)
    box_y = list_y + 20 + row_height * len(members) + (34 if mobile else 42)
    box_height = 286 if mobile else 238
    content += rect(margin, box_y, width - margin * 2, box_height, SURFACE, 6, LINE)
    content += text(margin + 18, box_y + 28, 'DELETION READINESS', 10, 700, MUTED, letter=1.0)
    content += multiline(
        margin + 18,
        box_y + 55,
        'Database gate ready. Cloud object-store, export-retention, and backup verification remain external controls.',
        13 if mobile else 14,
        42 if mobile else 78,
        21 if mobile else 23,
        fill=BODY,
    )
    summary_y = box_y + (132 if mobile else 112)
    content += text(margin + 18, summary_y, 'ACTIVE WORK', 10, 700, MUTED, letter=1.0)
    content += text(width - margin - 18, summary_y, '0', 14, 650, INK, 'end')
    content += line(margin + 18, summary_y + 16, width - margin - 18, summary_y + 16)
    content += text(margin + 18, summary_y + 42, 'OBJECT REFERENCES', 10, 700, MUTED, letter=1.0)
    content += text(width - margin - 18, summary_y + 42, '0', 14, 650, INK, 'end')
    button_y = box_y + box_height - 48
    button_width = 178 if mobile else 196
    content += rect(margin + 18, button_y, button_width, 32, ACCENT, 5)
    content += text(margin + 18 + button_width / 2, button_y + 21, 'Request deletion review', 11, 650, '#ffffff', 'middle')
    return shell(width, height, content, mobile)


SCREENS = {
    'leaderboard': leaderboard,
    'opportunity': opportunity_screen,
    'complaints': complaints_screen,
    'competitors': competitors_screen,
    'plan': plan_screen,
    'security': security_screen,
    'seed-reviews': seed_reviews_screen,
    'campaigns': campaigns_screen,
    'campaign-history': campaign_history_screen,
    'source-coverage': source_coverage_screen,
    'campaign-status': campaign_status_screen,
    'analysis-status': analysis_status_screen,
    'workspace-members': workspace_members_screen
}

# Some private settings screens are authored as hand-reviewed SVG references
# rather than generated geometry. Keeping these sources in the reference loop
# makes `pnpm ui:references` validate and rasterize them when cairosvg is
# available without using Python to draw their shapes.
STATIC_SOURCES = {
    'agent-access': ('agent-access.svg', 'agent-access-mobile.svg'),
    'workspace-usage': ('workspace-usage.svg', 'workspace-usage-mobile.svg'),
    'artifact-approval': ('artifact-approval.svg', 'artifact-approval-mobile.svg'),
    'workspace-activity': ('workspace-activity.svg', 'workspace-activity-mobile.svg')
}


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    SOURCE.mkdir(parents=True, exist_ok=True)
    rendered = 0
    for name, renderer in SCREENS.items():
        for width, height, suffix, mobile in [
            (1440, 1000, '', False),
            (390, 844, '-mobile', True)
        ]:
            svg = renderer(width, height, mobile)
            svg_path = SOURCE / f'{name}{suffix}.svg'
            png_path = OUTPUT / f'{name}{suffix}.png'
            svg_path.write_text(svg, encoding='utf-8')
            png_targets = [png_path]
            if name in {'security', 'seed-reviews'}:
                nested_directory = OUTPUT / ('mobile' if mobile else 'desktop')
                nested_directory.mkdir(parents=True, exist_ok=True)
                png_targets.append(nested_directory / f'{name}.png')
            if cairosvg is not None:
                for target in png_targets:
                    cairosvg.svg2png(
                        bytestring=svg.encode('utf-8'),
                        write_to=str(target),
                        output_width=width,
                        output_height=height,
                    )
            rendered += 1
    for name, (desktop_source, mobile_source) in STATIC_SOURCES.items():
        for width, height, suffix, mobile in [
            (1440, 1000, '', False),
            (390, 844, '-mobile', True)
        ]:
            source_path = SOURCE / (mobile_source if mobile else desktop_source)
            if not source_path.exists():
                raise FileNotFoundError(f'missing static reference source: {source_path}')
            svg = source_path.read_text(encoding='utf-8')
            png_path = OUTPUT / f'{name}{suffix}.png'
            if cairosvg is not None:
                cairosvg.svg2png(
                    bytestring=svg.encode('utf-8'),
                    write_to=str(png_path),
                    output_width=width,
                    output_height=height,
                )
            rendered += 1
    if cairosvg is None:
        print(
            f'generated {rendered} SVG reference sources in {OUTPUT.relative_to(ROOT)}; '
            'PNG export skipped because cairosvg is unavailable'
        )
    else:
        print(f'rendered {rendered} reference images in {OUTPUT.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
