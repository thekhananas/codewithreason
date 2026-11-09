#!/usr/bin/env bash
# Start both local services and terminate only the process groups started here.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -x .venv/bin/python3 ]]; then
  printf '%s\n' 'Create the Python environment first: python3 -m venv .venv' >&2
  printf '%s\n' 'Then install dependencies: .venv/bin/python3 -m pip install -r backend/requirements-lock.txt' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22+ and npm are required. Install them before running this script.' >&2
  exit 1
fi
if [[ ! -x frontend/node_modules/.bin/next ]]; then
  printf '%s\n' 'Install frontend dependencies first: npm --prefix frontend ci' >&2
  exit 1
fi

exec .venv/bin/python3 - <<'PY'
import importlib
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

if sys.version_info < (3, 11):
    raise SystemExit('Python 3.11 or later is required; recreate .venv with a supported interpreter.')
try:
    node_version = subprocess.check_output(['node', '--version'], text=True).strip()
    if int(node_version.removeprefix('v').split('.')[0]) < 22:
        raise ValueError('Unsupported Node.js version')
except (OSError, subprocess.SubprocessError, ValueError) as exc:
    raise SystemExit('Node.js 22 or later is required before starting the frontend.') from exc
try:
    for module in ('fastapi', 'pydantic', 'sqlalchemy', 'langgraph', 'httpx'):
        importlib.import_module(module)
except ImportError as exc:
    raise SystemExit('Missing backend dependency. Run .venv/bin/python3 -m pip install -r backend/requirements-lock.txt') from exc


def local_json(port, path):
    # Probe loopback directly, without environment proxies or HTTP redirects.
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        if response.status != 200:
            return None
        payload = json.loads(response.read(256000))
        return payload if isinstance(payload, dict) else None
    except (OSError, http.client.HTTPException, ValueError):
        return None
    finally:
        connection.close()


def existing_workspace_ready(backend_port=8000, frontend_port=3000):
    backend = local_json(backend_port, '/api/v1/health')
    if not backend or backend.get('status') != 'ok' or not backend.get('version'):
        return False
    schema = local_json(backend_port, '/openapi.json')
    info = schema.get('info') if schema else None
    paths = schema.get('paths') if schema else None
    if (not isinstance(info, dict) or info.get('title') != 'SocraGate'
            or not isinstance(paths, dict) or '/api/v1/evaluate' not in paths):
        return False
    frontend = local_json(frontend_port, '/api/v1/health')
    return bool(frontend) and all(
        frontend.get(field) == backend.get(field) for field in ('status', 'version', 'mode')
    )


def print_urls():
    print('SocraGate workspace: http://127.0.0.1:3000', flush=True)
    print('API documentation: http://127.0.0.1:8000/docs', flush=True)


if existing_workspace_ready():
    print('SocraGate is already running. Reusing the existing instance.', flush=True)
    print_urls()
    raise SystemExit(0)

for port in (8000, 3000):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        # Match the servers' restart behavior: TIME_WAIT is not a live listener.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError as exc:
            raise SystemExit(
                f'Port {port} is occupied, but a healthy SocraGate workspace was not found. '
                'If it is still starting, wait a few seconds and retry. Otherwise stop '
                'the service in its original terminal with Ctrl+C, then run ./scripts/dev.sh again.'
            ) from exc

root = Path.cwd()
environment = os.environ.copy()
# Explicitly opt in to networked tutoring with LLM_PROVIDER=auto/openai/anthropic.
environment.setdefault('LLM_PROVIDER', 'offline')
environment.setdefault('SOCRAGATE_API_URL', 'http://127.0.0.1:8000')
environment.setdefault('NEXT_TELEMETRY_DISABLED', '1')
children = []
stopping = False

def request_stop(_signum, _frame):
    global stopping
    stopping = True

for event in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(event, request_stop)

def stop_children():
    for child in children:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 5
    remaining = {child.pid for child in children}
    while remaining and time.monotonic() < deadline:
        for child in children:
            child.poll()
        for group in tuple(remaining):
            try:
                os.killpg(group, 0)
            except ProcessLookupError:
                remaining.remove(group)
        if remaining:
            time.sleep(0.05)
    for group in remaining:
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for child in children:
        child.wait()

status = 0
try:
    commands = [
        [str(root / '.venv/bin/python3'), '-m', 'uvicorn', 'app.main:app',
         '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000', '--reload'],
        ['npm', '--prefix', 'frontend', 'run', 'dev', '--', '--port', '3000'],
    ]
    for command in commands:
        children.append(subprocess.Popen(command, cwd=root, env=environment, start_new_session=True))
    print_urls()
    print('Press Ctrl+C to stop both services.', flush=True)
    while not stopping:
        for child in children:
            result = child.poll()
            if result is not None:
                print(f'A SocraGate service exited ({result}); stopping both services.', file=sys.stderr)
                status = result if result > 0 else 1
                stopping = True
                break
        time.sleep(0.15)
finally:
    stop_children()
raise SystemExit(status)
PY
