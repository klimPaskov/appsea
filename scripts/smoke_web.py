#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'apps' / 'web'
HOST = '127.0.0.1'
PORT = 4312
BASE = f'http://{HOST}:{PORT}'


def next_command() -> list[str]:
    suffix = '.cmd' if os.name == 'nt' else ''
    local = WEB / 'node_modules' / '.bin' / f'next{suffix}'
    if local.exists():
        return [str(local)]
    executable = shutil.which('next')
    if executable:
        return [executable]
    raise RuntimeError('Next.js is not installed')


def fetch(path: str) -> tuple[int, str]:
    with urllib.request.urlopen(BASE + path, timeout=5) as response:
        return response.status, response.read().decode('utf-8')


def wait_for_server(process: subprocess.Popen[str]) -> None:
    deadline = time.time() + 45
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError('web server exited before becoming ready')
        try:
            status, _body = fetch('/')
            if status == 200:
                return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.25)
    raise TimeoutError('web server did not become ready')


def require(value: str, body: str, route: str) -> None:
    if value not in body:
        raise AssertionError(f'{route} is missing {value!r}')


def forbid(value: str, body: str, route: str) -> None:
    if value in body:
        raise AssertionError(f'{route} unexpectedly contains {value!r}')


def stop_server(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(
            ['taskkill', '/PID', str(process.pid), '/T', '/F'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    if not (WEB / '.next' / 'BUILD_ID').exists():
        raise RuntimeError('Build the web app before running the smoke test')

    log_path = ROOT / '.appsea' / 'web-smoke.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    command = next_command() + ['start', '--hostname', HOST, '--port', str(PORT)]
    with log_path.open('w', encoding='utf-8') as log:
        process = subprocess.Popen(
            command,
            cwd=WEB,
            env={**os.environ, 'NEXT_TELEMETRY_DISABLED': '1'},
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True
        )
        try:
            wait_for_server(process)
            routes = {
                '/': [
                    'Leaderboard',
                    'Inbox Relay',
                    'Complaints',
                    'Score',
                    'appsea-mark-generated.png'
                ],
                '/leaderboard': [
                    'Leaderboard',
                    'Inbox Relay',
                    'Complaints',
                    'Score',
                    'appsea-mark-generated.png'
                ],
                '/opportunities/inbox-relay': ['Inbox Relay', 'Thesis', 'First wedge'],
                '/opportunities/inbox-relay/complaints': ['Curated complaints', 'TeamMail'],
                '/opportunities/inbox-relay/competitors': [
                    'Competitors and alternatives',
                    'Shared inbox suites'
                ],
                '/opportunities/inbox-relay/plan': ['Coding-agent package', 'README.md']
            }
            for route, required in routes.items():
                status, body = fetch(route)
                if status != 200:
                    raise AssertionError(f'{route} returned {status}')
                for value in required:
                    require(value, body, route)

            _, leaderboard = fetch('/')
            for forbidden in [
                'Thesis',
                'First wedge',
                'Competitors and alternatives',
                'Research status',
                'Source coverage',
                'Selected opportunity'
            ]:
                forbid(forbidden, leaderboard, '/')

            status, api_body = fetch('/api/opportunities')
            if status != 200:
                raise AssertionError(f'/api/opportunities returned {status}')
            payload = json.loads(api_body)
            if payload.get('meta', {}).get('synthetic') is not True:
                raise AssertionError('API fixture response is not labeled synthetic')
            if len(payload.get('data', [])) != 6:
                raise AssertionError('API fixture response should contain six opportunities')

            status, health_body = fetch('/api/health/live')
            if status != 200:
                raise AssertionError(f'/api/health/live returned {status}')
            health = json.loads(health_body)
            if health.get('service') != 'appsea-web' or health.get('status') != 'ok':
                raise AssertionError('liveness probe did not return the bounded ok payload')
        finally:
            stop_server(process)

    print('web smoke test passed for leaderboard, opportunity routes, and fixture API')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'web smoke test failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
