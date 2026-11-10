import { useEffect, useRef, useState } from 'react';
import { Boxes, Save, Video, X } from 'lucide-react';
import type { StudioScene } from '../scene/StudioScene';
import { RecordingDialog } from './RecordingDialog';
import { ExportDialog } from './ExportDialog';
export function AndroidExportDialog({
  runtime,
  save,
  close,
}: {
  runtime: StudioScene | null;
  save: () => Promise<boolean>;
  close: () => void;
}) {
  const [record, setRecord] = useState(false),
    [unreal, setUnreal] = useState(false),
    [busy, setBusy] = useState(false),
    first = useRef<HTMLButtonElement>(null);
  // Focus starts inside the dialog, so Escape and the keyboard work immediately.
  useEffect(() => first.current?.focus(), [record]);
  if (record) return <RecordingDialog runtime={runtime} close={close} />;
  if (unreal) return <ExportDialog runtime={runtime} close={close} />;
  return (
    <div className="modal-backdrop">
      <section
        className="modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <header>
          <h2>Take your animation with you</h2>
          <button aria-label="Close export" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="android-export-options">
          <button
            ref={first}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (await save()) close();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save size={24} />
            <span>
              Pose project<small>Editable animation, models and props · .pose</small>
            </span>
          </button>
          <button disabled={busy} onClick={() => setRecord(true)}>
            <Video size={24} />
            <span>
              Video recording<small>60 fps · choose your camera and loop count</small>
            </span>
          </button>
          <button disabled={busy} onClick={() => setUnreal(true)}>
            <Boxes size={24} />
            <span>
              Unreal package<small>FBX meshes, animations and props · .zip</small>
            </span>
          </button>
        </div>
        <p className="help-text">
          For one character's animation as GLB or FBX, select a preview model and use Export.
        </p>
      </section>
    </div>
  );
}
