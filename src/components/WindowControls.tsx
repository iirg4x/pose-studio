import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';

export function WindowControls() {
  const desktop = window.studioDesktop?.platform === 'desktop' ? window.studioDesktop : undefined,
    [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true,
      receivedEvent = false;
    const unsubscribe = desktop.onWindowState((state) => {
      receivedEvent = true;
      setMaximized(state.maximized);
    });
    desktop
      .status()
      .then((state) => {
        if (active && !receivedEvent) setMaximized(state.maximized);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  if (!desktop) return null;
  return (
    <div className="window-buttons">
      <button
        title="Minimize"
        aria-label="Minimize"
        onClick={() => desktop.windowAction('minimize')}
      >
        <Minus size={15} />
      </button>
      <button
        title={maximized ? 'Restore down' : 'Maximize'}
        aria-label={maximized ? 'Restore down' : 'Maximize'}
        onClick={() => desktop.windowAction('maximize')}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        className="window-close"
        title="Close"
        aria-label="Close"
        onClick={() => desktop.windowAction('close')}
      >
        <X size={17} />
      </button>
    </div>
  );
}
