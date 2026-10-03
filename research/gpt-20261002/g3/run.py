#!/usr/bin/env python3
"""Frozen G3 pilot; dependency-free, offline, with exact replay in this runtime."""
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import platform
import random
import statistics
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
DETERMINISTIC = ('raw_trials.csv.gz', 'summary.json')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def pvalue(z):
    return math.erfc(abs(z) / math.sqrt(2))


def normals(rng, count):
    """Explicit Box-Muller; random.random() returns [0,1), so 1-u > 0."""
    result = []
    while len(result) < count:
        radius = math.sqrt(-2 * math.log(1 - rng.random()))
        angle = 2 * math.pi * rng.random()
        result.extend((radius * math.cos(angle), radius * math.sin(angle)))
    return result[:count]


def wilson(successes, n):
    z = statistics.NormalDist().inv_cdf(0.975)
    proportion = successes / n
    denom = 1 + z*z/n
    center = (proportion + z*z/(2*n))/denom
    half = z*math.sqrt(proportion*(1-proportion)/n + z*z/(4*n*n))/denom
    return {'count': successes, 'denominator': n, 'rate': proportion,
            'mc_wilson_95': [max(0.0, center-half), min(1.0, center+half)]}


def pick(values):
    # max returns the first tied index, matching the pre-result protocol.
    return max(range(len(values)), key=lambda i: abs(values[i]))


def evaluate(a, b, c, m, alpha):
    aa, bb, cc = a[:m], b[:m], c[:m]
    ab = [(x+y)/math.sqrt(2) for x,y in zip(aa,bb)]
    bc = [(x+y)/math.sqrt(2) for x,y in zip(bb,cc)]
    ia, iab = pick(aa), pick(ab)
    outcomes = {
        'explore_100': (ia, aa[ia], alpha, 100),
        'explore_100_bonferroni': (ia, aa[ia], alpha/m, 100),
        'confirm_100': (ia, bb[ia], alpha, 100),
        'confirm_200': (ia, bc[ia], alpha, 200),
        'explore_200': (iab, ab[iab], alpha, 200),
        'explore_200_bonferroni': (iab, ab[iab], alpha/m, 200),
        'no_search_100': (0, bb[0], alpha, 100),
        'no_search_200': (0, bc[0], alpha, 200),
    }
    return {k: (i, z, pvalue(z) <= threshold, n) for k,(i,z,threshold,n) in outcomes.items()}


