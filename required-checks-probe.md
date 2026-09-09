# Required checks verification

Temporary verification artifact for issue #1060.
This branch is used only to observe GitHub branch protection and is not intended for merging.

1. Confirm that a documentation-only change reports both required checks.
2. Change a canonical source without regenerating its output and confirm that merging is blocked.
3. Regenerate the output and confirm that the required checks pass and the block is cleared.
