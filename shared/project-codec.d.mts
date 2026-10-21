export function encodeProject(project: unknown): Promise<Uint8Array<ArrayBuffer>>;
export function decodeProject(
  bytes: Uint8Array | Blob,
  decompress?: (bytes: Uint8Array | Blob) => ReadableStream<Uint8Array>,
): Promise<any>;
