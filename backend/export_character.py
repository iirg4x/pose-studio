"""Bake the retargeted GLB into an FBX using the target's own skeleton."""
import bpy,sys
source,destination,fps,end=sys.argv[sys.argv.index('--')+1:][:4]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps=int(fps)
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.scene.frame_start=0
bpy.context.scene.frame_end=int(end)
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.fbx(filepath=destination,use_selection=True,object_types={'ARMATURE','MESH','EMPTY'},add_leaf_bones=False,armature_nodetype='NULL',bake_anim=True,bake_anim_use_all_bones=True,bake_anim_use_nla_strips=False,bake_anim_use_all_actions=False,bake_anim_force_startend_keying=True,bake_anim_step=1,bake_anim_simplify_factor=0.0,path_mode='COPY',embed_textures=True,axis_forward='-Z',axis_up='Y')
print('CHARACTER_EXPORTED')
