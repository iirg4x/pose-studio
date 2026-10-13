# Unreal setup

## Shared skeleton export — UE 5.6+

1. In Pose choose **Export to Unreal → Shared skeleton**, choose All or Current animations, and select a destination folder.
2. Enable **Python Editor Script Plugin** and **Editor Scripting Utilities**. Use **Tools → Execute Python Script** to run the generated **import_shared_unreal.py**. No script changes are needed. The generated UNREAL-IMPORT.txt also contains manual steps.
3. Every character's Body, Arms and Legs use one **SKEL_PoseShared** asset. Each mesh retains its own skin bind pose and proportions. The export creates a new shared Skeleton, rather than replacing a stock Unreal asset.
4. **Animations/** contains one FBX per source clip. Use the same imported AnimSequences and normal Animation Blueprint on every character. No IK Retargeters or extra animated source meshes are required.
5. The importer configures translation modes on the shared Skeleton: **Skeleton** for fixed bone lengths, **AnimationScaled** for pelvis height, **OrientAndScale** for authored offsets, and **Animation** for root/IK/prop drivers. The manifest lists every bone. Leave **Update Skeleton Reference Pose** and **Use T0 As Ref Pose** off; preserve local transforms and exported frame rates when importing animation. Forcing all bones to Animation would stretch meshes to the source proportions.
6. Attach static props to their manifest sockets using **Snap to Target** (location and rotation), with unit relative scale. The main weapon follows the right hand, the magazine follows the left hand, and custom prop slots use root space. Their animated driver transforms include authored releases. Each clip lists its prop assets.
7. Body and Legs can share a full-body clip. Arms can play a separate first-person clip on another component. FP-only, body-only and mixed projects do not need companion actions.

Shared local rotations preserve each mesh's proportions, but different limb lengths change end-effector positions. For exact two-hand prop contact or planted feet, use gameplay IK in the Animation Blueprint. This export does not bake the editor's per-character IK solutions into duplicate clips.

The package includes textures, mesh reference poses, clip timing, prop bindings and translation modes. Blender reimport checks cover all nine meshes and each shared clip on all three example characters. Unreal Engine 5.8 is installed locally; this shared-export importer has not yet been run in-engine, so actual engine import and gameplay remain unverified. The importer re-reads translation modes and stops with manual setup instructions if the engine prevents updating them.

Epic documents [sharing animation on the same Skeleton with different proportions](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-retargeting-in-unreal-engine) and the [translation mode API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/BoneTranslationRetargetingMode?application_version=5.6).

## Current animation export

The remaining sections describe the existing **Current animation** export. Its props use separate animated FBXs; the shared-skeleton option above uses static props and sockets.

Export the first-person action for player arms/props, then its separate full-body companion for body/legs/world props. Each export includes only the selected action type. Test them in a fresh content folder before connecting existing animations. The engine-side import and Blueprint setup remain to be validated in your Unreal project.

## Files

| File | Purpose |
|---|---|
| Manny_FP_Arms.fbx | Floating arms, with their independent animation |
| Manny_Body.fbx | Complete character, third-person animation, and world shadows |
| Manny_Legs.fbx | Player-visible lower body; included when meshes are exported |
| FP_Rifle.fbx / FP_Magazine.fbx | Camera-relative player props |
| World_Rifle.fbx / World_Magazine.fbx | World props for third person and shadows |
| camera-and-contacts.json | Camera samples, contacts, coordinate metadata, and component settings |
| project.manny.json | Editable studio project |

## First import

Import the body with Import Animations enabled. For the first validation, leave Skeleton unset to create a skeleton from this supplied 89-bone Manny Simple asset. Arms and legs use that same bind hierarchy; select the matching imported skeleton. Each prop uses a separate one-bone skeleton. Later, export with Include meshes disabled and import animation onto the matching assets.

Keep scale and axis options consistent for every file. The exporter writes an X-forward, Z-up FBX profile with unit metadata. Start by checking Convert Scene, Convert Scene Unit, and Force Front XAxis in your importer, then verify character height, forward direction, hand alignment, and the first and last frames. Do not assume the stock full-Manny skeleton is identical simply because the bone names overlap. Epic documents these conversion options in the [FBX import reference](https://dev.epicgames.com/documentation/unreal-engine/fbx-import-options-reference-in-unreal-engine).

## Character components

- **Floating arms:** parent to the player camera; Only Owner See; disable Cast Shadow. The authored neutral component offset is (0, 0, -165) cm in the intended UE frame, with zero relative rotation. Verify this offset after your axis conversion.
- **Player rifle and magazine:** parent to the same camera with the same offset. Their root bones contain their baked animated placement. Attaching them again to animated hand sockets would apply motion twice.
- **Full body:** actor-relative; Owner No See for the local player; enable Cast Shadow and Cast Hidden Shadow. Show this mesh to other players and third-person cameras.
- **Legs:** Only Owner See; disable duplicate shadow casting. Follow the full body's pose using Copy Pose From Mesh or an appropriate Leader Pose setup.
- **World props:** actor-relative with the same origin as the body. Their baked root motion already contains placement. Hide from the owning player, but retain their world shadows as appropriate.

Play the two character clips and four prop clips from the same time at the same play rate. The authoring sample contains frames 0–96 at 24 fps. The body action can use the first-person action as a live base, with independent correction keys and bone exclusions. Match their FPS/play rates by time.

For Unreal versions with the newer first-person rendering path, use FirstPerson for player arms/props and WorldSpaceRepresentation for the full body/world props. Keep player-visible legs in world space. Epic describes this separation in [First Person Rendering](https://dev.epicgames.com/documentation/unreal-engine/first-person-rendering?lang=en-US). The conventional two-mesh setup is also covered in [Implementing your Character](https://dev.epicgames.com/documentation/unreal-engine/implementing-your-character-in-unreal-engine).

## Camera and contacts

The JSON sidecar is data, not an Unreal importer. It includes camera location in centimeters plus forward/up vectors suitable for constructing an Unreal rotation, FOV, and per-rig contact events. Camera automation, AnimNotifies, Blueprint creation, separate weapon-FOV rendering, and engine wall-clipping handling are not installed by this build.

## Body root motion

The Root control animates the existing Manny root bone. Hips only poses the pelvis. Root tracks are separate for the full body and floating arms.

For animation-driven actor movement, select **Prepare body root motion for Unreal** when exporting. The first exported body root pose is rebased to the origin, including when exporting a loop range. Body and legs contain the normalized root displacement. World rifle and magazine tracks have the body's root transform removed, so they can follow the moving actor without applying displacement twice. Keep them on the actor/component origin with the same skeletal-mesh basis; do not attach their baked roots to an animated hand socket.

Enable **Enable Root Motion** on Manny_Body's animation and use **Root Motion Root Lock: Ref Pose**. Configure the Animation Blueprint's Root Motion Mode for the way you play animations or montages. Use the Body pose for owner-visible legs. Floating arms and all prop animation sequences must have root extraction disabled. The player camera follows the actor at runtime; its exported camera data stays actor-relative.

With the export option off, all root displacement stays in the body and world-prop bones. Leave Unreal extraction off for that export. Do not mix a body from one mode with props from the other. The sidecar records the mode, root settings and per-frame body root matrices.

The editor preview shows authored displacement. Unreal character movement and collision can alter it at runtime, especially vertical movement in Walking mode. No Unreal project import or gameplay test has been performed. The generated FBXs were independently reimported in Blender and their transforms compared at every sample.

Epic reference: https://dev.epicgames.com/documentation/en-us/unreal-engine/root-motion-in-unreal-engine

## Manny materials

Mesh exports include Textures/ containing the supplied Manny shader flattened to PBR maps, with embedded FBX image references. In Unreal, use the corresponding existing Manny material instances when importing onto the stock asset; FBX cannot reproduce an Unreal material graph. The studio viewport restores the supplied material appearance on all three mesh representations.
