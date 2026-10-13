"""Convert an FBX/glTF humanoid to a self-contained, unanimated GLB."""
import bpy, sys, os, json
args=sys.argv[sys.argv.index('--')+1:]
source, destination=args[:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
if source.lower().endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=source, use_anim=False, use_image_search=True)
else:
    bpy.ops.import_scene.gltf(filepath=source)
rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
if len(rigs)!=1:
    raise RuntimeError('Choose a character with one armature (found %d).' % len(rigs))
rig=rigs[0]
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers)]
if not meshes: raise RuntimeError('The character has no skinned mesh.')
for o in bpy.context.scene.objects:
    if o.animation_data: o.animation_data_clear()
rig.data.pose_position='REST'
for image in bpy.data.images:
    if image.source!='FILE': continue
    basename=os.path.basename(image.filepath.replace('\\','/'))
    stem=os.path.splitext(basename)[0]
    # Resolve common DCC relative paths and a PNG replacement for PSD atlases.
    for directory in [os.path.dirname(source),os.path.join(os.path.dirname(source),'Textures'),os.path.join(os.path.dirname(source),'..','Textures'),os.path.join(os.path.dirname(source),'..','..','Textures')]:
        for name in [stem+'.png',basename]:
            filename=os.path.abspath(os.path.join(directory,name))
            if os.path.isfile(filename):
                try: image.filepath=filename; image.reload()
                except Exception: pass
                if image.has_data: break
        if image.has_data: break
if source.lower().endswith('.fbx'):
    # Legacy FBX Phong materials do not encode metalness. Blender's conversion
    # otherwise defaults this pack's coloured cloth/skin to metallic 1.
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type=='BSDF_PRINCIPLED': node.inputs['Metallic'].default_value=0
for o in bpy.context.scene.objects: o.select_set(o==rig or o in meshes)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_yup=True,export_apply=False,export_extras=True)
print('CHARACTER_READY')
