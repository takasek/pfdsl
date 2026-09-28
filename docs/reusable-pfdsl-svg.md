# Render PFD files as sibling SVGs

The [render pfdsl svg workflow](../.github/workflows/render-pfdsl-svg.yml) runs automatically for changes to `.pfdsl/**/*.pfdsl` on this repository's `main` branch.
After this workflow reaches the default branch, use **Actions → render pfdsl svg → Run workflow** to regenerate every tracked PFD file matching `paths`, including files whose PFD content has not changed.
Select the branch containing the workflow in the Run workflow selector, then set `target-branch` to the branch containing the PFD files.
Use `cli-ref` with a full commit SHA in PR mode to preview a specific renderer revision after a CLI update; direct mode uses the commit that defines this workflow.
The manual run publishes only SVG files whose rendered content differs from the existing file, so an unchanged run creates no commit or PR.
Other repositories can call the same workflow after installing a GitHub App with repository Contents read and write access.
PR mode also requires Pull requests read and write access.
Direct push mode requires that App to bypass the pull request requirement on the target branch.
Keep the App installation limited to the repositories that need this workflow.

Store the App's private key in each caller repository as an Actions secret, and pass its client ID as an input.
For this repository's built-in push trigger, use the `PFD_GENERATOR_APP_PRIVATE_KEY` secret and `PFD_GENERATOR_APP_CLIENT_ID` variable.

For another repository, add a caller workflow such as the following.
The caller's `branches` and `paths` filters control when the workflow starts; the `target-branch` and `paths` inputs control which branch and PFD files it processes.

```yaml
name: render pfdsl svg
on:
  push:
    branches: [main]
    paths:
      - '.pfdsl/**/*.pfdsl'
      - 'docs/process/**/*.pfdsl'

permissions:
  contents: read

jobs:
  render:
    uses: takasek/pfdsl/.github/workflows/render-pfdsl-svg.yml@main
    with:
      app-client-id: ${{ vars.PFD_GENERATOR_APP_CLIENT_ID }}
      mode: pr
      target-branch: main
      paths: |
        .pfdsl/**/*.pfdsl
        docs/process/**/*.pfdsl
    secrets:
      app-private-key: ${{ secrets.PFD_GENERATOR_APP_PRIVATE_KEY }}
```

Pin the `uses` reference to a reviewed commit or release tag for stable behavior.
The reusable workflow checks out the caller's target branch, builds the renderer from `takasek/pfdsl` at the workflow commit by default, renders the selected `.pfdsl` files, and commits only changed sibling SVG files.
Rendering and publishing run in separate jobs; only changed SVG files cross between them as an artifact.
When every rendered SVG is identical to its existing file, it skips App authentication, commit, and PR creation.
Its optional `cli-ref` input selects a different renderer commit SHA in PR mode only.
The `mode` input accepts `pr` or `direct` and defaults to `direct`.
PR mode creates or updates a branch named `pfdsl-svg/<target-branch>` and opens a PR for human review.
Direct mode pushes the generated commit to the target branch without creating a PR.
The App token is created in the publish job, which does not build or run the renderer.
Direct mode retries a rejected push if the selected PFD files have not changed; if they have changed, the workflow fails so they can be rendered again.
The SVG commit does not trigger the sample caller because its push path filter includes only `.pfdsl` files.
