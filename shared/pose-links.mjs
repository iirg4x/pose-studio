const assetKey = (asset) => asset?.split('.')[0];
const authoredAsset = (p) =>
  assetKey([...(p.layers ?? [])].reverse().find((l) => l.source?.asset)?.source.asset);
const part = (id) => id === 'magazine' || id.startsWith('prop:');

// Upgrade old snapshot layers using their recorded source asset, never a
// display name. Prefer the variant with the same weapon geometry.
export function inferPoseLinks(data) {
  const byAsset = new Map();
  for (const clip of data.clips) {
    const asset = authoredAsset(clip.project);
    if (asset) {
      const entries = byAsset.get(asset) ?? [];
      entries.push(clip);
      byAsset.set(asset, entries);
    }
  }
  let changed = false;
  const clips = data.clips.map((clip) => {
    const p = clip.project,
      base = p.layers?.[0];
    if (
      !base?.static ||
      base.poseLinks ||
      p.layers.length < 2 ||
      !base.source?.asset ||
      authoredAsset(p) === assetKey(base.source.asset)
    )
      return clip;
    const candidates = (byAsset.get(assetKey(base.source.asset)) ?? []).filter(
      (c) => c.id !== clip.id && c.project.editing === p.editing,
    );
    const source =
      candidates.find((c) => c.project.props?.rifle?.asset === p.props?.rifle?.asset) ??
      candidates[0];
    if (!source) return clip;
    const partsOnly = base.source.asset.includes('/Weapons/'),
      controls = Object.keys(base.tracks).filter((id) => (partsOnly ? part(id) : !part(id)));
    changed = true;
    return {
      ...clip,
      project: {
        ...p,
        layers: p.layers.map((l, i) =>
          i ? l : { ...l, poseLinks: [{ clipId: source.id, frame: base.source.frame, controls }] },
        ),
      },
    };
  });
  return changed ? { ...data, clips } : data;
}
