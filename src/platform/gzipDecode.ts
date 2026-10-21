export const NATIVE_GZIP_INPUT_CHUNK_BYTES = 1024 * 1024;
export const NATIVE_GZIP_OUTPUT_BATCH_BYTES = 1024 * 1024;
export const NATIVE_GZIP_OUTPUT_CREDITS = 4;

export function copyCompressedInput(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.slice();
}

export interface InputSlice {
  data: Uint8Array;
  nextOffset: number;
}

export function nextCompressedInputSlice(bytes: Uint8Array, offset: number): InputSlice {
  if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length)
    throw new RangeError('Compressed input offset is outside the source.');
  const nextOffset = Math.min(offset + NATIVE_GZIP_INPUT_CHUNK_BYTES, bytes.length);
  return { data: bytes.subarray(offset, nextOffset), nextOffset };
}

export class NativeOutputBatcher {
  readonly #chunks: Uint8Array[] = [];
  #firstIndex = 0;
  #firstOffset = 0;
  #byteLength = 0;

  get byteLength() {
    return this.#byteLength;
  }

  push(data: Uint8Array) {
    if (data.length === 0) return;
    this.#chunks.push(data);
    this.#byteLength += data.length;
  }

  takeFull(): Uint8Array<ArrayBuffer> | undefined {
    if (this.#byteLength < NATIVE_GZIP_OUTPUT_BATCH_BYTES) return undefined;
    return this.#take(NATIVE_GZIP_OUTPUT_BATCH_BYTES);
  }

  takeRemainder(): Uint8Array<ArrayBuffer> | undefined {
    if (this.#byteLength === 0) return undefined;
    return this.#take(Math.min(this.#byteLength, NATIVE_GZIP_OUTPUT_BATCH_BYTES));
  }

  #take(length: number): Uint8Array<ArrayBuffer> {
    const output = new Uint8Array(length);
    let outputOffset = 0;
    while (outputOffset < length) {
      const first = this.#chunks[this.#firstIndex];
      const available = first.length - this.#firstOffset;
      const copied = Math.min(available, length - outputOffset);
      output.set(first.subarray(this.#firstOffset, this.#firstOffset + copied), outputOffset);
      outputOffset += copied;
      this.#firstOffset += copied;
      this.#byteLength -= copied;
      if (this.#firstOffset === first.length) {
        this.#firstIndex++;
        this.#firstOffset = 0;
        if (this.#firstIndex === this.#chunks.length) {
          this.#chunks.length = 0;
          this.#firstIndex = 0;
        } else if (this.#firstIndex >= 64) {
          this.#chunks.splice(0, this.#firstIndex);
          this.#firstIndex = 0;
        }
      }
    }
    return output;
  }
}
