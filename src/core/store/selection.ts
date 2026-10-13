import { visibleControls, controlEnabled } from '../model';
import type { ControlId } from '../model';
import { StoreCore } from './core';

/** Which controls are selected or hidden. */
export class SelectionStore extends StoreCore {
  setControlVisible(id: ControlId, visible: boolean) {
    const layer = this.state.project?.editing ?? 'firstPerson';
    const hidden = this.state.hiddenControls[layer].filter((x) => x !== id);
    if (!visible) hidden.push(id);
    this.saveControlVisibility({ ...this.state.hiddenControls, [layer]: hidden });
  }
  showControls(visible: boolean) {
    const layer = this.state.project?.editing ?? 'firstPerson';
    this.saveControlVisibility({
      ...this.state.hiddenControls,
      [layer]: visible ? [] : visibleControls(layer, this.state.project),
    });
  }
  selectControl(id: ControlId, extend = false) {
    if (
      this.state.project &&
      !controlEnabled(this.state.project, id, this.state.frame) &&
      typeof window !== 'undefined'
    )
      window.dispatchEvent(new CustomEvent('pose-activate-control', { detail: id }));
    this.setControlVisible(id, true);
    const selection = extend
      ? this.state.selection.includes(id)
        ? this.state.selection.filter((x) => x !== id)
        : [...this.state.selection, id]
      : [id];
    this.patch({ selected: selection.at(-1) ?? id, selection, timelineSelection: [] });
  }
  selectAll() {
    const p = this.state.project;
    if (!p) return;
    const selection = visibleControls(p.editing, p).filter(
      (id) => this.controlVisible(id) && controlEnabled(p, id, this.state.frame),
    );
    this.patch({ selection, message: selection.length + ' controls selected' });
  }
  deselectAll() {
    this.patch({ selection: [], message: 'Selection cleared' });
  }
  invertSelection() {
    const p = this.state.project;
    if (!p) return;
    const selection = visibleControls(p.editing, p).filter(
      (id) =>
        this.controlVisible(id) &&
        controlEnabled(p, id, this.state.frame) &&
        !this.state.selection.includes(id),
    );
    this.patch({ selection, selected: selection.at(-1) ?? this.state.selected });
  }
  hideSelected(others = false) {
    const p = this.state.project;
    if (!p) return;
    const ids = visibleControls(p.editing, p).filter((id) =>
      others ? !this.state.selection.includes(id) : this.state.selection.includes(id),
    );
    this.saveControlVisibility({
      ...this.state.hiddenControls,
      [p.editing]: Array.from(new Set([...this.state.hiddenControls[p.editing], ...ids])),
    });
  }
}
