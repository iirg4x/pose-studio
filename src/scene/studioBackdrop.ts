import {
  DataTexture,
  RGBAFormat,
  FloatType,
  EquirectangularReflectionMapping,
  LinearSRGBColorSpace,
  LinearFilter,
  Color,
} from 'three';
/** Linear HDR data keeps the floor fade and backdrop in the same tone-mapping space. */
export function createStudioBackdrop() {
  const width = 128,
    height = 512,
    data = new Float32Array(width * height * 4),
    color = new Color();
  const stops: [number, number[]][] = [
    [0, [28, 35, 44]],
    [0.35, [48, 56, 66]],
    [0.46, [69, 77, 88]],
    [0.54, [69, 77, 88]],
    [0.72, [34, 43, 55]],
    [1, [15, 21, 30]],
  ];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1),
      i = Math.max(
        0,
        Math.min(
          stops.length - 2,
          stops.findIndex((_, index) => index < stops.length - 1 && v <= stops[index + 1][0]),
        ),
      ),
      [a, ca] = stops[i],
      [b, cb] = stops[i + 1],
      t = (v - a) / (b - a),
      u = t * t * (3 - 2 * t);
    color
      .setRGB(
        (ca[0] + (cb[0] - ca[0]) * u) / 255,
        (ca[1] + (cb[1] - ca[1]) * u) / 255,
        (ca[2] + (cb[2] - ca[2]) * u) / 255,
      )
      .convertSRGBToLinear();
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data[at] = color.r;
      data[at + 1] = color.g;
      data[at + 2] = color.b;
      data[at + 3] = 1;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.name = 'Studio cyclorama';
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
