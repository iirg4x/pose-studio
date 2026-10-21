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
import {
  consumeProjectDocument,
  consumeProjectRecoverySource,
  discardProjectRecoveryRecords,
} from '../platform/projectDocuments';
import type { AnimationLibrary } from '../core/library';
import {
  projectMatchesSaveSignature,
  projectMatchesSaveSignatureAsync,
  projectSaveSignature,
  projectSaveSignatureAsync,
} from '../core/projectSaving';
import { activateDocument, linkedDocument, openedDocument } from '../platform/linkedDocuments';
import type { LinkedDocument } from '../platform/linkedDocuments';
import { checkLinkedProject } from '../platform/android';
import { reportFailure } from '../platform/feedback';
import { useModalFocus } from '../hooks/modalFocus';
type Pending =
  | { kind: 'close' }
  | { kind: 'open'; data: AnimationLibrary; source?: LinkedDocument };
type CleanStateRefs = {
  project: typeof studio.state.project;
  workspace: typeof studio.state.workspace;
  drafts: typeof studio.state.drafts;
  revision: number;
  authoredRevision: number;
};
type CleanReceipt = { baseline: string; authoredRevision: number };
/** Lets the loading screen paint before the synchronous work that follows. */
const nextPaint = () =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
export function useProjectFile(
  ready: boolean,
  blocked = false,
  settled: (shouldCancel?: () => boolean) => Promise<void> = async () => {},
  onRecoverySaved?: () => void,
) {
  const saved = useRef<string | null>(null),
    cleanReceipt = useRef<CleanReceipt | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [recoveryError, setRecoveryError] = useState(''),
    [recoveryBusy, setRecoveryBusy] = useState(false);
  const busyRef = useRef(false),
    openGeneration = useRef(0),
    openRequestGeneration = useRef(0),
    recoveredReload = useRef(false),
    recoveryBusyRef = useRef(false),
    hadRecovery = useRef(false),
    initialized = useRef(false),
    saveDialog = useRef<HTMLElement>(null),
    saveDialogCancel = useRef<HTMLButtonElement>(null);
  const dismissSaveDialog = () => {
    if (busyRef.current || recoveryBusyRef.current) return;
    if (pending?.kind === 'open') void discardProjectRecoveryRecords(pending.data).catch(() => {});
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
  const rememberClean = useCallback((baseline: string, expected?: CleanStateRefs) => {
    const state = studio.state;
    if (
      saved.current !== baseline ||
      (expected &&
        (state.project !== expected.project ||
          state.workspace !== expected.workspace ||
          state.drafts !== expected.drafts ||
          state.revision !== expected.revision ||
          studio.authoredRevision !== expected.authoredRevision))
    )
      return false;
    cleanReceipt.current = {
      baseline,
      authoredRevision: studio.authoredRevision,
    };
    return true;
  }, []);
  const cleanReceiptMatches = useCallback(() => {
    const receipt = cleanReceipt.current;
    return !!(
      receipt &&
      saved.current === receipt.baseline &&
      studio.authoredRevision === receipt.authoredRevision
    );
  }, []);
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
  const markSignatureSaved = useCallback((signature: string): Promise<void> => {
    saved.current = signature;
    cleanReceipt.current = null;
    try {
      return writePreference(BASELINE, saved.current).catch(() => {});
    } catch {}
    return Promise.resolve();
  }, []);
  const markSaved = useCallback(
    (data: AnimationLibrary) => {
      const signature = projectSaveSignature(data);
      return markSignatureSaved(signature).then(() => signature);
    },
    [markSignatureSaved],
  );
  const dirty = useCallback(() => {
    if (cleanReceiptMatches()) return false;
    const data = studio.recoverySnapshot();
    if (!data) return false;
    const baseline = saved.current;
    if (!baseline) {
      cleanReceipt.current = null;
      return true;
    }
    const matches = projectMatchesSaveSignature(data, baseline);
    if (matches) rememberClean(baseline);
    else cleanReceipt.current = null;
    return !matches;
  }, [cleanReceiptMatches, rememberClean]);
  /**
   * Compare the current workspace without monopolising the main thread.
   *
   * Opening a large library used to call the synchronous signature builder from
   * the file chooser callback. That blocked the first paint for the whole
   * library before the loading screen could appear. The asynchronous signature
   * yields between clip batches, and a revision change cancels the attempt so
   * an edit made while hashing can never be mistaken for a clean workspace.
   * Legacy v3 baselines use their exact old payload with the same yielding
   * comparison, so a dirty check never silently upgrades a saved baseline.
   */
  const dirtyAsync = useCallback(
    async (shouldCancel?: () => boolean) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (shouldCancel?.()) return false;
        if (cleanReceiptMatches()) return false;
        const baseline = saved.current,
          revision = studio.state.revision,
          authoredRevision = studio.authoredRevision,
          workspace = studio.state.workspace,
          project = studio.state.project,
          drafts = studio.state.drafts,
          data = studio.recoverySnapshot();
        if (!data) return false;
        // A missing baseline is conservatively dirty, matching dirty().
        if (!baseline) {
          cleanReceipt.current = null;
          return true;
        }
        try {
          const matches = await projectMatchesSaveSignatureAsync(
            data,
            baseline,
            () =>
              !!shouldCancel?.() ||
              studio.state.revision !== revision ||
              studio.authoredRevision !== authoredRevision ||
              studio.state.workspace !== workspace ||
              studio.state.project !== project ||
              studio.state.drafts !== drafts,
          );
          if (shouldCancel?.()) return false;
          // A save or edit may have happened while the signature yielded. Retry
          // once against the newest state; after a continuously changing state,
          // report dirty conservatively instead of opening over unsaved work.
          if (
            saved.current !== baseline ||
            studio.state.revision !== revision ||
            studio.authoredRevision !== authoredRevision ||
            studio.state.workspace !== workspace ||
            studio.state.project !== project ||
            studio.state.drafts !== drafts
          )
            continue;
          if (matches)
            rememberClean(baseline, {
              project,
              workspace,
              drafts,
              revision,
              authoredRevision,
            });
          else cleanReceipt.current = null;
          return !matches;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            if (shouldCancel?.()) return false;
            continue;
          }
          throw error;
        }
      }
      return true;
    },
    [cleanReceiptMatches, rememberClean],
  );
  const recover = async () => {
    const data = studio.recoverySnapshot();
    if (data) await writeRecovery(data);
  };
  const save = useCallback(async () => {
    const data = studio.documentSnapshot(),
      initial: CleanStateRefs = {
        project: studio.state.project,
        workspace: studio.state.workspace,
        drafts: studio.state.drafts,
        revision: studio.state.revision,
        authoredRevision: studio.authoredRevision,
      };
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
      const signature = await markSaved(data);
      rememberClean(signature, initial);
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
  }, [markSaved, rememberClean]);
  const open = useCallback(
    async (data: AnimationLibrary, source?: LinkedDocument) => {
      // Invalidate a dirty check that has not reached the open step yet. This
      // also makes direct linked-document updates safe while a file chooser
      // request is still hashing the current library.
      openRequestGeneration.current++;
      const generation = ++openGeneration.current;
      cleanReceipt.current = null;
      const recoverySource = consumeProjectRecoverySource(data);
      let current: AnimationLibrary | null = null;
      studio.patch({ opening: { name: data.name || 'project', stage: 'Building animations' } });
      try {
        await nextPaint();
        if (generation !== openGeneration.current) return;
        studio.openValidated(data);
        current = studio.recoverySnapshot();
        const initial: CleanStateRefs = {
          project: studio.state.project,
          workspace: studio.state.workspace,
          drafts: studio.state.drafts,
          revision: studio.state.revision,
          authoredRevision: studio.authoredRevision,
        };
        let recoveryPending = !!current;
        const recovery = current
          ? writeRecovery(current, recoverySource)
              .then(() => null)
              .catch((error) => error)
              .finally(() => {
                recoveryPending = false;
              })
          : Promise.resolve(null);
        // Hash bounded clip batches while models and shaders prepare. Keep the
        // loading surface up until the scene, signature and first recovery copy
        // have all settled. If the viewport wins the race, expose the remaining
        // storage work instead of making the UI appear finished early.
        const viewport = settled(() => generation !== openGeneration.current).then(() => {
            if (recoveryPending && generation === openGeneration.current && current)
              studio.patch({
                opening: { name: data.name || 'project', stage: 'Saving recovery copy' },
              });
          }),
          signature = current
            ? projectSaveSignatureAsync(current, () => generation !== openGeneration.current)
            : Promise.resolve(null),
          [viewportResult, signatureResult, recoveryResult] = await Promise.allSettled([
            viewport,
            signature,
            recovery,
          ]);
        if (generation !== openGeneration.current) return;
        if (viewportResult.status === 'rejected') throw viewportResult.reason;
        if (signatureResult.status === 'rejected') throw signatureResult.reason;
        if (recoveryResult.status === 'rejected') throw recoveryResult.reason;
        const signatureValue = signatureResult.value,
          recoveryError = recoveryResult.value;
        if (signatureValue) await markSignatureSaved(signatureValue);
        // The baseline write can outlive this open when another open starts
        // while it is pending. Do not let the older operation report success,
        // activate its linked document, or clear the newer operation's UI.
        if (generation !== openGeneration.current) return;
        if (signatureValue) rememberClean(signatureValue, initial);
        if (recoveryError) {
          const message =
            'Project opened, but local recovery could not be saved: ' +
            (recoveryError instanceof Error ? recoveryError.message : String(recoveryError));
          studio.patch({ message });
          reportFailure(message);
        } else if (
          current &&
          studio.state.project === initial.project &&
          studio.state.workspace === initial.workspace &&
          studio.state.drafts === initial.drafts &&
          studio.state.revision === initial.revision &&
          studio.authoredRevision === initial.authoredRevision
        ) {
          onRecoverySaved?.();
        }
      } catch (e) {
        if (generation !== openGeneration.current) return;
        const message = 'Could not open project: ' + (e as Error).message;
        setError(message);
        studio.patch({ message });
        reportFailure(message);
        return;
      } finally {
        if (generation === openGeneration.current) studio.patch({ opening: null });
      }
      if (isAndroid) activateDocument(source);
      setPending(null);
      setError('');
    },
    [markSignatureSaved, onRecoverySaved, rememberClean, settled],
  );
  const requestOpen = useCallback(
    async (data: unknown) => {
      const requestGeneration = ++openRequestGeneration.current;
      try {
        const source = openedDocument(data),
          validated = consumeProjectDocument(data);
        studio.patch({
          opening: { name: validated.name || 'project', stage: 'Checking unsaved changes' },
        });
        const hasChanges = await dirtyAsync(
          () => requestGeneration !== openRequestGeneration.current,
        );
        if (requestGeneration !== openRequestGeneration.current) {
          await discardProjectRecoveryRecords(data);
          return;
        }
        if (hasChanges) {
          // The unsaved-changes prompt comes first; the loading screen returns on open.
          studio.patch({ opening: null });
          setPending({ kind: 'open', data: validated, source });
          setError('');
          setRecoveryError('');
        } else await open(validated, source);
      } catch (e) {
        await discardProjectRecoveryRecords(data).catch(() => {});
        if (requestGeneration !== openRequestGeneration.current) return;
        const message = (e as Error).message;
        studio.patch({ opening: null, message });
        reportFailure('Could not open project: ' + message);
      }
    },
    [dirtyAsync, open],
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
      .then(async (data) => {
        if (data) {
          consumed = true;
          // Keep the queue gate closed until the asynchronous dirty check and
          // open have settled. Otherwise a second queued file can begin while
          // the first library is still being hashed.
          await requestOpen(data);
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
