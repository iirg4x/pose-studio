## 0.8.27 — labelled controller tools

The desktop Properties rail shows visible tool captions beneath each icon. Reset and paste captions wrap, and long tool stacks scroll inside the dock while the collapsed panel’s restore button remains reachable.

## 0.8.26 — stable Properties dock

The desktop Properties dock keeps its width when controls are selected or deselected, so selection no longer resizes the 3D scene. With no control selected it shows animation-wide layer, preview and source settings plus Select all and Box select actions. Explicit collapse stays persistent and keeps a compact restore handle available without a selection.

## 0.8.25 — audit remediation and resilient workspace UI

Audit remediation keeps fractional current-frame edits editable, adds a visible WebGL fallback with retry/download routes, gives failed recovery explicit Retry/Continue/Cancel choices, validates dynamic properties transactionally with a 256-item global cap, and hardens keyboard and modal focus. Phone errors remain visible, compact windows no longer inherit a minimum width, Tools menus support keyboard navigation, GLB imports reject files above 32 MiB across browser and Android provider/stream paths, and browser zoom no longer applies a `maximum-scale` restriction.

Recovery/session updates merge by session and generation atomically, quarantine failed data durably, and hold missing-generation fallback while lazy loading completes. Animation and pose deletion now use ordered undo history while preserving references and drafts. Fine-pointer desktop reserves scene space for opaque, collapsible Properties and bottom timeline docks; touch layouts remain contextual. Shared UI refinements apply the 8px radius, ghost-button rest state, centered numeric values and dropdown chevrons, with a logo-only menu, a collapsible Properties bookmark rail, per-bone current-pose Mirror controls and distinct timeline tracks.

PWA releases now check automatically, wait for editing, playback and file operations to finish, preserve a recovery snapshot, and reload into the new release. The Properties rail ends at its last tool, scrolls within short windows, and keeps a compact restore control when collapsed.

## 0.8.10 — keyed grounding and coordinate editing

**Ground** is a one-shot pose-authoring command. It places the selected mesh on the floor, flattens the contact rotation, and keys the current frame, including the toes when grounding a foot. It works with Auto Key off and is one undo step. Normal track interpolation controls the approach and lift; there is no automatic floor clamp during playback or export. Old saved Grounded flags are accepted but no longer evaluated. Fixed IK reach remains fixed; the editor reports when it prevents contact.

**Pose → Transform → Coordinates** selects World, Root, Parent, or Local offsets for XYZ and rotation edits. Switching the display space keeps the pose. Resolved world edits support bones, rotated cameras, attachments and pose layers.

Selecting a scene controller reveals and highlights its timeline channel, expands its parent groups, and preserves multi-selection. The narrow tablet properties panel leaves room for the active-layer badge.

## 0.8.9 — touch selection, mirrored paste and preview pairing

**Multi** enables tap-to-add/remove selection for scene controls and timeline keys. **Box** selects controls with Replace, Add and Remove modes. A selected group moves together; touch/pen deadzones prevent accidental edits on taps. Empty scene taps deselect. On narrow screens, the pose tools stay above the timeline.

**Paste mirrored** uses the copied pose or keyframes, preserving timing, interpolation and handles without changing the clipboard. Timeline mirroring rejects incompatible mixed control axes or rotation modes rather than changing the motion; use a mirrored pose in those cases. Reset location and rotation are single rest-reset commands with no-op detection.

The **Preview** selector in Clips and Animation properties pairs opposite action types by elapsed time without motion inheritance. Unpaired full-body actions use their own solved motion on the first-person model. Preview props follow the paired action; data exports ignore preview links. Links survive save, import and duplication.

Grounded bones use the actual deformed mesh and settle surface rotation while keeping heading. Foot constraints include articulated toes; retargeted previews measure their own geometry. Android Rename uses an explicit, keyboard-aware modal opened from each clip’s visible More menu.

## 0.8.8 — live editing and controller limits

Select a controller and open **Pose → Controller limits**. **Grounded** keeps it above the world floor after attachments and layers; **Clearance** adds space in centimetres. Feet use sole contacts rather than the ankle origin, including retargeted preview characters. **IK reach → Fixed / Stretch** chooses original arm or leg lengths versus lengthening to reach the target. Limits are saved per controller and action context, support undo, and are used for animation sampling and export. Existing actions default to ungrounded, fixed-length limbs.

The modifier panel supports copying a single modifier or a whole stack, pasting between channels/controls, duplication, reordering and collapsible cards. **Seamless loop** closes noise and sine motion at the action loop's endpoints; changing the loop range updates linked modifiers. Restricted noise envelopes fade at the seam too. Existing imported modifiers stay unchanged until enabled. Base animation keys must still form a matching loop.

Playback continues through selection, layer changes, modifier edits and static pose-layer posing. Moving a controller with Auto key on pauses at the edit's starting frame when the active layer writes timed keys. Opening a transform without moving it does not pause or create a key. Scrubbing rebases playback to the chosen frame. Explicit pause, project replacement and recording/export keep their normal behavior.

Selection names use small attached badges without widening the action bar. Tablet drawers, property sections, menus and modifier cards share compact spacing and retain touch-sized actions. Closing an expanded timeline restores the selection tools.

## 0.8.7 — animation tools at hand

