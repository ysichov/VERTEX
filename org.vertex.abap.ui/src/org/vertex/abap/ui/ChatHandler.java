package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.ui.handlers.HandlerUtil;

/**
 * VERTEX Assistant: the chat in a window of its own, as VS Code has it beside Ask AI in VERTEX Tools. It talks to the
 * system of the object it was opened on - the active ADT editor's, or the one selected in Project Explorer; with
 * neither, the chat asks which ABAP project, as any VERTEX window opened without an object does.
 */
public class ChatHandler extends AbstractHandler {
	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		String project = null;
		SelectionContext selection = SelectionContext.of(HandlerUtil.getCurrentSelection(event));
		if (selection.problem == null && selection.project != null) {
			project = selection.project.getName();
		} else {
			AdtEditor editor = AdtEditor.of(HandlerUtil.getActiveEditor(event));
			if (editor != null && editor.project != null) {
				project = editor.project.getName();
			}
		}
		try {
			DetachedView.show(HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage(), ChatView.ID, project);
		} catch (Exception e) {
			throw new ExecutionException("Cannot open the VERTEX Assistant", e);
		}
		return null;
	}
}
