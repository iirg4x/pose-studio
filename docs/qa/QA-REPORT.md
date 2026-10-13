# Verification — 10 October 2026

## Automated animation checks

9 tests passed: attachment pose preservation, stable held offsets, inverse world/local edits, future contact-cycle rejection, quaternion interpolation and stepped poses, malformed-project rejection, grouped undo and manual keying, independent first-person/body tracks, and deterministic posing of the actual 89-bone rig across 97 frames. TypeScript and the production build passed.

## Desktop checks

Tested real UI controls in Electron: numeric posing, direct gizmo dragging and undo, select/move/rotate modes, rig switching, release/reattach, grip presets and copy/paste, playback/scrubbing, manual keying, diamond dragging, key deletion, curve display, motion trails, new-project recovery, help and scope dialogs, native save/open, and export with and without character meshes. Rejected a cyclic attachment and an invalid project file; canceling open preserved the project. Automated native file pickers supplied test paths; the application performed the real file operations and export.

Launched the portable executable and confirmed app.isPackaged=true, its app.asar entry point, 1560×1000 startup layout, and automatic detection of Blender 5.2.1. No renderer exceptions were captured during the covered flows. The 1024×720 layout retained the viewport, timeline, rig controls, and fixed key/copy/paste controls; secondary inspector content scrolls.

## Export verification

The desktop UI exported seven FBX files with meshes. Reimported each into Blender and compared every sampled deformation/prop matrix across all 97 frames. Body, legs, and floating-arm exports retained 89 bones each; props retained one root bone each. All frame ranges matched 1–97 in Blender (0–96 in the editor). The maximum matrix-element difference was approximately 0.000017. A second export from the packaged executable succeeded with character meshes disabled. The camera/contact sidecar and editable project were present.

## Visual comparison with the approved concept

- Preserved the dark top bars, dominant posing viewport, narrow contextual inspector, and bottom timeline.
- Preserved the inset player camera, grip sliders/presets, blue export button, cyan contact spans, and amber playhead.
- Kept most transform and finger settings behind More controls.
- Added First person / Full body to make the user-requested independent rigs explicit.
- Used the real supplied Manny Simple model and a procedural training prop; these differ from the illustrative concept's model, materials, and weapon. Floating-arm mode intentionally removes the body from the main posing view.
- Checked initial, playback, expanded-inspector, full-body, look-down, and export states. No page overflow or overlapping main panels was found at the checked sizes.

## Remaining validation and scope

Unreal import, stock full-Manny skeleton compatibility, and Blueprint runtime behavior have not been validated in an Unreal project. The standalone renderer is an authoring preview; Unreal-specific first-person FOV/anti-clipping rendering is not simulated. Retargeting other characters, custom prop imports, editable Bezier tangents, and advanced animation layers are outside this first build.


## v0.6.0 — Humanoid retargeting (11 October 2026)

The earlier first-build scope above is historical. Retargeting now includes imported FBX/GLB/glTF humanoids, editable per-bone mapping, reference-pose alignment, target scale/facing corrections, hand/foot IK, modular mesh visibility, Manny comparison, and animated target FBX/GLB export. The supplied Polygonal Fantasy male and female examples are bundled.

- Production TypeScript/Vite build passed. The complete suite passed 157 tests across 27 files; all 8 retarget-specific tests passed again after final origin and outfit-default changes.
- Verified the male and female examples, native FBX import, incomplete-map export blocking, pose corrections, outfit selection, playback, and the supplied three-layer Axe body action in Electron. An unskinned import preserved the existing target. No renderer exceptions were captured.
- Inspected the interface at 1560×1000 and 1024×760. Mapping/parts/settings remain accessible with vertical scrolling and a fixed export action.
- Exported a 97-sample target GLB with 68 joints, 204 transform channels, 6 selected meshes, and embedded textures. Compared sampled world matrices after GLB reimport against the preview: maximum element difference approximately 1.48e-7. Exported FBX was reimported in Blender and retained 68 bones, 6 meshes, animated hands, and a 4-second action. Blender displays source frames 0–96 as 1–97 on FBX reimport.
- Saved a portable project with three embedded character assets; automated checks restored imported assets into an independent cache and rejected invalid asset paths/data.
- Recorded the retargeted Axe body action: 50 frames at 60 fps, duration 0.8333333 seconds for a 20-frame/24-fps source cycle.
- Backed up the existing profile and current Axe workspace before updating. The source action data matched the user's saved project, including all three body layers.

Export contains the target skeleton, visible character meshes, and baked motion. Preview props are not included in target exports. Unusual humanoid rigs may require manual bone mapping/reference-pose corrections. This release has not been imported into an Unreal project.

