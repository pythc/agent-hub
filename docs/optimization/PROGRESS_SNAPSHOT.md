# O34: Evidence snapshot on an existing task

The operator task detail reads a small conditional snapshot from the existing
execution trace API. Authorization, history cleanup and current task access
are checked again even for an unchanged revision. The cursor is an actual
per-task trace position, not a percentage and not a replacement for timeline
pagination. A content digest is separate: when the visible evidence does not
change, the response is an unchanged marker and the card keeps its prior
observation time. Same-state receipt changes can still update the snapshot
when visible facts change. There is no reminder, webhook or outgoing message.

Each row reports a different fact: result preserved, recorded commit, remote
push, integration test, deployment or verification record. Later SHA values
do not inherit an older push or passing test. A local start/check is not a
deployment. Passing verification is not inferred from a result or a commit;
the displayed record ties to the persisted verification round, input
revisions, source receipts and, for final project acceptance, operator review.
This is an evidence view, not a fresh rerun or a declaration of overall
completion. A record without a producer-supplied date is undated rather than
given the polling time. No verified deployment producer is wired here.

The link list is limited to retained, permission-checked immutable file
versions referenced by the task's selected verification snapshot. It links
to the existing private file-version page, which checks access again. It
does not invent external links, expose logs or publish files. Code-only
tasks and tasks without readable retained file versions can have no links.
