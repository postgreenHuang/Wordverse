# Wordverse product and engineering contract

## Product intent
Wordverse is a local-first spatial memory tool. Its atomic unit is a concise “word eye” rather than a document. Users remember by revisiting relations, and may descend into a word's child graph for depth. The interface must feel like navigating a quiet, compact galaxy—not editing a conventional outline.

## Non-negotiable interaction model
- The canvas owns the center and opens immediately; never place a marketing screen before it.
- `Space` toggles a Unity-style maximized Scene workspace, hiding surrounding app panels without invoking browser fullscreen. Text entry and in-scene renaming must consume spaces normally and never toggle the layout.
- Both side panels are resizable from their Scene-facing edges, use bounded widths, and persist those widths as device-local settings.
- Double-click empty space creates a word at that spatial position.
- Empty-space double-click detection belongs to the canvas container rather than a raycast background plane, so grids and camera orientation cannot intercept it. Words and relations must stop native double-click bubbling.
- `L` starts a one-shot relation from the selected word (or asks for a source when none is selected); clicking the target completes it. `Shift+L` keeps the source active for continuous linking. The toolbar and node context menu enter the same state machine. `Esc` cancels before navigating upward.
- Relation lines are selectable; `Delete` or `Backspace` cuts the selected line. Hovered and selected lines become easier to target without dominating the resting view.
- Single-click selects and opens the inspector. Double-click enters its child graph; `Esc` returns to the parent graph.
- `W/A/S/D` moves through space relative to the camera. `F` frames the current graph. Home returns to the root graph.
- `F` focuses the selected word when one is selected; otherwise it frames the actual 3D bounds of the current graph. Double-clicking a hierarchy item selects and smoothly focuses it.
- The back button lives inside the Scene viewport's top-left corner, mirrors `Esc` depth navigation for the active scene tab, and is disabled at that tab's main-graph root. The Wordverse brand returns the active tab directly to its own main-graph root.
- Returning from a child graph selects and smoothly focuses the parent word that opened it. Open scene tabs, their independent depth paths, and the active tab persist as device-local workspace state across refreshes.
- Every open graph is a closable top tab; at least one tab must remain.
- A Unity-like graph browser lists only top-level/main graph files separately from the current scene hierarchy. Child graphs are internal graph structure and must never appear as independent Project files. Double-clicking a main graph opens it in a tab or activates its existing tab; creation also lives in this browser. Never use a tab-bar `+` to duplicate the current graph. Tabs preserve independent depth paths, can switch or close, and the last tab cannot close.
- Main graph files support right-click rename and confirmed deletion. Deleting a main graph removes only its recursively owned child graphs, closes affected tabs, participates in undo, and can never remove the protected root or the final remaining main graph.
- Each scene tab displays its full depth breadcrumb (`root graph > child graph > child graph`) so spatial depth is always visible; truncate visually only when necessary and preserve the full path as hover text.
- The hierarchy is searchable, flat by graph, and child graphs may expand recursively.
- Expanding a hierarchy word reveals its child graph recursively without treating that graph as a Project file. Selecting a nested word navigates the active tab to its owning graph; double-click also focuses it.
- A hierarchy row exposes “move into current view” only inside its right-click context menu; never show it as a persistent or hover action because accidental activation changes spatial memory. The action relocates an off-screen word near the current camera target, avoids nearby nodes, locks the result, and remains undoable. This is distinct from double-click focus, which moves only the camera.
- Words may repeat across parent/child graphs. Identity is node ID, not label.
- Scene selection has explicit single, box, and freehand-lasso modes. Box/lasso gestures own the pointer only while their mode is active; Ctrl/Shift appends to the current selection. Multi-selection is a first-class set with one primary word for the Inspector.
- Spatial movement uses a world-aligned three-axis translation Gizmo at the selected set's geometric center. Direct Alt-drag movement is removed so node motion never competes with camera orbit.
- A child graph contains one gray context-root word representing the word that was entered. That context root cannot own or open another child graph; only its peer words may branch further, preventing accidental infinite self-nesting.

