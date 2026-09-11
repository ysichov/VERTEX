# Talking to ADT from Java

The plugin half of VERTEX, and the parts of it that have no public documentation. Everything here
was read off the bundles on disk or off a live system, because web search returns nothing usable
for these classes.

The rest of the project is in [README.md](README.md); how it was built, wrong turns included, is in
[dev_history.md](dev_history.md).

## Reading a resource

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

