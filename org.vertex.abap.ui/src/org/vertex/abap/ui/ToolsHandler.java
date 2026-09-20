package org.vertex.abap.ui;
import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;

public class ToolsHandler extends AbstractHandler {
    private static int counter;
    @Override public Object execute(ExecutionEvent event) throws ExecutionException {
        SelectionContext selection = SelectionContext.of(HandlerUtil.getCurrentSelection(event));
        String name = null, type = null, project = null;
        if (selection.problem == null) {
            name = selection.object.getName(); type = selection.object.getType();
            project = selection.project.getName();
        } else {
            AdtEditor editor = AdtEditor.of(HandlerUtil.getActiveEditor(event));
            if (editor != null && editor.project != null) {
                name = editor.name; type = editor.type; project = editor.project.getName();
            }
        }
        try {
            IWorkbenchPage page = HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage();
            String id = name == null ? null : MetricsView.encode(name, type, project, ++counter);
            page.showView(ToolsView.ID, id, IWorkbenchPage.VIEW_ACTIVATE);
        } catch (Exception e) { throw new ExecutionException("Cannot open VERTEX Tools", e); }
        return null;
    }
}