The viewport shows the active animation layer and a selection-aware pose toolbar (Copy, Paste, Mirror, Reset location/rotation). Paste and mirror respect Auto key and the active layer. The timeline now has labeled Keys/Curves tabs, direct Add key, contextual key commands and compact track display options. Scrolled virtual keys stay aligned with track labels. Empty touch/pen taps clear selection, and props use mesh-fitted 3D cages; the rifle cage stays around its magazine socket during reload.

# Pose — animation workspace v0.8.10

## Timeline, trails and controller shapes (v0.8.6)

Timeline tracks render only near the visible scroll area. The playhead and curve cursor update independently; the timeline playhead moves without relaying out the tracks. Rig, Pose and library panels avoid redundant playback renders. Motion trails sample one pose per idle slice, pause during interaction/playback and invalidate safely when the project, control or preview model changes. Controller silhouettes use compact finger capsules, wrist and sole frames, rotation cuffs, distinct pole diamonds and pivot-centered roll arcs.

In the same browser fixture, timeline-open median frame time improved from 41.7 ms to 7 ms. Motion-trail toggling fell from 291.5 ms to 0.2 ms, with sampling completed asynchronously. These are desktop browser measurements, not physical tablet FPS. See [PERFORMANCE-AUDIT.md](PERFORMANCE-AUDIT.md).

## Tablet refinement (v0.8.5)

Orientation and pivot tools are beside Move and Rotate. Pose properties use aligned touch fields and compact layer actions; drawers, sections and menus animate and respect reduced motion. Controller edits copy only changed tracks, batch notifications and reuse the gesture conversion, reducing update CPU time from about 57 ms to 3.2 ms in the same headless Edge fixture. Android requests the highest supported refresh rate, removes the active 60 Hz cap and adapts resolution to measured display cadence. This is a CPU benchmark, not a measured tablet frame rate.

## Touch-first Android workspace (v0.8.4)

A full-screen stage with thumb tools, a frame dock and on-demand Rig, Pose, Clips, Tools and Timeline sheets. Drag controls to pose, empty space to orbit, and use two fingers to pan and pinch without a mode switch. Pen input rejects simultaneous touch contacts. Idle rendering stops, hidden editors unmount, camera preview is optional, skeletal matrix work is reduced, and drawing resolution follows a tablet budget. Recording remains independent at 60 fps.

## Android app and project updates (v0.8.3)

App updates are checked automatically and downloaded on Wi-Fi, with Android confirmation for installation. Open a private project directly from Google Drive in Android’s file picker to follow revisions; unsaved local edits are preserved. See [ANDROID.md](ANDROID.md).

## Source-reference retargeting (v0.8.1)

Reconstructed actions can carry their source skeleton independently of the preview model. Camera-centered arms no longer bake a second camera-height offset into Manny. Preview models retain their own bone lengths, while first-person weapon and magazine motion stays in the authored camera space. Manny’s additional twist joints receive its native roll distribution when the source only has one twist joint. The reload example includes this reference and remains editable with IK and sparse curves. Legacy actions without a source reference keep their existing evaluation.

## Standalone Android tablet app (v0.8.0)

The Android APK bundles the editor, renderer and reference assets and runs offline. Open and save portable `.pose` projects with the Android document picker. Imported assets and recovery copies stay on the device. Tablet controls include Pose / Navigate, pen and touch posing, collapsible side panels and an expandable timeline. Recordings export at 60 fps with a loop count. See [ANDROID.md](ANDROID.md) for installation, controls, format support and build instructions.

## Pose project files (v0.7.7)

Save projects as **.pose** files. Launch the portable Windows app once to associate this extension with Pose; then double-click a project to open it. Files open in the existing editor when it is running, and unsaved changes are protected by Save / Don't Save / Cancel. Existing .json and .manny.json projects remain supported through Open project; saving them creates a .pose file. The document and embedded assets are unchanged internally.

## Source character fidelity (v0.7.6)

Imported arms retain their camera-relative skeleton origin and use arm length for motion scaling. Character setup can preserve imported skin weights, including mapped twist bones. Reconstructed IK actions can retain authored FK reference rotations and joint translations while keeping hand targets editable; the reference setting is saved with the action.

## Finger retargeting fix (v0.7.5)

Terminal finger joints now use their own bind axes when anatomically aligned, preventing the middle phalanx direction from introducing an extra fingertip curl when importing between different rest poses. Native target bone lengths remain unchanged.

## Sparse animation import (v0.7.4)

Use **Pose → Import animation**. Choose **Key detail** to fit editable Bezier curves within 0.1°, 0.25° or 0.5° rotation error and 0.2 mm control-position error. Constant channels keep one key. Baked source files are reconstructed into sparse curves; their original authored key choices cannot be recovered. The source frame rate and full action length are retained by default.

For first-person files, choose **Source origin → Player camera** when the animation was authored around the camera, or **Scene / floor** for a scene-positioned character. Filenames marked FP are recognized automatically. Import preserves animated shoulder and wrist translations and converts limb reference orientations while keeping the preview character’s proportions.

## Shared Unreal skeleton (v0.7.3)

Open **Export to Unreal → Shared skeleton**. Export all animations or only the current one for Manny and every imported project character. Body, Arms and Legs meshes retain each character's bind pose and proportions. **Each source clip exports once**, into a common Animations folder; all meshes use the same Skeleton and AnimSequences. Imported characters need a complete humanoid mapping.

