# Audit remediation evidence — 2026-10-16

This report records the user-authorized F01–F13 remediation work for the 0.8.25 working tree. It separates confirmed behavior and verification from release checks that remain open.

## Confirmed remediation

| Finding | Confirmed behavior |
| --- | --- |
| F01 | Fractional active/inactive clip frames survive validation and recovery, including the editable current frame 12.25. |
| F02 | WebGL initialization failure has a visible fallback with retry and download routes. |
| F03 | A failed recovery transition offers Retry, Continue and Cancel. |
| F04 | Dynamic prop controls validate transactionally and enforce a 256-item global cap. |
| F05 | Keyboard focus guards keep scene shortcuts from leaking while a field or control owns focus. |
| F06 | Modal focus is contained and the background is inert while the modal is open. |
| F07 | Persistent errors remain visible on phone layouts. |
| F08 | The small-window minimum width was removed; the 640×450 check has no overflow and keeps the inspector reachable. |
| F09 | Tools menus expose keyboard focus and navigation semantics. |
| F10 | GLB import preflights the 32 MiB limit for browser `File` input and Android provider/stream paths. |
| F11 | The browser `maximum-scale` restriction was removed. |
| F12 | The original concurrency risk was unconfirmed; hardening adds atomic session/generation merges, durable quarantine and held writes, lazy loading, and rejection of incomplete recovery candidates. |
| F13 | Animation and pose deletion uses ordered undo history while preserving references and drafts. |

The latest workspace decision supersedes the earlier full-screen desktop overlay direction: fine-pointer desktop uses an opaque Properties dock on the right and an opaque timeline dock at the bottom, both reserving scene space and both collapsible. Touch/coarse layouts remain contextual. Shared UI refinements include the 8px radius, ghost-button rest state, centered numeric values, dropdown chevrons, a logo-only menu, the collapsible desktop Properties bookmark rail, per-bone current-pose Mirror controls and distinct timeline tracks.

The official Unreal `SK_FPGun` and compact library were deployed in 0.8.24. They are not new 0.8.25 source additions.

## Verification evidence

- The full suite passed: 96 files and 587 tests. The final focused regression pass also passed 66 tests; the latest IndexedDB recovery checks passed 5 tests.
- TypeScript checks for the app and tests passed; Knip passed.
- All 23 sequential browser checks in `work/audit-remediation/browser-checks.json` passed. They cover a 1440×900 desktop, 640×450 desktop, 390×844 and 844×390 phone layouts, vertical-menu submenu alignment, focused Space opening Settings without playback, contained keyboard focus, phone Tools-arrow focus, persistent phone errors, no-WebGL fallback/retry/download, and context restoration retaining the project and frame. The final 640×450 layout uses the same solid docks and constrains the scrolling tool rail above the timeline without masking its controls.
- The 1440×900 checks confirm real desktop docks, the compact tool rail, editable frame 12.25, equal 320px Keys/Curves heights, collapse restoring the full scene, and the opaque dock layout.

Dependency evidence uses Electron 44.7.2 and Vitest 4.1.12. The current audit reports three moderate development-only findings through `Capacitor CLI → xcode → uuid` and zero production findings.

## Release evidence and remaining validation

- A real two-release PWA check passed: an installed update deferred during playback, then automatically activated and reloaded on pause, preserving the unsaved project and frame rate. Foreground polling checks every 60 seconds, with additional focus/online checks.
- Android `:app:compileDebugJavaWithJavac` passed with one worker and a 768 MiB Gradle heap. The 0.8.25 desktop package succeeded; hidden Electron 44.7.2 validation completed an actual preload IPC save/open round trip.
- Physical iPhone and Android hardware checks, including screen-reader checks, have not been performed.

Physical-device and screen-reader checks remain open. This report records verified implementation, package, browser and two-release PWA evidence without claiming publication.
