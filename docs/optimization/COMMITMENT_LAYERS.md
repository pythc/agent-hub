# Reminders, commitments and goals

The Router's existing scoped scheduler and Goal runtime are still the only
execution authorities. The proactive-state response adds a `commitments`
read model: single-time schedules, standing schedules and existing Goals.
Plan rows carry the original owner and scope; the equivalent Goal fields are
unchanged. A visibility check resolves the live scope, entry and original
discussion. Private entries are not exposed on the operator page. Scoped
Router plans are filtered to the same original person and discussion.

The proactive page offers a one-time reminder with text, time and existing
authorized origin. In the original conversation, the alternative is
`/remind <ISO time with offset> <IANA zone> <text>`. The hosts send just the
stored reminder text with normal pre-send authority and quiet-hours handling,
without calling the Router model for this occurrence. Ordinary messages
never call this new action without matching the explicit command. Existing
generic schedules keep their prior behavior.

For a promotion, obtain the immutable ID from the page, then enter
`/promote-reminder <id>` alone on the first line of a human message in the
original conversation. Supply the objective and completion criteria on later
lines. The Router uses the real plan revision and the full authorizing message.
Promotion can cover a standalone schedule with no hard end time. A continuation,
a saved-skill plan, a hard-ended plan or one with unsettled execution/delivery
cannot be promoted in place. The resulting Goal is subject to the usual Goal
scope and worker controls. The schedule retires atomically with the new Goal,
and an exact replay returns the original Goal receipt. There is no reverse
promotion or implicit reactivation after Goal cancellation. Cancel an
unpromoted reminder in the page; cancel a promoted Goal in its original
conversation. Delivery already underway or completed cannot be recalled.

The generic plan/Goal completion conditions still apply. The shared stop
condition describes explicit cancellation or withdrawal of the author's
authority; one-time scheduling also naturally consumes its occurrence.
Databases using the new persisted layers reject older binaries that would
misinterpret their control state. Existing rows and APIs are not migrated.

For lightweight daily follow-through, choose **每天，直到手动停止** in the
same form and enter a local clock time. The start timestamp is an earliest
eligible instant; the time is evaluated in the selected IANA zone (gaps
skip, folds run once). In the original conversation the equivalent is
`/commit-daily <ISO start with offset> <IANA zone> <HH:mm local> <text>`.
The operation uses the exact current human instruction and fixed text.
It does not create a Worker, Goal, or model turn. An exact replay does not
create a second plan, even with a new operation ID in the same conversation
message. No future occurrence changes the original owner or destination.

The original conversation can explicitly use `/pause-commitment <id>`,
`/resume-commitment <id>`, or `/cancel-commitment <id>` (URL-encoded ID).
The management page also offers controls for its authorized non-private
entries. Pausing withdraws queued notices, and resuming takes the next
strictly future local occurrence, without replaying missed notices.
A prior unsettled delivery suppresses another occurrence; an in-flight
or uncertain delivery cannot be recalled or silently replayed. Offline
catch-up with no earlier unsettled delivery follows the existing
latest-occurrence rule. Promotion uses the existing original-conversation
command and requires any outstanding delivery to be settled; it
atomically retires the daily plan. This path does not add a condition
watch or query external systems.

Creating the first daily commitment raises the database compatibility
floor to 23 so a prior binary cannot dispatch these new plans without
their lifecycle and overlap safeguards. The existing tables are unchanged.
