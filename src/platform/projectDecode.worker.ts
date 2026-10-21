import {
  NativeOutputBatcher,
  nextCompressedInputSlice,
  NATIVE_GZIP_OUTPUT_CREDITS,
} from './gzipDecode';

type IncomingMessage =
  | { type: 'decode'; data: Uint8Array<ArrayBuffer> }
  | { type: 'credit'; count: number };

interface WorkerScope {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const scope = self as unknown as WorkerScope;
let started = false;
let settled = false;
let credits = 0;
let wakeCredit: (() => void) | undefined;

function finish(message: unknown) {
  if (settled) return;
  settled = true;
  try {
    scope.postMessage(message);
  } finally {
    scope.close();
  }
}

function addCredits(count: number) {
  if (!Number.isInteger(count) || count <= 0) return;
  credits = Math.min(NATIVE_GZIP_OUTPUT_CREDITS, credits + count);
  wakeCredit?.();
  wakeCredit = undefined;
}

async function takeCredit() {
  while (credits === 0 && !settled)
    await new Promise<void>((resolve) => {
      wakeCredit = resolve;
    });
  if (settled) throw new Error('Project decompression was cancelled.');
  credits--;
}

function compressedStream(bytes: Uint8Array) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const slice = nextCompressedInputSlice(bytes, offset);
      offset = slice.nextOffset;
      controller.enqueue(slice.data);
    },
  });
}

async function decode(bytes: Uint8Array<ArrayBuffer>) {
  const reader = compressedStream(bytes).pipeThrough(new DecompressionStream('gzip')).getReader();
  const batches = new NativeOutputBatcher();
  for (;;) {
    const fullBatch = batches.takeFull();
    if (fullBatch) {
      await takeCredit();
      scope.postMessage({ type: 'data', data: fullBatch }, [fullBatch.buffer]);
      continue;
    }
    const result = await reader.read();
    if (!result.done) {
      batches.push(result.value);
      continue;
    }
    const remainder = batches.takeRemainder();
    if (remainder) {
      await takeCredit();
      scope.postMessage({ type: 'data', data: remainder }, [remainder.buffer]);
    }
    finish({ type: 'done' });
    return;
  }
}

scope.onmessage = (event) => {
  if (settled) return;
  const message = event.data;
  if (message.type === 'credit') {
    addCredits(message.count);
    return;
  }
  if (started) {
    finish({ type: 'error', message: 'Project decoder was initialized twice.' });
    return;
  }
  started = true;
  void decode(message.data).catch((error: unknown) =>
    finish({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
};
