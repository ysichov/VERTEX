package org.vertex.abap.ui;

import org.eclipse.core.runtime.Adapters;
import org.eclipse.jface.text.IDocument;
import org.eclipse.jface.text.ITextSelection;
import org.eclipse.jface.viewers.ISelection;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.texteditor.ITextEditor;

/**
 * The text and the cursor of an ADT source editor, as a command on the cursor takes them (Path to This Line, Run
 * Select, Value origin): the editor's text as it stands, saved or not.
 */
final class EditorCursor {

	final ITextEditor text;
	final IDocument document;
	final int offset;

	private EditorCursor(ITextEditor text, IDocument document, int offset) {
		this.text = text;
		this.document = document;
		this.offset = offset;
	}

	/**
	 * The cursor of EDITOR, which shows OBJECT; null once the reader has been told why there is none - the editor
	 * offers no text, or its selection is not in the text (NO_CURSOR says where to put the cursor).
	 */
	static EditorCursor of(Shell shell, IEditorPart editor, AdtEditor object, String noCursor) {
		ITextEditor text = Adapters.adapt(editor, ITextEditor.class);
		if (text == null || text.getDocumentProvider() == null) {
			SelectionContext.report(shell, "The editor of " + object.name + " does not offer its text.");
			return null;
		}
		ISelection selection = text.getSelectionProvider().getSelection();
		if (!(selection instanceof ITextSelection)) {
			SelectionContext.report(shell, noCursor);
			return null;
		}
		return new EditorCursor(text, text.getDocumentProvider().getDocument(text.getEditorInput()), ((ITextSelection) selection).getOffset());
	}
}
