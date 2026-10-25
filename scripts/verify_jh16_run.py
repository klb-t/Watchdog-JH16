#!/usr/bin/env python3
"""Independent check of a WatchDog JH16 run (no WatchDog code is imported).

Recomputes Pi, Hi and the correlations with the reference scores from the
stored counts in a run's export, and compares them with the values WatchDog
stored. Usage:

  python3 -I scripts/verify_jh16_run.py RUN_EXPORT.json [config/reference/nutt-2010.json]

The export is GET /api/runs/<id>/export?format=json (it carries the counts and
the stored evaluation). Exit status 1 when a recomputed value differs.
"""
import json, math, sys


def pearson(x, y):
    n = len(x); mx = sum(x) / n; my = sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy)


def ranks(v):
    order = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]: j += 1
        for k in range(i, j + 1): r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(x, y): return pearson(ranks(x), ranks(y))


def p_two_sided(r, n):
    """t test with n-2 degrees of freedom via the regularized incomplete beta."""
    if n < 3 or abs(r) >= 1: return None
    df = n - 2; t = r * math.sqrt(df / (1 - r * r)); x = df / (df + t * t); a, b = df / 2, 0.5
    def cf(a, b, x):
        c, d = 1.0, 1 - (a + b) * x / (a + 1); d = 1 / d; h = d
        for m in range(1, 300):
            m2 = 2 * m; aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2))
            d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c
            aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2))
            d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; de = d * c; h *= de
            if abs(de - 1) < 1e-15: break
        return h
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    return front * cf(a, b, x) / a if x < (a + 1) / (a + b + 2) else 1 - front * cf(b, a, 1 - x) / b


def main():
    export = json.load(open(sys.argv[1]))
    ref = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'config/reference/nutt-2010.json'))['scores']
    N, H = {}, {}
    for o in export['observations']:
        if not o['is_missing']: (N if o['query_role'] == 'popularity' else H)[o['entity_id']] = o['value_numeric']
    valid = [e for e in sorted(ref) if e in N]
    mx = max(N[e] for e in valid)
    Pi = {e: N[e] / mx * 100 for e in valid}
    Hi = {e: H[e] / N[e] * 100 for e in valid if e in H and N[e] > 0}
    stored = {(r['metric_key'], r['entity_id']): r['value_numeric'] for r in export['results'] if r['entity_id']}
    bad = [(k, e, v, stored.get((k, e))) for k, d in (('Pi', Pi), ('Hi', Hi)) for e, v in d.items()
           if stored.get((k, e)) is None or abs(stored[(k, e)] - v) > 1e-9 * max(1, abs(v))]
    keys = sorted(Hi)
    x, y = [Hi[e] for e in keys], [ref[e] for e in keys]
    out = {'n_Pi': len(Pi), 'n_Hi': len(Hi), 'value_mismatches': bad,
           'hi_vs_reference': {'pearson': pearson(x, y), 'pearson_p': p_two_sided(pearson(x, y), len(x)),
                               'spearman': spearman(x, y), 'spearman_p': p_two_sided(spearman(x, y), len(x))}}
    ev = export.get('evaluation')
    if ev:
        for s in ev['hi_vs_reference']:
            mine = out['hi_vs_reference'][s['statistic']]
            if s['value'] is None or abs(s['value'] - mine) > 1e-9: bad.append(('evaluation', s['statistic'], mine, s['value']))
    print(json.dumps(out, indent=2))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
