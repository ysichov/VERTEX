package org.vertex.abap.ui;

import java.util.prefs.Preferences;

import org.eclipse.jface.preference.PreferencePage;
import org.eclipse.swt.SWT;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.Button;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.ui.IWorkbench;
import org.eclipse.ui.IWorkbenchPreferencePage;

/** Path to This Line - the Eclipse side of VS Code's vertex.pathToLine.methodRelativeLines. */
public class PathPreferences extends PreferencePage implements IWorkbenchPreferencePage {
	private static final Preferences STORE = Preferences.userRoot().node("org/vertex/abap/path");
	private Button relative;

	/** Lines numbered from the METHOD or FORM statement, as SAP GUI numbers a method. */
	static boolean methodRelativeLines() {
		return STORE.getBoolean("methodRelativeLines", false);
	}

	@Override
	public void init(IWorkbench workbench) {
	}

	@Override
	protected Control createContents(Composite parent) {
		Composite box = new Composite(parent, SWT.NONE);
		box.setLayout(new GridLayout(1, false));
		relative = new Button(box, SWT.CHECK);
		relative.setText("Number the lines from the METHOD or FORM statement, as SAP GUI numbers a method");
		relative.setSelection(methodRelativeLines());
		return box;
	}

	@Override
	public boolean performOk() {
		STORE.putBoolean("methodRelativeLines", relative.getSelection());
		try {
			STORE.flush();
		} catch (java.util.prefs.BackingStoreException e) {
			setErrorMessage("The setting could not be saved: " + e.getMessage());
			return false;
		}
		return true;
	}
}
