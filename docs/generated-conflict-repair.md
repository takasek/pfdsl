# Repair generated conflicts

Run **repair generated conflicts** from the Actions tab on `main`, entering the number of an open PR in this repository whose base is `main`.
Choose `repair` to publish a repair; this mode requires `main` as the workflow branch.
To test workflow changes before merge, select their branch and choose `validate`.
Validation runs the same merge, generation and verification, uploads a repair bundle if changes are needed, and reports the result in the Actions summary.
It never starts the publication job, creates an App token or pushes changes.
Selecting another workflow branch in repair mode stops before checkout and explains how to select main or use validate instead.
The workflow integrates the latest main into that PR and regenerates the outputs owned by `scripts/lib/gen-plugin-outputs.mjs`.
It stops if any conflict requires a canonical source or code decision.
The job log and Actions run summary list the source files requiring manual resolution and explain the next steps.
Merge main into the PR branch locally and resolve the listed source conflicts.
Regenerate generated files with `make gen-plugin`, finish the merge, then commit and push.
Rerun this workflow if generated files still need repair.
The stopped run does not push any changes.
It does not merge the PR into main.

The preparation job runs the PR's merged generators and tests without a publication credential.
It builds the packages, runs `make gen-plugin`, and checks the full tests, lint, typecheck, and generated drift.
A fresh publication job executes only trusted main code, checks that canonical files match Git's automatic merge, and pushes one ordinary merge or repair commit to the existing PR branch.
After pushing, it verifies the branch through Git rather than the PR API, whose head information may lag behind the push.
If that verification fails, the error states that the push already succeeded and asks you to check the branch before rerunning.
If the PR or main changes while preparation runs, publication stops; rerun the workflow.
An already synchronized PR produces no commit.

Publication always uses the shared `takasek-pr-bot` GitHub App so repair pushes automatically trigger downstream PR checks.
Configure repository variable `REPO_AUTOMATION_APP_CLIENT_ID` and secret `REPO_AUTOMATION_APP_PRIVATE_KEY` for an App installed on this repository.
The App needs Contents and Workflows write access, and Pull requests read access to recheck the target PR.
Its credential is used only in the fresh publication job.
An absent or insufficient credential stops publication without switching authentication modes.

The workflow must first be present on the default branch before GitHub accepts a manual dispatch.
The first planned use is PR #1361; local preparation against its exact head can verify the repair before the workflow is integrated, but that is not an Actions execution or publication.
