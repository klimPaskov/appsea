#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    'node_modules',
    '.next',
    'dist',
    '.turbo',
    '.git',
    '.appsea',
    '.pnpm-store',
    '__pycache__'
}
EXCLUDED_FILES = {'package_manifest.json', 'PACKAGE_MANIFEST.md', 'memory/index.sqlite3'}


def category(path: str) -> str:
    if path.startswith('.agents/skills/'):
        return 'native Codex skill'
    if path.startswith('.codex/agents/'):
        return 'Codex subagent'
    if path.startswith('apps/'):
        return 'application code'
    if path.startswith('packages/'):
        return 'shared package'
    if path.startswith('memory/'):
        return 'project memory'
    if path.startswith('docs/specs/'):
        return 'deep specification'
    if path.startswith('docs/'):
        return 'documentation'
    if path.startswith('design/references/') and path.endswith('.png'):
        return 'UI reference image'
    if path.startswith('design/'):
        return 'design source'
    if path.startswith('schemas/'):
        return 'JSON Schema'
    if path.startswith('examples/'):
        return 'example artifact'
    if path.startswith('scripts/'):
        return 'repository tooling'
    if path.startswith('artifacts/'):
        return 'generated sample artifact'
    return 'repository control'


def files() -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        if relative in EXCLUDED_FILES or EXCLUDED_PARTS.intersection(path.parts):
            continue
        data = path.read_bytes()
        entries.append(
            {
                'path': relative,
                'category': category(relative),
                'bytes': len(data),
                'sha256': hashlib.sha256(data).hexdigest()
            }
        )
    return entries


def main() -> int:
    entries = files()
    digest = hashlib.sha256(
        '\n'.join(f"{entry['path']}:{entry['sha256']}" for entry in entries).encode('utf-8')
    ).hexdigest()
    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    manifest = {
        'name': 'AppSea Codex Starter',
        'version': '0.3.0',
        'generatedAt': generated_at,
        'fileCount': len(entries),
        'byteCount': sum(int(entry['bytes']) for entry in entries),
        'packageDigest': digest,
        'files': entries
    }
    (ROOT / 'package_manifest.json').write_text(
        json.dumps(manifest, indent=2) + '\n', encoding='utf-8'
    )

    counts = Counter(str(entry['category']) for entry in entries)
    lines = [
        '# AppSea package manifest',
        '',
        f'- Version: `0.3.0`',
        f'- Generated: `{generated_at}`',
        f'- Indexed files: `{len(entries)}`',
        f'- Indexed bytes: `{manifest["byteCount"]}`',
        f'- Package digest: `{digest}`',
        '',
        '## Category counts',
        '',
        '| Category | Files |',
        '| --- | ---: |'
    ]
    lines.extend(f'| {name} | {count} |' for name, count in sorted(counts.items()))
    lines.extend(
        [
            '',
            '## Files',
            '',
            '| Path | Category | Bytes | SHA-256 prefix |',
            '| --- | --- | ---: | --- |'
        ]
    )
    for entry in entries:
        lines.append(
            f"| `{entry['path']}` | {entry['category']} | {entry['bytes']} | `{str(entry['sha256'])[:12]}` |"
        )
    (ROOT / 'PACKAGE_MANIFEST.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'generated manifest for {len(entries)} files')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
