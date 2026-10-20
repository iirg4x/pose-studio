# Pose Studio UI rule book

Version 2 · 14 October 2026

This is the design contract for desktop, tablet, phone, Android and the installed web app. It preserves the approved A controller ribbon and control inspector, with the C timeline layout and the Tablet Reference Control properties styling and colors. Every panel uses that same approved control-properties visual language; the current implementation is not the visual authority. Quick, menu, dialog and touch/floating panel backgrounds use **70% background alpha** (30% transparency) from the shared dark surface token. Fine-pointer desktop Properties and timeline docks are the explicit exception: they reserve scene space and use the opaque shared `--surface-dock` panel token. Inner timeline bands use only an **8% tint** over their single root surface; Transform follows the same flat inspector-section treatment without a separate inset shell. The scene fills the available workspace cell, and touch/coarse docking remains contextual and full-screen.

These are requirements for future UI work, not a claim that the current app already meets them. This document takes precedence over inconsistent legacy CSS and incidental details in generated images. A later explicit user decision updates this document. Do not silently introduce a second style for one panel.

[Open the interactive visual reference](ui-rulebook.html). It demonstrates corners, joined controls, interaction states, timeline opacity and the current shared tokens. Its examples illustrate this document; this document remains the source of truth. The approved Tablet Reference images are [a-portrait-tablet.png](../../../work/ui-layout-concepts/a-portrait-tablet.png) and [dynamic-a-properties.png](../../../work/ui-layout-concepts/dynamic-a-properties.png) (source paths `../../work/ui-layout-concepts/a-portrait-tablet.png` and `../../work/ui-layout-concepts/dynamic-a-properties.png`). They establish the Control properties panel treatment and are design references, not implementation or device verification.

## 1. The interface contract

1. **The scene is the workspace.** The 3D canvas fills the available workspace cell. On fine-pointer desktop, the Properties column and timeline row are reserved dock cells; the Properties open/collapsed preference alone determines its dock size, and an explicit open or collapse changes the host dimensions while the scene resize observer updates camera aspect without stretching or reframing the model. Selecting or deselecting a controller does not open, close or resize that dock. On touch/coarse layouts, contextual sheets remain full-screen overlays. A real window/orientation change may change the viewport aspect.
2. **Show tools where the work happens.** Controller actions appear near the selected controller. Numeric values and detailed settings belong in the Properties inspector. When the desktop dock is open with no controller selected, it shows the existing Animation properties (including the layer stack/settings and applicable preview links or camera settings) with small **Select all** and **Box select** actions. Selecting a controller returns to selected-control properties unless the user deliberately chose Animation context. Clip and project operations belong in the application controls.
3. **Give each visible control one job.** Keep one visible active-layer selector and one playback bar. A toolbar shortcut may share a command with a conventional menu; this is different from drawing the same selector twice.
4. **Preserve function while simplifying presentation.** A smaller device changes arrangement and disclosure, not the available animation features. Do not remove the control-properties panel to make a concept look cleaner.
5. **Use a consistent shape language.** Geometry communicates grouping. Joined buttons share an outline; independent buttons have space between them.
6. **Readability survives transparency.** Floating and touch panel backgrounds use the shared dark 70% alpha surface, leaving 30% transparency for the scene. Fine-pointer desktop dock roots use opaque `--surface-dock` so timeline and Properties data never stack over the scene. Inner timeline bands use only an 8% tint over their single root surface; Transform follows the flat inspector-section treatment. Verify contrast against the composited scene where transparency is used; keep control-properties content, text, labels, fields, keys, curves, handles and other data marks opaque.
7. **Respond immediately and settle smoothly.** Input feedback is immediate. Panels, disclosures and neighboring content move together without popping, bouncing or changing the camera.
8. **Browsing UI is not editing animation.** Selecting controls, changing panels, switching layers and opening menus do not pause playback or dirty the document by themselves.

## 2. Command placement and desktop conventions

### 2.1 Pose command map

The locations below are **Pose rules**. Import lives inside the Pose menu; Settings and compact workspace access may remain top right. They are not assertions that every desktop application uses these corners. Desktop guidance supports consistent, discoverable menus and direct access to frequent commands; exact placement varies by platform and application. [Microsoft menus and context menus](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/menus-and-context-menus)

| Region                     | What belongs here                                                                     | What does not belong here                                            |
| -------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Top left                   | Pose menu/project entry, document name and save state; current clip/browser access    | Selected-bone orientation, pivot or XYZ tools                        |
| Top right                  | **Settings** utility access; compact Workspace/Panels and View access                 | A persistent **Import…** button, a second play bar, a second layer selector, individual bone settings |
| Beside the clip context    | One active animation-layer selector, with the layer name visible                      | Repeated layer pickers in the quick menu and inspector               |
| Beside selected controller | On touch/coarse pointers, a nearby ribbon: Move/Rotate, orientation, pivot, Copy, Mirror, Reset, Ground and Properties; desktop fine pointers use the connected bookmark rail on the left edge of the right Properties dock for the same actions | File import, application preferences, export setup                   |
| Control-properties inspector | Selected-control properties and their animated state; open desktop dock also shows Animation properties and small selection actions with no controller selected | A permanent application settings dump                                |
| Bottom edge                | Timeline/curves and one attached transport bar                                        | File/project controls repeated from the top                          |

