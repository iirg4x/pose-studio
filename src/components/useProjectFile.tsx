import { encodeProject } from '../../shared/project-codec.mjs';
import {
  isAndroid,
  readPreference,
  readRecovery,
  writeRecovery,
  writePreference,
  RECOVERY,
  BASELINE,
  readRecoveryCandidates,
  listRecoveryGenerations,
} from '../platform/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { studio } from '../core/store';
import { consumeProjectDocument } from '../platform/projectDocuments';
import type { AnimationLibrary } from '../core/library';
import { projectSaveSignature } from '../core/projectSaving';
import { activateDocument, linkedDocument, openedDocument } from '../platform/linkedDocuments';
import type { LinkedDocument } from '../platform/linkedDocuments';
import { checkLinkedProject } from '../platform/android';
import { reportFailure } from '../platform/feedback';
import { useModalFocus } from '../hooks/modalFocus';
type Pending =
  | { kind: 'close' }
  | { kind: 'open'; data: AnimationLibrary; source?: LinkedDocument };
/** Lets the loading screen paint before the synchronous work that follows. */
const nextPaint = () =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
export function useProjectFile(
  ready: boolean,
  blocked = false,
  settled: () => Promise<void> = async () => {},
) {
  const saved = useRef<string | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [recoveryError, setRecoveryError] = useState(''),
    [recoveryBusy, setRecoveryBusy] = useState(false);
  const busyRef = useRef(false),
    recoveredReload = useRef(false),
    recoveryBusyRef = useRef(false),
    hadRecovery = useRef(false),
    initialized = useRef(false),
    saveDialog = useRef<HTMLElement>(null),
    saveDialogCancel = useRef<HTMLButtonElement>(null);
  const dismissSaveDialog = () => {
    if (busyRef.current || recoveryBusyRef.current) return;
    setPending(null);
    setError('');
    setRecoveryError('');
  };
  useModalFocus({
    rootRef: saveDialog,
    initialFocusRef: saveDialogCancel,
    enabled: !!pending,
    onEscape: dismissSaveDialog,
  });
  const [followProject, setFollowProjectState] = useState(
    () => localStorage.getItem('pose-follow-document') !== 'false',
  );
  const [projectUpdate, setProjectUpdate] = useState<{
      data: AnimationLibrary;
      source: LinkedDocument;
    } | null>(null),
    [projectError, setProjectError] = useState(''),
    [projectChecking, setProjectChecking] = useState(false);
  const checking = useRef(false),
    lastCheck = useRef(0),
    [, refreshLink] = useState(0);
  useEffect(() => {
    const changed = () => {
      setProjectUpdate(null);
      setProjectError('');
      refreshLink((n) => n + 1);
    };
    window.addEventListener('pose-document-link', changed);
    return () => window.removeEventListener('pose-document-link', changed);
  }, []);
  const setFollowProject = (value: boolean) => {
    localStorage.setItem('pose-follow-document', String(value));
    setFollowProjectState(value);
  };
  useEffect(() => {
    try {
      saved.current = readPreference(BASELINE);
      const hasGenerationRecovery =
        readRecoveryCandidates().length > 0 || listRecoveryGenerations().length > 0;
      hadRecovery.current = !!(
        readRecovery() ||
        readPreference(RECOVERY) ||
        localStorage.getItem('manny-studio-project-v1') ||
        hasGenerationRecovery
      );
    } catch {}
  }, []);
  const markSaved = useCallback((data: AnimationLibrary) => {
    saved.current = projectSaveSignature(data);
    try {
      void writePreference(BASELINE, saved.current).catch(() => {});
    } catch {}
  }, []);
  const dirty = useCallback(() => {
    const data = studio.recoverySnapshot();
    return !!data && projectSaveSignature(data) !== saved.current;
  }, []);
  const recover = async () => {
    const data = studio.recoverySnapshot();
    if (data) await writeRecovery(data);
  };
  const save = useCallback(async () => {
    const data = studio.documentSnapshot();
    if (!data || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (window.studioDesktop) {
        const filename = await window.studioDesktop.saveProject(data);
        if (!filename) return false;
        studio.patch({ message: 'Saved ' + filename });
      } else {
        const a = document.createElement('a');
        const url = URL.createObjectURL(
          new Blob([await encodeProject(data)], { type: 'application/octet-stream' }),
        );
        a.href = url;
        a.download = data.name + '.pose';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        // The browser exposes no completion signal for a download. Report the
        // request accurately while still treating the requested file as the
        // user's saved project for dirty-state purposes.
        studio.patch({ message: 'Download requested: ' + a.download });
      }
      markSaved(data);
      return true;
    } catch (e) {
      const message = 'Could not save: ' + (e as Error).message;
      setError(message);
      studio.patch({ message });
      reportFailure(message);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [markSaved]);
  const open = useCallback(
    async (data: AnimationLibrary, source?: LinkedDocument) => {
      studio.patch({ opening: { name: data.name || 'project', stage: 'Building animations' } });
      try {
        await nextPaint();
        studio.openValidated(data);
        await settled();
      } catch (e) {
        const message = 'Could not open project: ' + (e as Error).message;
        setError(message);
        studio.patch({ message });
        reportFailure(message);
        return;
      } finally {
        studio.patch({ opening: null });
      }
      const current = studio.recoverySnapshot();
      if (current) {
        markSaved(current);
        void writeRecovery(current).catch((e) => {
          const message =
            'Project opened, but local recovery could not be saved: ' + (e as Error).message;
          studio.patch({ message });
          reportFailure(message);
        });
      }
      if (isAndroid) activateDocument(source);
      setPending(null);
      setError('');
    },
    [markSaved, settled],
  );
  const requestOpen = useCallback(
    (data: unknown) => {
      try {
        const source = openedDocument(data),
          validated = consumeProjectDocument(data);
        if (dirty()) {
          // The unsaved-changes prompt comes first; the loading screen returns on open.
          studio.patch({ opening: null });
          setPending({ kind: 'open', data: validated, source });
          setError('');
          setRecoveryError('');
        } else void open(validated, source);
      } catch (e) {
        const message = (e as Error).message;
        studio.patch({ opening: null, message });
        reportFailure('Could not open project: ' + message);
      }
    },
    [dirty, open],
  );
  const checkProject = useCallback(
    async (manual = false) => {
      if (
        !isAndroid ||
        !ready ||
        blocked ||
        pending ||
        busyRef.current ||
        checking.current ||
        studio.state.playing ||
        (!manual && !followProject)
      )
        return;
      const source = linkedDocument(studio.state.workspace);
      if (!source) return;
      if (!manual && Date.now() - lastCheck.current < 30000) return;
      lastCheck.current = Date.now();
      checking.current = true;
      setProjectChecking(true);
      setProjectError('');
      try {
        const incoming = await checkLinkedProject(source.uri, [
          source.hash,
          ...(source.ignoredHash && !manual ? [source.ignoredHash] : []),
        ]);
        const current = linkedDocument(studio.state.workspace);
        if (!incoming || current?.uri !== source.uri || current.hash !== source.hash) return;
        const next = openedDocument(incoming);
        if (!next) throw Error('Document link was lost. Open the project again.');
        const data = consumeProjectDocument(incoming);
        if (dirty() || studio.state.playing || document.querySelector('[role="dialog"]'))
          setProjectUpdate({ data, source: next });
        else {
          open(data, next);
          studio.patch({ message: 'Project updated from ' + next.name });
        }
      } catch (e) {
        setProjectError((e as Error).message);
      } finally {
        checking.current = false;
        setProjectChecking(false);
      }
    },
    [ready, blocked, pending, followProject, dirty, open],
  );
  useEffect(() => {
    if (!isAndroid || !ready) return;
    const check = () => {
      if (document.visibilityState === 'visible') void checkProject();
    };
    const timer = setInterval(check, 5 * 60 * 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [ready, checkProject]);
  const applyProjectUpdate = async () => {
    const update = projectUpdate;
    if (!update) return;
    if (dirty() && !(await save())) return;
    try {
      await recover();
    } catch (e) {
      const message = 'Could not keep the recovery copy: ' + (e as Error).message;
      setProjectError(message);
      studio.patch({ message });
      reportFailure(message);
      return;
    }
    open(update.data, update.source);
    setProjectUpdate(null);
  };
  const ignoreProjectUpdate = () => {
    const source = linkedDocument(studio.state.workspace);
    if (source && projectUpdate)
      activateDocument({ ...source, ignoredHash: projectUpdate.source.hash });
    setProjectUpdate(null);
  };
  const beforeInstall = async () => {
    if (dirty() && !(await save())) return false;
    try {
      await recover();
      return true;
    } catch (e) {
      const message = 'Could not keep the recovery copy: ' + (e as Error).message;
      studio.patch({ message });
      reportFailure(message);
      return false;
    }
  };
  // Listen before requesting the startup file; queued OS opens wait for recovery and dialogs.
  useEffect(() => {
    if (ready && !initialized.current) {
      initialized.current = true;
      if (!hadRecovery.current) {
        const data = studio.recoverySnapshot();
        if (data) markSaved(data);
      }
    }
  }, [ready, markSaved]);
  const [queued, setQueued] = useState(0),
    opening = useRef(false),
    retryOpen = useRef(false);
  useEffect(
    () =>
      window.studioDesktop?.onProjectQueued(() => {
        retryOpen.current = true;
        setQueued((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!ready || blocked || pending || busy || opening.current || !window.studioDesktop) return;
    opening.current = true;
    retryOpen.current = false;
    let consumed = false;
    void window.studioDesktop
      .takeProject()
      .then((data) => {
        if (data) {
          consumed = true;
          requestOpen(data);
        }
      })
      .catch((e) => {
        consumed = true;
        const message = 'Could not open project: ' + (e as Error).message;
        studio.patch({ message });
        reportFailure(message);
      })
      .finally(() => {
        opening.current = false;
        if (consumed || retryOpen.current) setQueued((n) => n + 1);
      });
  }, [ready, blocked, pending, busy, queued, requestOpen]);
  const proceed = async (action: Pending) => {
    try {
      if (action.kind === 'close') {
        setPending(null);
        await window.studioDesktop?.confirmClose();
      } else await open(action.data, action.source);
    } catch (e) {
      const message = 'Could not complete the project change: ' + (e as Error).message;
      setError(message);
      studio.patch({ message });
      reportFailure(message);
      setPending(action);
    }
  };
  const finish = async () => {
    const action = pending;
    if (!action || recoveryBusyRef.current) return;
    setError('');
    setRecoveryError('');
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    try {
      await recover();
    } catch (e) {
      const message = 'Could not keep the recovery copy: ' + (e as Error).message;
      setRecoveryError(message);
      studio.patch({ message });
      reportFailure(message);
      return;
    } finally {
      recoveryBusyRef.current = false;
      setRecoveryBusy(false);
    }
    await proceed(action);
  };
  const continueWithoutRecovery = () => {
    const action = pending;
    if (!action || recoveryBusyRef.current) return;
    setRecoveryError('');
    void proceed(action);
  };
  useEffect(
    () =>
      window.studioDesktop?.onCloseRequest(async () => {
        if (busyRef.current) return;
        if (isAndroid) {
          if (pending) {
            dismissSaveDialog();
            return;
          }
          // Native Back dismisses the current dialog before it can close the editor.
          // Busy dialogs may deliberately ignore Escape while finishing an export.
          const dialogs = [
              ...document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"]'),
            ].filter((element) => !element.closest('[inert]') && element.getClientRects().length),
            dialog = dialogs[dialogs.length - 1];
          if (dialog) {
            if (dialog instanceof HTMLDialogElement)
              dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
            else
              dialog.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
              );
            return;
          }
          // Start below window so capture-phase popup handlers run before the
          // window bubble handler that closes the enclosing workspace panel.
          if (
            !document.dispatchEvent(
              new Event('pose-dismiss-overlay', { bubbles: true, cancelable: true }),
            )
          )
            return;
        }
        if (blocked) return;
        if (dirty()) {
          setPending({ kind: 'close' });
          setError('');
          setRecoveryError('');
        } else {
          try {
            await recover();
            await window.studioDesktop?.confirmClose();
          } catch (e) {
            const message = 'Could not keep the recovery copy: ' + (e as Error).message;
            setRecoveryError(message);
            studio.patch({ message });
            reportFailure(message);
            setPending({ kind: 'close' });
          }
        }
      }),
    [dirty, blocked, pending],
  );
  useEffect(() => {
    if (window.studioDesktop && window.studioDesktop.platform !== 'web') return;
    const updateReload = () => {
      recoveredReload.current = true;
    };
    const before = (e: BeforeUnloadEvent) => {
      if (!recoveredReload.current && dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    window.addEventListener('pose-before-update-reload', updateReload);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pose-before-update-reload', updateReload);
    };
  }, [dirty]);
  const dialog = pending && (
    <div className="modal-backdrop">
      <section
        ref={saveDialog}
        tabIndex={-1}
        className="modal compact-modal save-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-confirm-title"
      >
        <header>
          <h2 id="save-confirm-title">Save changes?</h2>
        </header>
        <p>
          <strong>{studio.state.workspace?.name ?? 'Your project'}</strong> has changes that have
          not been saved to a project file.
        </p>
        <p className="help-text">
          {pending.kind === 'close'
            ? 'Save before closing the editor.'
            : 'Save before opening another project.'}{' '}
          The recovery copy is separate from your saved file.
        </p>
        {error && (
          <p role="alert" className="save-error">
            {error}
          </p>
        )}
        {recoveryError && (
          <div className="save-recovery-failure" role="alert">
            <p className="save-error">{recoveryError}</p>
            <p className="help-text">
              The recovery copy could not be updated. Your saved project or requested download is
              unchanged.
            </p>
          </div>
        )}
        {recoveryError ? (
          <footer className="save-recovery-actions">
            <button disabled={busy || recoveryBusy} onClick={finish}>
              {recoveryBusy ? 'Retrying…' : 'Retry'}
            </button>
            <button
              className="primary"
              disabled={busy || recoveryBusy}
              onClick={continueWithoutRecovery}
            >
              Continue without recovery
            </button>
            <button
              ref={saveDialogCancel}
              disabled={busy || recoveryBusy}
              onClick={dismissSaveDialog}
            >
              Cancel
            </button>
          </footer>
        ) : (
          <footer>
            <button disabled={busy || recoveryBusy} onClick={finish}>
              Don't Save
            </button>
            <span className="title-spacer" />
            <button
              ref={saveDialogCancel}
              disabled={busy || recoveryBusy}
              onClick={dismissSaveDialog}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || recoveryBusy}
              onClick={async () => {
                if (await save()) await finish();
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
  return {
    save,
    busy: busy || recoveryBusy,
    requestOpen,
    dialog,
    pending: !!pending,
    beforeInstall,
    followProject,
    setFollowProject,
    projectUpdate,
    projectError,
    projectChecking,
    checkProject,
    applyProjectUpdate,
    ignoreProjectUpdate,
    linked: linkedDocument(studio.state.workspace),
  };
}