Run the generated **import_shared_unreal.py** in Unreal 5.6+ using **Tools → Execute Python Script**, with Python Editor Script Plugin enabled. It assigns one Skeleton, sets per-bone translation modes to preserve the playing mesh's lengths, and creates prop sockets. Use your normal Animation Blueprint. IK Retargeter assets and duplicate clips are not part of this workflow.

Props are static meshes attached to their named sockets. Main weapon and magazine drivers follow the right and left hands; their local animation includes releases and parent switches. Shared motion preserves proportions but does not reproduce the editor's character-specific IK: exact two-hand grips and planted feet can need gameplay IK for different limb lengths. See **UNREAL-SETUP.md**. Exported FBXs were reimported and visually inspected; the generated Unreal importer has not been run in-engine here.

The **Current animation** export remains available for individually baked actions.

## Animation workflows (v0.7.1)

Each animation is independent. A project can contain only first-person animations, only full-body animations, or any mixture. In **New animation**, choose First person or Full body and leave **Start from → Blank animation** selected. No counterpart is created automatically. To derive the other view, select an existing source in Start from. Source edits stay linked; the new animation has its own camera, exclusions and correction layers. Full-body sources transfer the solved arm pose, including IK/FK and attachments.

World pose layers keep explicitly edited control offsets uniform across contact changes. Moving a prop and a held hand together keeps the hand's offset when it releases. Untouched controls continue following their attachments. Attachment properties use a searchable parent picker, viewport eyedropper, and separate Position / Rotation buttons.

## Project assets

New projects start with an empty action and the Manny reference character. Your own assets can be imported using the cube button in the toolbar or **Pose → Project assets**. **Pose → Open Axe studio example** opens the sample as an ordinary editable project.

- **Character:** import a skinned humanoid FBX, GLB or glTF. Review the automatic bone mapping, visible mesh parts, facing and alignment in Character setup. Choose any imported character in Preview model; animation keys remain shared.
- **Prop:** import GLB, glTF, FBX, OBJ or Blender geometry. Each object gets its own named control, transform track and attachment settings. Control properties include mesh scale, pivot offset and rotation. Props can be added independently to a body action.
- **Animation:** import an action from FBX, GLB, glTF, Blender or BVH. Choose its skeleton, action, frame range, sample rate and bone mapping. Humanoid motion is transferred through bind orientations while keeping Manny's limb lengths. Imported motion becomes editable FK keys; clicking an IK control matches the current pose before switching modes.
- **Attachment:** choose any exposed bone/control or use the eyedropper in the viewport. World space and Root space are distinct. Follow position and Follow rotation can be keyed independently; switching keeps the current pose. Cycles are rejected.
- **Layers:** new static pose layers use World offsets. Set the default in Animation → Active layer, or override a bone in Control → Offset space. Local, Parent and World translations and rotations are available. Existing projects retain their previous offset space.
- **Leg controls:** selecting a dim thigh, shin or ankle controller activates FK and matches the current IK pose. Heel and ball pivots use the sole geometry instead of the ankle location.

Save project embeds character and prop GLBs with the animations. Reopening the file restores missing cache assets. Blender is only needed for conversion of non-GLB files, animation sampling and FBX export; the app detects an installed Blender or offers a file picker. It does not require Python scripts, edits to source code, or the example's original project folders. Character import expects a skinned humanoid; automatic skinning of an unrigged mesh is not part of this workflow.


A standalone Windows editor for the supplied 89-bone **Manny Simple** rig. This is the first animation-authoring build, with separate first-person and full-body animation.

## Open it

Double-click **Launch Manny Studio.cmd**, or open **windows-build/win-unpacked/Manny Animation Studio.exe**. Inside the portable folder, run Manny Animation Studio.exe directly. Keep the entire win-unpacked folder together. Editing works offline and does not require Node, a browser, or Blender to be open. FBX export uses an installed Blender; Blender 5.2.1 was detected and tested on this computer.

## Work with several animations

One project now holds an animation library and reusable poses. Click **+** above the viewport to create another animation. Right-click its tab → Rename, press F2, or double-click the tab to rename it. Click a tab to switch, or use **Ctrl Tab / Ctrl Shift Tab**. Double-click a tab to rename it. Each animation keeps its own playhead, selected control, rig, unkeyed drafts, frame rate, duration, and undo history while the app is open.

Right-click a tab → Duplicate to make a variation with both rigs and contacts intact. Closing a tab keeps the animation in **Animations**; open it again from that library. **Import animations…** adds clips from older single-animation files or entire projects without replacing your current work. **Open project…** replaces the library after confirmation.

**Ctrl S** saves every animation (including closed tabs) and saved pose into one .manny.json file. Autosave recovers the whole project. Existing v1/v2 files still open. Undo history and the temporary clipboard are kept only for the current app session. Export to Unreal offers the active animation export or a shared-skeleton package with all project animations and characters.

## Copy and reuse poses

- **Copy pose** above the viewport, or **Ctrl Shift C**, copies the active rig and its props. Switch animation tabs, choose a frame, and click **Paste** or press **Ctrl V**. Pasting inserts keys as one undoable edit, even with Auto key off.
- **Copy control** in the inspector, or **Ctrl C**, copies just the selected control. Select the destination control and paste to transfer its transform and grip.
- **Pose library** stores named poses in the project. Choose Whole rig + props or Selected control, name the pose, and click Save pose. Click a saved pose to apply it at the current frame.
- First-person rig poses paste into First person; body rig poses paste into Full body. Camera motion stays unchanged when applying a rig pose. Copy the Camera control explicitly to transfer it.
- Pasting matches the copied pose at that frame while preserving the destination attachment schedule. It does not copy a motion segment or contact changes. Check neighboring frames when blending into existing animation.

