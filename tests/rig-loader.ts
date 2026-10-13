import {Texture} from 'three';
import {fullSkinLoader} from '../src/scene/skinInfluences';
// Kinematic tests load the real geometry, weights and skeleton in Node.
// Browser image decoding is verified separately in desktop viewport QA.
export const rigLoader=()=>fullSkinLoader().register(()=>({name:'HeadlessRigTextures',loadTexture:async()=>new Texture()}));
