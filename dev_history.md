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
showed `A4H` and `EXX` side by side — which is the point.

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

### What was refused, and should not have been

A transport request and a package. Reading them is the whole point of AVE — a change is a
transport, not an object — and AVE shows a progress bar with an estimate while it works. One
blocking HTTP call has nowhere to put that, so the resource answered 400 and said why.

That reasoning was about the wrong method. AVE's progress bar belongs to its *review
preparation*, which reads every version of every part of every object. Listing a transport is the
other one: `ZIF_AVE_OBJECT~GET_PARTS` reads the object keys of the request and stops. The
expensive `GET_PARTS_EXPANDED` sits next to it in the same class and nothing here calls it.

Worse, the answer was already in the design. The parts-then-versions split exists precisely so
that no single request is long, and that is the progress channel the refusal claimed was missing.
A transport is now a scope like any other: its objects come back as the parts list, clicking one
opens it, and a row at the top leads back.

**Lesson.** A refusal is a claim, and this one was never measured — the cost of two methods was
read off the name of one. The cheapest check would have been to call it.



### ZCX_AVE says nothing

Its constructor passes `previous` to the superclass and nothing else, so `get_text( )` on the
exception itself yields the generic class text. The sentence worth showing is always one or two
links down the chain, and the resource walks it. An error page reading "AVE cannot list the parts
of ZCL_X" and stopping there would be exactly the silent failure this project keeps refusing.

### What went wrong: a key made of blanks

Every method reported no versions at all. Class sections and programs were fine, which is what
made it readable: their names carry no internal padding and the methods' do.

A method's entry in the version directory is keyed by the class name padded to thirty characters
followed by the method name — the blanks in the middle *are* the key. The resource put that name
through `CONDENSE`, which collapses runs of blanks to one. The key was destroyed on the way out,
before the client ever saw it, and no round trip could restore it. `CONV string` alone does what
was actually wanted: it drops the trailing blanks and touches nothing else.

Two further edges came out of the same look:

- `URLEncoder` writes a space as `+`, which stands for a space only under form encoding. A key
  that is mostly spaces should leave nothing for the other side to interpret, so it is
  percent-encoded strictly.
- The same `CONDENSE` sat on the author's name, the request and the task. A person with two
  spaces in their name is not ours to rewrite.

**Lesson.** The failure was visible for one screenshot and invisible in every check before it,
because an unknown key answered with an empty version list — which reads exactly like a part
nobody ever changed. The resource now verifies the key against the object's own parts and answers
400 naming the padding as the likely cause. A wrong answer that looks like a legitimate one is
worse than an error, and this project keeps rediscovering it.

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

**A tab that names an object has to keep up with it.** The title was set once, from the object the
window was opened on, which was true right up until the input bar changed the object under it. The
page now reports what it actually loaded and the view renames the tab. It is an optional call:
a host with no tab to rename does not define it, and the VS Code shim is exactly that host today,
so the page checks before calling rather than assuming a contract both hosts have not agreed to.

The tab also names the service before the object — `Metrics: ZCL_X` — because two windows can
stand on one object and Eclipse truncates a tab from the right, eating the object name first.

**The ADT type carries a subtype.** `CLAS/OC` selects the CLAS entry by its head. A head the list
does not know is added rather than dropped, so a window opened on an object type the service does
not read still shows what it was opened for and lets the refusal explain itself.

---

## Stage 12 — the diff

The last piece of the version explorer, and the cheapest of the three services on the ABAP side:
`ZCL_AVE_POPUP_DIFF=>COMPUTE_DIFF` is a class-method over two source tables. Its signature carries
`i_title` and `i_confirm_key`, which read like a progress dialog waiting to happen inside an HTTP
request — they are never read. The progress indicator lives in the blame builder, one method
further down, and `compute_diff` reaches only `diff_lines` and `RS_CMP_COMPUTE_DELTA`. Checked
before calling, not after the first dump.

What it returns is already the right shape to send: `op(1)` and `text`, which serialises to
`{"op":"+","text":"..."}` — and that is, character for character, the shape AVE's own browser port
in `html_simulator/diff.js` produces. The two halves were written years apart on two sides of the
wire and they meet.

### What the page draws, and what it does not

The page renders the operations itself: line numbers following the new version, a marker column,
and a compact mode that folds unchanged lines more than three from a change. Deleted lines carry
no number, because they are not in the source you would open in the editor.

What it does *not* do yet is the character-level highlight inside a changed line, and the pairing
pass that decides which deletion belongs to which insertion. Both exist twice already — in the
ABAP and in `diff.js` — and porting the renderer wholesale was tempting. It was left out on
purpose: `diff.js` writes its colours inline (`background:#ffffff`), which would fight the palette
that makes one page work in a light editor, a dark editor and whatever the OS reports; and taking
a copy of it would fork a file AVE keeps deliberately in step with its ABAP.

### What went wrong: the newest version had nothing below it

The first real diff came back as the whole method added, `+198 −0`, with the pair printed as
`00000 → 99998`. Neither number is a version anybody can look up.

`99998` is AVE's key for the **active** version — the directory keeps it as `0`, and AVE re-keys it
so that it sorts after the numbered ones, which means the list arrives **oldest first**. The page
compared the clicked version with the row *below* it, and below the newest there is nothing. So the
old side was empty and every line counted as added.

`00000` was the same mistake seen from the other end: the page sent an empty FROM, `VERSNO` is
numeric, and an initial one prints as `00000`. The answer echoed a version number that was never
asked for.

Three things came out of it. The resource sorts newest first, because that is the order a reader
wants and the order the "compare with the one below" rule needs. An absent FROM is echoed as
absent. And `99998` is shown as **active**, since a five-digit sentinel means nothing to the person
reading it.

**Lesson.** The screen was full of plausible content — a real diff of a real method, only against
the wrong side. SAP's own *Compare Method Implementations* on the same object took ten seconds to
open and showed what the answer should have been. A second opinion that already exists is cheaper
than reasoning about which of your two version numbers is the fake one.

### Reading a version means reading the change it made

Clicking a version compares it with the one below it in the list, not with the newest. That is the
change *that* version made, which is what a version number means to a reviewer. The oldest has
nothing below it and is compared against nothing at all — every line added, which is what a first
version is.

The resource refuses a version number that is not in the directory rather than diffing against an
empty table. Both produce a screen; only one of them is an answer.

---

## Stage 13 — the join, and a constructor in the way

The fourth service, and the first one whose backend did not hand itself over.

SDE's join builder discovers what the dictionary offers around a table, keeps the join model,
and generates the statement. All of that is clean code with no control in it. It was simply
unreachable: the constructor built splitters, HTML viewers and, without a parent, a dialog box,
and it demanded a reference to the table window itself.

**Counting is not reading.** The first thing I reported was that the joins were not portable,
because the class holds seventeen `CL_GUI` references against the pivot's zero. Asked what those
references actually were, they turned out to be nine of HTML-viewer plumbing and six of the
frontend file dialogs behind the layout files. Candidate discovery, the join model, the statement
builder: none. The measurement was real and the conclusion from it was wrong, and it would have
cost a rewrite of a hundred and twenty-nine lines of foreign-key knowledge that already worked.

**Lesson.** A count over a file answers a question about the file, not about the thing you want
out of it. Read the lines the count is made of before planning around them.

### The way in

`IO_VIEWER` became optional, the base table can be named instead, and without a viewer the
constructor discovers the candidates, builds the selection and returns before creating a control.
Nothing else needed guarding: every render method already checks that its own control exists, and
the ready flag stays false, so nothing pushes a result into a window that is not there. The class
had been written defensively enough that the door only had to be opened.

`CACHE_WHERE_SELECTION` is skipped with the rest — the filters of a headless caller arrive with
its request; there is no selection panel to read them from.

### Replaying a stateful builder over a stateless protocol

The builder hands out an alias when a table is first taken into the join and never reuses it. HTTP
has no session to keep that in, so the client sends its whole selection on every request, in the
order it made it, and the model is replayed from the base table. Same order, same aliases. A
client that reorders its own list renames its own columns, which is worth knowing before writing
one.

`TOGGLE_CANDIDATE` ignores a table name it was never offered — a join quietly missing a table. The
resource checks the name against what the dictionary proposed and answers 400 with the way to see
the list, because a silently smaller join is a wrong answer wearing the shape of a right one.

### Running it

`EXECUTE_SQL` turned out to be the same shape as the constructor: two hundred and fifty lines of
work — normalising the statement, cutting `UP TO` and `ORDER BY` and `GROUP BY` back out of it,
resolving every `alias~field` to its dictionary type, building the structure, running the dynamic
`SELECT` — and then three lines that hand the result to the window. It returns the result now and
rebinds only when there is a window to rebind into.

Seven ways out of that method were a `MESSAGE` the GUI shows and a caller without one cannot see.
For the resource that is an empty result with no reason attached, which is the failure this
project keeps refusing, so each of them now also reports its text. The GUI passes neither of the
new parameters and behaves exactly as before.

The rows are asked for separately. Assembling a join means ticking one table after another, and
reading the database on every tick to answer a question nobody has asked yet is not free — so the
statement comes back without a row count and the Run button supplies one.

### Finishing the builder, and a chip that lied

What shipped first was a join you could assemble and not shape: every field of every joined table
in the SELECT list, and the type and condition the builder proposed with no way to argue. Both
were already there — `HANDLE_FLD_ACTION` had the codes the field toolbar sends, the model had the
type and the condition — and both were private. A fourth door.

The field list travels as a **set**, not as the click that changed it: `pick=X` says the list is
the caller's and the rest name what is in it. That is the same choice as the tables, made for the
opposite reason. The tables have to be replayed in order because an alias depends on when a table
was taken in; the fields have no such memory, so sending the set lets the page rebuild the request
from what is on screen rather than from how it got there.

An empty set needed the flag: without it, "no fields" and "no opinion about the fields" are the
same absent parameter.

**And a chip that lied.** The pivot's field chips showed the bare field name. Joining SCARR to
SFLIGHT produced two chips both reading `carrid`, one from each table, doing different things.
Seen on a screenshot again — the stub had one table in it, which is exactly the case where the bug
cannot appear.

### The filters were already reachable

The `WHERE` looked like the part that would have to be rewritten, since it is built from the
selection panel and there is no panel. It turned out `BUILD_WHERE` reads a member cache first and
only falls back to the panel when that cache is empty — because filters restored from a layout
file exist before the panel is built. Filling the same cache is all a headless caller has to do,
and not one line of the `WHERE` logic changed.

That is the third time in this stage that what stood in the way was an entry point rather than the
code behind it — and none of the three needed the logic touched. SDE was written the same way this
front end is being written, with Claude Code, and the separation was habit rather than foresight:
nothing in it anticipated a second caller. Habit was enough. What it did not produce was a way in,
because nothing ever asked for one.

The page sends the criteria it already has: a filter typed on the table applies to the join built
from it, which is what it does in SDE. Filters on a joined table wait for the panel to learn about
its columns.

### abaplint, when the system is not there

The SAP connections dropped mid-session, so the usual syntax check against the system was not
available. `npx @abaplint/cli` parses ABAP locally with no system at all, and it caught a real
error immediately: a table expression indexing the result of a method call, which is not
something ABAP allows. It cannot see the SAP standard classes, so it is a parser, not a syntax
check — but it catches exactly the class of mistake that a careful writer still makes.

What it cannot catch is anything that depends on the dictionary. It passed the filter code
cleanly; the system then rejected it, because a free-selection range calls its component `OPTI`
and not `OPTION`. A parser with no dictionary cannot know the components of a structure, so every
field name written against a DDIC type is still owed a real check.

---

## Stage 14 — the pivot, and the exception that became a rule

The pivot model was the one part of SDE that needed nothing at all: no control in it, a layout
that can be set directly, a statement built over the join's own `FROM`. Everything the previous
stage learned applied again, and `EXECUTE_PIVOT` needed exactly the two changes `EXECUTE_SQL` had
needed — the result back through a parameter, the reasons back through another, and the window
required to hand the matrix over rather than to build it.

**The exception I granted myself.** For the join I refused to set the application's global row
count, on the grounds that a caller over HTTP has no business setting a global. Two hours later I
set it for the pivot, because the row limit was read from it deeper down and passing a parameter
meant touching one more signature. Caught it on re-reading, made it a parameter, and the rule
survived. A rule stated once and broken once is a preference.

### What the page shows

SDE's tools area has two cards, Join and Pivot table, and the page now has the same two. In pivot
mode the join's fields become chips with three buttons each — row, column, measure — because a
chip is small, an Eclipse view is smaller, and a drag that misses its target is worse than a
click. Measures carry an aggregate.

The matrix is spread in ABAP rather than by the database: a dynamically specified SELECT list
cannot carry the CASE expressions a SQL-side matrix would need, so the statement groups by the
dimensions and every line of its result is one cell.

An aggregate the field's type cannot carry is settled rather than refused — `SUM` over a character
field comes back as something that field can do. That is worth knowing at the page: what returns
is the answer, not necessarily what was asked for, and the statement says which.

---

## Stage 15 — catching the second host up

Four services had grown in Eclipse and the VS Code host still knew one: the table. Every page had
learned to ask it for something it could not answer, and the pages had learned to check before
asking - `if (typeof sdeTitle === "function")`. That guard is honest, and a project where it
spreads is a project with one host and a museum piece.

**The shim stopped naming arguments.** It used to forward `name, rows, query`, which is the table
page's own signature; metrics asks with two arguments, versions with six, the join with six others.
A host that names them needs editing every time a page learns one. It now forwards the argument
list as it comes, and what the arguments mean belongs to the service:

```js
window.sdeLoad = send('load');
window.sdeJoin = send('join');
```

**The path builders are duplicated, deliberately.** The same four URLs are built twice, once in
Java and once here, because the two hosts share no language. They sit in one table at the top of
the extension so the divergence is at least visible in one place. A service the host does not
answer says so through the page's own error path rather than silently doing nothing.

**What is still not the same.** Eclipse takes its session from the ABAP project and opens a view
from the object tree; VS Code has neither, so the three commands open an empty page and the input
bar in each of them is the way in. That bar exists because of stage 11, which was asked for in
Eclipse - and it is what made the VS Code side possible without inventing a second way to name an
object.

### A backslash that was eaten twice

The edit that broke this stage open was not the code. Writing these files through a shell heredoc,
one level of escaping disappeared before Python saw it, so `\n` in a script became a real newline
in a match string and every replacement of that block failed. It failed loudly, which is the only
reason it cost minutes rather than a corrupted file.

Two things came out of it. The pages had been written with `String.fromCharCode(10)` for exactly
this reason since stage 4, and the same trick now keeps the shim's own `join` free of escapes. And
the tooling rule: a file with escapes in it is written with the editor, not with a heredoc.

---

## Stage 16 — the review, read first

Approve, decline and comment are the last thing AVE has that VERTEX does not, and they are also
the first thing that would write. So the stage was split at that line: read the saved review now,
decide about writing separately.

**Where it lives was the design question.** A review is a different activity from browsing
versions - its own state, its own persistence, its own navigation - which argues for a service of
its own. What decided it the other way was the entry point: you review *this transport*, and the
transport is already on screen. A separate command would have opened empty, asked for the request
again, and loaded the same scope the versions view had just loaded.

So it is a card, beside Versions, exactly as Join and Pivot are cards inside SelecTor. The project
now has one idiom for "same scope, another question" instead of two. The card only appears for a
transport or a package, because in AVE the unit of work is the request and a review of one object
is not a thing.

And a card rather than a hidden mode for a second reason: that boundary is where writing will
start. Everything until now only reads. A person should be able to see when they are in the thing
that saves.

**A fifth resource rather than a fifth branch.** The versions resource answers three questions on
one path by which parameters arrived - parts, versions, diff - and a fourth condition would have
meant reading the whole method to know which of them you get.

**Not written, and the page says so.** With no approve button there is nothing to press, which is
the honest state: AVE prepares a review and this reads it. An approve button that only looked like
one would be worse than none.

Two answers that are not errors and had to be said as such: a system with no `ZAVE_REVIEW` table,
and a request with no review saved. AVE answers the first with a setup page rather than a failure,
for the good reason that nothing is broken - a review has simply never had anywhere to go.

---

## Stage 17 — drawing what was saved

The summary of stage 16 showed how many blocks an object has and how many of them carry a verdict.
Clicking a row did nothing, because the blocks themselves were not there yet.

**The plan for this was wrong, and one question corrected it.** The next step looked like a diff
engine: compute the blocks of a part on the fly, with a progress bar, reusing AVE's pair selection
so that the hunk keys mean the same thing on both sides. Then came *"и в расчетах в таблице всё же
готово? просто отрендерить данные?"* — is the computation in the table already done? Reading
`ZIF_AVE_ACR_TYPES` answered it: `TY_DIFF_DATA-DIFF` is `ZIF_AVE_POPUP_TYPES=>TY_T_DIFF`, the very
`{op,text}` list our own diff endpoint already returns, and the saved payload clears every hunk's
html precisely so that the operations are what persists. A prepared review needs no computation at
all. The work went from a diff engine to a read.

It also closed the hazard named in stage 16: the hunk key is `type~object~n` and carries no version
pair, so the same key means different lines under a different comparison. The stored diff carries
its pair in `TY_DIFF_DATA_KEY`, so for saved data the question does not arise.

**What the page cannot work out for itself.** Where a block starts and ends among the operations.
Reading `ZCL_AVE_ACR_HUNK_INFO=>COLLECT` shows why: a block swallows the context lines inside an
unfinished ABAP statement (so that a call and its parameters are approved together), keeps a blank
line when more changes follow, and is dropped entirely when `HAS_VISIBLE_CHANGE` finds no colour in
its rendering. A client re-deriving "a run of changed lines" would disagree with AVE about how many
blocks there are, and the numbering the keys are built on would shift.

What survives the save is `START_LINE` — the line of the *new* version a block opens on, counting
insertions and context but not deletions — and `CHANGE_COUNT`. Replaying that one counter over the
stored operations places every block exactly, with no rule to keep in step. The resource does it and
returns `op_from` / `op_to`; a block it cannot place comes back with zero rather than dropped, and
the page prints it above the diff, because a payload whose blocks and diff disagree has to be seen.

**One rendering.** The action row of a block is a row inside the diff table, and `diffTable` took a
second, optional argument instead of gaining a twin. Had the review drawn its own diff, the two
would have drifted — the compact fold alone would have been enough to make them disagree.

**A dictionary object has no lines.** `TABD`, `DOMD` and `DTED` are reviewed in AVE as a table of
fields, and that page is kept as ready-made html because nothing remains to rebuild it from. The
resource marks it `ddic` and the page says it does not render that yet, rather than showing an empty
diff and letting it read as "no changes".

---

## Stage 18 — the law, and what it cost to keep

Stage 17 shipped a review page that was right about what it showed and wrong about how it got
there. Two things came back at once.

**The objects were in a heap.** A transport touches forty parts, and the table listed them in
payload order: `GET`, `Public section`, `GET`, `Private section`, `GET` — a method's name means
something only inside its class, and every class has the same sections. AVE's own report groups them
by class, and had all along.

Then the rule that governs this project was stated outright: **reuse and reproduce the
functionality; where you cannot reuse, change the backend until you can.**

It is not a style preference. VERTEX shows the same data as three tools its user already trusts, and
a second opinion about that data is a bug the moment a reader notices it — they will be comparing
the two screens.

**First reading: what was already public.** `CAT_ORDER` and `CAT_LABEL` were public class methods on
`ZCL_AVE_ACR_REPORT`. The ordering around them was not, so the report grew
`REPORT_OBJECTS( it_obj_stats )`: the objects it lists, in the order it lists them, with the class
name filled in where the statistics carry none and objects with no changed line left out. `TO_HTML`
lost forty lines and calls it; the resource calls the same thing. One rule, two front ends.

**Second reading, and this one had been written the wrong way the day before.** The resource located
each saved block among the diff operations by replaying AVE's line counter — carefully, correctly,
and entirely by hand. The documentation for it even said the rule "is not one a reader of the result
can reconstruct", one paragraph above reconstructing it.

The real walk was in `ZCL_AVE_ACR_HUNK_HTML=>COLLECT_ROWS`, cutting the same blocks on its way to
rendering them. It came out as `HUNK_RANGES( it_diff )`, returning for each block where it starts and
ends among the operations, the line it opens on, and whether it changes anything visible.
`COLLECT_ROWS` renders from those ranges; the resource reads them. The hand-written replay is gone.

**Third: the walk that named the blocks.** `ZCL_AVE_ACR_HUNK_INFO=>COLLECT` had a walk of its own,
because it counts authors and kinds as it goes, and its comment said it must make "the same
decision" as the renderer. That is a promise kept by reading, and it was already broken. It now
takes the ranges too and only measures what is inside them: 180 lines became 90, and AVE has one
walk instead of three.

**Proving a refactor without a system.** `COLLECT_ROWS` is AVE's review rendering and `COLLECT` is
what the hunk keys are built from; either off by one operation would renumber every block a review
is filed under. All three walks were transcribed into JavaScript and run against random diffs.

| Compared | Input | Result |
|---|---|---|
| `COLLECT_ROWS` before and after | 5000 diffs, 17606 blocks | no difference |
| `COLLECT` against `HUNK_RANGES` | 20000 diffs, 75722 blocks | one difference, below |
| Is a start line unique to a block | 21983 ranges | no two share one |

**The one difference was a bug, and it was COLLECT's.** Its walk closed the last block on a sentinel
`=` appended to the operations — except that a sentinel is also a context line, so when the diff
ended with an ABAP statement still open, the sentinel was swallowed as "context inside the
statement" and the final block was never closed. It was rendered, because `COLLECT_ROWS` closes on
the end of the table, and then discarded, because `COLLECT` did not. The last changed block of such
a part had no key, no verdict and no place in the counts. Taking the ranges fixes it: 1759 of the
20000 random diffs ended that way, far more than real ABAP will, since an include usually ends on
`ENDMETHOD.`, but not never.

---

## Stage 19 — the first write

Everything until here read. Approving, declining and commenting change state on the server, and the
law decided the shape of it before any design did: **reuse and reproduce; where you cannot reuse,
change the backend until you can.**

**Most of it was already reusable.** `APPLY_SAVED_PAYLOAD` unpacks a saved review into working
tables, `BUILD_SAVE_PAYLOAD` packs them back, `SAVE_REVIEW_PAYLOAD` writes. All public, all free of
`CL_GUI`. The resource loads, hands over, and saves; it knows nothing about what approving means.

**What was not reusable was the middle.** What a reviewer actually does to a block lived inline in
two places in the SAP GUI front end — approve and undo in the command handler, decline and comment in
the note dialog's handler — reading and writing the popup's own member tables. It came out as
`ZCL_AVE_ACR_STATE=>APPLY_REVIEWER_ACTION`, one method for all four, and both old callers now go
through it. The rule about a repeated message being a double click rather than a second comment, the
one about a note being filed under whoever wrote it, the one about a thread keeping what the block
looked like: all of it happens once, for both front ends.

**Two decisions where a quiet default would have destroyed something.**

`APPLY_SAVED_PAYLOAD` drops generated Gateway classes when told to, mirroring a setting in AVE. The
default is to drop. VERTEX passes false: a write that adds one verdict must take nothing away, and
the setting is not this program's to act on.

A save writes the whole payload. Two reviewers on one request is the normal case, so a write built
on a state that has moved since the page read it would carry the other reviewer's approvals off with
it. The page sends back the stamp it read and a changed one is refused, loudly, with who saved it.
There is no merge. A merge nobody asked for is exactly how a review would quietly lose work.

**The hosts differ, and only here.** Eclipse posts through the ADT communication layer, which holds
the destination and carries the CSRF token out of sight. The VS Code host authenticates with basic
auth and has no such layer, so it fetches a token from the discovery endpoint and sends it back with
the cookies of the response that issued it. One page, two hosts, and the difference confined to the
transport.

**Self-review is on, and it is temporary.** `C_ALLOW_SELF_REVIEW` exists because the request being
tested is entirely the tester's own work, and with AVE's rule on there would be nothing to press. It
is a named constant rather than a missing check, so removing it is one line and finding it is one
grep.

---

## Stage 20 — the order the statement is written in

SelecTor's join in the SAP GUI has a strip of chips you drag: the tables of the FROM, and the fields
of the SELECT, in the order they come out. VERTEX had the lists but no way to order them.

**The stateless replay made this easy rather than hard.** The join request already carries the
tables as `t1..tN` and the SELECT list as `sf1..sfN`, so the order on screen is already the order in
the statement. Moving a chip is moving one entry of an array and asking again. Nothing on the server
changed.

Two drop targets, the same two the GUI has: another chip means "before that one", and a dashed end
marker means "last". The marker is not decoration — without it there is nothing to drop on after the
last chip.

**Moving a table throws the SELECT list away, on purpose.** An alias is handed out by position, so
`T1_MATNR` becomes `T2_MATNR` the moment two tables swap. A field list keyed by alias would then name
columns that no longer exist. It goes back to what the builder proposes, which is the same thing
taking a table into the join already did.

The base table is drawn and cannot be moved: the request is replayed from it, so moving it would be
choosing a different base, which is a different question.

**Three more things the screen itself said, once it was used.**

The tables around SFLIGHT are sixteen, and sixteen checkboxes with a name and a description each is
a screenful of list before the join comes into view. They are chips in rows now, name and an arrow
for which way the key points, with the word and the description one hover away. Four rows instead of
sixteen.

The rows moved to the top of the join. What is being assembled and what it returns belong on screen
together, and the answer should not be the thing below the fold.

And every change runs the join again. It used to return the statement alone, to keep a tick of a
checkbox off the database — a defensible rule that turned out to mean the rows on screen belonged to
an older join than the one being looked at, and that Run had to be pressed after every move. A read
of a hundred rows is cheaper than that.

**A comment keeps its shape.** The box takes several lines, so the box that shows it has to give
them back: `white-space: normal` on the cell had been folding a pasted snippet onto one line. AVE
keeps the line breaks and loses the leading spaces, for the same reason in HTML; one `pre-wrap` in
its renderer would settle it there too.

---

## Stage 21 — the pivot, and what auto-running turned up

The pivot became the cross SDE draws in the SAP GUI: columns across the top, rows down the left,
measures beside them, the fields underneath. A field goes into a slot by being dragged onto it, or by
being clicked and then having a slot clicked — the second way is in the GUI for a reason, and a slot
in an Eclipse view is small. `MIN_SLOTS` and the growing rule are read from `ZCL_SDE_PIVOT`: one more
slot than the section holds, never fewer than three.

**The aggregates are asked for, not guessed.** Which ones a field may be taken under is decided by
`ALLOWED_AGGS` from the internal type, and the internal type never travels to the page. They were
private instance methods that used no instance state, so they became public class methods and the
join resource sends the list with every field. A page that offered `SUM` on a `CHAR` field was
offering something the pivot then quietly turned into `COUNT`.

**Colour by table, six of them, cycled — the GUI's own palette**, defined for both themes. Key
fields keep the doubled border SDE gives them. The field list breaks into a row per table with its
own all/none/keys, because a table that starts halfway along a line is one the reader has to hunt
for.

**Auto-running the join found a real bug.** Pressing *none* returned `HTTP 400: Unknown field
SFLIGHT-*`. `BUILD_SQL` writes a star when its list is empty, and `EXECUTE_SQL` parses the SELECT
list with a regular expression that has no case for one. It had never surfaced because assembling a
join used not to run it.

The fix is not in either of them. A star means *all the fields*, and a caller who cleared the list
asked for the opposite. Nothing chosen is not everything chosen: the resource now answers an
explicitly empty list with no statement and no rows, and the page says a statement starts at one
field. `BUILD_SQL` keeps its fallback, because the GUI reaches it by a different road.

---

## Stage 22 — the half that is missing, and the half that ships