## Pose and animate

1. Choose **First person** for floating arms and player props, or **Full body** for the world character and its props. Each animation has its own tracks and contacts. Choose a linked source only when you want the other view to inherit motion.
2. Select a control in the viewport or the persistent Controls list. Shift-click adds to the selection. Drag the active control’s gizmo, or use G/R to move/rotate the selection. Exact transforms are always visible in the inspector.
3. Move to another frame and pose again. Auto key records edits. With Auto key off, press **I** or **K** before changing frames to keep the selected controls’ poses. Switching animation tabs retains unkeyed drafts.
4. Change **Following** to attach a hand or prop. The switch preserves its pose when created. Use Release for free movement.
5. Drag timeline diamonds to adjust timing. Space plays/pauses; Ctrl Z / Ctrl Y undo/redo the active animation. Curves show the evaluated channels; interpolation can be Smooth, Linear, Stepped, Spring, or Bounce.
6. Save your project, then use Export to Unreal for the current animation or the shared-skeleton package. Each export uses a new timestamped folder.

The player preview shows floating arms and player props following the camera, body legs following the world rig, and world-rig shadows. Use Camera → Look down to check the lower body. W/E/Q select Move/Rotate/Select; F focuses a control; MMB orbits, Shift MMB/right-drag pans, and wheel zooms.

## Transform orientation and pivot

The **Global** dropdown sets manipulation axes: Global, Local (active control), or View (screen axes). The neighboring pivot dropdown offers Median Point, Active Element, Individual Origins, Bounding Box Center and 3D Cursor. They affect gizmos and G/R transforms; they do not change animated attachment spaces. Press **,** for orientation or **.** for pivot. **Shift right-click** places the cursor on a plane through the orbit target, parallel to the view.

## Animation layers

Create a Full body action using a First-person base. In **Layers**, press **+ → Pose layer** for one editable pose offset across the entire action. Then add an **Adjustment layer** for keyed polish. Layers evaluate from the bottom upward; selecting a row routes new edits and timeline keys to that layer. Each adjustment supports weight, mute, solo, bone masks, duplicate, reorder and delete (undoable). Source motion and the body correction tracks remain intact.

The chain icon carries attached controls with their parent; disabling it allows independent corrections. A hand's own offsets remain editable with contacts enabled. Attachment switches can be keyed on the active body or adjustment layer. Their timeline keys can be moved, copied and deleted. The first-person source mask keeps head, camera and legs independent by default; use its mask to change inherited bones. Layers are saved in the project and evaluated into the exported motion.

The timeline spans the full window width. Drag the horizontal divider to resize it. Right-click a keyframe to edit interpolation, Bézier handles, Spring/Bounce settings, copy, paste or delete; an existing multi-key selection is retained. Symbols between keys identify outgoing interpolation, with a modifier dot and detailed hover information. The playhead has a frame badge in the ruler.

## Curve editor and cyclic animation

Open **Curves**, select a control and a channel, then click a key. Drag keys to change time/value; Shift-click selects several. Edit time/value numerically under Key & tangent. Double-click the graph or use + to insert a channel key. Delete removes selected channel keys; at least one key remains. These are independent scalar channels, so moving a Y key does not retime X or rotation. Moving a diamond in Timeline moves all channels keyed at that frame.

Use Bézier, Linear, Constant, Spring, or Bounce interpolation. Handles can be Auto clamped, Automatic, Flat, Vector, Aligned, or Free. Drag a handle to shape the tangent. Auto clamped avoids overshoot at local extrema. Automatic handles account for repeating curve neighbors when Cycles repeats on both sides. Wheel zooms time; Shift-wheel zooms values; Alt-drag pans; Fit frames the curve. Copy/paste buttons transfer selected curve keys, including handles; Ctrl C/V do the same while the graph has focus. Paste starts at the playhead and requires enough room before the animation end.

The **Modifiers** panel offers:

- **Cycles:** repeat, repeat with offset, or ping-pong before and after the first/last keys. Two distinct key times define the period. Cycles affects this channel, not attachment events.
- **Noise:** deterministic smooth variation with amplitude, period, phase, and seed.
- **Sine wave:** periodic motion with amplitude, frame period, and phase in degrees.
- **Scale / Offset:** scale the channel around zero and add an offset.
- **Limits:** clamp the result to minimum/maximum values.

Modifiers can be muted, removed, and reordered. Cycles is evaluated first; later modifiers use animation time. Noise added after Cycles is not automatically periodic. The dashed graph is the base curve; colored motion includes modifiers. Keys and handles edit the base curve. Bake channel to keys samples the complete animation at integer frames, removes the stack, and can be undone. FBX export also bakes the evaluated modifiers.

Position channels use centimeters; rotation channels use XYZ Euler degrees; finger channels use percent (−100% to 100%, equivalent to −1 to 1 in the Grip controls). Existing quaternion animation remains unchanged until rotation channels are edited; editing a rotation channel creates unwrapped XYZ channels together. Euler rotation can still encounter gimbal lock. Finger values and camera FOV are constrained to their valid ranges. Limits and a zero Scale factor can prevent a viewport edit from reaching a requested value.

