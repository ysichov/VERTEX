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

/** Keeps the existing view ID so installed shortcuts survive the move to VERTEX Smart Debugger. */
public class DebugMonitorView extends ToolsView implements org.eclipse.ui.ISaveablePart2 {
    public static final String ID = "org.vertex.abap.ui.view.debugMonitor";
    private volatile VisualDebugSession session;
    private IDebugEventSetListener listener;
    private IBreakpointsListener breakpointListener;
    private final ExecutorService commands = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "VERTEX Smart Debugger"); t.setDaemon(true); return t;
    });
    private volatile boolean closed;
    /** Eclipse's debugger windows that a run with Visual off hides, and those it did hide, to bring back. */
    private static final String[] DEBUG_VIEWS = { "org.eclipse.debug.ui.DebugView", "org.eclipse.debug.ui.VariableView", "org.eclipse.debug.ui.ExpressionView" };
    private final java.util.List<String> quieted = new java.util.ArrayList<>();
    private volatile String context = "{}";
    @Override protected String title(String object) { return "VERTEX Smart Debugger"; }
    @Override protected String page() { return "assistant/visual-debug.html"; }
    @Override protected String accept(String path) {
        return path.startsWith("/sap/bc/adt/runtime/dumps") ? "application/atom+xml;type=feed" : super.accept(path);
    }
    @Override protected String initialLiteral() {
        var parsed = JsonParser.parseString(super.initialLiteral());
        JsonObject initial = parsed.isJsonNull() ? new JsonObject() : parsed.getAsJsonObject();
        initial.addProperty("type", VisualDebugSession.text(initial, "type").split("/")[0]);
        // The page reads the editor's line as "line" (VS Code's docked panel passes it so); ToolsView names it cursorLine.
        // Without it Variables said "line ? of ... is in no method".
        if (initial.has("cursorLine") && !initial.has("line")) initial.add("line", initial.get("cursorLine"));
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
        if (at < 0) throw new IllegalStateException("VERTEX Smart Debugger page has no " + tag);
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
        // A run with Visual off: Eclipse's own debugger windows - the Debug view's tree, Variables, Expressions - answer
        // every ADT suspend of its F5s too. The open ones are hidden while the run goes and brought back when it stops.
        new BrowserFunction(browser, "sdeQuietDebugViews") {
            @Override public Object function(Object[] args) {
                boolean quiet = args.length > 0 && Boolean.TRUE.equals(args[0]);
                browser.getDisplay().asyncExec(() -> {
                    if (closed) return;
                    org.eclipse.ui.IWorkbenchPage page = getSite().getPage();
                    if (quiet) {
                        for (String id : DEBUG_VIEWS) {
                            org.eclipse.ui.IViewReference view = page.findViewReference(id);
                            if (view != null) { quieted.add(id); page.hideView(view); }
                        }
                    } else {
                        for (String id : quieted) {
                            try { page.showView(id, null, org.eclipse.ui.IWorkbenchPage.VIEW_VISIBLE); }
                            catch (org.eclipse.ui.PartInitException e) { org.eclipse.jface.dialogs.MessageDialog.openError(browser.getShell(), "VERTEX", "Cannot bring back " + id + ": " + describe(e)); }
                        }
                        quieted.clear();
                    }
                });
                return null;
            }
        };
        // Where used on a breakpoint, as VS Code's host answers it: the point's line in its editor, then Backward Usage
        // Analysis from there - of the value chosen in Variables, else of the routine there.
        new BrowserFunction(browser, "sdeNativeBackward") {
            @Override public Object function(Object[] args) {
                String raw = args.length > 0 ? String.valueOf(args[0]) : "{}";
                browser.getDisplay().asyncExec(() -> {
                    if (closed) return;
                    try {
                        var o = raw.trim().startsWith("{") ? JsonParser.parseString(raw).getAsJsonObject() : new JsonObject();
                        String url = VisualDebugSession.text(o, "url"), program = VisualDebugSession.text(o, "program").toUpperCase(java.util.Locale.ROOT);
                        String type = url.contains("/oo/classes/") ? "CLAS" : url.contains("/functions/") ? "FUNC" : "PROG";
                        org.eclipse.ui.IEditorPart editor = navigate(program, type);
                        org.eclipse.ui.texteditor.ITextEditor text = org.eclipse.core.runtime.Adapters.adapt(editor, org.eclipse.ui.texteditor.ITextEditor.class);
                        if (text == null) throw new IllegalStateException("The editor of " + program + " does not offer its text.");
                        org.eclipse.jface.text.IDocument document = text.getDocumentProvider().getDocument(text.getEditorInput());
                        int line = Math.max(0, Math.min(document.getNumberOfLines() - 1, (o.has("line") ? o.get("line").getAsInt() : 1) - 1));
                        text.selectAndReveal(document.getLineOffset(line), 0);
                        ValueOriginHandler.open(getSite().getPage(), browser.getShell(), editor, "backward", VisualDebugSession.text(o, "variable"));
                    } catch (Exception e) {
                        String message = describe(e);
                        if (!browser.isDisposed()) browser.execute("if(typeof notice==='function')notice(" + AssistantBridge.quote(message) + ");");
                    }
                });
                return null;
            }
        };
        // Clear, as VS Code's host answers it: the page starts again for its object, as a new open does; the breakpoints and
        // the ADT session - this view's VisualDebugSession - stay.
        new BrowserFunction(browser, "sdeClear") {
            @Override public Object function(Object[] args) {
                browser.getDisplay().asyncExec(() -> { if (!closed && !browser.isDisposed()) loadPage(); });
                return null;
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
        // A program runs as Run As > ABAP Application runs it: ADT's own launch shortcut on the program's editor.
        if (command.equals("run") && kind.isEmpty()) { launchApplication(name); return "{}"; }
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
    private static final String RUN_APPLICATION = "com.sap.adt.sapgui.ui.runApplication";
    private void launchApplication(String program) throws Exception {
        org.eclipse.core.runtime.IConfigurationElement shortcut = null;
        for (org.eclipse.core.runtime.IConfigurationElement item : org.eclipse.core.runtime.Platform.getExtensionRegistry()
                .getConfigurationElementsFor("org.eclipse.debug.ui.launchShortcuts"))
            if (RUN_APPLICATION.equals(item.getAttribute("id"))) shortcut = item;
        if (shortcut == null) throw new IllegalStateException("ADT's ABAP Application launch (" + RUN_APPLICATION + ") is not installed.");
        org.eclipse.debug.ui.ILaunchShortcut launch = (org.eclipse.debug.ui.ILaunchShortcut) shortcut.createExecutableExtension("class");
        final Exception[] failure = new Exception[1];
        browser.getDisplay().syncExec(() -> {
            try { launch.launch(navigate(program, "PROG"), org.eclipse.debug.core.ILaunchManager.RUN_MODE); }
            catch (Exception e) { failure[0] = e; }
        });
        if (failure[0] != null) throw failure[0];
    }
    private void reply(int id, String answer, boolean error) {
        if (closed) return;
        browser.getDisplay().asyncExec(() -> { if (!closed && !browser.isDisposed()) browser.execute("vertexNativeReply(" + id + "," + AssistantBridge.quote(answer) + "," + error + ");"); });
    }
    private void publish() {
        if (closed || session == null) return;
        try {
            String snapshot = session.picture().toString();
            refreshStopped();
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
            // Closed in the middle of a run with Visual off: Eclipse's debugger windows it hid come back, or the Debug view
            // stayed hidden - no current line in the editor, no Resume (F8) without a debug session selected there.
            if (!quieted.isEmpty()) {
                java.util.List<String> back = new java.util.ArrayList<>(quieted); quieted.clear();
                org.eclipse.ui.IWorkbenchPage page = getSite().getPage();
                org.eclipse.swt.widgets.Display display = org.eclipse.swt.widgets.Display.getDefault();
                display.asyncExec(() -> {
                    for (String id : back) {
                        try { page.showView(id, null, org.eclipse.ui.IWorkbenchPage.VIEW_VISIBLE); }
                        catch (org.eclipse.ui.PartInitException e) { org.eclipse.jface.dialogs.MessageDialog.openError(display.getActiveShell(), "VERTEX", "Cannot bring back " + id + ": " + describe(e)); }
                    }
                });
            }
        });
    }
    @Override String assistantContext() { return context; }

    /*
     * Closing the window while the program stands stopped asks first: Exit program, leave it stopped in ADT, or keep the
     * window. Eclipse asks before a view closes only through the save protocol, so a stopped program is the window's
     * "unsaved" state - the tab shows its * while it stands.
     */
    private volatile String stoppedAt;
    private void refreshStopped() {
        String now = session == null ? null : session.stoppedAt();
        if (java.util.Objects.equals(now, stoppedAt)) return;
        stoppedAt = now;
        browser.getDisplay().asyncExec(() -> { if (!browser.isDisposed()) firePropertyChange(PROP_DIRTY); });
    }
    @Override public boolean isDirty() { return !closed && stoppedAt != null; }
    @Override public boolean isSaveOnCloseNeeded() { return isDirty(); }
    @Override public boolean isSaveAsAllowed() { return false; }
    @Override public void doSave(org.eclipse.core.runtime.IProgressMonitor monitor) { }
    @Override public void doSaveAs() { }
    @Override public int promptToSaveOnClose() {
        String at = session == null ? null : session.stoppedAt();
        if (at == null) return NO;
        org.eclipse.jface.dialogs.MessageDialog dialog = new org.eclipse.jface.dialogs.MessageDialog(browser.getShell(), "VERTEX Smart Debugger", null,
            "The program is still stopped in the debugger at " + at + ". Closing this window leaves it there, waiting in ADT.",
            org.eclipse.jface.dialogs.MessageDialog.WARNING, new String[] { "Exit program", "Leave it stopped", "Cancel" }, 0);
        int answer = dialog.open();
        if (answer == 0) {
            try { session.terminate(); }
            catch (Exception e) {
                org.eclipse.jface.dialogs.MessageDialog.openError(browser.getShell(), "VERTEX", "The program could not be ended: " + describe(e));
                return CANCEL;
            }
            return NO;
        }
        return answer == 1 ? NO : CANCEL;
    }
}
