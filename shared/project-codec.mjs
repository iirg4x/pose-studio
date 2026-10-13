// A .pose document is a gzip stream of bounded JSON records. Legacy JSON stays readable.
const MAX_RECORD = 48 * 1024 * 1024,
  MAX_TOTAL = 1024 * 1024 * 1024;
function valid(p) {
  if (!p || ![1, 2, 3].includes(p.version) || p.rig !== 'ue5-manny-simple')
    throw Error('Invalid Pose project.');
  return p;
}
export async function encodeProject(project) {
  valid(project);
  const { clips, characterAssets, ...metadata } = project;
  const layered = clips?.some((c) =>
    c.project?.layers?.some((l) => l.id === c.project.activeLayerId),
  );
  const nativeLinks = clips?.some((c) =>
    c.project?.layers?.some((l) => Object.keys(l.nativeRotationLinks ?? {}).length),
  );
  function* records() {
    yield { format: 'pose-project', version: nativeLinks ? 3 : layered ? 2 : 1 };
    yield { kind: 'metadata', value: metadata };
    if (clips)
      for (const clip of clips) {
        const p = clip.project,
          same =
            p?.tracks &&
            p.otherTracks &&
            JSON.stringify(p.tracks) === JSON.stringify(p.otherTracks),
          active = p?.layers?.find((l) => l.id === p.activeLayerId);
        // Active tracks are an alias of one layer, not a second animation. Keep the
        // latest edit once, even if the caller has not synchronized that alias yet.
        const stored = {
          ...p,
          ...(same ? { otherTracks: undefined } : {}),
          ...(active
            ? {
                tracks: undefined,
                layers: p.layers.map((l) => (l === active ? { ...l, tracks: p.tracks } : l)),
              }
            : {}),
        };
        yield {
          kind: 'clip',
          value: { ...clip, project: stored },
          ...(same ? { reuseOtherTracks: true } : {}),
          ...(active ? { reuseActiveLayerTracks: true } : {}),
        };
      }
    if (characterAssets)
      for (const [id, value] of Object.entries(characterAssets)) yield { kind: 'asset', id, value };
    yield { kind: 'end' };
  }
  const iterator = records(),
    encoder = new TextEncoder();
  let total = 0;
  const input = new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      const text = JSON.stringify(next.value) + '\n';
      total += text.length;
      if (text.length > MAX_RECORD || total > MAX_TOTAL) {
        controller.error(Error('Project exceeds the document storage limit.'));
        return;
      }
      controller.enqueue(encoder.encode(text));
    },
  });
  return new Uint8Array(
    await new Response(input.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  );
}
export async function decodeProject(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    return valid(JSON.parse(new TextDecoder().decode(bytes)));
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = '',
    total = 0,
    line = 0,
    project,
    ended = false;
  const assets = {},
    ids = new Set();
  const record = (text) => {
    if (!text) return;
    const row = JSON.parse(text);
    if (line++ === 0) {
      if (row.format !== 'pose-project' || ![1, 2, 3].includes(row.version))
        throw Error('Unsupported Pose document version.');
      return;
    }
    if (ended) throw Error('Unexpected data after the project.');
    if (row.kind === 'metadata') {
      if (project) throw Error('Duplicate project metadata.');
      project = valid(row.value);
      if (project.version === 3) project.clips = [];
    } else if (row.kind === 'clip') {
      if (!project?.clips || !row.value?.id || ids.has(row.value.id))
        throw Error('Invalid animation record.');
      ids.add(row.value.id);
      if (row.reuseActiveLayerTracks) {
        const p = row.value.project,
          active = p?.layers?.find((l) => l.id === p.activeLayerId);
        if (!active?.tracks) throw Error('Invalid active layer record.');
        p.tracks = active.tracks;
      }
      if (row.reuseOtherTracks)
        row.value.project.otherTracks = structuredClone(row.value.project.tracks);
      project.clips.push(row.value);
    } else if (row.kind === 'asset') {
      if (
        !project ||
        typeof row.id !== 'string' ||
        !/^([a-f0-9]{64}|builtin-(axe|rifle|magazine)|example-fantasy-(male|female))$/.test(
          row.id,
        ) ||
        Object.hasOwn(assets, row.id) ||
        typeof row.value !== 'string'
      )
        throw Error('Invalid asset record.');
      assets[row.id] = row.value;
    } else if (row.kind === 'end') ended = true;
    else throw Error('Unknown Pose document record.');
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_TOTAL) throw Error('Project exceeds the document storage limit.');
      buffer += value;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        if (newline > MAX_RECORD) throw Error('Project record is too large.');
        record(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > MAX_RECORD) throw Error('Project record is too large.');
    }
    if (buffer.trim()) record(buffer);
    if (!ended || !project) throw Error('Incomplete Pose document.');
    if (Object.keys(assets).length) project.characterAssets = assets;
    return valid(project);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
