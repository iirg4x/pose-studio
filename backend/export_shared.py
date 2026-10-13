"""Write a shared Unreal skeleton package from the exact preview skins/poses."""
import bpy, json, sys, os, re, math, shutil
from mathutils import Matrix, Vector, Euler

stage, destination = sys.argv[sys.argv.index('--') + 1:][:2]
with open(os.path.join(stage, 'plan.json'), encoding='utf-8') as f:
    plan = json.load(f)
files, characters, animations, props, hierarchy = [], [], [], [], None
reference_local, translated = {}, set()

def safe(value):
    return re.sub(r'[^a-zA-Z0-9_-]+', '_', value)[:60] or 'Asset'

def load(filename, fps=30):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 0.01
    bpy.context.scene.render.fps = fps
    bpy.context.scene.render.fps_base = 1
    # Fixed bone axes keep prop sockets consistent across characters and clips.
    bpy.ops.import_scene.gltf(filepath=filename, bone_heuristic='BLENDER', guess_original_bind_pose=True)
    rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(rigs) != 1:
        raise RuntimeError('Expected one shared armature: ' + filename)
    rig = rigs[0]
    rig.name = 'Armature'
    return rig

def check(rig):
    global hierarchy
    actual = [{'name': b.name, 'parent': b.parent.name if b.parent else None} for b in rig.data.bones]
    if hierarchy is None:
        hierarchy = actual
        if len([b for b in actual if b['parent'] is None]) != 1 or actual[0]['name'] != 'root':
            raise RuntimeError('The shared skeleton must have one root bone.')
    elif actual != hierarchy:
        raise RuntimeError('Skeleton hierarchy changed between export items.')
    for socket in plan['sockets']:
        if socket['bone'] not in rig.data.bones:
            raise RuntimeError('Missing prop attachment bone: ' + socket['bone'])

def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

def textures(prefix):
    for image in bpy.data.images:
        if image.type != 'IMAGE':
            continue
        relative = 'Textures/' + prefix + '_' + safe(image.name) + '.png'
        filename = os.path.join(destination, relative)
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        image.filepath_raw = filename
        image.file_format = 'PNG'
        image.save()
        if relative not in files:
            files.append(relative)

def export(relative, objects, animation=False):
    filename = os.path.join(destination, relative)
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    select(objects)
    bpy.ops.export_scene.fbx(filepath=filename, use_selection=True,
        object_types={'ARMATURE', 'MESH'}, global_scale=1.0,
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS',
        axis_forward='X', axis_up='Z', use_space_transform=True,
        bake_space_transform=False, add_leaf_bones=False,
        use_armature_deform_only=False, armature_nodetype='NULL',
        primary_bone_axis='Y', secondary_bone_axis='X',
        bake_anim=animation, bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False,
        bake_anim_force_startend_keying=True, bake_anim_step=1.0,
        bake_anim_simplify_factor=0.0, use_mesh_modifiers=True,
        mesh_smooth_type='FACE', path_mode='COPY', embed_textures=True)
    files.append(relative)

def joined(parts, name):
    select(parts)
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    return result

for ci, character in enumerate(plan['characters']):
    label = safe(character['name']) + '_' + str(ci)
    rig = load(os.path.join(stage, 'mesh_' + str(ci) + '.glb'))
    check(rig)
    textures(label)
    result = {'id': character['id'], 'name': character['name'], 'meshes': {}}
    # These are the imported inverse-bind transforms, not Manny's proportions
    # and not an arbitrary animation frame used as a reference pose.
    result['referencePose'] = {b.name: [v for row in (rig.matrix_world @ b.matrix_local) for v in row] for b in rig.data.bones}
    for variant, prefix in [('body', 'Body__'), ('arms', 'Arms__'), ('legs', 'Legs__')]:
        parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith(prefix)]
        if not parts:
            continue  # Partial characters export only the geometry they actually contain.
        mesh = joined(parts, 'SK_' + label + '_' + variant.title())
        relative = 'Characters/' + label + '/' + mesh.name + '.fbx'
        export(relative, [rig, mesh])
        result['meshes'][variant] = relative
    if ci == 0:
        reference_local = {b.name: (b.parent.matrix_local.inverted() @ b.matrix_local if b.parent else b.matrix_local.copy()).translation.copy() for b in rig.data.bones}
    characters.append(result)

