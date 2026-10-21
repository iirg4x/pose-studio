import { decodeProject } from '../../shared/project-codec.mjs';
import { copyCompressedInput, NATIVE_GZIP_OUTPUT_CREDITS } from './gzipDecode';

const WORKER_DECODE_MIN_BYTES = 4 * 1024 * 1024;

type WorkerMessage =
  | { type: 'data'; data: Uint8Array<ArrayBuffer> }
  | { type: 'done' }
  | { type: 'error'; message: string };

function workerDecompressionStream(bytes: Uint8Array) {
  const compressed = copyCompressedInput(bytes);
  const worker = new Worker(new URL('./projectDecode.worker.ts', import.meta.url), {
    type: 'module',
  });
  let active = true;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let outstandingCredits = 0;

  const terminate = () => {
    if (!active) return;
    active = false;
    worker.terminate();
  };
  const fail = (error: unknown) => {
    if (!active) return;
    controller?.error(error instanceof Error ? error : new Error(String(error)));
    terminate();
  };
  const grantCredits = () => {
    if (!active || !controller) return;
    const desiredSize = Math.max(0, controller.desiredSize ?? 0);
    const queuedBatches =
      NATIVE_GZIP_OUTPUT_CREDITS - Math.min(NATIVE_GZIP_OUTPUT_CREDITS, desiredSize);
    const count = NATIVE_GZIP_OUTPUT_CREDITS - outstandingCredits - queuedBatches;
    if (count <= 0) return;
    try {
      worker.postMessage({ type: 'credit', count });
      outstandingCredits += count;
    } catch (error) {
      fail(error);
    }
  };

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    if (!active) return;
    const message = event.data;
    if (message.type === 'data') {
      outstandingCredits = Math.max(0, outstandingCredits - 1);
      controller?.enqueue(message.data);
      grantCredits();
      return;
    }
    if (message.type === 'done') {
      controller?.close();
      terminate();
      return;
    }
    fail(new Error(message.message));
  };
  worker.onerror = (event) => fail(new Error(event.message || 'Project decoder worker failed.'));
  worker.onmessageerror = () => fail(new Error('Project decoder worker returned invalid data.'));

  return new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController;
        try {
          worker.postMessage({ type: 'decode', data: compressed }, [compressed.buffer]);
          grantCredits();
        } catch (error) {
          fail(error);
        }
      },
      pull() {
        grantCredits();
      },
      cancel() {
        terminate();
      },
    },
    { highWaterMark: NATIVE_GZIP_OUTPUT_CREDITS, size: () => 1 },
  );
}

function canUseWorkerDecoder(bytes: Uint8Array) {
  return (
    bytes.length >= WORKER_DECODE_MIN_BYTES &&
    bytes[0] === 0x1f &&
    bytes[1] === 0x8b &&
    bytes[2] === 8 &&
    typeof Worker !== 'undefined' &&
    typeof DecompressionStream !== 'undefined'
  );
}

export async function decodeDocumentProject(bytes: Uint8Array | Blob): Promise<any> {
  if (!(bytes instanceof Uint8Array) || !canUseWorkerDecoder(bytes)) return decodeProject(bytes);
  try {
    return await decodeProject(bytes, () => workerDecompressionStream(bytes));
  } catch {
    return decodeProject(bytes);
  }
}