**A plugin without its backend now gets a page, not a red error.** VERTEX is a
front end and a set of ADT resources, and installing one without the other is a
setup state rather than a failure: nothing is broken, the ABAP has simply never
been put there. The hosts tell the two apart at the source, where the status code
actually is — Eclipse catches `ResourceNotFoundException`, VS Code reads a 404 —
and mark the answer. Everything else stays a failure.

Each window names the repositories **it** reads. SelecTor needs the resources,
Metrics needs ACE as well, Versions needs AVE. Naming only the first would send
somebody who is missing the second to install what they already have. The same
list is a short line on the start screen, always, because the person who has just
installed the plugin and typed nothing yet is exactly the one who needs it.

Opening a link had to become a host function. In Eclipse an anchor would navigate
the view away from the page it is on, and a webview cannot open one at all, so
`sdeBrowse` goes to `Program.launch` on one side and `openExternal` on the other.
A host offering neither leaves the address to be copied.

**The extension could not have been published at all.** Its pages are the Eclipse
plugin's and live in that bundle, read across the repository with a `..` path. A
vsix carries only the extension folder, so the packaged extension would have
started with no pages. `vscode:prepublish` copies them in, and the extension
prefers a local `resources/` when it finds one — one source of truth, one copy
made at packaging time, and nothing to decide at run time. Confirmed by packaging
for real: the vsix now carries all three pages.

---

## Stage 23 — Flow: the picture ACE already draws

**A method's branch scheme instead of its numbers.** The Metrics window got a *Flow*
toggle; with it pressed, a click on a row replaces the table with the control-structure
diagram of that unit — `IF`/`CASE`/`LOOP`/`TRY` with the straight stretches folded into
"N operations" nodes that open when clicked. Escape or *← Units* goes back.

Nothing about that picture was invented here. `ZCL_ACE_CODE_HTML=>BUILD_SCHEME` already
writes it, for the *Scheme* window in SAP GUI, and it writes mermaid text. So the resource
returns that string and the page draws it — the same division as everywhere else, and this
time the law cost almost nothing to keep.

**What ACE had to give up to be asked from outside.** Three things, all of them extractions
rather than new logic:

- `BUILD_SCHEME` gained `I_OFFSET`. It used to assume its source started at line 1 of the
  scan, which is true for the whole include the GUI window shows and false for one method
  cut out of a program. `ANALYZE` already took an offset for exactly this reason; the
  parameter only had to be forwarded.
- The walk that finds where each unit begins and ends left `ZCL_ACE_METRICS=>CALCULATE` and
  became `UNIT_BOUNDARIES`, public, now also carrying each unit's first and last **source
  line** and its qualified name. The metrics list and the diagram have to agree about which
  method a row is; a second walk here is precisely how they would stop agreeing.
- `ENSURE_CALLS_PARSED` left `ZCL_ACE_WINDOW` and became `ZCL_ACE_PARSER=>PARSE_CALLS`.
  Without it every call folds into an "N operations" node like ordinary code — the parser
  fills `TT_CALLS` a statement at a time, on demand, and a diagram needs the whole include
  up front.

On the SDE side, resolving an ADT name to the program ACE parses, and parsing it with all
its includes, were the metrics resource's private business. `ZCL_SDE_ACE_SOURCE` now holds
both and `ZCL_SDE_ADT_RES_METRICS` calls it, so `ZCL_SDE_ADT_RES_FLOW` is left with only
the part that is its own: find the unit, cut its lines out, ask for the scheme.

**The one thing the page decides is a click.** ACE marks the nodes that fold with a
`sapevent:aceexp_<line>` link, and the page reads the line out of the href and asks again
with that line added to the open list. It never decides which nodes those are. The other
link ACE writes, `acego_`, selects code in its source window; there is none here, so it is
swallowed rather than followed.

**mermaid ships inside the plugin.** The page is handed to the browser as a string —
`setText` in Eclipse, `webview.html` in VS Code — so it has no address to resolve a
`<script src>` against, and a CDN would fail silently on a machine behind a corporate
proxy. So the library is a file next to the pages, the host reads it and returns its text
through a new `sdeAsset` call, and the page runs it. It is handed over the first time a
diagram is asked for, not on every open, because it is megabytes and most visits to this
window never press Flow.

---

## Stage 24 — the flow, and what it cost to leave the window behind

**The Metrics window became a window with three pictures.** A mode list replaced the
Flow toggle: *Flow*, *Scheme*, *Metrics*, in that order, with the numbers last. Which
one a window opens on follows from the object rather than from a preference — a
program or an include has code above its units, so the order things run in is the
first thing worth seeing; a class has no such code, its pool is nothing but `INCLUDE`
statements, so it opens on the list of its methods. The flow takes the whole window,
because it is about the object and has no unit to point at; the scheme keeps the
narrow list beside it, because picking a unit is the whole interaction.

**ACE had to learn to exist without a screen.** `ZCL_ACE`'s constructor builds a
window and an object tree — SAP GUI controls — and an ADT resource has no session to
build them on. But the analysis never wanted them: every scanner uses the viewer as a
place to keep the parse, the step table and the depth, and asks it to draw nothing.
So both constructors took an `I_HEADLESS` flag and return at the line where state ends
and the first control begins, and `SET_PROGRAM` gave up its data half as
`PARSE_PROGRAM` — the parse plus the call walk, no controls. Four lines of state, and
the whole flow becomes reachable from outside.

**`STEPS_FLOW` split the same way**: `BUILD_STEPS_FLOW` is the picture, a function of
the step table and the parse; the instance method keeps the filter that needs the
viewer's own code-flow walk, and the drawing. Depth and Only Z needed nothing at all —
`M_HIST_DEPTH` and `M_ZCODE` were already public, so they became query parameters.
The window opens at depth 3 rather than ACE's 19: nineteen draws a picture too large
to read on first sight, and winding it out is one field away.

**Three errors, all from the same step, and none of them findable here.** Making a
method static takes away the instance, and the compiler says so three separate ways:

- `I_FOCUS` typed `STRING` against a `PROGNAME` field — not type-compatible.
- `CLEAN_LABEL` and `FORMAT_NODE_LABEL` called by their short form from a static
  method, which only static methods may be. Both are pure text; both became static.
- `IS_PARSE_DATA` written to. The drawing is not a pure reader: with a focus it dips
  back into the parser for bindings nobody resolved yet and fills them in. It became
  `CS_PARSE_DATA`, CHANGING, because a local copy would throw that work away and the
  caller would pay for it again.

`abaplint` reported zero parser errors before and after each of them. They are type
and scope errors, not parse errors, and only the syntax check on the real system found
them. Which also settled how this half of the work should go: write, push, pull,
`SAPDiagnose action="syntax"`, fix — and never build the next layer on ABAP that has
not been through it.

**A day lost to the wrong server.** `arc` points at a local trial on `127.0.0.1:50000`
that is down after every reboot; QAS is `arc-qas`. Reporting "the system is
unreachable" for a whole session, and planning around it, was a failure to look at
where each connector pointed.

---

## Stage 25 — handing the tools to somebody else's agent

**VERTEX does not get an agent of its own.** The editors people already sit in have
one: Copilot, Claude Code, Codex. They have the loop, the chat, the model picker and
the user's own subscription, and every one of those is better than what would be
written here. What none of them has is any idea what SAP is. So the extension stopped
being only a set of windows and became a **source of tools**.

The way in is **MCP**, because it is the one door all of them open: VS Code registers
an extension's server through `mcpServerDefinitionProviders`, and Copilot for Eclipse,
Claude Code and Codex all take a server address. A VS Code-native `languageModelTools`
registration would have reached Copilot in VS Code and nobody else.

**The pilot is a transport review**, and it needed no ABAP at all. `ZCL_SDE_ADT_RES_REVIEW`
already computes exactly the right thing — AVE's own change set for a request: which
objects moved, who changed them, the diff of each against its previous version, cut into
the same blocks the reviewer approves, carrying the verdicts and the notes already given.
Two tools read it:

- `sap_transport_changes` — the objects of a request, with block and line counts and
  whether anything is still open;
- `sap_transport_diff` — one object, or the whole request up to a size budget, rendered
  as a unified diff whose hunk headers are AVE's blocks.

The block boundaries are deliberately AVE's rather than recomputed. The saved verdicts
are filed against them, so hunks cut a second way here would put the model's findings on
different ground than the reviewer's own buttons.

**The connection is the extension's.** Every tool call goes through the same `fetch()` the
pages use, so the active system, the user and the password in the OS credential store are
already there. Nothing is passed to a separate process, and the server learns no secret.

**What a local HTTP server has to get right**, from the specification rather than from
taste: one endpoint, POST answered with plain JSON, notifications answered `202` with no
body, `405` for the GET stream that is not offered, the `Origin` header validated,
binding to `127.0.0.1` only, and a bearer token — "on this machine" is not the same as
"any process on this machine". The port is the one the system hands out, because several
windows each run their own server and a fixed number would make the second one fail.

**The first version called an unprepared review a clean transport.** The summary lists
objects only out of the review AVE has saved, so for a request nobody has prepared yet the
list is simply empty — and the tool read that as "the request holds no versioned source".
A model handed that sentence reports that nothing changed. It was found by reading the
resource again while picking a real transport to try the pilot on, not by a failed run.
An empty list now has its three meanings told apart: no `ZAVE_REVIEW` table, no saved review, and a saved review with no
changed line. The first two are tool errors — there is nothing to read, which is not the
same as nothing to find.

Eighteen checks, run from a scratch script rather than kept in the repository, drove the
real server over real HTTP with a stubbed system behind it:
the four guards, the lifecycle, version negotiation, an unknown tool as a protocol error,
a missing argument as a tool error rather than a crash, the rendering of both tools, and
the two states in which there is nothing to read.

**Read-only, on purpose.** A tool result goes to the model, so the first version offers
what a reviewer looks at and nothing that writes. The same reasoning keeps SelecTor out:
table contents are business data, and a diff is not.

**This does not replace ABAP-AI-Code.** That project exists because in many SAP shops the
code may not leave the system through a laptop at all; it keeps its own agent, its own
encrypted keys and its own loop inside the system. Using Copilot or Claude Code means the
source travels system → laptop → vendor. The two serve different policies, and neither
makes the other redundant.

---

## Stage 26 — an address that outlives the window, and a server without the editor

**The pilot's address died with the window.** Stage 25 let the system pick the port and drew a
fresh token on every start, reasoning that several windows each run a server and a fixed number
would make the second one fail. That was right about windows and wrong about what mattered.
Copilot never noticed — VS Code asks the provider again and is handed whatever is current — but
Claude Code and Codex store the address they were given, so every window reload quietly broke
their registration. The port became a setting, `vertex.mcp.port`, 37777 by default, and the token
moved into VS Code's SecretStorage, so both survive a reload. A second window on the same port is
an error naming the setting: falling through to a free port would leave the registered client
talking to whichever window holds 37777, possibly on a different SAP system. Port `0` keeps the
old temporary behaviour for whoever wants it.

**A stored address also needs somebody listening.** An external client cannot trigger a VS Code
MCP provider, and until now the server started only when Copilot or the command asked for it. The
extension activates at `onStartupFinished` and starts the server itself whenever the port is fixed.

**Codex came in through the same command.** It asks which assistant the address is for: Claude
Code gets the `claude mcp add` line, Codex a `[mcp_servers.vertex]` section for
`~/.codex/config.toml`. Both carry the token, which is why the README keeps them out of version
control.

**Then a server with no editor at all.** `mcp/server.js` is the same two tools behind stdio:
Claude Code or Codex starts it as a child process, and VS Code may be closed. It does not
re-implement them — it imports `dispatch` from `vscode/mcp.js`, so a model reads the same texts
whichever way it connects. What it cannot borrow is the connection, so `mcp/sap.js` reads SAP on
its own, and its rules are about the password it now holds:

- credentials come from `VERTEX_SAP_*` environment variables — never from VS Code's
  SecretStorage, never written to disk;
- only `/sap/bc/adt/zsde/review/` may be requested;
- redirects are not followed, because Basic credentials would travel wherever `Location` points;
- every request has a wall-clock deadline and a 16 MiB ceiling on the answer;
- stdout belongs to MCP alone, and errors on stderr never carry the password.

`mcp/configure-local.py` writes both assistants' configuration from the active VERTEX system with
the password left empty, refuses to overwrite an existing `vertex` entry, and backs both files up
first.

**Two Claudes, two configuration files.** Claude Code used the tools; the chat in Claude
Desktop, asked the same thing, answered that no VERTEX server was connected. They are different
clients. `claude mcp add` writes `~/.claude.json`; the chat reads `claude_desktop_config.json`,
where a local server is a command to start. The standalone server is what fits there, with its
SAP connection in the entry's `env` — the app is not started from a terminal, so nothing set in
one reaches it.

### What went wrong: a label in the name field

In a scope — a transport or a package — the Versions window treated every row as an object to
open, and filled the name field from `unit`, the row's display label. A transport's rows are
mostly parts: `REPS ZEXAMPLE_REPORT`, or a method keyed by its class name padded to
thirty characters. Neither is an object, and a label is not a key. Now only `CLAS`, `INTF` and
`FUGR` expand, by technical name; every other row asks for its versions inside the scope, with
the version directory's key passed exactly as it came, blanks included — Stage 10 is why that
last part matters. The test that pins it down uses the very row from the DEVK900578 screenshot.

**The first tests kept in the repository.** Seven of them, run with
`node --test mcp/test/*.test.js vscode/test/*.test.js`, need neither SAP nor an editor: the
standalone process over real stdio against a fake SAP endpoint; a bad configuration failing on
stderr without the password; SAP errors, a redirect and a deadline; the command without Copilot's
API; the HTTP server keeping its port and token across a restart and refusing a second one on the
same port; and the two Versions cases. `test/**` and `*.vsix` stay out of the package.

---

## Stage 27 — a sentence instead of the clicks

**SelecTor got a chat.** "Open SFLIGHT for carrier AA, join SCARR" instead of typing the name,
pressing the magnifier on a column, filling in the panel and picking a chip. The first proposal
was a model of VERTEX's own — Copilot's through `vscode.lm`, or an API key — and it answered the
wrong question. VERTEX already knew which AI it talks to: the quick pick of the MCP command,
Claude Code or Codex. The chat offers the same two, and the model the chosen one offers.

**The assistant configures; SelecTor runs.** What comes back is not an answer about data but
the whole state of the page — table, filters, join, SELECT list, pivot — in a JSON schema both
command lines enforce (`--json-schema`, `--output-schema`). The page applies it through the same
variables and the same `load` and `loadJoin` the clicks use, so every chip it set can be moved
by hand afterwards. The model sees metadata only. Its one tool, `sap_table_layout`, reads the
join resource without a row count, which answers with the fields, their texts and keys, the
tables the dictionary offers and the aggregations the pivot allows, and reads no row. The plan
is checked against that same answer before the page is given it: a field the table does not
have is an error in the chat, not a filter quietly missing from the panel.

**Shut in on purpose.** A run starts in an empty temporary folder. Claude Code gets
`-p --tools "" --strict-mcp-config` and one allowed tool; Codex gets
`exec --ignore-user-config -s read-only` with the shell, unified exec, plugins and apps switched
off. The person's own MCP servers are not loaded, and among them are ones that write to SAP and
ones with free SQL. The tool lives at `/selector` on the same local server, so what Copilot,
Claude Code and Codex see at `/mcp` does not change. The token reaches the child through its
environment; the files in the folder name the variable, not the value.

### What went wrong

- **Which Codex.** The `codex` on the path was an npm install of 0.135, and the model the
  person's configuration names, `gpt-5.6-luna`, was refused as needing a newer one. The copy
  inside the Codex extension was 0.154 and ran it. VERTEX now starts the executables that come
  with the two extensions: the same version and the same login the person uses in the editor.
- **A catalogue is not an entitlement.** Codex lists `gpt-5.4-mini`, and so does its app
  server, but a ChatGPT login is refused it, and nothing in either list says so. The list stays
  Codex's own; a refusal reaches the chat in the provider's words.
- **A key where a name belongs.** Asked for a pivot over 2026, the model wrote the date filter
  as `t0~fldate`, the key form the pivot uses. The check refused the plan, which is what it is
  there for. The fix went into the rules and into the tool's own text, which now say that a
  filter names its field plainly; the model's answer is not corrected behind its back.
- **Eclipse** has no assistant yet. The panel is there and says so.

Twenty-one tests more, none of them needing SAP, an editor or a model: the plan check against
the dictionary, the endpoint beside the review, both command lines as they are started and as
they fail, the model lists, and the page applying a plan. Then two runs of the real Claude Code
against a stubbed system — the request as it was typed, in 12 seconds, and the pivot, in 9.

**Lesson.** Before proposing a way in, look for the one the project already has. The choice of
assistant was sitting in `extension.js`, and each of the three options offered instead of it
would have been a detour around it.

---

## Stage 28 — the same chat in Versions

**Versions got the assistant SelecTor has**, on the same runner, the same local server and the
same check-before-apply. "The last change of BUILD_LAYOUT in ZCL_AVE_POPUP", "the review of
DEVK900123, the BUILD_LAYOUT part" — and the window goes there. The host side became general on
the way: each window with an assistant names its rules, tools, plan shape and check, and the
address its tools are served at, `/selector` or `/versions`, beside `/mcp`.

**Lists, never source.** The tools are `sap_object_parts`, `sap_part_versions`, and the review
server's own `sap_transport_changes`, reused rather than restated. The diff tool is not among
them: a line of source is to the Versions window what a row is to SelecTor. The plan is a
destination — type, name, view, the part, the version, the object of a review — and the check
holds it against the parts list, the versions list and the saved review before the window is
sent anywhere.

**A destination is reached in steps.** The window cannot open a version whose part it has not
listed, so a plan is walked the way a person clicks: the parts, then the part, then the version;
or the request, its review, then the object in it. Each step waits for the answer of the one
before it. An answer about something else means the person went elsewhere meanwhile, and the
rest of the plan is dropped rather than sprung on them later; an error from SAP stops it with a
line in the chat. The diff it opens is the one a click opens — a version against the one below
it — so the assistant reaches nothing a person could not.

**The key made of blanks, once more.** A method's key is its class name padded to thirty
characters, and a model copying it could have collapsed the blanks as `CONDENSE` once did. The
tool prints every key as a JSON string, and the check compares keys blank for blank. In the real
runs the model copied them exactly; were it not to, the plan is refused with the reason.

### What went wrong

- **The disk filled up in the middle of an edit.** Three writes to `versions.html` failed with
  `ENOSPC`. The file was checked against the repository before anything else — untouched, since
  the failed writes had written nothing — and the edits were made again once space came back.
  The space was not taken by this work.
- **The session's scratch folder vanished**, cleaned up by another Claude Code process starting
  in the same project. With it went the probe scripts and Stage 25's eighteen checks, which had
  only ever lived there. The tests that matter were already in `vscode/test`.
- **The tests left folders behind.** The runner's tests made temporary extensions and never
  removed them, sixty-five after a few runs. They now clean up after themselves.

Fourteen tests more — the tools and the check against a stubbed system, and the page walking a
plan step by step, dropping it, and stopping on an error — and two runs of the real Claude Code:
the last change of a method in 13 seconds, the object of a review in 12.

---

## Stage 29 — a reviewer that could not read

**Tried on E19 the same day, the Versions assistant answered "describe the method GET" with an
apology.** It could open the object; it could not read it. Stage 28 had carried SelecTor's rule
across by analogy — never a row, so never a line of source — and the analogy was wrong. A table
row is business data. A diff is what a review is made of, and the review server had been handing
diffs to models since Stage 25.

**The assistant now reads what the window shows.** `sap_version_diff` gives the change a version
made, against the version listed below it or against one named, and with `full` the whole source
with the changes marked — AVE's own choice between "AI prompt diff" and "AI prompt full".
`sap_transport_diff` is the review server's, with the blocks, the verdicts and the comments. Both
render through the one `diffText`, which learned a full mode for it, and a whole source too long
to read well is cut with a line saying where. A request to describe or review gets its answer in
the reply, as long as it needs to be; a request to see something still moves the window.

### What went wrong

- **The label named the wrong model.** Asked with sonnet, the chat signed its answers with haiku.
  The label was the first key of Claude Code's `modelUsage`, a report keyed by model that
  promises no order. It now names every model the report lists, the one that wrote most first. A
  plain sonnet run reports sonnet alone, so what put haiku first was not reproduced; the label no
  longer depends on it.
- **One answer was the word "test".** Of two runs of the same request against a stubbed system,
  the first came back with that as its reply — the text of a declined block's comment — and the
  second with a full description of the method. The plan check can tell a wrong key from a right
  one; it cannot tell a poor answer from a good one, and does not pretend to.

Both assistants go out in the extension as 0.5.0, listed under AI and Chat as well.

---

## Stage 30 — finding a request by whose it is

**It started as a review of somebody else's tool.** abap-adt-cli pulls a package onto disk and
pushes it back over ADT, and reading it for ideas turned up two things about VERTEX. One was a
claim to check: that ADT drops a trailing newline when it stores a source, which would make the
check Save & Activate runs after a write fail on a write that had succeeded. The other was a
question from the user: could the Versions window find transports by user, your own by default?

**The claim did not hold, and nothing was changed for it.** `CL_ADT_REST_PLAIN_TEXT_HANDLER` on
QAS splits the body of a PUT into lines after appending one more line break, and SAP's comment
says why: otherwise an empty line at the end of the source would be lost. Reading joins the lines
with CRLF and adds none after the last. Text ending in a newline is stored with an empty last line
and comes back ending in CRLF — the same text once line endings are normalised, which is all the
check compares. Half of the claim is true: a source without an empty last line comes back without
a newline.

**The window now finds requests.** With Transport request chosen, the bar has a user field, a
*released* switch and Find. The list is open requests by default; the switch adds released ones
and those whose release has started. A request whose only link to the user is a task under
somebody else's request is theirs too, the way SE09 lists it, and the status that counts is the
request's own — a task is often released long before its request. A row opens the request exactly
as its typed number would. The field left empty means whoever is logged on, and that is decided in
ABAP: the server knows who is asking, and the page does not know and should not.

The resource is `/sap/bc/adt/zsde/requests` in the Simple Data Explorer hub — the first route with
no name in it, since both of its parameters are optional. The header of each request comes from
`ZCL_AVE_REQUEST=>GET_HEADER` and the full name from `ZCL_AVE_AUTHOR`, so a request reads the same
in this list as in the rest of the window. Eclipse gained one `BrowserFunction`, VS Code one path
builder and one line of the shim, and the page one answer shape, told apart by what it carries.

### What went wrong

- **The function that was proposed is not the one used.** The plan put to the user named
  `TRINT_SELECT_REQUESTS`, SE09's own selection. What it does with a task under somebody else's
  request lives in its form routines, and those were never read: the connection to QAS dropped
  TLS handshakes intermittently that day, so single reads got through while every write — several
  requests in a row — failed, and then the servers disconnected altogether, with E19 not answering
  at all. Two selects on `E070` state the agreed rule outright, the table AVE itself reads for
  requests and tasks. The switch was reported, not slipped in.
- **The page's test harness had no styles.** `loadParts` now shows or hides the finder, and the
  stub elements the tests build had no `style`, so the existing test that goes back to a
  transport would have thrown. The stub learned it.

Not yet run against a system. The ABAP passed abaplint against stubs of the SAP classes it calls —
proved to be checking by errors planted in a copy, which it found — the plugin compiled with javac
26 at release 21 against the bundle pool, and the page was driven in a browser against a stub
host. 105 tests pass, five of them new.

The finder worked on QAS as soon as the commit was pulled — the route with no name in it included.

**Lesson.** A standard function counts as reuse only once its behaviour on the case that matters
has been read. Before that it is a guess carrying SAP's name.

---

## Stage 31 — asking the system what it has

**The finder's first click on QAS opened the setup page**, "The ABAP half is not on this system",
over a system where every other window was working. Nothing was wrong with the page: the commit
with the new resource had not been pulled yet, so the router answered 404, and a 404 was all the
page had ever been told about. It could not tell a hub that is not there from a hub one resource
older than the window. The user asked for exactly that difference — and then for more: ask every
service when the window opens, and do not draw a button that cannot work.

**One question instead of one per service.** Pinging each resource would have meant a stub in
seven classes and, in each window, pings sent one after another, because the host's answer
channel cannot say which question an error belongs to. `ZCL_SDE_ADT_RES_ABOUT` answers for the
whole hub at once: every service, whether its handler class has an active version, and whether AVE
and ACE are installed. The list it reads is the router's own — `fill_router` now loops over
`ZCL_SDE_ADT_RES_ABOUT=>SERVICES` — so what a window is told and what is served are the same rows.
Whether a class is active is read from `PROGDIR` rather than by loading it: a resource class whose
tool had since been removed would otherwise stop the answer with a syntax error.

**What a window does with it.** Each window asks before anything else and waits for the answer
before reading the object it was opened on. What is missing is not drawn — Versions' finder and
Review card, SelecTor's Join, Metrics' flow and scheme — and a red line under the bar names it and
the reason: the hub is older than the window, the class is not active, the tool it reads through is
not installed. A window whose own main service is missing opens on that list. A system that cannot
say — no hub, or one older than `/zsde/about` — changes nothing, and its setup page says that a
hub that old cannot tell what it has. A 404 on a system that has everything is shown as the
resource's own answer rather than as setup: SelecTor asked for a table that does not exist used to
open the setup page too. The answer also names who is logged on, and the finder's user field
starts from it; what somebody has typed there is never replaced.

**The parts of an object became a table** in the same round, at the user's request: type, then
name, headed by the object. The class pool is gone from it, and from the resource rather than the
page: it is generated, nothing a developer wrote is in its versions, and `WORTH_SHOWING` is the one
place that decides which parts are worth a row — the assistant's tools read the same list.

**Then a class was split the way SE80 splits it:** each section, then the methods declared in it,
each marked the way SE80 marks visibility — a green square, a yellow diamond, a red circle — and
last, under Other, the local includes. The section of a method comes from the resource: the class
builder's own `SEOCOMPODF` and `SEOREDEF`, and public for a method implementing an interface.
ACE was the other candidate, since it knows the section by the include a method is declared in.
The answer is the same, but it would have cost a parse of the whole class on every open and made
Versions need ACE installed; the user chose the tables.

### What went wrong

- **The first answer was too narrow.** A sentence for the finder's own 404 was offered first; what
  was wanted was a way to tell every missing piece apart, in every window.
- **Still no way into QAS.** The ARC-1 servers had dropped out of the session, `abap-adt` points at
  the local trial and `fr_abap` at E19, which did not answer. The ABAP was checked with abaplint
  against stubs — the router and the new class both, with planted errors found — and not on a
  system.
- **Metrics has no test harness.** Its startup check was driven once from a throwaway script on a
  stubbed document — the flow modes removed, the setup list for a missing ACE, nothing changed for
  a hub that cannot say — rather than from a test in the repository.

117 tests pass across the VS Code, Eclipse bridge and MCP suites, nine of them new; the plugin
compiles with javac 26 at release 21.

---

## Stage 32 — the ABAP moves in, starting with ACE

**The ABAP half lived in three repositories that are not this one.** Simple Data Explorer held the
ADT hub and the resources; ACE and AVE held the analysis each of those resources reads through.
A window therefore needed four clones to work, and the tools it borrows from are the user's own
projects, which move for reasons of their own. The user asked for the ABAP to live here, renamed
`ZCL_VX_*`, and — after seeing what the dependencies actually were — for ACE to be rewritten so
that a portable core could be lifted out rather than the whole tool copied.