def run(out):
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    clock = time.perf_counter()
    protocol = json.loads((ROOT/'protocol.json').read_text())
    expected = (ROOT/'protocol.sha256').read_text().split()[0]
    if sha(ROOT/'protocol.json') != expected:
        raise RuntimeError('Frozen protocol hash mismatch')
    if out.exists() and any(out.iterdir()):
        raise RuntimeError('Refusing to overwrite an existing result directory')
    out.mkdir(parents=True, exist_ok=True)
    design, gen = protocol['design'], protocol['generator']
    trials, max_m, n = design['trials_per_scenario'], gen['cohort_count_max'], gen['block_sample_size']
    alpha = design['alpha']
    if n != 100:
        raise RuntimeError('v1 method identifiers explicitly require n=100')
    aggregates, paired, checks = {}, {}, []
    comparisons = [('explore_200','confirm_100'), ('explore_100','confirm_100'), ('explore_200','confirm_200')]
    raw = out/'raw_trials.csv.gz'
    # Gzip header contains neither timestamp nor filename. Values retain full float precision.
    with raw.open('wb') as binary:
        with gzip.GzipFile(filename='', fileobj=binary, mode='wb', mtime=0, compresslevel=9) as zipped:
            with io.TextIOWrapper(zipped, encoding='utf-8', newline='') as stream:
                writer = csv.writer(stream, lineterminator='\n')
                writer.writerow(['scenario','trial'] + [f'{block}{i}' for block in ('A','B','C') for i in range(max_m)])
                for scenario in sorted(gen['scenarios']):
                    for trial in range(trials):
                        seed_material = f"g3-v1|{gen['root_seed']}|{scenario}|{trial}".encode()
                        seed = int.from_bytes(hashlib.sha256(seed_material).digest(), 'big')
                        draws = normals(random.Random(seed), max_m*3)
                        blocks = [draws[i*max_m:(i+1)*max_m] for i in range(3)]
                        if scenario == 'one_signal':
                            for block in blocks:
                                block[0] += gen['scenarios'][scenario]['mu_cohort_0']*math.sqrt(n)
                        writer.writerow([scenario,trial] + [format(v,'.17g') for block in blocks for v in block])
                        for m in design['search_budgets']:
                            outcomes = evaluate(*blocks, m, alpha)
                            if m == 1:
                                assert outcomes['confirm_100'] == outcomes['no_search_100']
                                assert outcomes['confirm_200'] == outcomes['no_search_200']
                                assert outcomes['explore_100'] == outcomes['explore_100_bonferroni']
                                assert outcomes['explore_200'] == outcomes['explore_200_bonferroni']
                            for method,(selected,z,rejected,eval_n) in outcomes.items():
                                key = (scenario,m,method)
                                agg = aggregates.setdefault(key, {'rejections':0,'true_discoveries':0,'false_discoveries':0,'selected_signal':0,'effect_sum':0.0,'absolute_effect_sum':0.0})
                                true_signal = scenario == 'one_signal' and selected == 0
                                agg['rejections'] += int(rejected)
                                agg['true_discoveries'] += int(rejected and true_signal)
                                agg['false_discoveries'] += int(rejected and not true_signal)
                                agg['selected_signal'] += int(true_signal)
                                agg['effect_sum'] += z/math.sqrt(eval_n)
                                agg['absolute_effect_sum'] += abs(z)/math.sqrt(eval_n)
                            for left,right in comparisons:
                                key = (scenario,m,left,right)
                                diff = int(outcomes[left][2])-int(outcomes[right][2])
                                p = paired.setdefault(key, {'sum':0,'sum_sq':0})
                                p['sum'] += diff
                                p['sum_sq'] += diff*diff
    rows = []
    critical = statistics.NormalDist().inv_cdf(1-alpha/2)
    for (scenario,m,method),agg in sorted(aggregates.items()):
        settings = design['methods'][method]
        row = {'scenario':scenario, 'search_budget':m, 'method':method,
               'evaluation_n_per_cohort':settings['evaluation_n'],
               'consumed_observations':settings['sample_cost_per_cohort']*(1 if method.startswith('no_search') else m),
               'mean_selected_effect':agg['effect_sum']/trials,
               'mean_absolute_selected_effect_descriptive':agg['absolute_effect_sum']/trials}
        for field in ('rejections','true_discoveries','false_discoveries','selected_signal'):
            row[field] = wilson(agg[field],trials)
        expected_p = None
        if scenario == 'null':
            if method.startswith('explore'):
                threshold = alpha/m if method.endswith('bonferroni') else alpha
                expected_p = 1-(1-threshold)**m
            else:
                expected_p = alpha
        elif method.startswith('no_search') or m == 1:
            shift = gen['scenarios']['one_signal']['mu_cohort_0']*math.sqrt(settings['evaluation_n'])
            expected_p = 0.5*math.erfc((critical-shift)/math.sqrt(2)) + 0.5*math.erfc((critical+shift)/math.sqrt(2))
        if expected_p is not None:
            observed = row['rejections']['rate']
            mc_se = math.sqrt(expected_p*(1-expected_p)/trials)
            check = {'scenario':scenario,'search_budget':m,'method':method,'expected':expected_p,'observed':observed,'absolute_error':abs(observed-expected_p),'tolerance_5_mc_se':5*mc_se,'within_frozen_tolerance':abs(observed-expected_p) <= 5*mc_se}
            row['analytic_rejection_probability'] = expected_p
            checks.append(check)
        rows.append(row)
    differences = []
    z95 = statistics.NormalDist().inv_cdf(.975)
    for (scenario,m,left,right),p in sorted(paired.items()):
        mean = p['sum']/trials
        variance = max(0.0,(p['sum_sq']-trials*mean*mean)/(trials-1))
        se = math.sqrt(variance/trials)
        differences.append({'scenario':scenario,'search_budget':m,'left':left,'right':right,'denominator_paired_trials':trials,'rejection_rate_difference':mean,'mc_se':se,'mc_normal_95':[mean-z95*se,mean+z95*se]})
    dump(out/'summary.json', {'protocol_sha256':expected,'rows':rows,'paired_comparisons':differences,'analytic_checks':checks,'all_analytic_checks_within_frozen_tolerance':all(c['within_frozen_tolerance'] for c in checks),'raw_schema':'One row per independent scenario/trial; A0..A19 B0..B19 C0..C19 are full precision z sufficient statistics. All method results derive from these bytes via evaluate().','raw_rows':trials*len(gen['scenarios'])})
    dump(out/'receipt.json', {'status':'completed','base_commit':protocol['base_commit'],'experiment_code_identity':'run.py SHA256 (commit assigned on publication; no invented head)', 'protocol_frozen_at_utc':protocol['frozen_at_utc'],'started_at_utc':started,'finished_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'elapsed_seconds':time.perf_counter()-clock,'environment':{'python':sys.version,'platform':platform.platform(),'stdlib_only':True},'network_calls':0,'paid_calls':0,'input_files':{'protocol.json':sha(ROOT/'protocol.json'),'run.py':sha(ROOT/'run.py')},'outputs':{name:{'sha256':sha(out/name),'bytes':(out/name).stat().st_size} for name in DETERMINISTIC}})
    return json.loads((out/'summary.json').read_text())


def verify_raw(saved):
    """Check summary counts against stored raw values, independent of random generation."""
    protocol = json.loads((ROOT/'protocol.json').read_text())
    counts, seen = {}, set()
    mmax = protocol['generator']['cohort_count_max']
    with gzip.open(saved/'raw_trials.csv.gz','rt',newline='') as stream:
        for row in csv.DictReader(stream):
            key = (row['scenario'],int(row['trial']))
            if key in seen:
                raise AssertionError('duplicate raw trial')
            seen.add(key)
            blocks = [[float(row[f'{b}{i}']) for i in range(mmax)] for b in ('A','B','C')]
            for m in protocol['design']['search_budgets']:
                for method,(selected,z,rejected,eval_n) in evaluate(*blocks,m,protocol['design']['alpha']).items():
                    k = (row['scenario'],m,method)
                    count = counts.setdefault(k, [0,0,0,0])
                    signal = row['scenario']=='one_signal' and selected==0
                    count[0] += int(rejected)
                    count[1] += int(rejected and signal)
                    count[2] += int(rejected and not signal)
                    count[3] += int(signal)
    summary = json.loads((saved/'summary.json').read_text())
    assert len(seen) == summary['raw_rows']
    for row in summary['rows']:
        values = counts[(row['scenario'],row['search_budget'],row['method'])]
        for field,value in zip(('rejections','true_discoveries','false_discoveries','selected_signal'),values):
            assert row[field]['count'] == value
    return len(seen)


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--out',type=Path)
    group.add_argument('--verify',type=Path)
    args = parser.parse_args()
    if args.out:
        result = run(args.out)
        print(json.dumps({'status':'completed','output':str(args.out),'raw_trials':result['raw_rows'],'analytic_checks':len(result['analytic_checks']),'all_checks_pass':result['all_analytic_checks_within_frozen_tolerance']}))
    else:
        receipt = json.loads((args.verify/'receipt.json').read_text())
        assert receipt['input_files']['protocol.json'] == sha(ROOT/'protocol.json')
        assert receipt['input_files']['run.py'] == sha(ROOT/'run.py')
        for name in DETERMINISTIC:
            assert receipt['outputs'][name]['sha256'] == sha(args.verify/name)
        rows = verify_raw(args.verify)
        with tempfile.TemporaryDirectory(prefix='watchdog-g3-replay-') as temporary:
            replay = Path(temporary)/'results'
            run(replay)
            for name in DETERMINISTIC:
                assert sha(replay/name) == sha(args.verify/name), f'Replay mismatch: {name}'
        print(json.dumps({'status':'exact_replay_verified','raw_trials_recomputed':rows,'artifacts_verified':list(DETERMINISTIC),'runtime_receipt':'Excluded from byte comparison: actual timestamps, elapsed time and platform differ.'}))


if __name__ == '__main__':
    main()
