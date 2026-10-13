import { hostedClip } from '../platform/browser';
import { encodeProject } from '../../shared/project-codec.mjs';
import {
  isAndroid,
  readPreference,
  readRecovery,
  writeRecovery,
  writePreference,
  RECOVERY,
  BASELINE,
} from '../platform/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { studio } from '../core/store';
import { consumeProjectDocument } from '../platform/projectDocuments';
import type { AnimationLibrary } from '../core/library';
import { projectSaveSignature, extendHostedSaveBaseline } from '../core/projectSaving';
import { activateDocument, linkedDocument, openedDocument } from '../platform/linkedDocuments';
import type { LinkedDocument } from '../platform/linkedDocuments';
import { checkLinkedProject } from '../platform/android';
type Pending =
  | { kind: 'close' }
  | { kind: 'open'; data: AnimationLibrary; source?: LinkedDocument };
export function useProjectFile(ready: boolean, blocked = false) {
  const saved = useRef<string | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const busyRef = useRef(false),
    hadRecovery = useRef(false),
    initialized = useRef(false);
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
      hadRecovery.current = !!(
        readRecovery() ||
        readPreference(RECOVERY) ||
        localStorage.getItem('manny-studio-project-v1')
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
        a.href = URL.createObjectURL(
          new Blob([await encodeProject(data)], { type: 'application/octet-stream' }),
        );
        a.download = data.name + '.pose';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      markSaved(data);
      return true;
    } catch (e) {
      const message = 'Could not save: ' + (e as Error).message;
      setError(message);
      studio.patch({ message });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [markSaved]);
  const open = useCallback(
    (data: AnimationLibrary, source?: LinkedDocument) => {
      studio.openValidated(data);
      const current = studio.recoverySnapshot();
      if (current) {
        markSaved(current);
        void writeRecovery(current).catch((e) =>
          studio.patch({
            message:
              'Project opened, but local recovery could not be saved: ' + (e as Error).message,
          }),
        );
      }
      if (isAndroid) activateDocument(source);
      if (window.poseHost) localStorage.setItem('pose-host-clip', data.activeId);
      setPending(null);
      setError('');
    },
    [markSaved],
  );
  const requestOpen = useCallback(
    (data: unknown) => {
      try {
        const source = openedDocument(data),
          validated = consumeProjectDocument(data);
        if (dirty()) {
          setPending({ kind: 'open', data: validated, source });
          setError('');
        } else open(validated, source);
      } catch (e) {
        studio.patch({ message: (e as Error).message });
      }
    },
    [dirty, open],
  );
  const includeHosted = useCallback((data: unknown, activate = true) => {
    const before = studio.recoverySnapshot();
    studio.openHostedAnimations(data, activate);
    const after = studio.recoverySnapshot();
    if (before && after) {
      saved.current = extendHostedSaveBaseline(saved.current, before, after);
      if (saved.current) void writePreference(BASELINE, saved.current).catch(() => {});
      localStorage.setItem('pose-host-clip', after.activeId);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const openHosted = async (event: Event) => {
      if (busyRef.current || blocked || pending) return;
      const id = (event as CustomEvent<string>).detail;
      if (!window.poseHost?.clips.some((c) => c.id === id)) return;
      const existing = studio.state.workspace?.clips.find((c) => c.id === id),
        base = existing?.project.layers?.[0],
        needsLinks =
          base?.static && base.source && existing!.project.layers!.length > 1 && !base.poseLinks,
        needsSource = base?.poseLinks?.some(
          (link) => !studio.state.workspace!.clips.some((c) => c.id === link.clipId),
        );
      if (existing && !needsLinks && !needsSource) {
        studio.activate(id);
        localStorage.setItem('pose-host-clip', id);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      studio.patch({ message: 'Loading animation from your PC…' });
      try {
        const data = await hostedClip(id);
        if (!cancelled) includeHosted(data);
      } catch (e) {
        studio.patch({ message: (e as Error).message });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };
    window.addEventListener('pose-open-host-clip', openHosted);
    return () => {
      cancelled = true;
      window.removeEventListener('pose-open-host-clip', openHosted);
    };
  }, [includeHosted, blocked, pending]);
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
    await recover();
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
    await recover();
    return true;
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
          const recovered =
            window.studioDesktop?.platform === 'web' &&
            window.poseHost &&
            studio.state.workspace?.clips.some((c) =>
              window.poseHost!.clips.some((host) => host.id === c.id),
            );
          if (recovered) includeHosted(data, false);
          else requestOpen(data);
        }
      })
      .catch((e) => {
        consumed = true;
        studio.patch({ message: 'Could not open project: ' + (e as Error).message });
      })
      .finally(() => {
        opening.current = false;
        if (consumed || retryOpen.current) setQueued((n) => n + 1);
      });
  }, [ready, blocked, pending, busy, queued, requestOpen, includeHosted]);
  const finish = async () => {
    if (!pending) return;
    setError('');
    try {
      await recover();
      if (pending.kind === 'close') window.studioDesktop?.confirmClose();
      else open(pending.data, pending.source);
    } catch (e) {
      setError('Could not keep the recovery copy: ' + (e as Error).message);
    }
  };
  useEffect(
    () =>
      window.studioDesktop?.onCloseRequest(async () => {
        if (busyRef.current) return;
        if (isAndroid) {
          if (pending) {
            setPending(null);
            return;
          }
          // Native Back dismisses the current dialog before it can close the editor.
          // Busy dialogs may deliberately ignore Escape while finishing an export.
          const dialogs = document.querySelectorAll('[role="dialog"]'),
            dialog = dialogs[dialogs.length - 1];
          if (dialog) {
            dialog.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            );
            return;
          }
          if (!window.dispatchEvent(new Event('pose-dismiss-overlay', { cancelable: true })))
            return;
        }
        if (blocked) return;
        if (dirty()) {
          setPending({ kind: 'close' });
          setError('');
        } else {
          try {
            await recover();
            await window.studioDesktop?.confirmClose();
          } catch (e) {
            setError((e as Error).message);
            setPending({ kind: 'close' });
          }
        }
      }),
    [dirty, blocked, pending],
  );
  useEffect(() => {
    if (window.studioDesktop && window.studioDesktop.platform !== 'web') return;
    const before = (e: BeforeUnloadEvent) => {
      if (dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  const dialog = pending && (
    <div className="modal-backdrop">
      <section
        className="modal compact-modal save-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-confirm-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) setPending(null);
        }}
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
        <footer>
          <button disabled={busy} onClick={finish}>
            Don't Save
          </button>
          <span className="title-spacer" />
          <button autoFocus disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (await save()) await finish();
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
  return {
    save,
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
