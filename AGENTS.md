# Project guidance

For UI, styling, responsive layout and interface-interaction work, read [docs/UI_RULEBOOK.md](docs/UI_RULEBOOK.md) before editing. Treat it as the canonical design contract, together with later explicit user instructions. Check [.interface-design/system.md](.interface-design/system.md) for its entry point and [docs/ui-rulebook.html](docs/ui-rulebook.html) for visual examples.

Use shared tokens and component states. Do not copy incidental errors from generated concepts or introduce isolated CSS overrides that conflict with the rule book. Update the rule book when an intentional shared design decision changes. Verify rendered states relevant to the change and report what was actually tested; a generated concept is not evidence that the app was implemented or tested.

## Resource discipline

The PC is shared with other active projects. Use one QA browser owned by the main task, run viewport checks sequentially, and close contexts and the browser in a `finally` block. Workers should reuse saved evidence and source checks rather than launching parallel browsers. Stop task-owned preview servers and temporary helpers when finished. Do not run builds in parallel or stop unrelated projects or shared Codex services.
