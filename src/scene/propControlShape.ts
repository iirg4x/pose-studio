import {Box3,Matrix4,Vector3} from 'three';
// Twelve real edges, in the prop's local mesh frame. Padding makes the cage
// legible without moving its control origin or changing animation transforms.
export function propControlShape(bounds:Box3,placement=new Matrix4(),padding=.007):number[]{
 const box=bounds.clone().expandByScalar(padding),vertices:Vector3[]=[];
 for(let i=0;i<8;i++)vertices.push(new Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(placement));
 const positions:number[]=[];for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit))positions.push(...vertices[i].toArray(),...vertices[i|bit].toArray());
 return positions;
}
