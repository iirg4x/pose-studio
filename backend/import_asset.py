"""Import local DCC assets without executing embedded scripts. UI owns selection."""
import bpy, sys, os, json, math, re
from mathutils import Matrix

args=sys.argv[sys.argv.index('--')+1:]
mode,source,destination=args[:3]
options=json.loads(args[3]) if len(args)>3 else {}
bpy.ops.wm.read_factory_settings(use_empty=True)
ext=os.path.splitext(source)[1].lower()
if ext=='.blend': bpy.ops.wm.open_mainfile(filepath=source,load_ui=False,use_scripts=False)
elif ext=='.fbx': bpy.ops.import_scene.fbx(filepath=source,use_anim=mode!='prop',use_image_search=True)
elif ext in ['.glb','.gltf']: bpy.ops.import_scene.gltf(filepath=source)
elif ext=='.bvh': bpy.ops.import_anim.bvh(filepath=source,axis_forward='-Z',axis_up='Y')
elif ext=='.obj': bpy.ops.wm.obj_import(filepath=source)
else: raise RuntimeError('Unsupported asset format: '+ext)

if mode=='prop':
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if not meshes: raise RuntimeError('No meshes found in this file.')
    for ob in bpy.context.scene.objects: ob.select_set(ob in meshes)
    bpy.context.view_layer.objects.active=meshes[0]
    bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',use_selection=True,export_animations=False,export_skins=False,export_yup=True,export_apply=True)
else:
    rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
    if not rigs: raise RuntimeError('No skeleton found. Import an animated armature, not a static mesh.')
    scene=bpy.context.scene
    def action_paths(action,slot=None):
        if hasattr(action,'layers'):
            return [curve.data_path for layer in action.layers for strip in layer.strips for bag in getattr(strip,'channelbags',[]) if slot is None or bag.slot_handle==slot.handle for curve in bag.fcurves]
        return [curve.data_path for curve in getattr(action,'fcurves',[])]
    def matches_rig(rig,action,slot=None):
        paths=action_paths(action,slot)
        bones={match.group(1) for path in paths for match in [re.search(r'pose\.bones\["([^"\]]+)"\]',path)] if match}
        if bones: return len(bones.intersection(rig.data.bones.keys()))/len(bones)>.5
        return bool(slot and (slot.name_display==rig.name or slot.identifier[2:]==rig.name))
    def actions_for(rig):
        result=[]
        for action in bpy.data.actions:
            slots=list(action.slots) if hasattr(action,'slots') else []
            if slots:
                for slot in slots:
                    if slot.target_id_type=='OBJECT' and matches_rig(rig,action,slot): result.append({'id':action.name+'::'+str(slot.handle),'name':action.name,'slot':slot.handle,'action':action.name,'start':float(action.frame_range[0]),'end':float(action.frame_range[1])})
            elif matches_rig(rig,action): result.append({'id':action.name,'name':action.name,'action':action.name,'start':float(action.frame_range[0]),'end':float(action.frame_range[1])})
        return result
    rigs.sort(key=lambda r:not bool(actions_for(r)))
    if mode=='inspect':
        data={'fps':scene.render.fps/scene.render.fps_base,'rigs':[{'name':r.name,'bones':[b.name for b in r.data.bones],'actions':actions_for(r)} for r in rigs]}
    else:
        rig=next((r for r in rigs if r.name==options.get('rig')),None)
        if rig is None: raise RuntimeError('Choose a skeleton from this file.')
        action=next((a for a in actions_for(rig) if a['id']==options.get('action')),None)
        if action is None: raise RuntimeError('Choose an action from this skeleton.')
        fps=int(options.get('fps',round(scene.render.fps/scene.render.fps_base)))
        if not 1<=fps<=120: raise RuntimeError('Sample rate must be 1–120 fps.')
        start=float(options.get('start',action['start']));end=float(options.get('end',action['end']))
        original_fps=scene.render.fps/scene.render.fps_base
        count=round((end-start)/original_fps*fps)
        if count<1 or count>2400: raise RuntimeError('Choose a range of 1–2400 output frames.')
        rig.animation_data_create()
        for track in rig.animation_data.nla_tracks: track.mute=True
        rig.animation_data.action=bpy.data.actions[action['action']]
        if 'slot' in action: rig.animation_data.action_slot=next(s for s in rig.animation_data.action.slots if s.handle==action['slot'])
        C=Matrix.Rotation(-math.pi/2,4,'X')
        def arr(m): return [round(m[row][col],10) for col in range(4) for row in range(4)]
        bones=list(rig.data.bones)
        data={'name':action['name'],'fps':fps,'end':count,'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'rest':arr(C@rig.matrix_world@b.matrix_local)} for b in bones],'frames':[]}
        for i in range(count+1):
            f=start+i*original_fps/fps;scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update()
            evaluated=rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
            data['frames'].append([arr(C@evaluated.matrix_world@evaluated.pose.bones[b.name].matrix) for b in bones])
    with open(destination,'w',encoding='utf8') as stream: json.dump(data,stream,separators=(',',':'))
print('ASSET_READY')
