# Pose for Android 0.8.10

## Install on Galaxy Tab S10 Ultra

1. Copy `android-build/Pose-0.8.10-android.apk` to the tablet and open it in My Files. Allow that app to install this APK if Android asks.
2. Open **Pose**. The editor runs locally; it needs no PC, local server or internet connection.
3. Copy your saved **.pose** project to the tablet. Choose **Pose → Open project** and select it. Models and props embedded in the project travel with it.
4. Use **Pose → Save project** to create a portable file when finished. Copy that file back to desktop Pose to continue there.

This is a debug-signed sideload build, not a Play Store release. Install future builds over it to preserve app data. Uninstalling or clearing app storage removes local recovery and imported assets; separately saved .pose files remain your portable copies.

## Automatic updates

On version 0.8.3 or newer, Pose checks its public app release channel at startup, on return, and every six hours while open. Updates download automatically on an unmetered connection (normally Wi-Fi). Tap **Install update**, allow Pose as an install source if Android asks, and confirm installation. Unsaved work is saved first; recovery is retained. **Pose → App and project updates** lets you check immediately or turn off automatic downloads. Offline editing keeps working when a check fails.

For private project revisions, choose **Open project**, select **Google Drive** in Android’s file picker and open the private `.pose` file directly. The Drive app handles sign-in. Pose follows that document on return and every five minutes while paused. An unchanged local project refreshes automatically. With local edits, the update panel offers **Save copy and load update** or **Keep local version**. This receives revisions; it does not upload edits or merge conflicting animations. A file opened from Downloads follows only that local copy. Cloud freshness depends on the document provider and connectivity.

The public app channel contains APK releases and checksums. Projects are never included. Updates verify size, SHA-256, package identity, a higher version code and the installed app’s signing certificate. Keep the same Android signing key for future releases. Build with `npm run android:apk`; `node scripts/publish-android.cjs` prepares the manifest, and adding `--publish` publishes a complete release on the configured channel.

## Editing and preview

**Paste mirrored** reflects the copied pose to the other side; **Reset location / rotation** perform a single rest reset. Neither reset stays enabled as a mode. Repeated resets of an unchanged pose do not create extra keys.

In **Clips**, use an animation’s More button and **Rename**. The Android dialog stays above the keyboard and requires **Rename** to accept, or **Cancel** to discard.

Use the **Preview** selector in Clips or Animation properties to pair opposite view types. Full-body actions without a paired first-person action show their own motion on the first-person model. Pairing only changes preview, including props, and synchronizes by elapsed seconds.

**Ground** in the selected-pose actions, or **Pose → Grounding and reach → Ground and key**, places the mesh on the floor and writes pose keys at the current frame. Feet include their toes and preserve heel/ball animation. Auto Key may be off. There is no automatic playback clamp; existing track interpolation controls the motion into and out of contact. Legacy Grounded flags no longer affect playback. **Clearance** is used by the next Ground command; Fixed/Stretch continues to control IK reach.

**Pose → Transform → Coordinates** selects World, Root, Parent or Local offsets for numerical location and rotation. Clicking a controller selects, expands and reveals its timeline channel.

## Tablet controls

The 3D scene fills the screen in landscape and portrait. Android system bars can be revealed by swiping from the edge.

- Tap controls to select; enable **Multi** to add or remove controls without a keyboard. **Box** selects a rectangle with Replace, Add and Remove modes. A small touch/pen deadzone prevents taps from moving the pose. Drag a selected control with one finger or the S Pen to pose the group. **Move**, **Rotate**, **Global / Local / View** orientation and the current pivot are always within thumb reach; axis handles remain available for precision. Auto key records edits, or tap **Key** in the frame dock.
- Drag empty space to orbit. Use two fingers to pan and pinch. A second finger cancels a tentative pose before navigation, preventing accidental keys. Touch contacts are ignored while the pen is down.
- **Rig**, **Pose**, **Clips** and **Tools** reveal one drawer at a time. Close it using its button, X or Android Back. Drawers overlay the scene without resizing it.
- The bottom dock plays, steps and scrubs frames. **Timeline** reveals the key editor. Scroll tracks vertically, use its zoom buttons for dense keys, drag diamonds to retime after the touch deadzone, and use **Multi** or **Box** for multiple keys. Copy and **Paste mirrored** preserve spacing at the playhead. Expand it for curves or detailed edits.
- **View** reveals player camera, optional camera preview, Game view, Cinematic and scene framing. The extra camera preview starts hidden on Android to avoid drawing a second view continuously.
- **Pose → Record video** exports at **60 fps**, independently of timeline fps. Choose camera, resolution and loop count, then a destination in Files. WebM/VP9 is the Android default; MP4/H.264 depends on the device encoder.
- Android Back dismisses panels before invoking the existing save-before-close flow. The app keeps its local recovery copy.

