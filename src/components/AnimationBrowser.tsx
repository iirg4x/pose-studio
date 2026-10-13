import { MotionPresence } from './Motion';
import { PreviewLink } from './PreviewLink';
import { Plus, FolderInput, X } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { AnimationFolderList } from './AnimationFolderList';
export function AnimationBrowser({
  close,
  create,
  importClips,
  context,
  open = true,
}: {
  open?: boolean;
  close: () => void;
  create: () => void;
  importClips: () => void;
  context: (id: string, x: number, y: number) => void;
}) {
  const s = useStudioChrome({ frame: 'none', edits: 'live' }),
    w = s.workspace!;
  const clips = w.clips.map((c) => {
    const p = c.id === w.activeId ? s.project! : c.project;
    return { id: c.id, name: p.name, folder: c.folder, layer: p.editing, fps: p.fps, end: p.end };
  });
  return (
    <MotionPresence show={open}>
      <section
        className="library-panel animation-library"
        aria-label="Animation library"
        data-editor-overlay
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <h3>
            Animations <small>{w.clips.length}</small>
          </h3>
          <div className="library-header-tools">
            <button
              aria-label="Import animations"
              title="Import animations"
              onClick={() => {
                close();
                importClips();
              }}
            >
              <FolderInput size={16} />
            </button>
            <button
              aria-label="Create animation"
              title="New animation (Ctrl N)"
              onClick={() => {
                close();
                create();
              }}
            >
              <Plus size={17} />
            </button>
            <button aria-label="Close animation library" title="Close" onClick={close}>
              <X size={16} />
            </button>
          </div>
        </header>
        <AnimationFolderList
          clips={clips}
          activeId={w.activeId}
          onOpen={(id) => {
            studio.activate(id);
            close();
          }}
          context={context}
        />
        <PreviewLink />
      </section>
    </MotionPresence>
  );
}
