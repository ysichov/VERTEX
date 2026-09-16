package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;
import org.eclipse.ui.handlers.IHandlerService;


/**
 * VERTEX: Activate - ADT's activation, optionally preceded by a block review of
 * the inactive source. Whether to review is a preference: ask, always, never.
 */
public class ActivateHandler extends AbstractHandler {

	private static final String ADT_ACTIVATE = "com.sap.adt.activation.ui.command.singleActivation";
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

		String mode = AssistantPreferences.setting("review");
		boolean review;
		if (mode.equals("always")) {
			review = true;
		} else if (mode.equals("never")) {
			review = false;
		} else {
			int answer = new MessageDialog(shell, "VERTEX Activate", null,
					"Review the inactive changes of " + object.name + " block by block before activation?",
					MessageDialog.QUESTION, new String[] { "Review", "Activate", "Cancel" }, 0).open();
			if (answer != 0 && answer != 1) {
				return null;
			}
			review = answer == 0;
		}

		if (!review) {
			try {
				editor.getSite().getService(IHandlerService.class).executeCommand(ADT_ACTIVATE, null);
			} catch (Exception e) {
				throw new ExecutionException("ADT activation could not be started", e);
			}
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
		String uri = object.uri;
		String type = object.type;
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