**Tracing what "necessary" meant was the first surprise.** Walking the references from the nine
`ZCL_SDE_ADT_RES_*` classes reaches 110 objects — every class and interface in all three
repositories, with nothing left over. Not because a resource calls all of them, but because
`ZCL_SDE_TOOLS` inherits from `ZCL_SDE_POPUP` and is instantiated with `NEW`, `ZCL_SDE_SEL_OPT`
holds a `TYPE REF TO ZCL_SDE_TABLE_VIEWER`, `ZCL_AVE_ACR_STATE` reaches `ZCL_AVE_POPUP`, and
`ZCL_ACE` is the GUI controller the flow walk keeps its state on. In ABAP a reference is a hard
dependency whether or not the branch ever runs, so the whole SAP GUI of all three tools came with
the ADT half. That is what turned a copy into a refactor.

**ACE first, and the seam was narrower than it looked.** Four things tied the analysis to the
window, and only one of them was real. The seven `ZCL_ACE_PARSE_*` classes named `ZCL_ACE=>TS_CALLS`
and its kin, but those were already aliases of `ZIF_ACE_PARSE_DATA` — 21 references, a substitution.
`ZCL_ACE_CODE_HTML` appeared to need `ZCL_ACE_WINDOW`; the reference was in a comment.
`BUILD_STEPS_FLOW` was locked inside `ZCL_ACE_MERMAID`, which inherits from `ZCL_ACE_POPUP`, yet the
method itself touches no instance at all — its own doc comment already said it answers "where there
is no SAP GUI at all". Only `ZCL_ACE_SOURCE_PARSER` was genuinely entangled, and it reads exactly
six fields off the controller: `MS_SOURCES`, `M_ZCODE`, `M_HIST_DEPTH`, `MT_CALLS`, `MT_STEPS`,
`M_STEP`.

**`ZIF_ACE_WALK`, because of the aliases.** Those six became an interface. The obvious alternative —
a context class owning them — needed about 220 edits across six GUI classes, since `MS_SOURCES`
alone is read 178 times through `MO_WINDOW->`. Instead `ZCL_ACE_WINDOW` implements the interface and
aliases each name back into itself, so every one of those references still compiles unchanged;
`MT_STEPS` and `M_STEP` moved there from `ZCL_ACE`, which cost 33 mechanical edits. `ZCL_ACE_WALK`
implements the same interface and holds nothing else, for a caller with no GUI. The drawing went to
`ZCL_ACE_FLOW`. ACE ends 250 lines heavier and 619 lighter across twelve files, and its windows
behave as before.

The core is 21 objects and reaches no GUI class: the parse, the statement grammar, the metrics, the
code-to-HTML scheme, the walk and the flow picture. Those are now `ZCL_VX_ACE_*` here, together with
the ten hub objects — `ZCL_VX_ADT_RES_*`, `ZCL_VX_ACE_SOURCE` and the BAdI registration
`ZVX_ADT_RES_APP`. The flow resource no longer builds a headless viewer; it creates a
`ZCL_VX_ACE_WALK`, and calls the parser and the scanner in the order `PARSE_PROGRAM` used to call
them. What still points outside is `ZCL_SDE_SQL`, `ZCL_SDE_TOOLS`, `ZCL_SDE_PIVOT`, `ZCL_SDE_SEL_OPT`
and the AVE classes — the next two stages.

### What went wrong

- **The linter said nothing, twice.** The rule is `check_syntax`; `syntax_check` is not a rule name
  and abaplint accepts the file in silence, reporting a contented "0 issues found" over any amount
  of broken code. Without SAP's standard objects it also skips the check it does run. Both were
  caught the same way — by planting an error abaplint had to find, and noticing it did not. The
  check that finally meant something ran with `https://github.com/abaplint/deps` mounted, and was
  read as a diff against the same run on the pre-refactor tree: 61 findings before, the same 61
  after, none of them ours.
- **The only-Z filter would have gone quiet.** `M_ZCODE` was set in the window's constructor, not
  declared with its value. A bare `ZCL_ACE_WALK` starts at zero, and zero means "descend into SAP's
  own code" — so the flow window would have quietly grown the whole standard call tree, with no
  error to notice. The default now sits on the field where it belongs. This is the one that would
  have shipped.
- **Still not run on a system.** `ZIF_ACE_WALK` does not exist on QAS, so a syntax check there would
  only report it missing; nothing was deployed, because deploying was not asked for. Everything
  above is checked against stubs, and the walk has not executed once.
- **The BAdI filter is still `/sap/bc/adt/zsde/*`.** The registration moved and was renamed, but the
  URI it claims did not change, since changing it means changing every client. Two implementations
  claiming one prefix cannot both be active, so a system with both SDE and VERTEX installed has a
  collision waiting. Named, not resolved.

**Lesson.** A tool with no test harness is verified by making the verifier fail first. Two of the
three checks in this stage were worthless and said so in the same words as a passing one.

---

## Stage 33 — the 500 came from the hub that was being replaced

**The pull landed and four windows answered 500.** All 32 objects were written to QAS between
14:51:09 and 14:51:42 and activated; a minute later `flow`, `table`, `join` and `versions` failed
while `metrics` answered. The shape of that split invited a theory — metrics keeps its whole chain
inside VERTEX and short, the other four reach `ZCL_SDE_*`, `ZCL_AVE_*` or the four core classes —
and the theory was wrong in a way no amount of reading the new code could have shown.

**It was not a half-activated pool.** `INACTIVE_OBJECTS` came back empty, and every one of the nine
`ZCL_VX_ADT_RES_*` class pools, every `ZCL_VX_ACE_*` and all three `ZIF_VX_ACE_*` stand at
`PROGDIR-STATE = 'A'`. So the failure was at runtime, and ST22 had six dumps between 14:52:19 and
14:54:47, every one of them `SYNTAX_ERROR` raised inside `CL_REST_ROUTER` at its
`CREATE OBJECT lo_object TYPE (ls_match_info-handler_class)`. The router could not load a handler.
`SYNTAX_ERROR` is a short dump, not an exception, so the `CATCH cx_sy_create_object_error` two lines
below never sees it and the request ends as a bare 500 with nothing in the body.

**The dump named the program, and it was the old one.**
`ZCL_SDE_ADT_RES_FLOW==========CP` — `Method "BUILD_STEPS_FLOW" does not exist. There is, however, a
method with the similar name "STEPS_FLOW".` Exactly one path reaches that class: the BAdI filter
`/sap/bc/adt/zsde/*`. The request was never addressed to `/vertex/*` at all. **The moved core was
never called once.** The half that had been checked so carefully was not in the failing path, and
the half that was failing had been left behind on purpose.

Why metrics worked follows without the theory: `/zsde/metrics` reaches `ZCL_SDE_ADT_RES_METRICS`,
which calls `ZCL_ACE_METRICS`, where the names still agree. `/zsde/flow` reaches a resource that
Stage 32 had rewritten to the new call names while it still pointed at the old classes —
`BUILD_STEPS_FLOW` is the `ZCL_VX_ACE_FLOW` name; `ZCL_ACE_MERMAID` has `STEPS_FLOW`. The old hub
was half-renamed and nobody ran it afterwards. The Eclipse plugin actually installed is older than
the rename; the repository itself has no `/zsde/` address left in it, which is precisely why looking
in the repository said nothing.

**The collision Stage 32 left open is not there.** `BADI_STRING_COND` has the two implementations on
distinct `STATIC_URI_PATH` filters — `/sap/bc/adt/zsde/*` to `ZCL_SDE_ADT_RES_APP` and
`/sap/bc/adt/vertex/*` to `ZCL_VX_ADT_RES_APP` — both active, no overlap, and no ICF node for
either. Stage 32's last bullet is stale.

**Removing the old hub, and what the cross-references said first.** Nothing outside the nine
`ZCL_SDE_ADT_RES_*` classes refers to them; `ZCL_SDE_ACE_SOURCE` has no consumers at all; and the
only includes anywhere on QAS referring to `ZCL_ACE_*` or `ZIF_ACE_*` from outside `Z_ACE` are those
same three. So the hub goes and `Z_ACE` closes on itself, leaving only its own SAP GUI. Deleted into
`ALCK900465`: `FLOW`, `JOIN`, `METRICS`, and `REQUESTS` — that last by hand, after ADT refused the
delete twice with a 404 while the object was still there. Still standing: `REVIEW`, `TABLE`,
`VERSIONS`, `APP`, `ABOUT` and the registration `ZSDE_ADT_RES_APP`, which ADT will not delete through
this interface at all. All ten also live in Simple Data Explorer, so deleting them only on the system
is half the job — the next pull of that repository brings them back.

### What went wrong

- **The wrong half was verified, carefully.** Signatures compared against `git show`, all 32 objects
  checked for both of their files, no `ZCL_ACE_*` literal left anywhere in `src/`, abaplint at the
  same eight findings as the SDE hub it came from. Every one of those held. None of them touched the
  code that was failing, because nobody had checked which address the client was calling.
- **"Nothing calls `/zsde/*`" was asserted, not measured — and a deletion was built on it.** The
  reasoning was that the repository has no old addresses left, which says nothing about the plugin
  installed in Eclipse. `ZCL_SDE_ADT_RES_METRICS` was deleted on that basis and it was the class
  serving the one window that still worked. Recoverable from Simple Data Explorer, but broken by a
  step whose stated reason was false.
- **`is_active` cannot see this failure.** `ZCL_VX_ADT_RES_ABOUT=>is_active` reads `PROGDIR` for
  `STATE = 'A'`, and its comment promises it reports a class "whose tool is not installed". A class
  whose load will not build is active by that test, so `about` reports `true` for a route that dumps.
  The check answers a narrower question than the page asks it.
- **The diagnosis ran without its own tools.** `SAPDiagnose` was unusable for the whole session: the
  client materialises the schema default `includeSubpackages: false` and the server rejects that
  field for every action but `unittest` with `type=DEVC`, so `dumps`, `syntax`, `object_state` and
  `atc` all failed before reaching SAP. The dump headers came out of `SNAP` instead — `FC`, `AP`,
  `AI` and `AL` in `FLIST` give the error id, program, include and line, which was enough to reach
  `CL_REST_ROUTER`. The body is a compressed blob, so the "Error analysis" text that named the class
  had to be read off a screenshot.

**Lesson.** Before proving the code is right, prove the request reaches it. Four careful checks
against the new hub could not have failed, because nothing was asking the new hub anything.

**How it ended.** The VS Code extension was rebuilt from the current sources - `vertex-abap-0.5.6.vsix`,
all eight of its ADT addresses `/sap/bc/adt/vertex/*`, none left on `/zsde/` - installed, and the
join window opened against QAS. It answered, and ST22 gained nothing: the seven dumps of the day
stayed seven. That is the moved hub's first execution, and it also settles a second question for
free - `ZCL_SDE_TOOLS` really does run without a window, not just appear to in the source. The
Eclipse plugin still has to be exported the same way; until it is, it remains on the addresses being
removed.

---

## Stage 34 — SDE moves in: the join builder without its window

**The seam was three classes.** The hub calls `ZCL_SDE_SQL` for three statics, `ZCL_SDE_PIVOT` for two
statics and two types, and `ZCL_SDE_TOOLS`, which `ZCL_VX_ADT_RES_JOIN` instantiates and then drives
through eleven methods. Copied as they stand, those three reach **18 of the 28 SDE objects, 8080
lines** — the whole tool with its SAP GUI, which is the same answer ACE gave in Stage 32 and for the
same reason: in ABAP a `TYPE REF TO` is a hard dependency whether the branch runs or not.

**It widens in four places, and none of them is behaviour.** An optional constructor parameter
`io_viewer` and the field behind it carry `ZCL_SDE_TABLE_VIEWER` — 2787 lines, counting `rtti`,
`plugins`, `dragdrop`, `dd_data`, `transmitter`, `text_viewer` and `py_cluster_viewer` behind it. One
declaration, `on_viewer_sel FOR EVENT selection_done OF ZCL_SDE_SEL_OPT`, carries 739 more.
`INHERITING FROM ZCL_SDE_POPUP` carries 57, and that base is nothing but four `cl_gui_*` fields.
`ZCL_SDE_APPL` is read seventeen times — five of them for `GV_ROWS` — and brings `ZCL_SDE_RECEIVER`
with it.

**The behaviour was already there.** Of the twelve methods the hub calls, exactly one touches the
window: the constructor. Below the facade every access sits behind `CHECK MO_VIEWER IS BOUND` or
`CHECK VIEWER_ALIVE( )`, including the pivot's `rebind`, whose comment says *"No window: the caller
has the matrix in ER_RESULT"*. Stage 13 did that work when it replayed the builder over a stateless
protocol. Nothing had to be made headless; the types had to stop pointing at a window.

**So the cut is fourteen line ranges, not a rewrite.** `ZCL_VX_TOOLS` is 3049 lines against the
original's 3270. The constructor keeps only its headless branch; `OPEN_LAYOUT_FOR` — which opens a
second SAP GUI window — says which table the file belongs to and stops, rather than loading a layout
against the wrong base; `VIEWER_ALIVE` answers `abap_false`; `FILL_SEL_EXTRAS`, `CACHE_WHERE_SELECTION`
and `SYNC_SEL_PANEL` keep their names and empty out, so a subclass with a window overrides them; and
the two `rebind` tails become one hook, `ON_RESULT`. Everything else — `cl_gui_html_viewer`,
`cl_salv_*`, `cl_gui_frontend_services` — is SAP's own and moved untouched.

`ZCL_VX_APPL` is the one object not copied but rewritten: 160 lines down to 63. Out go the icon table,
the report controls, and `MT_OBJ`, the registry of live windows. Out too go `TRANSMITTER` and
`RECEIVER` from `SELECTION_DISPLAY_S` — not for tidiness, but because `ZCL_SDE_RECEIVER` holds a
reference to `ZCL_SDE_TABLE_VIEWER` and one to `ZCL_SDE_SEL_OPT`, so two fields that are always
initial without a window would have pulled the entire GUI back in behind a type nobody reads.

Seven objects, and the hub now points at them: `ZCL_VX_SQL`, `ZCL_VX_DDIC`, `ZCL_VX_COMMON`,
`ZIF_VX_PIVOT_TYPES`, `ZCL_VX_PIVOT`, `ZCL_VX_APPL`, `ZCL_VX_TOOLS`. One `ZCL_SDE_` name is left in
`src/`, in a comment, and it points at `ZCL_SDE_PLUGINS`, which stays where it is.

### What went wrong

- **The recommended approach was wrong, and reading further is what showed it.** The plan was to
  mirror Stage 32: two interfaces, `ZIF_VX_VIEW` and `ZIF_VX_SEL`, aliased back into the SDE viewer so
  one implementation serves both. That works when the seam is fields on a window, as it was for ACE.
  Here `MT_SEL_TAB`'s row type carries `TYPE REF TO ZCL_SDE_TRANSMITTER` and `ZCL_SDE_RECEIVER`, and
  the receiver points straight back at the viewer and the selection panel — so an aliased interface
  re-drags exactly what it was drawn to cut. The hook-and-subclass shape replaced it.
- **abaplint said nothing, a third time.** `check_syntax` alone does not report an unparseable
  statement. Garbage appended to a moved class left the count at 44 and named nothing; the rule that
  catches it is `parser_error`, and with it on the same plant went 81 to 82, named and located. The
  baseline was then recorded per file so the move could be read as a diff: 81 before, 81 after the
  seven objects landed, 59 once the hub was repointed — the drop being the `ZCL_SDE_` classes the
  resources could not resolve. The lesson from Stage 32 held and was not enough: a verifier has to be
  made to fail on the *kind* of error being made, not on any error at all.
- **Two sections named the same thing.** The class already had a lowercase `protected section.`, and a
  second `PROTECTED SECTION` was inserted for the hook. Activation would have refused it; abaplint
  reported `Expected ENDCLASS` against line 1, which is a true statement about the file and says
  nothing about where the fault is.
- **The shell ate the quotes, three times.** Regexes and ABAP literals written through a heredoc lost
  their backslashes and apostrophes, once silently enough that `TYPE 'S' DISPLAY LIKE 'E'` reached the
  file as `TYPE S DISPLAY LIKE E`. The linter caught that one. Text with literals in it goes through
  a file, not a command line.

**Lesson.** The seam is measured, not read. Four references, a script over the reference graph, and
the size of what each one drags — that is what turned "the whole tool comes with it" into fourteen
edits.

**Not done here.** SDE's own `ZCL_SDE_TOOLS` still holds a full copy of the logic, as do `ZCL_SDE_SQL`,
`ZCL_SDE_PIVOT` and `ZCL_SDE_COMMON`. That was first written up here as a drift risk to be closed by
making the SDE class a subclass of the moved one, which was wrong: a ported project is frozen, so the
old copy is not going to change and cannot drift. What is open is not a refactor but a decision —
whether one core can be kept replicated between the two at a price worth paying, and if not, the SDE
side simply ends. Everything is moving to Eclipse and VS Code, so its SAP GUI has nothing to protect.
The AVE classes are the stage after: `review` and `versions` account for 46 of the 59 findings that
remain.

## Stage 35 — choosing the model, and which system a window means

The request was small — the model list showed `haiku`, `sonnet`, `opus` with no versions — and it
opened three questions in turn: what the list is, where it is chosen, and which system a window
speaks for.

The list for a Claude subscription had been a set of aliases on purpose: Claude Code reports no
catalog, and an alias always means the newest of its family, so the list could not go stale. That
reasoning held and was still the wrong answer, because pinning an older version — Opus 5 instead of
5.5 — is exactly what an alias cannot do. The list became VERTEX's own table of full ids, updated by
hand when a model comes out, with the newest of each family on by default. The Anthropic API needed
no such table: `GET /v1/models` answers for the key, the same call ABAP-AI-Code already made. Every
provider then got one **LLM Providers** table, storing what is switched off for the providers that
list their own models, so that a model they add later appears on its own.

The same work renamed the providers. "Codex subscription" named the client, not what is paid for:
the subscription is ChatGPT's, and a subscription has no public API, so it works only through the
vendor's own client. That is now what the labels and the README say.

A VERTEX Tools window then turned out to be named by nothing and bound to nothing: every window read
from `vertex.active`, so two windows on two systems were impossible and a tab could not say which
system it showed. A window now keeps the system it was opened on. Rather than threading a system
through every fetch, the window's messages run inside an `AsyncLocalStorage` scope and `active()`
answers from it. The scope does not cross a process boundary, so the address handed to Claude Code
or Codex carries `?system=`, and the MCP server re-enters the scope for those calls. The panel's
chat went the other way: its SAP tools take `system`, so one conversation can read in one system and
draft in another, and the draft still goes through the reviewer, whose title names the target.

### What went wrong

- **Silent fallbacks, twice.** The first Anthropic model list came from the API with no fallback,
  as intended; the first Claude list kept the aliases *and* added versions, which only made the
  list longer. Both lists ended as one table, and a table with nothing ticked is refused on Save
  rather than quietly emptied into a default.
- **A hover that removed the button.** `button.secondaryHoverBackground` is not defined by every
  theme; where it is missing, the hover rule set an empty background and the button vanished under
  the pointer. The hover now keeps the button's background and adds the theme's focus border.
- **The connection key reached the chat.** A search in VS Code names its system by the repository
  key — url, client, user, name — and the direct-open answer printed it whole. Only the name is
  shown now.
- **Five failing tests were not ours.** The versions tests fail on a clean checkout too — the fake
  DOM has no `classList`. Each change was compared against that baseline, not against zero.

The Versions window took AVE's layout back in the same landing: the list of versions moved from the
right-hand pane, where the diff used to replace it behind a *← Versions* link, into the parts column
under the parts, and the diff keeps the right. That made room for AVE's pinned base — compare any two
versions, not only a version with its predecessor. AVE's three switches followed on the ABAP side,
where the diff is computed: `ZCL_VX_ADT_RES_VERSIONS` takes `toc`, `dups` and `ic`, and each one was
already written — `ZCL_VX_VRSD`'s `no_toc`, `ZCL_VX_VERS_DATA=>REMOVE_DUPLICATE_VERSIONS`, and
`COMPUTE_DIFF`'s `i_ignore_case` — carried over from AVE and never reached from the resource. The
TOC switch applies to the list only: a diff reads both its versions whatever the list shows.

`SAPDiagnose` refused the syntax dry run on QAS for the reason already on record — the client adds
`includeSubpackages` to every call — so the check was abaplint against a baseline: the same fourteen
findings before and after, and a misspelt parameter planted in the new call reported on its line.

The calls flow of `Z_AVE` then disagreed with ACE's own window in SAP GUI: VERTEX drew three
classes called straight from the program and `/UI2/CL_JSON` under one of them, ACE one class and
four under it. Neither was wrong. ACE's `STEPS_FLOW` is called with `I_CALC_PATH` whenever "Show
All Steps" is off, which is its default, and keeps only the events its `GET_CODE_FLOW` marks as the
calculated path; the port had taken the drawing and left the path behind, so VERTEX always drew
every step. Of `GET_CODE_FLOW`'s nine stages the flow reads one thing - the event names of the
lines marked `ACTIVE_ROOT` - so that is what came over, as `PATH_EVENTS`, with ACE's reads left as
they were: a `READ TABLE ... INTO` that misses keeps the previous row, and only the first variable a
line computes counts. Changing either would draw a path ACE does not.

**Lesson.** A list that "cannot go stale" is only right while nobody needs an older entry. Ask what
the list is for before deciding how it is kept.

---

## Stage 36 — the builder and its rows in separate panes

The join and the pivot drew everything in one scrolling column: ten rows of the answer in a
200-pixel box, the builder under it. A wide join left the reader scrolling the page to reach either.
Now the rows are a short pane on top (at most a third of the height) and the settings fill the
larger pane below, each scrolling on its own; Full view removes the settings pane, and the rows get the whole window.

In the same landing View source got Open in the Editor. VS Code reuses `open_sap_object`; Eclipse
navigates through ADT, and a function module's URI is found by quick search because it goes
through the function group, which the page never knows. The button calls the host directly rather
than through `queue()`: that path answers into the page's pending result, which the source page
is not waiting for. Both hosts were bumped to 0.7.0.

LLM Providers became a tree in the same landing: the provider dropdown hid every table but one,
and choosing a provider there doubled as choosing the one in use on Save. Now all providers show at
once, and In use is its own switch. A provider's switch is `off: true` beside its model settings in
`vertex.ai.modelConfig`, so switching it off keeps the ticks. The provider in use cannot be switched
off, and a switched-off one cannot be put in use - the page refuses both, and so does the host.

## Stage 37 — the arrow is not part of the name

Double-click on `load` in `zcl_ave_version_list=>load(` did nothing. The double-click handler only
navigates when the selection equals the word under the cursor, and `wordAt` counted `<` and `>` as
name characters for field symbols - so the word was `>load` and never matched the selection
`load`. The same broke `lo_ref->method(`. Angle brackets now join the name only as a pair around
it, `<ls_row>`. The test host gained a mouse-selection event so double-click is covered.

The hover on `abap_bool` then showed only `ABAP_BOOL (PROG/PY)`: the declaration line was looked
for only in the tab's own source, and `abap_bool` lives in the type pool `ABAP`. When ADT's
navigation points at another URL, that object's active source is now read (`sourceAt`, once per
URL) and the declaration taken from it. Double-click and Go to open it: a class or a program as its
editable VERTEX tab, anything else - a type pool, an interface - as a read-only view, because
VERTEX edits only PROG, CLAS and FUNC. The line comes from the active source, so in an editable
tab with an unactivated change above it the cursor can land a few lines off.

A data element has no source, so for `versno` the hover still said only what it is. Its domain,
type and length now come from ADT's data element properties, read once per name. Double-click
stays on code: a data element is not opened.

The read-only view was a dead end: hover and navigation were bound to `vertex-sap` tabs, and the
view is a `vertex-source` snapshot, so the hover in it stayed on another extension's Loading. The
view now keeps its system and ADT source URL, and the providers and double-click take it as well.

`zif_ave_popup_types` still opened read-only: VERTEX edited only PROG, CLAS and FUNC. INTF
(`INTF/OI`) joined them - an interface is one source, like a program, so reading and saving needed
no change beyond the type. Creating one is refused in `create_sap_object` and left out of the
Create command; nobody asked for it.

On a declaration itself ADT's navigation answers HTTP 400 with an info message, "Definition
location found; where-used list may be possible", instead of a location; arc-1 shows it as
`I::000`, a message without a class or a number. The hover took it for a failure. That answer is
now read as "declared here" and the declaration taken from the line. It is recognised by its
text - there is nothing else to go by, and VERTEX logs on in English.

`NEW zcl_ave_popup(` went nowhere: ADT's navigation on the class name points at the class with
no line. Eclipse goes to the constructor, and so does VERTEX now - `NEW name(` is read as a call
of `CONSTRUCTOR`. A class without its own constructor opens at its start.

Outline was empty for a VERTEX tab: VS Code knows nothing inside ABAP until an extension tells it.
A document symbol provider now builds the tree from the tab's own statements (`abapStatements`),
without SAP, so it follows unsaved edits. A class shows its sections with the declared methods, but
each method's range is its implementation, where a click should land; a section's range therefore
covers its methods in the implementation part too. VS Code's ranges are immutable, so a plain tree is
built first and turned into symbols last.

Double-click on `CASE` went to the first `WHEN`: IF and CASE walked their branches, which is
useful but not what a jump from the opening wants. Asked for long ago: `IF` to `ENDIF`. Now the
double-click jumps from the opening to its end and back, and F12 (VERTEX: Go to) and Ctrl+click
keep the walk through the branches. The first cut sent VERTEX: Go to to the end as well and so
broke F12, which is bound to that command, not to the definition provider. VS Code's selection event carries
no modifier keys, so Ctrl on the double-click itself could not be told apart.


The VS Code extension went out as 0.7.2 with all of this; Eclipse was not rebuilt.

## Stage 38 — an assistant at the debugger

The question was whether an assistant could debug ABAP by itself. A probe outside the extension,
on the same `abap-adt-api` VERTEX uses, answered it step by step on QAS:

- A breakpoint set over ADT stopped nothing on its own. It needs a listener (`debuggerListen`).
- With a listener, a run from WebGUI stopped; one from the standalone SAP GUI never did - not for
  ABAP FS, not for the probe, not for Eclipse. SAP's documentation says it outright: ADT
  breakpoints are not considered in SAP Logon sessions. Terminal mode with SAP GUI's own
  TerminalID from the registry caught neither SAP GUI nor WebGUI. QAS has one application
  server, so it was never a server mismatch. Settled: runs start in WebGUI.
- Stepping line by line and recording what changed traced Z_CALC in 133 steps, first at about
  3 steps a second, then 5 once only the executed statement's variables were read. The trace
  showed the planted bug in two neighbouring steps: the customer changes, the total does not
  reset.
- A condition on the breakpoint is checked by SAP. `lv_customer_total > 1000` on line 45
  stopped exactly on orders 4 and 5: two stops, a dozen requests, under a second, against 451
  requests and 26 seconds for the full trace.
- The first conditional run lost its second stop. After a stop the program stays under the
  attached session, and the next stop is the answer to "continue", not a new listener hit;
  the probe had left the session. "continue" on the last stop throws when the program ends.
- An Eclipse debug session left open took the stops: one listener per user.

What landed is the pilot of that: `debugger.js` (no VS Code API, like `sap-code.js`) and a
second tool set in `mcp.js` at `/debug`, so the review at `/mcp` and what its registrations see
stay unchanged. Breakpoints are sent as the full set and a condition goes in a second round, as
ABAP FS and Eclipse do. Mode `log` records and continues inside the same session; mode `stop`
hands the stop to the assistant. A stop returns the stack, five source lines, the variables that
changed since the last stop and the first rows of a changed table; `debug_read` reads the rest.
Variables are never changed and the program is never jumped around - the user did not ask for
it. An open Eclipse or ABAP FS listener is reported, not taken over. The standalone stdio server
does not get the debugger yet: it has no VS Code to open WebGUI, and a listener has to outlive a
single call.

