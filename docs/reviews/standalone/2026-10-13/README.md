# Standalone design review: Astra 6 and Sol 6.1

These are archival copies of two independent evaluations and the parent chat's comparison, prepared for maintainers on 2026-10-13 (Japan time).
The reports distinguish native observations, measurements in the shared web frontend, source inspection, shitae models, and unimplemented proposals.
No product code was changed by this archive operation.

## Evaluated revisions

| Repository | Final evaluated revision |
| --- | --- |
| PFDSL | [83701fb03e7846fe9582a3ae3b685d624f681902](https://github.com/takasek/pfdsl/tree/83701fb03e7846fe9582a3ae3b685d624f681902) |
| shitae | [a3ebaedbd5d452c99093a949bbaf94508da43ab4](https://github.com/takasek/shitae/tree/a3ebaedbd5d452c99093a949bbaf94508da43ab4) |

The archive branch was created from PFDSL's fetched `origin/main`, which pointed to the final evaluated PFDSL revision at creation.
The commit containing these documents is an archive revision, not another evaluated product revision.
The reports also mention the earlier PFDSL revision `266cbb3196de6d274353b9d6ce91befb424e45f2`; observations were rechecked against the final target as described in each report.

## Reports and their relationship

| Record | Author | Role |
| --- | --- | --- |
| [Design analysis](astra/review.html) | Astra 6 | Primary analysis, with its own priorities, native operations, measurements, and limits |
| [Design analysis](sol/review.md) | Sol 6.1 | Primary analysis, with its own priorities and acceptance conditions |
| [Validation record](sol/validation.md) | Sol 6.1 | Evaluation environment, performed checks, observations, and remaining acceptance work |
| [Comparison](comparison.html) | Parent chat | Compares the two reports; preserves differences in coverage and priority |
| [Source provenance](provenance.json) | Archive preparation | Original source hashes and final evaluated revisions |

The HTML reports are static documents with no scripts.
View their source on GitHub or open the files in a browser from a checkout.
The comparison is not an independent third product evaluation or a general ranking of the models.
Each model was run once; native debug/release builds, browser sizes, operations, and modeling choices differed.

## Evidence included here

| Evidence | What it supports | Limits |
| --- | --- | --- |
| [Astra environment manifest](astra/evidence/manifest.json) | Evaluated revisions, OS, build configuration, original native debug executable hash | The executable itself and private checkout paths are omitted |
| [Astra full File menu](astra/evidence/23-native-file-menu-full.txt) | Observed native File menu contents | Text capture, not complete keyboard or menu acceptance |
| [Astra initial File menu capture](astra/evidence/02-native-file-menu.txt), [View menu capture](astra/evidence/03-native-view-menu.txt) | Notices that the accessibility tree did not change | These captures do not contain menu contents |
| [Astra status after tab switch](astra/evidence/07-native-status-other-tab.txt) | Saved message remaining with a different edited document | Does not establish user confusion or data loss |
| [Astra missing-file state](astra/evidence/06-native-missing.txt) | Preserved buffer and unresolved external-change state in one observed path | Does not accept all conflict recovery paths |
| [Astra producer options](astra/evidence/09-native-producer-options.txt) | Disabled candidate with an existing producer | Does not establish complete native save safety |
| [Astra layout](astra/evidence/13-browser-measurement.json), [Sol layout](sol/evidence/web-1280-layout.json) | Shared web frontend geometry | CSS pixels; not native point sizes or native narrow-window acceptance |
| [Sol large-graph AX capture](sol/evidence/native-large-graph.ax.txt) | Capture did not contain document body | No large-graph native acceptance or established performance defect |

## Public-copy transformations

The original local artifacts remain unchanged.
The reports here retain their narrative conclusions and priorities but are explicitly marked as public archive copies.
Private absolute paths were removed from reports and text evidence.
Screenshots, binary pipe captures, executables, build logs, temporary scripts, the supplied reference-image pack, and complete HIG/DocC text copies are not included.
Apple HIG references in Astra's report and Sol's analysis remain official links rather than copied source text.
Image placeholders do not provide public pixel evidence for the original visual judgments.

Links to omitted local material are replaced with explicit omission notes.
The `originalSourceFile` filenames and SHA256 values in `provenance.json` identify the inputs before sanitization; they are not hashes of the sanitized copies.
The `source` field names each corresponding public archive file.
The Astra manifest retains the original executable hash but omits local root fields and shitae-specific model hashes.
Sol's validation record retains historical shitae check results to explain evaluation preparation; the underlying models and shitae-specific evidence are not archived in this repository.
The parent comparison still discusses shitae's contribution and candidate improvements as historical review content, not implementation decisions or issue state.
The separate shitae project chat owns its report archive, model evidence, and issue filing.

## What remains unverified

Neither review accepts VoiceOver, IME composition, measured contrast, dark appearance, large native documents, long-duration performance, or other operating systems.
Native file operations were covered differently: Astra observed editing, saving, tab switching, Undo, and selected conflict behavior but did not complete an Open roundtrip; Sol observed short input, diagnostic recovery, and an unsaved-close sheet, but did not accept actual saving or conflict recovery.
Web observations do not verify native dialogs or file I/O.
shitae simulations do not verify disk revision handling, data preservation, actual focus movement, editor Undo retention, or visual readability.
The original reviews did not run the full product test suite or CI.
This archive's document checks and independent review do not extend those product acceptance boundaries.
