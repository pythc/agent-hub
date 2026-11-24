# O43: Recorded resource accounting and hard limits

The existing operator-only Workspace usage panel has an additive breakdown.
The route uses the same current-operator and workspace transport checks.
Shared views and agents do not receive these breakdowns. The projection does
not expose ticket/source IDs, prompts, tool names, parameters, or results.

- Task-linked and unlinked model call counts come from the local durable
  model-usage ledger. Totals represent only reported numeric token counters;
  missing totals display as not recorded. The separate background observer
  is included in the existing host total, not this new breakdown.
- Model breakdowns describe the selected backend/model only for calls with
  one recorded attempt and both labels. Multi-attempt and legacy paths are
  unattributed. Display is bounded to 20 selected groups, plus overflow and
  unattributed buckets. Identity is not provider invoice evidence.
- Tool counts are states of retained execution calls, not lifetime usage or
  expense. Polling shows only the latest valid source health records for
  currently enabled polling adapters; it has no attempt counts, price or
  limits of its own. Started and failed traffic are not inferred as success.
- The last recognized saved context receipt shows measured protocol bytes,
  reserved bytes, and the configured hard limit separately. A reservation in
  that receipt is not a live quota reservation or token estimate. Existing
  work limits and admission/hold behavior do not change.
- Estimates and invoices remain unavailable because this path has no price
  or billing evidence. It starts no background work and requests no quotes.
  A future polling limit needs actual polling-call instrumentation and a
  separately designed budget policy; this panel does not claim to enforce it.
