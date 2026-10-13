import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CheckCircle2, Download, Share, PlusSquare, X, RefreshCw } from 'lucide-react';
import { appInstallSnapshot, subscribeAppInstall, checkAppUpdate } from '../platform/pwa';
import './install-studio.css';

export function InstallStudio({ close }: { close: () => void }) {
  const state = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot),
    dialog = useRef<HTMLDialogElement>(null);
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
      aria-labelledby="install-title"
      onCancel={close}
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
          Close all Pose windows and reopen to apply the update. Updates never interrupt an open
          project.
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
      <footer>
        <button onClick={() => void checkAppUpdate()}>
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