The first try of the pilot went to the wrong place: the question was asked in the VERTEX chat,
whose assistant had only the source tools, and it found the bug by reading the code - Z_CALC's
planted bug is visible in the text, which makes it a weak test for a debugger. Registering
`vertex-debug` for Claude Code then tripped twice: the command only copies the line, and a window
not reloaded after installing still offered the old two entries. So the chat got the debugger as
well: its `/chat` set now carries the `debug_*` tools beside the source tools (a wrapper whose
schemas and instructions stay getters - `Object.assign` read the source tools' instructions at
activation, before any system was known, and a test caught it). A chat answer that may use SAP
tools waits ten minutes instead of three, for a WebGUI logon and the program's way to its
breakpoints. Released as VS Code 0.7.3; Eclipse was not rebuilt.

Z_CALC proved the plumbing but not the point: its bug reads off the code. `Z_VX_DEBUGGER_TEST`
went into `src/` instead - one screen, four order lines, a total that comes out low, no error and
no line that looks wrong. What goes wrong is what a statement silently does not do, so reading
the code is slow and a stop in the right place is quick. The answer is deliberately not written
in the program or in the user-facing documentation.

Then a run meant for E19 opened WebGUI on QAS. The debugger connected once, on its first call, and
kept that connection for the life of the window; the user had switched systems since. It now asks
which system is active on every call and reconnects when that changed - unless breakpoints or a
stopped program still live on the old one, which would be left behind there: that is refused with
a pointer to `debug_stop`. A test for it caught a second slip - `setBreakpoint` added the line to
its list before checking the system, so even after `debug_stop` the switch was refused.

"Fix it" in the chat opened four windows: the draft, its review, the SAP source tab and a Tools
window on the version diff. The last two were the navigation instructions at work - an editing
request was told to open an editable tab, and the model added a diff view on top. Both showed the
old source, the one with the bug, next to the fix. The first guess here removed the draft's diff
editor instead, which was not what the user meant, and was undone. The instructions now say a fix
goes through `modify_sap_object` alone, with no tab and no navigation.

That still left the draft itself, and the user put the finger on it: the review belongs to saving,
not to the change. A draft was a second, untitled document with no VERTEX menu, whose close asked
to save it to a local file, while the real tab went on showing the source with the bug. Now a
change to an existing object is written into that object's tab through a WorkspaceEdit - unsaved,
undoable - and the repository's draft is discarded at once. Saving is the user's: the tab's Save &
Activate or Review & Activate, the same as for edits of their own. The one guard: a tab with edits
SAP does not have is not overwritten - the change is refused with a sentence saying why, since it
was written against the SAP source and would silently undo the user's work. Creation keeps the
draft, having no tab to write into.

On E19 WebGUI would not open at all: `debug_run` used the system's `url`, an HTTP port by IP
address, and SAP redirected it to HTTPS on the system's own full host name, which the user's
computer could not resolve. The same page answered at the IP on the HTTPS port. The fix is a
setting, not a guess: an optional `webgui` address per system, used instead of `url` when present
and refused when it is not an http(s) URL. The documentation also gives the other way round - a
`hosts` entry for the name in the redirect - for whoever may not change the settings.

The next run on E19 came back with two "bugs found using the debugger" - both wrong, and
`debug_status` showed no stop and no log entry. The model had set its breakpoints and opened
WebGUI; one `debug_wait` of sixty seconds ran out while the user was still logging on; it called
`debug_stop` and reported what it had guessed from the source as if the debugger had shown it. The
tools allowed a longer wait all along. Two sentences went into the server's instructions: wait
again, and ask the user, while nothing has stopped; and no stop, no verdict.

Eclipse went out as 0.7.3 as well, its first build since 0.7.0, so the version numbers of the two
hosts meet again. `docs/` was emptied before the export, as BUILD.md says, and the jar was checked
for what went wrong once before: 49 classes, the Assistant runtime in `assistant/` with the fix-
without-navigation rule, and one build in the catalogue. The VS Code vsix was rebuilt through
`package.ps1` for the release; the earlier packages of this stage had been made with `vsce`
directly, which BUILD.md forbids because it skips the check of `abap-adt-api` and the pages.

The debugger's documentation then got what a first installation needs: what has to be in place -
notably that the ABAP side of VERTEX is not needed for it at all, only standard ADT, the debug
authorisation and WebGUI - a quick start in seven steps, advice to use a strong model (the pilot's
two wrong answers both came from Haiku), and a table of symptoms. One row there documents a limit
rather than a fix: while a Tools window shows a diff, UML or metrics, the chat answers without
tools. Changing that rule was proposed and not decided, so it is written down instead.

It was decided the same day, the other way round: the row came out of the table and the rule out
of the chat. The rule had been a token guard - a short question about the method on screen should
not start an agent loop - and it cost more than it saved: the chat lost every tool without saying
so, `debug_status` came back as "not available", and with several Tools windows open nobody could
tell which one had switched the tools off, since the context is the last window to report, not
the one in view. Now the tools always stay; the screen still travels with the question, with an
instruction to answer from it when it is enough and not to read the object again. The two tests
that pinned the guard now pin that instruction and the kept tools instead.

## Stage 39 — Visual Debug: the debugger on screen

Smart Debugger shows the whole state of a stopped program at once, but it is a SAP GUI debugger
script built on `CL_GUI_*` controls; none of its code can run in a webview. What carried over is
the picture: all variables in trees by group, initial values hidden, objects unfolded by
visibility, tables in grids of their own, changes since the last stop marked. The pilot takes
that and leaves out the rest - stepping back, coverage, diagrams.

Two questions were settled before any code. **VS Code only**: Eclipse has its own debugger, to be
looked at separately. **One session with the assistant**: SAP keeps an IDE's breakpoints by user
and IDE id, and one listener takes a stop. A second debugger in the same window would have taken
the assistant's stops at random, and the assistant could not have read the stop on screen. The
cost is that a step or `debug_stop` from one side moves the other.

What that meant for `debugger.js`:

- **The window must not eat the assistant's news.** `debug_wait` collects stops, ends and
  problems once. The window reads a separate `picture()` and is woken by `watch()`; a step from
  the window is `advance()`, the step without the collecting that `debug_step` does after it. A
  test pins it: a step from the window, then `wait()` still returns the stop.
- **One request at a time on the stopped session.** Before, only the assistant used it, one tool
  call after another. Now the window reads variables while the assistant may step, so every use
  of the stateful session goes through one queue (`exclusive`).
- **The lines are the active version's.** The source VERTEX shows is the working area; a
  breakpoint counts lines of what runs. The window reads the active source on the stateless
  connection.
- **Breakpoints by source URL**, since the window knows what it shows, not a type and a name:
  `objectOf()` reads the object back from the URL. That brought function modules in, whose URL
  names the group. The assistant's tool schema was left as it was.

Visual Debug had to stay out of Eclipse, which loads the same `object-tools.js` and `tools.html`.
The shared model got `enable()`, which only VS Code calls - in its Node module and in the page it
builds - and `tools.html` routes to the page and to the debugger only when the host defines
`sdeDebug`. The page itself lives in `vscode/pages/`, outside the shared resources. Its
instructions are now read when asked, so the text the assistant gets names the action only
where it exists.

Checked with tests on a fake SAP and with the page in a browser against a stubbed host. Not yet
against a live system - which names SAP gives the variable groups, whether a class or function
module stop reports the URL the breakpoint was set on, and what `ACCESS_KIND` holds for
attributes are all the first things to see on ALC.

The first run on E19 went through. What it asked for next was speed. ADT has no "what changed" -
Eclipse compares too - so exactly the changed variables cannot be read. The window now reads again
only what a plain statement names, and everything switched on after a call, a step out or a
Continue; group switches turn reading off altogether. And to know what a step costs at all, Visual
turns Continue into a run of F5 steps with no variables read: `advance(kind, quick)` skips the
snapshot the assistant gets, and returns the time of SAP's step request and of the whole step. The
assistant, which has no such run, still gets what changed at the next ordinary stop, against the
last values read.

The first Visual run measured about 335 ms a step, 160 of them SAP's step request. The rest was
mostly the stack, asked after every step because SAP's answer to a step carries no position at
all - not a line, not an include. The idea of skipping it "when the stack does not change" does
not hold: the stack may not change, but the line does, and nothing else says which. What does is
ACE: its parse already holds every statement of every include, cut by SAP's own scanner, with its
keyword and tokens. A new `statements` mode of the flow resource hands that over as a map - start
and end line and a kind: `decl`, `plain`, `call`, `flow`. From plain to plain the next line is
certain unless the statement raises; everywhere else the stack is asked. The raise case is not
hidden: whenever the stack is asked after a plain statement, the window checks that the program
stands where the map said and reports the miss. Classes and function modules are left out for
now - their frames count lines in the main source, the map in the include.

The first version of the map did not reach the system: two pulls left the old class active and
nothing on the inactive list, and the window got the old "Parameter include could not be found".
The keyword lists had been written as literals joined with `&`, which the compiler folds into one
literal - and a literal may not be longer than 255 characters. A syntax check of the source
through `fr_abap` named it at once (`arc-e19`'s SAPDiagnose refused the call over
`includeSubpackages` again). The lists are now joined with `&&` at run time.

With the map in place the same run took 12 of 31 steps without the stack, 320 ms a step down to
260. What decided the other 19 was not the stack's depth - a LOOP or a WRITE leaves it as it is -
but the line, which only data decides at a LOOP, an ENDLOOP or an IF. A plain PERFORM is
different: where it goes is in the text, and so is where its ENDFORM returns to. The map now
names the form of each FORM and plain PERFORM; the window adds a frame on the way in and drops it
on the way out, marks such a stack as predicted - no level of it can be switched to - and asks
SAP once where the run stopped, checking the prediction against it.

Looking for what else a step costs turned up the transport: the HTTP agent VERTEX gives
abap-adt-api was created without `keepAlive`, so every request to SAP - every step, every stack -
opened a new connection with its own TLS handshake. It keeps the connection now, for all of
VERTEX, not only the debugger. It did not show in the numbers: a step stayed at 159 ms, a stack at
156 - the time is SAP's own.

That left the steps only data decides. The answer to those was not to predict them but to skip
them: nobody watches a loop go round, so at a LOOP, DO or WHILE the run now sets a point on the
statement after the matching end - found in the map by nesting - and runs to it with F8
(`runTo`). The point is the window's alone: it goes to SAP with the user's breakpoints, is listed
nowhere, and is taken away before the stop is read, so the stop is never taken for one of the
user's. A breakpoint of theirs inside the loop still stops it, as F8 would.

Local methods came the way PERFORM did. The map names each METHOD by its class, and a standalone
call by the method it enters where the text settles it - `lcl=>m( )`, `me->m( )`, `m( )`,
`CALL METHOD m`. Two things can make the name lie, and the map drops the name for both: a local
class inheriting from the class, so that ME may be the subclass with the method redefined, and a
class constructor, which runs first the first time the class is touched.

A run through Z_ACE went 966 steps deep into SAP's own classes and slowed the whole machine. The
window was the cause: every change of include redrew the source whole - four thousand lines of
`CL_GUI_SOURCEEDIT`, a node per word - read it from SAP again though it had it, and drew each
stop twice, once from the run and once from the debugger's event. Drawn sources are now kept (the
last six) and put back, read ones are not read again, and the event is ignored while a run draws.

The same run showed why a global class got no prediction: its frames count lines in the class's
main source, the map in the method's include. The window finds the METHOD the stack names in the
main source and shifts the include to it; the same check - each statement on its line with its
keyword - decides whether the shifted map is used.

Z_ACE then ran 115 steps with 110 predicted - and showed the wrong code. The program has local
classes named as global ones, and ACE's parse of a program brings in the global classes it
refers to: the map for Z_ACE held the global ZCL_ACE's includes, a call was predicted into one
of them, and the window drew that include while SAP was elsewhere. The map now holds the
program's own includes only; a call into a global class is left to SAP. The statistics gained
a "window" figure - a step's time less SAP's requests - so that what the window itself costs is
read, not guessed: about 20 ms of a 180 ms step.

In Z_ACE_STANDALONE the line stopped moving. `mv_prog = i_prog. mv_package = i_package.` is two
statements on one line, and the window found "the statement at this line" by the line alone - the
first one, every time. The step from the first to the second was predicted, the line did not
change, and the next step started from the first statement again: the same line, predicted
forever, while SAP went on - and all plain, so nothing asked SAP and nothing caught it. The window
now keeps the statement it arrived at for each level of the stack; where a line holds several and
the window came there by the stack, not by a prediction, it does not know which one and asks SAP.

Z only first worked after the fact: F5 into the call, see that it is not Z/Y, F7 back - two steps
and two stacks for every standard call. Where the text already says whose code a call enters,
that is waste: the map now lists, for a statement with calls, the owner of each - the class of
`cl=>m( )` and `NEW cl( )`, the function module of a literal `CALL FUNCTION`, the current class
for `me->m( )` - and ? where only the data knows. A statement whose calls all go outside Z/Y
is stepped over with F6, and the next statement taken from the map.

A run of 325 steps over Z_ACE suggested what a run is actually good for: the flow, which routine
calls which, recorded rather than guessed - ACE's Calls diagram walks every branch, a run only the
one taken. For that the statements in between do not matter at all. A Flow run therefore does not
step: in a routine it sets points on every call that may enter Z/Y code and on the routine's
end - on all of them, since which branch runs is the data's to decide - and runs to the first one
reached; a routine with nothing to call is left with F7 at once. `runTo` took a list of lines for
it. Every stop records the stack against the one before; each level added is an edge. The picture
is Mermaid, loaded as Metrics loads it: by class, or by routine grouped by class.

The first Flow run on ZSDE2 went through a whole Z constructor without a stop: `CREATE OBJECT
<obj>-alv_viewer EXPORTING ...` has no bracket, no arrow and no calling keyword, so the map had
it as a plain statement, and no point was set on it. `CREATE` is a call now; its owner is the
class after `TYPE`, or ? where the reference's type decides - and CREATE DATA, which runs
nothing, is stepped over.

The same run showed the other half: `CHECK zcl_sde_sql=>exist_table( gv_tname ) = 1.` is a flow
statement to the map, and Flow set points only on call statements, so the method it calls was
never entered. A statement's kind says where the program may go next; whether it calls
something is a separate question. The map now answers it on its own (`calls`), with the owners
of the calls for any statement that has them. Flow stops at every statement with a call that
may enter Z/Y code; the F6 prediction stays with call statements alone - after `IF cl=>x( )`
the condition, not the text, decides the next line.

On ALC the map was there - active, fresh, the window reloaded - and still nothing was predicted
and no call stopped. The check that lets a map be used on a source had demanded that every
statement it looked at start its line with its keyword, and one that did not switched the map
off for the whole include, silently. `ENDIF. LOOP AT ...` is enough for that. The keyword may now
stand after a period or a colon too, nine statements in ten must stand where the map says, a
statement whose own line did not check out is never predicted from or to, and a map that does
not line up says so, with the count.

That was the wrong answer, and the user said why: patterns over the text are one guess on top of
another, and each new program finds a hole in them. ACE never read the text to follow a run - it
took the include and the line from the debugger. ADT's stack does not give a class frame's line
in its include, but SAP says the rest itself. A frame at the address of a program or an include
counts the same lines as the map of that include, by construction. A frame of a global class
counts in the class's main source, and ADT's class structure (`classComponents`) gives each
method's implementation line there; the frame's method is the stack's `eventName`. The offset is
that line less the METHOD line in the map. Nothing is compared with the text any more; what fits
neither case is not predicted.

A line of diagnosis under the buttons then showed the map, the statement and the points all
right - `points on 110, 111, 112, 127, 128, 129, ...: F8` - and the program running past 127 to
the user's breakpoint at 132. The points had never worked. ADT keeps two sets of breakpoints:
scope "external", for the runs to come, and scope "debugger", the set of the program being
debugged, sent on its own session. `runTo` had put its points into the external set, which a
program already stopped in the debugger does not look at. Every loop "passed" so far had in fact
run to the user's next breakpoint, and the counter counted points placed, not points reached; the
fake SAP of the tests stopped wherever it was told, so no test could see it. The same held for a
breakpoint the user set by a click while stopped: it was for the next run, not this one. The
points now go into the stopped program's own set, beside the user's breakpoints with their
conditions, and are taken out of it before the stop is read; a change to the user's breakpoints
reaches that set too. The fake SAP keeps the two sets apart, so the test now checks the scope.

With the points working, Flow on ZSDE2 still left out a call the Visual run showed: from the
constructor's line 124 into `GET_FIELD...`. The call is written bare, `get_field...( )`, in a
method include of a global class; the map could not say whose it was and left the owner empty,
and the window read an empty list of owners as "all outside Z/Y". The deeper fault was the map
guessing calls from tokens at all, when ACE resolves every call of a statement itself - ME,
SUPER and references by their declared class, CREATE OBJECT as its constructor, FORMs and
function modules by name. The map now takes a statement's calls and their owners from ACE's
`parse_calls`; my token reading of owners is gone. An empty owner list counts as unknown, and the
step log gained a column saying, for every statement of the routine with a call, what the run
made of it - so a Flow run and a Visual run over the same program can be laid side by side.

A Visual run then went seven levels down into CL_GUI_ALV_GRID and on to ALEWEB_GET_CONTEXT with Z
only on. Z only had one trigger: a step from a Z/Y frame that landed outside Z/Y. Anything that
brought the run into SAP's code another way left it there, stepping F5 through it. The likely
way in was the predicted F6: `mo_alv = NEW #( ... )` placed by ACE as a CL_GUI_ALV_GRID call,
stepped over, and its next line taken from the map without asking - while SAP had stopped inside
the constructor. Z only now looks at every stack: whenever the top frame is not Z/Y and Z/Y code
lies below it, the run steps out, as often as it takes, before anything else. An F6 over a call
outside Z/Y reads the stack after it instead of predicting the line.

The next run showed the step out itself was too small: 41 standard calls "passed", and the run
was still six levels down in CL_SALV_GZ_FACTORY's class constructor. F7 leaves one level; `NEW
cl_gui_alv_grid( )` is a chain of constructors and class constructors, and after each F7 the
program stood in the next one of them. The way back is now one jump: the nearest Z/Y frame on the
stack is found, points are set on every statement of its routine and on its end, and F8 runs to
the first one reached - F6 as seen from our code. F7 is left for a frame the map does not cover.
The statistics and the log show the depth of the stack.

The first full log of a Visual run over ZSDE2 - 777 steps - was mostly three loops stepped
through pass by pass: GET_FIELD_INFO's twelve times over, CREATE_FIELD_CAT's, and the outer loop
of HANDLE_USER_COMMAND, whose inner loop was passed in one jump each time. The jump had one
point, the statement right after ENDLOOP, and gave up when that statement closed a block - an
ENDMETHOD after a loop at the end of a method, an ENDIF after a loop inside a branch. It now sets
points on every statement of the routine after the loop, its end included, and stops at the first
one reached. Copying that log froze the window for seconds: the page fell back to a selected
textarea holding all of it. The text goes to VS Code's clipboard through the host instead.


## Stage 40 — ABAP Unit in the Test Explorer

Eclipse runs a class's tests with Ctrl+Shift+F10; VS Code had nothing. The ADT call is the same
`abapunit/testruns`, and `abap-adt-api` already had `unitTestRun`, so the work was on the VS Code
side: a Test Controller whose tree is object, test class, test method, as Eclipse's ABAP Unit
view. SAP answers with a whole run at once, so the tree is rebuilt from each result, not
discovered beforehand. A failure's stack points at an include and a line
(`.../includes/testclasses#start=19,4`); that opens the include as a VERTEX tab and becomes the
message's location. Only harmless tests run, every duration: a test marked dangerous changes
data, and choosing that stays the user's. A dirty tab is refused rather than run against a source
the user is not looking at. View source got the same run as a button beside Open in the Editor;
the page is shared with Eclipse, so the button shows only where the host defines
`sdeRunUnitTests` - VS Code does, Eclipse not yet.

ATC followed the same way. ADT runs it in three calls: the customizing names the system's default
variant, the variant opens a worklist, a run over the object fills it. The findings are not a
test tree but places in source, so they went to the Problems view as diagnostics rather than to
the Test Explorer. The URI parser written for the unit-test stack became the general one for "which
VERTEX tab holds this ADT source": class includes, programs, function modules, interfaces. A
finding outside those - a program include, say - is named in a warning instead of being dropped,
and a system without a default variant is an error, not a guess at one.

The first function module checked came back with "0,0,0" - no findings in any priority - and so
did a Z module with an unused variable and a `SELECT SINGLE *` planted in it. ATC checks
repository objects, and a function module is not one, its function group is; the run now goes over
the group. It still found nothing, and ATC in SAP GUI on the same group said the same - "passed the
chosen checks without any finding". The zeros were the DEFAULT variant's, not VERTEX's: it does not
flag either planted line there. Whether a run over the module's own URI had checked anything was
never settled; the group is the object ATC knows, so that stayed. The per-priority
counts SAP sends back as an info (`FINDING_STATS`) had been shown as a warning; they are left out,
the summary carries the count.

Where-used and the keyword documentation came next, both already in `abap-adt-api`. Where-used is
two ADT calls - the objects that use the name, then the places in each - and it went into VS
Code's reference provider, so Shift+F12 and the references list are the native ones. SAP searches
the saved source, and a cursor in an unsaved tab points somewhere else, so that is refused. Each
object found is read once to have a tab its places can open. The documentation is SAP's HTML page
for the position, shown in a webview without its scripts and repainted in the theme's colours; its
own links are left dead for now.

The first where-used on a class method landed on `PRIVATE SECTION` and `DATA` lines. A place
inside a class comes back as a fragment, `#type=CLAS/OM;name=<method>;start=N`, with N counted
from that method; `urifragmentmappings` tells where the method starts in the source, and the line
is counted on from there. SAP also sends each place's line text, so a line that does not hold it
is named in the warning instead of being shown - a wrong place is not passed off as a right one. F1 was taken for it in SAP tabs, as in Eclipse, at the cost of
the command palette key there.

The hover said "SAP could not describe this name - Incorrect cursor position" over every keyword,
which was true and too much. It was told apart by what SAP answered, not by the word: ADT returns
HTTP 400 for a position with no name it knows, and the library keeps the status on its exception.
That answer gives no hover; a failed connection or a 500 is still said in one.

View source opened on the whole class, but once a part was picked there was no way back to it
except Back, step by step. The object's name above the Parts list now asks the page for the whole
source (`sdeShowWhole`); only View source answers, so on other pages the click does nothing.

## Stage 41 — the pages that describe VERTEX fell behind the editor

0.7.6 gave the VS Code editor ABAP Unit, ATC, where-used and the keyword documentation, and the
release notes and this repository's README said so the same day. Two other pages did not. The
Marketplace page (`vscode/README.md`) documents each of the four commands in its body, so the
gap was only its summary table at the top, which still read "Hover, navigation, outline" - the
line a reader on the Marketplace sees first and often the only one. The update site's page
(`docs/index.html`) named 0.7.5 as the VS Code build and described LLM Providers as the newest
thing in it.

Both were written for the landing they were part of, not audited afterwards, which is how a
table cell survives four features. The fix is the cell and the paragraph, and it ships as 0.7.7,
whose vsix also carries that README: the README is the Marketplace page, and there is no other
way to correct it. The Eclipse plugin has none of these four features and was not rebuilt, so
the update site still says 0.7.3 for it.

**The backend was not the prerequisite the documentation made of it.** Every page opened with
"it needs an ABAP backend", and the VS Code first run put pulling `src/` before anything else.
That was true when the windows were all there was. Since then the editor, the ABAP Unit and ATC
runs, where-used, the documentation, the chat's source tools and the whole debugger have been
built on ADT through `abap-adt-api`, and none of them asks the hub anything. What reads
`/sap/bc/adt/vertex/*` is the explorers: `table` and `join` for SelecTor, `metrics` and `flow`
for Code Explorer, `versions`, `review`, `prepare` and `requests` for Versions and the MCP
transport tools. Visual Debug sits between the two - it works without the hub, and without it
`flow?mode=statements` is missing, so every step asks SAP for the stack and a stepped-over call
shows its class without its method; the page already says so in a notice. The pages now carry a
table of that, grouped the way a reader meets the tools: editor, debugger, assistant, then the
three explorers. The rows were read off the code, not off memory.

**The half of them that could become tools.** The four features are editor commands, and the
chat could not ask for any of them. Two of them took nothing to hand over: `unitTestsOf` and
`atcOf` already accepted an object by name and type, because View source calls them that way, so
`run_abap_unit` and `run_atc_check` only had to be schemas in `code-workbench.js` and two lines
in the dispatcher. What they lacked was an answer. A run wrote into the Test Explorer and the
Problems view and returned nothing, which is enough for a button and useless for a chat: "see
the Test Explorer" is not an answer. `runTests` now counts the classes, the passes, the failures
and their messages into a summary and returns it, and ATC returns its variant and its findings,
the first 50 when there are more. The unit run's `catch` shows SAP's refusal in the Test
Explorer and swallows it; a caller waiting for an answer is thrown to instead, or it would be
told a clean run that never happened.

The other two stayed out. `usageReferences` and `abapDocumentation` are asked for a line and a
column of the saved source, not for a name. Where-used of an object as a whole would work -
ADT's line and column are optional - but where-used of a method, which is what the request
usually means, would mean finding `BAR` in the text, and this repository does not read ABAP as
text. The keyword documentation has no name-only call in `abap-adt-api` at all; answering *show
help for LOOP AT* would mean a new ADT endpoint. So the instructions tell the chat to name the
key instead - Shift+F12, F1 - rather than guess from a search or from the source, which is the
failure mode worth preventing: a plausible where-used answer with nothing behind it.

## Stage 42 — Value Origin stops reading ABAP as text

The initial local analyzer could not connect a returned structure component to a
NEW call. Added an ACE index response containing scan tokens with positions,
statement identities, calls/bindings, units and parameter metadata. The VS Code
loader reads the dependency closure in the editor's SAP system, preserves include
locations, and refuses stale/unsaved root source instead of mixing revisions.
The dependency engine consumes those facts and projects components across copies,
RETURNING and CHANGING, resolves factory-created references, and retains conditional
and loop boundaries. Its offline scanner serves fixtures; production SAP source
uses ACE's statement boundaries. Tests include the debugger_tests calculation rig,
same-line assignments, ACE composite tokens and method includes, load failures and
read-only endpoint/schema handling. VSIX remains 0.7.9 for testing. ABAP activation
could not be verified because the configured local SAP endpoint refused connection.

Interface dispatch exposed a gap in the first index response: an implementation can be analyzed
from a generated CM include that does not contain its `INTERFACES` declaration. The backend now
emits the ACE-scanned class-to-interface relation alongside reference types; the dependency engine
uses those facts to select the concrete `CLASS->INTERFACE~METHOD` implementation without regex parsing.
Editor navigation now resolves calls before requesting ADT's definition and refuses an interface
`METHODS` declaration as a target of an invocation.
It also uses the active editor group for every ordinary navigation; only Value Origin's explicit Ctrl+Click opens beside.

The live closure exposed a further ACE transport gap: `ZCL_PRICE_ROAD` appeared only as a CU include under
the pricing factory. `ts_prog-class` is now emitted for each include, so the client requests the actual
class pool and obtains its CM implementation rather than treating a foreign declaration include as complete code.

Value Origin links open the standard VS Code editor (or beside it with Ctrl+Click).
The test manifest contributes ABAP breakpoint support, so VS Code exposes its native
leftmost-gutter click in that editor; those breakpoints synchronize to the same SAP
debugger session as Visual Debug.

