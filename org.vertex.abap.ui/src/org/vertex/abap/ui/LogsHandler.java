package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.ui.handlers.HandlerUtil;

/** VERTEX: Session Logs - one window for the assistant's conversation logs, brought to the front when already open. */
public class LogsHandler extends AbstractHandler {
	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		try {
			DetachedView.show(HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage(), LogsView.ID, null);
		} catch (Exception e) {
			throw new ExecutionException("Cannot open VERTEX Session Logs", e);
		}
		return null;
	}
}
