# O48b: Skill overlay impact preview

The saved-skill preview shows exact-version relationships within the selected
project entry. A base version lists overlays pinned to that version and overlays
pinned to older versions in the same method family. For older pins it compares
only the saved overrides against the selected base, showing conflicting fields
or saying no text conflict was found. A compatible text patch is not approval,
validation, or a completed migration. Retired versions are history only.
Results show at most 50 matching versions, with the full match count.

An overlay preview shows the recorded base version and whether its stored base
digest still matches. Missing or mismatched history is explicit. Opening the
preview does not install anything, change configuration, restart a worker,
enable an overlay, or change any already running task. The existing authorized
upgrade flow remains the only way to save a new candidate.
