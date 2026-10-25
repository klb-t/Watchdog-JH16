#!/usr/bin/env python3
"""Independent check of a WatchDog Trends calibration run (no WatchDog code).

Recomputes anchor chaining, window means and the rank comparisons from the
exported observations and the run's own configuration, and compares them with
the results WatchDog stored. Usage:

  python3 -I scripts/verify_trends_calibration.py EXPORT.json RUN.json

EXPORT.json is GET /api/runs/<id>/export?format=json, RUN.json is GET /api/runs/<id>.
Exit status 1 on any difference larger than 1e-9.
"""
import json, math, sys


def pearson(x, y):
    n = len(x); mx = sum(x) / n; my = sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y)); sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else None


def ranks(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and abs(v[o[j + 1]] - v[o[i]]) <= 1e-12 * max(abs(v[o[j + 1]]), abs(v[o[i]])): j += 1  # same tie rule as WatchDog
        for k in range(i, j + 1): r[o[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def main():
    export = json.load(open(sys.argv[1])); cfg = json.loads(json.load(open(sys.argv[2]))['run']['effective_config'])
    p = cfg['method_params']; cal = p['calibration']; ent = lambda t: p['term_entities'].get(t, t)
    raw = {}
    for o in export['observations']:
        if o['is_missing'] or not o.get('observed_at') or not o['query_role'].startswith('interest:'): continue
        raw.setdefault(o['query_role'][9:], {}).setdefault(o['entity_id'], {})[o['observed_at'][:7]] = o['value_numeric']
    scaled, factor = {}, {}
    for g in cal['groups']:
        own = raw.get(g['id'], {}); k = 1.0
        if g.get('scale_to'):
            a = ent(g['anchor']); target = raw[g['scale_to']].get(a) if g['scale_to'] == cal['groups'][0]['id'] else scaled.get(a)
            num = sum(target.values()) if target else 0; den = sum(own.get(a, {}).values())
            k = num / den if num > 0 and den > 0 and factor.get(g['scale_to']) is not None else None
        factor[g['id']] = k
        if k is None: continue
        for t in g['terms']:
            e = ent(t)
            if e in own and e not in scaled: scaled[e] = {m: v * k for m, v in own[e].items()}
    def wmean(e, w):
        ms = cal['windows'][w]; xs = [scaled.get(e, {}).get(m) for m in ms]
        return None if any(x is None for x in xs) else sum(xs) / len(xs)
    refs = {'published_pi': p['published_pi'], 'published_pi_may2012': p.get('published_pi_may2012'), 'compare_pi': p.get('compare_pi')}
    def named(n, e): return wmean(e, n) if n in cal['windows'] else (refs.get(n) or {}).get(e)
    def side(s, e):
        if 'window' in s: return wmean(e, s['window'])
        if 'reference' in s: return (refs.get(s['reference']) or {}).get(e)
        t, b = named(s['ratio'][0], e), named(s['ratio'][1], e)
        return None if t is None or b is None or b == 0 else t / b
    entities = sorted(ent(t) for t in p['term_entities'])
    mine = {f'scale_{g}': v for g, v in factor.items()}
    for a in cal['analyses']:
        ex = [e for e in entities if a.get('exclude_compare_flag') in ((p.get('compare_flags') or {}).get(e) or [])] if a.get('exclude_compare_flag') else []
        pairs = [(side(a['x'], e), side(a['y'], e)) for e in entities if e not in ex]
        pairs = [xy for xy in pairs if None not in xy]
        mine[f"{a['id']}_spearman"] = pearson(ranks([x for x, _ in pairs]), ranks([y for _, y in pairs])) if len(pairs) >= 3 else None
        logs = [(math.log10(x), math.log10(y)) for x, y in pairs if x > 0 and y > 0]
        mine[f"{a['id']}_pearson_log10"] = pearson([x for x, _ in logs], [y for _, y in logs]) if len(logs) >= 3 else None
        mine[f"{a['id']}_n"] = len(pairs)
    stored = {r['metric_key']: r['value_numeric'] for r in export['results'] if r['entity_id'] is None}
    bad = [(k, v, stored.get(k)) for k, v in mine.items() if (v is None) != (stored.get(k) is None) or (v is not None and abs(v - stored[k]) > 1e-9)]
    print(json.dumps({'recomputed': mine, 'mismatches': bad}, indent=1))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
