package org.vertex.abap.ui;

import java.util.prefs.Preferences;

import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.jface.preference.PreferencePage;
import org.eclipse.swt.SWT;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.Button;
import org.eclipse.swt.widgets.Combo;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.swt.widgets.DirectoryDialog;
import org.eclipse.swt.widgets.Label;
import org.eclipse.swt.widgets.Text;
import org.eclipse.ui.IWorkbench;
import org.eclipse.ui.IWorkbenchPreferencePage;

/**
 * Where code reviews are saved - the Eclipse side of VS Code's vertex.review.storage and vertex.review.folder. A
 * system without VERTEX's ABAP keeps reviews in files whatever is chosen here; the review page says so.
 */
public class ReviewPreferences extends PreferencePage implements IWorkbenchPreferencePage {
	private static final Preferences STORE = Preferences.userRoot().node("org/vertex/abap/review");
	private static final String[] STORAGE = { "table", "file", "both" };
	private Combo storage;
	private Text folder;

	/** table, file or both. */
	static String storage() {
		String value = STORE.get("storage", "table");
		return java.util.Arrays.asList(STORAGE).contains(value) ? value : "table";
	}

	/** The folder of review files; empty means .vertex/reviews in the workspace. */
	static java.nio.file.Path folder() {
		String value = STORE.get("folder", "").trim();
		if (!value.isEmpty()) {
			return java.nio.file.Paths.get(value);
		}
		return ResourcesPlugin.getWorkspace().getRoot().getLocation().toFile().toPath().resolve(".vertex").resolve("reviews");
	}

	@Override
	public void init(IWorkbench workbench) {
	}

	@Override
	protected Control createContents(Composite parent) {
		Composite box = new Composite(parent, SWT.NONE);
		box.setLayout(new GridLayout(3, false));
		Label explanation = new Label(box, SWT.WRAP);
		explanation.setText("Where a code review is saved. The ZAVE_REVIEW table is shared with AVE and every VERTEX window on that\n"
				+ "system and needs VERTEX's ABAP there (ZCL_VX_ADT_RES_STORE); without it reviews are saved to files only.");
		explanation.setLayoutData(new GridData(SWT.FILL, SWT.TOP, true, false, 3, 1));
		new Label(box, SWT.NONE).setText("Save reviews to");
		storage = new Combo(box, SWT.READ_ONLY);
		storage.setItems("The ZAVE_REVIEW table", "Files", "Both (the table is read first)");
		storage.select(java.util.Arrays.asList(STORAGE).indexOf(storage()));
		storage.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false, 2, 1));
		new Label(box, SWT.NONE).setText("Review folder");
		folder = new Text(box, SWT.BORDER);
		folder.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
		folder.setText(STORE.get("folder", ""));
		folder.setToolTipText("One <system>/<request>.json per review. Empty: .vertex/reviews in the workspace folder.");
		Button choose = new Button(box, SWT.PUSH);
		choose.setText("Browse...");
		choose.addListener(SWT.Selection, e -> {
			String chosen = new DirectoryDialog(box.getShell()).open();
			if (chosen != null) folder.setText(chosen);
		});
		return box;
	}

	@Override
	public boolean performOk() {
		STORE.put("storage", STORAGE[Math.max(0, storage.getSelectionIndex())]);
		STORE.put("folder", folder.getText().trim());
		try {
			STORE.flush();
			return true;
		} catch (Exception e) {
			setErrorMessage(e.getMessage());
			return false;
		}
	}

	@Override
	protected void performDefaults() {
		storage.select(0);
		folder.setText("");
		super.performDefaults();
	}
}
