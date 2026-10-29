#!/usr/bin/env python3
"""Read Watchdog's diagnostics on the VM, over SSH, without opening the app.

  watchdogctl errors [LIMIT]      latest failures: server, process, browser and failed requests
  watchdogctl trace TRACE_ID      everything recorded for one trace (quote it from an error message)
  watchdogctl diag-summary        today's counts, mode and disk use

Read-only. Standard library only. Records are already redacted when written.
"""
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(os.environ.get('WATCHDOG_ROOT', '/') or '/')
DIAG = ROOT / 'var/lib/watchdog/diagnostics'
ENV = ROOT / 'etc/watchdog/app.env'
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TRACE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def days(limit=None):
    if not DIAG.is_dir():
        return []
    found = sorted(d for d in os.listdir(DIAG) if DAY.match(d))
    return found[-limit:] if limit else found


def records(day, name):
    path = DIAG / day / name
    if not path.is_file():
        return
    with path.open(encoding='utf-8', errors='replace') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                yield {'message': 'unreadable record (partially written line)'}


def short(text, n=220):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= n else text[:n - 1] + '…'


def failures(recent_days=2):
    out = []
    for day in days(recent_days):
        for r in records(day, 'server-errors.jsonl'):
            out.append((r.get('timestamp', ''), 'server', r.get('trace_id'), f"{r.get('component')}:{r.get('operation')} {r.get('exception_type')}: {r.get('message')}"))
        for r in records(day, 'process-errors.jsonl'):
            out.append((r.get('timestamp', ''), 'PROCESS', r.get('trace_id'), f"{r.get('kind')}: {r.get('message')}"))
        for r in records(day, 'client-errors.jsonl'):
            where = f" api={r.get('method') or ''} {r.get('apiPath')} {r.get('status') or ''}" if r.get('apiPath') else ''
            out.append((r.get('received_at', r.get('at', '')), 'browser', r.get('traceId'), f"{r.get('kind')} on {r.get('path')}{where}: {r.get('message')}"))
        for r in records(day, 'requests.jsonl'):
            status = r.get('status')
            if status is None or status >= 400:
                err = r.get('error') or {}
                out.append((r.get('at', ''), 'http', r.get('trace_id'), f"{status or 'ABORTED'} {r.get('method')} {r.get('path')} {r.get('duration_ms')}ms {err.get('code') or ''} {err.get('message') or ''}"))
    return sorted(out, key=lambda x: x[0])


def cmd_errors(args):
    limit = int(args[0]) if args else 40
    rows = failures()
    if not rows:
        print(f'No failures recorded in the last two days under {DIAG}.')
        return
    for at, source, trace, message in rows[-limit:]:
        print(f"{at[:19]}  {source:<8} {trace or '-':<36}  {short(message)}")
    print(f'\n{len(rows)} failure record(s) in the last two days; showing {min(limit, len(rows))}. Details: watchdogctl trace TRACE_ID')


def cmd_trace(args):
    if len(args) != 1 or not TRACE.match(args[0]):
        sys.exit('Usage: watchdogctl trace TRACE_ID (a UUID, e.g. from an error message or "watchdogctl errors")')
    trace = args[0].lower()
    hits = 0
    for day in days():
        for name in ('requests.jsonl', 'server-errors.jsonl', 'process-errors.jsonl', 'client-errors.jsonl'):
            for r in records(day, name):
                if str(r.get('trace_id') or r.get('traceId') or '').lower() == trace:
                    hits += 1
                    print(f'[{name}] {short(json.dumps(r, ensure_ascii=False), 2000)}')
        folder = DIAG / day / trace
        if folder.is_dir():
            for e in records(day, f'{trace}/events.jsonl'):
                hits += 1
                c = e.get('context', {})
                print(f"{e.get('timestamp', '')[11:23]} #{c.get('sequence_no')} {e.get('event_type'):<16} {c.get('component')}:{c.get('operation')} {short(json.dumps(e.get('payload'), ensure_ascii=False), 300) if e.get('payload') is not None else ''}")
            for e in records(day, f'{trace}/errors.jsonl'):
                hits += 1
                print(f"ERROR {e.get('exception_type')}: {e.get('message')}\n{e.get('stack_trace') or ''}")
    if not hits:
        print('Nothing recorded for this trace. Full step-by-step events exist only in TRACE mode (watchdogctl diag-summary).')


def cmd_summary(_args):
    mode = 'unknown'
    if ENV.is_file():
        for line in ENV.read_text().splitlines():
            if line.startswith('WATCHDOG_DIAGNOSTICS_MODE='):
                mode = line.split('=', 1)[1] or 'NORMAL'
    today = days(1)
    total = sum(f.stat().st_size for f in DIAG.rglob('*') if f.is_file()) if DIAG.is_dir() else 0
    print(f'Mode: {mode}   directory: {DIAG}   size: {total / 1048576:.1f} MB   days kept: {len(days())}')
    if not today:
        print('No diagnostics written yet.')
        return
    day = today[0]
    req = list(records(day, 'requests.jsonl'))
    count = lambda name: sum(1 for _ in records(day, name))
    print(f"{day}: {len(req)} API requests, {sum(1 for r in req if (r.get('status') or 0) >= 500 or r.get('status') is None)} failed (5xx/aborted), "
          f"{sum(1 for r in req if 400 <= (r.get('status') or 0) < 500)} refused (4xx); "
          f"server errors {count('server-errors.jsonl')}, browser errors {count('client-errors.jsonl')}, process errors {count('process-errors.jsonl')}; "
          f"traces {sum(1 for d in (DIAG / day).iterdir() if d.is_dir())}")


COMMANDS = {'errors': cmd_errors, 'trace': cmd_trace, 'summary': cmd_summary}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](sys.argv[2:])
