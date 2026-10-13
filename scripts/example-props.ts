import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const dark = new T.MeshStandardMaterial({ color: 0x30363a, metalness: 0.75, roughness: 0.38 });
const rubber = new T.MeshStandardMaterial({ color: 0x181d22, metalness: 0.1, roughness: 0.8 });
const metal = new T.MeshStandardMaterial({ color: 0x586168, metalness: 0.85, roughness: 0.28 });
function box(g: T.Group, size: number[], p: number[], m = dark, r = [0, 0, 0]) {
  const o = new T.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 2, 0.006), m);
  o.position.fromArray(p);
  o.rotation.set(r[0], r[1], r[2]);
  o.castShadow = true;
  o.receiveShadow = true;
  o.layers.enable(1);
  g.add(o);
  return o;
}
function cylinder(g: T.Group, r: number, l: number, p: number[], m = dark) {
  const o = new T.Mesh(new T.CylinderGeometry(r, r, l, 20), m);
  o.rotation.x = Math.PI / 2;
  o.position.fromArray(p);
  o.castShadow = true;
  o.layers.enable(1);
  g.add(o);
  return o;
}
export function createRifle() {
  const g = new T.Group();
  g.name = 'Rifle';
  g.userData.control = 'rifle';
  box(g, [0.075, 0.115, 0.27], [0, 0, 0.03]);
  box(g, [0.064, 0.071, 0.31], [0, 0.022, 0.31]);
  box(g, [0.058, 0.115, 0.095], [0, -0.104, -0.06], rubber, [-0.22, 0, 0]);
  box(g, [0.066, 0.055, 0.16], [0, 0.015, -0.185]);
  box(g, [0.092, 0.15, 0.11], [0, -0.015, -0.3], rubber);
  box(g, [0.032, 0.023, 0.12], [0, -0.104, 0.038]);
  cylinder(g, 0.017, 0.18, [0, 0.02, 0.555], metal);
  cylinder(g, 0.026, 0.065, [0, 0.02, 0.672]);
  for (let i = 0; i < 17; i++) box(g, [0.077, 0.013, 0.009], [0, 0.07, -0.04 + i * 0.028], metal);
  for (let i = 0; i < 7; i++) {
    box(g, [0.003, 0.027, 0.022], [0.033, 0.02, 0.21 + i * 0.034], rubber);
    box(g, [0.003, 0.027, 0.022], [-0.033, 0.02, 0.21 + i * 0.034], rubber);
  }
  box(g, [0.053, 0.035, 0.055], [0, 0.1, 0.07], metal);
  cylinder(g, 0.034, 0.092, [0, 0.153, 0.072]);
  cylinder(
    g,
    0.026,
    0.006,
    [0, 0.153, 0.12],
    new T.MeshStandardMaterial({ color: 0x42818a, metalness: 0.4, roughness: 0.12 }),
  );
  box(g, [0.043, 0.07, 0.018], [0, 0.108, 0.43], metal);
  box(g, [0.056, 0.018, 0.02], [0, 0.135, 0.43], rubber);
  box(g, [0.009, 0.016, 0.047], [0.041, -0.005, 0.035], metal);
  g.traverse((o) => (o.userData.control = 'rifle'));
  return g;
}
export function createMagazine() {
  const g = new T.Group();
  g.name = 'Magazine';
  g.userData.control = 'magazine';
  box(g, [0.057, 0.16, 0.077], [0, -0.025, 0], dark, [-0.06, 0, 0]);
  box(g, [0.064, 0.018, 0.085], [0, -0.105, 0.005], rubber);
  for (let i = 0; i < 4; i++) {
    box(g, [0.003, 0.1, 0.006], [0.029, -0.028, -0.021 + i * 0.014], rubber);
    box(g, [0.003, 0.1, 0.006], [-0.029, -0.028, -0.021 + i * 0.014], rubber);
  }
  g.traverse((o) => (o.userData.control = 'magazine'));
  return g;
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
