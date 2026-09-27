# Render PFD files as sibling SVGs

The [render pfdsl svg workflow](../.github/workflows/render-pfdsl-svg.yml) runs automatically for changes to `.pfdsl/**/*.pfdsl` on this repository's `main` branch.
Other repositories can call the same workflow after installing a GitHub App with repository Contents read and write access.
PR mode also requires Pull requests read and write access.
Direct push mode requires that App to bypass the pull request requirement on the target branch.
Keep the App installation limited to the repositories that need this workflow.

Store the App's private key in each caller repository as an Actions secret, and pass its client ID as an input.
For this repository's built-in push trigger, use the `PFDSL_SVG_APP_PRIVATE_KEY` secret and `PFDSL_SVG_APP_CLIENT_ID` variable.

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
      app-client-id: ${{ vars.PFDSL_SVG_APP_CLIENT_ID }}
      mode: pr
      target-branch: main
      paths: |
        .pfdsl/**/*.pfdsl
        docs/process/**/*.pfdsl
    secrets:
      app-private-key: ${{ secrets.PFDSL_SVG_APP_PRIVATE_KEY }}
```

Pin the `uses` reference to a reviewed commit or release tag for stable behavior.
The reusable workflow checks out the caller's target branch, builds the renderer from `takasek/pfdsl`, renders the selected `.pfdsl` files, and commits only changed sibling SVG files.
Its optional `cli-ref` input selects a different renderer revision; it defaults to `main`.
The `mode` input accepts `pr` or `direct` and defaults to `direct`.
PR mode creates or updates a branch named `pfdsl-svg/<target-branch>` and opens a PR for human review.
Direct mode pushes the generated commit to the target branch without creating a PR.
The App token is created after rendering and is used only for the generated commit and PR.
The SVG commit does not trigger the sample caller because its push path filter includes only `.pfdsl` files.
