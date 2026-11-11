# Commands and the VERTEX Tools window

SelecTor's **Technical names / Text** toggle changes field labels in Selection and table headers. The choice is remembered; fields without a description keep their technical name.

**Fields** (a table's function beside Data) lists the fields of a table or structure as SE11 does - key, data element, type, length, decimals, short text - and an `.INCLUDE` or `.APPEND` row names the structure it brings in as a link that opens that structure's fields. A structure has no rows, so it opens on Fields; the chat opens a structure that way too.

Breakpoints set through VERTEX Smart Debugger or MCP appear as native VS Code points in the VERTEX source editor gutter. Click a point to remove it from SAP and VERTEX Smart Debugger too. Conditions, disabled state and logpoint mode are synchronized; opening a source tab refreshes its points.

- **VERTEX: Open Panel** — also available from the VERTEX icon in the Activity Bar.
  The panel holds the VERTEX chat, the active SAP-system selector, provider and
  model controls, and the **VERTEX Tools** button.
- **VERTEX Tools** — opens the unified tools window. Choose an object type,
  enter its name (a name with `*` or `+`, such as `Z_VX*`, lists the objects of that type that
  match; pick one with the mouse or the arrow keys and Enter; a plain name that is not found
  lists the names starting with it), then choose the available function (for example Data,
  UML diagram, Metrics, Calls diagram, Logic diagram, Diff or Versions). Only the functions that
  apply to the chosen type are offered: a transport has Versions and its review, a class or a
  program metrics, diagrams and diff, a package its package-level views. **Object Navigator**, first and the default for a
  package, a transport request, a program, an include (its program's tree), a function module (its group's tree), a class or an interface, is SE80's Repository Browser tree: a package's subpackages and its objects
  by category and type (in an ABAP editor, **VERTEX Tools → Object Navigator** in the context menu opens it for that
  object; for a program in local files the tree - includes, events, local classes with their methods, subroutines - is
  read from the program and its include files, each entry opening in its own file), a request's objects, its tasks' included, by type (an object only a released task holds, taken out of the request, is hidden; **Show removed objects** shows it in red), a program's includes, fields, events, subroutines (opening at their FORM), screens, GUI statuses, tables and local classes (unfolding to their methods and attributes), a class's superclass (Inherited from), types, attributes, methods, events with their visibility and friends (Friends of); an interface's types, attributes, methods and events.
  A subpackage, class, interface or function group unfolds where it stands; a click on the name of an object or component opens
  its source in the editor beside the tree, a component at its line, and the tree keeps the focus. **Calls diagram** shows which program, class or
  method calls which in the whole object (ACE's Calls Flow): **Classes | Methods** draws a block
  per class or per method, and picking an event or a form in Parts starts the calls there, as a
  double-click in ACE's tree does (a click on the object's name at the top of the parts list goes back to the whole program). **Logic diagram** is one routine - a method, a report event such as START-OF-SELECTION or AT SELECTION-SCREEN, a FORM or a dialog MODULE - as its code (Code) or as its flowchart (Diagram, ACE's Flow Scheme). A magnifier follows the
  pointer over every diagram; Shift and two fingers on the touchpad (or the wheel) change its strength; Ctrl and a pinch zoom
  the whole picture. The available functions depend
  on the selected object type; there are no separate SelecTor, Metrics or
  Versions commands any more. For a class or a program the window keeps one **Parts** list at
  the left: pick a method, a section, a form or an event there, and every function shows that
  part; switching the function keeps the list and the choice. Diff keeps its own Parts and
  Versions column, AVE's layout, and opens on the same part. A part opens on its newest change: the
  latest version compared with the one before it; pick another version or pin a base with ◇ to change that.

  Metrics for a class or program has a **Table / Visual** switch. In Visual, tile area scales with the selected indicator and every tile shows its method or unit name and value. CC and MI colours follow the table's risk grades; other indicators use a relative ranking within the object. Single-click a tile to select it; double-click or press Enter to open its source beside the view.
  Visual has a 2–300% scale control and a Fit button that fits the whole map into the pane. Fit and the ± buttons animate scale changes; Ctrl+wheel changes scale immediately, as in UML, while ordinary scrolling moves around the map. Zoom changes tile space and reveals more labels without enlarging text.

  Logic opens on **Code**: the method's lines as written, coloured by token in the theme's colours (keywords,
  strings, numbers, comments, method calls, classes), with their line numbers - a click on a number opens the line
  in the editor, and the editor's cursor marks its line here. **Diagram** shows the same method as a flowchart. Both
  fold to the same Depth, and a block opened in one is open in the other.
  **Depth** in Logic (1 by default) is how many levels inside the method are shown: 1 its own statements - an IF with
  its ENDIF, not what is inside -, 2 the inside of those blocks too, and so on. A block deeper than that shows its opening
  and closing statement, with what is inside folded into one node that says how many operations it hides; a click on that
  node opens the block in place, a step at a time: a block with branches (WHEN, ELSEIF, ELSE, CATCH) first shows its
  branches, each with its own inside folded, and a branch opens to one more level on its own click. A double-click on the line that opened a block or a
  branch folds it again.
  Every statement in the Diagram leads to its line in the source with a click - plain operations, CONTINUE and
  ENDIF included; a single left-out operation in *Logic only* is drawn as itself, and only two or more fold into one
  block. The code moves the diagram, not the other way round: a click, a key or a scroll in the editor positions the
  diagram, and scrolling into another method opens that method's diagram; scrolling the diagram stays in the diagram, and
  it reaches the code only by a click on a node.

  In Code Explorer, **?** explains every metric: what ACE counts, the formula, and which values
  are good.

  **Versions** is laid out as AVE's was: the parts of the object on the left, the
  versions of the chosen part under them — the line between the two is dragged to
  share the height — and the diff on the right. Picking a version shows the change
  it made. Pin a version with ◇ and every version picked afterwards is compared with
  that base instead. **Prev | Any** chooses what a picked version is compared with: the
  one before it, or any version pinned as the base with ◇ — the active version until one
  is pinned. **Inline | 2 pane**
  in the diff's bar shows the change in one column or the two versions side by side; in
  2 pane the parts and versions move to a band above the diff so the code gets the full
  width. A changed line - one at least half the same as the line it replaced - shows what changed
  inside it: Inline draws it once, as the new line marked `~` with the removed words struck through
  and the added ones marked; 2 pane puts it beside the old line, each side marking its own words. The versions list folds on its own with the arrow at the right of its bar. The parts column can be folded away and resized.

  The diff compares whole lines and finds the shortest edit script (Myers' algorithm), as
  Eclipse's Text Compare does, with nothing on top: no pairing of a line with its commented-out
  copy, no reordering of declarations. VERTEX has its own implementation, written from the
  published algorithm, because Eclipse's comparer is under the EPL and VERTEX is MIT.

  AVE's three switches sit beside it: **TOCs** shows the versions written by
  transports of copies (off by default), **Dups** hides a version whose source is the
  same as the one before it (on), **Case/ind** compares without case and indentation
  (on).

  **A transport's overview.** A request with no saved review lists its objects with who worked on them and in which tasks; **Build review** builds the review. Review ignores spacing and case outside literals and marks only the changed words. **Approve**, **Decline**, **Comment** and **Undo** act on one block; filters show approved, declined, not processed or commented blocks, also per developer or reviewer. **Ask AI** asks about a block or a whole object. New objects are shown in green, deleted ones in red, and generated code as not reviewed.

  **Code review of a transport.** A transport request in Versions shows its review: every part
  it changed, the diff of that part and the diff cut into blocks. The pair of versions is chosen
  by AVE's rule: the request's newest version, or the active one when ADT records it under the
  request and no other request's version sits above it, against the first older version that is
  not the request's. The request's own transports of copies count as the request. A released
  request is reviewed only from its own versions; a part it holds no version of is listed with the
  reason instead. Without VERTEX's ABAP a method or a class section is cut from the class's own versions; its old
  side is then the release of the previous request - another request's transport of copies holds the whole class,
  the request's edits with it, and is skipped. With VERTEX's ABAP a method has its own versions. With **Ignore SAP generated**, code SAP generated is not reviewed: a part whose new version is authored by `SAP*`,
  the Gateway classes `*_MPC`, `*_MPC_EXT` and `*_DPC` (not `*_DPC_EXT`), a function group's main
  program `SAPL*`, a new object of comment lines only, a class section holding nothing but its
  header, and an include the table maintenance generator (SE54) writes for SM30 - its header names the generator version. A generator's stamp line rewritten in place (`generation date:`, `regenerated at`, the
  maintenance generator version, SEGW's `has been generated on`) is not a change. The
  **Blame** toggle beside Versions | Review, off by default, names the developer who wrote each changed line: the versions
  between the pair are replayed (one more read per version, so a long history takes longer),
  and a version is credited to the owner of the task it came from - a transport of copies to the
  task of the request it copies - not to whoever released or copied it. Only the request's own versions count: a transport of copies made from another request does not. Of the request's tasks that carry the object, a copy goes to a released one stamped at or before it, by the system's date and time. When the object sits only in tasks of one developer, every changed line is that developer's and no versions are read. A block belongs to whoever
  wrote most of its lines, every line of it shows that name, and **Developers** counts each developer's own lines and blocks. Hover
  the name for the version, date and request. With Blame off, a block is the author's of the new
  version. A review saved by AVE with Blame shows its line authors when the toggle is on. Opening a review only reads a saved one. A review that is not saved yet is built from ADT
  with **Build review** and saved, once built, where `vertex.review.storage` says: each part appears in the summary as soon as it is read, and the status line
  says which part is being read; an object opens once the whole review is built. The review takes the objects on the request's own list and in its tasks not yet released; an object taken out of the request after its task was released is not reviewed. **Build log**, folded at the end of a review built
  in this session, lists each step - the parts found, each part's versions and the pair taken - and a SKIP line
  with the reason for every part that gave no block. The
  **Ignore SAP generated** checkbox beside **Build review** and **Rebuild from ADT**, on by default,
  leaves out the generated code listed above; cleared, it is reviewed like any other. **Rebuild from ADT** builds it again from the request as it is now, and **Save** keeps it. A saved review takes **Approve**,
  **Decline** and comments on each block, the way AVE records them, so AVE and every VERTEX window
  read the same review. Where reviews are kept is `vertex.review.storage`: the `ZAVE_REVIEW` table
  (needs the ABAP backend), files, or both. A review kept both in the table and in a file is
  shown with both copies named - who saved each and when - and a **Table | File** switch opens
  either; nothing is merged, and a change goes back to the copy shown. On a system without the ABAP
  backend the table can be read but not written, so a change to the table copy goes to the file,
  and the page says so. A saved review is shown at once and checked against the request beside it, by each part's
  versions; when the check is done, a part that changed since, joined the request or left it is
  named above the table, or the review is marked up to date. **Rebuild from ADT**, under the line that says when and by whom the review
  was saved, replaces the saved review with one built from the request as it is now - its verdicts
  and comments are dropped. A data element, domain or table that ADT keeps no versions of on the
  system is taken from the saved review as AVE built it, and checked against the request by its
  version directory (VRSD). A released request is not
  checked: its versions no longer change, and later work of other requests is not its review's
  concern. Two people saving the same review at once do not
  overwrite each other: the second save is refused and asks to read the review again.
  The review opens on a summary as AVE draws it: **Developers** - each author's rows added, changed
  and deleted, blocks, approved, declined and the share approved; a developer opens the objects they
  changed, and **← Review** goes back - then the objects, a group per
  kind (programs, each class with its parts) under a caret, each with its total; **Expand all** and
  **Collapse all** fold them - a class's heading opens the changes of the whole class, part after part,
  each with its blocks - and **Reviewers** - each reviewer with a verdict or a comment, their
  approved, declined and total; a reviewer opens the objects they reviewed. A row opens the object's blocks; going back to the summary keeps where it was scrolled. There each block has **Open** (its code
  in the editor), **ASK AI** (the block on the chat's chip) and, on a saved review, **Approve**,
  **Decline** and **Comment**; beside the object's name **ASK AI** takes all its blocks, and **Copy
  prompt: diff** / **Copy prompt: full** put a ready prompt on the clipboard - the blocks with five
  lines around each, or the whole source with the changes marked - for a chat where no AI is set up here.
  Beside them **Code review / Technical documentation** picks the prompt for that one object. In a developer's or reviewer's view, and in all changed objects
  (**Technical documentation** in the saved transport summary), the same choice sets the prompt for **AI prompt diff / full**. The documentation prompt uses only the visible diff, lists created and modified objects apart - a created object goes whole and is described as it is, a modified one by what changed - and ends with `TR Details: <request>`.
  **Prompts…** shows and edits both prompt texts. **Save user file** writes `~/.vertex/prompts/code-review.txt`
  or `~/.vertex/prompts/technical-documentation.txt`; these files take priority over the built-in texts and are
  read again when copying. **Use built-in** removes the selected user file.
- **VERTEX: Switch System**
- **VERTEX: Forget Credentials**
- **Add the VERTEX MCP server to Claude Code or Codex** — the link under `vertex.mcp.port` in
  Settings: choose Codex or Claude Code to copy configuration for both the review and debugger servers
  ([Debug with an assistant](https://github.com/ysichov/VERTEX/blob/main/vscode/docs/debugging.md))
- **VERTEX: Review & Activate** — editor title or context menu; opens the block-by-block
  Code Change panel described below.
- **VERTEX: Save & Activate** — editor title; saves the whole tab without the block review.
- **VERTEX: Run ABAP Unit Tests** — Ctrl+Shift+F10 or the beaker in the editor title of a class
  or program tab, as in Eclipse. SAP runs the object's test classes (risk level harmless, every
  duration) and VS Code's Test Explorer shows object, test class and test method with pass or
  fail, the time, the alert text, and a link to the line where the failure was raised. A tab with
  unsaved changes is refused: the tests run the active source. The same run is **VERTEX: Run ABAP Unit Tests** in the command palette.
- **Where-used** — Shift+F12 (peek) or Shift+Alt+F12 (list) in a SAP tab: the places that use
  the name under the cursor, from SAP's where-used over the saved source. A place in a source
  VERTEX cannot open as a tab is named in a warning.
- **VERTEX: ABAP Documentation** — F1 or the context menu in a SAP tab: SAP's keyword
  documentation for the statement under the cursor, beside the source. In these tabs F1 replaces
  the command palette key; Ctrl+Shift+P still opens it.
- **VERTEX: Run ATC Check** — Ctrl+Shift+F2, the checklist in the editor title, or **VERTEX: Run ATC Check**
  in the command palette. Checks the object with the system's default ATC variant; the findings
  appear in the Problems view and underlined in the tab, priority 1 as errors, 2 as warnings,
  3 as information. A new run replaces the last one's findings for that object.
- **VERTEX: Go to (by context)** — F12 or double-click in a VERTEX SAP source tab; follows a
  supported name according to its ABAP context.
- **VERTEX: Back** — Alt+Left; returns to the preceding location followed by VERTEX navigation.