Keep the top utilities small. Settings may use a gear with an accessible name and tooltip. Compact Workspace/Panels access may stay beside it. Import is exposed inside the Pose menu only; do not render a persistent Import button in any corner. On narrow screens, collect Settings and workspace access in one top-right menu rather than wrapping them into several permanent rows. Keep them reachable with no controller selected. Reserve native window-button space in desktop builds; do not draw utilities under minimize/maximize/close.

The Pose menu organizes **File, Edit, View, Animation, Tools and Help** command groups. Use a native menu counterpart when the platform supplies one; the web app can expose these groups through its compact application menu. File contains New, Open, Recent, Save, Save as, Import and Export. Import is available inside the Pose menu/File group only; there is no persistent Import shortcut. Edit contains Undo/Redo and selection/clipboard commands. View contains scene presentation and panel visibility. Settings changes app-wide preferences; Control properties changes the selected controller. The Pose menu and any native menu counterpart invoke the same command implementation.

### 2.2 Expected desktop behavior

| Convention         | Pose requirement                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Familiar shortcuts | Preserve Ctrl/Cmd+S, O, N, Z, X, C, V and A for their familiar save/open/new/undo/clipboard/select-all roles in the correct scope. Redo supports Ctrl+Y on Windows and Ctrl/Cmd+Shift+Z where appropriate. Display actual supported shortcuts in menus and tooltips. |
| Scope              | Text editing owns text shortcuts. A numeric field must not turn Delete into delete-bone or Space into playback. Timeline clipboard actions affect timeline selection; scene clipboard actions affect scene selection.                                                |
| Context menu       | Right-click offers commands relevant to the target or selection. Every essential action also has a visible or menu route for touch and keyboard users.                                                                                                               |
| Ellipsis           | Use an ellipsis when more input is required before completing the action: Import…, Open…, Export…. Do not append it to immediate actions such as Copy or Reset rotation.                                                                                             |
| Menu feedback      | Mark checked toggles and exclusive choices, separate unrelated command groups, and retain stable order. A disabled command remains recognizable and explains why when useful.                                                                                        |
| Escape             | Cancel an active uncommitted drag/edit first; otherwise close the topmost transient surface. Do not close several layers and clear the selection on the same keypress. Restore focus to the opener when it still exists.                                             |
| Dialog actions     | Use clear verbs such as Save, Discard changes and Cancel. Enter activates the applicable default only when valid; Escape cancels a dismissible dialog. Destructive choices are never an accidental default.                                                          |
| Save protection    | Warn before losing unsaved project changes. Switching clips/poses within the same project does not itself produce a save prompt. Saving, saved and failed are different visible states.                                                                              |
| Undo               | A continuous drag or field edit is one undoable transaction. Opening a menu, choosing a panel or selecting a bone is not an animation edit.                                                                                                                          |
| Native environment | Preserve normal window movement/resizing and browser navigation, zoom and text behavior. Do not promise interception of browser/OS-reserved shortcuts such as closing a tab.                                                                                         |
| Progress           | Long imports/exports show real progress when known, a busy state otherwise, and cancellation where supported. Errors explain recovery and preserve the user's work.                                                                                                  |

Shortcut familiarity, discoverability and input-specific scope follow [Microsoft keyboard accelerator guidance](https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-accelerators). Keyboard menu navigation and checked/disabled menu semantics follow the [WAI-ARIA menu pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/). The save, undo and animation-specific behavior above is Pose policy.

### 2.3 Keyboard structure

Use native buttons, inputs and selects where their semantics fit. A custom widget must implement its full interaction contract, not just its visual appearance. Tab reaches and leaves a toolbar; arrow keys navigate its buttons. Do not put an arrow-key-operated numeric editor into a toolbar that consumes the same arrows without a clear editing mode. Use semantic groups for small button sets rather than assigning `role="toolbar"` everywhere. [WAI-ARIA toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)

