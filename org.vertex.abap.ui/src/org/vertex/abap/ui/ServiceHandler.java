package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;

/**
 * Opens one VERTEX service for the selected object, on the system that object
 * belongs to. What the services differ in is which view to open and what to
 * carry in its secondary id; everything else is the same three steps.
 */
public abstract class ServiceHandler extends AbstractHandler {

	/**
	 * Distinguishes view instances; Eclipse requires unique secondary ids. One
	 * counter for all services, so two windows can never collide even if a
	 * later service reuses another's view id.
	 */
	private static int counter = 0;

	protected abstract String viewId();

	/** What this service needs to remember about the object it was opened for. */
	protected abstract String secondaryId(SelectionContext context, int instance);

	/** Named in the exception when the workbench refuses to open the view. */
	protected abstract String description();

	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		SelectionContext context = SelectionContext.of(HandlerUtil.getCurrentSelection(event));
		if (context.problem != null) {
			SelectionContext.report(HandlerUtil.getActiveShell(event), context.problem);
			return null;
		}

		counter++;
		try {
			IWorkbenchPage page = HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage();
			page.showView(viewId(), secondaryId(context, counter), IWorkbenchPage.VIEW_ACTIVATE);
		} catch (Exception e) {
			throw new ExecutionException("Cannot open " + description(), e);
		}
		return null;
	}
}
