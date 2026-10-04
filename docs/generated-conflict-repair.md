# Repair generated conflicts

Run **repair generated conflicts** from the Actions tab on `main`, entering the number of an open PR in this repository whose base is `main`.
The workflow integrates the latest main into that PR and regenerates the outputs owned by `scripts/lib/gen-plugin-outputs.mjs`.
It stops if any conflict requires a canonical source or code decision.
It does not merge the PR into main.

The preparation job runs the PR's merged generators and tests without a publication credential.
It builds the packages, runs `make gen-plugin`, and checks the full tests, lint, typecheck, and generated drift.
A fresh publication job executes only trusted main code, checks that canonical files match Git's automatic merge, and pushes one ordinary merge or repair commit to the existing PR branch.
If the PR or main changes while preparation runs, publication stops; rerun the workflow.
An already synchronized PR produces no commit.

The default `github-token` authentication needs Actions to have write access to repository contents.
Pushes using `GITHUB_TOKEN` do not trigger ordinary downstream push or pull-request workflows; the repair workflow runs its own verification before publication.
GitHub may reject a push that updates workflow files with this token; use App authentication for repairs that need workflow-file updates.

To trigger downstream PR checks, select `github-app` and configure repository variable `GENERATED_REPAIR_APP_CLIENT_ID` and secret `GENERATED_REPAIR_APP_PRIVATE_KEY` for an App installed on this repository.
The App needs Contents and Workflows write access, and Pull requests read access to recheck the target PR.
Its credential is used only in the fresh publication job.
An absent or insufficient credential stops publication without switching authentication modes.

The workflow must first be present on the default branch before GitHub accepts a manual dispatch.
The first planned use is PR #1361; local preparation against its exact head can verify the repair before the workflow is integrated, but that is not an Actions execution or publication.
