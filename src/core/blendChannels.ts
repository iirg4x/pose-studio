/** Blend controls share the curve editor, but never write transform values. */
export const TRANSFORM_AXES=['px','py','pz','rx','ry','rz'] as const;
export type TransformAxis=typeof TRANSFORM_AXES[number];
export const BLEND_CHANNELS=['blendWeight','blendWeight_px','blendWeight_py','blendWeight_pz','blendWeight_rx','blendWeight_ry','blendWeight_rz','blendReplace_px','blendReplace_py','blendReplace_pz','blendReplace_rx','blendReplace_ry','blendReplace_rz'] as const;
export type BlendChannel=typeof BLEND_CHANNELS[number];
export const isBlendChannel=(c:string):c is BlendChannel=>c.startsWith('blend');
export const blendDefault=(c:BlendChannel)=>c.startsWith('blendReplace')?0:100;
export const blendChannel=(axis:TransformAxis,kind:'Weight'|'Replace')=>('blend'+kind+'_'+axis) as BlendChannel;
export const BLEND_LABELS=Object.fromEntries(BLEND_CHANNELS.map(c=>[c,c==='blendWeight'?'Layer · control weight':('Layer · '+(c.endsWith('px')||c.endsWith('py')||c.endsWith('pz')?'location ':'rotation ')+c.at(-1)!.toUpperCase()+(c.startsWith('blendReplace')?' replace mix':' weight'))])) as Record<BlendChannel,string>;
