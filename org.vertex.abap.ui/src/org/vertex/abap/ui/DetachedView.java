package org.vertex.abap.ui;

import org.eclipse.e4.ui.model.application.ui.MUIElement;
import org.eclipse.e4.ui.model.application.ui.advanced.MPerspective;
import org.eclipse.e4.ui.model.application.ui.basic.MPart;
import org.eclipse.e4.ui.model.application.ui.basic.MPartSashContainerElement;
import org.eclipse.e4.ui.model.application.ui.basic.MPartStack;
import org.eclipse.e4.ui.model.application.ui.basic.MStackElement;
import org.eclipse.e4.ui.model.application.ui.basic.MWindow;
import org.eclipse.e4.ui.workbench.modeling.EModelService;
import org.eclipse.ui.IViewPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.PartInitException;

/**
 * A VERTEX window opens docked right of the editors, half the width, the editor and VERTEX side by side: in a window of
 * its own beside the workbench it always covered part of the screen until moved. All VERTEX windows share that one
 * stack. A view already open stays where it is - docked, moved by the reader or dragged out - and is only brought to
 * the front.
 */
final class DetachedView {
	/** The stack right of the editor area that VERTEX windows open in. */
	private static final String STACK = "org.vertex.abap.ui.stack.beside";
	private static final String EDITORS = "org.eclipse.ui.editorss";

	private DetachedView() {
	}

	static IViewPart show(IWorkbenchPage page, String viewId, String secondaryId) throws PartInitException {
		boolean open = page.findViewReference(viewId, secondaryId) != null;
		IViewPart view = page.showView(viewId, secondaryId, IWorkbenchPage.VIEW_ACTIVATE);
		if (!open) dock(page, view, viewId);
		page.activate(view);
		return view;
	}

	private static void dock(IWorkbenchPage page, IViewPart view, String viewId) throws PartInitException {
		MPart part = view.getSite().getService(MPart.class);
		EModelService models = view.getSite().getService(EModelService.class);
		MWindow main = page.getWorkbenchWindow().getService(MWindow.class);
		MPerspective perspective = models == null || main == null ? null : models.getActivePerspective(main);
		if (part == null || perspective == null) {
			throw new PartInitException("VERTEX cannot place " + viewId + " beside the editor: the workbench model is not available.");
		}
		MPartStack stack = (MPartStack) models.find(STACK, perspective);
		if (stack == null) {
			MUIElement editors = models.find(EDITORS, perspective);
			if (!(editors instanceof MPartSashContainerElement area)) {
				throw new PartInitException("VERTEX cannot place " + viewId + " beside the editor: the perspective has no editor area.");
			}
			stack = models.createModelElement(MPartStack.class);
			stack.setElementId(STACK);
			models.insert(stack, area, EModelService.RIGHT_OF, 0.5f);
		}
		// A view lives once in the window and stands in the perspective as a placeholder: that is what is moved.
		MStackElement shown = part.getCurSharedRef() != null ? part.getCurSharedRef() : part;
		if ((Object) shown.getParent() != stack) models.move(shown, stack);
		stack.setSelectedElement(shown);
		stack.setToBeRendered(true);
		stack.setVisible(true);
	}
}
