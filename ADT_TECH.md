# Talking to ADT from Java

The plugin half of VERTEX, and the parts of it that have no public documentation. Everything here
was read off the bundles on disk or off a live system, because web search returns nothing usable
for these classes.

The rest of the project is in [README.md](README.md); how it was built, wrong turns included, is in
[dev_history.md](dev_history.md).

## How it fits together

```
Eclipse plugin (Java)  ──ADT session──>  /sap/bc/adt/vertex/table/{name}     ──>  JSON
                                         /sap/bc/adt/vertex/metrics/{name}
                                         /sap/bc/adt/vertex/versions/{name}
                                         /sap/bc/adt/vertex/join/{name}
                                         /sap/bc/adt/vertex/review/{name}
                                         /sap/bc/adt/vertex/requests?user=
                                         /sap/bc/adt/vertex/about
        │
        └── hands the JSON to the page for that service, which renders it
```

Every service registers under the one `/vertex/` prefix, because that prefix is where the ADT node
is claimed and not the identity of the service: a second one would mean a second BAdI
implementation and a second filter to get wrong.

The page receives finished JSON from the host and knows nothing about SAP. That is what makes the
second host possible: `vscode/extension.js` reads the very same files out of `resources/` and
answers them over plain HTTPS, and the markup, grids and filters are not written twice.

The ABAP side lives in this repository, under `src/` — one class per service, the application
class `ZCL_VX_ADT_RES_APP` and the BAdI registration `ZVX_ADT_RES_APP`. The traps in registering
a custom ADT resource are documented in `ADT.md` in the
[Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) repository, where the hub
was first built. Install `src/` first; without it every request returns 404 — and a window that
gets one opens on a setup page naming what to install, with links, rather than a red error,
because nothing is broken there.

The flow, the branch schemes and the metrics read a GUI-free core carried here from
[ACE](https://github.com/ysichov/ACE) as `ZCL_VX_ACE_*`, so those services need nothing else
installed. The table reader, the join and the pivot still read
[Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer), and versions and review
still read [AVE](https://github.com/ysichov/AVE). Without one of those, that resource does not
activate.

A system can therefore have part of the ABAP half and not the rest. Every window asks
`/sap/bc/adt/vertex/about` when it opens: which services the hub has there, whether each one's class
is active, and whether AVE and ACE are installed. What the system does not have is not drawn — the
Join button, the finder, the Review card, the flow modes — and a line under the bar says what is
missing and why. A window whose own main service is missing opens on that list instead of a blank
start. A hub older than `/vertex/about` answers it with a 404; the window then keeps every button and
reports failures when they happen, as before.

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

Reopening the SelecTor view re-runs the request; there is no refresh button yet. Metrics and
Versions have a Load button of their own.


## Reading a resource

```java
IAbapProjectService svc = AdtProjectServiceFactory.createProjectService();
IProject project = svc.getAvailableAbapProjects()[0];
String destinationId = project.getAdapter(IAdtCoreProject.class).getDestinationId();

IRestResource r = AdtRestResourceFactory.createRestResourceFactory()
        .createResourceWithStatelessSession(URI.create("/sap/bc/adt/vertex/table/T001?rows=100"),
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

## Writing, not only reading

`IRestResource` has `post`, `put` and `delete` beside `get`, in the same shapes:

```java
String answer = resource.post(new NullProgressMonitor(), String.class, body);
```

- **The CSRF token is not yours to fetch.** The ADT communication layer holds the destination and
  carries the token for it. A VS Code host on plain basic authentication has no such layer and has
  to fetch one from `/sap/bc/adt/discovery` with `x-csrf-token: fetch`, then send it back together
  with the cookies of the response that issued it — the token belongs to that session.
- A content handler that only reads is enough for `get` and not for `post`: `serialize` is called
  with the body, and `ByteArrayMessageBody` from `com.sap.adt.communication.message` is the
  concrete `IMessageBody` to return.

```java
@Override
public IMessageBody serialize(String data, Charset charset) {
    return new ByteArrayMessageBody("application/json; charset=utf-8",
            data.getBytes(StandardCharsets.UTF_8));
}
```

## Telling a missing resource from a broken one

A path nothing answers raises `ResourceNotFoundException`
(`com.sap.adt.communication.resources`), a real class with the 404 already interpreted. Worth
catching separately: a plugin installed without its ABAP half is a setup state, not a failure, and
it deserves a page saying what to install rather than a red error. Everything else — a system that
is down, a password refused — stays a failure.

```java
for (Throwable t = e; t != null; t = t.getCause()) {
    if (t instanceof ResourceNotFoundException) { ... }
}
```

The cause chain has to be walked: the exception arrives wrapped.

## The WebView2 callback deadlock

A `BrowserFunction` callback runs inside the WebView2 message pump. Anything slow in it — an HTTP
request, a modal logon dialog — ends in `SWTException: Waiting for Edge operation to terminate
timed out`. So a callback queues the work and returns at once:

```java
protected void queue(Supplier<String> work) {
    browser.getDisplay().asyncExec(() -> deliver(work));
}
```

The page is woken afterwards with `browser.execute("sdeReady()")`, and takes its answer through a
second function. `sdeReady()` carries no arguments on purpose, so nothing passes through a
JavaScript literal and nothing has to be escaped.

That accident is why the same pages run under VS Code unchanged: a webview cannot call its host
synchronously either.

