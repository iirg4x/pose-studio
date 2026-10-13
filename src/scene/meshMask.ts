import * as T from 'three';
import { skinWeightFor } from './skinInfluences';
export function maskedGeometry(
  mesh: T.SkinnedMesh,
  include: RegExp,
  threshold = 0.45,
  keepVertex?: (index: number) => boolean,
) {
  const geometry = mesh.geometry,
    si = geometry.getAttribute('skinIndex'),
    index = geometry.index;
  const accepted = (n: number) =>
    skinWeightFor(mesh, n, (name) => include.test(name)) > threshold &&
    (!keepVertex || keepVertex(n));
  const result = geometry.clone(),
    indices: number[] = [];
  result.clearGroups();
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: index?.count ?? si.count, materialIndex: 0 }];
  for (const group of groups) {
    const start = indices.length;
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const a = index ? index.getX(i) : i,
        b = index ? index.getX(i + 1) : i + 1,
        c = index ? index.getX(i + 2) : i + 2;
      if (accepted(a) && accepted(b) && accepted(c)) indices.push(a, b, c);
    }
    result.addGroup(start, indices.length - start, group.materialIndex);
  }
  result.setIndex(indices);
  result.computeBoundingSphere();
  return result;
}