# Each source clip is written once, independently of the character count.
for ai, clip in enumerate(plan['clips']):
    sample_rate = clip.get('sampleRate', clip['fps'])
    if not isinstance(sample_rate, int) or sample_rate < clip['fps'] or sample_rate > clip['fps'] * 64 or sample_rate % clip['fps']:
        raise RuntimeError('Invalid animation sample rate: ' + clip['name'])
    sample_end = clip['end'] * (sample_rate // clip['fps'])
    rig = load(os.path.join(stage, 'animation_' + str(ai) + '.glb'), sample_rate)
    check(rig)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, sample_end
    if not rig.animation_data or not rig.animation_data.action:
        raise RuntimeError('Baked animation is missing: ' + clip['name'])
    for frame in range(sample_end + 1):
        scene.frame_set(frame)
        for b in rig.pose.bones:
            local = b.parent.matrix.inverted() @ b.matrix if b.parent else b.matrix
            if (local.translation - reference_local[b.name]).length > 0.001:
                translated.add(b.name)
    scene.frame_set(0)
    relative = 'Animations/A_' + safe(clip['name']) + '_' + str(ai) + '.fbx'
    export(relative, [rig], True)
    animations.append({**clip, 'file': relative, 'preview': 'arms' if clip['type'] == 'firstPerson' else 'body'})

# Fixed lengths come from the playing mesh. Animated offsets keep their motion
# while adapting the source translation vector to that mesh's reference vector.
modes = {b['name']: ('ANIMATION' if b['name'] == 'root' or b['name'].startswith(('ik_', 'pose_prop_')) else 'ANIMATION_RELATIVE' if b['name'].startswith('clavicle_') else 'ANIMATION_SCALED' if b['name'] == 'pelvis' else 'ORIENT_AND_SCALE' if b['name'] in translated else 'SKELETON') for b in hierarchy}

# Prop geometry keeps its physical size and pivot. Motion is carried by the
# shared skeleton's animated attachment bone, so no prop skeletal mesh is made.
convert = Matrix.Rotation(math.pi / 2, 4, 'X')
for pi, prop in enumerate(plan['props']):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 0.01
    bpy.ops.import_scene.gltf(filepath=prop['file'])
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not parts:
        raise RuntimeError('Prop has no geometry: ' + prop['settings']['name'])
    settings = prop['settings']
    transform = convert @ Matrix.Translation(Vector(settings['offset']) * 100) @ Euler(tuple(math.radians(v) for v in settings['rotation']), 'ZYX').to_matrix().to_4x4() @ Matrix.Scale(settings['scale'], 4) @ convert.inverted()
    deps = bpy.context.evaluated_depsgraph_get()
    for part in parts:
        geometry = bpy.data.meshes.new_from_object(part.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
        # Blender's glTF bone basis adds +90 degrees around local X. Bake
        # its inverse into the static mesh so identity socket attachment is exact.
        geometry.transform(convert.inverted() @ transform @ part.matrix_world)
        part.data = geometry
        part.modifiers.clear()
        part.parent = None
        part.matrix_world = Matrix.Identity(4)
    label = safe(settings['name']) + '_' + str(pi)
    mesh = joined(parts, 'SM_' + label)
    textures(label)
    relative = 'Props/' + mesh.name + '.fbx'
    export(relative, [mesh])
    props.append({'id': prop['id'], 'name': settings['name'], 'file': relative})

for name in ['import_shared_unreal.py']:
    shutil.copyfile(os.path.join(os.path.dirname(__file__), name), os.path.join(destination, name))
    files.append(name)
readme = '''POSE — SHARED UNREAL SKELETON (UE 5.6+)

1. Enable Python Editor Script Plugin and Editor Scripting Utilities in Unreal.
2. Choose Tools > Execute Python Script and select import_shared_unreal.py.
   The script imports the meshes and one animation set, assigns one Skeleton,
   configures translation modes and creates prop sockets. No script edits.

Every character has Body, Arms and Legs meshes using the same bone hierarchy.
Each mesh keeps its own inverse bind pose, height and shoulder width.
Animations/ contains ONE file per source clip. Use these same AnimSequences
and your normal Animation Blueprint on every character. No IK Retargeter,
extra source component, or per-character copies are required.

Translation modes on the shared Skeleton preserve the playing mesh's lengths:
- Skeleton for bones with fixed local translations.
- AnimationScaled for the pelvis.
- AnimationRelative for clavicles: retain authored offsets without rotating
  them toward each mesh's different shoulder vector.
- OrientAndScale for authored translation offsets on other deform bones.
- Animation for root motion, IK markers and prop attachment bones.
The exact per-bone modes are in manifest.json (translationModes).

Body and Legs use full-body clips. Arms can play first-person clips.
Use separate Skeletal Mesh Components when arms and legs play different clips.
For first-person playback, attach the arms component to the player camera at
its authored placement.

Props are STATIC meshes. Attach the component to its manifest socket with
Snap to Target (location and rotation), unit relative scale. Each prop
socket has its own animated attachment bone under root. This preserves camera-
authored gun motion and magazine release without inheriting retargeted wrists. Each clip's props list identifies the mesh.
Bone-length adaptation shares motion, not exact end-effector positions: for
precise two-hand contact on differently proportioned arms, use hand IK in your
Animation Blueprint. Foot locking likewise belongs in your gameplay IK setup.

Manual import: import Manny Body first, then choose its Skeleton for every
other mesh and animation. Leave Update Skeleton Reference Pose and Use T0 As
Ref Pose OFF. Preserve Local Transform ON; use the exported sample rate.
In the Skeleton Tree enable Show Retargeting Options and set the modes listed
in manifest.json. Add each socket on its manifest bone at identity transform.
Do not recursively force Animation mode: that stretches meshes to Manny.

The importer verifies the shared Skeleton assignments and translation modes.
If your engine prevents writing modes, imported assets are retained; follow
the manual steps and rerun the script to verify and finish setup.
'''
with open(os.path.join(destination, 'UNREAL-IMPORT.txt'), 'w', encoding='utf-8') as f:
    f.write(readme)
files += ['UNREAL-IMPORT.txt', 'manifest.json']
manifest = {'version': 2, 'complete': True, 'name': plan['name'], 'skeleton': 'SKEL_PoseShared',
    'hierarchy': hierarchy, 'characters': characters, 'animations': animations, 'props': props,
    'translationModes': modes,
    'sockets': plan['sockets'], 'coordinateSystem': 'FBX X-forward Z-up; centimeters',
    'animationPolicy': 'one canonical animation set; per-mesh reference translations', 'files': files}
with open(os.path.join(destination, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print('SHARED_SKELETON_EXPORTED', len(characters), 'characters', len(files), 'files')
