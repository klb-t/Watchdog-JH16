#!/usr/bin/env python3
"""Turn a stored YRBSS (data.cdc.gov svam-8dhg) state response into a WatchDog reference set.

Deterministic: entity keys are ISO 3166-2 codes ("US-" + USPS code) derived from the
state FIPS code in `locationid` (the dataset's own abbreviation can differ, e.g. AZB),
values are `greater_risk_data_value` unchanged. Nothing is rounded or imputed.

  python3 scripts/reference_from_yrbss.py RAW.json --set-key K --version V --question Q --url URL --retrieved-at T > out.json
"""
import argparse, hashlib, json, sys

FIPS_USPS = {'01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
  '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN',
  '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY'}

def main():
    p = argparse.ArgumentParser()
    for a in ('raw', '--set-key', '--version', '--question', '--url', '--retrieved-at'): p.add_argument(a, required=a != 'raw') if a != 'raw' else p.add_argument(a)
    args = p.parse_args()
    raw = open(args.raw, 'rb').read(); rows = json.loads(raw)
    scores = {}
    for r in rows:
        if r['shortquestiontext'] != args.question or (r['sex'], r['race'], r['grade']) != ('Total', 'Total', 'Total'):
            sys.exit(f'unexpected row {r["locationabbr"]}: {r["shortquestiontext"]} {r["sex"]} {r["race"]} {r["grade"]}')
        key = 'US-' + FIPS_USPS[r['locationid']]
        if key in scores: sys.exit(f'duplicate state {key}')
        scores[key] = float(r['greater_risk_data_value'])
    out = {'schema_version': '1.0', 'set_key': args.set_key, 'version': args.version, 'evidence_tier': 'OFFICIAL_STATISTIC', 'unit': 'percent',
           'source': {'publisher': 'CDC, Youth Risk Behavior Surveillance System', 'dataset': 'data.cdc.gov svam-8dhg', 'url': args.url,
                      'retrieved_at': args.retrieved_at, 'raw_sha256': hashlib.sha256(raw).hexdigest(), 'question': args.question,
                      'stratification': 'State, Total sex/race/grade', 'value_field': 'greater_risk_data_value'},
           '_transformation': 'scripts/reference_from_yrbss.py: entity = US-<USPS from FIPS locationid>; values unchanged',
           'scores': dict(sorted(scores.items()))}
    json.dump(out, sys.stdout, indent=1); sys.stdout.write('\n')

if __name__ == '__main__':
    main()
