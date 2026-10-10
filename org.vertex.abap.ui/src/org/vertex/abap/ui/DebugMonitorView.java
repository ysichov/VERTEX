package org.vertex.abap.ui;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.eclipse.debug.core.DebugPlugin;
import org.eclipse.debug.core.IDebugEventSetListener;
import org.eclipse.debug.core.IBreakpointsListener;
import org.eclipse.debug.core.model.IBreakpoint;
import org.eclipse.core.resources.IMarkerDelta;
import org.eclipse.swt.browser.BrowserFunction;

/** Keeps the existing view ID so installed shortcuts survive the move to Visual Debug. */
public class DebugMonitorView extends ToolsView {
    public static final String ID = "org.vertex.abap.ui.view.debugMonitor";
    private volatile VisualDebugSession session;
    private IDebugEventSetListener listener;
    private IBreakpointsListener breakpointListener;
    private final ExecutorService commands = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "VERTEX Visual Debug"); t.setDaemon(true); return t;
    });
    private volatile boolean closed;
    private volatile String context = "{}";
    @Override protected String title(String object) { return "Visual Debug"; }
    @Override protected String page() { return "assistant/visual-debug.html"; }
    @Override protected String accept(String path) {
        return path.startsWith("/sap/bc/adt/runtime/dumps") ? "application/atom+xml;type=feed" : super.accept(path);
    }
    @Override protected String initialLiteral() {
        var parsed = JsonParser.parseString(super.initialLiteral());
        JsonObject initial = parsed.isJsonNull() ? new JsonObject() : parsed.getAsJsonObject();
        initial.addProperty("type", VisualDebugSession.text(initial, "type").split("/")[0]);
        return initial.toString();
    }
    @Override protected String readResource(String path) throws IOException {
        String value = super.readResource(path);
        if (!path.equals(page())) return value;
        String theme = super.readResource("assistant/value-origin.html");
        theme = theme.substring(theme.indexOf("<style id=\"theme\">"), theme.indexOf("</style>") + 8);
        String frontend = super.readResource("resources/eclipse-frontend.js")
            .replace("/*FRONTEND_BUNDLE*/", AssistantBridge.quote(super.readResource("resources/vertex-frontend.js")).replace("<", "\\u003c"));
        String bridge = "<script>window.vertexDebugHost=true;" + frontend + "\n" + super.readResource("assistant/visual-debug-host.js") + "</script>";
        // Only the document's own tags: the page's script builds frames with "</head>" and "<body>" in strings.
        value = first(value, "</head>", theme + "<style>" + super.readResource("resources/vertex-controls.css") + "</style></head>");
        value = first(value, "<body>", "<body class=\"vertex-docked-debug\">");
        return first(value, "<script>", bridge + "<script>");
    }
    private static String first(String text, String tag, String replacement) {
        int at = text.indexOf(tag);
        if (at < 0) throw new IllegalStateException("Visual Debug page has no " + tag);
        return text.substring(0, at) + replacement + text.substring(at + tag.length());
    }
    @Override protected void addFunctions() {
        super.addFunctions();
        new BrowserFunction(browser, "sdeNativeDebug") {
            @Override public Object function(Object[] args) {
                String command = String.valueOf(args[0]), request = String.valueOf(args[1]);
                int id = ((Number) args[2]).intValue();
                browser.getDisplay().asyncExec(() -> {
                    if (closed) return;
                    try {
                        if (session == null) session = new VisualDebugSession(abapProject());
                        commands.submit(() -> {
                            String answer; boolean error = false;
                            try {
                                JsonObject data = JsonParser.parseString(request).getAsJsonObject();
                                if (command.equals("asset")) answer = asset(VisualDebugSession.text(data, "name"));
                                else if (command.equals("run") || command.equals("opendump")) answer = runInSap(command, data);
                                else answer = session.command(command, data).toString();
                            } catch (Exception e) { answer = describe(e); error = true; }
                            reply(id, answer, error);
                            if (java.util.Set.of("step", "frame", "set", "clear", "activate", "runTo", "terminate", "detach", "stop", "session").contains(command)) publish();
                        });
                    } catch (Exception e) { reply(id, describe(e), true); }
                }); return null;
            }
        };
        new BrowserFunction(browser, "sdeDebugContext") {
            @Override public Object function(Object[] args) { if (args.length > 0) context = String.valueOf(args[0]); return null; }
        };
    }
    private String asset(String name) throws IOException {
        String path = switch (name) {
        case "mermaid" -> "resources/mermaid.min.js";
        case "controls" -> "resources/vertex-controls.css";
        case "abapControl" -> "resources/vertex-abap-control.js";
        case "flowGraph" -> "resources/vertex-flow-graph.js";
        case "flow" -> "resources/vertex-flow.js";
        case "lens" -> "resources/vertex-lens.js";
        case "origin" -> "assistant/value-origin.js";
        case "tools" -> "resources/tools.html";
        default -> throw new IllegalArgumentException("Unknown asset " + name);
        };
        return readResource(path);
    }
    private String runInSap(String command, JsonObject args) throws Exception {
        String name = VisualDebugSession.text(args, "program").toUpperCase(java.util.Locale.ROOT);
        String kind = VisualDebugSession.text(args, "test").toUpperCase(java.util.Locale.ROOT);
        if (!command.equals("opendump") && !name.matches("[A-Z0-9_/]{1,40}")) throw new IllegalArgumentException("An ABAP program, class or function name is required.");
        if (!command.equals("opendump")) session.command("prepareRun", new JsonObject());
        String transaction = command.equals("opendump") ? "ST22" : kind.equals("CLAS") ? "SE24" : kind.equals("FUNC") ? "SE37" : "SE38";
        java.util.Map<String,String> parameters = command.equals("opendump") ? java.util.Map.of()
            : java.util.Map.of(kind.equals("CLAS") ? "SEOCLASS-CLSNAME" : kind.equals("FUNC") ? "RS38L-NAME" : "RS38M-PROGRAMM", name);
        final RuntimeException[] failure = new RuntimeException[1];
        browser.getDisplay().syncExec(() -> {
            try { com.sap.adt.sapgui.ui.editors.AdtSapGuiEditorUtilityFactory.createSapGuiEditorUtility()
                .openEditorAndStartTransaction(abapProject(), transaction, true, parameters); }
            catch (RuntimeException e) { failure[0] = e; }
        });
        if (failure[0] != null) throw failure[0];
        return "{}";
    }
    private void reply(int id, String answer, boolean error) {
        if (closed) return;
        browser.getDisplay().asyncExec(() -> { if (!closed && !browser.isDisposed()) browser.execute("vertexNativeReply(" + id + "," + AssistantBridge.quote(answer) + "," + error + ");"); });
    }
    private void publish() {
        if (closed || session == null) return;
        try {
            String snapshot = session.picture().toString();
            browser.getDisplay().asyncExec(() -> { if (!closed && !browser.isDisposed()) browser.execute("vertexNativeEvent(" + AssistantBridge.quote(snapshot) + ");"); });
        } catch (Exception e) {
            String message = describe(e);
            browser.getDisplay().asyncExec(() -> { if (!closed && !browser.isDisposed()) browser.execute("if(typeof notice==='function')notice(" + AssistantBridge.quote(message) + ");"); });
        }
    }
    @Override public void createPartControl(org.eclipse.swt.widgets.Composite parent) {
        super.createPartControl(parent);
        listener = events -> {
            if (closed || session == null) return;
            boolean relevant = false;
            for (org.eclipse.debug.core.DebugEvent event : events) relevant |= session.event(event);
            if (relevant && !closed) commands.submit(this::publish);
        };
        DebugPlugin.getDefault().addDebugEventListener(listener);
        breakpointListener = new IBreakpointsListener() {
            private void update() { if (!closed) commands.submit(DebugMonitorView.this::publish); }
            public void breakpointsAdded(IBreakpoint[] points) { update(); }
            public void breakpointsRemoved(IBreakpoint[] points, IMarkerDelta[] deltas) { update(); }
            public void breakpointsChanged(IBreakpoint[] points, IMarkerDelta[] deltas) { update(); }
        };
        DebugPlugin.getDefault().getBreakpointManager().addBreakpointListener(breakpointListener);
        browser.addDisposeListener(event -> {
            closed = true;
            DebugPlugin.getDefault().removeDebugEventListener(listener);
            DebugPlugin.getDefault().getBreakpointManager().removeBreakpointListener(breakpointListener);
            if (session != null) session.close();
            commands.shutdownNow();
        });
    }
    @Override String assistantContext() { return context; }
}
