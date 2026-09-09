# ABAP VERTEX Tools

ABAP **Version**, **Code** and **Data** Explorer — three words, three SAP GUI tools, one front end
in ABAP Development Tools. Each view reads over the developer's existing ADT connection and
renders as HTML.

| Word | Backend | What it does | In VERTEX | Status |
|---|---|---|---|---|
| Data | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, joins, pivot | SelecTor | A table with filters, a join built from the dictionary's own foreign keys, and a pivot over either |
| Code | [ACE](https://github.com/ysichov/ACE) | Metrics, call maps, backward slicing, skeletons | Metrics | McCabe, Halstead and the maintainability index per unit |
| Version | [AVE](https://github.com/ysichov/AVE) | History, diff, blame, code review of a whole transport | Versions | Parts, their versions and the diff between two of them; no blame, no review, one object at a time |

Status: **early**. All three answer, and each is a fraction of what its backend can do.

The division of labour is the same for all three: ABAP computes and returns JSON, the page
renders it, and the view in between is transport. Nothing about a service lives in the host, so
the same page runs under the VS Code extension in `vscode/` — and, since SAP GUI 8.0 draws on the
same WebView2 engine as both editors, one day inside SAP GUI as well.

## How it fits together

```
Eclipse plugin (Java)  ──ADT session──>  /sap/bc/adt/zsde/table/{name}     ──>  JSON
                                         /sap/bc/adt/zsde/metrics/{name}
                                         /sap/bc/adt/zsde/versions/{name}
                                         /sap/bc/adt/zsde/join/{name}
        │
        └── hands the JSON to the page for that service, which renders it
```

Every service registers under the one `/zsde/` prefix, because that prefix is where the ADT node
is claimed and not the identity of the service: a second one would mean a second BAdI
implementation and a second filter to get wrong.

The page receives finished JSON from the host and knows nothing about SAP. That is deliberate:
the same page can later be driven by a VS Code extension, with a TypeScript host in place of
this view, and the markup, grid and filters stay identical.

The ABAP side lives in the [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer)
repository — one class per service, the application class `ZCL_SDE_ADT_RES_APP` and the BAdI
registration `ZSDE_ADT_RES_APP`. Its setup, and the traps in registering a custom ADT resource,
are documented in `ADT.md` there. Install that first; without it every request returns 404.

Each service also needs its own backend in the same system, because the computing is theirs:
metrics need [ACE](https://github.com/ysichov/ACE), versions need
[AVE](https://github.com/ysichov/AVE). Without one, that resource does not activate.

## Prerequisites

- Eclipse with **ABAP Development Tools** from https://tools.hana.ondemand.com/#abap
- **Eclipse Plug-in Development Environment (PDE)**. The "for Java Developers" package does not
  include it: Help → Install New Software → the release update site → General Purpose Tools →
  Eclipse Plug-in Development Environment. The "for RCP and RAP Developers" package has it
  already.
- No separate ADT SDK exists and none is needed. The installed ADT bundles are what the plugin
  compiles against, and PDE uses the running Eclipse as its target platform by default.
- No JDK install either — Eclipse runs on its own bundled JustJ JRE, named by `-vm` in
  `eclipse.ini`. Whatever `java -version` reports on the PATH is irrelevant.

## Running it

1. File → Import → General → Existing Projects into Workspace, root directory this repository.
2. Right-click `org.vertex.abap.ui` → Run As → Eclipse Application. A second Eclipse starts
   with the plugin loaded; that is how plugins are tested, and it is not how the finished plugin
   will be used.
3. In that second Eclipse, create an ABAP project (ABAP perspective → File → New → ABAP Project).
   The plugin takes its session from there, so without a project the view says so and stops.
   The runtime workspace persists, so this is a one-time step.
4. Window → Show View → Other… → **VERTEX**, and pick a service. Each view carries an object
   type and a name field: type a name, press Enter, and keep using the same window for the next
   object.
   Right-click an object in the Project Explorer → **VERTEX** → **SelecTor**, **Metrics** or
   **Versions** does the same with the fields prefilled, and the window then inherits the system
   that object lives in — so two objects from two projects open side by side against two systems.
   Opened with nothing selected, a view asks which ABAP project to read from.

Reopening the SelecTor view re-runs the request; there is no refresh button yet. The metrics page
has a Reload button of its own.

## Talking to ADT

This is the part with no public documentation, so it is written down here.

```java
IAbapProjectService svc = AdtProjectServiceFactory.createProjectService();
IProject project = svc.getAvailableAbapProjects()[0];
String destinationId = project.getAdapter(IAdtCoreProject.class).getDestinationId();

IRestResource r = AdtRestResourceFactory.createRestResourceFactory()
        .createResourceWithStatelessSession(URI.create("/sap/bc/adt/zsde/table/T001?rows=100"),
                                            destinationId);
r.addContentHandler(new JsonContentHandler());
String json = r.get(new NullProgressMonitor(), String.class);
```

Points that cost time:

- The URI is **relative to the system root**. The destination supplies host and port.
- A content handler must be supplied. ADT has `PlainTextContentHandler`, but its package is
  internal and not exported, so `JsonContentHandler` here implements `IContentHandler<String>`
  instead — four methods, of which only `deserialize` does anything.
- Declaring `application/json` matches a response sent as `application/json;charset=utf-8`.
  ADT compares media types without their parameters.
- `Require-Bundle` needs `com.sap.adt.communication`, `com.sap.adt.project` and
  `com.sap.adt.tools.core.base`.
- These packages are exported with `x-friends` naming only SAP's own bundles, so the compiler
  reports **Discouraged access**. That is a warning, not an error, and abapGit's ADT_Frontend
  depends on them the same way.

### Reading the API off the bundles

Web search returns nothing usable for these classes. Read the signatures from the jars instead —
they are on disk in the p2 pool, and the JRE Eclipse runs on ships `javap`:

```
ls  ~/.p2/pool/plugins/ | grep com.sap.adt
unzip -l  <bundle>.jar                       # classes
unzip -p  <bundle>.jar META-INF/MANIFEST.MF  # what it exports
~/.p2/pool/plugins/org.eclipse.justj.openjdk.*/jre/bin/javap.exe -classpath <bundle>.jar <fqcn>
```

Use that `javap` and not one from an older JDK on the PATH, which cannot read these class files.

The same JRE also ships `javac`, and the pool works as a classpath wildcard, so the plugin can
be compile-checked without starting Eclipse:

```
javac -nowarn -proc:none -classpath "~/.p2/pool/plugins/*" -d /tmp/out org.vertex.abap.ui/src/org/vertex/abap/ui/*.java
```

## Layout

```
org.vertex.abap.ui/
├── META-INF/MANIFEST.MF   bundle dependencies
├── plugin.xml             registers the view at org.eclipse.ui.views
├── build.properties       resources/ must be listed, or the page is missing at runtime
├── resources/
│   ├── table.html         the grid: renders fields + rows, no SAP knowledge
│   ├── metrics.html       the metrics table, sortable by any column
│   └── versions.html      parts, their versions, and the diff between two of them
└── src/org/vertex/abap/ui/
    ├── PageView.java           browser, page, ADT read, answer bridge - the shared half
    ├── SelectorView.java       table data: what to request, and opening a second window
    ├── MetricsView.java        code metrics: what to request
    ├── VersionsView.java       version history: parts, then the versions of one
    ├── ServiceHandler.java     context menu -> a view, on the object's own system
    ├── DataHandler.java        which view, and what to carry in its secondary id
    ├── MetricsHandler.java     the same, for metrics
    ├── VersionsHandler.java    the same, for versions
    ├── SelectionContext.java   the ADT object and project behind a workbench selection
    └── JsonContentHandler.java reads a JSON response body as a String
```

A view is transport and nothing else: it names a path and hands the answer to its page. What the
user operates lives in the page, which is what lets the same page run under the VS Code host in
`vscode/`.

## Next

- Authorization on the ABAP side. The table resource lets any authenticated user read any
  transparent table; `S_TABU_DIS` / `S_TABU_NAM` are not checked anywhere yet. `SE16N` resolves
  both through `VIEW_AUTHORITY_CHECK`, and a refusal has to be a real 403 rather than an empty
  result.
- Paging, sorting and a refresh button for the grid. The row limit is a constant in the page and
  the resource has no offset, so a large table stops at the first hundred rows.
- Conversion exits and F4. Values arrive as stored, so an `ALPHA`-padded key reads as padded.
- Filters on a joined table. The selection panel knows the base table's columns; the join's own
  are filterable by the resource already, and wait for the panel to learn their names.
- The character-level highlight inside a changed line, and the pass that pairs a deletion with the
  insertion it belongs to. Both exist in AVE already, in the ABAP and in its browser port; see
  stage 12 of `dev_history.md` for why neither was copied wholesale.
- Blame, and the review workflow on top of the diff — approve, decline, comment, saved per
  transport request.
- A transport request as the unit of work, which is what AVE is for. Both it and a package are
  refused today: they are read object by object, and one blocking request has nowhere to report
  progress. The same limit keeps the metrics of a whole package out.
