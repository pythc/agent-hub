"""Compare matched isolated trials; optionally reconcile their owned native rollouts."""
import argparse
import collections
import hashlib
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path, help='Parent of the fresh 01-a through 04-b trial directories')
parser.add_argument('--native-index', type=Path, help='Optional Codex SQLite index; opened read-only')
parser.add_argument('--pair', action='append', help='SCENARIO:BASELINE:OPTIMIZED directory names; repeat for each pair')
args = parser.parse_args()
root = args.root.resolve()
fields = {'inputTokens': 'input_tokens', 'cachedInputTokens': 'cached_input_tokens',
          'cacheWriteInputTokens': 'cache_write_input_tokens', 'outputTokens': 'output_tokens',
          'reasoningOutputTokens': 'reasoning_output_tokens', 'totalTokens': 'total_tokens'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def reconcile(result):
    """Use each owned thread's final cumulative snapshot once, not every cumulative event."""
    ids = {call['threadId'] for call in result['calls'] if call.get('threadId')}
    if not ids:
        raise ValueError('No native thread identities recorded')
    db = sqlite3.connect(args.native_index.resolve().as_uri()+'?mode=ro', uri=True)
    try:
        paths = dict(db.execute('SELECT id,rollout_path FROM threads WHERE id IN ('+
                               ','.join('?' for _ in ids)+')', sorted(ids)))
    finally:
        db.close()
    total = collections.Counter()
    steps = 0
    for path in paths.values():
        last, seen = None, set()
        for line in Path(path).read_text().splitlines():
            record = json.loads(line)
            payload = record.get('payload', {})
            if record.get('type') != 'event_msg' or payload.get('type') != 'token_count' or not payload.get('info'):
                continue
            current = payload['info']['total_token_usage']
            if last and current['total_tokens'] < last['total_tokens']:
                raise ValueError('Native counter reset needs explicit accounting')
            seen.add(digest(current))
            last = current
        if last:
            total.update({field: last.get(native, 0) for field, native in fields.items()})
        steps += len(seen)
    if len(paths) != len(ids) or dict(total) != result['usage']['tokens'] or steps != result['usage']['steps']:
        raise ValueError('Native/ledger reconciliation failed')
    return True


def load(name):
    path = root / name / 'result.json'
    if not path.exists():
        return None
    result = json.loads(path.read_text())
    conditions = json.loads((root / name / 'conditions.json').read_text())
    goals = result['goals']
    return {'name': name, 'ok': result['ok'], 'error': result.get('error'), 'wallMs': result['wallMs'],
            'usage': result['usage'], 'nativeParity': reconcile(result) if args.native_index else None,
            'criteria': goals[0]['criteria'] if goals else [], 'objective': goals[0]['objective'] if goals else None,
            'conditions': conditions, 'repairs': len(result['repairs']),
            'appliedReplans': sum(r['state'] == 'applied' for r in result['replans']),
            'verificationMs': sum(c.get('endedAt', c['startedAt'])-c['startedAt'] for c in result['calls']
                                  if c.get('kind') == 'goal_verification'),
            'fallbackEvidenceCalls': sum(c['tools'].count('goal_evidence') for c in result['calls'])}


results, pairs = {}, []
trials = [tuple(value.split(':')) for value in args.pair] if args.pair else [('clean', '01-a', '01-b'), ('repair', '02-a', '02-b'), ('replan', '03-a', '03-b'), ('clean-repeat', '04-a', '04-b')]
if any(len(p) != 3 or not all(p) for p in trials):
    parser.error('--pair must be SCENARIO:BASELINE:OPTIMIZED')
for scenario, a, b in trials:
    for name in [a, b]:
        value = load(name)
        if value:
            results[name] = value
    if a not in results or b not in results:
        continue
    before, after = results[a], results[b]
    for key in ['scenario', 'contract', 'config', 'fixtureHashes', 'harnessSha256', 'runtime', 'measurementVersion']:
        if digest(before['conditions'].get(key)) != digest(after['conditions'].get(key)):
            raise ValueError(f'{scenario}: conditions differ at {key}')
    if before['criteria'] != after['criteria'] or before['objective'] != after['objective']:
        raise ValueError(f'{scenario}: acceptance criteria or objective changed')
    accepted = before['ok'] and after['ok']
    bt, at = before['usage']['tokens'], after['usage']['tokens']
    pairs.append({'scenario': scenario, 'baseline': a, 'optimized': b,
                  'beforeTokens': bt['totalTokens'], 'afterTokens': at['totalTokens'],
                  'tokenReduction': 1-at['totalTokens']/bt['totalTokens'] if accepted else None,
                  'beforeUncachedInput': bt['inputTokens']-bt['cachedInputTokens'],
                  'afterUncachedInput': at['inputTokens']-at['cachedInputTokens'],
                  'beforeMs': before['wallMs'], 'afterMs': after['wallMs'],
                  'timeReduction': 1-after['wallMs']/before['wallMs'] if accepted else None,
                  'beforeSteps': before['usage']['steps'], 'afterSteps': after['usage']['steps'],
                  'beforeFallbackReads': before['fallbackEvidenceCalls'], 'afterFallbackReads': after['fallbackEvidenceCalls'],
                  'beforeVerificationMs': before['verificationMs'], 'afterVerificationMs': after['verificationMs'],
                  'sameConditions': True, 'bothAccepted': accepted,
                  'baselineAccepted': before['ok'], 'optimizedAccepted': after['ok'],
                  'baselineError': before['error'], 'optimizedError': after['error'],
                  'nativeParity': True if before['nativeParity'] and after['nativeParity'] else None})

output = {'complete': len(pairs) == len(trials), 'runs': results, 'pairs': pairs}
accepted_pairs = [p for p in pairs if p['bothAccepted']]
if accepted_pairs:
    before = sum(p['beforeTokens'] for p in accepted_pairs)
    after = sum(p['afterTokens'] for p in accepted_pairs)
    before_ms = sum(p['beforeMs'] for p in accepted_pairs)
    after_ms = sum(p['afterMs'] for p in accepted_pairs)
    output['matchedAcceptedAggregate'] = {
        'pairs': len(accepted_pairs), 'beforeTokens': before, 'afterTokens': after,
        'tokenReduction': 1-after/before, 'beforeMs': before_ms, 'afterMs': after_ms,
        'timeReduction': 1-after_ms/before_ms,
        'beforeUncachedInput': sum(p['beforeUncachedInput'] for p in accepted_pairs),
        'afterUncachedInput': sum(p['afterUncachedInput'] for p in accepted_pairs)}
output['allExperimentReportedTokens'] = sum(r['usage']['tokens']['totalTokens'] for r in results.values())
(root / 'comparison.json').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({key: value for key, value in output.items() if key != 'runs'}, ensure_ascii=False, indent=2))
