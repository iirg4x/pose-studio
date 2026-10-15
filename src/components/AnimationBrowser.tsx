import { useRef, useState } from 'react';
import { Collapse, MotionPresence } from './Motion';
import { PreviewLink } from './PreviewLink';
import { ChevronDown, Link2, Plus, X } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { AnimationFolderList } from './AnimationFolderList';
import { useLibraryDisclosure } from './useLibraryDisclosure';
export function AnimationBrowser({
  close,
  create,
  context,
  open = true,
  embedded = false,
  id,
}: {
  open?: boolean;
  embedded?: boolean;
  id: string;
  close: () => void;
  create: () => void;
  context: (id: string, x: number, y: number) => void;
}) {
  const s = useStudioChrome({ frame: 'none', edits: 'live' }),
    w = s.workspace!,
    [pairingOpen, setPairingOpen] = useState(false),
    pairingContent = useRef<HTMLDivElement>(null);
  useLibraryDisclosure(pairingOpen, pairingContent);
  const active = w.clips.find((clip) => clip.id === w.activeId),
    paired = w.clips.find((clip) => clip.id === active?.previewId);
  const clips = w.clips.map((c) => {
    const p = c.id === w.activeId ? s.project! : c.project;
    return { id: c.id, name: p.name, folder: c.folder, layer: p.editing, fps: p.fps, end: p.end };
  });
  return (
    <MotionPresence show={open}>
      <section
        className="library-panel animation-library"
        aria-label="Animation library"
        id={id}
        role={embedded ? 'tabpanel' : undefined}
        aria-labelledby={embedded ? id + '-tab' : undefined}
        data-editor-overlay
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        {!embedded && (
          <header className="animation-library-actions">
            <h3>
              Animations <small>{w.clips.length}</small>
            </h3>
            <button
              className="library-create-action"
              data-command="true"
              aria-label="Create animation"
              title="New animation (Ctrl N)"
              onClick={() => {
                close();
                create();
              }}
            >
              <Plus size={16} />
              <span>New action…</span>
            </button>
            <button aria-label="Close animation library" title="Close" onClick={close}>
              <X size={16} />
            </button>
          </header>
        )}
        <AnimationFolderList
          clips={clips}
          activeId={w.activeId}
          onOpen={(id) => {
            studio.activate(id);
            close();
          }}
          context={context}
        />
        <div className="library-preview-pairing">
          <button
            className="library-preview-toggle"
            aria-expanded={pairingOpen}
            aria-controls={id + '-pairing'}
            onClick={() => setPairingOpen(!pairingOpen)}
          >
            <Link2 size={16} />
            <span>Preview pairing</span>
            {paired && <small title={paired.project.name}>Linked</small>}
            <ChevronDown className="property-chevron" data-open={pairingOpen} size={16} />
          </button>
          <Collapse open={pairingOpen}>
            <div className="library-preview-settings" id={id + '-pairing'} ref={pairingContent}>
              <p className="library-preview-context" title={s.project?.name}>
                {s.project?.name}
              </p>
              <PreviewLink />
            </div>
          </Collapse>
        </div>
      </section>
    </MotionPresence>
  );
}
