# SelecTor_ADT

An Eclipse plugin that brings [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer)
into ABAP Development Tools: a view inside the ADT workbench that reads table data over the
developer's existing ADT connection and renders it as HTML.

Status: **early**. The view fetches one table and draws a read-only grid. No filters, no joins,
no pivot yet.

## How it fits together

```
Eclipse plugin (Java)  ──ADT session──>  /sap/bc/adt/zsde/table/{name}  ──>  JSON
        │
        └── hands the JSON to resources/table.html, which renders the grid
```

The page receives finished JSON from the host and knows nothing about SAP. That is deliberate:
the same page can later be driven by a VS Code extension, with a TypeScript host in place of
this view, and the markup, grid and filters stay identical.

The ABAP side lives in the [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer)
repository — classes `ZCL_SDE_ADT_RES_TABLE`, `ZCL_SDE_ADT_RES_APP` and the BAdI registration
`ZSDE_ADT_RES_APP`. Its setup, and the traps in registering a custom ADT resource, are documented
in `ADT.md` there. Install that first; without it every request returns 404.

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
2. Right-click `org.selector.adt.ui` → Run As → Eclipse Application. A second Eclipse starts
   with the plugin loaded; that is how plugins are tested, and it is not how the finished plugin
   will be used.
3. In that second Eclipse, create an ABAP project (ABAP perspective → File → New → ABAP Project).
   The plugin takes its session from there, so without a project the view says so and stops.
   The runtime workspace persists, so this is a one-time step.
4. Window → Show View → Other… → SelecTor → SelecTor Data Explorer.

Reopening the view re-runs the request; there is no refresh button yet.

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
javac -nowarn -proc:none -classpath "~/.p2/pool/plugins/*" -d /tmp/out org.selector.adt.ui/src/org/selector/adt/ui/*.java
```

## Layout

```
org.selector.adt.ui/
├── META-INF/MANIFEST.MF   bundle dependencies
├── plugin.xml             registers the view at org.eclipse.ui.views
├── build.properties       resources/ must be listed, or the page is missing at runtime
├── resources/table.html   the grid: renders fields + rows, no SAP knowledge
└── src/org/selector/adt/ui/
    ├── SelectorView.java       fetches JSON, injects it into the page
    └── JsonContentHandler.java reads a JSON response body as a String
```

## Next

- Filters, and the select-options behaviour that re-reads as you type. Note the budget: 10 000
  rows take 2–3 seconds end to end, which suits a page load, not a keystroke — reactive
  filtering needs a small page size.
- Authorization on the ABAP side. The resource currently lets any authenticated user read any
  transparent table; `S_TABU_DIS` / `S_TABU_NAM` are not checked anywhere yet.
- A VS Code host for the same page.
