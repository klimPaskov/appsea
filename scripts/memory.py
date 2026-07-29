#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEMORY = ROOT / 'memory'
INDEX = MEMORY / 'index.sqlite3'
PRIMARY = ['HOT.md', 'USER.md', 'ACTIVE.md', 'PROJECT.md', 'DECISIONS.md', 'LESSONS.md']
BUDGETS = {
    'HOT.md': 2500,
    'USER.md': 5000,
    'ACTIVE.md': 8000,
    'PROJECT.md': 12000,
    'DECISIONS.md': 20000,
    'LESSONS.md': 20000
}


def memory_files() -> list[Path]:
    return sorted(
        path
        for path in MEMORY.rglob('*.md')
        if 'archive' not in path.parts and path.name != 'AGENTS.md'
    )


def chunks(path: Path) -> list[tuple[str, str]]:
    text = path.read_text(encoding='utf-8')
    parts = re.split(r'(?=^#{1,3} )', text, flags=re.M)
    output: list[tuple[str, str]] = []
    for index, part in enumerate(parts):
        clean = part.strip()
        if not clean:
            continue
        first = clean.splitlines()[0].lstrip('#').strip()
        title = first or f'Chunk {index + 1}'
        output.append((title, clean))
    return output


def build_index() -> sqlite3.Connection:
    connection = sqlite3.connect(INDEX)
    connection.execute('DROP TABLE IF EXISTS memory_fts')
    connection.execute(
        'CREATE VIRTUAL TABLE memory_fts USING fts5(path, title, content, tokenize="porter unicode61")'
    )
    for path in memory_files():
        relative = path.relative_to(ROOT).as_posix()
        for title, content in chunks(path):
            connection.execute(
                'INSERT INTO memory_fts(path, title, content) VALUES (?, ?, ?)',
                (relative, title, content)
            )
    connection.commit()
    return connection


def validate() -> list[str]:
    errors: list[str] = []
    for name in PRIMARY:
        path = MEMORY / name
        if not path.exists():
            errors.append(f'missing memory file: memory/{name}')
            continue
        size = path.stat().st_size
        if size > BUDGETS[name]:
            errors.append(f'memory/{name} is {size} bytes, budget is {BUDGETS[name]}')
        text = path.read_text(encoding='utf-8')
        if not text.startswith('# '):
            errors.append(f'memory/{name} must start with a top-level heading')
    for path in memory_files():
        text = path.read_text(encoding='utf-8')
        if re.search(r'(?i)(api[_ -]?key|secret|password)\s*[:=]\s*\S+', text):
            errors.append(f'possible credential in {path.relative_to(ROOT)}')
    return errors


def command_status() -> int:
    errors = validate()
    print('AppSea project memory')
    for name in PRIMARY:
        path = MEMORY / name
        state = f'{path.stat().st_size} bytes' if path.exists() else 'missing'
        print(f'- {name}: {state}')
    print(f'- session handoffs: {len(list((MEMORY / "sessions").glob("*.md")))}')
    print(f'- validation issues: {len(errors)}')
    for error in errors:
        print(f'  - {error}')
    return 1 if errors else 0


def command_validate() -> int:
    errors = validate()
    if errors:
        print(f'memory validation failed with {len(errors)} issue(s)')
        for error in errors:
            print(f'- {error}')
        return 1
    connection = build_index()
    count = connection.execute('SELECT count(*) FROM memory_fts').fetchone()[0]
    connection.close()
    print(f'memory validation passed and indexed {count} chunks')
    return 0


def command_search(query: str, limit: int) -> int:
    connection = build_index()
    rows = connection.execute(
        '''
        SELECT path, title, snippet(memory_fts, 2, '[', ']', ' … ', 18), bm25(memory_fts)
        FROM memory_fts
        WHERE memory_fts MATCH ?
        ORDER BY bm25(memory_fts)
        LIMIT ?
        ''',
        (query, limit)
    ).fetchall()
    connection.close()
    if not rows:
        print('no project-memory matches')
        return 0
    for path, title, snippet, _score in rows:
        print(f'{path} | {title}\n  {snippet}')
    return 0


def command_add(target: str, title: str, text: str) -> int:
    allowed = {'HOT', 'USER', 'ACTIVE', 'PROJECT', 'DECISIONS', 'LESSONS'}
    normalized = target.upper()
    if normalized not in allowed:
        print(f'target must be one of: {", ".join(sorted(allowed))}', file=sys.stderr)
        return 2
    path = MEMORY / f'{normalized}.md'
    with path.open('a', encoding='utf-8') as handle:
        handle.write(f'\n## {title.strip()}\n\n{text.strip()}\n')
    errors = validate()
    if errors:
        print('entry was written but memory now needs curation:', file=sys.stderr)
        for error in errors:
            print(f'- {error}', file=sys.stderr)
        return 1
    build_index().close()
    print(f'added entry to memory/{normalized}.md')
    return 0


def slugify(value: str) -> str:
    value = re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
    return value or 'handoff'


def command_session(title: str, status: str, body: str) -> int:
    date = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')
    path = MEMORY / 'sessions' / f'{date}-{slugify(title)}.md'
    content = f'''# Session handoff: {title}

- Date: {date}
- Status: {status}

{body.strip()}
'''
    path.write_text(content, encoding='utf-8')
    build_index().close()
    print(path.relative_to(ROOT).as_posix())
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Maintain AppSea project memory')
    subparsers = parser.add_subparsers(dest='command', required=True)
    subparsers.add_parser('status')
    subparsers.add_parser('validate')

    search = subparsers.add_parser('search')
    search.add_argument('query')
    search.add_argument('--limit', type=int, default=8)

    add = subparsers.add_parser('add')
    add.add_argument('target')
    add.add_argument('title')
    add.add_argument('text')

    session = subparsers.add_parser('session')
    session.add_argument('title')
    session.add_argument('--status', default='in progress')
    session.add_argument('--body', required=True)

    args = parser.parse_args()
    if args.command == 'status':
        return command_status()
    if args.command == 'validate':
        return command_validate()
    if args.command == 'search':
        return command_search(args.query, args.limit)
    if args.command == 'add':
        return command_add(args.target, args.title, args.text)
    if args.command == 'session':
        return command_session(args.title, args.status, args.body)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
