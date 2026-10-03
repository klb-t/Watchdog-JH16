#!/usr/bin/env python3
"""Materialize the predetermined G2 fixture battery; never reads outcome files."""
from pathlib import Path
import copy, datetime, hashlib, json, subprocess
ROOT = Path(__file__).resolve().parent
BASE = '61daefd82cc778e28d2d3868eaaf0689d856fc49'

def encoded(x):
    return (json.dumps(x, indent=2, sort_keys=True, ensure_ascii=False) + '\n').encode()

def main():
    if (ROOT / 'freeze.json').exists():
        raise SystemExit('Inputs already frozen; use the saved inputs for replay.')
    paths = ['shared/clinical_demo_profile.ts', 'shared/clinical_demo_selector.ts', 'shared/clinical_demo.ts', 'docs/history/evidence/2026-10-01/clinical-case-a.json']
    sources = []
    for path in paths:
        raw = subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT)
        target = ROOT / 'source' / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        sources.append({'repository_path': path, 'snapshot_path': str(target.relative_to(ROOT)), 'sha256': hashlib.sha256(raw).hexdigest()})
    archived = json.loads((ROOT / 'source' / paths[-1]).read_bytes())
    template = archived['profile']['tests'][0]
    dependency = archived['execution']['trace']['rules'][0]['dependencies'][0]['dependency']
    case = archived['execution']['archive']['input']['case']

    def test(name, quantity='alpha', cost=1, available=True, requires=(), **overrides):
        out = copy.deepcopy(template)
        out.update(id='fixture:test-' + name, quantityId='fixture:q-' + quantity, unit='fixture:u-' + quantity, available=available)
        out.update(overrides)
        return {'profileTest': out, 'experimentalCost': cost, 'experimentalRequires': ['fixture:test-' + x for x in requires]}

    def dep(quantity, number=1, state='missing', **overrides):
        out = copy.deepcopy(dependency)
        out.update(id=f'fixture:dependency-{quantity}-{number}', quantityId='fixture:q-' + quantity, unit='fixture:u-' + quantity)
        out.update(overrides)
        return {'dependency': out, 'state': state, 'ruleId': f'fixture:rule-{quantity}-{number}', 'ruleEligible': True, 'ruleConflict': False}

    def scenario(name, tests, deps, budget, note):
        return {'id': name, 'purpose': 'software-demonstration', 'context': case['context'], 'referenceTime': case['referenceTime'],
                'tests': tests, 'dependencies': deps, 'unresolvedHypothesisIds': archived['execution']['trace']['unresolvedHypothesisIds'],
                'budgetGrid': list(range(sum(t['experimentalCost'] for t in tests) + 1)), 'illustrativeBudget': budget, 'construction': note}

    scenarios = [
        scenario('archived_satisfied_control', [test('alpha')], [dep('alpha', state='satisfied')], 1, 'Original archive already has alpha; no additional coverage is possible.'),
        scenario('single_missing', [test('alpha')], [dep('alpha')], 1, 'Counterfactual missing alpha, preserving fictional profile contract.'),
        scenario('unavailable', [test('alpha', available=False)], [dep('alpha')], 1, 'No candidate can cover the missing dependency.'),
        scenario('redundant_profile', [test('a-alpha'), test('b-alpha-copy'), test('c-beta', 'beta', 2), test('d-gamma', 'gamma', 1, False)],
                 [dep('alpha'), dep('beta', 1), dep('beta', 2), dep('gamma')], 3,
                 'Two alpha tests are redundant coverage, not independent confirmations. Gamma remains unavailable.'),
        scenario('shared_prerequisite', [test('a-alpha', cost=1, requires=('z-prep',)), test('b-beta', 'beta', 1, requires=('z-prep',)), test('z-prep', 'prep', 2)],
                 [dep('alpha', 1), dep('alpha', 2), dep('beta', 1), dep('beta', 2)], 4,
                 'Fictional acquisition prerequisite cost is paid once; it is not a clinical causal edge.'),
        scenario('unavailable_prerequisite', [test('a-alpha', requires=('z-prep',)), test('b-beta', 'beta', 2), test('z-prep', 'prep', 1, False)],
                 [dep('alpha'), dep('beta')], 3, 'An unavailable prerequisite prevents the dependent candidate even when that candidate itself is available.'),
        scenario('ratio_counterexample', [test('a-alpha', cost=2), test('b-beta', 'beta', 3), test('c-gamma', 'gamma', 3)],
                 [dep('alpha', n) for n in range(1, 4)] + [dep('beta', n) for n in range(1, 5)] + [dep('gamma', n) for n in range(1, 5)], 6,
                 'Prespecified knapsack ratio trap: alpha ratio 3/2, beta and gamma 4/3. Exact enumeration must expose a gap at budget 6.'),
    ]
    blocked_deps = [dep('alpha'), dep('beta'), dep('gamma'), dep('delta'), dep('epsilon'), dep('zeta')]
    blocked_deps[1]['state'] = 'not_applicable'
    blocked_deps[2]['ruleEligible'] = False
    blocked_deps[3]['ruleConflict'] = True
    blocked_deps[4]['dependency']['observationId'] = 'fixture:old-pinned-observation'
    blocked_deps[5]['state'] = 'source_unapproved'
    scenarios.append(scenario('gates_and_preserved_unknowns', [test('a-alpha-bad-unit', unit='fixture:wrong-unit'), test('b-alpha-late', timing={'eventOffsetMs': 2000, 'measurementOffsetMs': 3000}),
        test('c-beta', 'beta'), test('d-gamma', 'gamma'), test('e-delta', 'delta'), test('f-epsilon', 'epsilon'), test('g-zeta', 'zeta')], blocked_deps, 7,
        'Nothing may erase nonrepairable, ineligible, conflicted, pinned or unavailable observations; no historical backfill.'))
    data = {'version': 'g2-synthetic-input-1', 'base_commit': BASE, 'sources': sources, 'scenarios': scenarios,
            'extension_boundary': 'Costs and acquisition prerequisites are research-only sidecars. The source profile has one test and no costs, rankings, or acquisition graph. Multiple fictional quantities/dependencies are controlled extensions, not approved product rules or clinical knowledge.'}
    protocol = {
        'id': 'Watchdog-G2-v1', 'purpose': 'software-demonstration', 'status_at_freeze': 'frozen-before-outcomes', 'base_commit': BASE,
        'question': 'Compare explicit unique dependency coverage and fictional cost without assigning clinical probabilities.',
        'scenario_ids': [s['id'] for s in scenarios], 'seed': None, 'sampling': 'No sampling; complete predetermined fixture battery and integer budget grids.',
        'algorithms': {
            'profile_order': 'Scan tests in saved profile order. Add feasible prerequisite closure if it fits remaining budget and target has any eligible missing dependency, even when already covered by an earlier test. Do not buy standalone no-target prerequisites.',
            'coverage_per_cost': 'Iteratively choose the feasible closure with largest NEW unique dependency count / incremental cost, using exact rational arithmetic. Ties: more gain, lower incremental cost, lexicographic target ID. Stop when no positive gain fits.',
            'oracle': 'Enumerate all subsets. Reject unavailable or prerequisite-incomplete sets. Compute coverage independently by per-dependency predicate scan. For each budget maximize coverage, then minimize cost, then lexicographic IDs. Pareto frontier retains every nondominated cost/coverage pair and all tied sets.'},
        'metrics': ['planned_unique_dependency_coverage', 'fictional_cost_units', 'cost_of_redundant_target_tests', 'oracle_coverage_gap', 'actual_missing_dependencies_retained', 'unresolved_hypothesis_ids_retained'],
        'acceptance_checks': ['Every selected set meets budget and prerequisite availability.', 'Coverage counts each dependency once.', 'All actual missing dependencies and unresolved hypotheses are unchanged after proposal.', 'No candidate repairs a pinned, nonapplicable, nonmeasurement, conflicted or ineligible dependency.', 'Set-union implementation agrees with independent oracle for every feasible subset.', 'Prespecified ratio trap has positive heuristic gap at budget 6.', 'Replay deterministic output bytes identical.'],
        'interpretation': 'Descriptive synthetic algorithm pilot. Heuristic dominance is not presumed; report losses and ties. Counts are not entropy, information gain, independent evidence, urgency, clinical usefulness or treatment recommendations.',
        'scope_exclusions': ['No product changes', 'No scientific or medical approval', 'No measurement or test order', 'No external APIs or patient data', 'No live authorization inferred from a historical archive'],
        'chronology': 'Freeze protocol and inputs with hashes before executing run.py. Fixes to implementation after failed checks are logged; protocol alterations require a new version.'}
    (ROOT / 'inputs.json').write_bytes(encoded(data))
    (ROOT / 'protocol.json').write_bytes(encoded(protocol))
    frozen = {'version': 'g2-freeze-1', 'frozen_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT / 'protocol.json', ROOT / 'inputs.json', ROOT / 'prepare_inputs.py']},
              'note': 'Local chronological freeze, not an independently timestamped preregistration.'}
    (ROOT / 'freeze.json').write_bytes(encoded(frozen))
    print(json.dumps(frozen, indent=2))
if __name__ == '__main__':
    main()
