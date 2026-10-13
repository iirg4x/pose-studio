"""Export the selected first-person or full-body action and its props."""
import bpy,bmesh,json,sys,os,math,re,re
from mathutils import Matrix,Vector,Euler

def main():
 args=sys.argv[sys.argv.index('--')+1:];input_path,out_dir,with_mesh=args;include_mesh=with_mesh=='1'
 with open(input_path,encoding='utf-8') as f:data=json.load(f)
 action_type=data['project'].get('actionType',data['project']['editing'])
 base=os.path.dirname(os.path.abspath(__file__));files=[]
 C=Matrix.Rotation(-math.pi/2,4,'X');Ci=C.inverted()
 def matrix(values):return Matrix([values[i:i+4] for i in range(0,16,4)]).transposed()
 def setup():
  bpy.ops.wm.open_mainfile(filepath=os.path.join(base,'manny-clean.blend'),load_ui=False,use_scripts=False)
  scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=data['end']+1;scene.render.fps=data['fps'];scene.render.fps_base=1
  scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1.0
  return scene,bpy.data.objects['Armature'],bpy.data.objects['SKM_Manny_Simple']
 def select(objects):
  bpy.ops.object.select_all(action='DESELECT')
  for ob in objects:ob.hide_set(False);ob.select_set(True)
  bpy.context.view_layer.objects.active=objects[0]
 def export(filename,objects):
  select(objects);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
  for ob in objects:
   if ob.type!='MESH':continue
   for mat in ob.data.materials:
    if not mat or not mat.use_nodes:continue
    for node in mat.node_tree.nodes:
     if node.type!='TEX_IMAGE' or not node.image:continue
     im=node.image;filename_texture='Textures/'+re.sub(r'[^a-zA-Z0-9_-]','_',im.name)+'.png';destination=os.path.join(out_dir,filename_texture)
     os.makedirs(os.path.dirname(destination),exist_ok=True)
     im.filepath_raw=destination;im.file_format='PNG';im.save()
     if filename_texture not in files:files.append(filename_texture)
  bpy.ops.export_scene.fbx(filepath=os.path.join(out_dir,filename),use_selection=True,object_types={'ARMATURE','MESH'},global_scale=1.0,apply_unit_scale=True,apply_scale_options='FBX_SCALE_UNITS',axis_forward='X',axis_up='Z',use_space_transform=True,bake_space_transform=False,add_leaf_bones=False,use_armature_deform_only=False,armature_nodetype='NULL',primary_bone_axis='Y',secondary_bone_axis='X',bake_anim=True,bake_anim_use_all_bones=True,bake_anim_use_nla_strips=False,bake_anim_use_all_actions=False,bake_anim_force_startend_keying=True,bake_anim_step=1.0,bake_anim_simplify_factor=0.0,use_mesh_modifiers=True,mesh_smooth_type='FACE',path_mode='COPY',embed_textures=True,use_custom_props=False)
  files.append(filename)
 def mask(mesh,pattern):
  groups={g.index for g in mesh.vertex_groups if re.match(pattern,g.name)}
  keep={v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.45}
  bm=bmesh.new();bm.from_mesh(mesh.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in keep],context='VERTS');bm.to_mesh(mesh.data);bm.free();mesh.data.update()
 def bake(rig,field,label):
  rig.animation_data_clear();rest={b.name:b.matrix_local.copy() for b in rig.data.bones};bones=sorted(rig.pose.bones,key=lambda b:len(b.parent_recursive));previous={}
  for pb in bones:pb.rotation_mode='QUATERNION'
  for frame in data['frames']:
   f=frame['frame']+1;bpy.context.scene.frame_set(f)
   desired={name:Ci@matrix(delta)@C@rest[name] for name,delta in frame[field].items()}
   for pb in bones:
    bone=pb.bone
    if pb.parent:pb.matrix_basis=bone.convert_local_to_pose(desired[pb.name],bone.matrix_local,parent_matrix=desired[pb.parent.name],parent_matrix_local=bone.parent.matrix_local,invert=True)
    else:pb.matrix_basis=bone.convert_local_to_pose(desired[pb.name],bone.matrix_local,invert=True)
    q=pb.rotation_quaternion.copy()
    if pb.name in previous and previous[pb.name].dot(q)<0:q.negate();pb.rotation_quaternion=q
    previous[pb.name]=q
    for prop in ['location','rotation_quaternion','scale']:pb.keyframe_insert(prop,frame=f,group=pb.name)
  rig.animation_data.action.name=data['name']+'_'+label
 scene,rig,mesh=setup()
 if action_type=='body':
  bake(rig,'bodyBones','Body');export('Manny_Body.fbx',[rig,mesh] if include_mesh else [rig])
  if include_mesh:
   legs=mesh.copy();legs.data=mesh.data.copy();scene.collection.objects.link(legs);legs.name='Manny_Player_Legs';mask(legs,'^(pelvis|thigh|calf|foot|ball)');export('Manny_Legs.fbx',[rig,legs])
 else:
  mask(mesh,'^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)');mesh.name='Manny_FP_Arms';bake(rig,'bones','FirstPerson');export('Manny_FP_Arms.fbx',[rig,mesh] if include_mesh else [rig])
 for layer,field in ([('FP','props')] if action_type=='firstPerson' else [('World','bodyProps')]):
  for prop_id in data['geometry']:
   arm=bpy.data.armatures.new(layer+'_'+prop_id+'_Skeleton');obj=bpy.data.objects.new(layer+'_'+prop_id+'_Armature',arm);scene.collection.objects.link(obj);select([obj])
   bpy.ops.object.mode_set(mode='EDIT');b=arm.edit_bones.new('root');b.head=(0,0,0);b.tail=(0,.1,0);bpy.ops.object.mode_set(mode='OBJECT')
   asset=data.get('assetFiles',{}).get(prop_id)
   if asset:
    before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=asset)
    imported=[o for o in scene.objects if o not in before];parts=[o for o in imported if o.type=='MESH']
    if not parts: raise RuntimeError('Imported prop has no mesh: '+prop_id)
    settings=data['project']['props'][prop_id];rotation=Euler(tuple(math.radians(v) for v in settings['rotation']),'ZYX').to_matrix().to_4x4()
    transform=Ci@Matrix.Translation(Vector(settings['offset']))@rotation@Matrix.Scale(settings['scale'],4)@C
    deps=bpy.context.evaluated_depsgraph_get()
    for part in parts:
     evaluated=part.evaluated_get(deps);geometry=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps);geometry.transform(transform@part.matrix_world);part.data=geometry;part.modifiers.clear();part.parent=None;part.matrix_world=Matrix.Identity(4)
    select(parts);bpy.ops.object.join();prop_mesh=bpy.context.object;prop_mesh.name=prop_id;prop_mesh.parent=obj
    prop_mesh.vertex_groups.clear();group=prop_mesh.vertex_groups.new(name='root');group.add(list(range(len(prop_mesh.data.vertices))),1.0,'REPLACE');modifier=prop_mesh.modifiers.new('Armature','ARMATURE');modifier.object=obj
    for item in imported:
     if item.name in bpy.data.objects and item!=prop_mesh: bpy.data.objects.remove(item,do_unlink=True)
   else:
    vertices=[];faces=[];material_indices=[];materials=[]
    for part_index,part in enumerate(data['geometry'][prop_id]):
     offset=len(vertices);vertices.extend([tuple(Ci.to_3x3()@Vector(v)) for v in part['vertices']]);indices=part['indices']
     for i in range(0,len(indices),3):faces.append(tuple(offset+j for j in indices[i:i+3]));material_indices.append(part_index)
     mat=bpy.data.materials.new(prop_id+'_'+str(part_index));mat.diffuse_color=(*part['color'],1);mat.use_nodes=True;bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(*part['color'],1);bsdf.inputs['Metallic'].default_value=.55;bsdf.inputs['Roughness'].default_value=.4;materials.append(mat)
    geo=bpy.data.meshes.new(prop_id+'_Mesh');geo.from_pydata(vertices,[],faces);geo.update();prop_mesh=bpy.data.objects.new(prop_id,geo);scene.collection.objects.link(prop_mesh);prop_mesh.parent=obj
    for mat in materials:geo.materials.append(mat)
    for face,mat_index in zip(geo.polygons,material_indices):face.material_index=mat_index;face.use_smooth=True
    group=prop_mesh.vertex_groups.new(name='root');group.add(list(range(len(vertices))),1.0,'REPLACE');modifier=prop_mesh.modifiers.new('Armature','ARMATURE');modifier.object=obj
   pb=obj.pose.bones['root'];pb.rotation_mode='QUATERNION';prev=None
   for frame in data['frames']:
    f=frame['frame']+1;scene.frame_set(f);pb.matrix_basis=Ci@matrix(frame[field][prop_id])@C;q=pb.rotation_quaternion.copy()
    if prev and prev.dot(q)<0:q.negate();pb.rotation_quaternion=q
    prev=q
    for prop in ['location','rotation_quaternion','scale']:pb.keyframe_insert(prop,frame=f,group='root')
   obj.animation_data.action.name=data['name']+'_'+layer+'_'+prop_id
   label=re.sub(r'[^a-zA-Z0-9_-]','_',data['project'].get('props',{}).get(prop_id,{}).get('name',prop_id))+'_'+str(list(data['geometry']).index(prop_id)+1)
   export(layer+'_'+label+'.fbx',[obj,prop_mesh])
 project=data['project'];fp=project['tracks'] if project['editing']=='firstPerson' else project['otherTracks'];body=project['tracks'] if project['editing']=='body' else project['otherTracks']
 if project.get('bodyBase',{}).get('enabled'):
  link=project['bodyBase'];source=link['source'];scale=project['fps']/source['fps'];body={name:dict(track) for name,track in body.items()}
  for name,track in body.items():
   if name in link['excluded']:continue
   own=track['spaces'];first=own[0]['frame'] if own else float('inf')
   inherited=[dict(event,frame=event['frame']*scale) for event in source['tracks'][name]['spaces'] if event['frame']*scale<first and event['parent'] not in link['excluded']]
   track['spaces']=inherited+own
 source_range=data.get('sourceRange',{'start':0,'end':data['end']})
 def export_contacts(tracks):
  result={}
  for name,track in tracks.items():
   spaces=track['spaces'];prior=[s for s in spaces if s['frame']<=source_range['start']]
   events=prior[-1:]+[s for s in spaces if source_range['start']<s['frame']<=source_range['end']]
   if events:result[name]=[{**s,'frame':max(0,s['frame']-source_range['start'])} for s in events]
  return result
 def ue(v,scale=1):return [v.z*scale,-v.x*scale,v.y*scale]
 frames=[]
 for f in data['frames']:
  m=matrix(f['camera']['matrix']);frames.append({'frame':f['frame'],**f['camera'],'unreal':{'locationCm':ue(m.translation,100),'forward':ue(m.to_3x3()@Vector((0,0,-1))),'up':ue(m.to_3x3()@Vector((0,1,0)))}})
 extract_root=data.get('rootMotion','keep')=='extract'
 root_motion={'mode':'extract' if extract_root else 'keep','bone':'root','enableOnBody':extract_root,'enableOnFirstPersonArms':False,'enableOnProps':False,'rootLock':'Ref Pose' if extract_root else None,'bodyStartsAtOrigin':extract_root,'worldPropsSpace':'Actor; body root removed' if extract_root else 'Component; body root retained','bodyRootFrames':[{'frame':f['frame'],'matrix':f['bodyBones']['root']} for f in data['frames']]}
 profile={'version':2,'rootMotion':root_motion,'fps':data['fps'],'startFrame':0,'endFrame':data['end'],'coordinates':{'units':'meters','up':'+Y','forward':'+Z','matrixOrder':'column-major','cameraLooksAlong':'local -Z','unrealPointConversion':'UE centimeters = (Three.z * 100, -Three.x * 100, Three.y * 100)'},'cameraReference':data['cameraReference'],'frames':frames,'sourceRange':source_range,'loop':project.get('loop',{'enabled':True,'start':0,'end':project['end']}),'endpointIncluded':True,'contacts':{layer:export_contacts(tracks) for layer,tracks in [('firstPerson',fp),('body',body)]},'unrealComponents':{'FPArms':{'parent':'Camera','relativeLocationCm':[0,0,-165],'relativeRotationDegrees':[0,0,0],'onlyOwnerSee':True,'castShadow':False},'FPProps':{'parent':'Camera','relativeLocationCm':[0,0,-165],'castShadow':False,'note':'Baked prop roots already contain the animated placement. Do not also attach them to animated hand sockets.'},'Body':{'ownerNoSee':True,'castShadow':True,'castHiddenShadow':True,'purpose':'Third person and world shadows'},'Legs':{'onlyOwnerSee':True,'castShadow':False,'poseSource':'Body; Copy Pose From Mesh or Leader Pose'},'WorldProps':{'ownerNoSee':True,'castShadow':True,'castHiddenShadow':True,'parent':'Actor; baked roots contain placement','rootMotionRemoved':extract_root}},'notes':['First-person and body tracks are independent; start them on the same frame and play rate.','For newer Unreal first-person rendering, map player arms/props to FirstPerson and the full body/world props to WorldSpaceRepresentation.','No Unreal project was modified by this exporter.']}
 profile['actionType']=action_type
 for filename,value in [('camera-and-contacts.json',profile),('project.manny.json',project)]:
  with open(os.path.join(out_dir,filename),'w',encoding='utf-8') as f:json.dump(value,f,indent=2)
  files.append(filename)
 with open(os.path.join(out_dir,'manifest.json'),'w',encoding='utf-8') as f:json.dump({'files':files,'rig':'ue5-manny-simple','actionType':action_type,'bonesPerRig':89,'independentRigs':1,'fps':data['fps'],'frames':len(data['frames']),'fbxForward':'X','fbxUp':'Z','rootMotion':data.get('rootMotion','keep')},f,indent=2)
 print('STUDIO_EXPORT_OK',out_dir)

if __name__=='__main__':
 try:main()
 except Exception:
  import traceback;traceback.print_exc();sys.exit(1)
