"""Run with Unreal's Tools > Execute Python Script. No source edits required."""
import json, os, re
import unreal

ROOT = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8') as stream:
    DATA = json.load(stream)
if DATA.get('version') != 2 or not DATA.get('complete'):
    raise RuntimeError('This Pose export is incomplete. Export it again before importing.')
if DATA['sockets'] and not all(hasattr(unreal.SkeletalMesh, name) for name in ('add_socket', 'rename_socket', 'num_sockets', 'get_socket_by_index')):
    raise RuntimeError('This Unreal version does not expose automatic skeletal socket creation. Use the manual steps in UNREAL-IMPORT.txt, or a version with SkeletalMesh.add_socket (UE 5.6+).')

ASSETS = unreal.AssetToolsHelpers.get_asset_tools()
DEST = '/Game/PoseExports/' + re.sub(r'[^a-zA-Z0-9_]', '_', os.path.basename(ROOT))

def import_asset(relative, kind, skeleton=None, fps=30):
    filename = os.path.join(ROOT, relative)
    if not os.path.isfile(filename):
        raise RuntimeError('Missing export file: ' + relative)
    options = unreal.FbxImportUI()
    options.set_editor_property('automated_import_should_detect_type', False)
    options.set_editor_property('import_as_skeletal', kind != 'static')
    options.set_editor_property('import_mesh', kind != 'animation')
    options.set_editor_property('import_animations', kind == 'animation')
    options.set_editor_property('import_materials', kind != 'animation')
    options.set_editor_property('import_textures', kind != 'animation')
    options.set_editor_property('create_physics_asset', False)
    options.set_editor_property('skeleton', skeleton)
    options.set_editor_property('mesh_type_to_import', {'mesh': unreal.FBXImportType.FBXIT_SKELETAL_MESH, 'animation': unreal.FBXImportType.FBXIT_ANIMATION, 'static': unreal.FBXImportType.FBXIT_STATIC_MESH}[kind])
    # Blender's FBX declares meters. Unreal's default leaves scene units alone,
    # producing a 1.6 cm character and equally undersized animation/props.
    for field in ('skeletal_mesh_import_data', 'anim_sequence_import_data', 'static_mesh_import_data'):
        options.get_editor_property(field).set_editor_property('convert_scene_unit', True)
    mesh_data = options.get_editor_property('skeletal_mesh_import_data')
    mesh_data.set_editor_property('update_skeleton_reference_pose', False)
    mesh_data.set_editor_property('use_t0_as_ref_pose', False)
    mesh_data.set_editor_property('import_mesh_lo_ds', False)
    anim_data = options.get_editor_property('anim_sequence_import_data')
    anim_data.set_editor_property('use_default_sample_rate', False)
    anim_data.set_editor_property('custom_sample_rate', fps)
    anim_data.set_editor_property('preserve_local_transform', True)
    anim_data.set_editor_property('remove_redundant_keys', False)
    anim_data.set_editor_property('animation_length', unreal.FBXAnimationLengthImportType.FBXALIT_EXPORTED_TIME)
    task = unreal.AssetImportTask()
    task.set_editor_property('filename', filename)
    task.set_editor_property('destination_path', DEST + '/' + os.path.dirname(relative).replace('\\', '/'))
    task.set_editor_property('destination_name', os.path.splitext(os.path.basename(relative))[0])
    task.set_editor_property('automated', True)
    task.set_editor_property('replace_existing', True)
    task.set_editor_property('save', False)
    task.set_editor_property('options', options)
    task.set_editor_property('factory', unreal.FbxFactory())
    ASSETS.import_asset_tasks([task])
    cls = {'mesh': unreal.SkeletalMesh, 'animation': unreal.AnimSequence, 'static': unreal.StaticMesh}[kind]
    assets = [unreal.load_asset(p) for p in task.get_editor_property('imported_object_paths')]
    result = next((a for a in assets if isinstance(a, cls)), None)
    if not result:
        raise RuntimeError('Unreal did not import ' + relative + '. See the Output Log.')
    return result

skeleton_path = DEST + '/' + DATA['skeleton']
shared = unreal.load_asset(skeleton_path) if unreal.EditorAssetLibrary.does_asset_exist(skeleton_path) else None
if shared is not None and not isinstance(shared, unreal.Skeleton):
    raise RuntimeError('The shared Skeleton path is occupied by another asset: ' + skeleton_path)
