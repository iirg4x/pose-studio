# Loading performance measurements

Pose Studio 0.8.41 reduces complete weapon-project opening and recovery time. The measurements below include recovery saving and actual input response.

## Measurement contract

The source is the original, unmodified `Animated Low Poly Weapons - Layered Pack.pose`: 131,649,004 compressed bytes, 627 clips and 79 embedded asset records. Three completed observations of 0.8.40 are compared with three observations of the final 0.8.41 production PWA. Each run uses a fresh Chromium 156.0.8078.4 context on Windows, an i9-14900K and an RTX 4090 through D3D11. Responses are local with `cache-control: no-store`; service workers are blocked. This measures application loading, not Internet delivery.

File-open timing begins before the file is supplied to the chooser. It includes source reading, decompression, parsing, validation, all embedded-asset checks and writes, active/preview model loading, retargeting, the exact canonical save signature and recovery saving. The endpoint requires the opening state to clear, a real application-menu click and Escape to respond, the recovery indicator to be up to date, zero pending IndexedDB write transactions, 750 ms since the last write, and two rendered animation frames.

Recovery timing starts before page reload, including the old page's before-unload work. Animation switches and their autosaves finish before reload, and recovery must restore the latest selected animation. Frame-input checks run after the timed phase because seeking creates autosave work.

## Matched observations

Times are seconds. Medians and ranges describe these three runs per build on this shared machine; they are not guarantees for other devices or workloads.

| Operation | 0.8.40 median (range) | 0.8.41 median (range) | Median change |
| --- | ---: | ---: | ---: |
| Full project open, durable and responsive | 16.152 (13.635–16.380) | 10.941 (10.747–11.280) | 32.3% less time |
| Full reload and recovery, durable and responsive | 10.492 (10.207–10.552) | 8.531 (7.712–8.639) | 18.7% less time |
| Blank editor startup | 2.965 (2.773–3.133) | 2.819 (2.712–3.004) | 4.9% less time |

The blank-startup ranges overlap, so the main demonstrated gains are full-project opening and recovery. Final animation switches took 0.480–0.541 seconds for another animation using the same weapon, and 0.800–0.844 seconds for a different weapon. The earlier approximately 9.4-second 0.8.40 result excluded recovery saving and does not satisfy this endpoint.

| Observation | Full open | Full recovery |
| --- | ---: | ---: |
| 0.8.40: final-before-2 | 13.635 | 10.492 |
| 0.8.40: final-before-3 | 16.152 | 10.207 |
| 0.8.40: matched-before-4 | 16.380 | 10.552 |
| 0.8.41: final-worker-after-1-qa | 10.941 | 8.639 |
| 0.8.41: final-worker-after-2 | 11.280 | 8.531 |
| 0.8.41: final-worker-after-3 | 10.747 | 7.712 |

## Loading changes

Large gzip inputs use native `DecompressionStream` in a module worker. Input views and transferred output batches are limited to 1 MiB, with four output credits bounding data queued ahead of parsing. The worker reports success after native gzip integrity validation and terminates on completion, cancellation or error. Worker-constructor and runtime failures retry through the native main-thread decoder with the intact source bytes. Small inputs and Blob callers retain the compatible native path. Manual UTF-8 decoding avoids an extra text-stream transform.

Recovery stores the original compressed source once. Eligible unchanged clips share that source reference; edited and ineligible clips use canonical native records. Source capture follows validation of all clips and assets. Recovery reads each shared source once, and failed recovery remains quarantinable and downloadable. Startup overlaps recovery preload with Manny preparation; recovery actions remain unavailable until the store is ready. Asset decoding uses native `fromBase64` when available, with the existing `atob` fallback.

The exact v4 save signature and v3 compatibility remain unchanged. Open-time comparison yields between batches. A monotonic authored revision lets a verified clean receipt survive animation switching and empty-draft frame navigation; authored changes, drafts and undo invalidate it. View-only recovery writes persist metadata while reusing source-backed curves. Completed recovery receipts prevent duplicate unload flushes. The final full-pack run wrote one shared source record; navigating between the two tested animations added no native clip writes.

## Verification

All 708 tests across 116 files passed, together with production/test type checks, Knip and the production PWA build. Focused coverage includes stream limits and Unicode seams, native gzip corruption, worker fallback and termination, source ownership, recovery rollback/quarantine, source-reference navigation and subsequent authored edits, and authored-revision invalidation.

Every final browser run restored all 627 clips with the same complete canonical v4 authored-data signature, loaded the active and preview models without errors, completed real menu input, and ended with no pending writes or decoder workers. Additional QA verified playhead input, a persisted animation rename, reload after editing, and cancelling an open without losing the current project. Contexts, browsers and preview servers closed after every run. A separate upgrade check loaded an existing 0.8.40 native-format recovery through 0.8.41 in 10.368 seconds, including the old page’s before-unload work. All 627 authored clips and the latest active animation survived, with no recovery rewrite during startup. The 8.531-second recovery median above measures recovery written by 0.8.41.

Keep this source and completion contract when comparing future changes. Decoder-only or first-paint timing cannot substitute for the complete loaded, saved and responsive endpoint.
