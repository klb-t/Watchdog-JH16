import json, sys, os, glob
E = sys.argv[1]; out = sys.argv[2]
def load(p): return json.load(open(p))
runs = []
spec = [('R-hist', 'E_fixed_R2/study_fixture', 'recomputation of the 2014 published counts (Study page)'),
        ('R1-faithful-prefix', 'B_main_live_R1/04_wizard', 'new fetch, faithful, product before fixes (commit 58a0c93, unstamped)'),
        ('R1-recompute', 'D_R1_recompute/', 'recomputation of R1 stored counts by fixed code (ANALYSIS run)'),
        ('R3-faithful', 'G_fixed_R3/wizard_faithful', 'new fetch, faithful, fixed product'),
        ('R3-ext-repeat-1', 'G_fixed_R3/wizard_ext1', 'ENHANCED: repeat 1'), ('R3-ext-repeat-2', 'G_fixed_R3/wizard_ext2', 'ENHANCED: repeat 2'),
        ('R3-ext-gl-us', 'G_fixed_R3/wizard_ext3', 'ENHANCED: gl=us, google.com'), ('R3-ext-gl-pl', 'G_fixed_R3/wizard_ext4', 'ENHANCED: gl=pl, google.pl')]
for label, prefix, meaning in spec:
    base = os.path.join(E, prefix)
    if label == 'R1-recompute':
        ev = load(base + 'evaluation.json'); run_id = '9d80efca-d819-49fb-9b0c-fec57c0e8d74'; run = None; events = []
    elif label == 'R1-faithful-prefix':
        run = load(base + '_run.json')['run']; ev = None; events = load(base + '_fetch_events.json')['events']; run_id = run['id']
    else:
        run = load(base + '_run.json')['run']; ev = load(base + '_evaluation.json'); events = load(base + '_fetch_events.json')['events']; run_id = run['id']
    e = ev['evaluation'] if ev else None
    times = sorted(x['requested_at'] for x in events)
    runs.append({'label': label, 'meaning': meaning, 'run_id': run_id,
        'git_commit': run['git_commit'] if run else '55674c3a3633c0da759f035978214e2edb4576ec',
        'preset': (run['preset_id'], run['preset_version']) if run else None,
        'acquired_utc': [times[0], times[-1]] if times else None, 'fetches': len(events),
        'fetch_status': sorted({x['status'] for x in events}),
        'evaluation': None if not e else {
            'attempt_kind': e['attempt_kind'], 'complete': e['complete'], 'missing': e['missing_entities'],
            'hi_vs_reference': e['hi_vs_reference'], 'pi_vs_reference': e['pi_vs_reference'], 'pi_vs_published': e['pi_vs_published'],
            'verdicts': [{k: v[k] for k in ('claim_key', 'verdict', 'observed_value')} for v in e['verdicts']],
            'hypothesis_harm': e['hypothesis_harm']['reading'], 'quality_flags': e['quality_flags'],
            'exploratory': [{'id': x['id'], 'excluded': x['excluded'], 'hi_vs_reference': x['hi_vs_reference']} for x in e['exploratory']],
            'entities': [{k: r[k] for k in ('entity_id', 'Ni', 'Ni_harm', 'Pi', 'Hi', 'published_Pi', 'published_Hi', 'reference_score', 'flags')} for r in e['entities']]}})
diag = load(os.path.join(E, 'H_diag_T3_or/results.json'))
runs.append({'label': 'T3-or-decomposition', 'meaning': 'diagnostic acquisition: "X" "harm", "X" "harmful", "X" ("harm" OR "harmful")',
             'run_id': open(os.path.join(E, 'H_diag_T3_or/run_id')).read().strip(), 'git_commit': '64023580775afe0a0b5e68afa499bfb8f504ffa2',
             'counts': sorted([[o['entityId'], o['queryRole'], o['numericValue']] for o in diag['observations']])})
json.dump({'generated_from': 'stored WatchDog outputs (API) of the audit instance; no value recomputed here', 'runs': runs}, open(out, 'w'), indent=1, sort_keys=True)
print(len(runs))
