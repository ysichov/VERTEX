package org.vertex.abap.ui;
import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;

public class ToolsHandler extends AbstractHandler {
    private static int counter;
    protected String viewId(){return ToolsView.ID;}
    @Override public Object execute(ExecutionEvent event) throws ExecutionException {
        SelectionContext selection = SelectionContext.of(HandlerUtil.getCurrentSelection(event));
        String name = null, type = null, project = null;
        if (selection.problem == null) {
            name = selection.object.getName(); type = selection.object.getType();
            project = selection.project.getName();
        } else {
            AdtEditor editor = AdtEditor.of(HandlerUtil.getActiveEditor(event));
            if (editor != null) {
                name = editor.ownerName(); type = editor.kind();
                project = editor.project == null ? "" : editor.project.getName();
            }
        }
        try {
            IWorkbenchPage page = HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage();
            String id = name == null || name.isBlank() ? null : MetricsView.encode(name, type == null ? "" : type, project == null ? "" : project, ++counter);
            DetachedView.show(page, viewId(), id);
        } catch (Exception e) { throw new ExecutionException("Cannot open VERTEX Tools", e); }
        return null;
    }
}
