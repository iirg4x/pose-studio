export const SHORTCUTS = [
  ['Shift G', 'Toggle Game View (hide editor overlays)'],
  ['Numpad 0', 'Toggle full player camera view'],
  [', / .', 'Orientation / pivot menu'],
  ['Shift + right-click', 'Place 3D cursor on the view plane'],
  ['B / left-drag', 'Box select timeline keys or viewport controls'],
  ['Shift / Ctrl + box', 'Add to / subtract from a box selection'],
  ['Timeline: A / Alt A', 'Select all / clear keys'],
  ['Timeline: G, number, Enter', 'Move selected keys by a number of frames'],
  ['Timeline: Ctrl C / Ctrl V', 'Copy keys / paste into the active animation'],
  ['Timeline: arrows / Shift arrows', 'Move selected keys by 1 / 10 frames'],
  ['MMB / Shift MMB', 'Orbit / pan the viewport'],
  ['MMB during G or R', 'Lock the transform to the pointed axis'],
  ['A / Alt A', 'Select all / deselect all visible controls'],
  ['Shift-click', 'Add or remove a control from the selection'],
  ['Ctrl I', 'Invert selection'],
  ['G / R', 'Move / rotate selected controls'],
  ['X / Y / Z', 'Constrain a running transform to an Unreal axis'],
  ['Number, Enter', 'Set distance in cm or angle in degrees'],
  ['Esc / right-click', 'Cancel the running transform'],
  ['Alt G / Alt R', 'Reset selected location / rotation'],
  ['H / Shift H / Alt H', 'Hide selected / hide others / reveal all'],
  ['I / K', 'Open Insert Keyframe menu'],
  ['Space', 'Play / pause'],
  ['← / →', 'Previous / next frame'],
  ['Shift ← / Shift →', 'First / last frame'],
  ['Numpad . / F', 'Frame selected controls'],
  ['Home', 'Frame the rig'],
  ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
  ['Ctrl C / Ctrl V', 'Copy active control / paste pose'],
  ['Ctrl Shift C', 'Copy whole rig pose'],
  ['Ctrl S', 'Save the animation project'],
  ['Ctrl N / Ctrl Tab', 'New animation / next animation tab'],
] as const;
export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input,textarea,select,[contenteditable=true],[role=combobox]')
  );
}

/** Native controls keep their activation/navigation keys; editor shortcuts
 * are for the viewport or an editor, not the focused chrome. */
export function isInteractiveShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'button,a[href],summary,input,textarea,select,[contenteditable=true],[role=button],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=slider],[role=menu],[role=dialog],dialog[open]',
    )
  );
}
