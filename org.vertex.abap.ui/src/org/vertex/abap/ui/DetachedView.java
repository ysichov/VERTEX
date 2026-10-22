package org.vertex.abap.ui;

import org.eclipse.e4.ui.model.application.ui.basic.MPart;
import org.eclipse.e4.ui.model.application.ui.basic.MWindow;
import org.eclipse.e4.ui.workbench.modeling.EModelService;
import org.eclipse.swt.graphics.Rectangle;
import org.eclipse.ui.IViewPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.PartInitException;

/**
 * A VERTEX window opens in a window of its own beside the workbench, not in a view stack of the perspective: a stack the
 * reader has minimized shows its view as an overlay that the next click in the editor hides again. A view already in a
 * window of its own is only brought to the front.
 */
final class DetachedView {
	private DetachedView() {
	}

	static IViewPart show(IWorkbenchPage page, String viewId, String secondaryId) throws PartInitException {
		IViewPart view = page.showView(viewId, secondaryId, IWorkbenchPage.VIEW_ACTIVATE);
		MPart part = view.getSite().getService(MPart.class);
		EModelService models = view.getSite().getService(EModelService.class);
		MWindow main = page.getWorkbenchWindow().getService(MWindow.class);
		if (part == null || models == null || main == null) {
			throw new PartInitException("VERTEX cannot place " + viewId + " in a window of its own: the workbench model is not available.");
		}
		if (models.getTopLevelWindowFor(part) == main) {
			// Beside the workbench window, as large as a reading pane: two thirds of its width, its full height.
			Rectangle bounds = page.getWorkbenchWindow().getShell().getBounds();
			int width = Math.max(700, bounds.width * 2 / 3), height = Math.max(500, bounds.height - 80);
			models.detach(part, bounds.x + bounds.width - width - 20, bounds.y + 40, width, height);
		}
		page.activate(view);
		return view;
	}
}
