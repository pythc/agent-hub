# Router context cost and stop validation

Measured on 2026-11-07 with Codex CLI `0.166.0-alpha.6`, Router `gpt-6.1-terra` / medium and four configured Workers `gpt-6.1-sol` / high. The baseline is `a19dfd6`. These are isolated real subscription calls through Roppo, not mocked model responses or a connected Feishu group.

## What caused the overhead

A managed Router activation inherited approximately 21,175 characters of generic Codex base instructions and 41,524 characters of developer context, including personal memory and the global skill catalog. Its serialized native tool catalog added approximately 38,869 characters. The actual Roppo coordinator instructions were only about 4,000 characters. Each provider step paid for that context again, with varying cache reuse.

The managed profile now keeps Roppo's configured instructions, source policy and host tools, while omitting that unrelated personal context. Configuration applies at process startup as well as thread start/resume, because the native code-mode host constructs its tool catalog before the thread starts. Code mode remains enabled: disabling its host broke actual host-tool calls in a diagnostic and was rejected.

The normal API backend is unchanged. No lightweight classifier filters production messages. Semantic admission, scope and stop decisions still belong to the persistent Router; execution belongs to Workers. The 15 pinned DeepSeek domain-core files are unchanged.

## Matched real-call comparison

The same harness and inputs ran against the baseline and optimized implementation: unmentioned chatter, an agreed three-line typo correction, then a final label supplied within the same task. Both passed all assertions, used 7 model activations, kept the same Router/Worker identities during continuation and created one task. The model made 14 versus 15 provider steps, illustrating normal response variation.

| Reported usage | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Input tokens | 382,672 | 138,589 | 63.8% |
| Cached input (included above) | 255,232 | 90,240 | — |
| Uncached input | 127,440 | 48,349 | 62.1% |
| Output tokens | 1,531 | 1,373 | 10.3% |
| Total tokens | **384,203** | **139,962** | **63.6%** |

Reasoning tokens are included in output: 264 before, 253 after. Totals come from native `token_count.info.total_token_usage` deltas per thread/turn, not sums of repeated cumulative snapshots. Token counts are not subscription charges or API billing estimates. One matched pair establishes this result, not a universal percentage.

A smaller two-step idle-routing probe fell from 49,391 to 12,797 tokens (74.1%). An old thread resumed without compaction still used 55,091 incremental tokens; after same-thread native compaction its next equivalent judgment used 13,333. The compression turn itself did not expose separately attributable new usage in this CLI. Its cost is **unknown**, not zero; these figures exclude any unreported compression cost.

Earlier failed diagnostics and an initially over-constrained continuation scenario are retained separately from the matched comparison. They are not counted as successful acceptance or used to inflate savings.

## Natural-language stop

A separate real-call test started `node slow-check.mjs` inside an isolated managed sandbox. The script wrote a start marker and would write a completion marker after 120 seconds. An unmentioned human message asked to stop the specific task.

The first run reproduced a race: the Worker cancelled the command but reported `dropped` before the Router recorded the stop. The final fix lets execution and follow-up delivery remain concurrent, but holds a terminal Worker report until the Router finishes the pending stop classification. It does not infer a stop from keywords or rewrite historical outcomes.

The fixed run verified:

- The script actually started; the running job was cancelled and never produced its completion marker.
- The task ended with `by=human`, `outcome=stopped`, and a recorded Router stop decision.
- The Router kept the same native thread; there was no replacement task or session.
- A later message did not reopen the stopped task or add an assignment.

The final fixed stop scenario used **115,345 reported tokens** across 4 activations, including the later no-resume check. An earlier successful run before the late-arrival refinement used 136,590; both passed. The failed diagnostic used 117,683 across 3 activations and is not a comparable cost baseline. Regression tests also cover the opposite ordering, ordinary follow-ups, a failed Router decision, preserved completed outcomes, compaction failure/interruption and deferred migration for stop classification.

## Auxiliary models: inexpensive is not sufficient

[Jev](https://docs.typesafe.ai/models) is a real TypeSafe discriminative API. Its published `jev-1.14.0` price at evaluation time was $0.042 per million input tokens, with no output-token charge. At an assumed 1,000 input tokens per judgment and 100,000 judgments, that is **$4.20**, excluding Router work, network costs and any other service charges. No TypeSafe credential was configured, so Jev accuracy and latency were **not tested**. Public CPU/self-hosted weights were not established by this review.

A local [Model2Vec](https://github.com/MinishLab/model2vec) prototype used [potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M), revision `73908c3438cf03b6a01bcb9611d62b23d0726f08`, on CPU with one NumPy thread. With weights cached, loading took about 2.10 seconds; warm single-text embedding p50/p95 was 0.030/0.056 ms, and process peak RSS about 2,036 MiB. Download time is excluded from cached load time.

A simple four-class prototype-similarity classifier got **10/20** synthetic cases right. Negation, quotation, conditional stops and changed intent were frequent failures. This measures that small prototype, not the ceiling of the embedding model or a trained classifier. Cosine similarity is not calibrated confidence. An English-only small classifier is also insufficient evidence for this product's Chinese conversations.

Recommendation: keep any future auxiliary model advisory until it passes a representative Chinese/English dataset including quotes, negation, multi-person confirmations and task ownership. Start with shadow evaluation or priority suggestions. Never let similarity alone grant authority, discard a possible stop, silently suppress a message, or replace the Router's contextual judgment. The context optimization above delivers measured savings without adding a model service or changing admission behavior.

## Reproduce and upgrade

After installing project dependencies and authenticating the native CLI:

```sh
node --import tsx examples/router-cost-acceptance.ts .local/cost-before /absolute/path/to/baseline
node --import tsx examples/router-cost-acceptance.ts .local/cost-after
node --import tsx examples/router-cost-acceptance.ts .local/cost-stop . stop
```

Use fresh directories. These commands use the real configured Codex subscription and consume tokens. They create isolated state and synthetic local messages; no external messaging connector is opened. The stop case needs the platform's managed process sandbox (Seatbelt on macOS, bubblewrap on Linux).

Back up the existing deployment and wait for active work to drain before upgrading. Native migration is lazy and stays on the original thread; configuration, browser profiles, credentials and Roppo task history are retained. An additive `native-context` record tracks successful migration. Failed or interrupted compaction leaves it unmarked and does not start the task turn. Do not infer compatibility with every older CLI from this one verified version. A rollback keeps the native history and its compaction summary; restore a state backup only deliberately, since doing so can replay effects performed after that backup.
