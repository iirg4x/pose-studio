/**
 * Read the flattened picture stored at the end of a Photoshop file.
 * Layers are ignored: this is the same merged image other tools show for a PSD texture.
 */
export function decodePsd(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 26 || view.getUint32(0) !== 0x38425053 || view.getUint16(4) !== 1) return null;
  const channels = view.getUint16(12),
    height = view.getUint32(14),
    width = view.getUint32(18),
    depth = view.getUint16(22),
    mode = view.getUint16(24);
  // 8-bit RGB or greyscale, at a size a texture could sensibly have.
  if (depth !== 8 || (mode !== 3 && mode !== 1) || !width || !height || width * height > 1 << 26)
    return null;
  let at = 26;
  for (let section = 0; section < 3; section++) at += 4 + view.getUint32(at);
  const compression = view.getUint16(at);
  at += 2;
  const size = width * height,
    colour = mode === 3 ? 3 : 1,
    used = Math.min(channels, colour + 1),
    planes: Uint8Array[] = [];
  if (compression === 0) {
    for (let c = 0; c < used; c++) planes.push(bytes.subarray(at + c * size, at + (c + 1) * size));
  } else if (compression === 1) {
    // PackBits rows, preceded by one byte count per row for every channel.
    let data = at + channels * height * 2;
    for (let c = 0; c < channels; c++) {
      const plane = new Uint8Array(size);
      let out = 0;
      for (let y = 0; y < height; y++) {
        const end = data + view.getUint16(at + (c * height + y) * 2),
          stop = (y + 1) * width;
        while (data < end && out < stop) {
          const n = view.getInt8(data++);
          if (n >= 0) {
            plane.set(bytes.subarray(data, data + n + 1), out);
            data += n + 1;
            out += n + 1;
          } else if (n !== -128) {
            plane.fill(bytes[data++], out, out + 1 - n);
            out += 1 - n;
          }
        }
        data = end;
        out = stop;
      }
      if (c < used) planes.push(plane);
    }
  } else return null;
  if (planes.length < colour || planes.some((p) => p.length < size)) return null;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    data[i * 4] = planes[0][i];
    data[i * 4 + 1] = planes[colour === 3 ? 1 : 0][i];
    data[i * 4 + 2] = planes[colour === 3 ? 2 : 0][i];
    data[i * 4 + 3] = planes.length > colour ? planes[colour][i] : 255;
  }
  return { data, width, height };
}
