package org.vertex.abap.ui;

import java.util.prefs.Preferences;
import org.eclipse.jface.preference.PreferencePage;
import org.eclipse.swt.SWT;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.layout.GridLayout;
import org.eclipse.swt.widgets.*;
import org.eclipse.ui.IWorkbench;
import org.eclipse.ui.IWorkbenchPreferencePage;

/** Native executables only: no command strings or shell expansion. */
public class AssistantPreferences extends PreferencePage implements IWorkbenchPreferencePage {
    private static final Preferences STORE = Preferences.userRoot().node("org/vertex/abap/assistant");
    private final String[] keys = { "node", "codex", "claude" };
    private final Text[] fields = new Text[3];

    static String setting(String key) {
        return STORE.get(key, key.equals("node") ? "node" : "");
    }

    @Override public void init(IWorkbench workbench) {}

    @Override protected Control createContents(Composite parent) {
        Composite box = new Composite(parent, SWT.NONE);
        box.setLayout(new GridLayout(3, false));
        Label explanation = new Label(box, SWT.WRAP);
        explanation.setText("Node.js 22+ is required. Choose native Codex/Claude executables and log in with their CLI first.\n"
                + "Empty assistant paths use installed CLI executables or VS Code extension binaries automatically.");
        explanation.setLayoutData(new GridData(SWT.FILL, SWT.TOP, true, false, 3, 1));
        for (int i = 0; i < keys.length; i++) {
            final int n = i;
            new Label(box, SWT.NONE).setText(keys[i] + " executable");
            fields[i] = new Text(box, SWT.BORDER);
            fields[i].setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
            fields[i].setText(setting(keys[i]));
            Button browse = new Button(box, SWT.PUSH);
            browse.setText("Browse...");
            browse.addListener(SWT.Selection, e -> {
                String chosen = new FileDialog(box.getShell(), SWT.OPEN).open();
                if (chosen != null) fields[n].setText(chosen);
            });
        }
        return box;
    }

    @Override public boolean performOk() {
        for (int i = 0; i < keys.length; i++) STORE.put(keys[i], fields[i].getText().trim());
        try { STORE.flush(); return true; }
        catch (Exception e) { setErrorMessage(e.getMessage()); return false; }
    }

    @Override protected void performDefaults() {
        for (int i = 0; i < keys.length; i++) fields[i].setText(i == 0 ? "node" : "");
        super.performDefaults();
    }
}
