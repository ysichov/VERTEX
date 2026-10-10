package org.vertex.abap.ui;

import java.io.IOException;
import java.util.regex.Pattern;
import java.util.regex.Matcher;
import org.eclipse.core.runtime.Adapters;
import org.eclipse.jface.text.IDocument;
import org.eclipse.jface.text.ITextSelection;
import org.eclipse.jface.text.ITextOperationTarget;
import org.eclipse.jface.text.ITextViewer;
import org.eclipse.jface.text.IViewportListener;
import org.eclipse.ui.IPartListener2;
import org.eclipse.ui.IWorkbenchPartReference;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.ISelectionListener;
import org.eclipse.ui.texteditor.ITextEditor;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.swt.browser.BrowserFunction;

/** One workspace; all requests use the selected object's ADT session. */
public class ToolsView extends ChatView {
    public static final String ID = "org.vertex.abap.ui.view.tools";
    /** Latest small view-specific context, supplied by the nested result frame. */
    private volatile String vertexContext = "{}";
    private ISelectionListener editorSelection;
    private long sourceNavigationUntil;
    private String latestCursor="";
    private ITextViewer scrolledViewer;
    private IEditorPart scrolledEditor;
    private IViewportListener viewportListener;
    private IPartListener2 editorActivation;
    @Override protected String page() { return "resources/tools.html"; }
    @Override protected String projectName() { return part(2); }
    @Override protected String title(String object) { return "VERTEX Tools"; }
    @Override protected String initialLiteral() {
        return part(0) == null ? "null" : "{\"name\":" + AssistantBridge.quote(part(0))
            + ",\"type\":" + AssistantBridge.quote(part(1) == null ? "CLAS" : part(1)) + ",\"boundObject\":true,\"cursorLine\":" + editorLine() + "}";
    }
    @Override protected String readResource(String path) throws IOException {
        String value = super.readResource(path);
        if (!path.equals("resources/tools.html")) return value;
        StringBuilder bundle = new StringBuilder("{");
        for (String service : new String[] {"chat", "table", "metrics", "versions"}) {
            if (bundle.length() > 1) bundle.append(",");
            bundle.append(AssistantBridge.quote(service)).append(":")
                .append(AssistantBridge.quote(super.readResource("resources/" + service + ".html")
                    .replace("/*VERTEX_LENS*/", super.readResource("resources/vertex-lens.js"))
                    .replace("</head>", "<style>" + super.readResource("resources/vertex-controls.css") + "</style></head>"))
                    .replace("<", "\\u003c").replace("/", "\\u002f"));
        }
        bundle.append("}");
        return value.replace("/*OBJECT_MODEL*/", super.readResource("resources/object-tools.js"))
            .replace("/*TOOL_ROUTES*/", super.readResource("resources/tool-routes.js"))
            .replace("/*BUNDLE*/{}", bundle.toString())
            .replace("/*ECLIPSE_FRONTEND*/", super.readResource("resources/eclipse-frontend.js").replace("/*FRONTEND_BUNDLE*/", AssistantBridge.quote(super.readResource("resources/vertex-frontend.js")).replace("<", "\\u003c")));
    }
    @Override protected String accept(String path) {
        if (path.startsWith("/sap/bc/adt/vertex/")) return null;
        // A version feed answers only to its own media type; a version's content is source text.
        if (path.split("\\?", 2)[0].endsWith("/versions")) return "application/atom+xml;type=feed";
        return path.contains("/source/") ? "text/plain" : "*/*";
    }
    @Override protected void addContentHandlers(com.sap.adt.communication.resources.IRestResource resource) {
        super.addContentHandlers(resource);
        addAdtTextHandlers(resource);
    }
    @Override protected void addFunctions() {
        super.addFunctions();
        addAnalysisFunctions();
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
                    String route = body == null ? "(about|requests|(table|join|metrics|flow|class|package|versions|review)/[^?]+)"
                        : "review/[^?]+";
                    // The object field's mask search: ADT's quick search, read only.
                    boolean search = body == null && path.matches("/sap/bc/adt/repository/informationsystem/search\\?operation=quickSearch&maxResults=\\d{1,3}&objectType=[A-Z]{4}%2F[A-Z]{1,2}&query=[A-Z0-9_%*+$]{1,80}");
                    if (!search && !path.matches("/sap/bc/adt/vertex/" + route + "(\\?.*)?")
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
        new BrowserFunction(browser, "sdeOpenToolSource") {
            @Override public Object function(Object[] args) {
                String request=args.length>0?String.valueOf(args[0]):"{}";
                String name=jsonText(request,"name").toUpperCase(),type=jsonText(request,"type").toUpperCase(),method=jsonText(request,"method");
                Matcher line=Pattern.compile("\"line\"\\s*:\\s*(\\d+)").matcher(request);
                int requested=line.find()?Integer.parseInt(line.group(1)):0;
                browser.getDisplay().asyncExec(()->{
                    if(browser.isDisposed())return;
                    sourceNavigationUntil=System.currentTimeMillis()+700;
                    String answer=openEditor(name,type.isEmpty()?"CLAS":type);
                    if(answer.startsWith("ERROR:")){
                        navigationDiagnostic("open " + type + " " + name + " requested=" + requested + " failed: " + answer.substring(6));
                        MessageDialog.openError(browser.getShell(),"VERTEX",answer.substring(6));return;
                    }
                    IEditorPart editor=getSite().getPage().getActiveEditor();ITextEditor text=Adapters.adapt(editor,ITextEditor.class);
                    if(text==null||text.getDocumentProvider()==null){
                        navigationDiagnostic("open " + type + " " + name + " requested=" + requested + " has no active text editor");return;
                    }
                    IDocument document=text.getDocumentProvider().getDocument(editor.getEditorInput());if(document==null){
                        navigationDiagnostic("open " + type + " " + name + " requested=" + requested + " has no document");return;
                    }
                    int target=requested;
                    if(target<1&&!method.isEmpty()){
                        String[] rows=document.get().split("\\r?\\n");
                        Pattern declaration=Pattern.compile("^\\s*(METHOD|FORM|FUNCTION|MODULE)\\s+"+Pattern.quote(method)+"(?:\\s|\\.)",Pattern.CASE_INSENSITIVE);
                        for(int i=0;i<rows.length;i++)if(declaration.matcher(rows[i]).find()){target=i+1;break;}
                    }
                    try{
                        int editorTarget=Math.max(1,Math.min(document.getNumberOfLines(),target));
                        text.selectAndReveal(document.getLineOffset(editorTarget-1),0);
                        navigationDiagnostic("open " + type + " " + name + " requested=" + requested +
                            " editor=" + editor.getTitle() + " lines=" + document.getNumberOfLines() +
                            " selected=" + editorTarget + " actual=" + editorLine());
                    }
                    catch(org.eclipse.jface.text.BadLocationException e){
                        navigationDiagnostic("open " + type + " " + name + " requested=" + requested + " failed: " + e.getMessage());
                        MessageDialog.openError(browser.getShell(),"VERTEX",e.getMessage());
                    }
                });return null;
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
    /** The same ADT editor a double-click in the Project Explorer opens. */
    private String openEditor(String name, String type) {
        if (!name.matches("[A-Z0-9_/]{1,40}")) return "ERROR:Invalid object name.";
        if (!type.equals("PROG") && !type.equals("CLAS") && !type.equals("FUNC"))
            return "ERROR:Only programs, classes and function modules open from here.";
        String[] object;
        try { object = adtObject(name, type); }
        catch (IllegalStateException e) { return "ERROR:" + describe(e); }
        return open("{\"uri\":" + AssistantBridge.quote(object[0]) + ",\"name\":" + AssistantBridge.quote(name)
            + ",\"type\":" + AssistantBridge.quote(object[1]) + "}", browser.getDisplay());
    }
    private static String jsonText(String request,String key){
        Matcher match=Pattern.compile("\""+Pattern.quote(key)+"\"\\s*:\\s*\"([^\"]*)\"").matcher(request);
        return match.find()?match.group(1):"";
    }
    private void navigationDiagnostic(String message){
        browser.execute("if(typeof sdeNavigationResult==='function')sdeNavigationResult("+AssistantBridge.quote(message)+");");
    }
    private int editorLine(){
        IEditorPart editor=getSite().getPage().getActiveEditor();ITextEditor text=editor==null?null:Adapters.adapt(editor,ITextEditor.class);
        Object selected=text==null||text.getSelectionProvider()==null?null:text.getSelectionProvider().getSelection();
        return selected instanceof ITextSelection?((ITextSelection)selected).getStartLine()+1:1;
    }
    @Override public void createPartControl(org.eclipse.swt.widgets.Composite parent){
        super.createPartControl(parent);
        editorSelection=(part,selection)->{
            if(!(part instanceof IEditorPart)||!(selection instanceof ITextSelection)||browser.isDisposed()||System.currentTimeMillis()<sourceNavigationUntil)return;
            AdtEditor object=AdtEditor.of((IEditorPart)part);if(object==null)return;
            if(object.project!=null&&!object.project.getName().equals(projectName()))return;
            ITextSelection range=(ITextSelection)selection;String type=object.type==null?"":object.type.split("/")[0];
            String payload="{\"name\":"+AssistantBridge.quote(object.name)+",\"type\":"+AssistantBridge.quote(type)+",\"line\":"+(range.getStartLine()+1)+",\"endLine\":"+(range.getEndLine()+1)+",\"userFocus\":true}";
            if(payload.equals(latestCursor))return;latestCursor=payload;
            browser.getDisplay().timerExec(80,()->{if(!browser.isDisposed()&&payload.equals(latestCursor))browser.execute("if(typeof sdeCodeCursor==='function')sdeCodeCursor("+payload+");");});
        };
        getSite().getPage().addPostSelectionListener(editorSelection);
        // Scrolling the editor moves Tools Logic too: the line a third down the visible range, as in VS Code.
        viewportListener=offset->{
            if(scrolledViewer==null||scrolledEditor==null||browser.isDisposed()||System.currentTimeMillis()<sourceNavigationUntil)return;
            AdtEditor object=AdtEditor.of(scrolledEditor);if(object==null)return;
            if(object.project!=null&&!object.project.getName().equals(projectName()))return;
            int top=scrolledViewer.getTopIndex(),bottom=scrolledViewer.getBottomIndex(),line=top+(bottom-top)/3+1;
            String type=object.type==null?"":object.type.split("/")[0];
            String payload="{\"name\":"+AssistantBridge.quote(object.name)+",\"type\":"+AssistantBridge.quote(type)+",\"line\":"+line+",\"endLine\":"+line+",\"scrollOnly\":true,\"userFocus\":"+(getSite().getPage().getActiveEditor()==scrolledEditor)+"}";
            if(payload.equals(latestCursor))return;latestCursor=payload;
            browser.getDisplay().timerExec(100,()->{if(!browser.isDisposed()&&payload.equals(latestCursor))browser.execute("if(typeof sdeCodeCursor==='function')sdeCodeCursor("+payload+");");});
        };
        editorActivation=new IPartListener2(){
            @Override public void partActivated(IWorkbenchPartReference ref){
                Object part=ref.getPart(false);if(part instanceof IEditorPart)watchScroll((IEditorPart)part);
            }
            @Override public void partClosed(IWorkbenchPartReference ref){if(ref.getPart(false)==scrolledEditor)watchScroll(null);}
        };
        getSite().getPage().addPartListener(editorActivation);
        watchScroll(getSite().getPage().getActiveEditor());
        browser.addDisposeListener(event->{
            if(editorSelection!=null)getSite().getPage().removePostSelectionListener(editorSelection);
            getSite().getPage().removePartListener(editorActivation);watchScroll(null);
        });
    }
    private void watchScroll(IEditorPart editor){
        if(scrolledViewer!=null)scrolledViewer.removeViewportListener(viewportListener);
        scrolledViewer=null;scrolledEditor=null;
        if(editor==null||AdtEditor.of(editor)==null)return;
        Object target=editor.getAdapter(ITextOperationTarget.class);
        if(!(target instanceof ITextViewer))return;
        scrolledViewer=(ITextViewer)target;scrolledEditor=editor;
        scrolledViewer.addViewportListener(viewportListener);
    }
    String assistantContext() { return vertexContext; }
    @Override void prompt(String text) {
        browser.execute("document.getElementById('conversation').contentWindow.document.getElementById('prompt').value="
            + AssistantBridge.quote(text));
    }
}