The tablet renderer stops drawing while idle, coalesces pose input, bounds high-DPI drawing size, adapts resolution to the measured display cadence, and uses smaller cached shadow maps. Android requests the highest supported display refresh rate at the current resolution; active drawing has no fixed 60 Hz cap. Power, thermal and system policies can still limit the rate. Each gesture keeps one undo snapshot, copies only edited tracks and reuses its transform conversion instead of cloning and solving the entire project on every pointer move. Panel, menu and section transitions respect the system reduced-motion preference. Export resolution and animation timing remain independent. Cinematic effects cost more GPU time. Pressure, tilt and remote S Pen Air Actions are not mapped.

## Supported files

| Operation | Android |
| --- | --- |
| Open / save projects | Portable .pose, including embedded character and prop GLBs; existing JSON projects can be opened |
| Import characters | Self-contained, skinned GLB; review bone mapping in Character setup |
| Import props | Self-contained GLB |
| Import animations | Animated skeletal GLB, or actions from a .pose project; the shared importer fits editable curves |
| Export target character animation | GLB from the selected preview character |
| Export recording | WebM/VP9; MP4/H.264 if supported by the device |
| FBX / Blender conversion and shared Unreal package | Desktop Pose; transfer the same editable .pose project |

Pack textures and binary resources inside GLB files. Individual imported GLBs may be up to 32 MiB and a portable project's combined custom assets up to 64 MiB. Native input documents are limited to 128 MiB. Animated GLB source ranges are shown on a 30 fps time ruler because glTF stores seconds rather than an authored frame rate; sampling can use another rate without changing duration.

## Build

Install Node.js, JDK 21 or newer, and Android SDK platform 36. Set JAVA_HOME and ANDROID_HOME (or open android/ in Android Studio to create local.properties).

```sh
npm install
npm test
npm run android:apk
```

Output: `android-build/Pose-0.8.10-android.apk`. The build script builds the web editor, syncs Capacitor and runs Gradle assembleDebug. Keep the signing key used for this installation if building later APK updates. Public distribution should use a separately managed release signing key and release build.

## Validation

- TypeScript/Vite and Gradle APK builds passed.
- 289 tests passed, including pose-edit immutability, undo/redo, layer/contact offsets, gesture cancellation, display cadence and adaptive drawing budgets.
- Earlier Android 16 tablet emulator validation (not rerun for 0.8.10): project open/save through Files, cancel picker, pen-pointer posing and Undo, timeline expansion, landscape/portrait layouts, curve editor, local GLB prop import, unsaved-change Back warning, dialog Back handling and offline recovery after process termination.
- Animated Low Poly Weapons roundtrip retained all clip data, character settings and five embedded assets exactly.
- Exported and parsed a 1280 × 720 VP9 recording: 208 video frames, 3.467 seconds, 60 fps.
- 0.8.5 browser checks: touch controller movement and single-step undo/redo, second-finger cancellation, pen input, concurrent touch rejection, exposed orientation controls, landscape/portrait panels, timeline and reduced-motion transitions. No emulator was launched.
- 160 transform-conversion comparisons across first-person/full-body, pose overlays, contacts and frames 0/9/76/104 matched the previous conversion exactly. Browser controller-update CPU time improved from 56.9 ms to 3.2 ms per update in the same gun-project fixture; this does not measure physical tablet FPS.
- Galaxy Tab S10 Ultra hardware and its physical S Pen have not been connected or tested here. Device-specific encoder performance and palm rejection still need checking on the tablet.

- 0.8.7 browser checks: virtual track scrolling, key drag and undo, live playhead and curve key insertion, incremental trail accuracy and touch-drag deferral, controller silhouettes and picking. Timeline/panel/overlay profiling is documented in PERFORMANCE-AUDIT.md. No emulator was used.

- 0.8.9: compact contextual UI, modifier clipboard and seamless loops, live pose-layer editing, and per-controller Grounded / Fixed / Stretch options. Browser checks cover landscape, portrait, a narrow phone viewport and desktop. Controller tests cover world-space floor contact, rotated camera transforms, legacy and current attachments, repeatable stretch lengths, retargeted male/female soles and export sampling. No emulator or physical tablet was used for this update.

- 0.8.10: explicit keyed grounding with continuous interpolation, world/root/parent numerical edits, timeline selection reveal and narrow panel spacing. Verified in an isolated browser with touch input, full automated tests and signed Android packaging; no emulator or physical tablet performance test.
