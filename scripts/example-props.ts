import * as T from 'three';
import axe from '../public/assets/axe.json';
export function createMainProp(){
 const group=new T.Group(),rifle=createRifle(),geometry=new T.BufferGeometry();rifle.name='rifle';
 geometry.setAttribute('position',new T.Float32BufferAttribute(axe.positions,3));geometry.computeVertexNormals();
 const tool=new T.Mesh(geometry,new T.MeshStandardMaterial({color:0x90938d,metalness:.35,roughness:.65}));tool.name='axe';tool.castShadow=true;tool.layers.enable(1);tool.userData.control='rifle';tool.visible=false;
 group.userData.control='rifle';group.add(rifle,tool);return group;
}
export function setMainProp(group:T.Group,preset:'rifle'|'axe'='rifle'){for(const child of group.children)child.visible=child.name===preset;}
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
const dark=new T.MeshStandardMaterial({color:0x30363a,metalness:.75,roughness:.38});
const rubber=new T.MeshStandardMaterial({color:0x181d22,metalness:.1,roughness:.8});
const metal=new T.MeshStandardMaterial({color:0x586168,metalness:.85,roughness:.28});
function box(g:T.Group,size:number[],p:number[],m=dark,r=[0,0,0]){
 const o=new T.Mesh(new RoundedBoxGeometry(size[0],size[1],size[2],2,.006),m);o.position.fromArray(p);o.rotation.set(r[0],r[1],r[2]);o.castShadow=true;o.receiveShadow=true;o.layers.enable(1);g.add(o);return o;
}
function cylinder(g:T.Group,r:number,l:number,p:number[],m=dark){
 const o=new T.Mesh(new T.CylinderGeometry(r,r,l,20),m);o.rotation.x=Math.PI/2;o.position.fromArray(p);o.castShadow=true;o.layers.enable(1);g.add(o);return o;
}
export function createRifle(){
 const g=new T.Group();g.name='Rifle';g.userData.control='rifle';
 box(g,[.075,.115,.27],[0,0,.03]);
 box(g,[.064,.071,.31],[0,.022,.31]);
 box(g,[.058,.115,.095],[0,-.104,-.06],rubber,[-.22,0,0]);
 box(g,[.066,.055,.16],[0,.015,-.185]);box(g,[.092,.15,.11],[0,-.015,-.30],rubber);
 box(g,[.032,.023,.12],[0,-.104,.038]);
 cylinder(g,.017,.18,[0,.02,.555],metal);cylinder(g,.026,.065,[0,.02,.672]);
 for(let i=0;i<17;i++)box(g,[.077,.013,.009],[0,.07,-.04+i*.028],metal);
 for(let i=0;i<7;i++){box(g,[.003,.027,.022],[.033,.02,.21+i*.034],rubber);box(g,[.003,.027,.022],[-.033,.02,.21+i*.034],rubber);}
 box(g,[.053,.035,.055],[0,.10,.07],metal);
 cylinder(g,.034,.092,[0,.153,.072]);cylinder(g,.026,.006,[0,.153,.12],new T.MeshStandardMaterial({color:0x42818a,metalness:.4,roughness:.12}));
 box(g,[.043,.07,.018],[0,.108,.43],metal);box(g,[.056,.018,.02],[0,.135,.43],rubber);
 box(g,[.009,.016,.047],[.041,-.005,.035],metal);
 g.traverse(o=>o.userData.control='rifle');return g;
}
export function createMagazine(){
 const g=new T.Group();g.name='Magazine';g.userData.control='magazine';
 box(g,[.057,.16,.077],[0,-.025,0],dark,[-.06,0,0]);
 box(g,[.064,.018,.085],[0,-.105,.005],rubber);
 for(let i=0;i<4;i++){box(g,[.003,.10,.006],[.029,-.028,-.021+i*.014],rubber);box(g,[.003,.10,.006],[-.029,-.028,-.021+i*.014],rubber);}
 g.traverse(o=>o.userData.control='magazine');return g;
}
export function geometryData(group:T.Group){
 const result:unknown[]=[];group.updateMatrixWorld(true);
 const inv=group.matrixWorld.clone().invert();
 group.traverse(o=>{if(o instanceof T.Mesh){let ancestor:T.Object3D|null=o;while(ancestor&&ancestor!==group){if(!ancestor.visible)return;ancestor=ancestor.parent;}const geo=o.geometry;const pos=geo.getAttribute('position');const local=inv.clone().multiply(o.matrixWorld),v=new T.Vector3();const vertices:number[][]=[];for(let i=0;i<pos.count;i++)vertices.push(v.fromBufferAttribute(pos,i).applyMatrix4(local).toArray());const indices=geo.index?Array.from(geo.index.array):Array.from({length:pos.count},(_,i)=>i);const material=Array.isArray(o.material)?o.material[0]:o.material;const col=(material as T.MeshStandardMaterial).color;result.push({vertices,indices,color:col.toArray()});}});return result;
}
