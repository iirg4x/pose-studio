# Loading performance measurements

This note records the current end-to-end loading measurements for Pose Studio 0.8.40. It exists so future optimization work compares the same user-visible endpoints instead of reporting decoder time as project-open time.

## Scope and measurement contract

The measured source is the original, unmodified `Animated Low Poly Weapons - Layered Pack.pose`: 131,649,004 compressed bytes, 627 clips and 79 embedded asset records. The comparison uses the latest matched local production-PWA builds, 0.8.39 and 0.8.40. It is a local application measurement, not an Internet download test: localhost responses used `cache-control: no-store`, and service workers were blocked.

The runs used a fresh Chromium 156.0.8078.4 context on Windows with an i9-14900K, 32 logical threads and an RTX 4090 using D3D11. For full file opening, the first-usable endpoint waits for all 627 clips to be available, the opening state to clear, active and preview props to finish loading, retargeting to be ready, two animation frames to complete, and a real input event to be accepted. Recovery transaction completion is reported separately rather than being treated as finished at the first usable frame.

The full-open interval includes source read, decoding, validation, all embedded-asset validation/cache writes, active and preview model preparation, save-signature work, viewport preparation and the first usable workspace. Animation-open timings include the selected animation becoming usable. Recovery timings include the recovery transaction completion where stated.

## Latest matched pair

Times are wall-clock seconds. “Before” is 0.8.39 and “After” is 0.8.40.

| User-visible operation | 0.8.39 | 0.8.40 | Change |
| --- | ---: | ---: | ---: |
| Startup to blank editor | 2.086 | 1.986 | -0.100 |
| Full file open through actual last-frame/first-frame response | 12.2304 | 9.3853 | -2.8451 |
| Background recovery transaction completion, measured from file-open start | 12.8836 | 11.9226 | -0.9610 |
| Open the same weapon animation | 0.488 | 0.403 | -0.085 |
| Open a new weapon animation | 0.790 | 0.743 | -0.047 |
| Full page reload plus recovery | 16.229 | 8.681 | -7.548 |
| Recovery from new-document navigation | 13.7871 | 6.6463 | -7.1408 |

The full page-reload clock begins before reload and includes the before-unload dirty comparison in both builds; the new-document navigation row starts when the new document begins loading. The latest pair is an observed comparison on this machine and load state, not a best-case, median or guarantee. Full weapon-project opening still takes about 9.4 seconds, so the loading path remains an optimization target.

## Changes represented by the comparison

Project signatures use canonical deduplication and asynchronous open-time comparison. Shared prop GLTF resources are cached and reference-counted across active and preview contexts, and Manny resources are reused. Recovery validates freshly read snapshots in place and keeps the durable original when validation fails. Imported embedded assets are validated before one atomic cache write. Startup uses the shared loading status, avoids rendering a covered scene before the workspace is ready, and loads Grip thumbnails lazily after the first usable view.

Recovery writes yield between batches while retaining one atomic transaction. Each batch queues at most eight clip writes with an 8 ms enqueue budget. Tests verify rollback after a later-batch failure and restored-value equivalence after validating a canonical recovery snapshot.

## Verification context

The release gate passed 679 tests across 115 files, including production and test type checks, Knip and the PWA build. The interpolation core matches 144 Blender 4.3.2 oracle cases with a worst absolute error of 2.567073e-6. Browser checks covered the 13 interpolation choices, dirty-operation cancellation, lazy Grip thumbnails, save/reopen, and compact desktop behavior.

These figures do not establish Internet delivery time, cold hardware behavior, or a universal improvement. Repeat the same endpoint definitions and source file when evaluating later changes, and keep the phase timings alongside the total so a faster decoder does not mask a slower validation, asset, model or signature phase.