The standard source editor can now reveal a right-hand Visual Debug panel for its
current object, while its source stays in the normal editor and highlights the
actual stopped line. Its F5-F8 bindings are limited to `vertex-sap` ABAP documents
and call the shared debugger's into/over/out/continue operations; other VS Code
editors retain their normal shortcut behavior.

## Stage 43 — the execution flow drawn as a hierarchy

Mermaid execution-flow layout uses top-down caller-to-operator edges. Operators in the same invocation are siblings in execution order; enclosing subgraphs and the sequential edge chain were removed.

Retained procedure ids on resolved targets instead of looking up executable sources through editor navigation addresses. The relevance mask now uses reached statement identities without requiring populated per-step calculated facts. Procedure bodies supply method scope when flow event names are empty. The new demo regression exercises nested execution flow and diagram parity; existing tests previously covered BSE nodes only. Mermaid clicks now resolve flow indices to their original source locations.

The persistent unresolved dispatch came from collectSources skipping every name in the index's interfaces map, which also contains CLASS declarations. A foreign CU therefore suppressed loading its CP/CM sources. Replacing the empty CU regression fixture with a real CLASS declaration reproduced the failure. The loader now allows these global object requests; a transport-level calculation-rig regression verifies base-price arithmetic and all five modifier implementations after loading the closure.

**The file that had to come back from a backup.** On 28 September `value-origin-view.js` was
restored from a backup mid-work, and the copy it was restored from was committed beside it as
`value-origin-view.recovered-20260928-1403.js`. The manifest went to 0.7.10 in that commit and
back to 0.7.9 in the next one, so 0.7.9 through 0.7.11 name no build and never will. Neither the
stray copy nor the version numbers were cleaned up at the time; both were, on 30 September — the
copy deleted and the manifest put back to 0.7.9. A backup taken outside git is not a version, and
committing it beside the file leaves the repository with two answers to the same question for as
long as it sits there.

## Stage 44 — one picture instead of two, and the node that failed the diagram

**A method opens inside the Calls diagram.** Calls and Logic had been two views of the same
object: one showed which methods call which, the other the branches inside one method, and
reading a call meant leaving the first for the second. Clicking a method block now draws its
Logic diagram inside the Calls canvas, joined to the block it came from, with a connector drawn
over the pane rather than inside either SVG — the two are separate mermaid renders, and a single
graph would have had to be regenerated on every open and close. The open block is marked in the
theme's focus colour, and the inner diagram is turned to match the *Top-down* / *Left-right*
choice so the continuation reads in the same direction as the caller.

**The magnifier stopped guessing.** The lens used to switch itself on wherever the rendered text
fell under 11px. It measured the text against the current scale, so zooming the diagram turned
the lens on and off under the reader's hand. It is now an explicit *Lens off* / *Lens on* toggle
serving UML, Logic, Value Origin and every block opened inside Calls, and nothing second-guesses
it. Whether text is too small to read is the reader's call, and a control that changes state on
its own is worse than one that does nothing until asked.

**An empty node failed the whole diagram.** Drawing the operations that ACE finds after `METHOD`
on the same row brought comment statements into the picture: the scanner returns them like any
other statement, they passed the one check there was — the text is not empty — and then
`SCHEME_LABEL`, whose job is to strip the comment off a line, returned nothing at all. What
reached mermaid was `p2("")`, which is a syntax error, and a syntax error anywhere in the source
fails the diagram entirely rather than dropping the node that caused it. That is why it looked
intermittent: it depended on whether a comment fell inside the stretch being drawn. The label is
now computed before the node is, and a statement with nothing left to show is left out of the
chain; where a statement can be pended into an *N operations* box, the check runs before it is
pended, so the count matches what would be drawn if the box were opened. The older
`ZCL_VX_ACE_FLOW` had the same guard, falling back to `"?"`; the guard did not travel with the
code when the Logic diagram was written.

The three structural nodes — the branch join, the unit box, the loop frame — were deliberately
left without the guard. Dropping one of them would break the joining of branch tails or the
nesting of frames, and they cannot come out empty: a line is only marked as structure when its
first word is a keyword `CLOSER_OF` recognises, so its text always carries that word.

**Two regressions were committed red.** `formula-diagram.test.js` arrived asserting on exact
strings of minified page source — `/shown=formulaMode\?formulaVisible\(\):visible\(\)/` — and
failed on arrival, because the implementation it was written against changed in the same
landing. A test that reads generated source as text fails for the same reason this repository
does not read ABAP as text.

## Stage 45 — the ending SAP does not name

**What was missing.** The debugger was told the run was over and never told why. A step
that kills the program throws, and `end()` treated every throw the same: the message went
into a note unless it matched "exception was raised", which is what an ordinary end says.
Two endings, one signal. F5 into a class whose load fails — `SYNTAX_ERROR` in a `CM001`
include, two lines in — came back as a finished run. Worse, a program that dumped before
reaching any breakpoint produced no step and no stop at all: the listener simply went on
listening for something that would never arrive, and the only thing that ever noticed was
the wait running out.

**Where the answer was.** ADT publishes the short dumps as a feed, and `abap-adt-api`,
already a dependency, already wraps it: `client.dumps(query)` over
`/sap/bc/adt/runtime/dumps`. Nothing had to be added on the ABAP side — no hub route, no
`ZCL_VX_*`. That is worth saying because the reflex in this project has been to extend the
backend, and here the backend was not the missing piece.

**Ids, not timestamps, and not a query.** The parsed feed entry carries `id`, `author`,
`categories`, a summary and links — no time of its own. The `$query` syntax of the feed is
not documented anywhere reachable, and guessing a filter that silently matches nothing
would have been the worst possible failure for this feature. So the run takes a baseline
instead: every dump id in ST22 when it starts is remembered, and anything appearing later
under this user is new. No clock to be wrong about, no query to get wrong, and somebody
else's dump of the same minute cannot be mistaken for ours.

**One ask now, the rest in the background.** The first implementation asked three times,
1.5 seconds apart, and awaited all three — which made every ordinary end of every program
three seconds slower, to look for a dump that was not coming. The test suite said so
immediately: a terminate test that had run in milliseconds took 3011 ms. It now asks once,
synchronously, so the answer rides back in the answer to the step that killed the run; if
that comes up empty the remaining tries are fired off unawaited, because SAP writes the
dump after the program is gone — "short dump is being formatted", as the WebGUI screen
says. What they find reaches the assistant through the next `debug_wait`.

**The listening case is a poll, and only while somebody waits.** For the run that dies
before any breakpoint there is no event to hang the question on, so `debug_wait` asks the
feed every ten seconds inside the one-second tick it already had. No timer, no background
work when nobody is waiting: a poll that runs when no one is listening is a poll that
costs requests for nothing.

**A feed that cannot be read is a problem, not an empty answer.** `markDumps` failing sets
the baseline to null and pushes a problem saying that a run dying of a dump will not be
reported. The alternative — treating an unreadable feed as "no dumps" — is the exact
silent degradation this project has been bitten by before, and here it would hide the one
thing the feature exists to show.

**The window had to say it too.** The first landing wired the dump into the answers the
assistant gets and stopped there, which left the reader of Visual Debug looking at "The
program ended." for a program that had not ended - the window counts endings and had
nothing else to go on. The ending now travels in `picture()` by reference, so a dump found
by a background try reaches the window on the next wake without it asking again, and it has
a Dump section of its own that opens itself when a run dies. The feed's own address is an
ADT resource rather than a page, so **Open ST22** goes to the transaction through WebGUI -
the same route `run()` already opens a program by - where that dump is the first entry.

**Where the dump happened, without scraping anything.** The feed entry has no place in it -
id, author, category and a summary, and that is all - so the first reading was that the
include and line live in the dump body behind the entry's link, as HTML to be parsed. Asking
the system settled it: ST22 keeps the dump in `SNAP`, and its `FLIST` is a string of tagged
records - two letters, three digits of length, then the value. `FC` is the runtime error,
`AP` the program, `AI` the include, `AL` the line. Structured data, not markup. `SNAP.FLIST`
is `CHAR 200` with eight continuation columns rather than a LOB, so VERTEX's existing table
resource can select it, and its `f/s/o/l` filters take `DATUM`, `UNAME` and `SEQNO` - no new
ABAP route, which was the other thing the first reading got wrong. It does mean this one
part of the debugger wants the backend, where nothing else in it does; a dump whose place
cannot be read is still reported, and carries the reason instead of a silent blank.

**The editor that would not follow.** Stepping into a method showed it in VERTEX's own
source pane and left the standard VS Code editor on the caller. The cause was a deliberate
refusal: `followStoppedFrame` opened the stopped frame only when its source tab happened to
be open already, to stop a stop in a callee from opening every class on the runtime stack.
The fear is real but the cure was too broad - a debugger that will not show you the line you
just stepped into is not following anything. It now opens the current frame's source when it
has to, and only the current frame, which is what keeps the rest of the stack out of the
editor. What makes this worth recording is how it was first explained away: the same session
had just landed dump detection, the run had died of a `SYNTAX_ERROR` in `ZCL_CALC_FACADE`,
and the obvious story was that there was nothing to step into. `SNAP` said otherwise -
`AI` naming include `CM002` and `AL` naming line 3, inside `METHOD RUN`. The dump was not
from the first line, so the program had entered the method, and the editor simply had not
gone with it.

**The program let go.** Detach continues the program and stops listening, which leaves the
dump watch with nothing to hang a question on: no step throws, no stop arrives, and the
ten-second poll is tied to listening. A run that died after Detach was invisible - in the
one feature built to make exactly that visible. The fix deliberately does not add a timer:
after Detach the program is not ours to watch, and a poll nobody is waiting for is requests
spent on nothing. Detach takes one look after letting go, unawaited so it answers at once,
and everything later is asked for - a button in the section, `debug_dumps` for the chat.
`SNAP` names the program in `AP`, so what comes back says which program it belongs to
instead of being assumed to be ours.

**Four ways to arrive nowhere.** Making the standard editor follow the stop took four
attempts, and every one of them failed silently, which is why it took four. A method frame
names its generated CM include, and the first version skipped anything that was not
PROG/CLAS/FUNC. The second read the frame's source address, which SAP does not always give,
and gave up before reaching the code that knew better - the class and the method are in the
frame itself, in `program`, `eventType` and `eventName`, whether or not a uri came with them.
The third asked for an entry with a live document, and an editor tab that outlived a reload
is restored by the file provider as data and a repo with **no** document: the working
go-to-definition path had always looked the entry up by uri key and never needed one, which
is what the user pointed at. The fourth opened the class in whichever group was active.

Each of those was a bare `return`. A silent skip is defensible for a system frame nobody can
open, and indefensible for a frame we could name - so the failures that remain now say so.

**Folding came back.** Sections could be shut by their heading and could not any more; git
has no handler on those headings in this file at any commit, so whatever was lost was lost
before it was ever committed here. It was rewritten rather than restored: a `folded` class,
`flex:none` while shut so the other sections take the height, the remembered size kept for
when it opens, and a click on a control inside a heading left to that control.

**The fakes were part of the contract.** Every fake connection in `debugger.test.js` had
to grow a `probe`, because a connection without a dump feed is now not a connection the
debugger can work on. Three tests failed the moment the feature landed, and they were
right to: they were modelling a SAP that no longer matched. The two new regressions cover
both endings — a step that dumps, with an older dump of this user and a same-minute dump
of another user in the feed to be ignored, and an ordinary end asserting that it took less
than a second. Both were checked by breaking the feature on purpose and watching the right
one fail.

---

## Stage 46 — the source is the editor

**The freeze was not where it was looked for.** A 147,000-line program hung the laptop in
VERTEX and opened in seconds in the standard editor, and the first suspicion was the ADT read
and ACE. Neither: the page's `outline` takes 80 ms on that file, `variableTypes` 96 ms,
`methodTypes` 23 ms, the editor's statement scanner 340 ms. The first investigation went to the wrong
window, too - the VERTEX source *tab* instead of the Tools window's View source - because the
report said "the standard window" and the code has two sources. A headless Edge run of the
real page on the real file settled it: 4 s of script, then about five minutes of layout and
paint for ~670,000 nodes, growing faster than linearly (5k lines 0.24 s, 10k 0.63 s, 20k 1.9 s).
The editor is fast by drawing only what is visible; the page could not be made fast
without becoming a second editor, and it should not be one.

**Two sources to one, then to none.** The first answer was a dock mode: the page keeps Parts and
sends no text, the host computes parts and lines, and a part click reveals a line in the open
tab. It worked, and then the question that mattered came from the user: what is left of
View source once the editor shows the code and Outline shows the structure? Buttons that are commands anyway.
The mode was built, shipped in a vsix, tested on the file, and removed within hours - the page,
its bridge, the host's parts module, the part-text lookup for the assistant. Writing the
parts module also produced the one reusable finding: a program's list of `CLASS=>METHOD`
from ACE has no counterpart in the page's own outline, which knows forms and events only.

**What stays.** Parts in Tools, for the Logic and Calls diagrams, which follow one part - Metrics and UML draw the whole object and
do not show the list. Outline for reading.
The model of both hosts lost `view`; defaults fall to UML (class, package) and Metrics (program).

**Visual Debug left Tools for the same reason**, and was found broken by the change before it:
it read `source_url` from the answer the dock mode had just reduced to parts. A copy of a
function that has a better home is a copy that breaks first. The docked panel kept its page and
stopped building the hidden pane.

**The guard that remains.** Hover, Ctrl+Click and F1 post the whole source to ADT for every name.
Above 20,000 lines that is refused with a sentence; one request at a time; 20 s and given up.
ADT cannot abort a request, so SAP may finish what the extension has stopped waiting for.

**One thing the move had never covered.** The step log's Copy button was handled only in the Tools window's bridge, so the
docked panel never copied anything; it showed only once the Tools copy was gone and the panel was the one in use.

**Points found nothing for `LS_RESULT-AMOUNT`, and the editor found everything.** Both use the same analysis, and the
first suspect was the analysis. It was not: the editor draws the nodes of the slice, Points kept only ACE flow rows the
slice had "reached" - a second, narrower list. Points now come from the same nodes (`value-origin-points.js`), checked
on the demo fixture against the chain the editor draws; not yet seen on the live record. The live record then said "read 96 sources, 2 nodes in the slice": the analysis had been started at column 0 of the
stopped line, before an indented statement, so it anchored on the statement above and had nothing to follow; the editor passes the
cursor's column. A first look at the editor's
own empty panel had been a mis-click, the cursor in the word `Returned` of a text literal. Two further directions were
discussed and neither is started: ACE's own backward propagation over `flow_steps` and call bindings (as in
`propagate_vars_backward`, the static flow that will also serve the optimisation of the debugger's steps), and a slice over
the recorded steps that links a value across calls through ACE's parameter bindings (needs a record made with Steps &
values). Deferred by the user until the static flow is wanted for the debugger.

**Twenty attempts at one colour.** Points and BSE of the record stayed empty for a long evening, and each fix was real:
column 0 of an indented line anchored on the statement above; ACE and the debugger counted a class's lines differently
(per method include, per class source); the method starts were cached across a class being pulled again; a slice that came
back empty was kept for the whole session; a line of another object was passed to the analysis. Each was found by a
screenshot, not by thought, and the last one was the cause under all of them: the analysis was started from where the
run *stood* - before the value existed - instead of from where the value is *used*. A replay of the pasted record against the
new code (38 places of the slice, the record on 36 of them, the other two branches not taken) showed the client side
was right all along; the chip's counts exist so that the next mismatch is read off the screen.

**Not spending time on steps that cannot matter.** A Predict log of 155 steps showed one predicted: the map can name the next line only after a plain statement, and everything else - calls, IF, CASE, SELECT, ENDMETHOD - asked the stack. The first attempts were worth less than they looked. An F8 to a temporary point is four requests (the points are set, the run goes, they are taken away, the stack is read), about 790 ms against a step's 380, so passing an IF block whose branch is not taken cost twice what stepping it did, and a global `BRANCHES` of mine was silently replaced by another declared further down the page, which let the skip start from an IF; the thresholds (three statements, four in a block) and a test against doubled names came from that log. What paid was F6 over calls, which the user had proposed from the start: a call is not entered while a value is followed, the record keeps its line, and the stack is not read after it. The first version judged a call by its class and method and so left every call with an owner `?` alone; the second by whether the call is itself a place of the slice; the third did not enter any. 146 steps in 97.7 s became 111 in 67.4 s. The log of that run, read against the source, still showed the calls that matter most entered: a call followed by ENDIF or ENDMETHOD was refused the F6 prediction because the map's next statement was a closer, so the five `apply( )` calls (about 60 steps) and every `name( )` and `log->add( )` before an ENDMETHOD went in. The same log showed what SAP stops at: ENDIF and ENDCASE are not stops (from the end of `APPLY` the debugger goes to ENDLOOP, never to the ENDIF), ENDLOOP, ENDSELECT and ENDMETHOD are; the prediction now reads the next stop that way. That made the next result wrong: with every call stepped over, the diagram lost the calculations of `cs_context-amount` inside the five `apply( )` bodies - the BSE the whole exercise was for. An offline run of the analysis on the test code settled it: the calls that lead to the value (lines 28-31, 33, 34, 36 and 38 of `RUN`) are places of the slice, `lo_log = NEW` (27) and `log->add` (32) are not. So the junk is determined by the analysis itself, from the slice, and only a call outside it is stepped over; a call in it is entered. A first sketch of 'fictitious steps' written from the analysis for the skipped callees was dropped for the same reason.
The next idea was to put the analysis into the debugger itself: two breakpoints bound a path, built before the run starts. A first check said a path needs a value, because the nested calls of `executionFlow` are found by walking back from one; the user's answer was that the analysis already makes the flow - and it does: `fullFlow`, ACE's statement stream, comes back with 137 rows for an empty variable, and the slice only marks the rows it reaches. So the first step is the same analysis Value origin runs, started from a breakpoint of the panel (*Analyze flow path*), its `fullFlow` listed under the point as a tree by routine, the slice marking where a value is chosen. The first live click failed with 'Cannot place ZCL_CALC_FACADE=>START-OF-SELECTION': the debugger's line move, which Value origin never needs, made one row the model files under START-OF-SELECTION - a class's text between its methods - stop the whole list. The move now serves only the click: such rows are dropped (they run nothing), and a row ADT cannot place stays listed, dimmed, without a click. The first list under the point worked (90 statements from line 10 to 16, between ZVERTEX_DEBUG_LAB and the classes) and was the wrong place for it: the user expected the flow in the diagram, the one place a flow is read. The diagram takes a graph in the form `bseFlow:{nodes,edges}` rooted at `bseroot`; the flow is now built in that form - program, classes, routines, statements with blocks as parents, the slice as `bse` - and shown while nothing is recorded, the point keeping a one-line summary. That first drawing hung every class and routine flat under the program, and the user saw at once what was missing: the order of the calls and the stack - everything seemed to come from RUN. The flow of statements has no calls in it, and the model found calls only while walking back from a value, so it now makes a pass of its own over every statement (`callSites`: the call the model's own token reading finds, the routines its resolver reaches), and the drawing is a walk in execution order: a routine where it is called, its statements, a call under its statement one level deeper.

**One magnifier, one depth control, the variables before the run.** Several smaller things followed from reading the same diagram. The analysis found `lo_log->add( )` neither as a call nor as a typed receiver: `ADD` is on the model's list of ABAP statements, which it applied after an arrow too, and `io_log` is a parameter whose type stands in the signature; the ACE backend never had the first fault (its built-in list is applied only to a call with no arrow). The flow's nodes open as Value origin opens its own, by the analysis's sources, since the debugger counts a class's lines in the method's include and the editor in the main source. Collapse all / Expand all became the two ends of the Depth control, in the shared view. The variables are shown before the program runs, from the analysis's declarations, for the routine the reader is in; the panes follow the program, and with no value chosen there is no BSE and no Full/BSE toggle. The magnifier was written three times, and the debugger's copy hid itself whenever the diagram was larger than about 80% (`14*scale>=11`), a rule the Tools copy had dropped because it flickered; the remark that the Tools one does not go out on hover was the whole specification, and the lens is now `vertex-lens.js`, one module with the Tools behaviour (pointermove on the SVG, the copy made when the pointer first comes, over any point of a flowchart, Shift and the wheel for strength) and the switch as an icon. Tools gets it through a marker the host replaces (`/*VERTEX_LENS*/`, inside the page's own script so a test that runs the page's script finds it), the flow views by being loaded after it, and a page that draws a flow without it fails loudly. The packaging check found the first version of that: a marker in a script block of its own was taken by the test for the page's script.

**Not built.** The Eclipse plugin lost the page, its bundle entry and `sdeSource`; no Eclipse
release was built for it. The shell this was worked in turns backslashes in commands into
control characters, which twice damaged a file and once a test; each was caught by the next run.

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

**Flow chart top-down; a hidden duplicate.** The flow chart became `flowchart TD`, so the caller sits above its callees and the levels read as stack depth. SAP standard keeps one block per class, drawn dashed and grey, so its cost stays visible in a performance reading. The number on an arrow is how many times that call was recorded. Checking the diagram against a log turned up two functions named `unitOf`: the Flow one, declared later, silently replaced the step helper, and the "same routine" test after a manual step compared objects and never matched, so every manual step read all variables again. The helper is now `unitName`.

**The chart moves right and draws live.** The diagram left the source column for the right one, under Variables. With Visual on, it is redrawn whenever the stack changes. The renders are queued one at a time, and only the newest waits. Mermaid takes longer than a step, so without the queue, renders started at every stack change would pile up behind each other. The running block gets a green frame, and a green fill once the recorded calls into it pass one. The first live run kept the old zoom, so a growing chart ran off the pane; now every drawing fits the pane until the zoom is set by hand, and Fit restores fitting. Fitting measured the pane only when a drawing arrived, so folding Variables left the chart small in a larger pane; a ResizeObserver now fits it again whenever the pane changes size. That was not the whole cause: the pane itself was a fixed 45% of the column, so folding the bars above it left empty space below instead of growing it. The pane now takes the free space (flex, 45% as its basis), and the observer refits into it.

**A mark, not a drawing; a player.** The live chart first redrew at every stack change just to move the green frame. Only the marked block changes, so Mermaid now runs only when the record gains a block or an arrow. Otherwise `markNow` swaps a class on the drawn SVG node, found by the Mermaid id `flowchart-nX-`. The record keeps, for each stop, the calls made so far, the block and the source line. ◀ ▶ step through those stops and ⏵ replays them one per animation frame, moving the source line and the green block together without asking SAP, and shows ms per frame as the window's own speed limit. SAP standard turned dashed blue. In the browser pane used for testing, ms per frame was 480-800, because a background pane throttles animation frames; the real figure must come from VS Code. Class frames in Methods broke the depth reading: a frame pulls its methods onto one level, so a constructor and the method it calls sat side by side. The frames are gone. Each routine is a two-line block (class, then method) in its class's colour, and Mermaid ranks the blocks by the calls alone. Mermaid's `classDef color` does not reach SVG text when labels are not HTML, so the blue text of standard blocks comes from page CSS. Dark themes drew the chart in Mermaid's light colours. The theme was read from `vscode-dark` on the body, and inside the Tools window that class is not on this page. The page now reads the brightness of the pane's real background colour. With class colours, the green mark vanished: Mermaid writes each `classDef` as an `#svgid .cN>*` rule with `!important`, which outranked the mark. The mark's rule now carries more specificity. The player gained ⏮ and ⏭ and a slider over the stops: stepping back from stop 108 of 124 one click at a time was the only way to the start.

**Rec and clickable blocks.** The window drew each step in 20-100 ms against SAP's 190 and the stack read's 260, so drawing was never the brake. What a replay lacked was detail: Flow stops only at calls. Rec, beside Visual, runs Continue with the Visual logic (F5, prediction, loops passed with F8, Z only) and records every stop into the flow record. The record holds the stack path, the source line and the calls so far, and nothing is drawn until the run ends. The player then shows the run statement by statement at the window's own speed. A click on a chart block moves the player to the next stop where the run entered that routine, with the stop before it elsewhere, wrapping round. Standard blocks do not react, because their type (class or function module) is not known from the record. The block a run starts in is now kept on the chart, so a run that calls nothing still shows it. Each recorded stop also keeps its stack labels, and the player draws them in Stack, marked "recorded" and not clickable, since no debugger stands there. Variables are not in the record: reading them costs an SAP request at every stop. Replay at full speed covered 100 stops in 2-3 seconds, too fast to follow, so ⏵ now takes a pace: 1, 2, 3 (the default), 5 or 10 stops a second, or max. The ms-per-frame figure counts only the time the window spends showing a stop. For a flow the values that matter are those where a routine starts and where it ends, and a read costs little next to a step. Flow and Rec therefore read Parameters and Locals (one `scopes` request and one per group) at a stop that enters a routine, and at one standing on its ENDMETHOD, ENDFORM or ENDFUNCTION. The values are kept with that stop. The player shows them in Variables, and at the stops between it shows the last values read in the same routine, saying from which stop. A failed read is kept as its message and shown there, not skipped. The ms-per-frame figure now stays after a replay ends. In VS Code, 10/s played at about 2/s while a stop took 14-21 ms to show. The pace came from `setTimeout`, and timers inside the Tools window's nested frame are slowed down while animation frames are not. The pace now waits on animation frames for the stop's due time. A click on a block first also opened the class in a new editor tab. The intent was the source in this window, which the player already shows, so the editor call was removed. Stack became a table like SAP's own: depth number (the deepest on top), event type, event, program, include and line, from the frame fields ADT already gives. The recorded stops keep those fields rather than a label, so the player's stack is the same table. A standard block the run stepped over has no stop to go to, so a click shows its source instead. The record names it but not its kind, so the page asks the host's source reader for a class, then a function module, then a program, and says so if none is found. In Flow with Visual on, the source moved only when the stack changed, so inside one routine it stood still while the run went on. A stop in the same routine now moves the line mark and scrolls to it, with nothing else drawn. Standard blocks carried only a class name, because the page named a stepped-over call by its owners. ACE's `tt_calls` has the method too, so the statement map gained `callees` (`CLASS=>METHOD`, `PROGRAM FORM NAME`, a function module's name), and a call stepped over now puts its method on the chart. A map from before the field existed is announced once, and the blocks then carry the class alone. Hovering a table showed its first rows as values joined by bars, with no column names. The hover now builds a small grid: column names, row numbers, and a line for the rows not shown. A structure shows as field and value rows. Rec recorded only its own Continue run, so a few F5s with Rec on left nothing to replay. Rec is now general. Every stop the page draws goes into the record while Rec is on: steps made here, the assistant's, a breakpoint hit. A stop drawn twice (a refresh, a second event) is recorded once. Flow and Rec runs still record their own stops. One gap remains: two stops with the same line and stack depth in a row count as one. An SE37 test run put four frames of the test tool under the function module, both in Stack and on the chart (SAPLSEUJ above the group). The page finds the object's outermost frame from the frame fields: the function module by its event name, a class by its pool, a program by its name. The frames below it are folded in Stack behind a line that shows them, and left out of the flow path. A FUNCTION frame is now its own block, named by its event, as the ABAP side already names owners. Run moved to the front of the header, before the object's name, as "Run in SAP" with an SAP-style execute icon (a clock with a green tick). The program field follows it. The step buttons took the classic debugger's names and look: Single Step (F5), Execute (F6), Return (F7), Continue (F8), each with a red arrow beside lines of code. Pause now changes only the label, so the icon stays. The Tools object field took the whole header width and knew only exact names. It is now at most 380 px, and a name with `*` or `+` is sent to ADT's quick search for the chosen type. The matches drop down under the field, and a pick fills the name and runs. Both hosts had to let this one read through, strictly shaped: operation, a number, an ADT type, a mask. That means `allowed()` in VS Code and the route check in Eclipse's `ToolsView`. The Eclipse plugin was not rebuilt. With the caller's frames folded, Stack's depth now counts from the object, so an SE37 test starts at 1 instead of 6. Terminate and Stop did not say what they do. Stop in particular let the program go, stopped listening and deleted every breakpoint, all under one word. They were weighed against four cases: kill the program here, let it finish, end the session, start again with other points. They became Exit program (unchanged: `terminateDebuggee`, points kept) and Detach, a new `detach()` in the engine: `stop()` with the breakpoint list restored locally, SAP's copy gone. Clear all sits in the Breakpoints bar. Because Detach leaves points that nothing listens for, `run()` now syncs them and starts listening when it is not. "Let it finish without stops" stayed out: it is not asked for yet. Breakpoints can now be switched off, as in SAP's debugger. The engine keeps `active` on each entry. `sync()` and the debugger-scope `scoped()` send only the active ones, and `activateBreakpoints(id, on)` covers one or all. Setting a point again turns it back on. The assistant's `debug_status` marks an inactive one, and Run in SAP needs an active one. In the page, an inactive point is a grey ring: Ctrl+click toggles it, the right-click box has Deactivate and Activate, and each row in Breakpoints has a checkbox, next to Deactivate all and Clear all. Auto-fit also blew a one-block chart up to 400 %, so fitting is now capped at the chart's own size. The engine file is CRLF, so the edit scripts learned to match either line ending. The right column changed shape. Sections used to fold to their bars, and Diagram and Log shared one pane with a header button to open it. Now a row of switches at the top of the column shows or hides each of Stack, Breakpoints, Variables, Diagram and Log. The visible ones are stacked with a draggable line between each two, and dragging moves height from one to the other, 40 px at least. Folding went, since it fought the sizes. Log became its own section, and "log" stopped being a mode of the chart. The pane layout lives in `layoutPanes()`, and the sizes stay in memory for the window's life. The mask search failed in VS Code with HTTP 406. The extension's `fetch` sends `Accept: application/json` for the VERTEX resources, and ADT's quick search answers in XML only. `fetch` now asks for XML for that one resource. Eclipse already did, through `ChatView.accept()`. A plain name now goes through the quick search as NAME* first. Found as typed, it runs. Not found, but with names that start with it, those are listed. When nothing at all comes back, the name runs as typed, because the type-filtered quick search can miss a standard function module that the function itself opens. Parts came to function modules, but only where they help. A function module rarely has parts, though some carry local FORMs written after ENDFUNCTION in the same include. `ZCL_VX_ACE_SOURCE=>resolve` learned FUNC: TFDIR gives the group's program, and from it the FM's include `L<group>U<nn>`, with a namespace kept in front. The metrics resource then returns only that include's units. The page asks for them as for a program, and shows the list only when a FORM is among them. The ABAP was not syntax-checked here, because SAPDiagnose refused the call over `includeSubpackages` again. The pull's activation is the first check. Rec wrote manual stops into the flow record but not into the step log, which only runs filled, so Log stayed empty after a few F5s. `recordStop` now also logs the stop. A step made here carries its key (F5-F8) and the milliseconds from the click. Any other stop (the assistant's, a breakpoint) is logged as "stop". Z_CALC is a report with no event statement at all: its code runs as the implicit START-OF-SELECTION. ACE found no unit in it, so Metrics and the Logic diagram said "No code units". `unit_boundaries` now gives such a program one EVENT unit, START-OF-SELECTION, from the statement after REPORT to the last. That happens only when the main include has no unit and no event, form, module or method exists anywhere in the program, so pools and function groups never get one. The flow resource reads the same boundaries, so the scheme follows. The ABAP is not checked on a system yet. View source has a Parts column of its own, and for a function module with no parts it stayed: a heading over an empty 280 px strip, with no way to fold it. With no parts, the column and its splitter are now hidden. With parts, the heading carries a ‹ › button that folds it to a bar, as the Tools parts list does. A new class listed Local class definition, Local class implementation and Local macros in Parts, and none of them opened. SAP generates those includes holding one comment, which the empty-part rule did not catch: it only dropped includes with no text at all and sections with nothing but their header. `worth_showing` in the versions resource now runs ABAP's own `SCAN ABAP-SOURCE` over a CDEF or CINC include and drops it when no statement is found. That is SAP's tokenizer, not a text pattern. The same list feeds Diff, so a local include emptied back to its comment leaves Diff too. Picking Private section in Parts showed nothing new. The page looked for `PRIVATE SECTION.` in ADT's `source/main`, which ADT assembles from the section includes and the method includes, and scrolled to it. A read-only window can instead show the part itself, and SAP keeps each part as an include: CU, CO and CI for the sections, CMnnn for each method, CCDEF, CCIMP and CCMAC for the local ones. The versions resource got `now=X`. With a part and its type it returns that include's current text via `READ REPORT`. `part_include` knows the section names, the method include (`get_method_include`) and the local includes by name, and `worth_showing` now uses it too. Tools gives pages `sdePart()` for it. View source shows the text numbered from 1, names the include in its hint line, and keeps ← Back through a chain of parts. Nothing is cut out of an assembled text, so no pattern over ABAP is involved. A class opened from a package in Diff showed its parts differently from the Tools list: a Type | Name head row and methods in capitals. Diff keeps its own list for AVE's layout, but the look should match, so methods are shown in lower case and the head row is hidden. Leaving the head row out first broke the layout everywhere: the column widths came from rules on the head cells, and with no head the Type column spread and the names shifted, classes included. The head row now stays in the table and is hidden with `visibility: collapse`, which keeps the widths exactly as they were (checked in the browser: height 0, columns 12 / 54 / 233 px). The list lost its stripes too, as the Tools list has none. Packages had no View source, only UML, Metrics and Diff. Now they have it. The Tools parts list loads a package's objects from the versions resource, as it loads a class's parts, and shows the list for View source only. View source opens a package with no text and hides its own parts column. A program, class or function module picked in Parts is read through the host's `sdeSource`; any other type says it has no ABAP source. Diff's parts column also drew on the editor-widget shade, which differs from the theme's background. It now uses the editor background. These changes shipped as 0.7.5, and `history.md` got its own section for them. The 0.7.4 Flow entry, bent out of shape by edits made during the day, went back to what 0.7.4 shipped.

