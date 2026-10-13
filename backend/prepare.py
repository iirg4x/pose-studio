import bpy,sys,json,os,numpy as np
from mathutils import Matrix
base=os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.open_mainfile(filepath=os.path.join(base,'manny-source.blend'),load_ui=False,use_scripts=False)
rig=bpy.data.objects['SK_Manny_Simple_Original'];mesh=bpy.data.objects['SKM_Manny_Simple']
for ob in [rig,mesh]:
 mat=ob.matrix_world.copy();ob.parent=None;ob.matrix_world=mat;ob.hide_set(False);ob.hide_viewport=False;ob.hide_render=False;ob.animation_data_clear()
for pb in rig.pose.bones:
 for c in list(pb.constraints):pb.constraints.remove(c)
 pb.matrix_basis=Matrix.Identity(4)
for ob in list(bpy.data.objects):
 if ob not in [rig,mesh]:bpy.data.objects.remove(ob,do_unlink=True)
rig.name='Armature';rig.data.pose_position='POSE'
world=mesh.matrix_world.copy();mesh.parent=rig;mesh.matrix_world=world
# Flatten the supplied Manny shader into portable PBR textures, preserving its
# paint masks, metallic response, roughness, baked occlusion and chest logo.
# This changes materials only: bind pose, topology and weights stay untouched.
bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True)
bpy.context.view_layer.objects.active=mesh
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
scene.render.bake.margin=8;scene.render.bake.use_clear=True
originals=[s.material for s in mesh.material_slots];maps=[{} for _ in originals]
for channel,socket_name,color_space in [('base','Base Color','sRGB'),('rough','Roughness','Non-Color'),('metal','Metallic','Non-Color'),('emission','Emission Color','sRGB')]:
 for i,mat in enumerate(originals):
  nt=mat.node_tree;bsdf=nt.nodes.get('Principled BSDF');out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
  emit=nt.nodes.new('ShaderNodeEmission');emit.name='Portable bake emission'
  source=bsdf.inputs[socket_name]
  if source.is_linked:nt.links.new(source.links[0].from_socket,emit.inputs['Color'])
  else:
   value=source.default_value;emit.inputs['Color'].default_value=tuple(value) if hasattr(value,'__len__') else (value,value,value,1)
  nt.links.new(emit.outputs[0],out.inputs['Surface'])
  im=bpy.data.images.new('Manny_%02d_%s'%(i+1,channel),width=1024,height=1024,alpha=False);im.colorspace_settings.name=color_space
  node=nt.nodes.new('ShaderNodeTexImage');node.name='Portable bake target';node.image=im;nt.nodes.active=node;maps[i][channel]=im
 bpy.ops.object.bake(type='EMIT')
 for mat in originals:
  nt=mat.node_tree;out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
  nt.links.new(nt.nodes.get('Principled BSDF').outputs[0],out.inputs['Surface'])
  nt.nodes.remove(nt.nodes['Portable bake emission']);nt.nodes.remove(nt.nodes['Portable bake target'])
for i,slot in enumerate(mesh.material_slots):
 source=originals[i];mat=bpy.data.materials.new('MI_Manny_%02d'%(i+1));mat.use_nodes=True;nt=mat.node_tree;bsdf=nt.nodes.get('Principled BSDF')
 def tex(im):
  im.pack();node=nt.nodes.new('ShaderNodeTexImage');node.image=im;return node
 nt.links.new(tex(maps[i]['base']).outputs['Color'],bsdf.inputs['Base Color'])
 size=1024*1024*4;rough=np.empty(size,dtype=np.float32);metal=np.empty(size,dtype=np.float32)
 maps[i]['rough'].pixels.foreach_get(rough);maps[i]['metal'].pixels.foreach_get(metal)
 packed=np.ones((1024*1024,4),dtype=np.float32);packed[:,1]=rough.reshape(-1,4)[:,0];packed[:,2]=metal.reshape(-1,4)[:,0]
 orm=bpy.data.images.new('Manny_%02d_ORM'%(i+1),width=1024,height=1024,alpha=False);orm.colorspace_settings.name='Non-Color';orm.pixels.foreach_set(packed.ravel());orm.update()
 sep=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(tex(orm).outputs['Color'],sep.inputs['Color']);nt.links.new(sep.outputs['Green'],bsdf.inputs['Roughness']);nt.links.new(sep.outputs['Blue'],bsdf.inputs['Metallic'])
 normal=next(n.image for n in source.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and '_BN.' in n.image.name)
 norm=nt.nodes.new('ShaderNodeNormalMap');nt.links.new(tex(normal).outputs['Color'],norm.inputs['Color']);nt.links.new(norm.outputs['Normal'],bsdf.inputs['Normal'])
 nt.links.new(tex(maps[i]['emission']).outputs['Color'],bsdf.inputs['Emission Color']);bsdf.inputs['Emission Strength'].default_value=source.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value
 slot.material=mat
for pb in rig.pose.bones:pb.custom_shape=None
bpy.context.view_layer.objects.active=rig
for ob in [rig,mesh]:ob.select_set(True)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(base,'manny-clean.blend'))
bones=[{'name':b.name,'parent':b.parent.name if b.parent else None,'matrix':[list(row) for row in b.matrix_local]} for b in rig.data.bones]
with open(os.path.join(base,'skeleton.json'),'w') as f:json.dump({'id':'ue5-manny-simple','bones':bones},f)
bpy.ops.export_scene.gltf(filepath=os.path.join(base,'../public/assets/manny.glb'),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_all_influences=True,export_def_bones=False,export_yup=True)
print('PREPARE_OK',len(bones))
