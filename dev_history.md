# Development history

How SelecTor got out of SAP GUI and into two editors, in the order it actually happened —
including the wrong turns, because those were the expensive part.

The work spans three repositories: the ABAP backend in
[Simple-Data-Explorer](https://github.com/ysichov/Simple-Data-Explorer), this frontend, and later
`AVE` and `ACE` as further backends.

---

## Stage 0 — checking the premise

The starting point was an outside analysis claiming SDE could be rebuilt as an Eclipse plugin or a
VS Code extension. Most of its architecture was right; the estimates were not.

Measured against the actual code rather than taken on faith:

- It named `ZCL_SDE_SQL` as "the dynamic reading class". That class is 62 lines — a `SELECT *
  FROM (name)` wrapper and three existence checks. The real logic lives in `ZCL_SDE_TOOLS` (3054
  lines) and `ZCL_SDE_SEL_OPT` (738).
- It measured the job as "rewrite the UI". The expensive part is elsewhere: `ZCL_SDE_TABLE_VIEWER`
  is not a table, it is a field-catalogue model — F4 helps, ALPHA conversions, units, currencies,
  domain texts. None of that exists in a browser.
- It was right about one thing that mattered a lot: the pivot and the join builder already render
  through `CL_GUI_HTML_VIEWER`. `ZCL_SDE_PIVOT` has zero `CL_GUI` references and returns
  `rv_html`.

**Lesson.** Measure the codebase before believing an estimate about it. Two greps changed the plan.

---

## Stage 1 — the ABAP side: a custom ADT REST resource

Target system: S/4HANA 2023, `SAP_BASIS 758`. All prerequisites present.

The route chosen was an ADT REST resource rather than a plain ICF service, because
`CL_ADT_RES_APP_BASE` inherits `CL_REST_HTTP_HANDLER` and its `get_static_uri_path()` returns
`/sap/bc/adt` — so the resource attaches to the node ADT already owns. No SICF node, no
authentication of our own, no CSRF handling.

Two classes and one BAdI implementation. The classes took minutes. The registration took an hour.

### What went wrong, in order

**The wrong BAdI.** Spot `SADT_REST_RFC_APPLICATION` contains both `BADI_ADT_REST_RFC_APPLICATION`
and `BADI_ADT_DISCOVERY_PROVIDER`. Implementing the second one activates cleanly, adds
`INTERFACES IF_ADT_DISCOVERY_PROVIDER` to your class (a missing implementation is only a warning),
and the route 404s. Verified afterwards with `SELECT * FROM enhobj WHERE enhname = '...'` — the
`INTF` row must read `IF_ADT_REST_RFC_APPLICATION`.

**The filter is mandatory.** Leaving it empty fails activation with one "active simultaneously"
conflict per existing implementation — 134 of them — because an empty filter claims every URI.

**The filter value is the full path.** Reading
`CL_ADT_REST_REGISTRATIONS=>get_all_adt_registrations` suggests filters are ignored: it takes every
implementation and calls `fill_router` on each. That method is a dev-time listing. The dispatcher is
`CL_ADT_WB_RES_APP` → `CL_ADT_RES_APP_ACCESS` → FM `SADT_CREATE_APPL_REST_RESOURCE`, which does
`GET BADI ... FILTERS static_uri_path = i_uri` with the complete request path. So the value is
`/sap/bc/adt/zsde/*` with `CP`, not `/zsde/*`.

**`CP` looks absent in SE19.** The filter dialog is laid out as an interval,
`Value1 <Comp1> Filter <Comp2> Value2`, and Comparator 1 offers only relational operators. Entering
the condition in the right half stores it as `COMPARE = CP`. Confirmed against SAP's own
registrations: `SELECT ... FROM badi_string_cond WHERE filter_name = 'STATIC_URI_PATH'` shows
`/sap/bc/adt/bopf/*`, `/sap/bc/adt/ato/*` and friends, all `CP`.

**Lesson.** When a framework has two code paths reading the same registration, find the one that
serves requests. Reading the wrong one cost most of that hour.

The recipe is written up in `ADT.md` in the backend repository.

---

## Stage 2 — real data

`GET /sap/bc/adt/zsde/table/T001?rows=100` returning rows plus a field catalogue as JSON.

`CL_ADT_REST_JSON_HANDLER` turned out unusable: it serializes through a Simple Transformation named
at construction, and an ST is statically typed, so it cannot describe a structure known only at
runtime. `/UI2/CL_JSON` builds from RTTI instead, returned through
`CL_ADT_REST_PLAIN_TEXT_HANDLER` constructed with `content_type = if_rest_media_type=>gc_appl_json`
— that handler takes the content type as a constructor parameter, so no extra ST object was needed.

The catalogue is one call: `cl_abap_structdescr->get_ddic_field_list()` returns key flags, DDIC
types, lengths and field texts together.

Deliberate gaps, stated rather than hidden: no conversion exits (values arrive as stored), transparent
and cluster tables only, no paging. A missing table answers a real 404 instead of an empty result,
because `ZCL_SDE_SQL=>READ_ANY_TABLE` silently returns nothing for an unknown table.

**Volume, measured rather than guessed:** `TADIR?rows=10000` came back in 2–3 seconds. Accepted.
Worth remembering that roughly half that payload is field names repeated on every row, and that
2–3 seconds is a page-load budget, not a keystroke budget — reactive filtering needs a small page.

---

## Stage 3 — the Eclipse plugin

The toolchain was almost complete already: ADT installed (275 `com.sap.adt` bundles), Eclipse on its
own bundled JustJ JRE 21. Missing: PDE — the "for Java Developers" package does not include it.
One install from the release update site, no new IDE, no JDK.

There is no separate ADT SDK. The installed ADT bundles *are* what you compile against, and PDE uses
the running Eclipse as its target platform.

### Three steps, one risk each

1. **A view that opens.** A `ViewPart` showing a label. Proves PDE, the manifest, the extension
   point and the runtime launch — nothing else.
2. **An SWT Browser loading the URL.** Proves the data arrives. `SWT.EDGE` pinned deliberately:
   the default on Windows may be the legacy IE control, which cannot run the intended front end.
3. **Reusing the ADT session.** No login dialog at all.

### Talking to ADT

The API has no public documentation, so it was read off the bundles with `javap` from the p2 pool.
That technique — `unzip -l` for classes, `unzip -p ... MANIFEST.MF` for exports, `javap` from the
JustJ JRE for signatures — replaced every guess for the rest of the project.

```java
IProject project = AdtProjectServiceFactory.createProjectService().getAvailableAbapProjects()[0];
String destinationId = project.getAdapter(IAdtCoreProject.class).getDestinationId();
IRestResource r = AdtRestResourceFactory.createRestResourceFactory()
        .createResourceWithStatelessSession(URI.create("/sap/bc/adt/zsde/table/T001"), destinationId);
r.addContentHandler(new JsonContentHandler());
String json = r.get(new NullProgressMonitor(), String.class);
```

The URI is relative to the system root. A content handler must be supplied — ADT's own
`PlainTextContentHandler` sits in a non-exported package, so `JsonContentHandler` implements
`IContentHandler<String>` here. Declaring `application/json` matches a response sent as
`application/json;charset=utf-8`.

These packages are exported with `x-friends` naming only SAP bundles, so the compiler reports
*Discouraged access*. That is a warning, and abapGit's ADT plugin depends on them the same way.

---

## Stage 4 — three failures worth recording

**An invalid escape sequence.** A `\\` collapsed to `\` while writing a file, and `"<\/"` is not
legal Java. Two remote guesses failed to find it; one line from the **Problems** view found it
immediately. Since then the Java sources avoid backslashes entirely — single quotes in generated
HTML, `" | "` instead of newline escapes — and every write is checked with `grep -c '[\]'`.

**The WebView2 deadlock.** `SWTException: Waiting for Edge operation to terminate timed out`. A
`BrowserFunction` callback runs inside the WebView2 message pump; the HTTP request and a modal logon
dialog were sitting in it. The fix is the whole architecture of the bridge:

```
JS  sdeLoad(name, rows, query)  →  host queues the work and returns at once
host, outside the callback      →  logon, request, result into a field
host browser.execute("sdeReady()")
JS  sdeReady() → sdeTake()      →  takes a string already in memory
```

`sdeReady()` takes no arguments on purpose, so no data passes through a JavaScript literal and
nothing has to be escaped. This accident turned out to be the reason the page later ported to VS
Code unchanged — a webview cannot call its host synchronously either.

**Views stacking instead of splitting.** `showView` puts each new instance in the same part stack,
where it hides behind the current tab; after eight clicks there were eight invisible tabs. Splitting
needs the E4 model, and a 3.x view sits in the perspective as an `MPlaceholder` while the `MPart`
itself is shared — so it is the placeholder that has to move. `findPlaceholderFor` exists for
exactly this.

---

## Stage 5 — filters

Passed as indexed query parameters, one part per parameter: `f1`, `s1`, `o1`, `l1`, `h1`. Nothing is
packed into a separator-delimited string, so a colon in a `TIMS` value cannot break the request.

Structured rather than a raw WHERE string, for one concrete reason: `ZCL_SDE_SQL=>READ_ANY_TABLE`
catches `CX_SY_DYNAMIC_OSQL_SYNTAX` with `#EC NO_HANDLER`. A malformed condition would return an
empty table and no complaint, and a user who mistyped a field name would conclude there is no data.
Passing the parts separately lets the resource answer 400 with a sentence.

Semantics are real select-options: lines for one field are ORed, an excluding line becomes
`AND NOT`, different fields are ANDed — matching `ZCL_SDE_SEL_OPT`, so moving the real select-options
across later needs no rework.

The client field is dropped from the catalogue by data type `CLNT` rather than by name, which covers
the same cases as the GUI version plus tables where it is called something else.

---

## Stage 6 — VS Code

### Pilot one: portability, on a stub

Before writing a second host in earnest, the cheapest possible question: does the page run in a
webview at all? A ~130-line extension in plain JavaScript, no `npm install`, no build step, serving
the very same `resources/table.html` from the Eclipse plugin's folder and answering with fabricated
rows.

The stub did one deliberate thing beyond returning data: it sent the query the page had built back
as a visible row, `query: f1=bukrs&s1=I&o1=EQ&l1=0001`. So the run proved not only that the grid
renders, but that the selection panel reaches the host with everything intact.

It rendered unchanged. That settled the architecture: the page knows nothing about SAP, and only the
host is written twice.

The shim is fifteen lines, and it fits because of an accident. `sdeLoad` never returned a value —
that shape was forced by the WebView2 deadlock in stage 4 — and a webview cannot call its host
synchronously either. The contract the Edge bug imposed is exactly the one VS Code requires.

### Pilot two: removing the stub

Then the real connection, and this is where the time went — none of it in the code.

**The settings were invisible.** `selector.*` only registers when the extension runs, so searching
for it in the development window finds nothing. The extension lives in the second window, the one
titled `[Extension Development Host]`.

**`Ctrl+,` did nothing** — the focus was inside the webview, which swallows the keystroke. The
command palette route works: `>Preferences: Open User Settings (JSON)`.

**JSON needs its commas.** Settings inserted at the top of `settings.json` need a trailing comma;
the instructions had assumed the bottom.

**The certificate had expired.** Not self-signed — expired. Node refuses, correctly. The answer was
an explicit `selector.allowInsecureCertificate`, off by default, whose error message names it: the
check is disabled by a deliberate act, not bypassed quietly.

**`Response is not JSON:` with nothing after it.** The body came back empty on a 200, and the
message truncated because there was nothing to show. An empty 200 is not success, so the host now
reports the status with `content-type`, `content-length` and `location` — it never recurred, but the
diagnostic stays.

**The extension host itself was the worst of it.** It launches with every installed extension
enabled; one of them called `process.exit()` in a loop, drowning the log, and it was never clear
which of two identical-looking windows was which. `--disable-extensions` in the launch configuration
made the runtime clean and, as a side effect, told the windows apart — the notice *"All installed
extensions are temporarily disabled"* only appears in the right one.

In the end the second window was removed from the loop entirely: a directory junction from
`%USERPROFILE%\.vscode\extensions` to the repository folder makes it a normally installed extension,
edited in place and reloaded with *Developer: Reload Window*.

### What the host is

About 200 lines, no dependencies: settings for the system, the password in the OS credential store
via `SecretStorage`, a plain `https` request. A 401 discards the stored password and says so,
because a wrong password kept in the store would block every later attempt with no visible way out.

Real `SCARR` data arrived with Ukrainian column headers, where Eclipse had shown English ones — the
DDIC texts follow the logon language, and basic auth uses the user's own while the ADT session uses
the project's. A small thing, but it confirmed the catalogue really comes from the dictionary.

What Eclipse gives free — the session — has to be built here. What needed E4 model surgery in
Eclipse is one argument in VS Code: `ViewColumn.Beside`.

---

## Stage 7 — one page, two hosts

The palette moved into CSS variables with three selectors, because the hosts report the theme
differently: `:root` for light, `prefers-color-scheme` for the OS (which is what the browser inside
Eclipse reports), and `body.vscode-dark` / `.vscode-light` for VS Code, winning over `:root` by
sitting closer to the content.

---

## Stage 8 — launching from the object

Right-click an ABAP object → **AXE** → a service. Two adapter facts, both non-obvious, and both
found by reading the bundles:

- The menu entry appears with `<adapt type="com.sap.adt.tools.core.IAdtObjectReference"/>`, but in
  the handler `IAdaptable.getAdapter` returns null for exactly those selections. It does not consult
  registered adapter factories; `org.eclipse.core.runtime.Adapters.adapt` does.
- The selection is an ADT tree node. It yields the object, but does **not** adapt to `IProject`. The
  project comes from `com.sap.adt.project.IProjectProvider.getProject()`, which the nodes implement
  through `IAbapRepositoryBaseNode`.

The project matters because it decides which system answers. Two windows opened from two projects
showed `ALC` and `E19` side by side — which is the point.

Per-instance state travels in the view's **secondary id**, because that is the only thing Eclipse
restores when it recreates views after a restart.

---

## What the practice turned out to be

**One risk per step.** Every stage above was shaped so that a failure named its own cause. The steps
that skipped this — the first BAdI registration, the first VS Code launch — cost the most.

**Read the API, do not guess it.** `javap` against the p2 pool for Java, `SAPRead` and `API_STATE`
against a live system for ABAP. Web search returns nothing usable for `x-friends` packages.

**Check before it runs.** ABAP syntax against the real system before the user pulls; `javac` against
the bundle pool before rebuilding in Eclipse. Both caught errors that would otherwise have surfaced
as a dialog three steps later.

**Fail loudly.** Every silent branch in this project cost time: a swallowed OSQL syntax error, a
handler returning `null`, a 200 with an empty body. Each one now says what happened.

**Prefer the host's own facilities.** ADT already has a debugger, a compare editor and an object
history service. `IAdtObjectHistoryService` can list revisions and fetch their content client-side —
which means half of a code-review tool needs no ABAP at all.
