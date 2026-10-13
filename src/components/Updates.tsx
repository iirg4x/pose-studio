import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, CloudDownload, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { PluginListenerHandle } from '@capacitor/core';
import { appUpdates } from '../platform/appUpdates';
import type { AppUpdate } from '../platform/appUpdates';
import type { useProjectFile } from './useProjectFile';
import { studio } from '../core/store';

// A quiet control beside recovery status; downloads never interrupt the canvas.
export function Updates({
  file,
  blocked,
}: {
  file: ReturnType<typeof useProjectFile>;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false),
    [release, setRelease] = useState<AppUpdate | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [progress, setProgress] = useState(0),
    [notice, setNotice] = useState('');
  const [automatic, setAutomatic] = useState(
    () => localStorage.getItem('pose-auto-update') !== 'false',
  );
  const working = useRef(false),
    lastCheck = useRef(0),
    active = useRef(true);
  const download = useCallback(async () => {
    setBusy('Downloading update');
    setProgress(0);
    try {
      const result = await appUpdates.download();
      if (active.current) setRelease(result);
    } finally {
      if (active.current) setBusy('');
    }
  }, []);
  const check = useCallback(
    async (manual = false) => {
      if (working.current || (!manual && Date.now() - lastCheck.current < 6 * 60 * 60 * 1000))
        return;
      working.current = true;
      lastCheck.current = Date.now();
      setBusy('Checking for updates');
      setError('');
      try {
        const result = await appUpdates.check();
        if (!active.current) return;
        setRelease(result);
        setBusy('');
        if (automatic && result.available && !result.ready && !result.metered) await download();
      } catch (e) {
        if (active.current) setError((e as Error).message);
      } finally {
        working.current = false;
        if (active.current) setBusy('');
      }
    },
    [automatic, download],
  );
  useEffect(() => {
    active.current = true;
    const show = () => setOpen(true),
      resume = () => {
        if (document.visibilityState === 'visible') void check();
      };
    window.addEventListener('pose-show-updates', show);
    document.addEventListener('visibilitychange', resume);
    const handles: PluginListenerHandle[] = [];
    let removed = false;
    for (const [event, fn] of [
      ['progress', (e: { progress?: number }) => setProgress(e.progress ?? 0)],
      ['resume', resume],
    ] as const)
      void appUpdates.addListener(event, fn).then((h) => {
        if (removed) void h.remove();
        else handles.push(h);
      });
    const timer = setInterval(resume, 6 * 60 * 60 * 1000);
    void check();
    return () => {
      active.current = false;
      removed = true;
      handles.forEach((h) => void h.remove());
      clearInterval(timer);
      window.removeEventListener('pose-show-updates', show);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [check]);
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const install = async () => {
    if (blocked || working.current) return;
    working.current = true;
    setBusy('Preparing update');
    try {
      if (!(await file.beforeInstall())) return;
      const result = await appUpdates.install();
      setNotice(
        result?.permissionNeeded
          ? 'Allow Pose to install updates in Android settings, then tap Install update again.'
          : 'Confirm the update in Android. Your recovery copy is saved.',
      );
    } finally {
      working.current = false;
      setBusy('');
    }
  };
  const pending = release?.available || file.projectUpdate;
  const title =
    busy || release?.available
      ? busy || (release?.ready ? 'Update ready' : 'Update available')
      : release
        ? 'Pose is up to date'
        : 'App updates';
  return (
    <>
      <button
        className={'update-indicator ' + (pending ? 'available' : '')}
        aria-label={pending ? 'Updates available' : 'App and project updates'}
        title={title}
        disabled={blocked}
        onClick={() => setOpen(true)}
      >
        {busy ? <LoaderCircle size={16} className="spin" /> : <CloudDownload size={17} />}
        <span>
          {release?.ready && release.available
            ? 'Install update'
            : file.projectUpdate
              ? 'Project update'
              : ''}
        </span>
        {pending && <i />}
      </button>
      {open && (
        <div className="modal-backdrop">
          <section
            className="modal updates-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="updates-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <header>
              <div>
                <h2 id="updates-title">Updates</h2>
                <p>Keep Pose and your open project current.</p>
              </div>
              <button aria-label="Close updates" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <section className="update-section">
              <div className="update-heading">
                <strong>Pose for Android</strong>
                <span>{release?.currentVersion ?? '0.8.22'}</span>
              </div>
              <div className="update-state">
                {busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : release && !release.available ? (
                  <Check size={18} />
                ) : (
                  <ArrowDownToLine size={18} />
                )}
                <div>
                  <strong>
                    {busy ||
                      (!release
                        ? 'Check for the latest version'
                        : release.available
                          ? 'Version ' +
                            release.version +
                            (release.ready ? ' is ready' : ' is available')
                          : 'You’re up to date')}
                  </strong>
                  {release?.available && (
                    <p>{release.notes || 'A new version of Pose is available.'}</p>
                  )}
                </div>
              </div>
              {busy === 'Downloading update' && (
                <progress aria-label="App download progress" value={progress} max={1} />
              )}
              <label className="update-option">
                <input
                  type="checkbox"
                  checked={automatic}
                  onChange={(e) => {
                    setAutomatic(e.target.checked);
                    localStorage.setItem('pose-auto-update', String(e.target.checked));
                  }}
                />
                <span>
                  Download app updates automatically on Wi-Fi
                  <small>Android asks you to confirm installation.</small>
                </span>
              </label>
              {release?.available && (
                <button
                  className="primary"
                  disabled={!!busy || blocked}
                  onClick={() =>
                    void run(
                      release.ready
                        ? install
                        : async () => {
                            working.current = true;
                            try {
                              await download();
                            } finally {
                              working.current = false;
                            }
                          },
                    )
                  }
                >
                  {release.ready
                    ? 'Install update'
                    : 'Download ' + (release.size / 1048576).toFixed(1) + ' MB'}
                </button>
              )}
              {notice && <p className="help-text">{notice}</p>}
              {error && (
                <p role="alert" className="update-error">
                  {error}
                </p>
              )}
            </section>
            <section className="update-section">
              <div className="update-heading">
                <strong>Project updates</strong>
                <span>Private</span>
              </div>
              <p className="linked-project">{file.linked?.name ?? 'No linked project'}</p>
              <label className="update-option">
                <input
                  type="checkbox"
                  checked={file.followProject}
                  onChange={(e) => file.setFollowProject(e.target.checked)}
                />
                <span>
                  Follow the opened project file
                  <small>
                    Checks when you return and every five minutes while paused. Local edits are
                    kept.
                  </small>
                </span>
              </label>
              <p className="help-text">
                For remote updates, open the project directly from Google Drive in Android’s file
                picker. A file in Downloads follows that local copy.
              </p>
              {file.projectUpdate && (
                <div className="project-revision">
                  <strong>A newer project revision is available</strong>
                  <p>Your current work will be saved before loading it.</p>
                  <div>
                    <button
                      className="primary"
                      disabled={blocked || !!busy}
                      onClick={() => void run(file.applyProjectUpdate)}
                    >
                      Save copy and load update
                    </button>
                    <button onClick={file.ignoreProjectUpdate}>Keep local version</button>
                  </div>
                </div>
              )}
              {file.projectError && (
                <p role="alert" className="update-error">
                  {file.projectError}
                </p>
              )}
            </section>
            <footer>
              <button
                disabled={!!busy || file.projectChecking || blocked}
                onClick={() => {
                  void check(true);
                  void file.checkProject(true);
                }}
              >
                <RefreshCw size={15} />
                {file.projectChecking ? 'Checking project…' : 'Check now'}
              </button>
              <span className="title-spacer" />
              <button
                onClick={() => {
                  setOpen(false);
                  studio.patch({ message: 'Updates run in the background' });
                }}
              >
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
