# Resolving references from a pinned model

`baseRef` selects the default artifact source and revision; an artifact's `ref` replaces that pair in full.
Process locations and command working directories use the model's own reference basis.
`extends` and `subflow` are relative to the model's logical file position, independently of `basePath` and artifact references.

The CLI accepts `--reference-context <file>` on `check`, `render`, `meta get`, `meta list`, `meta check-links`, and `graph describe`.
The JSON file describes snapshots that an acquisition adapter has already obtained and pinned:

```json
{
  "adapter": "example:git-snapshot-v1",
  "model": {
    "source": "project-wiki",
    "fixedRevision": "W",
    "documentId": "roadmap.pfdsl",
    "extractionId": "whole-file"
  },
  "logicalPath": ".pfdsl/roadmap.pfdsl",
  "basis": {
    "source": "project",
    "fixedRevision": "C0",
    "root": "/snapshots/project-C0"
  },
  "targets": [
    {
      "source": "project",
      "revision": "main",
      "fixedRevision": "C1",
      "root": "/snapshots/project-C1"
    },
    {
      "source": "project",
      "revision": "develop",
      "fixedRevision": "C2",
      "root": "/snapshots/project-C2"
    }
  ]
}
```

`W`, `C0`, `C1`, and `C2` above stand for immutable revision identifiers recorded by the adapter, such as complete Git commit hashes.
The CLI validates the context's structure and resolution boundaries; it does not independently prove that a directory contains the claimed revision.
The adapter is responsible for that correspondence and for keeping the snapshot unchanged throughout verification.
Source and revision selector strings match exactly; the CLI does not fetch resources, resolve branches, or use a local file as a substitute for a missing target.
The original model identity remains separate from its extraction path and from all artifact targets.

For this model, the input uses C1, the output uses C2, and the process uses C0:

```yaml
---
type: roadmap
basePath: ..
baseRef: { source: project, revision: main }
artifact:
  input: { status: done, location: docs/plan.md }
  output:
    status: todo
    location: docs/plan.md
    ref: { source: project, revision: develop }
process:
  review: { location: scripts/review.mjs, command: review }
---
input >> review -> output
```

```sh
pfdsl check extracted.pfdsl --reference-context context.json --json
pfdsl meta get extracted.pfdsl input,output,review --reference-context context.json --json
pfdsl meta check-links extracted.pfdsl --reference-context context.json --json
```

`check` and `render` perform static analysis and report reference resolution as not checked when explicit references or an external context are present.
`meta get` and `graph describe` return raw `location` values alongside their resolved paths; they fail when a requested derived path cannot be resolved or inspected within its selected snapshot.
`meta check-links --json` records the model origin, logical path, target bindings, selected fixed revisions, and each location's result.
URL and glob results are explicitly skipped and do not establish artifact existence or satisfy its acceptance criteria.
Artifacts without locations can establish target identity, but that does not establish completion.

Without a context or explicit reference declarations, ordinary local file resolution retains its existing behavior.
With explicit references, absent context, unknown sources or revision selectors, missing model positions, missing paths, and collection escapes are failures.
Symbolic-link targets and existing glob directory prefixes must stay within the selected snapshot.

The repository's experimental Wiki adapter acquires raw Git blobs from explicitly supplied local source checkouts and pins selectors once for a verification run.
It does not fetch those checkouts or adopt the Wiki as authoritative merely because reference checks succeed.
See [Wiki roadmap integration](wiki-roadmap-spike.md) for adoption and cutover requirements.