**Value Origin folds as a whole.** Every Type kept its own expansion state and no control acted on all of them, so reading a wide graph meant clicking branch by branch. A Collapse all / Expand all segment toggle now sits beside the Type selector. For Code, Data and Formula it sets `open` on the `details` nodes; for FLOW it rebuilds `flowExpanded` from the edge list and re-renders the tree, since the FLOW tree is built in the page rather than in the HTML. The per-node `toggle` listeners that redraw the diagram are suppressed during the bulk change, so one rebuild follows instead of one per branch. Switching Type reapplies the current choice, so the toggle never claims a state the shown tree does not have. Collapsed stays the starting state, which it already was.

**The one script string that still carried raw `<`.** The Value Origin page embeds several JSON blobs in its inline scripts, and every one of them escapes `<` as `<` so nothing in the data can be read as a tag by the HTML parser — every one but the BSE FLOW pane's initial `innerHTML`, which was built from the flow tree and stringified as it was. A script block that the parser ends early takes the whole page's behaviour with it: the heading keeps its placeholder, the Type selector and the toggles are never created, and only the inline `<style>` still shows. That is the shape of a break reported against 0.7.9 with the Type selector gone. It could not be reproduced from a generated page here, so this is the hole closed, not the cause proven; the webview's own console has to name it. The line now escapes like its neighbours.

**Value Origin: the link, the branches, and what Formula is for.** Three reports against 0.7.9, one shape each. The `</>` button was drawn as a full-width framed box under its statement: the page's general `button:not(.data-composed)` rule (one element, one class) outranks `.location` (one class), and the width, padding and border it sets won. The rule for the link is now `button.location`, equal in specificity and later in the sheet, and it says `display:inline-block` for its own sake. Nothing else on the page changes, because every other button wants the wide form. — FLOW built its block stack from `IF/CASE/LOOP/DO/WHILE/SELECT` only, so `WHEN`, `ELSE` and `ELSEIF` were ordinary statements: a `WHEN 'ZCL_MOD_FUEL'.` and the `ro_modifier = NEW zcl_mod_fuel( ).` it selects were siblings under the `CASE`, which reads as ten unrelated children instead of five choices. The stack now holds `{id, branch}`; a branch closes the open branch before it, becomes the parent of what follows, and `ENDCASE`/`ENDIF` pop both levels. This is what Logic already does in `code-workbench.js`, and it was taken from there rather than invented again. Tree and diagram are drawn from the same edges, so one change moved both. — Formula was meant to read as the calculation itself: `a = b + c` at the top, `b` and `c` as equal branches, and each of them opened the same way, so a `b = SELECT … * 5 - y` costs two more edges. The mechanism was already that (`formulaSteps` over `formulaInputs`), but three things hid it. The diagram pulled all `pipelineCandidate` nodes — those whose location matches `->ZIF_CALC_MODIFIER~APPLY` — out of their parents into a `subgraph` ordered by `step_no` from the configured pipeline. That is a grouping by configuration, not by what feeds what, and it was also the one element on the page drawn in Mermaid's own colours, since `applyDiagramTheme` styles nodes, edges and labels but never `.cluster rect`; removing the cluster removes the theme break with it, and the pipeline is still shown in its own status panel. A node was labelled with the whole statement, so a `SELECT` with a wide projection was a leaf half a screen across and the tree only fitted at 16 %; `formulaLabel` now reduces a `SELECT` to its `INTO` target, at most three fields and its table, and leaves an assignment alone, because an assignment already is the expression. And `formulaSeen` was a module-level set marked before expansion, so a variable read by two branches expanded under the first one only and the second ended silently without its inputs — the guard is now the path walked to the node, which still cuts cycles but lets a diamond expand on both sides. The known cost is that a value shared by two branches is now emitted twice in the tree; the graph still holds one node and one edge per pair, and whether the duplicate is worth folding is a question for the next reading. Two Formula tests were already red before this work (`uses only nodes visible in the expanded Formula tree`, `switching visualizers preserves Formula`) and are still red; the pipeline-grouping test was replaced by one that asserts the grouping is gone and that a `SELECT` label is shorter than its statement.

**One top for a derivation.** Formula started at `formulaSteps(graph.root)`, which returns every definition of the selected value, and each of them became a root of its own — for `ls_result-amount` that is ten `cs_context-amount = …` lines standing next to each other, which reads as ten formulas rather than one. A derivation has one top by construction: the value that was asked about. A synthetic `formularoot` node now carries the selected variable and the source position of its own node, the definitions hang under it as branches, and the diagram gets the same node because it is built from the same `formulaGraph`. The root is the only branch that starts open, as `bseroot` does in FLOW; Collapse all still governs everything below it.

**A drag is not a double-click.** Selecting a variable with the mouse in a SAP source tab threw the selection away as soon as the pointer passed the last character of the name. `onDidChangeTextEditorSelection` was the whole of it: VS Code gives no click count, so the rule was "a single mouse selection whose text is exactly one identifier is a double-click", and it called `goToClassMethod`, which selects the definition and reveals it. A drag satisfies that rule in passing — it holds it for one event on its way across the word. What separates the two is the event before: a double-click is preceded by the click that put an empty cursor *inside* that word, while a drag is preceded by partial selections and starts outside it. The last selection per document is now kept, and navigation needs that predecessor to be empty, on the same line, and within the word the selection covers. The first selection event in a document has no predecessor and therefore never navigates, which is correct: a double-click's own first click supplies it. The two existing double-click tests now send that first click, as a real one does, and a new test drags across `do_it` and asserts no second document is opened.

**The bound reaches Formula.** Breakpoints became `flowBounds` only for `executionFlow`, `boundedFlow` and `fullFlow` — Code, Data and FLOW — while Formula is built in the page from `graph.nodes` and `graph.edges`, which nothing filtered. A `withinBounds` check now guards both `formulaInputs` and the definition walk, with exactly the rule the flow uses: a node of the entry program outside `from..to` is dropped, a node of any other source is kept whole. What this does not do is worth writing down, because it is the reason the question came up at all: in a slice like `ls_result-amount`, almost every formula node lives in a called class, so the editor's line pair cannot reach it and the picture barely changes. The bound that would reach it is call depth, not source lines.

**Stack depth as the regulator.** The breakpoint pair bounds the entry program's line range, and in a slice like `ls_result-amount` almost every node lives in a called class, so that bound reaches nothing. Everything here is read off the flow, and the flow knows the call stack, so the bound that matters is depth. It is not taken from `executionFlow.depth`, which is empty whenever ACE produced no execution flow; it is derived from the resolved calls themselves: `caller → target.label` gives a graph over procedure scopes, the scopes of the entry program are 0, and a breadth-first walk gives every other procedure the number of calls between it and the entry. `stackOfScope` then stamps `stack` on the FLOW nodes, on the Formula nodes and on the Code/Data rows as `data-stack`, and the Formula root and the FLOW root are 0 by construction. On the page a `Depth` slider sits beside Collapse all: it hides tree rows by their `data-stack`, drops nodes above the limit from `flowKeep` and from the diagram's node list, and re-renders both. Its maximum is the deepest procedure and that is its starting value, which means no limit — a control that hides something the moment the page opens would be the silent degradation this project keeps out. In the demo fixture the numbers are 0 for the program, 1 for `ZCL_CALC_FACADE→RUN` and 2 for what the facade calls, and the test asserts exactly that.

**Two axes, one slider.** A first cut gave every Type the same regulator, call depth, and that was wrong for Formula: its tree nests by data, not by calls, so the control cut across the tree instead of shortening it — a branch could lose its inputs while its parent stayed, which reads as "no inputs" rather than "bounded". Formula now has an axis of its own, the derivation level: the root is 0, the definitions of the selected value are 1, their inputs 2. `depthOf` picks `level` in Formula mode and `stack` everywhere else, the tree hides by `data-level` or `data-stack` accordingly, and the label under the slider says which axis is in force. A node keeps the shallowest level it is reached at, because in the diagram it is one node; a tree row keeps its own position, because after the path-based guard the same value can appear on two branches, and the slider's maximum is the deepest row the tree actually drew — in the demo fixture 6 for the derivation against 2 for the calls. Changing Type resets the slider to its maximum, so no Type ever opens with something already hidden.

**A declaration is not a step.** Full FLOW is built from the statement stream rather than from ACE's sparse slice, precisely so that calls, conditions, loops and writes stay visible when they calculate nothing. The stream also holds everything that merely declares, and those went in too: `REPORT`, `type-pool abap`, a `TYPES: BEGIN OF …` block eight lines tall, and every `PARAMETERS … RADIOBUTTON GROUP` — in the demo program that is most of what FLOW showed before the first executable line. They are dropped by their leading keyword now, the list being the program headers, the type and data declarations, the selection-screen statements, `TABLES`, `INCLUDE`, the method and interface declarations and the macro brackets. The one case that has to stay is an inline `DATA(x) = …`: it declares, but it is an assignment and it runs, so `DATA` is dropped only when it is not followed by an opening parenthesis. On the demo program FLOW goes from the whole file to four statements: `START-OF-SELECTION`, the `COND` that picks the scenario, the call into the facade and the `WRITE`.

**The event names the level.** Full FLOW put a program's statements under `GLOBAL`, which is what the procedure index calls everything outside a form or a method — the analyser's word, not ABAP's. What actually holds those statements is the event: the ones after `START-OF-SELECTION` run there, and a program that declares no event at all runs its code as `START-OF-SELECTION` anyway, which is also how `unit_boundaries` treats it on the ABAP side. The statement stream is walked in order per source and the current event is carried along, so a point outside a procedure is scoped to the event above it and to `START-OF-SELECTION` when there is none. The event statement is then dropped from the stream, exactly as `METHOD` and `ENDMETHOD` already were: it names a level and is not a step inside itself. The declaration filter also moved from the first token to the statement text, because `type-pool abap .` survived the token test in a live source while it was filtered in the fixture; matching the leading word of the text does not depend on how the tokenizer split it.

**One number for what is shown.** The depth slider was an upper bound laid over the expansion state, and the expansion state was the real gate: with Collapse all active only the top level was in the DOM as visible, the diagram takes its node set from exactly that, and so every slider value from 1 to the maximum drew the same picture. Depth is the gate now. `openToDepth` opens a `details` when its own level or stack is below the limit and closes it otherwise, FLOW rebuilds `flowExpanded` from the same comparison, and Collapse all and Expand all became the two ends of the slider - depth 1 and the maximum - rather than a separate state. Moving the slider marks whichever end it has reached, and neither when it is in between.

**A CASE with no visible branches.** BSE scope keeps what ACE marked as calculating the value, plus the ancestors that lead to it. A branch statement never calculates anything, so `WHEN 'ZCL_MOD_FUEL'.` was kept only when something under it was marked, and the assignment it selects is a constructor, not a calculation of the amount. The result was a `CASE` sitting in the chain as if it branched nowhere. The `branch` flag that the WHEN/ELSE/ELSEIF nesting already computes is now carried on the node, and after the ancestor closure a second pass keeps the branch children of every kept node. Their bodies stay out, so this restores the shape of the decision without bringing back the statements BSE deliberately left behind.

**The path is not the logic.** Keeping the ancestors of a finding keeps what leads to it, which is a chain of parents, not the statements that ran beside it inside the same branch. A `WHEN` that holds a finding therefore showed the finding and nothing else in that alternative, and everything the branch did before reaching it was gone. After the ancestor closure, every kept branch node now takes its whole subtree with it. It is deliberately branch nodes only: an `IF` or a `LOOP` around the finding contains the rest of the procedure as well, so the same rule applied to blocks would collapse BSE scope back into Full. The pass runs before the one that adds the empty alternatives beside a kept control statement, so a branch that holds a finding is filled and its neighbours stay as headings.

**Back to the one rule.** BSE scope is what ACE marked plus the ancestors that lead to it, and the two rules added while reading the request differently - the alternatives beside a kept control statement, then the whole body of a branch that holds a finding - both kept statements that are neither a finding nor on the path to one. Both are gone. What made the branching look lost is simply that in the demo none of the `WHEN` subtrees holds a finding: the assignment under each is a constructor, and ACE marks calculations of the value. A `WHEN` that does hold one is kept, because it is on the path, and it needs no rule of its own.

**Data was Code.** The Type offered FLOW, Code, Data and Formula, and Data had stopped being its own view some time ago: `dataFormula` and `codeFormula` were the same one-line call to `symbolicExpression(step, true)`, over the same `executionFlow` nodes, in the same tree. Switching to it only hid the `.flow-code` span in favour of the `.flow-data` one, which loses the call-target marks in a statement, and dropped the edge labels in the diagram. The option is gone and nothing can set `data-mode` any more. The rendering plumbing behind it stays for now, because `dataFormula` also writes the Formula captions and `dataText` still rides on the diagram nodes; stripping that is a separate pass, not a side effect of removing a menu entry.

**Two Types, and the thing that had to move first.** With BSE scope reduced to the findings and the path to them, Code was no longer a second reading of the slice - it was the same slice arranged along the call stack instead of along the code, and FLOW already shows the stack, since classes and methods are its own nodes. One thing only lived in Code: the parameter bindings, the single place where the value crosses a procedure boundary and changes its name. So that moved before Code went. ACE's `parameter` nodes carry the call's source and line, so the bindings at a call site are collected there, de-duplicated and joined into one node that sits on the call's edge: the caller's statement reaches it, and it reaches the class or method that was called. Then Code and the `<select>` went, and the Type became the shared two-position segment toggle - FLOW and Formula - which is also what the project's own rule asks for on a mutually exclusive choice. It starts on FLOW.

**Order of the toolbar.** Tree / Diagram sat at the end of the row, after the scope, the branches and the depth, although it answers the second question a reader asks: which Type, then which of its two views, and only then how much of it to show. The view toggle is moved into the Type group right after it, and the controls that narrow what is shown are appended after that, so the row reads left to right in the order the choices are made.

**The dump reaches the runs that step by themselves.** Visual, Rec and Flow drive the debugger in a loop of their own, and `sdeDebugEvent` returns early while `series` is set, so the picture that carries `ending.dumped` - the one `apply` turns into the header line and the Dump section for F5 - never reached them. Each of their step answers already carries `dumped`, because `advance` and `runTo` ask ST22 through `end(error)` when the step throws; the runs dropped it with a bare `if(r.ended)return`. A `stepEnded(r)` now stands at each of those six places and calls the same `endedNotice`/`drawDump` the F5 path uses. What this does not explain is the `Cannot read properties of undefined (reading 'some')` seen in the header of a recorded run that dumped at its fourth step: every `.some` in the page has a defined receiver on the paths that run there, and the webview's own console has to name the line. The likeliest remaining candidate is Mermaid, called from `showFlow()` in the run's tail with a chart that a run cut short may leave without a single node.

**One shape for a dump, or the button disappears.** The step answer carries the dump as the debugger keeps it - `id`, `error`, `text`, `where`, and `page`, the whole of SAP's dump page - while `picture()` sends the same dump with `hasPage` in place of that page, because the page is too big to ride in something the window polls. `drawDump` is written for the picture's shape, so a dump handed to it straight from a step had no `hasPage`: the *Whole dump* button hid itself, and the one way into the dump overlay was gone - which is what a reader notices, because that overlay is the dump window that has always worked. `stepEnded` now maps the step's dumps to the picture's shape before passing them on, and the whole page stops travelling with the step.

**Who asked for the editor.** `attachDebugger` watches the debugger and, on every picture with a stop, calls `followStoppedFrame`, which ends in `showTextDocument` - the behaviour a debugger is expected to have when the reader is debugging in the editor. The debugger is one object with many windows, though, so the same watch fires when the stop was made from the VERTEX window, where the source pane already shows the line: every step then opened a VS Code tab over the window. The picture does not say who stepped, and threading that through would mean every caller declaring itself; what the editor can see for itself is whether it is in use, and `followNow` now returns unless a `vertex-sap` editor is visible. The decoration is left alone - `showStoppedLine` only marks editors that already exist. A tab open behind the VERTEX window is not visible and is therefore not followed either, which is the same answer for the same reason. Nothing in the suite covers the stop-follow, so this is reasoned, not proven.

**The dump rows, and what Check ST22 may say.** Only *Whole dump* opened a dump page, and it took `list.filter(hasPage)[0]` - with two dumps the second had no way in. The row carries the click now; the include link inside it keeps its own, which is why the handler steps aside for a `BUTTON` target. And `collectDumps` remembers every id it has handed over, so a second *Check ST22* on the same dump answers nothing - correct, but it was reported as "No new short dump for this user since the run started" above a section that was showing one. When the ending already carries a dump, the line now says nothing is new rather than that nothing is there.

**Whoever drives the debugger owns the navigation.** The first cut gated the stop-follow on a visible `vertex-sap` editor, which is a guess at the reader's intent rather than a fact: an editor tab behind the VERTEX window would then stop being followed although the reader is debugging in it. The fact available is who is stepping. The debugger carries a `driver`, which the VERTEX window sets to `window` on every debug call it makes, the docked panel and the editor's F5-F8 set to `editor`, and the assistant does not touch - it has no window of its own, and running from it already behaved. `followNow` returns unless the driver is the editor; `showStoppedLine` is untouched, because marking an editor that already shows the line is not navigation. This reverses the 0.7.9 decision only where it was wrong: there the editor had to follow a step into a method, and from the editor it still does.

**A bare name is not a request for the VERTEX window.** `objectRequest` recognises a lone object name and answers without a model; inside a Tools window that answer set `navigation` to `action:"view"`, so typing `ZVERTEX_DEBUG_LAB` replaced the window with a read-only View source. The model, meanwhile, is told in `object-tools.js` that source opens in an ordinary editor tab and never in a Tools window. Two paths, one question, two answers; the direct one now calls `open_sap_object` like the other, and `navigation` from it is always null.

**One tab for a run.** `followNow` opened the stopped source with `preview: false`, which is right for something the reader asked for and wrong for a stop: a run that walks through a dozen classes then leaves a dozen permanent tabs. It opens in the preview tab now, so each stop takes the place of the last. A document the reader has already opened keeps its own tab, because VS Code does not demote an open editor to preview - which is the behaviour wanted on both sides.

**The run's own F8 has to see the run's own breakpoints.** A Visual, Rec or Flow run is a loop of F5 steps - that is the whole point of it - and it ended itself on `p.stopped.breakpoint`, which is SAP's answer to "did you stop the program at a breakpoint". Stepping onto the line of one is not that: SAP was asked for a step, it made a step, and `arrive` only fills `breakpoint` when `reachedBreakpoints` names it or when its fallback matches `b.adt` with the top frame. A breakpoint in the calling program, while the run steps through a called class, satisfies neither reliably, so the run walked over it and reported the program ended. `stopsHere(p)` now answers the question the run is actually asking: SAP's flag, or an active, non-log breakpoint of this window's own list on the frame the program stands in. The list was already there and already trusted - `predicted()` refuses to predict onto a line carrying a point - so this is the same knowledge used at the other end of the step. What it does not do is explain why SAP did not flag it; that is still the scope question below, and this makes the run correct whatever the answer.

**Two sets of breakpoints, one of them filled.** `sync()` sends the user's points to SAP in scope `external`, which is what makes a run stop in the first place; the program being debugged has its own set, scope `debugger`, and that one was filled only by `rescope()` - when a point was added, removed or switched - and by `runTo`, which needs it for the loop points it invents. Attach filled nothing. So a session that never touched a breakpoint and never passed a loop gave SAP a Continue with an empty set, and the program ran to its end past every point on screen. `attach` now calls `scoped(breakpoints)` right after `debuggerAttach`, which is where ADT does it. `scoped` also answers what it could not place: it returns the placed points as before with a `missing` list beside them, because a breakpoint absent from the session's set stops nothing and only the caller can say so. That message goes to the assistant as a problem and to the window as the stop's `problem`, which the header line already shows. The Visual run no longer depends on any of this - it stops at its own points by itself - but Continue given to SAP, and every step the assistant makes, do.

**What a prediction rests on.** A Visual run sends SAP a step with the line it expects and does not read the stack back; `arrive` fabricates the stop from that line. The whole mechanism rests on one check - the line changes - and a run's own log showed where that check is absent: `line 29 -> predicted 29` four times in a row, because ACE splits a chained `WRITE` into one statement per operand and they all carry line 29. Five of the last six moves were made blind, and the move that finally asked SAP was answered with an ending. `predicted()` now returns null when the next statement shares the current line, and the `leave` branch is gone altogether: the end of a unit is where the frame changes, it happens once per call rather than once per statement, and a frame the window invents is the one thing it cannot verify. `advance` keeps its `expect.leave` handling - the contract is unchanged - but the window no longer produces it. Beyond that, a `Predict` toggle holds both map-driven shortcuts - the predicted line and the loop passed in one go - and is on by default, which is what the run did before it existed. It was first called Exact and named the result rather than the act; it was also first tied to Rec, which was wrong: the three toggles are three questions and none of them is how the run steps - Rec makes Continue a run of F5 steps and keeps the stops, Visual draws or does not draw, Exact alone decides whether a step is asked about or worked out. Flow never sent `expect` and is untouched.

**The record as statements.** The flow chart had two readings, classes and routines, both built from `flow.edges` - which is a map of calls, not of execution. The record already holds what a statement-level reading needs: `flow.timeline` keeps the full stack of every stop, and the window has the statement maps and the sources it read. `stepFlow()` walks the timeline and keys a node by procedure plus include and line, so the second pass over a line finds the node that is already there and only raises its count; edges are keyed by the pair, so a loop's back edge carries the number of iterations and a method called twice has one block. The text is the source line where the window read that source, the map's keyword and target where it did not, and the place as a last resort - a run that drew nothing never asked for a source. Mermaid gets `flowchart LR` and a subgraph per procedure. The mark and the click are per statement in this mode: `markNow` takes the stop from the timeline rather than the unit it was passed, and a click opens that exact line. `shapeOf` counts the timeline only in this mode, so the other two are not re-rendered on every stop. This is the shape the shared Value Origin renderer wants - nodes and edges with a location each - so wiring that in later replaces the drawing, not the model.

