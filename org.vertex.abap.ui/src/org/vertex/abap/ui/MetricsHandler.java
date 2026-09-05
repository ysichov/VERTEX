package org.vertex.abap.ui;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;

/**
 * Opens the metrics view for the selected object, on the system that object
 * belongs to.
 */
public class MetricsHandler extends AbstractHandler {

	/** Distinguishes view instances; Eclipse requires unique secondary ids. */
	private static int counter = 0;

	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		SelectionContext context = SelectionContext.of(HandlerUtil.getCurrentSelection(event));
		if (context.problem != null) {
			SelectionContext.report(HandlerUtil.getActiveShell(event), context.problem);
			return null;
		}

		counter++;
		String secondaryId = MetricsView.encode(context.object.getName(), context.object.getType(),
				context.project.getName(), counter);

		try {
			IWorkbenchPage page = HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage();
			page.showView(MetricsView.ID, secondaryId, IWorkbenchPage.VIEW_ACTIVATE);
		} catch (Exception e) {
			throw new ExecutionException("Cannot open the metrics view", e);
		}
		return null;
	}
}
