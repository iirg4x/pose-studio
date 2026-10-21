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
function gzipStream(input) {
  if (input instanceof Blob) return input.stream().pipeThrough(new DecompressionStream('gzip'));
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= input.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 1024 * 1024, input.length);
      controller.enqueue(input.subarray(offset, end));
      offset = end;
    },
  }).pipeThrough(new DecompressionStream('gzip'));
}

/** Decode the bounded newline-delimited record stream. */
async function decodeProjectStream(source) {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let total = 0,
    line = 0,
    project,
    ended = false,
    fragments = [],
    recordLength = 0;
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
        !/^([a-f0-9]{64}|builtin-(axe|rifle|magazine|unreal-fp-gun)|example-fantasy-(male|female))$/.test(
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
  const consumeText = (text) => {
    if (!text) return;
    total += text.length;
    if (total > MAX_TOTAL) throw Error('Project exceeds the document storage limit.');
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf('\n', start);
      if (newline < 0) {
        const fragment = text.slice(start);
        fragments.push(fragment);
        recordLength += fragment.length;
        if (recordLength > MAX_RECORD) throw Error('Project record is too large.');
        break;
      }
      const fragment = text.slice(start, newline);
      if (fragment) {
        fragments.push(fragment);
        recordLength += fragment.length;
      }
      if (recordLength > MAX_RECORD) throw Error('Project record is too large.');
      record(fragments.join(''));
      fragments = [];
      recordLength = 0;
      start = newline + 1;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        // Flush a pending UTF-8 sequence exactly as TextDecoderStream does at
        // EOF, including its replacement-character behavior for incomplete
        // input.
        consumeText(decoder.decode());
        break;
      }
      consumeText(decoder.decode(value, { stream: true }));
    }
    if (recordLength) {
      const buffer = fragments.join('');
      if (buffer.trim()) record(buffer);
    }
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

export async function decodeProject(input, decompress = gzipStream) {
  if (input instanceof Blob) {
    const header = new Uint8Array(await input.slice(0, 2).arrayBuffer());
    if (header[0] !== 0x1f || header[1] !== 0x8b) return valid(JSON.parse(await input.text()));
    return decodeProjectStream(decompress(input));
  }
  if (input[0] !== 0x1f || input[1] !== 0x8b)
    return valid(JSON.parse(new TextDecoder().decode(input)));
  return decodeProjectStream(decompress(input));
}
