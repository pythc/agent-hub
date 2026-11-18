# Scheduled work: plan, trigger, execution and notification (O21)

The existing authenticated Proactive Router surface now presents four distinct
layers. The new read model is additive; old stored runs remain readable. The
fixed scheduling behavior is exposed, not replaced by a new scheduler or a new
permission path.

## What the observations mean

- **Plan:** its current revision, enabled/paused/expired/due state and next due
  instant. Paused plans expose no next due instant in this projection. An expired
  plan has no future occurrence; it does not say its last run completed.
- **Trigger:** scheduled versus explicitly manual, selected due instant, the
  time its durable run record was created, and the first due instant considered
  by this tick. `firstDueAt < scheduledAt` means an offline backlog was coalesced.
  No guessed count of missed occurrences is presented. Legacy trigger kind and
  first-due observations are unknown if they were not recorded.
- **Execution:** the existing queued/running/waiting/terminal state, plus actual
  queue-admission and first authorized Router-dispatch timestamps. `startedAt`
  is the start of host coordination, not proof a Worker model began, finished or
  achieved its objective. It is written only after the existing authority and
  queued-plan revision checks, and is not reset by repeated ticks/restarts.
  Skipped launches have no queue/start time. Existing finish times remain their
  original observations. Missing legacy times remain null, not synthesized from
  due/created times.
- **Notification:** current external outbox messages whose retained owner inputs
  refer to this run. Internal Router inbox reports are excluded. Unknown outcomes
  take precedence over sent/pending peers; pending/sending/held/dropped/failed
  remain distinct. `sent` means the host's send result, not recipient readback.
  Every projection explicitly says recipient readback was not observed. No
  external query or resend is performed by this page. Execution completion does
  not imply notification success.

The management page keeps the existing table/actions and uses native details for
recorded times and policies. Legacy aggregate `failed` cannot distinguish older
uncertain/held/dropped states, so it is displayed as requiring inspection. A
failed refresh keeps the last observation and reports failure; a late response
from another scope or an older refresh cannot replace the current page.

## Explicit misfire and cancellation policy

The supported policy remains **coalesce_latest**: an offline backlog becomes one
latest due occurrence, never an unbounded replay burst. If an earlier occurrence
still owns unsettled work, the new occurrence is recorded as skipped. Manual
runs reuse the existing operation-ID receipt and the same overlap guard without
consuming the future scheduled occurrence. The durable occurrence, admission/job
and advance of the plan remain in the existing atomic transaction.

Calendar gaps have no occurrence; DST folds execute once at the earlier instant.
Pausing prevents future/queued dispatch under its original revision fence but
neither aborts an already authorized running occurrence nor withdraws its
result. Cancelling one occurrence preserves the recurring plan. A cancel can
stop still-pending notification work; it cannot undo an external send already
in progress. No new policy selector, unlimited catch-up, authority grant or
cross-environment scheduler is introduced.

## Verification and compatibility

Automated Runtime fixtures cover ten accumulated interval occurrences, one
coalesced durable run, repeated ticks, restart and stable queue/start observations,
manual runs, skipped overlaps, queued revision withdrawal, and independent
unknown notification status. Existing production-path tests cover pausing during
a running occurrence, single-run cancellation, retained recurring plans, DST
calendar behavior and notification authority. Pure projections cover legacy and
invalid metadata, mixed delivery states, including unknown future status values.
Page tests cover normal/legacy state, interrupted and repeated operations,
failed/late refresh, changed scope and timestamp rendering.

No actual browser visual, narrow-screen, keyboard or reduced-motion interaction,
real model/provider or external IM/ACP receipt is claimed. The page keeps its
existing responsive table container and native details without new animation.
The additive fields have no new database format barrier and are observations,
not executable restoration instructions. Rollback can ignore them without
replaying work; existing scheduler/outbox authority remains unchanged.