A modal dialog traps focus within itself while open, has a visible close/cancel path and returns focus on dismissal. A nonmodal inspector does not trap focus or block the scene. [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

## 3. Geometry tokens

All dimensions below are CSS pixels, independent of device pixel ratio. Use semantic tokens. Keep the same geometry language across input devices; increase touch targets rather than making every corner more rounded on phones.

### 3.1 Radius

| Token             | Value  | Use                                                                                         |
| ----------------- | ------ | ------------------------------------------------------------------------------------------- |
| `--radius-flush`  | `0px`  | Shared edges, joined interiors and surfaces flush against a screen edge                    |
| `--radius-shared` | `8px`  | The single outer radius for controls, joined shells, panels, menus, popovers, dialogs and badges |

The compatibility aliases `--radius-flair`, `--radius-control`, `--radius-group`,
`--radius-panel` and `--radius-dialog` all resolve to `--radius-shared`. Use the
shared token for new surfaces. Keep an interior edge square when controls touch,
and keep a flush edge square when a surface docks to the viewport. Circles are
reserved for geometry that is actually circular: a slider thumb, a status dot or a
radial tool. A button's selected, pressed or hover state never changes its radius.

A panel touching a viewport edge loses the corners on that edge. A full-width bottom timeline is flush on its left, right and bottom edges. Do not put a floating rounded card inside another card to simulate docking. For nested surfaces that genuinely touch, the inner curve follows the outer curve minus the border/inset; never use an inner radius larger than its container.

### 3.2 Size and spacing

| Property                          | Desktop with fine pointer        | Touch/coarse pointer              |
| --------------------------------- | -------------------------------- | --------------------------------- |
| Standard button/input height      | 32px                             | 44px minimum                      |
| Icon button target                | 32 × 32px                        | 44 × 44px minimum                 |
| Compact table/track row           | 32px minimum                     | 44px minimum                      |
| Icons                             | 16px; 18px for primary transport | 20px                              |
| Panel padding                     | 12px                             | 12px; 16px for standalone dialogs |
| Related independent-control gap   | 8px                              | 8px                               |
| Separate control-group gap        | 12px                             | 12px                              |
| Section separation                | 16px                             | 16px                              |
| Safe gap from scene control/gizmo | 12px minimum                     | 16px minimum                      |

Spacing uses **4, 8, 12, 16, 24, 32px**. The deliberate exceptions are 1px borders, 2px focus rings and the defined radii. A 4px gap is for an icon and its label, not for squeezing two unrelated touch buttons together. Invisible hit areas may enlarge a target only if they do not overlap neighboring targets. Device mode considers pointer capability as well as width; a large touchscreen still needs touch-sized targets.

## 4. Shoulder-to-shoulder controls

This section applies to segmented choices, playback clusters, split buttons, XYZ groups and contiguous action rows.

### 4.1 One group, one silhouette

- The wrapper owns **one 1px outer border and the shared 8px radius**. It has **0 padding and 0 gap**.
- Children have **0 border radius**. Their backgrounds fill their entire cell, right up to the shared edge. The wrapper clips the backgrounds to its rounded outer silhouette.
- Interior boundaries use one 1px separator, never two touching borders. The separator does not alter target width when selection changes.
- The first and last items appear rounded only where they meet the wrapper's outside corners. A middle item's highlight is rectangular. No inset pills, circular highlights or gaps between adjacent selected cells.
- Vertical groups follow the same rule at the top/bottom. A two-row grid has just four rounded outside corners; the shared cross is square. Add one separator per shared edge.
- A split button uses the same shell. Its main action and disclosure arrow have different actions and separate focus targets, with one shared separator.
- Joined groups never wrap arbitrary individual buttons onto a new line. Move a complete group, change to an intentional grid, or use an overflow menu.

### 4.2 Highlight and interaction geometry

| State            | Appearance                                           | Geometry                                              |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Rest             | Neutral surface, readable label                      | Full cell; no floating inset background               |
| Hover            | Neutral lighter fill                                 | Same cell and corners; no size/position change        |
| Pointer down     | Pressed fill                                         | Same cell; no scaling or movement                     |
| Selected mode    | Cyan fill and dark ink; selected semantics           | Fills the cell to shared boundaries                   |
| Selected + hover | Slightly brighter cyan                               | Preserve selected appearance and same shape           |
| Selected + press | Slightly darker cyan                                 | Preserve selected meaning; no neutral reset           |
| Keyboard focus   | 2px cyan inset ring, or dark inset ring on cyan fill | Per-control ring remains visible inside clipped shell |
| Disabled         | Muted label, no active hover/press response          | Retains footprint and separators                      |

Several adjacent selected toggles make a continuous selected area with a subtle separator. They remain separate controls. Mutually exclusive groups have one selected value. Mixed multi-selection uses an explicit mixed mark/value, not an invented half-selected glow.

**State meaning matters:** Move/Rotate and IK/FK are persistent choices. Copy, Ground, Reset location and Reset rotation are commands: their pressed feedback ends on release. They must not remain latched like toggles. An open menu trigger can show an expanded state, which ends when its menu closes. Keyboard focus is independent of all these states.

### 4.3 List-row selection is a separate visual state

Joined mode buttons and list rows communicate different things and do not share the same selected fill:

| Surface                          | Selected treatment                                                                 | Meaning                                      |
| -------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| Joined mode button               | `--accent` cyan fill with `--accent-ink` dark ink; fills its joined cell           | The active mode or persistent direct choice |
| Active-layer/menu list row       | `--selection` dark row with readable `--text`, plus a cyan check or inset edge; no full cyan field | The current item in a list                  |

List-row selection keeps its readable text and row footprint on hover, focus and selection. Do not apply the joined-button cyan field to an active-layer menu or another list of choices.

### 4.4 Reference geometry

```css
.joined {
  display: inline-flex;
  gap: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-shared);
  overflow: hidden;
  isolation: isolate;
}
.joined > button {
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.joined > button + button {
  border-inline-start: 1px solid var(--border);
}
.joined > button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.joined > button[aria-pressed='true']:focus-visible {
  outline-color: var(--accent-ink);
}
```

This is a geometry example, not a replacement for semantic radio groups, tabs or their keyboard behavior. If a child opens a menu, render the menu outside the clipped shell through the shared overlay system. Do not disable clipping and reintroduce corner leaks.

## 5. Color, opacity and depth

### 5.1 Palette

| Token              | Value     | Role                                         |
| ------------------ | --------- | -------------------------------------------- |
| `--canvas`         | `#12171e` | App backing surface                          |
| `--inset`          | `#1b2835` | Opaque field wells                           |
| `--panel`          | `#192735` | Inspector/panel surface base                 |
| `--raised`         | `#223140` | Raised menu/control surface                  |
| `--hover`          | `#2d4153` | Neutral hover                                |
| `--pressed`        | `#365064` | Neutral pressed                              |
| `--border`         | `#3a4d60` | 1px boundaries and separators                |
| `--border-subtle`  | `color-mix(in srgb, #3a4d60 45%, transparent)` | Section separators and quiet boundaries      |
| `--text`           | `#e3e9f1` | Main text                                    |
| `--secondary`      | `#b9c3cf` | Labels and supporting text                   |
| `--muted`          | `#7f8c9d` | Low-priority metadata/disabled labels        |
| `--accent`         | `#42d8e9` | Active tools, focus and playhead             |
| `--accent-ink`     | `#06222a` | Text/icons on cyan                           |
| `--accent-hover`   | `#7bdef0` | Selected hover                               |
| `--accent-pressed` | `#4dbdd4` | Selected press                               |
| `--selection`      | `#243e49` | Selected rows and subtle selections          |
| `--amber`          | `#e6bf77` | Authored keys                                |
| `--red`            | `#e98383` | Errors/destructive emphasis; labelled X axis |
| `--green`          | `#95ccb4` | Success; labelled Y axis                     |
| `--axis-z`         | `#75b6f2` | Labelled Z axis                              |
| `--surface-quick`  | `rgb(18 29 40 / 70%)` | Quick ribbon, inspector and tablet panel surfaces; 30% transparent |
| `--surface-menu`   | `rgb(18 29 40 / 70%)` | Menus, dialogs and popovers; 30% transparent     |
| `--surface-timeline` | `rgb(18 29 40 / 70%)` | Timeline and curve data root surface; 30% transparent |
| `--surface-ruler`  | `rgb(18 29 40 / 70%)` | Ruler and transport root surface; 30% transparent |
| `--surface-dock`   | `var(--panel)` | Opaque fine-pointer desktop dock roots |

This palette is the approved Tablet Reference Control properties treatment for every panel, including inspectors, menus, dialogs, library surfaces, touch sheets, timeline, transport and ruler surfaces. Floating/touch panel roots use the same `rgb(18 29 40 / 70%)` background alpha; fine-pointer desktop dock roots use opaque `--surface-dock`. Inner timeline bands use only an 8% tint and never add a second opaque backing layer, while Transform uses the same flat inspector-section treatment. Color communicates state or axis identity. Keep axis letters visible; color alone is insufficient. Keep control-properties content, text, labels and data marks at full opacity. Verify contrast against the composited scene where a surface is transparent. Do not implement disabled states by fading an entire panel or its separators.

### 5.2 Opacity is a surface token

| Surface                                  | Background            | Rule                                          |
| ---------------------------------------- | --------------------- | --------------------------------------------- |
| Timeline, transport and curve plot root | `rgb(18 29 40 / 70%)`; fine-pointer desktop `--surface-dock` | Transparent floating/touch root; opaque reserved desktop dock |
| Timeline ruler, toolbar and track labels | `rgb(18 29 40 / 70%)` | 30% transparent; text remains opaque                       |
| Inner timeline bands                    | `8% tint over root`   | No opaque backing layers                                  |
| Transform section                       | `transparent root`   | Same flat inspector-section treatment; no nested inset shell |
| Quick ribbon, inspector and tablet panels | `rgb(18 29 40 / 70%)`; fine-pointer desktop inspector dock `--surface-dock` | Approved Control properties surface; desktop dock reserves scene space |
| Dropdown/context menu                    | `rgb(18 29 40 / 70%)` | 30% transparent; text and marks remain opaque      |
| Standalone dialog                        | `rgb(18 29 40 / 70%)` | Shares the menu surface and the shared 8px outer geometry |
| Numeric/text fields                      | `#1b2835`             | Solid                                         |

Set alpha on the **background color**, never the container's `opacity`. Floating/touch panel roots use the shared `rgb(18 29 40 / 70%)` background-alpha token; fine-pointer desktop dock roots use opaque `--surface-dock`. Inner timeline bands use only an 8% tint over their single root; do not stack a second opaque backing layer. Transform uses the same flat inspector-section treatment without a separate inset backing layer. Control-properties content, text, icons, labels, curves, handles, fields, keyframes and other data marks remain opaque. Verify composited contrast over bright and dark scene content where transparency is used. Do not compensate with neon curves or heavy blur. The inset palette remains `#1b2835`; do not use the current implementation's incidental panel colors as a reference.

The timeline is a data-editing surface with a single root surface, not a blurred glass effect. Fine-pointer desktop uses the opaque dock root; touch/coarse floating timelines use the transparent timeline token. Do not use backdrop blur on it. Other small overlays may use up to 6px blur only after measuring the cost; the design must remain complete with blur disabled. Never animate blur.

### 5.3 Elevation

Use one restrained shadow vocabulary. Shadows belong to floating surfaces, not to each button inside them.

| Surface         | Shadow                                              |
| --------------- | --------------------------------------------------- |
| Quick tools     | `0 2px 5px #060a1030, 0 6px 18px #060a1040`         |
| Inspector       | `0 3px 10px #05090f45, 0 18px 44px -10px #05090f80` |
| Menu/popover    | `0 4px 12px #05090f55, 0 16px 36px -6px #05090f80`  |
| Dialog          | `0 8px 24px #03070d55, 0 28px 80px -12px #03070da0` |
| Bottom timeline | `0 -6px 22px -10px #05090f80`                       |

Embedded content inherits its parent surface and gets no second shadow. Use the shared overlay stack: scene < persistent controls/timeline < quick menu/inspector < dropdowns < modal < tooltip. A dropdown must not be clipped by its panel; a tooltip must not appear above an unrelated modal.

## 6. Typography, labels and icons

- Use the existing system family: `"Segoe UI", system-ui, sans-serif`. Preserve native readability across platforms rather than downloading another font for one panel.
- Desktop labels/body: 13px, line-height 18px. Touch: 14px, line-height 20px. Editable text/numeric inputs on phones: 16px. Metadata: 12px, never the only place an essential value appears. Panel headings: 15px/20px, weight 600.
- Numeric values and frame counts use tabular numerals. XYZ labels and units line up; unit changes must not move neighboring fields. Preserve practical precision while editing, without showing meaningless floating-point noise.
- Use sentence case and concise verbs. Name the affected scope when it matters: Reset rotation, Paste keys, Ground toes. A controller name is a small flair, not a second tall title bar.
- Use the existing Lucide icon family with consistent stroke weight. Mirror, Rotate, Copy and Settings need distinct symbols. Do not use an icon merely to fill space.
- Icon-only desktop actions get tooltips and accessible names. Touch must have visible labels or a discoverable equivalent; hover cannot be the only explanation.
- Long names ellipsize within their allocated width. Provide full names on focus/tooltip and in rename. Never let a clip/bone name push transport controls off-screen.

Normal-size text must meet 4.5:1 contrast against the **composited** surface. Test bright and dark scene content, not only isolated color swatches. [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) Pose also requires clear focus, selected shapes and labelled axes; do not claim accessibility compliance from color checks alone.

## 7. The controller quick menu

| State                             | Required behavior                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| No controller selected            | Quick menu absent; desktop Properties keeps its chosen open/collapsed state and a collapsed dock leaves its restore handle reachable |
| One selected, idle (touch/coarse pointer) | A ribbon near its projected scene position; small name flair and Properties access            |
| One selected, idle (desktop fine pointer) | Attach a compact vertical bookmark rail to the left edge of the right Properties dock; when the dock is collapsed, leave only the rail at the right viewport edge |
| Multiple selected, idle           | One ribbon near the selection centroid/active control; show count and mixed values clearly         |
| Pointer down inside drag deadzone | Select without changing the pose; do not flash-hide the menu                                       |
| Committed controller manipulation | Quick menu hides, leaving the controller and gizmo clear                                           |
| Released/cancelled manipulation   | Menu returns at the settled selection after the surface transition                                 |
| Playback/scrubbing                | Quick menu hidden while motion is active; selection persists                                       |
| Playback paused                   | Menu returns if a visible selection still exists                                                   |
| Selected control off-screen (touch/coarse pointer) | Hide the scene-anchored menu; the enabled inspector retains its selection and a frame-selection route |
| Selected control off-screen (desktop fine pointer) | Keep the selection-only Properties rail available at the right viewport edge; the enabled inspector retains its selection and a frame-selection route |

Start with a drag threshold of 4px for mouse and 8px for touch/pen; tune through real input testing without allowing a tap to create a key. Do not scale this threshold with device pixel ratio.

Place the ribbon outside the controller and its gizmo, with the defined minimum gap on touch/coarse pointers. On desktop fine pointers, attach the selection-only vertical bookmark rail to the left edge of the right Properties dock; when Properties is collapsed, the rail remains as the only visible edge control, and expanding it restores the connected dock shell. The rail hides during manipulation/playback/scrubbing and does not resize the scene. Desktop rail actions show centered 12px captions beneath their icons, including Move, Rotate, the current orientation, Pivot, clipboard/mirror, reset and Ground. Long captions wrap within their button. Keep accessible names and descriptive tooltips; when the action stack exceeds the dock height, scroll only the tools and keep the restore handle fixed and reachable. If space is tight near a touch controller, flip and clamp first, then use the intentional two-row layout. If that still cannot fit, retain Move/Rotate and Properties while placing other actions in a labelled More disclosure inside the same ribbon. Every action remains reachable; never put an overflow button over the gizmo. Once the pointer approaches or focus enters the ribbon, freeze placement until interaction ends. An attachment bone picker may temporarily reveal eligible controls even when other controls are normally hidden.

The ribbon contains Move/Rotate, orientation, pivot and direct pose actions. Properties opens the complete inspector. On fine-pointer desktop, selection changes do not resize the Properties dock; only the explicit Properties open/collapse action changes its dock size, and a collapsed no-selection dock keeps its restore handle reachable. Numeric editing space in that inspector is distinct from gizmo orientation; label it **Edit space** to avoid two ambiguous World selectors.

## 8. Panels and disclosure

### 8.1 Control properties are retained

On fine-pointer desktop, the Properties inspector is enabled and open by default, remains docked when no controller is selected, and keeps a persistent open/collapsed preference. That preference alone determines the dock size: selecting or deselecting a controller never opens, closes or resizes it. When open with no controller selected, show the existing Animation properties, including the layer stack/settings and applicable preview links or camera settings, plus small **Select all** and **Box select** actions. Selecting a controller returns to its selected-control properties unless the user deliberately chose Animation context. The selected-control inspector contains numeric Location/Rotation XYZ with edit space; per-axis layer Additive/Replace and animated weights/transitions; IK/FK where applicable; grounding/reach; attachment parent picker and inheritance; and interpolation. Grip, camera FOV and prop asset fields appear for the corresponding selection. Modifiers remain channel/curve tools with a route from the selected channel; do not create a second conflicting modifier editor.

One group is expanded initially: Transform. Remember deliberate expansion while the current task remains valid. Transform follows the same flat section surface as the rest of the inspector; do not add a separate outline or inset container. On phones, Transform / Rig / Layer tabs may organize these same settings. The Layer tab edits the selected control’s influence in the already-active layer; it is not another active-layer picker. A tab change preserves draft input and scroll context. One scroll container owns the panel body; a short row of buttons never gains its own scrollbar.

Keep the inspector stable during numeric edits and preview playback. Its toolbar Properties toggle is a persistent open/collapsed preference across deselection and reselection. Only an explicit manual collapse changes the desktop dock size; selecting or deselecting a controller does not open, close or resize it. With no controller selected, an open dock shows the existing Animation properties and the small **Select all** and **Box select** actions; selecting returns to selected-control context unless the user deliberately chose Animation context. A collapsed no-selection dock keeps its restore handle reachable. Touch/coarse contextual behavior remains unchanged: the quick ribbon auto-hides with controller motion, and closing a quick menu must not unexpectedly close the contextual inspector. Selection changes update the same inspector, not a new overlapping copy.

### 8.2 Use the correct surface

| Surface           | Use                                                      | Placement and dismissal                                                  |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Menu              | A short list of commands/choices                         | Anchored to its trigger; click-away and Escape close                     |
| Quick ribbon      | Immediate selected-control tools                         | Near the controller on touch/coarse pointers; desktop fine pointers use the connected Properties rail |
| Panel / tablet sheet | Control properties and panel content                    | Uses the approved Tablet Reference surface hierarchy; touch/coarse remains a full-screen overlay |
| Inspector         | Properties needing live scene feedback                   | Persistent right dock on fine-pointer desktop; its open/collapsed preference alone sets dock size, while touch/coarse uses an edge or compact contextual overlay |
| Standalone dialog | Import setup, export setup, settings, project management | Centered within available viewport; scrollable body if needed            |
| Inline edit       | Rename or one numeric/text value                         | In context, with predictable commit/cancel                               |

All panels use the approved Tablet Reference Control properties styling and colors. Dropdowns flip/clamp to available screen bounds. Prefer layouts that avoid panel overlap. If a floating menu or panel must overlap another surface, the upper surface owns the visual stack: only the scene may show through its transparent background. Within the covered lower region, underlying panel text, controls and panel background must be masked; they must not form stacked text or competing controls. Mask only that covered region; do not replace the transparent top panel with an opaque top surface. Do not close or reset the obscured surface solely because it is covered; restore its full visible state when the upper surface is dismissed. Open one transient command menu at a time; nested submenus are an exception within that menu. Close buttons stay reachable when content scrolls. On touch/coarse layouts, click-away dismisses transient menus and unpinned contextual inspectors when there is no active edit; the fine-pointer desktop Properties dock stays mounted according to its open/collapsed preference. Neither behavior turns the dismissing click into an unintended bone drag/keyframe. Explicitly pinned inspectors survive outside clicks and remain overlays. A modal with unsaved draft input uses its own cancel/discard behavior; an outside click must not silently destroy that draft.

## 9. Timeline and curve editor

- Anchor the timeline to the bottom edge, directly attached to its transport. No floating outer margins, rounded card islands or unused strip below it. Fine-pointer desktop uses a square grid dock row with opaque `--surface-dock` and reserves that row from the scene; touch/coarse uses `--surface-timeline` at `rgb(18 29 40 / 70%)` for its contextual root. Inner timeline bands use only an 8% tint; do not add a second backing layer.
- Expanded height starts around 20–28% of the available viewport. Allow deliberate resizing on desktop/tablet. On short screens, collapse extra rows before sacrificing all scene feedback. One transport remains reachable in every state.
- Keys and Curves use the same outer editor size and preserve the user's resize state when switching between them. On touch/coarse input, show one editor at a time while retaining that shared size and resize preference.
- Ruler, track labels, data region and toolbar are visibly distinct through alignment and the single transparent root. Do not add opaque backing layers or color every row brightly. Use one subtle 8% selected-row tint while labels and data marks remain opaque.
- With no scene control selected, show all controls. With selection, show selected controls automatically, even if the timeline was closed when selection changed. Show an aggregate all-selected-controls row only for two or more selected controls.
- Expand a bone into per-axis Location/Rotation tracks. Units and axis identity stay clear. The curve editor supports the same selection and clipboard operations as the key timeline, including paste.
- Normal keys are amber diamonds. Selected keys retain amber identity with a cyan outline/size cue; key selection is not a large square behind the diamond. Tangent handles appear only for relevant selected keys.
- Interpolation is visible in the connecting segment: straight linear, held/jumping stepped, smooth Bezier, or the actual eased curve. Constant values may remain flat; do not draw a fake wave just to identify interpolation. A focused segment can expose its name/tooltip. Loop continuity belongs to the first/last boundary, not a repeated marker on every key.
- Keep graph guides restrained and zoom-aware. Show useful units and ticks without a wall of labels or dense graph paper.
- Separate time-only and value-only dragging, with a visible axis lock. Dragging a value must not introduce an accidental frame change. The playhead is draggable in both Keys and Curves.
- Box selection begins in available data-area whitespace, with a clear threshold and visible rectangle. Do not reserve one tiny start zone. Distinguish selection from panning and key dragging by hit target and input mode.
- Timeline scrolling stays in the track/data region; the ruler and transport remain stable. Nested menus scroll independently only when their own content exceeds the visible bounds.
- Measure curve/effect geometry from the committed editor bounds before first paint so the initial viewBox and placement do not visibly correct from fallback dimensions. Continue observing later size changes without reintroducing a first-paint correction.

## 10. Responsive layout and full-screen behavior

| Form factor                    | Layout rule                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop                        | Compact application utilities, Settings/Workspace access at top right, Pose-menu Import, a fine-pointer bookmark rail attached to the left edge of the right Properties dock (touch/coarse pointers keep the near-controller ribbon), a Properties dock whose open/collapsed preference alone sets its size (300–340px when open), and a wide bottom timeline. Extra space belongs to the scene. |
| Portrait tablet                | Same hierarchy with touch targets and the approved Control properties styling. Properties and Timeline may remain visible together in clear side/lower regions; if either collides with the selected control, use the phone disclosure model. |
| Phone portrait                 | One compact top application row. Near-controller ribbon fits within screen bounds. Properties and expanded timeline alternate in the same lower workspace above a single transport bar. |
| Phone landscape / short window | Prefer compact transport and one open editor at a time. Keys and Curves retain the same outer size and resize state when switched. Panels use available height with a scrollable body; essential actions do not fall below the viewport. |

Layout follows available width **and height**, pointer capability, zoom and the actual browser viewport. Do not identify every phone solely by a user-agent string or an Android CSS class.

Touch/coarse docking remains full-screen and contextual. Fine-pointer desktop uses a real dock frame: the opaque Properties column and timeline/transport rows reserve layout space, the viewport host receives the remaining dimensions, and the scene resize observer updates its camera aspect. Properties collapses to its connected bookmark/restore rail by explicit user action; selecting or deselecting a controller never changes the dock size, including when no controller is selected. The timeline collapses to transport. Dock edges are square and flush with no blank strip below the workspace.

The canvas/background continues behind any OS safe area. Protect interactive targets with real reported insets only where necessary; do not hard-code a black home-button shelf or a guessed bottom padding. Do not add the same inset at the app root, panel and transport. Account for browser bars and the software keyboard once through the shared viewport/overlay bounds. A focused field and its commit/cancel path must stay visible when the keyboard opens.

Do not stretch a portrait layout to fit landscape or shrink desktop controls to touch size. Never remove access to a feature solely because the device is smaller. Responsive tabs and overflow disclosures are allowed when their purpose is clear and the feature remains reachable. Width changes may relocate or disclose groups; they do not silently discard their functionality.

## 11. Motion, performance and continuity

| Token/behavior     | Requirement                                             |
| ------------------ | ------------------------------------------------------- |
| `--motion-quick`   | 130ms for hover/selection feedback                      |
| `--motion-surface` | 200ms for menus, inspectors and disclosures             |
| `--motion-ease`    | `cubic-bezier(0.2, 0.8, 0.2, 1)`                        |
| Popover movement   | 4–8px maximum; no long travel or bounce                 |
| Reduced motion     | Immediate changes or opacity-only transition up to 80ms |

User input takes effect immediately; animation must not delay commands or interpolate the controller behind the pointer. Do not throttle UI transitions to timeline FPS or 30Hz. Use compositor-friendly opacity/transform for floating surfaces and display-timed scheduling for necessary JS animation. Actual refresh support is verified on the target device, not inferred from a CSS duration.

Closing elements remain mounted until their exit finishes. For elements in document flow, animate the occupied space and neighboring movement together. Fading a child and then snapping its parent height closed fails this rule. Hidden/closing controls stop receiving input; an interrupted transition reverses from its current state.

Only explicit playback controls or an actual controller/keyframe edit pause the running animation. Layer selection, pose-layer inspection, menu opening and panel resizing do not pause it. Editing an animated value can establish a stable edit frame; merely focusing its field cannot.

Opening timeline, curves or motion trails must not start full-scene recomputation on every UI event. Hidden panels/trails perform no unnecessary continuous work. Keep scrolling and pointer updates local; measure frame time with representative rigs and keys. Reuse the existing performance baseline and record before/after evidence for expensive UI work.

## 12. Implementation discipline

Use `src/design-system.css` as the central token owner when implementing this contract. Reuse `src/elevation.css` and `src/motion.css` for depth and motion. Existing tokens with older values are migration inputs, not exceptions. Layout styles belong to their component/responsive layer; semantic colors, radii and interaction states do not get redefined in each device stylesheet.

Build shared Button, JoinedGroup, Field, Menu, Panel and Dialog behaviors before adding one-off variants. A selected class, `aria-pressed`, `aria-selected` and checked state must not produce conflicting appearances. Distinguish a command, toggle, radio choice and tab in the component API. Use the existing icon family.

Do not fix a local inconsistency with another global `!important` layer or a final appended CSS override. Remove or migrate the conflicting rule when changing that component. Keep a single overlay positioning/focus system and a single viewport-bounds source. Preserve user project data and playback while making presentation changes.

Any intentional exception records the component, reason and new shared rule here. A later design change updates the visual reference at the same time. Do not update this document merely to justify an accidental regression.

## 13. Review gate

Before accepting a UI change, inspect the rendered app, not only source or generated concepts. Use relevant checks from this list; a documentation-only change does not require a full application build.

### Geometry and readability

- [ ] Every outer radius resolves to `--radius-shared`; shared edges are square.
- [ ] First/middle/last, vertical, grid and split-button selected/hover/focus states preserve the group silhouette.
- [ ] No round Play button appears inside a joined transport cluster.
- [ ] Floating/touch panel backgrounds, including timeline, transport and ruler, use `rgb(18 29 40 / 70%)` (30% transparency); fine-pointer desktop dock roots use opaque `--surface-dock`. Inner timeline bands use only an 8% tint over their single root and Transform keeps the flat inspector-section treatment. Verify composited contrast where transparency is used while keeping control-properties content, labels, fields, keys, curves, handles and track boundaries opaque and readable.
- [ ] Text, keyframes, handles and focus rings remain opaque and legible.
- [ ] Long names, large text/zoom and translated-length labels do not eject controls off-screen.

### Interaction and placement

- [ ] Import is discoverable inside the Pose menu/File group only; Settings and compact Workspace/Panels access may remain at the top right.
- [ ] One active-layer selector and one playback bar are visible.
- [ ] Fine-pointer desktop Properties stays docked through selection changes; its explicit open/collapsed preference alone determines dock size, and no selection shows Animation properties plus **Select all** and **Box select** when open. A collapsed no-selection dock keeps its restore handle reachable; selecting returns to selected-control context unless Animation context was deliberately chosen. Touch/coarse contextual behavior remains available.
- [ ] No selection, one selection, multi-selection, dragging, playback and off-screen selection all follow the quick-menu state table.
- [ ] Properties and all control-specific sections remain accessible on every size.
- [ ] Menus dismiss cleanly, return focus and never leak the dismissing click into a pose edit.
- [ ] Layouts avoid panel overlap where possible; when overlap is necessary, only the scene shows through the transparent top surface, the covered lower region masks its panel text, controls and background, and the obscured surface returns when the top surface is dismissed. Do not replace the top surface with an opaque panel.
- [ ] Keyboard focus, shortcuts, tab/arrow navigation and text-input scope work.
- [ ] Reset/Copy/Ground are commands, not latched toggles.
- [ ] Opening/closing inspector or timeline does not alter camera framing.
- [ ] Layer changes and UI navigation do not pause playback or trigger inappropriate save prompts.

### Responsive and motion verification

- [ ] Check at least a 1440×900 desktop, an 800×1280 portrait tablet, a 390×844 phone and an 844×390 short landscape viewport; also check the actual supported device dimensions.
- [ ] When verification is performed, browser/PWA, toolbar expanded/collapsed, software keyboard and orientation changes have no cutoff or blank bottom shelf.
- [ ] Selected controllers and their gizmos are not covered by quick-menu placement.
- [ ] No unnecessary nested scrollbar, disappearing toolbar or timeline squash appears.
- [ ] Keys and Curves use equal outer panel dimensions, preserve resize state, and show one editor at a time on touch/coarse input.
- [ ] Curve/effect geometry is measured from committed bounds before first paint; later resize observation does not cause a visible fallback correction.
- [ ] Exit animations and neighboring layout finish together; reduced-motion behavior is usable.
- [ ] Timeline/curve/trail performance is checked on representative content; simulated screenshots are not reported as physical-device verification.

This review gate lists target checks; this documentation does not claim physical iPhone, browser/PWA or accessibility compliance verification.

## 14. Design provenance

The user-approved concept direction is A's nearby controller ribbon and complete control-properties inspector, the C timeline arrangement, a full-screen scene on all devices, and the Tablet Reference Control properties styling and colors. Portrait tablet, phone and desktop concepts demonstrate responsive arrangements, not exact pixel or behavior specifications. The approved visual references are `../../work/ui-layout-concepts/a-portrait-tablet.png` and `../../work/ui-layout-concepts/dynamic-a-properties.png`.

This version records these explicit corrections: Import belongs inside the Pose menu and has no persistent button; Settings and compact Workspace/Panels access may remain at the top right; every panel follows the Tablet Reference Control properties treatment; floating/touch surfaces use the tokens in `src/design-system.css`, while fine-pointer desktop Properties and timeline/transport docks use opaque `--surface-dock`; inner timeline bands use only an 8% tint over their single root and Transform follows the flat inspector-section treatment; touch/coarse docking remains full-screen while desktop docks reserve scene space; and transparency never applies to control-properties content, text, labels, fields or data marks. Latest direct live feedback superseded the original 70% transparency choice, while requiring overlapping floating surfaces to let only the scene show through and to mask only the covered lower region's panel text, controls and background; the lower surface remains mounted and restores on dismissal. Active-layer list rows use dark `--selection` with readable `--text` and a cyan check or inset edge; joined mode buttons retain their cyan selected cells. The inset palette remains unchanged. Verify composited contrast to preserve legibility without imposing a separate minimum-alpha gate or adding a second opaque backing layer. Generated concept images and current implementation styling that differ from the approved references are superseded by these rules. Numerical values, example key shapes and icons inside generated images are illustrative, not animation data or implementation authority.

The linked Microsoft and W3C documents support the desktop/keyboard/accessibility conventions cited in place. The spacing, radii, colors, opacity, motion timings and command map are the Pose design system, not universal industry standards.
