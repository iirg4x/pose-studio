import { useState } from 'react';
import { Camera, PersonStanding, Link2, X } from 'lucide-react';
import { useStudio } from '../hooks';
import { studio } from '../core/store';
import type { ControlId, Pose, RigLayer } from '../core/model';
export function NewActionDialog({
  initial,
  rest,
  close,
}: {
  initial: RigLayer;
  rest: Partial<Record<ControlId, Pose>>;
  close: () => void;
}) {
  const s = useStudio(),
    clips = s.workspace!.clips;
  const suggest = (_type: RigLayer) => 'New animation';
  const [type, setType] = useState(initial),
    [name, setName] = useState(() => suggest(initial)),
    [sourceId, setSourceId] = useState(''),
    [error, setError] = useState('');
  const sources = clips.filter((c) => c.project.editing !== type),
    source = sources.find((c) => c.id === sourceId),
    sourceLabel = type === 'body' ? 'First-person' : 'Full-body';
  return (
    <div className="modal-backdrop">
      <form
        className="modal compact-modal new-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-action-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            studio.createAction(rest, name, type, sourceId || undefined);
            close();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <header>
          <h2 id="new-action-title">New animation</h2>
          <button type="button" aria-label="Close new animation" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="segmented action-type">
          {(['firstPerson', 'body'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={type === v}
              onClick={() => {
                setType(v);
                setSourceId('');
                if (name === suggest(type)) setName(suggest(v));
                setError('');
              }}
            >
              {v === 'firstPerson' ? <Camera size={15} /> : <PersonStanding size={15} />}
              <span>{v === 'firstPerson' ? 'First person' : 'Full body'}</span>
            </button>
          ))}
        </div>
        <label className="action-field">
          Name
          <input
            autoFocus
            aria-label="New animation name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="action-field">
          Start from
          <select
            aria-label={sourceLabel + ' base'}
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Blank animation</option>
            {type === 'body' && !s.project?.actionType && !s.project?.bodyBase && (
              <option value={'legacy:' + s.workspace?.activeId}>Copy existing body track</option>
            )}
            {sources.map((c) => (
              <option key={c.id} value={c.id}>
                {c.project.name}
              </option>
            ))}
          </select>
        </label>
        {source ? (
          <div className="action-source-summary">
            <Link2 size={15} />
            <div>
              <strong>Linked to {source.project.name}</strong>
              <p>
                {type === 'firstPerson'
                  ? 'Body motion drives the arms and props. Frame the player camera and add your own first-person corrections.'
                  : 'First-person motion drives the body. Add body corrections; head, neck and legs start independent.'}
              </p>
              <small>
                {source.project.fps} fps · {source.project.end + 1} frames · source edits stay in
                sync
              </small>
            </div>
          </div>
        ) : (
          <p className="help-text">
            {type === 'firstPerson'
              ? 'Independent first-person animation. No full-body counterpart is required.'
              : 'Independent full-body animation. No first-person counterpart is required.'}
          </p>
        )}
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create animation
          </button>
        </footer>
      </form>
    </div>
  );
}
