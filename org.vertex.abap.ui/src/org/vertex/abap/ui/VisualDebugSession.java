package org.vertex.abap.ui;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.sap.adt.debugger.*;
import com.sap.adt.debugger.breakpoints.*;
import com.sap.adt.debugger.variables.*;
import org.eclipse.core.resources.IProject;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.debug.core.DebugEvent;
import org.eclipse.debug.core.DebugPlugin;
import org.eclipse.debug.core.model.IBreakpoint;
import org.eclipse.debug.core.model.IDebugTarget;
import org.eclipse.debug.core.model.IThread;

/** The Visual Debug wire contract over the existing Eclipse ADT debug model.
 * Commands are serialized by the view. Events only wake a pending step; no SAP
 * requests are made from an Eclipse debug-event callback. */
final class VisualDebugSession {
    private final IProject project;
    private final AtomicLong stop = new AtomicLong();
    private final Object changed = new Object();
    private volatile IAbapThread selected;
    private int ended;
    private final Map<String, IAbapVariable> variables = new HashMap<>();
    private final Map<String, String> modes = new HashMap<>();
    private JsonArray directVariables = new JsonArray();
    private volatile boolean closed;

    VisualDebugSession(IProject project) { this.project = project; }

    boolean event(DebugEvent event) {
        if (!(event.getSource() instanceof IAbapDebugElement element) || !project.equals(element.getProject())) return false;
        if (selected != null && element instanceof IAbapThread t && t != selected) return false;
        if (event.getSource() instanceof IAbapThread && (event.getKind() == DebugEvent.SUSPEND || event.getKind() == DebugEvent.TERMINATE)) {
            stop.incrementAndGet();
            synchronized (changed) { changed.notifyAll(); }
        }
        return true;
    }

    void close() { closed = true; synchronized (changed) { changed.notifyAll(); } }

    private IAbapDebuggerServices services() throws Exception {
        return AbapDebuggerPlugin.getDefault().getOrCreateDebuggerServices(project);
    }

    /** The live ADT threads of this project, found as Eclipse's Debug view finds them: through the
     * launch manager's debug targets. A session of another ABAP project is reported, not ignored. */
    private List<IAbapThread> threads() throws Exception {
        List<IAbapThread> mine = new ArrayList<>();
        List<String> others = new ArrayList<>();
        for (IDebugTarget target : DebugPlugin.getDefault().getLaunchManager().getDebugTargets()) {
            if (target.isTerminated() || target.isDisconnected()) continue;
            for (IThread item : target.getThreads()) {
                if (!(item instanceof IAbapThread t) || t.isTerminated() || t.isDisconnected()) continue;
                if (project.equals(t.getProject())) mine.add(t);
                else others.add(t.getProject() == null ? "?" : t.getProject().getName());
            }
        }
        if (mine.isEmpty() && !others.isEmpty()) throw new IllegalStateException("The ADT debug session belongs to project "
            + String.join(", ", others) + "; Visual Debug was opened for " + project.getName() + ". Open it from an editor of that project.");
        return mine;
    }

    private IAbapThread thread(boolean required) throws Exception {
        List<IAbapThread> found = threads();
        if (selected != null && !found.contains(selected)) { selected = null; ended++; variables.clear(); }
        if (selected == null && found.size() == 1) selected = found.get(0);
        if (selected == null && required) throw new IllegalStateException(found.isEmpty()
            ? "Start an ADT debug session first." : "Select the ADT debug thread in Visual Debug.");
        return selected;
    }

    private IAbapStackFrame frame() throws Exception {
        IAbapThread t = thread(true);
        if (!t.isSuspended()) throw new IllegalStateException("The ADT program is running.");
        IAbapStackFrame f = t.getActiveStackFrame();
        return f == null ? t.getTopStackFrame() : f;
    }

