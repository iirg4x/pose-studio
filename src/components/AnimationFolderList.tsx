import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Folder,
  Home,
  MoreHorizontal,
  PersonStanding,
  Search,
  X,
} from 'lucide-react';
import { animationFolderRows, animationLeafName } from '../core/animationFolders';
import type { FolderClip } from '../core/animationFolders';
import { isTouch } from '../platform/storage';

export function AnimationFolderList({
  clips,
  activeId,
  onOpen,
  context,
}: {
  clips: FolderClip[];
  activeId?: string;
  onOpen: (id: string) => void;
  context?: (id: string, x: number, y: number) => void;
}) {
  const [path, setPath] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(360),
    list = useRef<HTMLDivElement>(null),
    breadcrumbs = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => animationFolderRows(clips, path, query), [clips, path, query]),
    rowHeight = isTouch ? 60 : 44,
    start = Math.max(0, Math.floor(scroll / rowHeight) - 3),
    end = Math.min(rows.length, start + Math.ceil(height / rowHeight) + 7);
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    if (breadcrumbs.current) breadcrumbs.current.scrollLeft = breadcrumbs.current.scrollWidth;
    setScroll(0);
  }, [query, path]);
  const navigate = (next: string[]) => {
    setPath(next);
    setQuery('');
  };
  const focusRow = (index: number) => {
    if (!rows.length) return;
    const target = (index + rows.length) % rows.length,
      node = list.current;
    if (!node) return;
    const top = target * rowHeight;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + rowHeight > node.scrollTop + node.clientHeight)
      node.scrollTop = top + rowHeight - node.clientHeight;
    setScroll(node.scrollTop);
    requestAnimationFrame(() =>
      node.querySelector<HTMLButtonElement>('[data-folder-row="' + target + '"]')?.focus(),
    );
  };
  return (
    <div className="animation-folders">
      <div className="library-search">
        <Search size={16} />
        <input
          autoFocus={!isTouch}
          aria-label="Find animation"
          placeholder="Search all folders…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusRow(0);
            }
          }}
        />
        {query && (
          <button aria-label="Clear animation search" onClick={() => setQuery('')}>
            <X size={16} />
          </button>
        )}
      </div>
      <nav className="animation-folder-path" aria-label="Animation folder">
        <button
          aria-label="Back to parent folder"
          disabled={!path.length && !query}
          onClick={() => (query ? setQuery('') : navigate(path.slice(0, -1)))}
        >
          <ArrowLeft size={16} />
        </button>
        <div ref={breadcrumbs}>
          <button aria-label="All animation folders" onClick={() => navigate([])}>
            <Home size={14} />
            <span>Animations</span>
          </button>
          {path.map((name, i) => (
            <span key={i}>
              <ChevronRight size={12} />
              <button
                aria-current={i === path.length - 1 ? 'location' : undefined}
                onClick={() => navigate(path.slice(0, i + 1))}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
      </nav>
      {query && (
        <div className="animation-search-summary">{rows.length} results in all folders</div>
      )}
      <div
        className="animation-folder-results"
        ref={list}
        role="list"
        aria-label={query ? 'Animation search results' : (path.at(-1) ?? 'Animation folders')}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        <div aria-hidden style={{ height: start * rowHeight }} />
        {rows.slice(start, end).map((row, offset) => {
          const clip = row.kind === 'clip' ? row.clip : null,
            Icon = clip ? (clip.layer === 'body' ? PersonStanding : Camera) : Folder,
            name = clip
              ? query
                ? clip.name
                : animationLeafName(clip)
              : row.kind === 'folder'
                ? row.name
                : '';
          return (
            <div
              className={'animation-folder-row ' + (clip ? 'clip-row' : 'folder-row')}
              role="listitem"
              key={clip?.id ?? JSON.stringify(row.kind === 'folder' && row.path)}
              style={{ height: rowHeight }}
            >
              <button
                data-folder-row={start + offset}
                className="animation-folder-item"
                aria-label={(clip ? 'Open ' : 'Open folder ') + (clip?.name ?? name)}
                aria-current={clip && activeId === clip.id ? 'true' : undefined}
                onClick={() =>
                  clip ? onOpen(clip.id) : row.kind === 'folder' && navigate(row.path)
                }
                onContextMenu={(e) => {
                  if (clip && context) {
                    e.preventDefault();
                    context(clip.id, e.clientX, e.clientY);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    focusRow(start + offset + (e.key === 'ArrowDown' ? 1 : -1));
                  } else if (e.key === 'ArrowLeft' && path.length) {
                    e.preventDefault();
                    navigate(path.slice(0, -1));
                  }
                }}
              >
                <Icon size={18} />
                <span>
                  <strong>{name}</strong>
                  {clip && (
                    <small>
                      {query && clip.folder?.length
                        ? clip.folder.join(' / ')
                        : `${clip.fps} fps · ${clip.end + 1} frames`}
                    </small>
                  )}
                </span>
                {row.kind === 'folder' && (
                  <>
                    <small className="folder-count">{row.count}</small>
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
              {clip && context && (
                <button
                  className="animation-actions"
                  aria-label={'Actions for ' + clip.name}
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    context(clip.id, box.left, box.bottom);
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
              )}
            </div>
          );
        })}
        <div aria-hidden style={{ height: Math.max(0, rows.length - end) * rowHeight }} />
        {!rows.length && (
          <p className="empty-library">
            {query ? 'No matching animations.' : 'This folder is empty.'}
          </p>
        )}
      </div>
    </div>
  );
}
