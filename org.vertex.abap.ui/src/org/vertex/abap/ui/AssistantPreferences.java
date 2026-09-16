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
    private static final String[] REVIEW = { "ask", "always", "never" };
    private Combo review;
    private Text logPath;

    private static final String[][] FLAGS = {
        { "logQuestions", "Log questions" },
        { "logAnswers", "Log answers" },
        { "logTools", "Log SAP tool calls (names, arguments, result summaries)" },
        { "logCode", "Log SAP source in tool calls (only with tool calls)" },
        { "personalInstructions", "Let Claude Code load my personal CLAUDE.md and auto-memory" }
    };
    private final Button[] flags = new Button[FLAGS.length];

    static boolean flag(String key) {
        return STORE.getBoolean(key, false);
    }

    static String setting(String key) {
        return STORE.get(key, key.equals("node") ? "node" : key.equals("review") ? "ask" : "");
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
        new Label(box, SWT.NONE).setText("Review before VERTEX: Activate");
        review = new Combo(box, SWT.READ_ONLY);
        review.setItems("Ask each time", "Always review", "Activate without review");
        review.select(Math.max(0, java.util.Arrays.asList(REVIEW).indexOf(setting("review"))));
        review.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false, 2, 1));
        new Label(box, SWT.NONE).setText("Chat log folder");
        logPath = new Text(box, SWT.BORDER);
        logPath.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
        logPath.setText(setting("logPath"));
        logPath.setToolTipText("Claude-Code-compatible JSONL (claude_compatible/*.jsonl): questions, answers, token usage, SAP tool calls. SAP source is never written. Empty turns logging off.");
        Button chooseLog = new Button(box, SWT.PUSH);
        chooseLog.setText("Browse...");
        chooseLog.addListener(SWT.Selection, e -> {
            String chosen = new DirectoryDialog(box.getShell()).open();
            if (chosen != null) logPath.setText(chosen);
        });
        Label tokens = new Label(box, SWT.WRAP);
        tokens.setText("With a log folder, token usage is always written. Add:");
        tokens.setLayoutData(new GridData(SWT.FILL, SWT.TOP, true, false, 3, 1));
        for (int i = 0; i < FLAGS.length; i++) {
            flags[i] = new Button(box, SWT.CHECK);
            flags[i].setText(FLAGS[i][1]);
            flags[i].setSelection(flag(FLAGS[i][0]));
            flags[i].setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false, 3, 1));
        }
        return box;
    }

    @Override public boolean performOk() {
        for (int i = 0; i < keys.length; i++) STORE.put(keys[i], fields[i].getText().trim());
        STORE.put("review", REVIEW[Math.max(0, review.getSelectionIndex())]);
        STORE.put("logPath", logPath.getText().trim());
        for (int i = 0; i < FLAGS.length; i++) STORE.putBoolean(FLAGS[i][0], flags[i].getSelection());
        try { STORE.flush(); return true; }
        catch (Exception e) { setErrorMessage(e.getMessage()); return false; }
    }

    @Override protected void performDefaults() {
        for (int i = 0; i < keys.length; i++) fields[i].setText(i == 0 ? "node" : "");
        review.select(0);
        logPath.setText("");
        for (Button b : flags) b.setSelection(false);
        super.performDefaults();
    }
}
