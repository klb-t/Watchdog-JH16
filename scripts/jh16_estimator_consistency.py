#!/usr/bin/env python3
"""Set-logic consistency of stored JH16 counts: 2014 (paper) against 2026 (stored runs).

Exploratory evidence for the open diagnosis "Zmiana sposobu szacowania przez Google
od 2014 r." (config/replication/jh2016-dossier.json). It does not decide that
diagnosis and is not part of the pre-registered protocol. No WatchDog code is
imported; every number is read from the files named on the command line or
counted from them.

The harm query "X" "harm" OR "harmful" can only match pages that also match "X",
so a true page count can never give Ni_harm > Ni. A count with Ni_harm > Ni (and
hence Hi > 100%) is incoherent whatever the web contains. Likewise the grouped
query "X" ("harm" OR "harmful") can be neither smaller than either component nor
larger than their sum.

Usage:

  python3 -I scripts/jh16_estimator_consistency.py \\
      --paper fixtures/jh2016/paper_reported.json \\
      [--export LABEL=RUN_EXPORT.json ...] \\
      [--entities LABEL=FILE.json#RUN_ID_PREFIX ...] \\
      [--or-decomposition T3_RESULTS.json] [--small-count-below 1000] [--root DIR]

--export   a run export (GET /api/runs/<id>/export?format=json): observations.
--entities a file with runs[].run_id and runs[].evaluation.entities (Ni, Ni_harm),
           e.g. docs/replication/JH16_2026-10-25/results.json.
Prints one JSON document (sorted keys, stable order) on stdout.
"""
import argparse, hashlib, json, os, sys


def sha256(path):
    with open(path, 'rb') as f: return hashlib.sha256(f.read()).hexdigest()


def rel(path, root):
    return os.path.relpath(os.path.abspath(path), os.path.abspath(root)).replace(os.sep, '/')


def counts_from_export(doc):
    ni, nh = {}, {}
    for o in doc['observations']:
        role = o['query_role']
        if role not in ('popularity', 'harm'): continue
        (ni if role == 'popularity' else nh)[o['entity_id']] = None if o['is_missing'] else o['value_numeric']
    return doc['run_id'], {e: (ni.get(e), nh.get(e)) for e in sorted(set(ni) | set(nh))}


def counts_from_entities(doc, prefix):
    hits = [r for r in doc['runs'] if r['run_id'].startswith(prefix)]
    if len(hits) != 1: raise SystemExit(f'run prefix {prefix!r}: {len(hits)} matches, expected 1')
    r = hits[0]
    if not r.get('evaluation'): raise SystemExit(f'run {r["run_id"]} has no stored evaluation')
    return r['run_id'], {e['entity_id']: (e['Ni'], e['Ni_harm']) for e in sorted(r['evaluation']['entities'], key=lambda x: x['entity_id'])}


def counts_from_paper(doc):
    return {s['canonical']: (s['Ni'], s['Ni_harm']) for s in sorted(doc['substances'], key=lambda x: x['canonical'])}


def summarize(label, kind, path, root, run_id, counts, small):
    pairs = {e: c for e, c in counts.items() if c[0] is not None and c[1] is not None and c[0] > 0}
    violations = sorted(e for e, (n, h) in pairs.items() if h > n)
    # The same check restricted to pairs where neither count is below the threshold, so that a
    # count collapsed to a few dozen reachable results does not create the violation by itself.
    large = {e: c for e, c in pairs.items() if c[0] >= small and c[1] >= small}
    violations_large = sorted(e for e, (n, h) in large.items() if h > n)
    small_counts = sorted(f'{e}/{role}' for e, c in counts.items() for role, v in (('popularity', c[0]), ('harm', c[1])) if v is not None and v < small)
    missing = sorted(f'{e}/{role}' for e, c in counts.items() for role, v in (('popularity', c[0]), ('harm', c[1])) if v is None)
    max_e = max(pairs, key=lambda e: (pairs[e][1] / pairs[e][0], e)) if pairs else None
    return {'label': label, 'kind': kind, 'file': rel(path, root), 'file_sha256': sha256(path), 'run_id': run_id,
            'entities': len(counts), 'valid_pairs': len(pairs), 'missing_counts': missing,
            'harm_count_above_popularity_count': violations, 'violations': len(violations),
            'counts_below_threshold': small_counts,
            'pairs_without_small_counts': len(large), 'harm_count_above_popularity_count_without_small_counts': violations_large,
            'violations_without_small_counts': len(violations_large),
            'max_hi': None if max_e is None else {'entity': max_e, 'Ni': pairs[max_e][0], 'Ni_harm': pairs[max_e][1]}}


