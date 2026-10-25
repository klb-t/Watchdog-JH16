"""Exploratory Google Trends calibration of JH16 (see CALIBRATION_PLAN.md). Reads only saved raw files."""
import json, sys, glob, math, statistics as st
sys.path.insert(0, '/home/kielbowicz_marcin/wt/jh16_audit_2026-10-25/scripts')
from verify_paper_lib import pearson, spearman
D = sys.argv[1]; paper = {s['query_label']: s for s in json.load(open(sys.argv[2]))['substances']}
r3 = json.load(open(sys.argv[3]))['evaluation']['entities']
label = {s['canonical']: s['query_label'] for s in json.load(open(sys.argv[2]))['substances']}
r3pi = {label[e['entity_id']]: e['Pi'] for e in r3}; r3flag = {label[e['entity_id']] for e in r3 if 'PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS' in e['flags']}
def series(path):
    d = json.load(open(path)); out = {}
    for pt in d['interest_over_time']['timeline_data']:
        for v in pt['values']: out.setdefault(v['query'], {})[pt['date']] = v.get('extracted_value', 0)
    return out
def load(geo, rep=0):
    return {g: series(glob.glob(f'{D}/trends_raw/{g}_{geo}_r{rep}_*.json')[0]) for g in ['G1', 'G2', 'G3', 'G4']}
def combine(G):
    tot = lambda s: sum(s.values())
    out = dict(G['G1'])
    for g in ['G2', 'G3']:
        k = tot(G['G1']['cocaine']) / tot(G[g]['cocaine'])
        for q, s in G[g].items():
            if q != 'cocaine': out[q] = {m: v * k for m, v in s.items()}
    k = tot(out['methadone']) / tot(G['G4']['methadone'])
    for q, s in G['G4'].items():
        if q not in out: out[q] = {m: v * k for m, v in s.items()}
    return out
def mean(s, months): xs = [s[m] for m in months if m in s]; return sum(xs) / len(xs)
def rank_report(name, a, b, keys):
    ks = [k for k in keys if a.get(k) is not None and b.get(k) is not None]
    x = [a[k] for k in ks]; y = [b[k] for k in ks]
    lx = [math.log10(v) if v > 0 else None for v in x]; ly = [math.log10(v) if v > 0 else None for v in y]
    ok = [i for i in range(len(ks)) if lx[i] is not None and ly[i] is not None]
    pl = pearson([lx[i] for i in ok], [ly[i] for i in ok]) if len(ok) > 2 else float('nan')
    print(f'  {name}: n={len(ks)} spearman={spearman(x, y):.3f} pearson(log10)={pl:.3f}')
labels = sorted(paper)
JUN14 = ['Jun 2014']; MAY12 = ['May 2012']; LAST12 = [f'{m} {y}' for y, ms in ((2025, ['Nov', 'Dec']), (2026, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])) for m in ms]
pub_pi = {k: paper[k]['Pi_percent'] for k in labels}
t2 = json.load(open(sys.argv[2]))['table2_popularity_over_time']['Pi_percent']; t2 = {label[c]: v for c, v in t2.items()}
for geo in ['WORLD', 'US', 'GB', 'PL']:
    S = combine(load(geo)); missing = [k for k in labels if k not in S]
    zero14 = [k for k in labels if mean(S[k], JUN14) == 0]
    print(f'[{geo}] terms below Trends resolution in Jun 2014: {zero14}')
    tr14 = {k: mean(S[k], JUN14) for k in labels}; tr26 = {k: mean(S[k], LAST12) for k in labels}; tr12 = {k: mean(S[k], MAY12) for k in labels}
    if geo == 'WORLD':
        print('  Trends (scaled, cocaine-anchored) Jun 2014 / last 12 months to Oct 2026:')
        for k in sorted(labels, key=lambda k: -tr14[k]): print(f'    {k:16} {tr14[k]:7.2f} {tr26[k]:7.2f}   Pi2014={pub_pi[k]:5}  Pi2026={r3pi[k]:.2f}{" (reachable-count)" if k in r3flag else ""}')
    rank_report('A1 Trends Jun2014 vs published Pi (Table 1)', tr14, pub_pi, labels)
    rank_report('A2 change May2012->Jun2014: Trends vs Table 2 Pi', {k: tr14[k] / tr12[k] if tr12[k] else None for k in labels}, {k: t2[k][5] / t2[k][0] for k in labels}, labels)
    rank_report('A3 Trends last 12 months vs our 2026 Pi (R3)', tr26, r3pi, labels)
    rank_report('A3b same, without reachable-count Pi', tr26, r3pi, [k for k in labels if k not in r3flag])
    rank_report('A4 change 2014->2026: Trends vs Pi', {k: tr26[k] / tr14[k] if tr14[k] else None for k in labels}, {k: r3pi[k] / pub_pi[k] for k in labels if k not in r3flag}, labels)
A = series(glob.glob(f'{D}/trends_raw/G1_WORLD_r0_*.json')[0]); B = series(glob.glob(f'{D}/trends_raw/G1_WORLD_r1_*.json')[0])
d = [abs(A[q][m] - B[q][m]) for q in ['cocaine', 'alcohol', 'heroin', 'cannabis', 'LSD'] for m in A[q]]
print(f'sampling noise, G1 world repeated: mean |diff| = {st.mean(d):.2f} points (0-100 scale), max {max(d)}')
