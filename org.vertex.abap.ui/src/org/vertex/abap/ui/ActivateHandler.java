package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;


/**
 * VERTEX: Review & Activate - a block review of the inactive source, then ADT's activation, as VS Code's Review &
 * Activate. Activation without a review is ADT's own (Ctrl+F3).
 */
public class ActivateHandler extends AbstractHandler {

	private static int counter;

	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		Shell shell = HandlerUtil.getActiveShell(event);
		IEditorPart editor = HandlerUtil.getActiveEditor(event);
		if (editor == null) {
			SelectionContext.report(shell, "Open an ABAP object in an editor first.");
			return null;
		}
		AdtEditor object = AdtEditor.of(editor);
		if (object == null || object.project == null) {
			SelectionContext.report(shell, "The active editor is not an ABAP object of an ABAP project.");
			return null;
		}

		if (editor.isDirty()) {
			SelectionContext.report(shell, object.name + " has unsaved changes. Save them (Ctrl+S) first:"
					+ " the review compares what is saved inactive in SAP with the active version.");
			return null;
		}
		String path = sourcePath(object);
		if (path == null) {
			SelectionContext.report(shell, "Review is supported for programs, includes, classes, interfaces and function modules, not "
					+ object.type + ".");
			return null;
		}
		String id = String.valueOf(++counter);
		ReviewView.TARGETS.put(id, new ReviewView.Target(editor, object, path));
		try {
			IWorkbenchPage page = HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage();
			page.showView(ReviewView.ID, id, IWorkbenchPage.VIEW_ACTIVATE);
		} catch (Exception e) {
			ReviewView.TARGETS.remove(id);
			throw new ExecutionException("Cannot open the VERTEX review", e);
		}
		return null;
	}

	/** The source unit the editor shows, or null for a type without one plain source. */
	static String sourcePath(AdtEditor object) {
		if (object.type == null) {
			return null;
		}
		String uri = object.classOfMain() != null ? object.classOfMain()
				: object.uri.endsWith("/source/main") ? object.uri.substring(0, object.uri.length() - "/source/main".length()) : object.uri;
		String type = object.kind();
		if (type.equals("CLAS/I") && uri.matches("/sap/bc/adt/oo/classes/[^/]+/includes/[^/]+")) {
			return uri;
		}
		if (type.equals("PROG/P") || type.equals("PROG/I") || type.equals("CLAS/OC") || type.equals("INTF/OI")
				|| type.equals("FUGR/FF") || type.equals("FUGR/I")) {
			return uri + "/source/main";
		}
		return null;
	}
}