## Data model constraints
- Library contains graphs; graph contains nodes and edges; a node may own one child graph.
- Properties are typed: `text`, `text-list`, or `image`. Global property definitions apply to every node; nodes may add custom properties.
- Every node has required, fixed Transform data: finite `position [x,y,z]` and one positive uniform `scale` value. These are system properties implemented in the schema and Inspector, cannot be removed, and legacy vector scales normalize to their X value (or `1`).
- The Inspector is a quiet reading surface, not a metadata dump. It shows identity plus flat content blocks; blocks render read-only until their pencil button is used. The primary `+` creates text or text-list content. Tags, graph counts, node position locks, and child-graph entry do not belong in the Inspector; layout behavior is global, while child graphs are entered from the scene or context menu.
- Text-list content uses explicit ordered items rather than newline parsing. Editing supports adding and deleting individual items plus deterministic up/down reordering; reading mode preserves that order.
- Track incoming reference count, outgoing relation count, created/updated timestamps, and child-graph presence as derived metadata.
- User-facing global property definitions are named “注解”. An annotation appears on every word eye, even before a value is entered. Removing content or an annotation always requires explicit confirmation; deleting an annotation warns that values on every word will be removed.
- A global annotation cannot be removed from an individual word in the Inspector. Its remove action is hidden there; global definitions are managed only from Settings.
- Persist exact ISO creation and update timestamps per word. Inspector timestamps render in local time to the second and must never use relative placeholders such as “刚刚”.
- Deletes must be recoverable (tombstone/trash) once durable persistence is implemented.
- Deleted words become graph-owned trash entries containing the full node, its incident relations, deletion time, and implicit child-graph reference. The More menu provides recovery across all graphs; restoration reconnects only endpoints that still exist and participates in undo and durable persistence.
- Cutting a relation creates a graph-owned deleted-edge entry with an exact deletion time. The same global trash menu restores it only when both endpoints still exist and silently deduplicates an already recreated relation.
- Destructive actions are keyboard-only in the working surface: select a word or relation and press `Delete`/`Backspace`. Never place a delete or trash action in the inspector or node context menu. Text-field focus, context roots, and the final node are protected.
- Storage target for the desktop app is `%USERPROFILE%\\.Wordverse`; keep data and settings portable and conflict-detectable for folder sync tools.

## Technology
- TypeScript, React and Vite for UI; Three.js via React Three Fiber for the graph scene.
- Tauri 2 is the intended desktop shell. Rust is limited to safe filesystem, window and native-menu commands.
- Persist through an adapter (`StoragePort`). Browser development uses IndexedDB/local storage; desktop uses versioned JSON or SQLite under `.Wordverse` with atomic writes.
- Knowledge data in the browser is stored as one schema-versioned IndexedDB workspace document. Legacy graph/property localStorage keys migrate on first load and are removed only after a successful durable save; device-local view preferences remain in localStorage.
- Each browser save atomically rotates the previous valid workspace into three internal recovery slots before replacing the current document.
- The Tauri desktop adapter stores each main graph and its child-graph subtree in a separate human-readable `%USERPROFILE%\\.Wordverse\\词网\\<name>.json`. `settings.json` contains only global properties, revision metadata, and the graph-file index. Three full recovery snapshots live under `.Wordverse\\备份`, never beside active data. Legacy `workspace*.json` files migrate into that backup directory after the first successful split save. Writes flush temporary files before atomic replacement and reject revision mismatches as sync conflicts.
- `Ctrl/Cmd+S` bypasses the autosave debounce and queues an immediate durable save without opening the browser save-page dialog. Browser autosave waits 350 ms after the last mutation; desktop file autosave waits 900 ms to reduce disk and sync churn.
- Moving the app into the background flushes pending knowledge immediately. A Tauri close request waits for the serialized save queue; the native window is destroyed only after a successful durable write, while a failed save keeps the app open with an error state.
- Storage adapters expose backup metadata and restoration. Restoring creates a new current revision rather than rewinding the revision counter, first backs up the pre-restore workspace, and validates the restored document at the storage boundary.
- Settings expose full-workspace JSON export and import. Imports pass the same schema boundary validation, require replacement confirmation, flush the current workspace into durable storage first, reset undo history and scene tabs safely, then enter the ordinary autosave/revision flow.
- Desktop image properties are content-validated raster assets under `%USERPROFILE%\\.Wordverse\\assets`; workspace data stores portable relative asset references. Full JSON export inlines those assets as data URLs so the exported file remains self-contained.
- Revision mismatches are surfaced as a distinct storage conflict. The UI must offer loading the external workspace or first writing the in-memory workspace to `.Wordverse/conflicts/workspace-conflict-<timestamp>.json`; conflict copies use create-new semantics and are flushed before the external version is loaded.
- Use deterministic, bounded force-layout updates. Never allow a single outlier to expand the graph without limit.
- Layout relaxation uses a three-dimensional spatial bucket index and inspects only neighboring cells; it must remain responsive for several hundred nodes, deterministically separate exact overlaps, and never move locked anchors.
- Both `+` and blank-space double-click creation use the same 3D placement service: sample around the graph centroid, maximize minimum neighbor distance within a compact radius, then apply only a small bounded relaxation to nearby layout. Never append nodes on a fixed plane or line.

