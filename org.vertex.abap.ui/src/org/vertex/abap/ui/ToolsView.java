package org.vertex.abap.ui;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.swt.browser.BrowserFunction;

/** One workspace; all requests use the selected object's ADT session. */
public class ToolsView extends ChatView {
    public static final String ID = "org.vertex.abap.ui.view.tools";
    /** Latest small view-specific context, supplied by the nested result frame. */
    private volatile String vertexContext = "{}";
    @Override protected String page() { return "resources/tools.html"; }
    @Override protected String projectName() { return part(2); }
    @Override protected String title(String object) { return "VERTEX Tools"; }
    @Override protected String initialLiteral() {
        return part(0) == null ? "null" : "{\"name\":" + AssistantBridge.quote(part(0))
            + ",\"type\":" + AssistantBridge.quote(part(1) == null ? "CLAS" : part(1)) + "}";
    }
    @Override protected String readResource(String path) throws IOException {
        String value = super.readResource(path);
        if (!path.equals("resources/tools.html")) return value;
        StringBuilder bundle = new StringBuilder("{");
        for (String service : new String[] {"chat", "table", "metrics", "versions", "source"}) {
            if (bundle.length() > 1) bundle.append(",");
            bundle.append(AssistantBridge.quote(service)).append(":")
                .append(AssistantBridge.quote(super.readResource("resources/" + service + ".html"))
                    .replace("<", "\\u003c").replace("/", "\\u002f"));
        }
        bundle.append("}");
        return value.replace("/*OBJECT_MODEL*/", super.readResource("resources/object-tools.js"))
            .replace("/*TOOL_ROUTES*/", super.readResource("resources/tool-routes.js"))
            .replace("/*BUNDLE*/{}", bundle.toString());
    }
    @Override protected String accept(String path) {
        return path.startsWith("/sap/bc/adt/vertex/") ? null : super.accept(path);
    }
    @Override protected void addFunctions() {
        super.addFunctions();
        new BrowserFunction(browser, "sdeVertexContext") {
            @Override public Object function(Object[] args) {
                String value = args.length > 0 && args[0] != null ? String.valueOf(args[0]).trim() : "{}";
                // This is JSON made by tools.html, not a command. Keep the bridge
                // bounded nevertheless: source text belongs in an explicit fragment.
                if (value.length() <= 16000 && value.startsWith("{") && value.endsWith("}")) {
                    vertexContext = value;
                }
                return null;
            }
        };
        new BrowserFunction(browser, "sdeWorkspace") {
            @Override public Object function(Object[] args) {
                String path = args.length > 0 ? String.valueOf(args[0]) : "";
                String body = args.length > 1 && args[1] != null ? String.valueOf(args[1]) : null;
                queue(() -> {
                    if (path.equals("project")) return abapProject().getName();
                    String route = body == null ? "(about|requests|(table|join|metrics|flow|class|package|versions|review|prepare)/[^?]+)"
                        : "(review|prepare)/[^?]+";
                    if (!path.matches("/sap/bc/adt/vertex/" + route + "(\\?.*)?")
                        || path.contains("..") || path.contains("#") || path.contains("\\")
                        || path.toLowerCase().contains("%2e") || path.toLowerCase().contains("%5c"))
                        throw new IllegalArgumentException("Unsupported VERTEX resource.");
                    return body == null ? read(path) : write(path, body);
                });
                return null;
            }
        };
        new BrowserFunction(browser, "sdeAsset") {
            @Override public Object function(Object[] args) {
                final String asset = args.length > 0 ? String.valueOf(args[0]) : "";
                queue(() -> {
                    if (!asset.equals("mermaid")) throw new IllegalArgumentException("Unknown asset.");
                    try { return readResource("resources/mermaid.min.js"); }
                    catch (IOException e) { throw new IllegalStateException(e); }
                });
                return null;
            }
        };
        new BrowserFunction(browser, "sdeSource") {
            @Override public Object function(Object[] args) {
                final String name = args.length > 0 ? String.valueOf(args[0]).toUpperCase() : "";
                final String type = args.length > 1 ? String.valueOf(args[1]).toUpperCase() : "";
                queue(() -> {
                    String path;
                    if (type.equals("PROG")) path = "/sap/bc/adt/programs/programs/" + name + "/source/main";
                    else if (type.equals("CLAS")) path = "/sap/bc/adt/oo/classes/" + name + "/source/main";
                    else if (type.equals("FUNC")) path = "/sap/bc/adt/functions/modules/" + name + "/source/main";
                    else throw new IllegalArgumentException("Source preview is available for programs, classes and function modules.");
                    String source = read(path);
                    return "{\"object_name\":" + AssistantBridge.quote(name)
                        + ",\"object_type\":" + AssistantBridge.quote(type)
                        + ",\"source\":" + AssistantBridge.quote(source) + "}";
                });
                return null;
            }
        };
        new BrowserFunction(browser, "sdeOpenEditor") {
            @Override public Object function(Object[] args) {
                final String name = args.length > 0 ? String.valueOf(args[0]).toUpperCase() : "";
                final String type = args.length > 1 ? String.valueOf(args[1]).toUpperCase() : "";
                // Not queue(): its answer goes to the page's pending result, and
                // the source page is not waiting for one. A failure is a dialog.
                browser.getDisplay().asyncExec(() -> {
                    if (browser.isDisposed()) return;
                    String answer;
                    try { answer = openEditor(name, type); }
                    catch (RuntimeException e) { answer = "ERROR:" + describe(e); }
                    if (answer.startsWith("ERROR:")) {
                        MessageDialog.openError(browser.getShell(), "VERTEX", answer.substring(6));
                    }
                });
                return null;
            }
        };
    }
    private static final Pattern REF = Pattern.compile("<adtcore:objectReference\\b[^>]*>");
    private static final Pattern ATTR = Pattern.compile("adtcore:(uri|name|type)=\"([^\"]*)\"");
    /** The same ADT editor a double-click in the Project Explorer opens. */
    private String openEditor(String name, String type) {
        if (!name.matches("[A-Z0-9_/]{1,40}")) return "ERROR:Invalid object name.";
        String adtType, uri;
        if (type.equals("PROG")) { adtType = "PROG/P"; uri = "/sap/bc/adt/programs/programs/" + encode(name); }
        else if (type.equals("CLAS")) { adtType = "CLAS/OC"; uri = "/sap/bc/adt/oo/classes/" + encode(name); }
        else if (type.equals("FUNC")) {
            // A function module's URI goes through its group, which the page does not know.
            adtType = "FUGR/FF"; uri = null;
            String found = read("/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&maxResults=20&objectType=FUGR/FF&query="
                + encode(name));
            Matcher m = REF.matcher(found);
            while (uri == null && m.find()) {
                String refUri = null, refName = null;
                Matcher a = ATTR.matcher(m.group());
                while (a.find()) {
                    if (a.group(1).equals("uri")) refUri = a.group(2);
                    if (a.group(1).equals("name")) refName = a.group(2);
                }
                if (name.equals(refName)) uri = refUri;
            }
            if (uri == null) return "ERROR:Function module " + name + " was not found.";
        }
        else return "ERROR:Only programs, classes and function modules open from here.";
        return open("{\"uri\":" + AssistantBridge.quote(uri) + ",\"name\":" + AssistantBridge.quote(name)
            + ",\"type\":" + AssistantBridge.quote(adtType) + "}", browser.getDisplay());
    }
    private static String encode(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20");
    }
    String assistantContext() { return vertexContext; }
    @Override void prompt(String text) {
        browser.execute("document.getElementById('conversation').contentWindow.document.getElementById('prompt').value="
            + AssistantBridge.quote(text));
    }
}
