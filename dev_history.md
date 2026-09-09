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

## Stage 9 — metrics: the second backend

VERTEX is one frontend for three ABAP tools: SDE for data, ACE for code, AVE for versions and
review. Only the first had a way in. Metrics were picked as the first slice of the second, because
they need no write, no history and no diff: if it broke, there would be one reason.

### Reaching ACE without SAP GUI

`ZCL_ACE_METRICS=>CALCULATE` does not take an object name. It takes the parse result, and that
lives in `ZCL_ACE_WINDOW`, which has thirty `CL_GUI` references and is built by `ZCL_ACE`'s
constructor before anything else happens. Instantiating the orchestrator inside an HTTP request
was never an option.

The way through is one class-method that nothing in ACE advertises as an entry point:

```abap
DATA ls_source TYPE zif_ace_parse_data=>ts_parse_data.
zcl_ace_parser=>parse( EXPORTING i_program = lv_program i_include = lv_program
                       CHANGING  cs_source = ls_source ).
DATA(ls_result) = zcl_ace_metrics=>calculate( is_parse_data = ls_source
                                              i_program     = lv_program ).
```

`ZCL_ACE_PARSER` has no `CL_GUI` reference at all and fills the structure through a CHANGING
parameter. It also instantiates `ZCL_ACE_PARSE_CALLS_LINE`, which is what fills `TT_CALLS_LINE` —
the table of unit boundaries the metrics read to find methods. So the whole parse the metrics need
happens without a window, and the three statements above are the entire backend.

**`i_program` and `i_include` are not the same argument.** Every caller inside ACE passes the same
value for both, and for a class that is wrong here: a class pool holds nothing but `INCLUDE`
statements, the method bodies live in its `CM` includes, and `CALCULATE` aggregates
`tt_progs WHERE program = i_program`. Parsing each include *under the pool* — include the include,
program the pool — is what makes the methods of a class add up to one object.

### One prefix for three backends

The route was attached to the existing application class rather than to one of its own:

```abap
router->attach( iv_template      = '/zsde/metrics/{name}'
                iv_handler_class = 'ZCL_SDE_ADT_RES_METRICS' ).
```

A second prefix would have meant a second BAdI implementation and a second `STATIC_URI_PATH`
filter — the hour that stage 1 cost. One frontend spanning three backends does not need three
registrations; the path prefix is not the identity of the service.

### What went wrong

**The system includes.** `D010INC` returns `<SYSINI>` alongside the real ones, so `SYSTEM-EXIT` and
`%_CTL_END` arrived as code units of the object under measurement, and were counted into its
totals. ACE never meets this because it selects `CM%` for a class; the general query does not.
An angle bracket cannot occur in a repository object name, so that is what the skip tests.

Nothing caught it. The syntax check passed, the local lint passed, the stub run passed — the two
rows were seen on a screenshot of the finished view.

**A linter arguing with itself.** The first lint run reported parser errors on `IF`, `LOOP`,
`APPEND` — statements that plainly exist. The source had been HTML-escaped in transit, so the
linter was parsing `&lt;&gt;` where the code has `<>`. Five lines containing one `<>` and one `&&`
separated the tool from the code in a single run.

**Lesson.** When a check reports something impossible, check the check. And a screenshot of the
real thing still finds what three green checks miss.

### The page

`resources/metrics.html` keeps the host contract of `table.html` unchanged — `sdeLoad`, `sdeTake`,
`sdeReady` — so the fifteen-line VS Code shim covers it as it stands. It was run against a stubbed
host before Eclipse ever saw it, the same order as the VS Code pilot in stage 6: the page first,
the connection second.

`MetricsView` stopped being a label and became a second copy of `SelectorView`'s transport half.
Two copies is where a base class is proposed and not yet written; the version explorer would make
it three.

### The contract for what comes next

AVE renders finished HTML in ABAP, and porting that as it stands would have been the cheap way in.
It was rejected: a review is hundreds of approve/decline clicks, and returning a page per click
recreates the document every time — scroll position, collapsed groups and filter state included.
AVE has ABAP code whose only job is to restore the scroll position, which is the same cost paid
from the other side. Measured in SAP GUI, one approve takes one to two seconds.

