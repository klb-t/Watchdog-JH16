#!/usr/bin/env python3
"""Replay the pre-packaging attempt in a temporary directory, outside product builds."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='watchdog-g2-initial-') as directory:
    target = Path(directory)
    for name in ('protocol.json', 'inputs.json', 'freeze.json', 'prepare_inputs.py'):
        shutil.copyfile(ROOT / name, target / name)
    inputs = json.loads((ROOT / 'inputs.json').read_bytes())
    mapping = json.loads((ROOT / 'snapshot-packaging.json').read_bytes())
    for source in inputs['sources']:
        saved = source['snapshot_path']
        dest = target / saved
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / mapping.get(saved, saved), dest)
    shutil.copyfile(ROOT / 'runs/initial/run.py.txt', target / 'run.py')
    subprocess.run([sys.executable, str(target / 'run.py'), '--verify', str(ROOT / 'runs/initial/results.json')], check=True)