Packaged v0.6.0 was launched and verified with the real profile. All three source actions and drafts matched the pre-update snapshot; the file-save baseline was preserved. Added the bundled male example through the packaged UI and verified the selected outfit, ready bone map, and character autosave. No renderer exceptions were captured. The editor remains open in Retarget on Axe · Equip · Body, frame 17.


## v0.6.1 — Shared Manny skeleton preview models (11 October 2026)

Replaces the previous separate retarget playback workflow with a Preview model selector in Animate. Male and female meshes are rebound to Manny's 89 bone names, axes and hierarchy while keeping anatomical rest positions. Controls, clips, layers, player-camera mode and recording stay in the shared animation workflow.

- Production build and all 168 tests across 28 files passed. Eleven new tests cover hierarchy, skin rebinding, preserved height/shoulder width, shoulder-relative reach, root motion, original limb lengths and stance, prop scale/contact, continuous grip/release boundaries, FK/finger rotation, detached head channels, view-only switching and arm masks.
- Measured male reference shoulder span is approximately 0.596 m versus Manny's 0.380 m; head joint height is approximately 1.534 m versus Manny's 1.626 m. These measurements come from each compatible skeleton's reference pose, not uniform model scaling.
- Verified male/female/Manny switching in the normal editor, the supplied three-layer Axe body action, player-camera mode, cinematic rendering, and 1024×760 layout. An attached hand moved 0.010000017 m for a 1 cm gizmo command with no source keys changed when auto-key was off.
- GLB export reimport contains 89 Manny bones and 6 visible character meshes. Sampled world matrices at frames 0, 12, 13, 17 and 20 differed from the preview by at most 0.00000771. FBX reimport in Blender contains 89 bones, the expected Manny root/spine/hand/IK names, 6 meshes and one animated action, frames 1–21 corresponding to source 0–20.
- Player-camera recording of the selected male produced 50 MP4 frames at 60 fps and duration 0.833333333 s for one 20-frame/24-fps source cycle. No renderer exceptions were captured.
- Saved a fresh workspace and profile backup before installation. Source clips, layers and unkeyed edits are retained.

Character export includes the selected model and compatible skeleton; prop meshes remain separate. The reference skeleton follows Manny's hierarchy with the character's own bone translations. Direct Unreal import remains unverified.

Packaged v0.6.1 reopened successfully. The latest live actions, drafts, frame and file-save baseline matched the pre-update backup. The male example was selected using Preview model in Animate; its runtime rig has all 89 Manny bones, the user’s existing control visibility preferences were preserved, and the selected model was autosaved. No renderer exceptions were captured.


## v0.6.2 — Retargeted mesh deformation (11 October 2026)

The v0.6.1 bone-matrix checks did not detect visible mesh distortion. Direct neutral-material comparison with the original imported model exposed an approximately 90-degree ribcage calibration error caused by aiming a short, backward neck offset vertically. Wrist pose calibration was also averaged into vertices and skinned a second time, while compatible twist bones had no skin influence.

Inspected the installed Auto-Rig Pro 5.2 extension source (auto_rig_remap.py rest-pose offset handling; auto_rig.py twist-weight smoothing and proxy remesh binding) and Voxel Heat Diffuse Skinning 4.3 source (world-space mesh/bone input, generated weights, protected weights). The application implementation is independent; no addon source was bundled. Applied the relevant principles: preserve the native mesh, store pose corrections per bone, and distribute existing forearm influence over twist deformers. Full voxel rebinding was unnecessary for the already-weighted examples.

- Visually inspected male and female neutral poses, close views of shoulders/forearms/wrists, Axe body poses at frames 0, 12, 13 and 17, and both player-camera previews. Textures were temporarily neutralized only in the isolated QA window to expose deformations. Final textured screenshots are in screenshots/retarget-fixed-*.png.
- Fractional-frame sweeps of the supplied layered Axe action at 0.1-frame intervals found no wrist/twist discontinuity: largest adjacent angular change 2.674 degrees for male and 2.487 degrees for female.
- Added regression checks for every visible native-bind vertex, unchanged torso reference rotations, normalized twist skin weights, and real Axe wrist continuity. Prop contact validation now compares grip centers instead of copying Manny wrist offsets.
- Reimported the female GLB and compared 6,005 posed vertex samples at frames 0, 12, 13, 17 and 20: maximum error 4.664e-7 m. FBX reimport in Blender compared the same samples against evaluated mesh surfaces: maximum error 4.770e-6 m. Both retain the compatible 89-bone hierarchy.

Production TypeScript/Vite build and all 172 tests across 28 files passed. Packaged v0.6.2 reopened with the real profile; actions, drafts, pose library, character profiles and saved-file baseline matched the fresh pre-update snapshot. View settings and playback were restored. The installed runtime has native inverse bindings and all 89 Manny bones. Workspace and full-profile backups are stored under backups/.
