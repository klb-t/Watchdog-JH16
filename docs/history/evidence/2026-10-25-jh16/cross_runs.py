"""Independent cross-run diagnostics from stored observations (no new requests)."""
import json, sys, math, statistics as st
sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
from verify_paper_lib import pearson, spearman
E = sys.argv[1]
runs = [('R1', f'{E}/B_main_live_R1/04_wizard_results.json', 'default'), ('R3f', f'{E}/G_fixed_R3/wizard_faithful_results.json', 'default'),
        ('R3r1', f'{E}/G_fixed_R3/wizard_ext1_results.json', 'default'), ('R3r2', f'{E}/G_fixed_R3/wizard_ext2_results.json', 'default'),
        ('R3us', f'{E}/G_fixed_R3/wizard_ext3_results.json', 'gl=us'), ('R3pl', f'{E}/G_fixed_R3/wizard_ext4_results.json', 'gl=pl')]
paper = {s['canonical']: s for s in json.load(open(sys.argv[2]))['substances']}
ref = json.load(open(sys.argv[3]))['scores']
data = {}
for tag, path, cond in runs:
    for o in json.load(open(path))['observations']:
        data.setdefault((o['entityId'], o['queryRole']), {})[tag] = (o['numericValue'], 'PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS' in o['qualityFlags'] or (o['numericValue'] or 0) < 1000)
tags = [t for t, _, _ in runs]
print('query'.ljust(40), ' '.join(t.rjust(12) for t in tags), ' 2014'.rjust(12))
collapsed = {t: [] for t in tags}
for (e, role), vals in sorted(data.items()):
    row = []
    for t in tags:
        v, c = vals.get(t, (None, False))
        if c: collapsed[t].append(f'{e}/{role}')
        row.append(('*' if c else '') + (f'{v:,}' if v is not None else '—'))
    p = paper[e]['Ni'] if role == 'popularity' else paper[e]['Ni_harm']
    print(f'{e[:26]:26} {role:13}', ' '.join(x.rjust(12) for x in row), f'{p:,}'.rjust(12))
print('\n* = reachable-result count (flagged, or < 1000 in R1 which predates the flag)')
for t in tags: print(t, 'collapsed:', collapsed[t])
# variability among the four default-condition runs, excluding collapsed values
print('\nBetween-request variability (default condition: R1,R3f,R3r1,R3r2; collapsed values excluded):')
cvs = []
for (e, role), vals in sorted(data.items()):
    xs = [vals[t][0] for t in ['R1', 'R3f', 'R3r1', 'R3r2'] if t in vals and not vals[t][1] and vals[t][0]]
    if len(xs) >= 2:
        cv = st.pstdev(xs) / st.mean(xs); cvs.append(cv)
        if cv > 0.05: print(f'  {e}/{role}: {[f"{x:,}" for x in xs]} cv={cv:.2f}')
print(f'  median CV {st.median(cvs):.3f}, max {max(cvs):.2f}, n={len(cvs)}')
# logical incoherence: harm (subset) estimate above popularity estimate
print('\nNi_harm > Ni (the harm query is a subset of the popularity query, so this is incoherent):')
for t in tags:
    bad = [e for e in ref if data[(e, 'harm')][t][0] and data[(e, 'popularity')][t][0] and data[(e, 'harm')][t][0] > data[(e, 'popularity')][t][0]]
    print(' ', t, bad)
# Hi correlation using only non-collapsed pairs, per run
print('\nHi vs Nutt with non-collapsed pairs only (exploratory):')
for t in tags:
    ks = [e for e in sorted(ref) if not data[(e, 'harm')][t][1] and not data[(e, 'popularity')][t][1]]
    hi = [data[(e, 'harm')][t][0] / data[(e, 'popularity')][t][0] * 100 for e in ks]
    print(f'  {t}: n={len(ks)} pearson={pearson(hi, [ref[e] for e in ks]):.3f} spearman={spearman(hi, [ref[e] for e in ks]):.3f}  max Hi={max(hi):.0f}% ({ks[hi.index(max(hi))]})')