reference = None
report = {'destination': DEST, 'characters': [], 'animations': [], 'props': [], 'sockets': DATA['sockets']}
total = sum(len(c['meshes']) for c in DATA['characters']) + len(DATA['animations']) + len(DATA['props'])
reference_meshes = {}
with unreal.ScopedSlowTask(total, 'Importing Pose shared skeleton') as progress:
    progress.make_dialog(True)
    for character in DATA['characters']:
        meshes = {}
        for variant, filename in character['meshes'].items():
            if progress.should_cancel():
                raise RuntimeError('Import cancelled. Completed assets remain in ' + DEST)
            progress.enter_progress_frame(1, character['name'] + ' / ' + variant)
            mesh = import_asset(filename, 'mesh', shared)
            if shared is None:
                shared, reference = mesh.get_editor_property('skeleton'), mesh
                old = shared.get_path_name().split('.')[0]
                new = DEST + '/' + DATA['skeleton']
                if old != new and not unreal.EditorAssetLibrary.rename_asset(old, new):
                    raise RuntimeError('Could not name the shared Skeleton.')
            if mesh.get_editor_property('skeleton') != shared:
                raise RuntimeError('A mesh did not use the shared Skeleton: ' + filename)
            if reference is None:
                reference = mesh
            meshes[variant] = mesh
        if not reference_meshes:
            reference_meshes = meshes
        report['characters'].append({'name': character['name'], 'meshes': {k: v.get_path_name() for k, v in meshes.items()}})
    # BoneNode is a writable struct inside the reflected BoneTree array. Index
    # through the imported reference pose, not the FBX file's traversal order.
    names = [str(n) for n in unreal.AnimPoseExtensions.get_bone_names(shared.get_reference_pose())]
    tree = shared.get_editor_property('bone_tree')
    if len(names) != len(tree) or set(names) != set(DATA['translationModes']):
        raise RuntimeError('Imported Skeleton bones differ from the export manifest.')
    shared.modify()
    for index, name in enumerate(names):
        mode = getattr(unreal.BoneTranslationRetargetingMode, DATA['translationModes'][name])
        if tree[index].get_editor_property('translation_retargeting_mode') != mode:
            try:
                node = tree[index]
                node.set_editor_property('translation_retargeting_mode', mode)
                tree[index] = node
            except Exception as error:
                unreal.EditorAssetLibrary.save_directory(DEST, only_if_is_dirty=False, recursive=True)
                raise RuntimeError('Cannot set translation mode for ' + name + '. Imported assets remain in ' + DEST + '. Apply manifest.json translationModes in Skeleton Tree > Show Retargeting Options, then rerun.') from error
    actual = shared.get_editor_property('bone_tree')
    for index, name in enumerate(names):
        if actual[index].get_editor_property('translation_retargeting_mode') != getattr(unreal.BoneTranslationRetargetingMode, DATA['translationModes'][name]):
            unreal.EditorAssetLibrary.save_directory(DEST, only_if_is_dirty=False, recursive=True)
            raise RuntimeError('Translation mode was not retained for ' + name + '. See UNREAL-IMPORT.txt.')
    report['translationModes'] = DATA['translationModes']
    for clip in DATA['animations']:
        if progress.should_cancel():
            raise RuntimeError('Import cancelled. Completed assets remain in ' + DEST)
        progress.enter_progress_frame(1, clip['name'])
        animation = import_asset(clip['file'], 'animation', shared, clip.get('sampleRate', clip['fps']))
        preview = reference_meshes[clip['preview']]
        animation.set_preview_skeletal_mesh(preview)
        if animation.get_skeleton() != shared:
            raise RuntimeError('Animation did not use the shared Skeleton: ' + clip['file'])
        unreal.EditorAssetLibrary.set_metadata_tag(animation, 'Pose.View', clip['type'])
        unreal.EditorAssetLibrary.set_metadata_tag(animation, 'Pose.PropBindings', json.dumps(clip['props']))
        report['animations'].append({'name': clip['name'], 'asset': animation.get_path_name(), 'props': clip['props']})
    for definition in DATA['sockets']:
        socket = next((reference.get_socket_by_index(i) for i in range(reference.num_sockets())
                       if str(reference.get_socket_by_index(i).get_editor_property('socket_name')) == definition['socket']), None)
        if not socket:
            socket = unreal.SkeletalMeshSocket(outer=reference, name=definition['socket'])
            socket.set_socket_parent(reference, definition['bone'])
            socket.set_socket_local_transform(unreal.Transform())
            socket.set_editor_property('force_always_animated', True)
            reference.add_socket(socket, True)
            # SocketName is VisibleAnywhere / read-only in Python. Rename via
            # the skeletal mesh API after promotion to the shared Skeleton.
            if not reference.rename_socket(socket.get_editor_property('socket_name'), definition['socket']):
                raise RuntimeError('Unreal could not name the prop socket: ' + definition['socket'])
        if str(socket.get_editor_property('bone_name')) != definition['bone']:
            raise RuntimeError('Socket parent differs from the exported attachment bone.')
    for prop in DATA['props']:
        progress.enter_progress_frame(1, prop['name'])
        mesh = import_asset(prop['file'], 'static')
        report['props'].append({'id': prop['id'], 'asset': mesh.get_path_name()})
    unreal.EditorAssetLibrary.save_directory(DEST, only_if_is_dirty=False, recursive=True)
    report['skeleton'] = shared.get_path_name()
with open(os.path.join(ROOT, 'unreal-import-result.json'), 'w', encoding='utf-8') as stream:
    json.dump(report, stream, indent=2)
unreal.log('Pose: imported all meshes and animations on ' + shared.get_path_name())
if '-run=' not in unreal.SystemLibrary.get_command_line().lower():
    unreal.EditorAssetLibrary.sync_browser_to_objects([shared.get_path_name(), reference.get_path_name()])