So the ABAP will return hunks and metadata as JSON and the page will render them, on the browser
port of AVE's own diff algorithm that already exists in `html_simulator`. Saving leaves the click
path, which makes an explicit unsaved indicator mandatory: a green tick over a failed write is
exactly the silent success this project keeps refusing.

---

## Stage 10 — versions: the third backend, and the easy one

AVE was expected to be the hard port and turned out to be the easy one. Where ACE keeps its parse
result inside a window object with thirty `CL_GUI` references, AVE's whole version layer is
already free of the GUI — the object handlers, the version directory reader, the version itself,
the author resolver and, importantly, the diff engine. Not one `CL_GUI` between them.

So there was no way *in* to find. There was a published contract to call:

```abap
DATA(lo_object) = NEW zcl_ave_object_factory( )->get_instance(
                      object_type = 'CLAS' object_name = lv_name ).
DATA(lt_parts)  = lo_object->get_parts( ).
DATA(lo_vrsd)   = NEW zcl_ave_vrsd( type = ls_part-type name = ls_part-object_name ).
DATA(lo_ver)    = NEW zcl_ave_version( ls_vrsd ).
```

A part carries its class, its unit and the VRSD key; a version carries number, date, time,
author, the author's real name, request and task — with the transport of copies already resolved
behind it. The factory raises `ZCX_AVE` for an object it cannot find, which is a 404 for free.

### Two requests, not one

The parts of a class are its sections, its local includes and one entry per method. Answering
parts and versions in a single call would read the version directory once per method just to draw
a list of names — eighty reads to show eighty rows. So the resource has two shapes, and the page
asks twice: the parts, then the versions of the part that was clicked. That is AVE's own left and
middle pane, for AVE's own reason.

### What is deliberately refused

A transport request and a package. Reading them is the whole point of AVE — a change is a
transport, not an object — and AVE shows a progress bar with an estimate while it works, and asks
whether to continue when the estimate grows. One blocking HTTP call has nowhere to put any of
that, so the resource answers 400 and says why, rather than being left to time out and blame the
network.

### ZCX_AVE says nothing

Its constructor passes `previous` to the superclass and nothing else, so `get_text( )` on the
exception itself yields the generic class text. The sentence worth showing is always one or two
links down the chain, and the resource walks it. An error page reading "AVE cannot list the parts
of ZCL_X" and stopping there would be exactly the silent failure this project keeps refusing.

### The handlers, third copy

`DataHandler` and `MetricsHandler` were the same thirty lines twice: read the selection, refuse
loudly if it is not an ADT object, count up, open the view. A versions handler would have been the
third, which is the point at which stage 9's argument applies again — so `ServiceHandler` holds
the three steps and a handler now names its view, its secondary id and what to say when the
workbench refuses.

### Not done here

The diff. `ZCL_AVE_POPUP_DIFF=>COMPUTE_DIFF` is a class-method over two source tables — the name
promises a popup and there is none — so the ABAP side of it is three statements. The work is in
the page, and AVE has already done half of it: `html_simulator/diff.js` is its diff algorithm
ported to the browser.

---

## Stage 11 — the context menu was the wrong front door

Right-click an object, find VERTEX near the bottom of a long menu, pick a service — once per
object. Fine for the first look at something, tiring as the way in.

SelecTor never had that problem, because its page carries the table name and a Load button: open
the window once and drive it from inside. The two new pages now carry the same thing, an object
type beside a name field, and the context menu becomes what it should have been from the start —
a shortcut that prefills, not the only door.

Three consequences, none of them in the pages.

**The type list belongs to the resource, not to the page.** Each page offers the types its service
reads, but does not enforce them: a type the resource refuses comes back as its own sentence. One
authority for that rule is enough, and it is the one that can be wrong about it.

**A window can now be opened with nothing selected.** Show View gives no object and therefore no
project, and until now only SelecTor could handle that — it asked which ABAP project to read from.
That question is the same for every service, so it moved into `PageView` and SelectorView's copy
went with it. A window whose remembered project has since left the workspace asks it too, instead
of refusing.

**The ADT type carries a subtype.** `CLAS/OC` selects the CLAS entry by its head. A head the list
does not know is added rather than dropped, so a window opened on an object type the service does
not read still shows what it was opened for and lets the refusal explain itself.

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
