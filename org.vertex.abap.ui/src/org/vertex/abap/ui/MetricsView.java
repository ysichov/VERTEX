package org.vertex.abap.ui;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Text;
import org.eclipse.ui.part.ViewPart;

import com.sap.adt.project.IAdtCoreProject;

/**
 * Step one of the metrics pilot: prove that the object and the system both come
 * from the selection rather than from a guess. No backend is involved yet.
 * <p>
 * What the view needs is carried in its secondary id, because that is the only
 * per-instance state Eclipse preserves when it restores views after a restart.
 */
public class MetricsView extends ViewPart {

	public static final String ID = "org.vertex.abap.ui.view.metrics";

	/** Not a regular-expression metacharacter, and not legal in ABAP object names. */
	private static final String SEPARATOR = "~";

	private Text text;

	static String encode(String object, String type, String project, int counter) {
		return object + SEPARATOR + type + SEPARATOR + project + SEPARATOR + counter;
	}

	@Override
	public void createPartControl(Composite parent) {
		this.text = new Text(parent, SWT.MULTI | SWT.V_SCROLL | SWT.H_SCROLL | SWT.READ_ONLY);
		this.text.setText(describe());
	}

	private String describe() {
		String secondaryId = getViewSite().getSecondaryId();
		if (secondaryId == null) {
			return "Open this view from the context menu of an ABAP object.";
		}

		String[] parts = secondaryId.split(SEPARATOR, -1);
		if (parts.length < 3) {
			return "Unexpected view id: " + secondaryId;
		}
		String object = parts[0];
		String type = parts[1];
		String projectName = parts[2];

		setPartName(object);

		IProject project = ResourcesPlugin.getWorkspace().getRoot().getProject(projectName);
		if (!project.exists()) {
			return "Project " + projectName + " is no longer in this workspace.";
		}

		IAdtCoreProject adtProject = project.getAdapter(IAdtCoreProject.class);
		if (adtProject == null) {
			return "Project " + projectName + " is not an ABAP project.";
		}
		String destination = adtProject.getDestinationId();
		setTitleToolTip(object + " on " + destination);

		return "object      = " + object + System.lineSeparator()
		     + "type        = " + type + System.lineSeparator()
		     + "project     = " + projectName + System.lineSeparator()
		     + "destination = " + destination + System.lineSeparator()
		     + System.lineSeparator()
		     + "Both the object and the system came from the selection." + System.lineSeparator()
		     + "Open a second one from an object in another project to see them differ.";
	}

	@Override
	public void setFocus() {
		this.text.setFocus();
	}
}
