package org.vertex.abap.ui;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.widgets.Display;

/** One private child process per request; lifetime is owned by its view. */
final class AssistantBridge implements AutoCloseable {
    private static final List<String> FILES = List.of("bridge.js", "assistant.js", "mcp.js", "selector.js", "versions.js", "chat.js", "session-log.js", "direct-search.js", "object-tools.js");
    private static final String OBJECT = "/sap/bc/adt/(programs/programs/[^/?#]+|oo/classes/[^/?#]+|functions/groups/[^/?#]+/fmodules/[^/?#]+)";
    private final PageView view;
    private final Display display;
    private final ExecutorService workers = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "VERTEX Assistant"); t.setDaemon(true); return t;
    });
    private final Set<Process> children = ConcurrentHashMap.newKeySet();
    private volatile boolean closed;

    AssistantBridge(PageView view) {
        this.view = view;
        this.display = view.browser.getDisplay();
        new BrowserFunction(view.browser, "sdeModels") {
            @Override public Object function(Object[] args) { submit("models", args); return null; }
        };
        new BrowserFunction(view.browser, "sdeAsk") {
            @Override public Object function(Object[] args) { submit("ask", args); return null; }
        };
        view.browser.addDisposeListener(e -> close());
    }

    private void submit(String call, Object[] args) {
        String assistant = text(args, 0);
        if (!assistant.equals("codex") && !assistant.equals("claude")) return;
        String service = view instanceof SelectorView ? "selector" : view instanceof ChatView ? "chat" : "versions";
        String state = text(args, 3).isBlank() ? "{}" : text(args, 3);
        if (view instanceof ChatView && call.equals("ask")) {
            // Read here, on the UI thread, at the moment the question is sent.
            String editor = ((ChatView) view).editorContext();
            state = "{\"editor\":" + editor + (state.trim().equals("{}") ? "}" : "," + state.trim().substring(1));
        }
        if (view instanceof ToolsView && call.equals("ask")) {
            String context = ((ToolsView) view).assistantContext().trim();
            if (context.startsWith("{") && context.endsWith("}") && !context.equals("{}")) {
                state = context.substring(0, context.length() - 1)
                    + (state.trim().equals("{}") ? "}" : "," + state.trim().substring(1));
            }
        }
        String request = "{\"call\":" + quote(call) + ",\"assistant\":" + quote(assistant)
                + ",\"service\":" + quote(service) + ",\"executable\":" + quote(AssistantPreferences.setting(assistant))
                + ",\"model\":" + quote(text(args, 1)) + ",\"text\":" + quote(text(args, 2))
                + ",\"log\":" + quote(view instanceof ChatView ? AssistantPreferences.setting("logPath") : "")
                + ",\"session\":" + quote(text(args, 4))
                + ",\"project\":" + quote(view instanceof ChatView && call.equals("ask") ? view.abapProject().getName() : "")
                + ",\"logInclude\":{\"questions\":" + AssistantPreferences.flag("logQuestions")
                + ",\"answers\":" + AssistantPreferences.flag("logAnswers")
                + ",\"tools\":" + AssistantPreferences.flag("logTools")
                + ",\"code\":" + AssistantPreferences.flag("logCode") + "}"
                + ",\"personalInstructions\":" + AssistantPreferences.flag("personalInstructions")
                + ",\"state\":" + state + "}";
        if (!closed) workers.submit(() -> run(call, assistant, service, request));
    }

    private void run(String call, String assistant, String service, String request) {
        Path directory = null;
        Process child = null;
        ScheduledExecutorService deadline = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "VERTEX Assistant deadline"); t.setDaemon(true); return t;
        });
        try {
            directory = Files.createTempDirectory("vertex-eclipse-");
            for (String file : FILES) {
                Files.writeString(directory.resolve(file), view.readResource("assistant/" + file), StandardCharsets.UTF_8);
            }
            ProcessBuilder builder = new ProcessBuilder(AssistantPreferences.setting("node"), directory.resolve("bridge.js").toString());
            builder.directory(directory.toFile());
            child = builder.start();
            children.add(child);
            if (closed) { stop(child); return; }
            Process running = child;
            deadline.schedule(() -> stop(running), 300, TimeUnit.SECONDS);
            StringBuffer stderr = new StringBuffer();
            workers.submit(() -> {
                try (Reader reader = new InputStreamReader(running.getErrorStream(), StandardCharsets.UTF_8)) {
                    char[] buffer = new char[1024]; int n;
                    while ((n = reader.read(buffer)) >= 0) {
                        synchronized (stderr) {
                            stderr.append(buffer, 0, n);
                            if (stderr.length() > 4000) stderr.delete(0, stderr.length() - 4000);
                        }
                    }
                } catch (IOException ignored) {}
            });
            try (BufferedWriter input = new BufferedWriter(new OutputStreamWriter(child.getOutputStream(), StandardCharsets.UTF_8));
                 BufferedReader output = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8))) {
                send(input, encode(request));
                String line;
                while ((line = output.readLine()) != null) {
                    int tab = line.indexOf('\t');
                    if (tab < 0) continue;
                    String body = decode(line.substring(tab + 1));
                    if (line.startsWith("RESULT\t")) { deliver(body); return; }
                    if (line.startsWith("OPEN\t")) {
                        int newline = body.indexOf('\n');
                        if (newline < 1) throw new IOException("Invalid SAP bridge request.");
                        String answer = view instanceof ChatView
                            ? ((ChatView) view).open(body.substring(newline + 1), display)
                            : "ERROR:This window cannot open objects.";
                        send(input, body.substring(0, newline) + "\t" + encode(answer));
                        continue;
                    }
                    if (line.startsWith("READ\t")) {
                        int newline = body.indexOf('\n');
                        if (newline < 1) throw new IOException("Invalid SAP bridge request.");
                        String path = body.substring(newline + 1);
                        String answer;
                        try {
                            // Only the read-only resources used by this window's tools.
                            boolean allowed = service.equals("selector")
                                ? path.matches("/sap/bc/adt/vertex/join/[^?]+(?:\\?t[0-9]+=.*)?")
                                : service.equals("chat")
                                ? path.matches("/sap/bc/adt/repository/informationsystem/search\\?operation=quickSearch&query=[A-Za-z0-9_%*+]+&maxResults=[0-9]+&objectType=(PROG%2FP|CLAS%2FOC|FUGR%2FFF)")
                                  || path.matches(OBJECT + "/(source/main|includes/(definitions|implementations|macros|testclasses))")
                                : path.startsWith("/sap/bc/adt/vertex/versions/") || path.startsWith("/sap/bc/adt/vertex/review/");
                            if (!allowed || path.contains("..") || path.matches("(?i).*([?&])(rows|count)=.*"))
                                throw new IllegalArgumentException("Resource not permitted for the assistant.");
                            answer = view.assistantRead(path, display);
                        } catch (Exception e) { answer = "ERROR:" + PageView.describe(e); }
                        send(input, body.substring(0, newline) + "\t" + encode(answer));
                    }
                }
            }
            throw new IOException("Assistant process ended without a result (or timed out). " + stderr);
        } catch (Exception e) {
            deliver("{\"call\":" + quote(call) + ",\"assistant\":" + quote(assistant)
                    + ",\"error\":" + quote("Eclipse Assistant: " + PageView.describe(e)
                    + " Check Preferences > VERTEX Assistant.") + "}");
        } finally {
            deadline.shutdownNow();
            if (child != null) { stop(child); children.remove(child); }
            if (directory != null) {
                // Only the known files created in our own temporary directory.
                for (String file : FILES) {
                    try { Files.deleteIfExists(directory.resolve(file)); } catch (IOException ignored) {}
                }
                try { Files.deleteIfExists(directory); } catch (IOException ignored) {}
            }
        }
    }

    private void deliver(String json) {
        if (closed || display.isDisposed()) return;
        display.asyncExec(() -> {
            if (!closed && !view.browser.isDisposed()) view.browser.execute("sdeAssistant(" + quote(json) + ")");
        });
    }

    private static void stop(Process process) {
        process.descendants().forEach(p -> p.destroyForcibly());
        process.destroyForcibly();
    }
    @Override public void close() { closed = true; children.forEach(AssistantBridge::stop); workers.shutdownNow(); }
    private static String text(Object[] args, int n) { return n < args.length && args[n] != null ? args[n].toString() : ""; }
    private static String encode(String value) { return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)); }
    private static String decode(String value) { return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8); }
    private static void send(BufferedWriter writer, String line) throws IOException { writer.write(line); writer.newLine(); writer.flush(); }
    static String quote(String text) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : text.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c < 32 || c == '\u2028' || c == '\u2029') out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
}