**One algorithm, or two pictures that do not read alike.** The first Statements drawing was built from the timeline as a path: an edge from each stop to the next, a subgraph per routine. It is a faithful trace and it reads as spaghetti - long arcs across the whole picture - and, worse, it is not what Value Origin FLOW does. That one is a containment tree: program, class, routine, then the statements nested in their blocks, with the line on the edge and a separate edge for a call. Two algorithms for one kind of picture is the thing this project keeps out, so the drawing was rebuilt that way. The nesting comes from the statement map through `blocksOf`, which opens on IF/CASE/LOOP/DO/WHILE/TRY, lets WHEN/ELSE/ELSEIF/CATCH close the branch before them and own what follows, and pops both at END* - the reading Logic and Value Origin already share. A statement's parent is the nearest block around it that the run also stood on, and the routine itself when there is none. Calls are taken from the stack growing between two stops.

**The depth control, and the stylesheet that had never reached this window.** Every node of the Statements drawing carries a depth - 0 for the program, 1 for a class, 2 for a routine, and one below its container for a statement, keeping the shallowest where a statement is reached from two places, since it is one node. The drawing filters by it and `shapeOf` counts it, so moving the slider redraws. Collapse all is depth 2 - the routines - and Expand all is the deepest statement the record holds; both set the same number, which is why they cannot disagree with the slider. The toggle itself had a problem of its own: `vertex-controls.css` holds the two canonical toggles for every VERTEX view, and this page had never used it - it is handed to the webview as a string and cannot link a stylesheet. It now asks the host for it by name, the way it already asks for the diagram library; `asset()` in extension.js serves both from one table instead of answering only for mermaid.

**Zoom as one control.** The flow pane's minus/plus pair stepped by a factor and said the percentage between them; the diagrams elsewhere use a slider, and it is better for the same reason the depth slider is: the control shows its own state and reaches any value in one move. `zoomTo` stays the single place the zoom is set and now writes the slider as well, so Fit, Ctrl+wheel and the slider cannot disagree.

**A stadium is not a cylinder.** The Statements drawing gave a routine Mermaid's stadium shape and wrote it `([text)]`. The closing pair of a stadium is `])`; `)]` closes a cylinder, so Mermaid parsed the node open and failed on the next token - `Expecting 'STADIUMEND' ... got 'CYLINDEREND'` - and the pane showed its own error picture instead of the flow. One character. **And the player moved out of the diagram.** Its controls had been built into the flow bar because that is where the chart is, but replaying a stop moves the stack, the variables and the source too: it belongs to the window. It is now a bar above the sections, hidden until there is something to replay, and the flow bar keeps only what draws the diagram.

**The toolbar, grouped, and Predict turned off.** The header had grown into one row of twelve buttons in no order: starting the program, stepping and the run's options stood side by side, and the explain line - which is the Log's newest row - sat among them. Three groups now, split by a rule, in the order the questions are asked: the program, the step, the run. The explain line and the statistics moved to a line of their own under the toolbar. And `Predict` starts off: a worked-out line is faster and can be wrong, an asked one is neither, so the fast reading is what has to be switched on rather than what has to be noticed.

**The flow script leaves the page it grew in.** Value Origin's drawing lived in one IIFE inside the generated HTML, with six values interpolated into it by the template: the title, the BSE caption and tree, `maxStack` four times and `maxLevel`. A script written by a template cannot be a file, so those moved into `#mermaid-data`, the blob the script already reads, and the IIFE moved to `org.vertex.abap.ui/resources/vertex-flow.js` - beside the pages, where `copy-pages` already carries .js and .css into the packaged extension. The webview loads it by `asWebviewUri`; `html()` with no `flowSource` reads the same file and inlines it, which is what the tests get and what any host without a file server would. Two tests had been reading the maxima out of the script's text (`depthMax=()=>formulaAxis()?6:2`) and now read them from the graph, which is where they are stated. Everything else about the page is unchanged, and the point of the move is the next step: the debug window draws its record with this file rather than a second drawing of its own.

**The view moves with the script.** Sharing the behaviour was half of it: the markup the behaviour needs - the workspace, the three panes, the Tree / Diagram toggle and the whole diagram toolbar - still lived in the Value Origin template, so a second window drawing a flow would have had to copy it. It is built by the script now, into whatever element with `id="bse-workspace"` the host provides, and only when that element is still empty, so a host that wants its own arrangement keeps it. What belongs to the host is the content of the panes, and that stays in the host's own HTML: the analysis puts its execution flow and its formula derivation into `<template data-flow-pane="tree|formula">`, which the script lifts into the panes it builds. That keeps the fragments as HTML in the page rather than as escaped strings inside a JSON blob - better for reading, and it is what the tests read too. Seven tests that had been asserting the toolbar's markup out of the page now assert it out of the script, which is where it is written; four that bounded a pane by the next pane's div now bound it by the template. The suite is back to the seven failures it had before any of this.

**What a template was escaping.** The flow script had lived inside a JS template literal, so everything in it was written for one more round of escaping: `join('\n')` was the way to put a real newline into the generated page, and `/scale\(([^)]+)\)/` the way to write that regex. As a file, those are a literal backslash-n and a regex matching a literal backslash. Mermaid was therefore given the whole diagram on one line - `flowchart LR
bseroot["..."]` - and answered with a parse error, which is what the Value Origin pane showed instead of the drawing. Three characters. Worth saying out loud because it is the standing cost of moving code out of a template: the escaping that was right inside it is wrong outside, and nothing but running the page says so.

**The expensive half of a stop.** A recorded stop is a line and a stack, which the run already has; what costs is `snapshot()` - `scopes` plus a `children` call per group - and it ran on every routine boundary whenever Rec was on. Those are two different wishes: the shape of a run, and the values in it. `Values` now holds the second, off by default, and guards the three places a snapshot is taken: the Visual run's `snapDue`, the Flow run's, and `recordStop` for stops made by hand. The player already says `No values recorded here` where there is no snapshot, so nothing else had to change.

**Three positions, and what Visual was left with.** Recording the steps and recording the values are one question with three answers, not two switches, so they are one `vertex-segment-toggle`: No record, Rec steps, Steps & values. Putting it in showed what Rec had quietly taken from Visual: `seen()` drew a stop only when the run was *not* recording, so switching the record on turned the drawing off and the two controls were arguing about one action. They are now what their names say - `s.rec` keeps the stop, `s.draw` draws it, either one is a reason to step rather than let SAP run on, and both together is a run that is watched and kept. The window also loads `vertex-controls.css` at startup now rather than when a diagram first needs it, since the record control in the toolbar is one of the shared toggles.

**And then Visual went too.** Splitting drawing from recording made the question obvious: what is a run that steps and shows nothing for? The window is open, the source pane is there, and a step costs the same whether the line moves or not - drawing is this side of the wire. So the toggle is gone and `s.draw` is simply true; Flow draws for the same reason. Continue is now SAP's own when nothing is being recorded and a run of F5 steps when something is, which is one control for one behaviour. The user-facing strings lost the word Visual with it: a run is a run.

**The record meets the shared view.** The debug window now gives `vertex-flow.js` what the analysis gives it: an empty `#bse-workspace`, a `#mermaid-data` blob and `body.flow-mode`. The blob is built by `sharedFlowGraph()` from the same `stepFlow()` model as before - a node per statement of a procedure with its text, source, line and depth, edges for containment and for calls - renamed into the shape the view reads (`bseFlow`, `operation`, `stack`, and the first node as `bseroot`). The window's own Depth, Collapse all and zoom are hidden in that mode because the view brings its own; its source links are caught here and shown in this window's source pane. The view's CSS travelled with it: the workspace, panes, diagram viewport and fullscreen rules left the Value Origin page and are injected by the script, so a window that draws a flow needs nothing of the analysis page's stylesheet. The rough edge noted here a moment ago - a redraw re-running the whole file and re-attaching its listeners - is closed: the view exposes `window.vertexFlow.redraw(graph)`, which replaces the graph, resets the expansion to the root, re-reads the depth maximum and draws the tree and the diagram again. The file runs once per window; after that a record that has grown is new data, not a new view. The host still falls back to loading the file when nothing has built the view yet, which is what happens the first time.

**Why the computed picture read better than the real one.** With both drawn by the same view, the difference left was the graph, and it was mine. The analysis chains by calls: the program leads to the routine it started in, a routine to its statements, a statement to the routine it called; its class nodes exist but nothing points at them, so they never reach the drawing. The record instead hung every class off the root and every routine off its class, which is a fan from one point and a long arc for every call - true, and unreadable. The class level is gone from the record graph, the root leads to the entry routine alone, and a node's depth is now the call depth of the stop, counted from the shallowest stack in the record so the hidden caller frames do not shift everything down. What is drawn is the same shape the analysis draws, built from what the program did rather than from what ACE derived.

**A chain is not a tree.** Reading the principle as sequence alone, the statements of a routine were joined one to the next - and the tree drew exactly what that says: every statement a child of the one before it, the routine sinking a level per line. Sequence and nesting are two different relations and only one of them can be the edge. The edge is nesting: a statement hangs in the nearest block of its routine the run also stood on, statements of a block are siblings, and their order is the order they first ran - which is where the sequence lives, without claiming to be depth. Depth is the call stack and the blocks inside it, nothing else. Two more things went with it: the program node above the entry routine, which repeated its own name and gave the picture two tops where it needs one, and the method label without its class, which named nothing on its own.

**A tree with no indentation is not a flat tree.** The record's flow tree read as one flat list in the debug window - caller and callee on the same line - and the graph was not at fault: the nesting was in the DOM and invisible, because `.execution-children`, `.flow-toggle` and the `</>` link's rules had stayed in the analysis page's stylesheet when the view moved out. Half a view travelled. Nineteen rules - the branches, their markers, the children's indent and rule, the inputs and conditions, the source link - now travel with the script and are gone from the page, which keeps only what is its own. This is the second time the same mistake has shown up in one day: moving behaviour without the markup, then the markup without the style. What makes a view a view is all three.

**The window stops drawing.** Classes and Methods were still the window's own Mermaid, which is why the Tree toggle vanished when you left Statements: the toggle belongs to the shared view, and the shared view only drew one of the three readings. All three now build a graph in the same shape - `callGraph(byOwner)` folds the timeline by owner or by routine, `stepFlow()` by statement - and the view draws it. With that, `flowText`, the SVG marker, the zoom, the fit, the wheel handler, the click-on-node handler and `#flowsvg` itself are gone: about a hundred lines whose whole job the view already does. The one thing the view could not do was say where the program stands, which a player needs, so it gained `mark(id)`: it tags the tree row and the diagram node, repaints after each render, and the window calls it with the stop the slider is on. `darkPane()` reads the pane instead of the canvas that no longer exists.

**What the debugger does not say, and the window can work out.** ADT's stack gives a program, an include and a line; there is no position within the line, so `ULINE. lo_log->display( ).` is line 30 twice over. The window had the answer anyway - `placeOf` reads the statement map for the line and `spots` remembers which of its statements the run is standing on, moved along by each step - but the timeline kept only the line, so the record lost it and every statement of such a line folded into one node labelled with the whole line. `record()` now resolves the statement as it writes the stop and keeps its ordinal; the node key carries it, and the text is cut by `nthStatement`, which splits on periods outside literals. The inference is named as an inference in the comment, because it is one: no map, or a stop arrived at by breakpoint rather than by stepping, and the ordinal is 0 - the old behaviour, which is the right fallback.

**The last of the page's own script.** Fit did nothing in the debug window because the zoom, the fit, the full screen and the panning had stayed in the analysis page's second inline script - the view's toolbar was there, the behaviour behind it was not. It moved into the view, where the toolbar already was; the page keeps only its own business, which is initialising Mermaid and telling the view it is ready. Two readability fixes went with it: inline declarations are shown as the name they declare, since `DATA( )` around a name says only that the name is new and the statement's point is the assignment; and a routine reached a second time is marked and left closed, because repeating its whole body wherever it is called turns one routine into as many subtrees as it has callers. `renderFlowTree` clears the set of already-shown routines before each draw, so the repeat is per drawing, not per session.

**Four small ones, three of them the same mistake.** The view came to the debug window with its own styling, but the window gave it nowhere to live: the panes had `height:auto`, so the diagram's viewport grew with its content, `fit()` divided by a height that was never smaller than the drawing, and Fit did nothing while the pane itself ran past the section. The panes are a flex column filling the section now, which is what the analysis page's `calc(100vh - 125px)` was doing there. Full screen had the same shape of problem - the pane went `position:fixed` at `z-index:7`, under the window's own toolbar - and the source link had the third: the click was caught on the bubble, after the view's own handlers, so it is taken in the capturing phase now. The fourth is plain: a stop was named by the generated include, `ZCL_MOD_CUSTOMS====CM001:13`, where `unitOf` already knows it is `ZCL_MOD_CUSTOMS=>APPLY`. The statistics also dropped the window's share of a step: it was `total - sap - stack - other`, a remainder standing in for everything unmeasured, and it answered no question anyone asks.

**A breakpoint that was refused, and a tab that remembered too much.** A point set in the editor stopped working, the run reached the end of the program, and the answer came from SAP itself: `Cannot create a breakpoint at this position`. The editor had the statement on line 17, the active version on line 16 - one blank line of difference - so the point was set where no statement is. `setBreakpoint` now reads the active source on refusal and quotes that line, so the mismatch is visible rather than inferred. The deeper question was why the tab disagreed at all: `fileEntry` restores a tab from `workspaceState`, where its text was stored when it was opened, and only read SAP when that text was missing. A tab therefore survived a reload showing the source as it was, however old - and old source in a SAP tab is not a stale view, it is wrong line numbers for every breakpoint and every stop. Keys restored from a previous window are now read again the first time they are asked for; a system that cannot be reached keeps the copy and says so rather than failing to open the tab.

**The queue that was not one.** `ask()` pushed a resolver onto `waiting` and sent the request immediately; `sdeReady` shifted the first resolver and gave it whatever had arrived. That is only correct while one request is outstanding, because the host answers a debug command, a source read and an asset through different code paths and all of them come back as the same nameless `result` message. The window began asking for the record's sources and for `vertex-flow.js` at once, the replies crossed, and a source read was handed the script - hence `Unexpected token '/', "/* The Val"... is not valid JSON`, a player that no longer moved the source, and a diagram with no view. Sending one request at a time and queueing the rest makes the turn mean what it claimed to mean. The three asset loaders - Mermaid, the shared stylesheet, the flow view - stopped pushing onto `waiting` behind the queue's back and go through `ask(send, raw)` like everything else.

**Two sources, one of them hidden.** The window draws a replayed stop into its own source pane, and in the docked panel that pane is hidden by the rule that the real source lives in the standard editor - so the slider moved a view nobody sees. The editor only ever moved for a live stop, through `followStoppedFrame`, which the player never reaches. `revealFrame(frame)` now offers that same path to a caller who has a place rather than a stop: it builds a one-frame picture and goes through `followStoppedFrame`, so a replayed stop opens exactly as a live one does - the same tab, group and preview rules, and the same refusal to drag the editor when the debugging is driven from a VERTEX window, which has its own pane and needs no help.

**A caption that asserted what it had not looked at.** The stack hides the frames below the object, which is right - the depth should count from the code being read - and announced it with `N caller frames hidden (test frame, screen)`. Neither half held: the parenthesis listed two possibilities as if both were there, and a report started from SE38 has a screen below it and no test frame at all; the plural was wrong for one frame; and the row was the control, a sentence in a table that nobody would think to click. It names the frames it leaves out now - their actual programs - and it is a button in the Stack heading, present only when something was left out.

**BSE over a record, and what a record can honestly answer.** The scope is a filter over data already in the window: `valueTrail()` walks the timeline, finds the chosen value in the snapshots a `Steps & values` run kept at each routine boundary, and marks the stops where it differs from the one before. `sharedFlowGraph` marks those nodes and every routine on their stack as `bse`, which is the flag the shared view's Full / BSE toggle already reads - so switching scope is a redraw, not a request. The limits are structural and are reported rather than papered over: values exist only at routine boundaries, so the answer is the routine that changed the value and not the statement; a structure's snapshot holds its shape and no value, so nothing can be said about its fields; and a record made without values has nothing to filter by at all. Statement-level precision would need either the value read at every stop - a property of a future run, one read instead of all scopes - or ACE's origin index, which is a request to the system; neither is done here, and the message says which is missing.

**Points instead of steps.** Following a value by stepping and reading it at every stop is affordable but blunt: the run pays for every statement, and prediction - the thing that makes stepping cheap - guesses where it cannot be checked. The analysis already knows which statements can change a value; that is what it is for. So the window asks it once, before the run, and sets a breakpoint at each place it names. SAP then decides when to stop, every stop is real, and the cost is the number of places rather than the number of statements - tens instead of a hundred and thirty in the demo. `originPoints` runs the same analysis the editor command runs - the callback is named now rather than passed anonymously into the view - and returns object, line and statement for every included row of `graph.flow`; the window turns each into a breakpoint by name through a new `setAt`, because these places are in classes it never read as a source. Two honesty rules came with it: a place SAP refuses is reported with its reason rather than silently skipped, and a point of the slice where the value turns out unchanged stays in the picture, marked - `a = a + b` with `b = 0` is a fact about the data, while many such points are a fact about the slice.

**What a record cannot see about a value.** The first BSE scope over a record marked the stops where the chosen value differed from the stop before - and found two nodes where the dedicated analysis finds many. The reason is the one thing a record has no way of knowing: a value travels under other names. `lv_scenario` arrives in the callee as `IV_SCENARIO`, a calculation puts it into `cs_context-amount`, a RETURNING brings something back; at every one of those places the name differs and the recorded value of the original has not changed at all. Following that is exactly what the backward slice does, so the slice is now what BSE shows, and each of its places carries the names the analysis says belong to it - `changed` and its `dependencies` - which is what the run reads when it stops there. The recorded values keep their job: they say what the value became at each place, not which places there are.

**One algorithm for the flow.** Value origin's FLOW and the debugger's flow path had grown apart: the debugger's was built from the statements and the calls in them, Value origin's from the statements grouped by scope with calls linked afterwards, and the second read as glitchy next to the first. The builder moved out of the debugger page into `vertex-flow-graph.js`, a module both load (the page as an asset, Value origin as a required file); the debugger's `staticFlowGraph` only hands it its rows and says what it left out. Value origin hands it the same rows from `pathRows`/`siteRows` and has no builder of its own any more - a graph without them is an error, not a fallback to the old drawing. A node's link carries `origin:<source>|<OWNER->ROUTINE>` in both, so opening it is one path too.

**One analysis, three readings of it.** After the flow, the Formula and a new Expression went the same way: `value-origin-formula.js` builds the derivation (a definition once, where it is first met), `value-origin-formula-html.js` draws its panes, and the backend hands the debugger the same two panes, so Formula is no longer empty there. Expression is substitution over that tree. Two things it taught: the analysis files the same statement once per use under different ids, so a definition is known by source, line, text and what it reads; and the model already links a read to the write before it - what it cannot know is the order of definitions a loop over *data* makes (the modifiers of a pipeline), so those are ordered by the loaded `ZLOG_PIPELINE` scenario, and said to be unordered without it. A step that reads the value before it twice (`x = x + x * p`) made the substituted formula grow with every step (5,000 characters for five); writing the share as one plus the share keeps it linear, and what is still read twice stays a named step. The assistant's context follows the screen the reader has, not a fixed dump. Released as 0.8.0 (0.7.15 never was).


## 2026-10-05 — A separate client BSE command for comparison

The ACE command stays available while `vertex.valueOriginLinter` reads source through standard ADT and builds its input locally with pinned @abaplint/core 2.120.68. Parsing runs in a cancellable worker. The adapter supplies the existing model contract, including per-statement read/write facts, so the same FLOW and Formula view can compare both inputs. No origin-index request or SAP activation is needed for the client command. Source buffers may contain unsaved edits, so comparisons must use the same saved, activated source. Unknown statements are reported and aliases and dynamic dispatch remain experimental boundaries. The library is bundled, credited in Acknowledgements, and its MIT licence is included.

VS Code 0.8.1 was packaged with both abap-adt-api and @abaplint/core and their licences. The packaging gate now requires both libraries and the client-analysis worker, reads every ZIP entry, and passes the packaged Scheme navigation check before promoting the candidate to the final VSIX.


### BSE log outside the technical sections

The traversal log was hidden behind the technical-section toggle. It is now a visible Analysis log section above FLOW in both engines. The copied report includes source closure, all dependency nodes and edges, traversal, warnings, Formula and Expression diagnostics, ADT/index requests and local parser durations. The first local parse includes worker and grammar startup. This exposes evidence for comparing the reported missing Formula/Expression and slower linter path; no parity or performance fix is claimed yet.


## 2026-10-05 — Load what the client slice needs

The paired logs showed 42.968 s of ADT reads and 1.813 s of parsing versus 5.418 s of ACE closure loading. The client had fetched three empty extra includes per class through the editing API, which also read both source versions and repeated object resolution. A dedicated per-analysis reader now caches metadata and reads one active source version. The demand collector rebuilds the slice as it discovers references in reached statements and needed signatures; local definitions/implementations are fetched for unresolved local calls and macros for unsupported statements in reached routines. Normal global classes no longer fetch extras. Tests cover unused-method dependencies, interface dispatch with Formula/Expression, and deferred ADT includes. This does not claim SAP speed parity until another live log measures it.

VS Code 0.8.2 was packaged successfully with both external libraries and licences. The package gate verified archive entries and passed the packaged Scheme navigation check. The final focused test run passed all 39 tests.


VS Code: Copy log now includes the complete FLOW hierarchy and points, Formula derivation tree and graph, and Expression text, substitution steps and source bindings as JSON for both ACE and ADT + abaplint. The export uses the current analysis and loaded configuration, independently of the visual depth slider.

VS Code 0.8.1 comparison build: the FLOW script is embedded in the page; the full JSON export remains in Copy log without duplicating the dump in the visible page. This change addresses the reported empty analysis pane; live VS Code rendering still needs confirmation.


## 2026-10-05 — Move Tools analysis to ADT source

VS Code routes Metrics, class/package UML, Scheme, Calls and the debugger statement map to standard ADT source reads and bundled abaplint. The existing Value Origin command and debugger dependency/variable analysis now use the client engine. Package enumeration uses ADT node contents. Tools obtains its analysis capability information locally. Versions, selector, tables, transport review/prepare and dumps retain their VERTEX backend routes.

This is an experimental migration: local Halstead token classification may differ from ACE; Scheme shows structured syntax rather than the ACE execution diagram; Calls marks unresolved receivers and bounds source expansion to eight levels/100 objects. Unknown dynamic targets, macros and unsupported statements are not claimed resolved. Source-coordinate handling uses assembled class rows. Live SAP operation with the backend physically removed remains to be confirmed.

The 0.8.1 VSIX was rebuilt with both libraries, the frontend-analysis module and licences. JavaScript syntax checks passed; the packaging gate passed its packaged Scheme navigation check. No live SAP/backend-removal test has been performed.

Debugger migration follow-up (0.8.1): generated class-pool statement requests resolve to the class's standard ADT main source. Statement maps mark ADT source coordinates so the debugger does not apply ACE method-include offsets. Class BSE ranges use the requested assembled-source rows and respect the upper breakpoint. Unknown statements, macros, SQL and control transfers require a SAP stack read instead of a predicted plain step. Explicit CALL/PERFORM/SUBMIT statements are treated as calls.

VS Code 0.8.1 debugger path fix: analysis between breakpoints without a selected variable now discovers source dependencies through calls in the entry range and reached routine bodies. The previous value-demand loader stopped at the entry program because the backward slice had no variable. The call traversal is conservative for unresolved receivers and retains the source limit; live SAP results remain to be confirmed.

VS Code 0.8.1 debugger path closure now follows all resolved call sites in a statement, including NEW class( )->run( ) chains and nested calls. Previously its singular call field could stop source discovery at the constructor and leave deeper routine bodies unloaded.

VS Code 0.8.1 variable declarations now load referenced receiver sources and resolved method parameter types without requiring a selected value. This restores inference of inline result structures from RETURNING signatures, such as LS_RESULT from RUN, and their component expansion before execution.

VS Code 0.8.1: declared-variable reading before execution uses editor source and preserves a local declaration fallback if type loading fails. Dependency warnings are propagated to the pane; a failed read displays its error instead of leaving an empty variable area. Execution-path analysis still requires active source. The local demo returns seven declarations and infers LS_RESULT's RETURNING type; the reported live failure has not yet been reproduced.

VS Code 0.8.1: choosing a variable after drawing a breakpoint path now refreshes its FLOW rows, call sites, Formula and Expression from the resulting slice while retaining path bounds. The old path had no included rows and could therefore display an empty BSE despite reported slice points.

Visual Debug 0.8.1 now exposes Analysis log / Copy analysis log above Variables. It copies the latest breakpoint path and value slice separately, with request and UI bounds, source closure, timings/warnings, dependency nodes/edges, FLOW, Formula tree and Expression. This provides evidence for incomplete BSE after reload; the cause is not yet established.

Metrics presentation: fractional numbers are displayed to two decimal places in unit rows, totals and the summary bar; integer counts remain integers. Raw analysis values and numeric sorting retain full precision.

VS Code 0.8.1: local diagram Parts use ADT + abaplint; Diff checks actual backend availability. Visual Debug exposes a Log button and retains the complete analysis response for copying.


VS Code 0.8.1: Logic diagram now ports ACE analyze/build_scheme, operation folding, branch joins, loop/TRY frames and source links. Local Parts restore short method names, section groups and visibility icons. Nine diagram cases and seven Tools/theme checks pass; the full suite reports 328/346 passing, with 18 failures requiring separate investigation. Live ACE equivalence is not yet verified.


Verification follow-up: 52 focused diagram, Tools and Visual Debug checks pass. One test fixture lacked the DOM helper required by the new Log button and was corrected. The remaining 17 full-suite failures concern contracts already present in HEAD (Formula codeFlow and Versions casing/DOM mocks); they remain unresolved.


VS Code 0.8.1: fixed Program Parts routine kinds. FORM, FUNCTION and MODULE retain their types; report events retain their names, with implicit START-OF-SELECTION instead of synthetic GLOBAL. Class methods remain METHOD. GET PARAMETER is not classified as an event.


VS Code 0.8.1: local Tools analysis updates progress every two seconds during ADT reads and worker parsing, with the current object/stage, source count and elapsed time. Parser warnings are collapsed into a bounded details panel instead of filling the diagram area. Progress messages follow the active request and do not consume its final answer. Fourteen focused checks passed.


VS Code 0.8.1: Calls analysis defaults to depth 3, matching the UI and ACE. Explicit depths follow the UI range 1–99 instead of silently capping at 8. An orientation regression check confirms setDirection redraws existing Mermaid without requesting analysis. Depth edits still apply on change (including field blur); clicking orientation after editing Depth can therefore coincide with the depth request.


VS Code 0.8.1: frontend Tools reuse parsed ADT sources across analysis requests and depth changes. Only newly reached objects are read/parsed; all-cache-hit requests start no parser worker. Concurrent requests share the same in-flight read. Cache isolation follows repository URL/client/user/system; limits are 100 objects, 32 MiB source text and five minutes since loading. Save/activate attempts through VERTEX invalidate the repository cache, including partial failures. External SAP changes can remain cached until expiry or extension reload. Request indexes receive cloned data, preserving cache immutability. Seventeen focused checks passed, including depth 1→2, repeated depth, invalidation and repository isolation.


