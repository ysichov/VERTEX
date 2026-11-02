package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.jface.text.BadLocationException;
import org.eclipse.jface.text.IDocument;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.handlers.HandlerUtil;

/**
 * VERTEX: Path to This Line, on the cursor in an ADT source editor: the conditions under which the line runs inside its
 * METHOD or FORM. The editor's text is taken as it stands, saved or not, as VS Code takes it; nothing is read from SAP.
 */
public class ReachPathHandler extends AbstractHandler {

	private static int counter;

	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		Shell shell = HandlerUtil.getActiveShell(event);
		IEditorPart editor = HandlerUtil.getActiveEditor(event);
		AdtEditor object = editor == null ? null : AdtEditor.of(editor);
		if (object == null || object.project == null) {
			SelectionContext.report(shell, "Place the cursor in an ABAP source editor of an ABAP project.");
			return null;
		}
		EditorCursor cursor = EditorCursor.of(shell, editor, object, "Place the cursor on a line.");
		if (cursor == null) {
			return null;
		}
		IDocument document = cursor.document;
		int offset = cursor.offset;
		int line;
		try {
			line = document.getLineOfOffset(offset) + 1;
		} catch (BadLocationException e) {
			throw new ExecutionException("The cursor is outside the editor's text", e);
		}
		String kind = object.kind();
		String type = kind != null && kind.startsWith("CLAS") ? "CLAS" : "PROG";

		String id = String.valueOf(++counter);
		ReachPathView.TARGETS.put(id, new ReachPathView.Target(editor, object, type, document.get(), offset, line));
		try {
			DetachedView.show(HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage(), ReachPathView.ID, id);
		} catch (Exception e) {
			ReachPathView.TARGETS.remove(id);
			throw new ExecutionException("Cannot open the VERTEX Path to line window", e);
		}
		return null;
	}
}
