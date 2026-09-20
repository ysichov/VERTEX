package org.vertex.abap.ui;

import java.io.IOException;
import org.eclipse.swt.browser.BrowserFunction;

/** One workspace; all requests use the selected object's ADT session. */
public class ToolsView extends ChatView {
    public static final String ID = "org.vertex.abap.ui.view.tools";
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
    }
    @Override void prompt(String text) {
        browser.execute("document.getElementById('conversation').contentWindow.document.getElementById('prompt').value="
            + AssistantBridge.quote(text));
    }
}
