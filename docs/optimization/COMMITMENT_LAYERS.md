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
