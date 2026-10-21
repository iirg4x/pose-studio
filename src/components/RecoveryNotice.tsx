import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, ArchiveRestore } from 'lucide-react';
import {
  getRecoveryState,
  subscribeRecoveryState,
  readFailedRecovery,
  readRecoveryGeneration,
  resolveFailedRecovery,
  writeRecovery,
} from '../platform/storage';
import { reportFailure } from '../platform/feedback';
import { validateLibrary } from '../core/library';
import { studio } from '../core/store';
import { useModalFocus } from '../hooks/modalFocus';
import './reliability.css';

export function RecoveryNotice() {
  const state = useSyncExternalStore(subscribeRecoveryState, getRecoveryState);
  const ready = useSyncExternalStore(studio.subscribe, () => studio.state.ready);
  const root = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [allowDiscard, setAllowDiscard] = useState(false);
  useEffect(() => {
    setAllowDiscard(false);
    setSelected('');
  }, [state.problem?.id]);
  useModalFocus({ rootRef: root, enabled: state.writeHeld && ready });
  if (!ready || !state.writeHeld || !state.problem) return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    await resolveFailedRecovery('preserve');
    const data = studio.recoverySnapshot();
    if (data && !getRecoveryState().writeHeld) await writeRecovery(data);
  };
  return (
    <div className="modal-backdrop" data-editor-overlay>
      <section
        ref={root}
        tabIndex={-1}
        className="modal compact-modal recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
      >
        <header>
          <h2 id="recovery-title">Your recovery copy needs attention</h2>
        </header>
        <p role="alert">{state.problem.message}</p>
        <p>
          Autosave is paused so it cannot replace the failed copy. Keep the original backup before
          continuing, or restore an earlier version.
        </p>
        <div className="reliability-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const backup = await readFailedRecovery();
                if (!backup) throw Error('The original recovery copy is unavailable.');
                const url = URL.createObjectURL(new Blob([backup.content], { type: backup.type }));
                const link = document.createElement('a');
                link.href = url;
                link.download = backup.name;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 30_000);
              })
            }
          >
            <Download size={16} />
            Download original
          </button>
          <button disabled={busy} onClick={() => void run(resume)}>
            <ArchiveRestore size={16} />
            Keep backup and continue
          </button>
        </div>
        {!state.problem.archiveDurable && (
          <div className="recovery-versions">
            <p>
              A local backup could not be stored. Download the original before removing its failed
              recovery record.
            </p>
            <label>
              <input
                type="checkbox"
                checked={allowDiscard}
                onChange={(event) => setAllowDiscard(event.target.checked)}
              />{' '}
              I have a backup or want to discard this failed copy.
            </label>
            <button
              disabled={busy || !allowDiscard}
              onClick={() =>
                void run(async () => {
                  await resolveFailedRecovery('discard');
                  const data = studio.recoverySnapshot();
                  if (data && !getRecoveryState().writeHeld) await writeRecovery(data);
                })
              }
            >
              Discard failed copy and continue
            </button>
          </div>
        )}
        {state.generations.some((entry) => entry.id !== state.problem?.candidateId) && (
          <div className="recovery-versions">
            <label htmlFor="recovery-version">Saved recovery versions</label>
            <select
              id="recovery-version"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Choose a version…</option>
              {state.generations
                .filter((entry) => entry.id !== state.problem?.candidateId)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · {new Date(entry.createdAt).toLocaleString()}
                  </option>
                ))}
            </select>
            <button
              disabled={busy || !selected}
              onClick={() =>
                void run(async () => {
                  const raw = await readRecoveryGeneration(selected);
                  const document = validateLibrary(typeof raw === 'string' ? JSON.parse(raw) : raw);
                  await resolveFailedRecovery('preserve');
                  studio.openValidated(document);
                  const data = studio.recoverySnapshot();
                  if (data && !getRecoveryState().writeHeld) await writeRecovery(data);
                })
              }
            >
              Restore selected version
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
