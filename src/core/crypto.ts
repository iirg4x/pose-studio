// LAN HTTP pages have getRandomValues, but browsers reserve randomUUID and
// SubtleCrypto for secure contexts. Keep project IDs and asset checks working
// on the local network without changing their formats.
export function randomId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = globalThis.crypto.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data.slice().buffer))
    : (await import('@noble/hashes/sha2.js')).sha256(data);
  return Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('');
}