    JsonObject picture() throws Exception {
        IAbapThread t = thread(false);
        JsonObject result = object("system", project.getName(), "listening", t != null || services().isDebuggingEnabled(false), "ended", ended);
        JsonArray sessions = new JsonArray();
        for (IAbapThread item : threads()) sessions.add(object("id", item.getId(), "name", item.getName()));
        result.add("sessions", sessions);
        result.addProperty("selectedSession", t == null ? "" : t.getId());
        JsonArray points = new JsonArray();
        for (IAbapLineBreakpoint bp : breakpoints()) points.add(object("id", bp.getClientId(),
            "url", sourcePath(bp.getURI()), "line", bp.getLineNumber(), "name", bp.getObjectName(""),
            "objectType", sourcePath(bp.getURI()).contains("/classes/") ? "CLAS" : "PROG",
            "condition", bp.getCondition(), "active", bp.isEnabled(), "mode", modes.getOrDefault(bp.getClientId(), "stop")));
        result.add("breakpoints", points);
        result.add("stopped", null);
        if (t != null && t.isSuspended()) {
            IAbapStackFrame active = t.getActiveStackFrame();
            IAbapStackFrame[] stack = t.getStackFrames();
            JsonArray frames = new JsonArray();
            for (int i = 0; i < stack.length; i++) {
                IAbapStackFrame f = stack[i];
                int absoluteLine = f.getAbsoluteLineNumber();
                int frameLine = f.getLineNumber();
                int line = absoluteLine > 0 ? absoluteLine : frameLine;
                frames.add(object("n", i, "label", f.getProgramName() + ":" + line + " " + f.getEventType() + " " + f.getEventName(),
                    "url", sourcePath(f.getUri()), "line", line, "adtUri", String.valueOf(f.getUri()),
                    "adtAbsoluteLine", absoluteLine, "adtFrameLine", frameLine,
                    "current", active == null ? i == 0 : f.equals(active),
                    "program", f.getProgramName(), "include", f.getIncludeName(), "system", f.isSystemProgram(),
                    "unit", f.getEventName(), "unitType", String.valueOf(f.getEventType())));
            }
            String hit = "";
            for (IAbapBreakpoint bp : t.getBreakpoints()) { hit = bp.getClientId(); break; }
            JsonObject stopped = object("at", "ADT stop " + stop.get(), "breakpoint", hit, "predicted", false);
            stopped.add("frames", frames); result.add("stopped", stopped);
        }
        return result;
    }

