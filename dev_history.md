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
that is down after every reboot; ALC is `arc-alloy`. Reporting "the system is
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
mostly parts: `REPS /ALLOY/GRC_LANGUAGE_TABLE`, or a method keyed by its class name padded to
thirty characters. Neither is an object, and a label is not a key. Now only `CLAS`, `INTF` and
`FUGR` expand, by technical name; every other row asks for its versions inside the scope, with
the version directory's key passed exactly as it came, blanks included — Stage 10 is why that
last part matters. The test that pins it down uses the very row from the ALCK900578 screenshot.

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