## Visual direction
Quiet monochrome observatory: soft white-to-gray depth, ink-black words, translucent neutral panels, and no chromatic accents unless the user later chooses one. Nodes remain billboarded and readable. Degree affects size modestly; a tiny centered neutral dot below the word marks a child graph, with no outer halo, ring, or corner arrow. Motion must respect reduced-motion settings. Relation lines and auxiliary marks fade with distance before labels. Labels start fading only below roughly 9pt projected size and disappear around 4.5pt, never because of scene fog alone.
- Never underline spatial words for hover, selection, linking, or playback; it interferes with glyph reading. Use restrained text tone, node backdrop, and relation feedback instead.
- Every visible node also owns a subtle circular screen-space LOD marker of roughly 3–4 px. It remains visible regardless of camera distance or scene fog, sits beneath the label at close range, and preserves node location after the label fades away.
- Optional word motion is a device-local view setting: the toolbar play button toggles subtle phase-offset sine drift, settings expose bounded speed and amplitude, and editing or dragging a word temporarily suppresses its motion.
- Scene playback is a distinct guided traversal: it chooses a high-degree hub with recency penalties and bounded randomness, eases the camera toward it, then shuffles through its linked neighbors before emerging at another hub. The active relation cluster is emphasized, playback enables subtle word motion, and user navigation can stop the tour.
- Playback focus is Scene-local presentation state. It must never select a word, alter the Inspector, change Hierarchy selection, or mutate graph data. The camera, background, and grid remain stationary during playback so motion reads as words emerging rather than camera navigation.
- Playback frames a relation cluster rather than zooming tightly onto one label. The focal word moves toward screen center while camera distance expands from the farthest directly linked neighbor so surrounding words and connecting lines remain legible; playback never scales graph nodes or isolates the focal word.
- Playback must not reuse hover/selection line width. Related lines retain their normal thickness and receive only a slight opacity lift. Each focal word is pulled toward the fixed camera by an underdamped spring; first-hop neighbors inherit about 20% of that pull and second-hop neighbors about 4%, visibly stretching relations while preserving context. Lines use the animated endpoints every frame. Changing focus redirects the force field continuously—there is no intermediate retreat to the stored layout.
- The near-plane approach ray points through a degree-weighted graph centroid so the focal word emerges in front of a populated background rather than empty space. Related nodes receive a small camera-axis rotational component. On arrival, focal text performs one opaque black-to-gray-to-black color breath (light theme; the inverse luminance equivalent in dark theme) and never fades out.
- Playback hub selection is weighted but repetition-safe: recently visited words and the current hub are excluded while fresh candidates exist, the recent window covers about 65% of the graph, and degree influence uses a mild exponent rather than a square. A highly connected center may lead more often but must not monopolize playback.
- Playback depth is real perspective, not only screen-space scaling: the focal word targets a comfortable near plane around 5.8 world units from the camera, direct neighbors occupy the middle distance, and weakly affected or unrelated words remain far away, producing a clear near-large/far-small hierarchy.
- Ordinary viewing is completely static. Settings may enable a subtle phase-offset sine drift for playback only. A playback focal word additionally receives one slow emergence envelope: scale smoothly rises by about 14% and returns to its exact resting size over roughly six seconds. No playback position cache, sine motion, or scale motion may remain active after playback stops.
- Starting a Gizmo drag immediately stops playback and bypasses every animated-position cache. Manual node movement maps directly to graph coordinates without spring interpolation; camera controls remain disabled only for the gesture duration.
- The canvas uses a restrained radial depth gradient, distance fog, and sparse low-opacity particles for parallax. Never use a dead solid-white field, a starry-sky treatment, or a prominent perspective grid; background depth must remain below relationship lines in the visual hierarchy.
- A device-local view option may enable a faint ground-plane perspective grid. It is off by default, fades strongly with distance, and never changes graph data.
- Same-word merge is a reversible view projection, never a data mutation: visible nodes with the same normalized label share a centroid, relation endpoints are remapped and deduplicated, and a small count marks the aggregate. Aggregate relations cannot be deleted directly; linking exits merge mode first.
- Dark mode is a complete scene theme, not a filter or dark sidebars around a light canvas. It switches sky, fog, labels, relations, grid, panels, fields, tabs, menus, and controls together while preserving the same visual hierarchy.
- WebGL context loss must never become a silent blank Scene. Stop playback, keep knowledge state mounted, show a theme-aware recovery surface, and allow the user to recreate only the 3D canvas.
- Global view settings expose theme, font style, word scale, relation thickness, and—when enabled—grid density, clarity, and range. Font style changes both the interface typography and the spatial labels' weight/spacing treatment. Every control updates the scene live and persists locally; view settings never alter knowledge data.
- Spatial labels must load an actual local CJK font asset for family changes; never represent a serif option using weight or letter-spacing alone. Keep the font offline-capable and ship its license beside the asset.
- Every spatial font option must resolve to an explicit font URL. Never use `undefined` to switch back from a loaded font because the text renderer may retain its prior font; remount the spatial text when its font family changes to avoid stale asynchronous font results.

