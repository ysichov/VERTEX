package org.selector.adt.ui;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.IResource;
import org.eclipse.core.runtime.Adapters;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.viewers.ISelection;
import org.eclipse.jface.viewers.IStructuredSelection;
import org.eclipse.swt.widgets.Shell;

import com.sap.adt.project.IProjectProvider;
import com.sap.adt.tools.core.IAdtObjectReference;

/**
 * What every context-menu service needs from the workbench selection: the ADT
 * object, and the ABAP project it lives in. Neither is guessed - the project is
 * what decides which system answers.
 */
final class SelectionContext {

	final IAdtObjectReference object;
	final IProject project;
	/** Null when both were found; otherwise it says what was missing. */
	final String problem;

	private SelectionContext(IAdtObjectReference object, IProject project, String problem) {
		this.object = object;
		this.project = project;
		this.problem = problem;
	}

	static SelectionContext of(ISelection selection) {
		if (!(selection instanceof IStructuredSelection)
				|| ((IStructuredSelection) selection).isEmpty()) {
			return new SelectionContext(null, null, "Nothing is selected.");
		}
		Object element = ((IStructuredSelection) selection).getFirstElement();

		// Adapters.adapt goes through the platform's adapter manager, which is what
		// the <adapt> test in plugin.xml uses too. IAdaptable.getAdapter alone does
		// not consult registered adapter factories, so it returns null for exactly
		// the selections whose menu entry is visible.
		IAdtObjectReference object = Adapters.adapt(element, IAdtObjectReference.class);
		if (object == null) {
			return new SelectionContext(null, null,
					"The selection does not adapt to an ADT object."
							+ System.lineSeparator() + "Class: " + element.getClass().getName());
		}

		IProject project = projectOf(element);
		if (project == null) {
			return new SelectionContext(object, null,
					"Object " + object.getName() + " does not say which ABAP project it is in."
							+ System.lineSeparator() + "Class: " + element.getClass().getName());
		}
		return new SelectionContext(object, project, null);
	}

	/**
	 * Project Explorer nodes carry the project but do not adapt to IProject. They
	 * do implement IProjectProvider, through IAbapRepositoryBaseNode - node API
	 * rather than an internal class.
	 */
	private static IProject projectOf(Object element) {
		IProject direct = Adapters.adapt(element, IProject.class);
		if (direct != null) {
			return direct;
		}
		IProjectProvider provider = Adapters.adapt(element, IProjectProvider.class);
		if (provider != null) {
			return provider.getProject();
		}
		IResource resource = Adapters.adapt(element, IResource.class);
		return resource == null ? null : resource.getProject();
	}

	/** Nothing here may fail quietly: an invisible no-op is impossible to debug. */
	static void report(Shell shell, String message) {
		MessageDialog.openInformation(shell, "AXE", message);
	}
}
