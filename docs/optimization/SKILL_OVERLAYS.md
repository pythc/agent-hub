# O31: Fixed skill overlays

A scope manager may customize an active saved method. An overlay is a new
immutable saved-skill version with its own reference, exact base reference and
digest, expected old field values, edits, and a resolved version digest. This
first slice permits only title, objective and step instruction overrides; Workers,
connections, criteria and parameters are inherited, not granted by the overlay.

A base edit or upgrade never changes a saved overlay automatically. An operator
may explicitly upgrade to a newer version of the same base method. All customized
fields must still equal their recorded old values on the new base, including
the existence of customized step IDs. A conflict returns a list and creates
nothing. Review both versions and deliberately create a new overlay on the new
base when the change cannot be carried over unambiguously. Old references stay
pinned and keep their own history.

Overlay lifecycle: candidate → statically validated → enabled → review required
→ statically validated again. A changed scope/entry revision or configured Worker
and selected-connection state also requires re-review. Retirement is terminal
for that exact version and prevents new executions; inspecting its historical
method does not re-enable it or stop already-running work. Static validation
checks declared graph, parameters and Worker access, not provider availability,
completed runs or implicit actions stated in prose. A scope manager must enable
each overlay explicitly after validating it.

Overlay versions are manual-only in this slice, with the same exact human
request, quote, context and execution permission checks as a saved method.
Review does not grant tools or approve external effects. Existing saved versions,
legacy trial behavior, schedules and event bindings are unchanged; overlay
automation and broader compatibility/impact analysis are intentionally separate.
