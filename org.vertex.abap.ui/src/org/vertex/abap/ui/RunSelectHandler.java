package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.core.runtime.Adapters;
import org.eclipse.jface.text.IDocument;
import org.eclipse.jface.text.ITextSelection;
import org.eclipse.jface.viewers.ISelection;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.handlers.HandlerUtil;
import org.eclipse.ui.texteditor.ITextEditor;

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
		ITextEditor text = Adapters.adapt(editor, ITextEditor.class);
		if (text == null || text.getDocumentProvider() == null) {
			SelectionContext.report(shell, "The editor of " + object.name + " does not offer its text.");
			return null;
		}
		ISelection selection = text.getSelectionProvider().getSelection();
		if (!(selection instanceof ITextSelection)) {
			SelectionContext.report(shell, "Place the cursor on a SELECT.");
			return null;
		}
		IDocument document = text.getDocumentProvider().getDocument(text.getEditorInput());
		String id = String.valueOf(++counter);
		RunSelectView.TARGETS.put(id, new RunSelectView.Target(object.project.getName(), document.get(), ((ITextSelection) selection).getOffset()));
		try {
			DetachedView.show(HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage(), RunSelectView.ID, id);
		} catch (Exception e) {
			RunSelectView.TARGETS.remove(id);
			throw new ExecutionException("Cannot run the SELECT", e);
		}
		return null;
	}
}
