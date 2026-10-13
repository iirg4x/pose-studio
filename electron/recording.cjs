const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
// Only an approved save-dialog path enters this writer. Canceling never touches an existing video.
function createRecordingWriter() {
  let active = null;
  const session = (id) => {
    if (!active || id !== active.id) throw Error('Unknown recording.');
    return active;
  };
  return {
    get busy() {
      return !!active;
    },
    async begin(filename) {
      if (active) throw Error('A recording is already being exported.');
      const id = randomUUID(),
        temp = filename + '.' + id + '.tmp',
        file = await fs.open(temp, 'wx');
      active = { id, filename, temp, file, tail: Promise.resolve(), failed: null };
      return { id, path: filename };
    },
    async write(id, data, position) {
      const s = session(id);
      if (
        !(data instanceof Uint8Array) ||
        data.byteLength > 8 * 1024 * 1024 ||
        !Number.isSafeInteger(position) ||
        position < 0 ||
        position + data.byteLength > 32 * 1024 ** 3
      )
        throw Error('Invalid recording data.');
      const operation = s.tail.then(async () => {
        if (s.failed) throw s.failed;
        let offset = 0;
        while (offset < data.byteLength) {
          const { bytesWritten } = await s.file.write(
            data,
            offset,
            data.byteLength - offset,
            position + offset,
          );
          if (!bytesWritten) throw Error('Could not write the recording.');
          offset += bytesWritten;
        }
      });
      s.tail = operation.catch((error) => {
        s.failed = error;
      });
      await operation;
    },
    async finish(id) {
      const s = session(id);
      await s.tail;
      if (s.failed) throw s.failed;
      await s.file.sync();
      await s.file.close();
      await fs.rename(s.temp, s.filename);
      active = null;
      return s.filename;
    },
    async cancel(id) {
      if (!active) return;
      const s = session(id);
      await s.tail;
      await s.file.close().catch(() => {});
      await fs.unlink(s.temp).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      active = null;
    },
  };
}
module.exports = { createRecordingWriter };
