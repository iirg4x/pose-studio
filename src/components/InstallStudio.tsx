import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Download, Share, PlusSquare, X, RefreshCw } from 'lucide-react';
import {
  appInstallSnapshot,
  subscribeAppInstall,
  checkAppUpdate,
  getPwaDiagnostics,
} from '../platform/pwa';
import './install-studio.css';

export function InstallStudio({
  close,
  exiting = false,
}: {
  close: () => void;
  exiting?: boolean;
}) {
  const state = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot),
    dialog = useRef<HTMLDialogElement>(null);
  const [diagnosticCopy, setDiagnosticCopy] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    dialog.current?.showModal();
    const node = dialog.current;
    return () => node?.close();
  }, []);
  const apple =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const status = {
    preparing: 'Downloading for offline use…',
    ready: 'Ready for offline use',
    update: 'Update ready',
    unavailable: 'Offline installation needs HTTPS',
    error: 'Offline download interrupted',
  }[state.status];
  return (
    <dialog
      ref={dialog}
      className="install-studio"
      role="dialog"
      data-editor-overlay
      data-motion="popover"
      data-state={exiting ? 'closing' : 'open'}
      inert={exiting || undefined}
      aria-hidden={exiting || undefined}
      aria-labelledby="install-title"
      onCancel={close}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)
        )
          close();
      }}
    >
      <header>
        <span className="install-flair">POSE STUDIO</span>
        <button aria-label="Close install instructions" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <img src="icons/icon-192.png" width="72" height="72" alt="" />
      <h2 id="install-title">
        {state.installed ? 'Your pocket studio.' : 'Make room for your next idea.'}
      </h2>
      <p>
        {state.installed
          ? 'Pose is installed. Your projects are saved on this device.'
          : 'Add Pose to your Home Screen for a full-screen animation workspace, ready offline.'}
      </p>
      {!state.installed &&
        (apple ? (
          <ol>
            <li>
              <Share size={19} />
              <span>
                Open this page in <strong>Safari</strong> and tap <strong>Share</strong>.
              </span>
            </li>
            <li>
              <PlusSquare size={19} />
              <span>
                Choose <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li>
              <CheckCircle2 size={19} />
              <span>
                Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.
              </span>
            </li>
          </ol>
        ) : (
          <ol>
            <li>
              <Download size={19} />
              <span>
                Open your browser menu and choose <strong>Install app</strong> or{' '}
                <strong>Add to Home Screen</strong>.
              </span>
            </li>
          </ol>
        ))}
      <div className={'install-status ' + state.status} role="status">
        <CheckCircle2 size={18} />
        <span>
          {status}
          {!state.online ? ' · Offline' : ''}
        </span>
      </div>
      {state.status === 'update' && (
        <p className="install-note">
          Save your project first. Then close{' '}
          <strong>all Pose tabs and any installed Pose Home Screen app</strong> before reopening
          Pose. A browser refresh alone does not apply this update, and an open project is never
          reloaded automatically.
        </p>
      )}
      {state.status === 'error' && (
        <p className="install-note">
          Reconnect and retry. Leave Pose open until the offline download finishes.
        </p>
      )}
      <p className="install-note">
        Open your .pose files from Files or Drive. Use Save project to keep a separate copy.
      </p>
      <details className="install-details">
        <summary>App details</summary>
        <pre className="install-diagnostics">{getPwaDiagnostics()}</pre>
        <div className="install-diagnostics-actions">
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                  await navigator.clipboard.writeText(getPwaDiagnostics());
                  setDiagnosticCopy('copied');
                } catch {
                  setDiagnosticCopy('error');
                }
              })();
            }}
          >
            Copy diagnostics
          </button>
          <span role="status" aria-live="polite">
            {diagnosticCopy === 'copied'
              ? 'Copied'
              : diagnosticCopy === 'error'
                ? 'Copy unavailable'
                : 'Local only'}
          </span>
        </div>
      </details>
      <footer>
        <button onClick={() => void checkAppUpdate({ force: true })}>
          <RefreshCw size={16} />
          {state.status === 'error' ? 'Retry download' : 'Check for updates'}
        </button>
        <button className="install-done" onClick={close}>
          Back to studio
        </button>
      </footer>
    </dialog>
  );
}