## Delivery stages
1. Interaction prototype: scene, selection, inspector, hierarchy, tabs, create/delete/edit, sample persistence.
2. Graph mechanics: 3D force layout, connection gesture, camera framing, child-graph navigation, search isolation/merge.
3. Desktop and durability: Tauri shell, `.Wordverse` storage, schema migrations, atomic save, backup and sync-conflict handling.
4. Extensibility: global/custom properties, image assets, import/export, keyboard command system, settings.
5. Quality: large-graph performance, accessibility alternatives, tests, packaging and signed releases.

## Engineering rules
- Keep domain data independent of React and Three.js.
- All graph mutations are commands so undo/redo and persistence can subscribe later.
- Creation immediately places one node named “新词” in the spatial scene and keeps its in-scene label editor active. Enter or blur confirms the name; Escape keeps the existing name. Later renaming is available from the node context menu and `F2`. Never open a detached naming dialog for word creation.
- Graph mutations participate in bounded undo/redo history (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`). Navigation and camera movement are not graph mutations.
- Validate storage schema at the boundary and migrate by explicit schema version.
- Boundary validation normalizes every node and property, rejects non-finite 3D coordinates, deduplicates node identities and undirected relations, and removes self-links or relations whose endpoints do not exist before data reaches React or Three.js.
- Automated storage tests must cover accepted documents, rejected schema versions, malformed property filtering, backup rotation, restoration as a monotonic revision, and reloading the restored workspace.
- Never encode spatial coordinates as knowledge semantics; layout is a view concern.
- Dragging the translation Gizmo manually positions the selected word set and locks those words. Locked words are anchors that automatic relaxation must not move.
- Orbit/camera controls must be fully disabled for the entire Gizmo gesture and restored on pointer-up or pointer-cancel; moving words must never rotate the scene.
- Unity-style tool keys are `Q` Select, `W` Move, and `R` uniform Scale. Box/lasso are one-shot gestures that preserve their result and switch to Move; `Esc` or `Q` always exits them. Hold the right mouse button with `W/A/S/D` for fully camera-relative fly navigation; forward/back follows view pitch and left/right follows the camera right vector.
- Settings contains separate global-view and shortcut pages. Rebindable shortcuts persist as device-local settings; duplicate bindings are rejected instead of creating ambiguous dispatch.