def or_checks(path, root):
    doc = json.load(open(path))
    by = {}
    for o in doc['observations']:
        by.setdefault(o['entityId'], {})[o['queryRole']] = None if o['isMissing'] else o['numericValue']
    rows = []
    for e in sorted(by):
        q = by[e]; a, b, g = q.get('d1_harm_only'), q.get('d2_harmful_only'), q.get('d3_grouped_or')
        if None in (a, b, g): rows.append({'entity': e, 'harm': a, 'harmful': b, 'grouped_or': g, 'checkable': False}); continue
        rows.append({'entity': e, 'harm': a, 'harmful': b, 'grouped_or': g, 'checkable': True,
                     'or_below_a_component': g < max(a, b), 'or_above_sum_of_components': g > a + b})
    return {'file': rel(path, root), 'file_sha256': sha256(path), 'run_id': doc['run_id'], 'rows': rows,
            'incoherent': sorted(r['entity'] for r in rows if r['checkable'] and (r['or_below_a_component'] or r['or_above_sum_of_components']))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--paper', required=True)
    ap.add_argument('--export', action='append', default=[])
    ap.add_argument('--entities', action='append', default=[])
    ap.add_argument('--or-decomposition')
    ap.add_argument('--small-count-below', type=int, default=1000)
    ap.add_argument('--root', default='.')
    a = ap.parse_args()

    paper = summarize('2014 (Tabele 1 i 3 publikacji)', 'paper', a.paper, a.root, None, counts_from_paper(json.load(open(a.paper))), a.small_count_below)
    runs = []
    for spec in a.export:
        label, path = spec.split('=', 1)
        run_id, counts = counts_from_export(json.load(open(path)))
        runs.append(summarize(label, 'export', path, a.root, run_id, counts, a.small_count_below))
    for spec in a.entities:
        label, rest = spec.split('=', 1); path, prefix = rest.rsplit('#', 1)
        run_id, counts = counts_from_entities(json.load(open(path)), prefix)
        runs.append(summarize(label, 'stored_evaluation', path, a.root, run_id, counts, a.small_count_below))
    runs.sort(key=lambda r: r['label'])
    ids = [r['run_id'] for r in runs]
    if len(set(ids)) != len(ids): raise SystemExit('the same run is listed twice')

    k = sum(r['violations'] for r in runs); n = sum(r['valid_pairs'] for r in runs)
    rates = [r['violations'] / r['valid_pairs'] for r in runs if r['valid_pairs']]
    kl = sum(r['violations_without_small_counts'] for r in runs); nl = sum(r['pairs_without_small_counts'] for r in runs)
    rates_l = [r['violations_without_small_counts'] / r['pairs_without_small_counts'] for r in runs if r['pairs_without_small_counts']]
    n0 = paper['valid_pairs']
    out = {
        'what': 'Set-logic consistency of stored JH16 counts (exploratory, outside the pre-registered protocol; decides nothing).',
        'rule': 'A true page count satisfies Ni_harm <= Ni, because the harm query is a subset of the popularity query; Ni_harm > Ni (Hi > 100%) is incoherent regardless of web content.',
        'small_count_threshold': a.small_count_below,
        'paper_2014': paper,
        'runs_2026': runs,
        'pooled_2026': {'runs': len(runs), 'valid_pairs': n, 'violations': k,
                        'pairs_without_small_counts': nl, 'violations_without_small_counts': kl},
        'exploratory_probability': None if not runs or not n else {
            'question': 'If the 2014 estimator had produced Ni_harm > Ni as often as the 2026 runs did, how likely is it that none of the paper\'s pairs shows it?',
            'assumption': 'pairs independent, rate constant across substances; the 2014 values are the paper\'s published transcription (one snapshot; whether the authors repeated or screened queries is unknown)',
            'pairs_2014': n0, 'violations_2014': paper['violations'],
            'pooled_rate_2026': k / n, 'p_zero_at_pooled_rate': (1 - k / n) ** n0,
            'lowest_run_rate_2026': min(rates), 'p_zero_at_lowest_rate': (1 - min(rates)) ** n0,
            'without_small_counts': None if not nl else {
                'pooled_rate_2026': kl / nl, 'p_zero_at_pooled_rate': (1 - kl / nl) ** n0,
                'lowest_run_rate_2026': min(rates_l), 'p_zero_at_lowest_rate': (1 - min(rates_l)) ** n0}},
    }
    if a.or_decomposition: out['or_decomposition_2026'] = or_checks(a.or_decomposition, a.root)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
