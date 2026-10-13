import * as T from 'three';
export function createMainProp() {
  return new T.Group();
}
export function setMainProp(_group: T.Group, _preset: 'rifle' | 'axe' = 'rifle') {}
export function createMagazine() {
  return new T.Group();
}
export function geometryData(group: T.Group) {
  const result: unknown[] = [];
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  group.traverse((o) => {
    if (o instanceof T.Mesh) {
      let ancestor: T.Object3D | null = o;
      while (ancestor && ancestor !== group) {
        if (!ancestor.visible) return;
        ancestor = ancestor.parent;
      }
      const geo = o.geometry;
      const pos = geo.getAttribute('position');
      const local = inv.clone().multiply(o.matrixWorld),
        v = new T.Vector3();
      const vertices: number[][] = [];
      for (let i = 0; i < pos.count; i++)
        vertices.push(v.fromBufferAttribute(pos, i).applyMatrix4(local).toArray());
      const indices = geo.index
        ? Array.from(geo.index.array)
        : Array.from({ length: pos.count }, (_, i) => i);
      const material = Array.isArray(o.material) ? o.material[0] : o.material;
      const col = (material as T.MeshStandardMaterial).color;
      result.push({ vertices, indices, color: col.toArray() });
    }
  });
  return result;
}
