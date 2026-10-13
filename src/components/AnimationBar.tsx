import { DeleteAnimationDialog } from './DeleteAnimationDialog';
import { MotionPresence, MotionOverlay } from './Motion';
import { HostedAnimations } from './HostedAnimations';
import { isTouch as isAndroid } from '../platform/storage';
import { RenameAnimationDialog } from './RenameAnimationDialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  X,
  Copy,
  ClipboardPaste,
  Library,
  BookmarkPlus,
  Trash2,
  Camera,
  PersonStanding,
  Save,
} from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome, usePresence } from '../hooks';
import { AnimationBrowser } from './AnimationBrowser';
import { AnimationMenu } from './AnimationMenu';
import { InlineName } from './InlineName';
export function AnimationBar({
  create,
  importClips,
  embedded = false,
}: {
  create: () => void;
  importClips: () => void;
  embedded?: boolean;
}) {
  const s = useStudioChrome({ frame: 'none', edits: 'live' }),
    [panel, setPanel] = useState<'animations' | 'poses' | null>(embedded ? 'animations' : null),
    [poseName, setPoseName] = useState(''),
    [scope, setScope] = useState<'rig' | 'control'>('rig'),
    [deleting, setDeleting] = useState<string | null>(null),
    [removing, setRemoving] = useState<string | null>(null),
    [renaming, setRenaming] = useState<string | null>(null),
    [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null),
    root = useRef<HTMLDivElement>(null);
  const libraryPresence = usePresence(panel === 'animations' ? true : null);
  const w = s.workspace;
  const cancelRename = useCallback(() => setRenaming(null), []);
  const focusTab = (id: string) =>
    requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLButtonElement>(
          '[data-animation-id="' + CSS.escape(id) + '"] [role=tab]',
        )
        ?.focus();
    });
  const closePanel = () => {
    setPanel(embedded ? 'animations' : null);
    requestAnimationFrame(() => {
      if (!document.querySelector('[role=dialog]'))
        root.current?.querySelector<HTMLButtonElement>('.library-toggle')?.focus();
    });
  };
  useEffect(() => {
    if (!panel && !context) return;
    const close = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('.animation-context-menu')
      ) {
        if (!embedded) setPanel(null);
        setContext(null);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanel(null);
        setContext(null);
      }
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape);
    };
  }, [panel, context]);
  useEffect(() => {
    root.current
      ?.querySelector('.animation-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [w?.activeId, w?.openIds.length]);
  if (!w || !s.project) return <div className="animation-bar" />;
  const clips = w.clips.map((c) =>
    c.id === w.activeId ? { ...c, project: s.project!, frame: s.frame } : c,
  );
  const beginRename = (id: string) => {
    if (!isAndroid && !studio.state.workspace?.openIds.includes(id)) studio.activate(id);
    setContext(null);
    if (!isAndroid) setPanel(null);
    setRenaming(id);
  };
  const nextTab = (id: string, delta: number) => {
    const i = w.openIds.indexOf(id),
      next = w.openIds[(i + delta + w.openIds.length) % w.openIds.length];
    studio.activate(next);
    focusTab(next);
  };
  const duplicate = (id: string) => {
    if (studio.state.workspace?.activeId !== id) studio.activate(id);
    studio.addAnimation({}, false, true);
    const next = studio.state.workspace?.activeId;
    if (next && next !== id) beginRename(next);
    setContext(null);
  };
  const showContext = (id: string, x: number, y: number) => setContext({ id, x, y });
  return (
    <div className="animation-bar" ref={root}>
      {embedded && (
        <nav className="embedded-library-tabs" aria-label="Animation library sections">
          <button aria-pressed={panel === 'animations'} onClick={() => setPanel('animations')}>
            Animations
          </button>
          <button aria-pressed={panel === 'poses'} onClick={() => setPanel('poses')}>
            Saved poses
          </button>
        </nav>
      )}
      <button
        className={'library-toggle ' + (panel === 'animations' ? 'active' : '')}
        aria-label="Animation browser"
        aria-expanded={panel === 'animations'}
        onClick={() => {
          setContext(null);
          setPanel(panel === 'animations' && !embedded ? null : 'animations');
        }}
        title="Browse project animations"
      >
        <Library size={17} />
        <b>{window.poseHost?.clips.length ?? clips.length}</b>
      </button>
      <div className="animation-tabs-area">
        <div className="animation-tabs" role="tablist" aria-label="Open animations">
          {w.openIds.map((id) => {
            const clip = clips.find((c) => c.id === id)!,
              Icon = clip.project.editing === 'body' ? PersonStanding : Camera;
            return (
              <div
                className={'animation-tab ' + (id === w.activeId ? 'active' : '')}
                data-animation-id={id}
                data-layer={clip.project.editing}
                key={id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showContext(id, e.clientX, e.clientY);
                }}
              >
                {renaming === id && !isAndroid ? (
                  <>
                    <Icon className="tab-type-icon" size={15} />
                    <InlineName
                      name={clip.project.name}
                      save={(name) => {
                        studio.renameAnimation(id, name);
                        setRenaming(null);
                        focusTab(id);
                      }}
                      cancel={() => {
                        setRenaming(null);
                        focusTab(id);
                      }}
                    />
                  </>
                ) : (
                  <button
                    role="tab"
                    aria-selected={id === w.activeId}
                    aria-label={clip.project.name}
                    title={
                      clip.project.name +
                      ' · ' +
                      clip.project.fps +
                      ' fps · Right-click for actions'
                    }
                    tabIndex={id === w.activeId ? 0 : -1}
                    onClick={() => {
                      setPanel(null);
                      setContext(null);
                      studio.activate(id);
                    }}
                    onDoubleClick={() => beginRename(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        e.stopPropagation();
                        nextTab(id, e.key === 'ArrowRight' ? 1 : -1);
                      } else if (e.key === 'F2') {
                        e.preventDefault();
                        e.stopPropagation();
                        beginRename(id);
                      } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        showContext(id, r.left, r.bottom);
                      }
                    }}
                  >
                    <Icon className="tab-type-icon" size={15} />
                    <span className="clip-name">{clip.project.name}</span>
                  </button>
                )}
                <button
                  className="close-tab"
                  aria-label={'Close ' + clip.project.name + ' tab'}
                  title="Close tab · animation stays in the project"
                  onClick={() => studio.closeAnimation(id)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          className="new-animation"
          title="New animation (Ctrl N)"
          aria-label="New animation"
          onClick={() => {
            setPanel(null);
            create();
          }}
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="pose-toolbar">
        <button
          aria-label="Copy selected pose"
          title="Copy selected pose (Ctrl C); Ctrl Shift C copies the whole rig"
          onClick={() => studio.copySelectedPose()}
        >
          <Copy size={15} />
        </button>
        <button
          aria-label="Paste pose"
          disabled={
            !s.clipboard || (s.clipboard.scope === 'rig' && s.clipboard.layer !== s.project.editing)
          }
          title={s.clipboard ? 'Paste ' + s.clipboard.name + ' (Ctrl V)' : 'Copy a pose first'}
          onClick={() => studio.pastePose()}
        >
          <ClipboardPaste size={15} />
        </button>
        <button
          aria-label="Pose library"
          title="Pose library"
          className={panel === 'poses' ? 'active' : ''}
          aria-expanded={panel === 'poses'}
          onClick={() => {
            setContext(null);
            setPanel(panel === 'poses' ? null : 'poses');
          }}
        >
          <BookmarkPlus size={16} />
          {w.poses.length > 0 && <b>{w.poses.length}</b>}
        </button>
      </div>
      {libraryPresence.value &&
        (window.poseHost ? (
          <HostedAnimations open={panel === 'animations'} close={closePanel} />
        ) : (
          <AnimationBrowser
            open={panel === 'animations'}
            close={closePanel}
            create={create}
            importClips={importClips}
            context={showContext}
          />
        ))}
      {context && (
        <AnimationMenu
          tabs={!embedded}
          x={context.x}
          y={context.y}
          rename={() => beginRename(context.id)}
          duplicate={() => duplicate(context.id)}
          remove={() => {
            setDeleting(context.id);
            setContext(null);
          }}
          closeTab={() => {
            studio.closeAnimation(context.id);
            setContext(null);
          }}
          closeOthers={() => {
            studio.closeOtherAnimations(context.id);
            setContext(null);
          }}
          dismiss={() => {
            setContext(null);
            focusTab(context.id);
          }}
        />
      )}
      {deleting && (
        <DeleteAnimationDialog
          name={clips.find((c) => c.id === deleting)?.project.name ?? 'Animation'}
          last={clips.length === 1}
          cancel={() => setDeleting(null)}
          remove={() => {
            studio.deleteAnimation(deleting);
            setDeleting(null);
          }}
        />
      )}
      <MotionOverlay show={isAndroid && !!renaming}>
        <RenameAnimationDialog
          name={clips.find((c) => c.id === renaming)?.project.name ?? ''}
          cancel={cancelRename}
          save={(name) => {
            studio.renameAnimation(renaming!, name);
            setRenaming(null);
          }}
        />
      </MotionOverlay>
      <MotionPresence show={panel === 'poses'}>
        <section
          className="library-panel pose-library"
          aria-label="Pose library"
          data-editor-overlay
        >
          <header>
            <h3>Reusable poses</h3>
            <button aria-label="Close pose library" onClick={() => setPanel(null)}>
              <X size={16} />
            </button>
          </header>
          <p className="library-hint">
            Save a pose here, then apply it in any animation. Applying a pose inserts keys at the
            playhead.
          </p>
          <form
            className="save-pose-form"
            onSubmit={(e) => {
              e.preventDefault();
              studio.savePose(poseName, scope);
              setPoseName('');
            }}
          >
            <input
              aria-label="Saved pose name"
              placeholder="Name this pose…"
              maxLength={100}
              value={poseName}
              onChange={(e) => setPoseName(e.target.value)}
            />
            <div>
              <select
                aria-label="Save pose scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as 'rig' | 'control')}
              >
                <option value="rig">Whole rig + props</option>
                <option value="control">Selected control</option>
              </select>
              <button
                className="primary"
                aria-label="Save pose"
                title="Save pose"
                disabled={!poseName.trim()}
              >
                <Save size={15} />
              </button>
            </div>
          </form>
          <div className="library-list">
            {w.poses.length === 0 ? (
              <p className="empty-library">
                Your saved poses will appear here.
                <br />
                They travel with this project.
              </p>
            ) : (
              w.poses.map((pose) => (
                <div className="saved-pose-row" key={pose.id}>
                  <button
                    className="library-item"
                    disabled={pose.scope === 'rig' && pose.layer !== s.project!.editing}
                    title={
                      pose.scope === 'rig' && pose.layer !== s.project!.editing
                        ? 'Switch to ' +
                          (pose.layer === 'body' ? 'Full body' : 'First person') +
                          ' to apply this pose'
                        : 'Apply and key ' + pose.name
                    }
                    onClick={() => studio.pastePose(pose)}
                  >
                    <BookmarkPlus size={16} />
                    <span>
                      <strong>{pose.name}</strong>
                      <small>
                        {pose.layer === 'firstPerson' ? 'First person' : 'Full body'} ·{' '}
                        {pose.scope === 'rig' ? 'Rig + props' : 'Control'}
                      </small>
                    </span>
                  </button>
                  {removing === pose.id ? (
                    <div className="remove-pose-confirm">
                      <button
                        onClick={() => {
                          studio.removePose(pose.id);
                          setRemoving(null);
                        }}
                      >
                        Remove
                      </button>
                      <button onClick={() => setRemoving(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      className="remove-pose"
                      aria-label={'Remove pose ' + pose.name}
                      onClick={() => setRemoving(pose.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="library-hint">
            Rig poses keep destination contacts and camera motion. Copy a camera separately with
            Copy control.
          </p>
        </section>
      </MotionPresence>
    </div>
  );
}