Use **Loop** beside the frame counter to toggle repeat playback. Its arrow opens start/end settings and a seam check for both rigs. The duration is end minus start frame intervals; the closing frame is not held twice in preview. **Match end pose to start** keys the needed endpoint changes on both rigs, including camera and props, while leaving modifiers/contacts active. It matches poses, not every velocity; inspect the join and adjust tangents. Already-matching cyclic channels keep their source period.

Choose **Export loop range only** to bake just that range, normalized to frame 0 with the closing sample included. Camera/contact sidecar times are also normalized; sourceRange records the original range. The included project.manny.json remains the complete source animation. Unreal playback/loop settings still need to be configured in your project.

Open **examples/Cyclic idle.manny.json** for a small curve example: a 24-frame vertical cycle plus sinusoidal sway and rotation on the player prop. Its full-body rig remains independently editable.

## First-person setup

The first-person rig is independently posed and follows camera motion as a whole. Its arms and props do not cast world shadows. The full-body rig supplies third-person animation and shadows. A masked legs mesh uses that body's skeleton and pose. Changing first-person hands does not alter the body. Body animation must be authored separately to suit the action; synchronization means shared timing, not automatic pose generation.

See **UNREAL-SETUP.md** for the exported components and visibility setup. The example project and export are in **examples/**.

## Current scope

- Humanoid retargeting supports FBX, GLB and glTF characters with one skinned armature. Bone matches can be corrected manually. Quadrupeds, facial retargeting, physics and automatic collision avoidance are not supported.
- Built-in training rifle/magazine and the axe from the supplied animation reference. General custom prop import is a next step.
- 79 animator controls: matched arm/leg IK and FK, elbow/knee poles, spine/neck/shoulder offsets, three joints per finger, palm controls, toe and heel/ball pivots, root, camera and props. Unreachable IK targets clamp at limb reach.
- Keyed transforms, contacts, camera motion, FOV, timing, undo/redo, project files, and FBX export.
- Editable channel curves, Bézier handles, modifier stacks, cyclic preview/export, IK/FK matching and body-root-motion preparation are available. Animation layers and keyed parent following are available. Collision-aware grips, stretch, spline-spine constraints and floor contacts are not implemented.
- The reload exercise demonstrates contacts and synchronized tracks; it is not a finished game animation.

The v0.5 UI/export exercise was checked across all 25 samples in all seven FBX assets, including FK, finger joints, signed curl, spring/bounce and root motion. Maximum deformation-matrix error after Blender reimport was below 0.000018. Sixty automated checks also passed. **Import into an Unreal project has not yet been verified.** This build uses the supplied Manny Simple bind skeleton, not the full Manny corrective-bone rig.

## Source and rebuild

The source is included here. From this folder: npm install, npm run build, npm start. npm test runs the animation and rig checks. Close the app before running npm run package to rebuild the Windows directory package. The editor uses React/Three.js inside Electron and a local Blender export process. No supplied add-on scripts or AI executables are run by the app.

Manny mesh, bind skeleton and controller-shape geometry were prepared from the user's mr_mannequins_tools.zip → templates/library/Manny.blend, with script execution disabled. The supplied Manny material graph is converted to portable PBR textures, including paint, roughness, metalness, normal detail, occlusion and the chest logo. The other supplied archives are retained at their original locations and have not been integrated into this first build.

Curve modifier reference: https://docs.blender.org/manual/en/5.1/editors/graph_editor/fcurves/modifiers.html . This app implements its own evaluator and the supported subset described above.

## Root control (v0.4)

Select **Root** in the control list or its timeline row. The gold ground ring selects it in the viewport. **W** moves it, **E** rotates it, and **K** keys it. Position and rotation are at the top of its inspector. Root has the same editable curves, modifiers, key timing, undo and pose copying as other controls.

- **Full body**: root moves Manny, IK targets, feet and world props together. The camera follows that movement for the first-person preview. Hips remains a separate body-pose control.
- **First person**: its independent root moves the floating arms and player props relative to the camera. It is pose animation, not the actor's movement source.
- A released hand or prop is free within that rig's root space. It still follows the master root; this build does not offer a separate world-locked target mode.
- Whole-rig pose copies include the root. Root starts at zero for older files, preserving their existing poses.
- For traveling cyclic motion, use a Cycles modifier with Repeat Offset on the root position channel. Matching the loop endpoints instead closes the displacement.

**Prepare body root motion for Unreal** in Export normalizes the body to the first exported root pose and removes body-root movement from world prop tracks. Enable Root Motion on the body animation in Unreal (Ref Pose root lock); leave it off on floating arms and props. Without that export option, body and prop tracks keep the authored displacement and use no extraction. See UNREAL-SETUP.md.

The viewport uses 10 cm minor lines, 1 m major lines and thicker cross marks at major grid intersections, with Unreal X/Y/Z orientation colors. Its neutral dark lighting follows the supplied reference; Manny now uses its supplied textured materials. The rifle is still the procedural training prop; the reference's detailed rifle asset is not included.

## Rig controls and visibility (v0.5)

The controller shapes come from the supplied Mr Mannequins Manny template. The runtime preserves the original 89 deform/helper bones and implements a focused 79-control authoring rig; it does not run the template’s full 247-bone Blender constraint stack. Controls use plain colored lines without dark outlines. Left is cyan, right is coral, central controls are gold, and props are green. Selection and hover brighten the lines; picking has an independent 11-pixel margin.

All controls for the active rig appear in the left Controls panel (54 in First person, 78 in Full body). Search by name; use each eye to toggle its visibility. Show all and Hide all affect the active rig. Visibility is an editor preference, not an animation channel. Inactive IK/FK controls remain visible but faint and cannot be picked in the viewport.

Select an arm or leg control and choose IK or FK in the inspector. Switching matches the current pose, keys the target controls and records a stepped mode change at that frame. Whole-rig pose copies include the mode. The full body and floating arms keep separate mode schedules. FK wrist rotation and all finger joints remain independently editable.

Grip Curl, Thumb and individual finger sliders accept **−1 to 1**, with editable numeric fields. Zero is the supplied rest pose, positive values curl inward, and negative values bend outward. Both mirrored hands use the original joints’ local bend axes. Negative values are supported by pose libraries, animation keys, curve evaluation and FBX export.

## Spring and bounce

Choose Between keys in the inspector for a whole control, or choose a key’s outgoing Interpolation in Curves for one segment. Spring provides oscillations, damping and strength. Bounce provides bounce count, height, decay and impact time. Both offer Ease in, Ease out and In / Out, a response preview, and Reset. The next key is reached exactly; spring can overshoot between keys. Grip and FOV remain bounded. These are deterministic interpolation functions, not physics or collision simulation. Export bakes the evaluated result.

## Keyboard workflow

| Shortcut | Action |
|---|---|
| A / Alt A | Select all visible active controls / clear selection |
| Shift-click / Ctrl I | Toggle one control / invert selection |
| G / R | Move / rotate the selection |
| X, Y, Z during a transform | Constrain to an Unreal world axis; Z is up |
| Type a number, Enter | Confirm centimeters or degrees |
| Esc / right-click | Cancel the running transform |
| Alt G / Alt R | Reset selected locations / rotations in one undo step |
| H / Shift H / Alt H | Hide selected / hide others / reveal all |
| I or K | Key selected controls |
| Space / arrows | Play-pause / step a frame |
| Shift arrows | First or last frame |
| F or Numpad decimal / Home | Focus the active control / frame the rig |
| Ctrl Z / Ctrl Shift Z | Undo / redo |
| Ctrl C / Ctrl V / Ctrl Shift C | Copy active control / paste pose / copy whole rig |
| Ctrl S / Ctrl N / Ctrl Tab | Save / new animation / next animation tab |

When the curve graph has focus, A/Alt A select/clear curve keys; G moves keys, X constrains time and Y constrains value; numbers and Enter confirm; Esc cancels. Ctrl C/V copy and paste curve keys. Home/F fits the curve. Text fields and dialogs retain normal typing shortcuts. Scale authoring is not supported, so S/Alt S are not assigned.

Open **examples/Rig and motion exercise.manny.json** to inspect the new rig, FK arm, spring shoulder and bouncing finger-joint curves. It is a technical exercise, not a finished action.

## Axe equip and idle reference

Open **examples/Axe equip and idle.manny.json**. Axe · Equip runs from 0–20 and Axe · Idle from 0–80, at 24 fps. The source is the user's D:/Projects/FirstPersonAnims/UE5_Arms_Axe.blend, which is not modified.

Idle uses only key times 0 and 80. Its weapon has seven editable Blender noise modifiers: three position and four quaternion channels. Both hands follow the axe through IK and prop attachments. Muting all seven noise modifiers holds the pose. Strength, scale, phase, offset, depth, roughness, lacunarity, restricted range, and blend-in/out remain editable in Curves → Modifiers. Position strengths are shown in centimeters; Blender's source used meters.

Equip's weapon retains the original keys at 0, 6, 13, 14, and 20, including the original Bezier handles. The left hand keeps keys 0, 10, 12, and 13 and attaches at 13. Shoulder, finger and camera poses are converted at sparse authored times. Native quaternion curves are visible in the curve editor, and native Euler curves preserve Blender's rotation order. No per-frame authoring data is hidden in either project.

The procedural weapon curves match Blender's evaluator to within 0.0000002 in source units at quarter frames. Hands match within 0.019 mm over both clips. The supported Manny IK and sparse finger conversion introduce small differences from the full Auto-Rig Pro solver: up to 2.84 mm at Equip's elbows and 3.21 mm at fingertips (2.45 degrees at the worst finger orientation). Idle fingertip positions differ by under 0.004 mm. Camera position differs by at most 0.014 mm. The source camera's 110° horizontal FOV is 77.552° vertical at 16:9; Studio stores vertical FOV.

First-person and full-body animations can now be separate linked actions. Body correction keys remain separate from the inherited first-person base. The example body companion is a starting point for body posing, rather than a separately polished third-person performance. Full Manny corrective deformers are absent from the Simple mesh. The axe uses a neutral studio material.

FBX export samples the evaluated motion for Unreal while the editable project keeps its sparse keys and modifiers. Axe exports include FP_Axe.fbx and World_Axe.fbx, without rifle or magazine assets. Ready exports are in **examples/Axe exports/**. Unreal import and gameplay remain unverified.

Validation: 70 automated tests pass. Electron UI checks verified sparse key counts, quaternion channels, editable/mutable noise, undo, invalid settings, and autosave/reopen. Both clips exported successfully; all ten FBX assets were reimported in Blender and checked at every sample, with maximum matrix error under 0.000016.

## v0.5.3 — animation workspace

- **Panel sizes:** drag the dividers above the timeline and beside either sidebar. Sizes persist between sessions. Double-click a divider to reset it; focused dividers support arrow keys. Timeline defaults to 200 px; Curves retains a 240 px minimum for a usable graph.
- **Insert Keyframe:** I or K opens the menu beside the pointer. Choose Available, Location, Rotation, Location & Rotation, Custom Properties, All Channels, or Whole Rig. Arrow keys/Enter and the displayed letter shortcuts work. Channel-only insertion leaves other channels and pending edits intact. Whole Rig keys active rig controls and props; camera is keyed separately. Scale is not implemented by this rig. Keying choices follow Blender's [keying-set workflow](https://docs.blender.org/manual/en/latest/animation/keyframes/keying_sets.html).
- **Recent Projects:** Animation Studio → Recent projects lists the last 12 opened/saved files, including their paths. Reopening preserves the existing Open Project choice to save the current library first. Clearing the list does not delete files.
- **Manny materials:** the supplied material slots and texture detail are used consistently on floating arms, body and legs. Mesh exports include PBR texture files. Source geometry, UVs and skin weights are unchanged. The original archive and source blend are untouched.
- **Full-body actions:** New → Full body → choose a first-person base. The first-person action's native curves and modifiers drive the base live; the body action stores additive correction keys and has its own timing and undo history. Source frames are sampled by time (FPS conversion), holding the final pose after the source ends. Opening a linked action or saving refreshes the portable source cache; it also works when opened without its source library.
- **Bone exclusions:** Head, neck and legs start excluded. Exclude bones in the inspector to change inheritance for body bones and limb/finger groups. Excluded controls remain editable in the body action. Camera transforms are not mapped to the head. Moving a body prop retains inherited hand contact. Changing the source preserves body corrections. Old combined projects remain readable; Copy existing body track in the new-action dialog preserves their earlier body animation as its own action.
- **Axe contact:** the frame-13 parent change now interpolates toward an endpoint expressed in the incoming coordinate space. The former approximately 20 cm snap is removed without adding authored keys. This deliberately improves on the supplied blend's subframe discontinuity; the earlier source-comparison metrics do not describe this corrected interval. Idle remains two key times plus editable noise.
- **Export:** export each action separately. First-person actions write arms and player props; full-body actions write body, optional legs, and world props. Both include the editable project and timing/contact metadata.

Open **examples/Axe first person and body.manny.json** for Equip and Idle with separate body companions. The original two-action example remains available.

Verification: core regression suite, desktop interaction tests at 1560×1000 and 1024×720, and ten FBX re-import checks across Equip/Idle arms, body, legs and props. Unreal editor integration remains a separate engine-side check.

## Selection and timing (v0.5.4)

- Timeline: drag an empty area or press B to box-select keys. Shift adds; Ctrl subtracts. The All controls row selects the entire rig at the enclosed times.
- Drag selected diamonds together, use G followed by a frame offset and Enter, or nudge with the arrow keys (Shift: 10 frames). Escape cancels. A selects all keys; Alt+A clears.
- Ctrl+C copies selected keys. Switch animation tabs, place the playhead, move the pointer over the timeline, and Ctrl+V pastes with the earliest copied key aligned to the playhead. Keys keep their spacing, easing, and handles; existing destination curve modifiers remain in place. Pastes that exceed the action range are rejected with a message.
- Copy and paste stay on the same rig layer. Fresh controls can adopt imported authoring spaces; conflicting already-animated rig spaces are rejected to protect existing animation. Duplicate the source animation when retaining that imported space is needed.
- Viewport: left-drag or B box-selects controls. Shift adds, Ctrl subtracts. G/R transform the selected controls. MMB orbits; Shift+MMB pans; wheel zooms. During G/R, point along an axis and press MMB to lock it; Enter or left-click confirms, Escape/right-click cancels.
- Old Axe imports with untouched zero knee-pole targets are repaired automatically on load. Edited poles and body correction keys are preserved.

The editor now uses dark charcoal surfaces, rig-colored timeline lanes, compact icon toolbars, and matching 6 px scrollbars. The control tree is the single picker; the inspector shows the active control. World/Local in the top toolbar changes gizmo and G/R axes only. It does not key, reparent, or change the control's animation space. Alt+G and Alt+R work from transform number fields and clear imported local offsets correctly; on body overlays they clear the correction back to the base pose.

Panel resizing keeps the same scene, camera, and WebGL context. Drawing-buffer changes happen together with rendering, avoiding blank frames during a drag; panel sizes restore on the next launch. Dialog blur and dimming begin below the title bar, leaving the window buttons available.

## Viewport and numeric fields (0.5.5)

**Numpad 0** toggles the full player-camera view. Controls remain visible and selectable, and gizmos/G/R use the camera perspective. Press it again for the previous orbit view; MMB also returns to orbit.

Drag number fields to adjust them. Shift gives fine increments, Ctrl snaps to the field step, Escape cancels the drag, and one undo restores the starting value. Click a field to type a value and press Enter to finish.

The clapperboard icon toggles **Cinematic view** for the scene, player-camera preview and full player-camera view together. It combines denoised ambient occlusion, roughness-aware screen-space reflections over the studio environment lighting, 4× MSAA (where supported) and SMAA. The preference persists across launches. The floor is one physical mesh with an antialiased procedural grid, so grid lines never occlude or reflect the floor. Reflections fade near screen edges; geometry outside the camera frame uses environment lighting. Rig controls render separately and remain editable in both modes.

Both shoulder controls support Move/G as well as Rotate/R, including body-pose and adjustment layers. Floating-arm placement offsets remain separate from the animation keys.

## Editing and preview refinements (0.5.6)

The inspector has separate **Control** and **Animation** contexts, collapsible sections, colored layer types and aligned fields. In Animation, expand **Source bone exclusions** to exclude individual controls, including either shoulder; group checkboxes remain shortcuts. **Layer bone mask** controls the active adjustment independently. Body/Layer offset numbers show only the active layer, so Alt+G and Alt+R clear its location/rotation to zero without removing inherited motion.

Timeline tracks form a collapsible parent hierarchy. Collapsed rows summarize their descendants, including key selection, move and copy. Hollow violet diamonds show authored first-person source keys behind body-layer keys. The ghost icon toggles them. Reference times follow frame-rate conversion and source exclusions; they remain read-only.

Numpad 0 fills the entire scene panel with the player camera; the small inset remains 16:9. **Game View** (gamepad icon, Shift+G) hides rig controls, gizmos, trails, camera inset and labels. The floor and grid stay visible. G retains Blender-style Move. Cinematic shading works in both views. The floor has even dark shading, gently fading grid lines, a matched studio horizon, and tighter contact shadows. Manny shading filters high-frequency specular highlights.

Closing the window or opening a replacement project prompts **Save / Don't Save / Cancel** when the file has unsaved changes. Canceling or failing a save keeps the editor open. The recovery copy is maintained separately; it does not count as saving to a project file. Changing frames, selection, tabs or the active layer alone does not mark a saved project dirty.

## Video recordings

Click the video icon beside Export to Unreal. Choose the player or scene camera, resolution, whole animation or loop range, and a loop count (1–100). MP4 and WebM recordings always sample motion at **60 fps**, independently of the timeline frame rate, while preserving animation speed and duration. The current Standard/Cinematic shading is used. Floor and grid remain visible; controls and editor overlays are hidden. The exporter writes every frame, supports cancellation, and restores your working view and playhead. Key any unkeyed edits before exporting.

## Independent bone following

In a full-body action, select a bone control and open **Parent following**. **Follow position** and **Follow rotation** are independent, keyed switches on the active layer. Turn off rotation to keep the head oriented independently while its position follows the body. Turn off position and leave rotation on to hold its world position while rotating with the body. Switching preserves the current pose; you can still animate the bone itself. Turn a channel back on to resume parent following without snapping. Following keys appear in the timeline and support moving, copying, deletion, undo and project saving. For FK limb bones, select FK mode before using their controls.


## Shared preview models (0.6.1)

Use **Preview model** in the animation toolbar to switch between **Manny**, **Male**, and **Female**. Keep using the normal rig controls, actions, layers, timeline and player camera. Switching models keeps the current animation and frame; it does not rewrite animation keys.

Imported meshes are rebound to Manny's 89 bone names, axes and hierarchy, with each character's own anatomical rest positions. The male keeps its wider shoulders and shorter hips; limb reach comes from each model's limb lengths. Root motion and foot motion adapt to the character, while props keep their physical size. Contacts are solved against those props, with a short transition around grip/release boundaries to prevent proportion-related snaps.

The setup icon beside the model selector opens **Character setup**. Import another FBX / GLB / glTF humanoid, correct bone matches, choose outfit parts, or adjust the reference pose. FBX and glTF conversion use the selected Blender installation. Existing mappings from 0.6.0 are retained.

- **Bones:** match the imported rig to Manny. Missing required bones block binding/export; optional spine, neck, palm, twist and helper bones are supplied by the compatible hierarchy.
- **Parts:** choose the visible pieces. The same pieces are used in the viewport, recording and export.
- **Alignment:** correct scale/facing or an unusual A/T pose. Arm reach adapts from the character's shoulders; foot placement starts from its own stance. FK limbs retain their keyed rotations.
- **Export preview model:** writes the selected mesh and its compatible Manny hierarchy to FBX or GLB, with the current action baked at its animation frame rate. Prop meshes are not included in this character export.
- **Export recording:** records the selected model from either the scene or player camera at 60 fps, with the chosen loop count.

Character assets, mappings and parts are embedded when saving a project. The selected preview model is restored when reopening. The two bundled examples come from the user-supplied Polygonal Fantasy Pack; their original asset license still applies. Unusual anatomy may need manual mapping or pose corrections. Direct import into an Unreal project has not been verified.

## Retarget deformation corrections (0.6.2)

Imported torso landmarks retain their native alignment. The original mesh stays in its bind pose, with per-bone rest-pose offsets in the skin binding. Existing forearm weights blend across Manny twist deformers to spread wrist rotation. Prop contacts account for the character’s hand size, and floating first-person arms exclude shoulder caps. Existing character profiles receive these corrections automatically.
