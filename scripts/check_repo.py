#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import subprocess
import sys
import tomllib
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {'node_modules', '.next', 'dist', '.turbo', '.git', 'artifacts'}

REQUIRED = [
    'AGENTS.md',
    'README.md',
    'START_HERE.md',
    'GOAL_PROMPT.md',
    'docs/INDEX.md',
    'memory/HOT.md',
    'memory/USER.md',
    'memory/ACTIVE.md',
    '.codex/config.toml',
    'apps/web/package.json',
    'apps/worker/package.json',
    'packages/contracts/package.json'
]

REFERENCE_IMAGES = [
    'desktop/leaderboard.png',
    'mobile/leaderboard.png',
    'desktop/opportunity.png',
    'mobile/opportunity.png',
    'desktop/complaints.png',
    'mobile/complaints.png',
    'desktop/competitors.png',
    'mobile/competitors.png',
    'desktop/plan.png',
    'mobile/plan.png'
]


def should_skip(path: Path) -> bool:
    return bool(SKIP_PARTS.intersection(path.parts))


def iter_files(suffix: str):
    """Walk repository files without following pnpm/junction directories."""
    for directory, child_directories, filenames in os.walk(ROOT, topdown=True, followlinks=False):
        child_directories[:] = [name for name in child_directories if name not in SKIP_PARTS]
        for filename in filenames:
            if filename.endswith(suffix):
                yield Path(directory) / filename


def markdown_links(path: Path) -> list[str]:
    text = path.read_text(encoding='utf-8')
    links: list[str] = []
    for match in re.finditer(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', text):
        target = match.group(1).strip().split()[0].strip('<>')
        if not target or target.startswith(('http://', 'https://', 'mailto:', '#')):
            continue
        links.append(unquote(target.split('#', 1)[0]))
    return links


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open('rb') as handle:
        signature = handle.read(24)
    if len(signature) < 24 or signature[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    return struct.unpack('>II', signature[16:24])


def parse_skill(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding='utf-8')
    match = re.match(r'^---\n(.*?)\n---\n', text, flags=re.S)
    if not match:
        raise ValueError('missing frontmatter')
    metadata: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ':' in line:
            key, value = line.split(':', 1)
            metadata[key.strip()] = value.strip().strip('"').strip("'")
    name = metadata.get('name', '')
    description = metadata.get('description', '')
    if not name or not description:
        raise ValueError('name and description are required')
    return name, description


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--docs-only', action='store_true')
    args = parser.parse_args()
    errors: list[str] = []

    for relative in REQUIRED:
        if not (ROOT / relative).exists():
            errors.append(f'missing required file: {relative}')

    if (ROOT / 'skills').exists():
        errors.append('legacy top-level skills directory exists, use .agents/skills')
    if (ROOT / 'repo_blueprint').exists():
        errors.append('legacy repo_blueprint directory exists, code must live at repository root')

    agents_path = ROOT / 'AGENTS.md'
    if agents_path.exists():
        size = agents_path.stat().st_size
        if size > 32768:
            errors.append(f'AGENTS.md is {size} bytes, maximum is 32768')
        agents_text = agents_path.read_text(encoding='utf-8')
        if 'catalog will be generated' in agents_text:
            errors.append('AGENTS.md generated catalogs are not synchronized')

    skill_names: list[str] = []
    for path in sorted((ROOT / '.agents/skills').glob('*/SKILL.md')):
        try:
            name, _description = parse_skill(path)
            skill_names.append(name)
            if name != path.parent.name:
                errors.append(f'skill folder mismatch: {path.relative_to(ROOT)}')
        except Exception as exc:
            errors.append(f'invalid skill {path.relative_to(ROOT)}: {exc}')
    if len(skill_names) < 10:
        errors.append(f'expected a useful native skill library, found {len(skill_names)} skills')
    if len(skill_names) != len(set(skill_names)):
        errors.append('duplicate skill names')

    agent_names: list[str] = []
    for path in sorted((ROOT / '.codex/agents').glob('*.toml')):
        try:
            with path.open('rb') as handle:
                data = tomllib.load(handle)
            name = data.get('name')
            if not isinstance(name, str) or not name:
                raise ValueError('name is required')
            if name != path.stem:
                raise ValueError('filename must match name')
            if data.get('sandbox_mode') not in {'read-only', 'workspace-write'}:
                raise ValueError('sandbox_mode must be read-only or workspace-write')
            agent_names.append(name)
        except Exception as exc:
            errors.append(f'invalid subagent {path.relative_to(ROOT)}: {exc}')
    if len(agent_names) < 5:
        errors.append(f'expected bounded subagents, found {len(agent_names)}')

    for path in iter_files('.md'):
        if should_skip(path):
            continue
        for target in markdown_links(path):
            candidate = (path.parent / target).resolve()
            try:
                candidate.relative_to(ROOT.resolve())
            except ValueError:
                continue
            if not candidate.exists():
                errors.append(f'broken link in {path.relative_to(ROOT)}: {target}')

    for path in iter_files('.json'):
        if should_skip(path):
            continue
        try:
            json.loads(path.read_text(encoding='utf-8'))
        except Exception as exc:
            errors.append(f'invalid JSON {path.relative_to(ROOT)}: {exc}')

    for path in iter_files('.toml'):
        if should_skip(path):
            continue
        try:
            with path.open('rb') as handle:
                tomllib.load(handle)
        except Exception as exc:
            errors.append(f'invalid TOML {path.relative_to(ROOT)}: {exc}')

    npmrc = (ROOT / '.npmrc').read_text(encoding='utf-8') if (ROOT / '.npmrc').exists() else ''
    if 'internal.api.openai.org' in npmrc or 'artifactory' in npmrc:
        errors.append('.npmrc contains an environment-specific private registry')

    memory_result = subprocess.run(
        [sys.executable, str(ROOT / 'scripts/memory.py'), 'validate'],
        capture_output=True,
        text=True,
        check=False
    )
    if memory_result.returncode:
        errors.append(f'memory validation failed: {memory_result.stdout.strip() or memory_result.stderr.strip()}')

    if not args.docs_only:
        references = ROOT / 'design/references'
        for name in REFERENCE_IMAGES:
            path = references / name
            if not path.exists():
                errors.append(f'missing reference image: design/references/{name}')
                continue
            try:
                width, height = png_dimensions(path)
                expected = (390, 844) if name.startswith('mobile/') else (1440, 1000)
                if (width, height) != expected:
                    errors.append(f'reference image {name} is {width}x{height}, expected {expected[0]}x{expected[1]}')
            except Exception as exc:
                errors.append(f'invalid reference image {name}: {exc}')

    for script in (ROOT / 'scripts').glob('*.py'):
        result = subprocess.run(
            [sys.executable, '-m', 'py_compile', str(script)],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode:
            errors.append(f'Python syntax error in {script.relative_to(ROOT)}: {result.stderr.strip()}')

    if errors:
        print(f'repository validation failed with {len(errors)} issue(s)')
        for error in errors:
            print(f'- {error}')
        return 1

    print(
        f'repository validation passed: {len(skill_names)} skills, {len(agent_names)} subagents, documentation links, memory, config, and references'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
