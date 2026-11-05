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
    private Text logPath;

    private static final String[][] FLAGS = {
        { "logQuestions", "Log questions" },
        { "logAnswers", "Log answers" },
        { "logTools", "Log SAP tool calls (names, arguments, result summaries)" },
        { "logRequest", "Log what is sent to the model: VERTEX instructions, prompt and context, tools" },
        { "personalInstructions", "Let Claude Code load my personal CLAUDE.md and auto-memory" }
    };
    private final Button[] flags = new Button[FLAGS.length];

    /** The Anthropic API key, in Eclipse's secure storage (encrypted), never in the plain preferences. */
    private static org.eclipse.equinox.security.storage.ISecurePreferences secure() {
        return org.eclipse.equinox.security.storage.SecurePreferencesFactory.getDefault().node("org.vertex.abap/assistant");
    }

    static String anthropicKey() throws org.eclipse.equinox.security.storage.StorageException {
        return secure().get("anthropicApiKey", "");
    }

    private Text anthropicKey;

    static boolean flag(String key) {
        return STORE.getBoolean(key, false);
    }

    static String setting(String key) {
        return STORE.get(key, key.equals("node") ? "node" : "");
    }

    /**
     * The Node executable: the one set here, else the first found on PATH, in nvm's versions (newest
     * first), Volta, Homebrew or /usr/local - Eclipse started from the Dock does not get the shell's
     * PATH, where nvm puts Node. Plain "node" when none is found, so the error still names it.
     */
    static String node() {
        String set = setting("node").trim();
        if (!set.isEmpty() && !set.equals("node")) return set;
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        String name = windows ? "node.exe" : "node";
        java.util.List<java.nio.file.Path> folders = new java.util.ArrayList<>();
        String path = System.getenv("PATH");
        if (path != null) for (String part : path.split(java.io.File.pathSeparator)) if (!part.isBlank()) folders.add(java.nio.file.Paths.get(part.replace("\"", "")));
        String home = System.getProperty("user.home", "");
        String nvmDir = System.getenv("NVM_DIR");
        java.nio.file.Path nvm = (nvmDir != null && !nvmDir.isBlank() ? java.nio.file.Paths.get(nvmDir) : java.nio.file.Paths.get(home, ".nvm")).resolve("versions").resolve("node");
        try (java.util.stream.Stream<java.nio.file.Path> versions = java.nio.file.Files.list(nvm)) {
            versions.sorted((a, b) -> compareVersions(b.getFileName().toString(), a.getFileName().toString()))
                .forEach(v -> folders.add(v.resolve("bin")));
        } catch (java.io.IOException | RuntimeException none) { /* No nvm. */ }
        folders.add(java.nio.file.Paths.get(home, ".volta", "bin"));
        folders.add(java.nio.file.Paths.get("/opt/homebrew/bin"));
        folders.add(java.nio.file.Paths.get("/usr/local/bin"));
        if (windows) {
            String programs = System.getenv("ProgramFiles");
            if (programs != null) folders.add(java.nio.file.Paths.get(programs, "nodejs"));
        }
        for (java.nio.file.Path folder : folders) {
            java.nio.file.Path candidate = folder.resolve(name);
            if (java.nio.file.Files.isRegularFile(candidate) && java.nio.file.Files.isExecutable(candidate)) return candidate.toString();
        }
        return "node";
    }

    /** v26.13.0 against v22.9.1, by number. */
    static int compareVersions(String a, String b) {
        String[] x = a.replaceFirst("^v", "").split("\\."), y = b.replaceFirst("^v", "").split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }

    private static int parse(String part) {
        try { return Integer.parseInt(part.replaceAll("\\D.*$", "")); } catch (NumberFormatException e) { return 0; }
    }

    /** The log folder, chosen from Session Logs as VS Code's Choose Log Folder sets vertex.ai.logPath. */
    static void setLogPath(String folder) throws java.util.prefs.BackingStoreException {
        STORE.put("logPath", folder);
        STORE.flush();
    }

    @Override public void init(IWorkbench workbench) {}

    @Override protected Control createContents(Composite parent) {
        Composite box = new Composite(parent, SWT.NONE);
        box.setLayout(new GridLayout(3, false));
        Label explanation = new Label(box, SWT.WRAP);
        explanation.setText("Node.js 22+ is required. Left as node, it is found on PATH, in nvm, Volta, Homebrew or /usr/local.\n"
                + "Choose native Codex/Claude executables and log in with their CLI first.\n"
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
        new Label(box, SWT.NONE).setText("Anthropic API key");
        anthropicKey = new Text(box, SWT.BORDER | SWT.PASSWORD);
        anthropicKey.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false, 2, 1));
        anthropicKey.setToolTipText("For Anthropic API in the VERTEX chat. Kept in Eclipse secure storage. Empty removes it.");
        try { anthropicKey.setText(anthropicKey()); }
        catch (Exception e) { setErrorMessage("Cannot read the Anthropic API key from secure storage: " + e.getMessage()); }
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
        STORE.put("logPath", logPath.getText().trim());
        for (int i = 0; i < FLAGS.length; i++) STORE.putBoolean(FLAGS[i][0], flags[i].getSelection());
        try {
            String key = anthropicKey.getText().trim();
            if (key.isEmpty()) secure().remove("anthropicApiKey");
            else secure().put("anthropicApiKey", key, true);
            secure().flush();
            STORE.flush();
            return true;
        }
        catch (Exception e) { setErrorMessage(e.getMessage()); return false; }
    }

    @Override protected void performDefaults() {
        for (int i = 0; i < keys.length; i++) fields[i].setText(i == 0 ? "node" : "");
        logPath.setText("");
        for (Button b : flags) b.setSelection(false);
        super.performDefaults();
    }
}
