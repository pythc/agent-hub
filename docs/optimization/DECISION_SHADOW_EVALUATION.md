# Offline decision shadow evaluation (O46)

This comparator consumes two sets of **synthetic observations**. It has no
provider configuration, credentials, workspace/store access, Router session,
or executor. It does not invoke a model, emit an external message, apply a
recommendation, or change the workspace mode. With the live setting off, the
existing Router still skips auxiliary calls; in live shadow mode existing
auxiliary labels are recorded, not fed back into routing. This command does
not collect or infer production data from either mode.

From the repository root, with the project's dependencies installed:

```sh
node --import tsx/esm src/decision-eval-cli.ts examples/decision-shadow-v1.json
```

The included v1 data set uses nine invented cases: ordinary noise, existing
task follow-up, a complex request needing original evidence, an explicit
complex request, a quotation of a stop instruction, ambiguity about ownership,
authority revoked since classification, stale context, and an explicit stop.
Policy revisions and metric values in the file are **placeholders and fabricated
numbers**, not benchmarks or actual observations of any provider. Wrong and
unavailable auxiliary answers are included deliberately: the fixture's host
route, gate and effect stay independent of them.

To compare a new synthetic candidate, copy the example shape into a regular
local JSON file. For each labeled case, independently record one host
observation with auxiliary decisions off and one with auxiliary decisions
shadowed, using exactly the same host policy revision and case ID. Replace
the placeholder revisions with the immutable revisions of your synthetic host
and auxiliary policy harness. Store the file separately from any working
workspace. Do not copy messages, prompts, identities, provider payloads or
production logs into this format. The schema only accepts enums, bounded
integer fixture IDs and metrics, version labels, and revision pins; it rejects
unknown fields and never serializes malformed input into output.

- Each case labels the intended route and independently expected host gate
  and effect. Off and shadow do not share an auxiliary answer. Use
  `unavailable`, `stale` or `skipped` without a label when applicable.
- The report identifies the data set version and canonical digest, both
  policy identities, host misroutes against fixture truth, auxiliary
  misroutes against the same truth (with its separate labeled denominator),
  and drift in host route, gate or effect. A denied action with any effect,
  or either observation diverging from the expected gate/effect, also fails
  the observational invariant even if both modes made the same error.
- Overall and category summaries also show paired host accuracy: both correct,
  only off correct, only shadow correct, or neither correct. Opposite changes
  can cancel out in aggregate misroute totals; neither correctness nor equal
  totals relax the existing host drift and fence checks. Auxiliary coverage is
  split into labeled, unavailable, stale and skipped observations.
- Use same-boundary per-case wall-clock router latency (ms), auxiliary latency
  (ms, off may be observed zero), rework turns, and total modeled cost in USD
  millionths. Use explicit `null` if evidence for a metric isn't known
  (including its price); zero means known zero. Only matching non-null pairs
  contribute to each mean and difference, and sample counts are always
  shown. Compare results within the same dataset digest and host revision;
  do not interpret the fabricated example as an actual cost or latency claim.
- Exit status 0 means no observed host drift or fence failure on the supplied
  synthetic data; it does not mean the auxiliary model is accurate or the
  host has been validated. Status 1 prints the report with drift or fence
  failure; status 2 rejects malformed input or non-paired coverage.

For validation, run the example and then change only a denied/shadow observation
to show an effect. Confirm that unsafe fixture fails without executing the
effect. Compare a case with one missing cost to a known zero: only the latter
is a measurement. No approval, autonomous escalation, live provider rate
or production safety assurance follows from a synthetic report.
