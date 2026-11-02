package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.handlers.HandlerUtil;

/**
 * VERTEX: Run Select - the SELECT at the cursor, as VS Code's command runs it: what SelecTor can say opens in VERTEX
 * Tools, anything else runs through ADT's data preview. The editor's text is taken as it stands, saved or not.
 */
public class RunSelectHandler extends AbstractHandler {

	private static int counter;

	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		Shell shell = HandlerUtil.getActiveShell(event);
		IEditorPart editor = HandlerUtil.getActiveEditor(event);
		AdtEditor object = editor == null ? null : AdtEditor.of(editor);
		if (object == null || object.project == null) {
			SelectionContext.report(shell, "Place the cursor on a SELECT in an ABAP source editor of an ABAP project.");
			return null;
		}
		EditorCursor cursor = EditorCursor.of(shell, editor, object, "Place the cursor on a SELECT.");
		if (cursor == null) {
			return null;
		}
		String id = String.valueOf(++counter);
		RunSelectView.TARGETS.put(id, new RunSelectView.Target(object.project.getName(), cursor.document.get(), cursor.offset));
		try {
			DetachedView.show(HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage(), RunSelectView.ID, id);
		} catch (Exception e) {
			RunSelectView.TARGETS.remove(id);
			throw new ExecutionException("Cannot run the SELECT", e);
		}
		return null;
	}
}
