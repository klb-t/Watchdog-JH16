#!/usr/bin/env python3
"""Independent check of a CR2014 run: recompute Pearson r and its two-sided p from
the stored raw Google Trends response and the stored raw CDC YRBSS file, without
WatchDog code. Prints the values and the paper's reported RSV extremes beside the
measured ones.

  python3 scripts/verify_cr2014_run.py RAW_TRENDS.json fixtures/cr2014/yrbss_2011_current_cigar_use.json fixtures/cr2014/paper_reported.json
"""
import json, math, sys

FIPS = {'01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
        '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
        '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
        '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
        '54': 'WV', '55': 'WI', '56': 'WY'}

def pearson(x, y):
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y)); sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy)

def p_two_sided(r, n, steps=200000):
    """P(|T| >= |t|) for Student t with n-2 df, by Simpson integration of the density (independent of the app's incomplete beta)."""
    df = n - 2; t = abs(r) * math.sqrt(df / (1 - r * r))
    c = math.gamma((df + 1) / 2) / (math.sqrt(df * math.pi) * math.gamma(df / 2))
    f = lambda u: c * (1 + u * u / df) ** (-(df + 1) / 2)
    h = t / steps; s = f(0) + f(t) + sum((4 if i % 2 else 2) * f(i * h) for i in range(1, steps))
    return 1 - 2 * (s * h / 3)

trends, yrbss, paper = (json.load(open(p)) for p in sys.argv[1:4])
rsv = {r['geo']: r['extracted_value'] for r in trends['interest_by_region']}
ref = {'US-' + FIPS[r['locationid']]: float(r['greater_risk_data_value']) for r in yrbss}
pairs = sorted((g, rsv[g], ref[g]) for g in ref if g in rsv)
missing = sorted(g for g in ref if g not in rsv)
r = pearson([p[1] for p in pairs], [p[2] for p in pairs])
print(json.dumps({'n': len(pairs), 'missing': missing, 'pearson': round(r, 12), 'p_two_sided': round(p_two_sided(r, len(pairs)), 8)}))
sub = [p for p in pairs if p[0] not in ('US-UT', 'US-RI')]; r2 = pearson([p[1] for p in sub], [p[2] for p in sub])
print(json.dumps({'without_UT_RI': {'n': len(sub), 'pearson': round(r2, 12), 'p_two_sided': round(p_two_sided(r2, len(sub)), 8)}}))
rep = paper['reported_rsv_cigar_2011']
print(json.dumps({'paper_rsv_extremes_vs_measured': {k: {g: [v, rsv.get(g)] for g, v in rep[k].items()} for k in rep},
                  'measured_top5': sorted(rsv.items(), key=lambda x: -x[1])[:5], 'measured_bottom5': sorted(rsv.items(), key=lambda x: x[1])[:5], 'regions': len(rsv)}))