VS Code 0.8.1: default Calls depth is now 2 at the user's request. Depth input applies after a 250 ms debounce; newer Calls requests cancel the active traversal and replace queued older Calls requests. Cancellation interrupts parser work, stops waiting for the current ADT read and discards late results (the already sent HTTP read may still finish). Successfully loaded cache entries remain reusable. Displayed calls are limited by call-edge depth rather than source-loading depth. Classes/Methods honor aggregate/per-routine labels, structural root-to-entry links restore program connectivity, and unreachable foreign routines are omitted. Responses carry their depth so stale deeper diagrams cannot replace a shallower view.


VS Code 0.8.1 depth correction: Calls now walks reached routines breadth-first instead of recursively loading every declared source dependency. The boundary callee is a leaf (depth limit); its source is not loaded and its body is not walked. Program roots are actual report events, or the explicitly selected unit, rather than all FORMs as independent starts. Tests confirm Depth 1 reads only the report, Depth 2 adds only its first called class, a deeper class remains unread, and unused FORMs cannot pull in foreign objects. This avoids deeper work rather than merely filtering its diagram afterward.


VS Code 0.8.1 depth semantics correction: program root is 0; entry into an event or selected routine is 1; every subsequent call adds one. The traversal now starts at level 1 and stops before inspecting calls of a terminal block. Displayed entry edges have the same cost; Classes view accounts for the entry hidden by aggregation. Added explicit PERFORM, CALL FUNCTION and classic CALL METHOD handling in Calls. A static external function is read through standard ADT FUNC only when its body falls within the traversal depth. Tests cover event→FORM→FORM, FORM→function, and methods across objects; terminal targets are not read or walked.


### 2026-10-06 — ACE source comparison
Compared zcl_vx_ace_keywords and zcl_vx_ace_metrics against frontend metrics. Replaced statement-class-name classification with matcher grammar traversal; include routine header/closer. 15 focused tests passed. Calls renderer and SAP scanner equivalence remain documented gaps.

### 2026-10-06 — Calls rendering audit
Compared zcl_vx_ace_flow build_steps_flow labels/styles. Ported event/method/form/constr/enh/func palette and rounded nodes, removed HTML entity escaping and fabricated root, avoided depth recomputation on aggregated nodes. Added source-contract regression assertions.

### 2026-10-06 — Full regression audit
Fixed real FLOW parameter-transfer loss through value-origin-points and shared vertex-flow-graph. Corrected frontend empty-unit filtering and UML scope/order/requested-class filtering from ACE source. Repaired fixture codeFlow/DOM/DI contracts without suppressing production errors. Full suite 365/365; palette check 1/1. Live scanner/dispatch parity remains explicitly unverified.

### 2026-10-06 — Constructor-first Calls
Frontend traversal roots CLAS at CONSTRUCTOR unless start/unit is explicit. Metrics UI forwards METH Parts choices and initializes the constructor start; missing constructor prompts selection. Two regression scenarios cover frontend and UI contracts.

### 2026-10-06 — Context menu routing
Added tools-context command registrations with explicit object/URI precedence and source declaration fallback. Registered submenu in editor/explorer/webview menus; Tools bridge publishes current object through data-vscode-context, including nested pages. Eleven focused checks passed.

### 2026-10-06 — Calls context regression
The new menu passed action calls although VertexObjects expects flow, aborting initial Tools script before fields populated. Map command to flow and normalize using the shared model in the host; add program Calls and unsupported UML regression coverage.

### 2026-10-06 — Shared call enumeration
Export callsIn from value-origin-model and use it for all statement expressions in frontend Calls, retaining classic FORM/function/method fallbacks without duplicate calls. Regression covers NEW zcl_calc_facade()->run(), nested scenario() and assigned deeper(), with boundary-source loading checks.

### 2026-10-06 — Single call engine
Added call-graph.js with classic/functional enumeration, shared model resolver, async walker, entry ranges, depth and cancellation. Frontend uses load adapters and rebuilds index only on new objects; demand flowPath uses shared walker instead of independent name matching. Model callSites delegates to shared graph resolution. Removed frontend receiver heuristic. Shared parity tests and full suite passed 374/374; package gate requires the common engine.

### 2026-10-06 — Constructor expression regression
Shared callsIn now skips typed constructor-expression wrappers while recursing into their arguments, including qualified types. NEW emits a real CONSTRUCTOR target and prevents its class token being misread as a local method.


VS Code 0.8.1: Calls omits depth-limit labels and implicit constructor stubs. Calls and Visual Debug FLOW use the same routine palette; BSE green takes precedence over routine colours. Depth still limits source loading and traversal.


VS Code 0.8.1: Run in SAP uses a theme-aware pale blue fill, with a stronger fill and the shared focus-colour glow on hover.


VS Code 0.8.1: VERTEX Tools opened from an object context hides the object type and name fields, keeps the function picker, and names the tab after the object.


VS Code 0.8.1: Object-bound VERTEX Tools opens beside the source editor, keeping code and tools visible together.


VS Code 0.8.1: Clicking a Calls routine in object-bound Tools opens its source in the left editor instead of expanding embedded method logic.


VS Code 0.8.1: Progress and internal style changes no longer trigger diagram theme redraws; stale Mermaid renders cannot replace the newest diagram.


VS Code 0.8.1: Context Logic/Calls selects the method under the source cursor; object-bound Tools starts with Parts collapsed.


VS Code 0.8.1: Metrics method names open source on the left; headers sort locally in both directions. Numeric routine metrics use green/yellow/red thresholds shown in cell tooltips (MI is graded in reverse). Totals remain ungraded.


ACE metrics parity correction: colour grades use the original zcl_ace_metrics_window scales only: CC ≤10 LOW, ≤20 MEDIUM, ≤50 HIGH, >50 CRITICAL; MI ≥85 HIGH, ≥65 MEDIUM, below65 LOW, zero ungraded. Other numeric metrics have no original ACE thresholds and remain ungraded.


VS Code 0.8.1: Logic nodes open their source line in the left editor; scrolling Logic follows the visible statement without taking keyboard focus from the diagram.


VS Code 0.8.1: Logic draws the false path around IF without ELSE, and ELSEIF conditions as separate decisions connected by the false path.


VS Code 0.8.1: Selecting code in the bound source highlights and reveals matching Logic nodes without moving editor focus; reverse-follow scrolling is suppressed to prevent navigation loops.


VS Code 0.8.1: Logic only is enabled by default and keeps control structure and external calls. Turning it off restores ordinary operations without another SAP read.


VS Code 0.8.1: Tools diagrams replace zoom minus/plus with a continuous 1–400% slider; code-selected nodes use a contrasting theme-aware fill as well as an outline.


VS Code 0.8.1: Tools zoom is 10–100% with a compact theme-styled track and thumb. Object/line status appears above diagram controls.


VS Code 0.8.1: Scrolling the bound source editor scrolls Logic to the corresponding visible code area without changing selection highlighting or focus. Programmatic source navigation is suppressed to prevent scroll feedback.


VS Code 0.8.1: Embedded Tools pages load the canonical vertex-controls.css so Logic only uses the same toggle appearance as Visual Debug.


VS Code 0.8.1: Value Origin has one visible command, Analyze Variable Value Origin, using ADT + abaplint. Tools omits the permanent engine label and shows only actual warnings.


VS Code 0.8.1: The shared diagram lens compensates for displayed SVG scale, reaching natural text size at small zoom (10% gives about 10× by default); Shift-wheel remains adjustable.


VS Code 0.8.1: Lens stays hidden at diagram scales of 70% and above; below 70% it magnifies up to an effective 70% scale (10% → 7× maximum).


VS Code 0.8.1: Logic switches automatically when the source cursor enters another method; movements within the method only update highlighting and position.


VS Code 0.8.1: Fixed repeated Logic method recalculation caused by comparing the wrong current-method field; source navigation from diagrams no longer echoes cursor events back into analysis.


VS Code 0.8.1: Editor navigation commands (including Alt+Left/Right) update Logic even during the diagram-navigation guard; only unclassified programmatic cursor echoes are suppressed.


VS Code 0.8.1: Logic draws a procedure end node; RETURN points directly to it and does not continue to the next operation. RETURN remains visible in Logic only.


VS Code 0.8.1: RETURN terminates branch reachability before subsequent structural nodes are emitted. A join is omitted when all incoming branches have returned, preventing detached continuation nodes.


VS Code 0.8.1: Follow code is enabled by default and synchronizes only code → Logic. Turning it off synchronizes only Logic → code; opposing scroll directions are never active together. Explicit node clicks still navigate to source.


Synchronization uses the focused view as its driver automatically; the Follow code toggle was removed. Programmatic navigation never changes the driver.


VS Code 0.8.1: Selected diagram labels carry the theme selection text colour inline, retaining contrast when cloned into the lens.


VS Code 0.8.1: Logic only retains internal method calls too, including unqualified show_versions_diff(...); procedure calls are control transfers regardless of receiver syntax.


VS Code 0.8.1: Folded operation groups retain expansion on click; an explicit expand/collapse marker restores folding without conflicting with source navigation.


Logic diagrams show every operation individually without folding. Logic only remains the filter for control flow and procedure calls.


Logic diagrams retain inline declarations containing constructor or procedure calls, including DATA(result) = NEW class( )->method( ).


Selecting a loop header or its source range highlights the entire loop frame with a theme-aware pale blue tint.


Logic conditions remain a single diamond with all AND/OR terms and parentheses. External calls, including nested argument calls, are marked with ↗; arguments are abbreviated, and the diamond tooltip lists external targets.


External method names inside condition diamonds are links opening their class method in the source editor. Unresolved receiver calls navigate to the call site. Empty branches retained by Logic only still join ENDIF.


Removed the permanent Experimental ADT + abaplint banner from analysis and Visual Debug.


Flow diagrams and flow trees open source through linked node labels instead of separate </> icons; diagram frames retain expansion actions.


Visual Debug Classes, Methods and Statements retain shared call depth and expansion state. Statements at the selected call-depth boundary remain visible when their routine is expanded.


Full FLOW retains ENDMETHOD, ENDFORM and ENDFUNCTION as routine exits, with their original routine scope, so closing-line breakpoints can end an analysed path.


Logic diagrams and FLOW share the procedure-ending classification in abap-control.js instead of separate ENDMETHOD lists.


Logic and Full FLOW use the same statement classification for declarations, calls, procedure boundaries, branches, loops and control transfers in abap-control.js.


Visual Debug adds Logic before Statements. Logic filters routine bodies using shared ABAP rules; Logic and Statements group operators inside routine frames without adding call-depth levels.


Routine frames follow the global diagram direction: Left-right or Top-down, including their contained operators.


Fixed grouped Logic/Statements Mermaid direction syntax (TB inside subgraphs). Long flow analysis reports current stage, object, parsed statement/source counts and elapsed seconds.


Analysis progress is displayed every three seconds, coalescing intermediate updates to avoid flicker.


Routine/event names such as START-OF-SELECTION are clickable frame headings in grouped Logic and Statements. Frames have a theme-aware pale blue fill, with green BSE emphasis.


Breakpoint object:line labels are links that navigate to their source line in the left editor; row clicks use the same navigation.


Grouped routine diagrams draw visible arrows between successive body statements instead of invisible layout-only links.


Grouped FLOW diagrams use execution edges for sequential operators, IF/CASE branches and joins, loop back edges, and routine exits. Statement containment is retained for tree/depth controls. Frame backgrounds are lighter.


Routine frames and entry nodes use distinct Mermaid identifiers. Execution edges connect to entry nodes rather than clusters, avoiding compound-layout failures on cyclic flows.


Visual Debug status messages use the theme green colour, matching the VERTEX assistant appearance.

Visual Debug and Value Origin keep the analysis log control at the top right, without a separate toolbar row. Source links use VS Code navigation so Back can return to the previous location. Grouped Logic and Statements diagrams use the bundled ELK layout for cross-method edges.

Grouped Mermaid diagrams attach source navigation, frame toggles and tooltips after rendering, without click directives unsupported by the bundled ELK database.

Grouped Logic and Statements diagrams apply the selected direction inside each method frame as well as to the overall graph. The bundled Mermaid ELK adapter explicitly passes group direction to ELK; independent branches may still sit beside one another.

Changing diagram depth keeps the toolbar in place. Mermaid renders in an offscreen container, and the bundled ELK measurement container no longer participates in the page flex layout.

Detach is enabled only while the debugger is stopped or listening for a run. Its tooltip distinguishes continuing a stopped program from cancelling the wait; otherwise the button is disabled.

Changing the colour theme preserves diagram zoom and scroll position. Shared FLOW diagrams update SVG colours without rebuilding the layout; Logic and Calls redraw with the existing viewport.

Visual Debug keeps Classes/Methods and embeds the standard Tools Logic diagram when its separate Logic toggle is on. Turning Logic off restores the existing Calls view; source navigation and code following use the same Tools handlers.

Embedded Logic starts from the active source editor rather than the analysed path root. It selects the routine containing the cursor and follows selection changes across ABAP objects using the standard Tools component.

## 2026-10-06 — 0.8.1 release documentation and help

Consolidated the incremental README and website notes into the final user workflow. Visual Debug uses Classes/Methods plus a separate Logic toggle backed by the existing Tools component and message handlers. Tools follows the active editor, picks a routine by source coordinates, and switches object when selection changes. Updated diagram, debugger and Value Origin help; documented focus-driven scrolling, source history, return/end boundaries, zoom/lens rules and connection-aware Detach. Earlier four-mode and Follow code descriptions are historical and superseded. No Eclipse build was produced and no live visual/SAP verification is claimed by this documentation update.

### Eclipse 0.8.1 export preparation

Prepared 0.8.1.qualifier bundle/feature metadata, the shared FLOW dependencies and an Eclipse Visual Flow Analysis command with Calls / Logic and ADT editor selection/source navigation. Eclipse retains its existing ACE backend contract; the VS Code frontend-analysis adapter and runtime Debug are not claimed ported. See [Eclipse export guide](eclipse/README.md).

Eclipse 0.8.1 preparation build: Java 21 compilation and update-site/archive packaging completed successfully. Artifact: `target/eclipse-0.8.1.20261006202315/vertex-eclipse-0.8.1.20261006202315.zip`. The published `docs/` update-site metadata and plugin artifacts were not replaced. Live Eclipse/ADT navigation and theme checks remain pending.

### Eclipse Debug Monitor prototype

**VERTEX: Debug Monitor** observes an existing SAP ADT debug session using exported SAP `IAbapThread` / `IAbapStackFrame` and Eclipse debug events. It does not establish a second connection or change breakpoints. Open it from an ABAP editor context menu after starting the normal ADT debugger. It reads stopped frames and up to 100 top-frame variables in background jobs; Refresh retries the read. If multiple threads are present, choose one explicitly. Large displayed values are truncated at 2,000 characters, and variable children are not fetched recursively.

When an ABAP class frame supplies its class URI and absolute source line, the monitor passes that coordinate to the Tools Logic view. Include-local coordinates are not guessed. Editor selection remains available for source following. Step, Continue, terminate, recording, table expansion and frame-selection control remain in the normal ADT debugger for this prototype.

The installed SAP ADT 3.60 interfaces were inspected locally, and Java 21 compilation and archive packaging passed. No live debug session or light/dark runtime check has been performed. Install the test archive before using this as a release feature.


### Eclipse Tools: standard ADT analysis

Tools UML, metrics, Calls, Logic and Parts now use the shared VS Code frontend-analysis and abaplint parser in a browser worker. Source and package reads use the selected Eclipse project’s standard ADT session. These analysis views no longer require `/sap/bc/adt/vertex/class`, `/metrics`, `/flow` or `/versions` handlers. Versions/Diff, Review and other backend services retain their existing routes. The separate Value Origin view is not migrated by this change. Eclipse/SAP runtime and light/dark rendering remain unverified.


Eclipse follow-up: corrected Debug Monitor / Visual Flow Analysis registration under `org.eclipse.ui.views`. Value Origin now reads standard ADT source and uses the shared abaplint worker; it no longer requests the custom origin endpoint or requires ZCL_VX_ADT_RES_FLOW. Java compilation and archive creation passed; live Eclipse/SAP behavior is pending.

Eclipse Origin fix: ADT metadata reads now send `Accept: */*`; source reads send `Accept: text/plain`, including class includes. This fixes the server’s “Accept header missing” rejection. Live SAP verification is pending.

Eclipse Tools fix: standard ADT object metadata uses `Accept: */*`, matching the VS Code ADT client; `application/xml` was rejected by servers requiring ADT vendor media types. Source reads remain `text/plain`. This Java transport change does not affect VS Code.

Eclipse ADT bridge: added String content handlers for standard SAP vendor XML metadata, including programs v3, classes and interfaces. Shared by Tools, Visual Flow Analysis, Debug Monitor and Origin; negotiated vendor XML versions are registered on response. This change is confined to Java transport. Live SAP verification is pending.

Eclipse browser bundle fix: UMD dependencies now receive the local module loader as `require`, fixing “require is not defined” during abaplint initialization. The VS Code runtime is unchanged.

Eclipse module loader: failed initialization no longer leaves partial exports in the cache. This prevents a failed abaplint load from turning subsequent requests into misleading “MemoryFile is not a constructor” errors. Restart the PDE runtime or installed Eclipse after updating generated resources.

Eclipse browser runtime: added the Buffer.from hex/UTF-8 operations used by abaplint built-in constants, allowing dependent class parsing to continue. Origin reports its ADT + abaplint engine correctly. VS Code runtime unchanged; live SAP verification pending.

Eclipse browser bundler: generated module imports now use a distinct loader name, avoiding collision with frontend-analysis’s SAP source load function. This fixes Calls palette and Logic module loading; shared VS Code analysis sources are unchanged.

Shared FLOW theme fix: theme overrides now outrank Mermaid SVG-scoped styles, so routine frames and labels follow the active editor theme. Theme changes retain zoom and scroll. VS Code package version 0.8.2. Live light/dark rendering pending.

FLOW diagram correction: parameter transfers remain in the analysis tree but no longer form disconnected diagram nodes; call edges bypass them and connect the call statement to its callee. ELK cluster fills use active editor theme CSS variables, overriding inline Mermaid fills; theme updates preserve zoom and scroll. Live light/dark rendering pending.

FLOW source-only correction: both tree and diagram contain source statements and nested routines, without synthetic parameter-transfer rows or repeated-routine arrow markers. Formula and Expression retain data relationships.

FLOW collapse controls use the canonical independent toggle style with compact, centered icon geometry; removed the single-button segmented wrapper.

2026-10-07 — VS Code 0.8.3: FLOW initializes Mermaid with the active editor theme’s background, container, border, label and edge colours. Removes the initial dark-theme container background; theme changes preserve zoom. Live theme verification pending.

2026-10-07 — FLOW rendering fix: shared script now defines its ABAP identifier normalizer before variable label highlighting, fixing the reported “canonical is not defined” runtime error. VS Code package remains 0.8.3. Live rendering pending.

### 2026-10-07 — Value origin FLOW reading levels

Report: Value origin showed only its heading, the analysis log and the selection-screen panel; FLOW was empty. It could not be reproduced from the repository: the page built by `html()` on an abaplint graph of a program with a radio group rendered fully in a browser, and the installed 0.8.3 matched the repository file for file. The window drew again after the reinstall that carried the `canonical` normalizer fix above. Found on the way: the Mermaid theme initialisation falls back to the CSS system colours `Canvas`, `CanvasText` and `GrayText` when a theme variable is empty, and Mermaid rejects them (`Unsupported color format`); left as is, to be decided.

Then: FLOW in Value origin gained the levels of Visual Debug. The request was one data source, so the page receives no new data: `html()` folds the same `graph.codeFlow` rows four times with the shared builder (`classes`, `methods`, `logic`, `steps`) and hands them over as `flowReadings`; `vertex-flow.js` shows a `vertex-segment-toggle` (Classes | Methods | Logic | Statements) in FLOW only and swaps `bseFlow` and the depth maximum. Statements stays the default. Visual Debug's own Logic, which opens the Tools logic diagram of one method, was not copied. The 13 failing tests of the suite fail the same way without this change. Verified in a browser on light and dark variables: tree and diagram for all four readings, no console errors.

Routine frames on a dark theme stayed light grey in the FLOW diagram. The theme code painted `g.cluster rect`, but the grouped FLOW is laid out by ELK, which draws a routine as `g.subgraph > rect.subgraph`: nothing matched, so Mermaid's fill stayed. The inline override now covers both kinds of frame and their captions; at the user's request the frame is a 12% tint of `--vscode-focusBorder` over the editor background, which reads light blue on light themes. Checked in a browser with light and dark VS Code variables.

Follow-ups from the user on the same window: Methods is the default reading; the Analysis log moved behind the bug control (`debug-only`); Depth moved beside Fit. Depth also governs the tree, which has no Fit row, so it moves with the view: by Fit for the diagram, back in the toolbar for a tree. The magnifier drew without colours because the theme rules had been rewritten as `#mermaid-graph svg[id] …` to outrank Mermaid's id-scoped styles, and the magnifier's copy of the SVG is not inside `#mermaid-graph`. They are scoped as `svg#<drawing id> …` now: the same weight against Mermaid, and the copy carries the id. Two tests that read the statements from the default reading take the Statements reading explicitly; one checks every reading against the builder.

Expand all / Collapse all went back to two buttons, at the user's request and in SAP GUI's shape: chevrons down for Expand all, chevrons up for Collapse all. An earlier stage had merged them into one switch that offered the other state each time; a pair with one in force is an exclusive choice, so it is a `vertex-segment-toggle` with `.active` (AGENTS.md), with the icon-button geometry. The test that pinned the single switch now pins the pair.

Depth in a tree moved to the root, beside the expand buttons. The root is a `<summary>`, so a click on the slider would fold it: the control swallows clicks while it stands there. The FLOW tree is rebuilt on every depth or reading change, which detaches what was in its root; the expand buttons are re-attached there and Depth follows them. Tooltips now describe each FLOW control. Seen on the way again: with a theme variable missing, the `Canvas`/`GrayText` fallbacks make Mermaid throw inside `rebuild()`, which also aborts a depth change — still waiting for the user's decision.

Show from here, agreed with the user before building: a right click on a FLOW diagram node replaces the browser's Cut / Copy / Paste with one item; the diagram is then walked from that node instead of the root (`focusPath`), a path bar above it returns to any level and Esc returns one step. Diagram only, at the user's choice; a change of reading or a new graph starts from the whole flow again, since node ids differ between readings. The page's general button rule stretched the path bar's links to full width at first; they are scoped by id now. Menu colours come from the VS Code menu variables, falling back to the widget ones.

WHEN appeared twice in the FLOW diagram: as the label of the CASE edge (`executionEdges` labels it with the branch text) and as a box that edge led to. The builder now folds each WHEN box into that edge for the diagram only — the edge goes on to the branch's first statement, keeping the label — and marks the node `diagramHidden`; the tree still nests the branch under its WHEN. A `` in the regular expression was lost to shell escaping on the first try and silently matched nothing; the test now builds a CASE and checks the edges.

A click in a Tools diagram opened the class again in a new editor group. `openToolSource` (and the analysis-link path `openOrigin`) always passed `ViewColumn.One` to `vscode.open`, so a source already open in another column got a second editor. Both go through `revealSource` now: an editor already showing the document is scrolled where it is; otherwise the document opens in the column of a visible `vertex-sap` editor, or the first one. Eclipse is not affected - ADT opens its own editor once.

The `Canvas` / `CanvasText` / `GrayText` fallbacks in the Mermaid theme initialisation are gone, by the user's decision: they were never valid for Mermaid (`Unsupported color format`), and the throw inside `rebuild()` also aborted a depth change. `themeVariable` now throws with the variable's name and the diagram area shows the message; the rest of the page keeps working. Checked with the variable missing (message, depth still works) and present (diagram drawn). Then, at the user's request, the `#ffffff` / `#111111` fallbacks of `applyDiagramTheme` went too. They never affected a theme change - VS Code changes the values, the variables stay - but a missing variable would have painted the diagram white without a word. The theme observer's repaint reports the error in the diagram area like the drawing does.

A reading change used to drop Show from here, because node ids differ between readings. Each node carries a key the builder gives it in every reading (`c|class`, `m|routine`, `o|program:line`), so the path is carried over: the same key, else the routine the node stands in, else its class; consecutive duplicates collapse and the carried nodes stay expanded. A statement shown from in Statements becomes its routine in Methods and Logic. Tree / Diagram moved to the front of the toolbar (`prepend`). The `#4f8cff` fallback of variable highlighting went the way of the others: a missing `--vscode-textLink-foreground` is reported.

The user asked whether the better direction could be computed. It can: both directions are rendered off screen and compared by the scale at which each fits the diagram viewport, taken from the SVG viewBox; the larger wins. First built without a new control (the result shown on the Top-down / Left-right buttons), then, at the user's request, as an Auto button that is the default and names its choice in the tooltip. The cost is a second Mermaid render per redraw while Auto is on. Checked in a narrow window (top-down chosen) and a wide, low one (left-right chosen). Two regular expressions lost their backslashes to shell escaping on the way and were repaired before any run.

The direction buttons were loose buttons in the diagram toolbar and wrapped badly in a narrow pane; with Auto they are an exclusive choice, so they became one `vertex-segment-toggle`. The two expand buttons went back to one switch at the user's word - it is all-or-nothing, so one control whose icon flips is enough - keeping the SAP GUI chevrons. Branch-level opening moved to the node menu: Expand / Collapse this branch walk the node's descendants in `bseFlow` and add them to or remove them from `flowExpanded` (expansion still bounded by Depth), keeping the view.

Edge labels looked struck through: ELK with `htmlLabels:false` writes a label as bare text, with no rect behind it, so the theme rule for `.edgeLabel rect` had nothing to paint and the line showed through. After drawing, each label gets a `rect.vx-label-back` sized from its text box and filled with `var(--vscode-editor-background)`. The blue patches on the toolbar and captions were a text selection left by dragging the diagram; the diagram panel is `user-select:none` now.

The BSE scope dropped ENDIF and ENDCASE: it keeps what the slice found and the ancestor path to it, and an END statement is a sibling of its block in the tree, never an ancestor. The builder now records on each END statement the block it closes (`closes`, taken from the block stack it already pops), and the BSE scope adds an END statement whose block it keeps. The ancestor-closure rule is otherwise unchanged.

At the user's word, BSE and Logic do not combine: in the BSE scope the Logic button is hidden, an active Logic reading switches to Statements, and Full brings the button back (the reading stays where it is).

Regression of the label backing: switching from Statements to Classes or Methods showed "Mermaid: Failed to execute 'insertBefore'". Those readings are laid out by dagre, not ELK, and dagre nests the label's text inside `g.label` under `.edgeLabel`; the backing was inserted into `.edgeLabel` before a node that is not its child. It goes into the text's own parent now, which is also the coordinate system its `getBBox` is in. Checked by switching through all four readings, twice.

The node menu did not open on routine frames in Statements and Logic: those are laid out by ELK, whose frames (`g.subgraph`) carry neither an id nor a node, so the browser's Cut / Copy / Paste showed. After drawing, each frame is matched to its routine node by caption (the routine's text, quoted as the diagram quotes it) and tagged like a node. Checked by right-clicking every frame and node in all four readings.

Clicking a FLOW diagram label in Value origin opened nothing. `vertex-flow.js` called `bseMermaidOpen(node.id)` with the flow builder's id (`f12`), and the window looks a node up among the analysis graph's nodes and flows, finds none, and has no source to open. The flow node already carries `origin:<source>|<location>` and its line, which the window's handler understands (the tree sends them); the click passes the node, and the page sends source and line with it. Visual Debug defines its own `bseMermaidOpen` and ignores the extra argument; Eclipse's handler reads the same message.
