"""Read-only stage, native response-gap and cold-input analysis of isolated trials."""
import argparse
import collections
import datetime
import hashlib
import json
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
parser.add_argument('--native-index', type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
db = sqlite3.connect(args.native_index.resolve().as_uri()+'?mode=ro', uri=True)


def milliseconds(timestamp):
    return datetime.datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()*1000


def native_calls(call):
    row = db.execute('SELECT rollout_path FROM threads WHERE id=?', (call['threadId'],)).fetchone()
    if not row:
        raise ValueError('Owned native thread missing')
    result, responses, pending, tools, seen = [], [], {}, [], set()
    for line in Path(row[0]).read_text().splitlines():
        event = json.loads(line)
        at, payload = milliseconds(event['timestamp']), event.get('payload', {})
        if not call['startedAt'] <= at <= call['endedAt']:
            continue
        if event['type'] == 'token_usage_record':
            key = payload['response_id']
            if key not in seen:
                seen.add(key)
                usage = payload['usage']
                result.append({'at': at, **{k: usage.get(k, 0) for k in
                    ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']}})
        elif event['type'] == 'response_item':
            kind = payload.get('type', '')
            if kind in ['custom_tool_call', 'function_call', 'reasoning'] or kind == 'message' and payload.get('role') == 'assistant':
                responses.append((at, kind))
            if kind in ['custom_tool_call', 'function_call']:
                pending[payload['call_id']] = at
            elif kind in ['custom_tool_call_output', 'function_call_output']:
                responses.append((at, kind))
                begin = pending.pop(payload['call_id'], None)
                if begin is not None:
                    tools.append(at-begin)
    gaps = [{'ms': b[0]-a[0], 'after': a[1], 'before': b[1]}
            for a, b in zip(responses, responses[1:]) if b[0]-a[0] >= 1000]
    return {'steps': result, 'toolRoundTripMs': tools,
            'largestResponseGaps': sorted(gaps, key=lambda x: x['ms'], reverse=True)[:3]}


runs = {}
try:
    for path in sorted(root.glob('??-?/result.json')):
        result = json.loads(path.read_text())
        counts, calls = collections.Counter(), []
        native_total = 0
        for index, call in enumerate(result['calls']):
            base = call.get('kind') or 'worker:'+str(call.get('workerId'))
            counts[base] += 1
            native = native_calls(call)
            steps = native['steps']
            native_total += sum(s['total_tokens'] for s in steps)
            calls.append({'index': index, 'stage': base+':'+str(counts[base]),
                          'startMs': call['startedAt']-result['startedAt'],
                          'wallMs': call['endedAt']-call['startedAt'],
                          'inputBytes': call['inputBytes'], 'hostTools': len(call['tools']),
                          'inputTokens': sum(s['input_tokens'] for s in steps),
                          'cachedInputTokens': sum(s['cached_input_tokens'] for s in steps),
                          'uncachedInputTokens': sum(s['input_tokens']-s['cached_input_tokens'] for s in steps),
                          'firstStepUncachedInput': steps[0]['input_tokens']-steps[0]['cached_input_tokens'] if steps else None,
                          'firstStepMs': steps[0]['at']-call['startedAt'] if steps else None,
                          'hostToolMs': sum(t['endedAt']-t['startedAt'] for t in call.get('toolTimings', [])) if 'toolTimings' in call else None,
                          'native': native})
        if native_total != result['usage']['tokens']['totalTokens']:
            raise ValueError(path.parent.name+': native provider-step attribution differs from ledger')
        runs[path.parent.name] = {'ok': result['ok'], 'wallMs': result['wallMs'], 'calls': calls, 'nativeParity': True}
finally:
    db.close()

comparison = json.loads((root/'comparison.json').read_text())
by_role = {}
for side in ['baseline', 'optimized']:
    totals = collections.defaultdict(collections.Counter)
    for pair in comparison['pairs']:
        if not pair['bothAccepted']:
            continue
        result = json.loads((root/pair[side]/'result.json').read_text())
        for group in result['usage']['groups']:
            usage = group['tokens']
            totals[group['purpose']].update(input=usage['inputTokens'], cached=usage['cachedInputTokens'],
                uncached=usage['inputTokens']-usage['cachedInputTokens'], output=usage['outputTokens'])
    by_role[side] = {key: dict(value) for key, value in totals.items()}

output = {'method': 'Owned native provider-step records within each host call; exact total reconciled. Response gaps do not distinguish provider queue, transport, reasoning or retries. Overlapping call durations are not added as end-to-end time.',
          'runs': runs, 'matchedAcceptedPurposeTokens': by_role}
(root/'performance-profile.json').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'runs': len(runs), 'nativeParity': all(r['nativeParity'] for r in runs.values()), 'matchedAcceptedPurposeTokens': by_role}, ensure_ascii=False, indent=2))
