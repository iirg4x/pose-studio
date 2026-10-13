# Pose 0.8.6 performance audit

Completed 12 October 2026. Scope: timeline, motion trails, curve editor, Rig/Pose/Clips/Tools panels, optional viewport overlays, and the bone-controller redesign.

## Findings and fixes

- **Timeline:** the entire key grid subscribed to every playhead update. The reload fixture created 653 key buttons and 3,509 timeline DOM nodes, and React reconciliation dominated the profile. The grid now renders only visible rows plus a small overscan. The frame input, ruler cap, cursor line and contact highlight subscribe independently. The playhead uses a compositor transform instead of changing the layout position of the tracks. Interpolation badges are calculated only for displayed rows. Track edits are deferred during a pose gesture, then refreshed on release.
- **Motion trails:** every revision synchronously evaluated the whole clip at two-frame intervals. This ran again on successive controller movements. Sampling now performs one pose evaluation per idle callback, restores the visible pose before yielding, and pauses during dragging, playback, hidden documents, recording and editor-hidden views. Jobs cancel when the project revision, control, editing rig or preview model changes. Finished trails are reused during playback. Existing paths remain available while edits are being made; a new selection does not display the previous control's path. The original two-frame resolution is retained, with the final frame also included for odd-length clips.
- **Curve editor:** graph paths, key widgets and modifier settings no longer rebuild for clock-only updates. The cursor remains live. Editing and adding a key use the current playhead, and curve edits remain live throughout gestures.
- **Other panels:** static library/layer/asset content no longer follows every playback frame. The Rig list updates for actual IK/FK changes. Pose fields still update during paused scrubbing and editing; repeated playback evaluations are skipped. Loop-seam calculations are cached until the project changes.
- **Controller shapes:** compact finger capsules, wrist and foot frames, single rotation cuffs, secondary twist arcs, distinct pole diamonds, a head outline, and pivot-centered roll handles replace the old doubled ribbons and box fallbacks. A selected outline has a dark backing stroke for contrast. Distant finger controls no longer inflate into overlapping boxes; screen-space picking retains its forgiving margin. Rig transforms and animation evaluation were not changed.

## Measurements

Same desktop Edge browser, Android UI layout at 1280 × 800 CSS pixels, device scale factor 2, development build, repaired reload-project test copy. Frame intervals were collected with requestAnimationFrame during 2.2-second playback runs alongside CPU profiles. Cinematic rendering and camera preview were disabled for the primary comparison. These figures compare browser workloads; they are **not measured Galaxy Tab S10 Ultra frame rates**.

| Scenario | Before median / p95 | After median / p95 |
| --- | --- | --- |
| Timeline closed | 7 / 14 ms | 7 / 14 ms |
| Timeline open | 41.7 / 104.3 ms | 7 / 14 ms |
| Rig panel open | 13.8 / 21 ms | 7 / 14 ms |
| Pose panel open | 13.8 / 21 ms | 7 / 14 ms |
| Clips panel open | 13.7 / 14 ms | 7 / 14 ms |
| Tools panel open | 7 / 14 ms | 7 / 14 ms |
| Curve editor open | — | 7 / 14.1 ms |
| Cached motion trail enabled | — | 7 / 14 ms |

The expanded timeline rendered eight nearby tracks instead of the full hierarchy in the landscape test. It retained the complete scroll height and reached the final prop tracks. Trail toggling fell from a synchronous **291.5 ms** pause to **0.2 ms** scheduling time; total sampling work is spread across idle callbacks, not eliminated. A 104-frame clip still produces 53 samples. The completed left-hand path agreed with direct whole-clip evaluation to within 5.7e-8 scene units, the expected Float32 geometry precision.

Optional modes were also exercised separately after the fix: Cinematic and camera preview measured approximately 7 / 14 ms in this browser fixture; Game View measured 6.9 / 7.2 ms. These results do not establish their GPU cost on the tablet. Cinematic effects and the second camera pass remain real rendering costs; neither is enabled automatically on Android.

## Verification

- 255 tests passed across 47 files, including new controller-geometry, picking and incremental-sampling coverage.
- TypeScript, Vite, Capacitor synchronization and the Gradle APK build passed.
- Actual pointer key dragging moved a root key from frame 0 to 5; Undo restored the original track exactly.
- Scrolled the virtual timeline to the final tracks, expanded/collapsed groups, and checked portrait and landscape layouts. No unintended page overflow or label/key-row misalignment was observed.
- Typed frame 37 into the transport and verified the ruler readout. Added a curve key at frame 37 after the clock subscription split; Undo restored the project exactly.
- Actual touch input moved a hand with trails enabled. Trail sampling remained at 53 calls throughout the gesture (zero resamples during movement). Undo restored the entire project exactly.
- Reviewed full-body, first-person, selected-control, left-hand trail, portrait Pose-panel and timeline screenshots. Existing rig/control tests verify pose and IK/FK behavior independently of the new outlines.
- APK signature matches the installed update lineage: SHA-256 certificate 409fe99c6d150808ed606878de5ea6e1914a201c20dac33ceb91a3ffdc537c3f.

## Limits and follow-up measurements

No emulator was launched. A physical Galaxy Tab S10 Ultra was not connected, so on-device GPU frame time, thermals, sustained refresh rate and pen latency remain unmeasured. Long motion trails intentionally finish asynchronously; the view remains interactive while sampling, and generation pauses during playback or a gesture. Playback begun before a new path finishes uses the existing completed path, if available.

CPU profiles, numeric results and reviewed screenshots are retained under work/controller-v086 in the parent workspace. Testing used disposable browser project copies; the user's saved project was not edited or republished.


## 0.8.7 follow-up

- Visible-only timeline tracks retain independent playhead updates. Fixed key rows missing absolute offsets after vertical virtualization; browser assertions now compare every rendered key row and label Y position after scrolling.
- Toolbars use deliberate wrapping and contextual commands instead of overflow scrolling. Verified no transport/track-toolbar overflow at 1280 px; checked portrait at 800 px and desktop at 1600 px. Loop settings use a viewport-clamped portal to avoid the sheet clipping them.
- Prop control bounds and line geometry are cached, including asynchronous model load completion and placement changes. The main rifle cage uses the magazine socket reference and remains fixed while the magazine animates. No animation transforms are changed.
- Empty touch and pen taps deselect; orbit and pinch retain selection. Pose and layer actions were exercised on a disposable copy of the imported reload project. Mirroring both hands twice restores their matrices within 3.6e-7.
- 262 tests passed across 48 files. Browser benchmark at 1280×800: closed timeline median 7 ms, p95 13.9 ms (284 samples); open timeline median 7 ms, p95 13.9 ms (277 samples). This is desktop browser evidence, not physical tablet FPS. No emulator used.
- Evidence: work/prop-controls-v087 (screenshots and results.json). The saved private project was not modified.
