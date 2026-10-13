# Shared animation export verification — v0.7.3

- Full regression suite: 202 tests passed across 37 files. Added a staging regression afterward; all 6 targeted export tests passed (203 tests total in the suite). TypeScript/Vite production build passed.
- Real desktop export of the saved Axe project: 3 animation FBXs total, 9 Body/Arms/Legs mesh FBXs, 1 static axe, textures, manifest and importer. No per-character animation folders or renderer errors.
- All 9 meshes use the same 90-bone hierarchy. Native inverse binds are retained. The prop driver is a child of hand_r and its socket uses an identity transform.
- Blender 5.2.1 reimport: maximum rest mesh deviation 0.00043 mm. Each of the 3 shared clips was evaluated on all 3 meshes at 4 frames (36 samples), applying the manifest's per-mesh translation policy. Maximum skinned geometry GLB-to-FBX deviation: 0.0180 mm; maximum sampled bone error: 0.0085 mm.
- Visually inspected Manny, Fantasy male and Female using the same exported body clip. Height, shoulder width and wrist shape stay distinct. Precise two-hand contact is not guaranteed by translation retargeting; the Unreal setup guidance calls out gameplay hand/foot IK.
- The native-bind translation invariant is tested for all bones on both imported example characters. The staging regression verifies one animation item per clip independently of character count and rejects the old character-plus-clip identity.
- Unreal Engine 5.8 is installed locally. The importer's actual in-engine execution, reflected BoneTree edits and gameplay remain unverified. It re-reads modes before completing and reports manual setup instructions if an engine build prevents updating them.

References: [same-Skeleton translation retargeting](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-retargeting-in-unreal-engine), [BoneNode](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/BoneNode?application_version=5.6), [translation modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/BoneTranslationRetargetingMode?application_version=5.6).