    JsonObject command(String command, JsonObject args) throws Exception {
        switch (command) {
        case "picture": return picture();
        case "prepareRun":
            if (breakpoints().stream().noneMatch(IAbapLineBreakpoint::isEnabled)) throw new IllegalStateException("Set or activate a breakpoint before running.");
            services().setDebuggingEnabled(true, true, new NullProgressMonitor());
            check(services().synchronizeBreakpointsFull(DebugPlugin.getDefault().getBreakpointManager(), new NullProgressMonitor()));
            return object();
        case "session":
            selected = threads().stream()
                .filter(t -> t.getId().equals(text(args, "id"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("That ADT thread has ended."));
            variables.clear(); stop.incrementAndGet(); return picture();
        case "frame": {
            IAbapThread t = thread(true); IAbapStackFrame[] frames = t.getStackFrames(); int n = number(args, "n", 0);
            if (n < 0 || n >= frames.length) throw new IllegalArgumentException("That stack frame no longer exists.");
            if (!t.setActiveStackFrame(frames[n])) throw new IllegalStateException("ADT could not select this frame.");
            variables.clear(); return object();
        }
        case "scopes": {
            variables.clear(); JsonArray groups = new JsonArray(); JsonArray direct = new JsonArray();
            for (IAbapVariable v : frame().getVariables()) {
            if (v.getName().equals("<Enter variable>")) continue;
                variables.put(v.getId(), v);
                if (v instanceof IAbapStandardVariablesContainer && v.getId().startsWith("@")) {
                    String group = switch (v.getId()) { case "@GLOBALS" -> "Globals"; case "@LOCALS" -> "Locals"; case "@PARAMETERS" -> "Params"; default -> ""; };
                    if (!group.isEmpty()) groups.add(object("id", v.getId(), "name", group));
                }
                else if (!v.getName().equalsIgnoreCase("SY") && !v.getName().startsWith("SY-")) direct.add(shown(v));
            }
            directVariables = direct;
            if (!direct.isEmpty()) { JsonObject globals = object("id", "vertex:globals", "name", "Globals"); globals.add("children", direct); groups.add(globals); }
            JsonObject out = object(); out.add("groups", groups);
            if (!args.has("sy") || args.get("sy").getAsBoolean()) {
                IAbapVariable sy = frame().findVariable("SY"); out.add("sy", sy == null ? null : shown(sy));
            }
            return out;
        }
        case "children": {
            String id = text(args, "id");
            if (id.equals("vertex:globals")) { frame(); JsonObject out = object("id", id); out.add("children", directVariables); return out; }
            IAbapVariable v = variable(id); JsonArray children = new JsonArray();
            // Tables are paged through rows; expanding a value never reads an unbounded table.
            if (v.getValue() instanceof IAbapTableValue table) {
                for (IAbapVariable child : table.getVariables(table.getInitialOffset(), Math.min(100, table.getSize()))) children.add(shown(child));
            } else for (IAbapVariable child : v.getValue().getVariables()) children.add(shown(child));
            JsonObject out = object("id", id); out.add("children", children); return out;
        }
        case "vars": {
            JsonArray list = new JsonArray();
            for (JsonElement name : args.getAsJsonArray("names")) {
                IAbapVariable v = frame().findVariableWithoutCache(name.getAsString());
                if (v == null) throw new IllegalStateException("Variable is unavailable: " + name.getAsString());
                list.add(shown(v));
            }
            JsonObject out = object(); out.add("variables", list); return out;
        }
        case "value": { IAbapVariable v = variable(text(args, "name")); return object("name", v.getName(), "type", v.getReferenceTypeName(), "value", v.getValue().getValueString()); }
        case "rows": return rows(args);
        case "step": return step(text(args, "kind"), null, !text(args, "kind").equals("continue") || args.has("quick") && args.get("quick").getAsBoolean());
        case "settle": return object("settled", true);
        case "runTo": {
            JsonArray lines = args.has("lines") && args.get("lines").isJsonArray() ? args.getAsJsonArray("lines") : new JsonArray();
            if (lines.isEmpty() && args.has("line")) lines.add(args.get("line"));
            // The shared runner falls back to a real step when several targets are needed.
            if (lines.size() != 1) return object("placed", false);
            if (!thread(true).canStepRunToLine()) return object("placed", false);
            JsonObject out = step("runTo", URI.create(text(args, "url").split("#")[0] + "#start=" + lines.get(0).getAsInt() + ",0"), true);
            out.addProperty("placed", true); return out;
        }
        case "detach": case "stop": {
            IAbapThread t = thread(false);
            if (t == null) { services().disableDebugging(new NullProgressMonitor()); return object(); }
            if (!t.canDisconnect()) throw new IllegalStateException("ADT cannot detach this session.");
            t.disconnect(); return object();
        }
        case "terminate": {
            IAbapThread t = thread(true);
            if (!t.canTerminate()) throw new IllegalStateException("ADT cannot terminate this session.");
            t.terminate(); return object();
        }
        case "set": return set(args);
        case "clear": case "activate": {
            String id = text(args, "id");
            for (IAbapLineBreakpoint bp : breakpoints()) if (id.isEmpty() || bp.getClientId().equals(id)) {
                if (command.equals("clear")) { check(services().deleteBreakpoint(bp, DebugPlugin.getDefault().getBreakpointManager(), new NullProgressMonitor())); modes.remove(bp.getClientId()); }
                else bp.setEnabled(!args.has("active") || args.get("active").getAsBoolean());
            }
            return object();
        }
        default: throw new IllegalArgumentException("Unknown ADT debug command: " + command);
        }
    }

    private JsonObject step(String kind, URI target, boolean wait) throws Exception {
        IAbapThread t = thread(true); if (!t.isSuspended()) throw new IllegalStateException("The program is already running.");
        long before = stop.get(), started = System.nanoTime(); variables.clear();
        switch (kind) {
        case "into": if (!t.canStepInto()) throw new IllegalStateException("Step Into is unavailable."); t.stepInto(); break;
        case "over": if (!t.canStepOver()) throw new IllegalStateException("Step Over is unavailable."); t.stepOver(); break;
        case "out": if (!t.canStepReturn()) throw new IllegalStateException("Return is unavailable."); t.stepReturn(); break;
        case "continue": if (!t.canResume()) throw new IllegalStateException("Continue is unavailable."); t.resume(); break;
        case "runTo": if (!t.canStepRunToLine()) return object("placed", false); t.stepRunToLine(target); break;
        default: throw new IllegalArgumentException("Unknown step " + kind);
        }
        if (!wait) return object("ended", t.isTerminated(), "sap", (System.nanoTime() - started) / 1000000);
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(60);
        synchronized (changed) {
            while (!closed && !t.isTerminated() && !t.isDisconnected() && !(stop.get() > before && t.isSuspended())) {
                if (System.nanoTime() >= deadline) throw new IllegalStateException("ADT is still running; waiting for a breakpoint. Recording resumes on the next stop.");
                changed.wait(200);
            }
        }
        if (closed) throw new InterruptedException("Visual Debug closed.");
        return object("ended", t.isTerminated() || t.isDisconnected(), "sap", (System.nanoTime() - started) / 1000000);
    }

    private JsonObject rows(JsonObject args) throws Exception {
        IAbapVariable v = variable(text(args, "id").replaceAll("\\[\\]$", ""));
        if (!(v.getValue() instanceof IAbapTableValue table)) throw new IllegalArgumentException("This variable is not a table.");
        int from = Math.max(1, number(args, "from", 1)), count = Math.max(0, Math.min(table.getSize() - from + 1, Math.min(200, number(args, "to", from + 99) - from + 1)));
        JsonArray values = new JsonArray();
        for (IAbapVariable row : count == 0 ? new IAbapVariable[0] : table.getVariables(table.getInitialOffset() + from - 1, count)) {
            if (row.getValue().hasVariables()) {
                JsonObject fields = object(); for (IAbapVariable field : row.getValue().getVariables()) fields.addProperty(field.getName(), field.getValue().getValueString());
                values.add(fields);
            } else values.add(row.getValue().getValueString());
        }
        JsonObject out = object("id", v.getId(), "name", v.getName(), "type", v.getReferenceTypeName(), "from", from, "rows", table.getSize()); out.add("shown", values); return out;
    }

    private IAbapVariable variable(String id) throws Exception {
        IAbapStackFrame f = frame(); IAbapVariable value = variables.get(id);
        if (value == null || value.isOutdated() || value.getStackFrame() != f) value = f.findVariable(id);
        if (value == null) throw new IllegalArgumentException("Variable is unavailable: " + id);
        return value;
    }

    private JsonObject shown(IAbapVariable v) throws Exception {
        variables.put(v.getId(), v);
        String meta = v.getMetaType().toString().toLowerCase(java.util.Locale.ROOT);
        JsonObject out = object("id", v.getId(), "name", v.getName(), "meta", meta, "type", v.getReferenceTypeName(),
            "technical", v.getTechnicalTypeName(), "value", v.getValue().getValueString(), "access", String.valueOf(v.getAccessKind()).toLowerCase(java.util.Locale.ROOT));
        if (v.getValue() instanceof IAbapTableValue table) out.addProperty("lines", table.getSize());
        return out;
    }

    private List<IAbapLineBreakpoint> breakpoints() {
        List<IAbapLineBreakpoint> result = new ArrayList<>();
        for (IBreakpoint bp : DebugPlugin.getDefault().getBreakpointManager().getBreakpoints())
            if (bp instanceof IAbapLineBreakpoint line && project.equals(line.getProject())) result.add(line);
        return result;
    }

    private JsonObject set(JsonObject args) throws Exception {
        String url = text(args, "url"), condition = text(args, "condition"), mode = text(args, "mode"); int line = number(args, "line", 0);
        if (!url.startsWith("/sap/bc/adt/") || url.contains("..") || line < 1) throw new IllegalArgumentException("A source URI and a positive line are required.");
        IAbapDebuggerServices service = services();
        IAbapLineBreakpoint point = breakpoints().stream().filter(b -> sourcePath(b.getURI()).equals(url) && b.getLineNumber() == line).findFirst().orElse(null);
        if (point == null) {
            String[] parts = url.split("/"); String name = parts.length > 3 ? parts[parts.length - 3].toUpperCase(java.util.Locale.ROOT) : "";
            point = service.createLineBreakpoint(project, URI.create(url), name, line, condition, false, false, false);
            check(service.addBreakpoint(point, DebugPlugin.getDefault().getBreakpointManager(), new NullProgressMonitor()));
        } else {
            point.setCondition(condition);
            check(service.synchronizeBreakpointsPartial(List.of(point), DebugPlugin.getDefault().getBreakpointManager(), new NullProgressMonitor()));
        }
        modes.put(point.getClientId(), mode.isEmpty() ? "stop" : mode);
        return object("id", point.getClientId());
    }

    static String sourcePath(URI uri) { return uri == null ? "" : uri.toString().split("#")[0].split("\\?")[0]; }
    static String text(JsonObject o, String key) { return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : ""; }
    static int number(JsonObject o, String key, int fallback) { return o.has(key) ? o.get(key).getAsInt() : fallback; }
    static JsonObject object(Object... values) {
        JsonObject out = new JsonObject();
        for (int i = 0; i < values.length; i += 2) {
            String key = (String) values[i]; Object value = values[i + 1];
            if (value instanceof Number n) out.addProperty(key, n);
            else if (value instanceof Boolean b) out.addProperty(key, b);
            else out.addProperty(key, value == null ? "" : value.toString());
        }
        return out;
    }
    private static void check(IStatus status) { if (!status.isOK()) throw new IllegalStateException(status.getMessage()); }
}
