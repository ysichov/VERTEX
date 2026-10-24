package org.vertex.abap.ui;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import org.eclipse.core.filesystem.EFS;
import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.widgets.DirectoryDialog;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.dialogs.PreferencesUtil;
import org.eclipse.ui.ide.IDE;

import com.sap.adt.communication.resources.IRestResource;
import com.sap.adt.tools.core.model.adtcore.IAdtCoreFactory;
import com.sap.adt.tools.core.ui.navigation.AdtNavigationServiceFactory;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * Session Logs: the assistant's conversations as VS Code's VERTEX: Session Logs shows them - the same report page and
 * the same reading of the Claude-Code-compatible JSONL files in claude_compatible/ of the log folder (VERTEX Assistant
 * preferences). This view reads and deletes the files and opens what the report links to; the page does the rest.
 */
public class LogsView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.logs";

	private static final String PAGE = "assistant/session-logs.html";

	/** The system a logged object names, for opening it; null asks, as a window opened without an object does. */
	private String system;

	@Override
	protected String page() {
		return PAGE;
	}

	@Override
	protected String projectName() {
		return system;
	}

	/** Each object opens on the system its log names: a project chosen for one log must not carry over to the next. */
	@Override
	protected IProject abapProject() {
		if (system != null) {
			return ResourcesPlugin.getWorkspace().getRoot().getProject(system);
		}
		return withoutAProject(null);
	}

	@Override
	protected String title(String object) {
		return "VERTEX: Session Logs";
	}

	@Override
	protected String readResource(String path) throws IOException {
		String value = super.readResource(path);
		if (!path.equals(PAGE)) {
			return value;
		}
		return value.replace("/*LOGS_ENGINE*/", super.readResource("assistant/logs.js").replace("</script", "<\\/script"));
	}

	/** The report page itself, as text; the page writes it into its frame. */
	@Override
	protected String initialLiteral() {
		try {
			return AssistantBridge.quote(readResource("resources/log-report.html")).replace("<", "\\u003c");
		} catch (IOException e) {
			return AssistantBridge.quote("<p>" + describe(e) + "</p>");
		}
	}

	@Override
	protected void addContentHandlers(IRestResource resource) {
		super.addContentHandlers(resource);
		addAdtTextHandlers(resource);
	}

	private static Path folder() {
		String root = AssistantPreferences.setting("logPath").trim();
		return root.isEmpty() ? null : Paths.get(root).resolve("claude_compatible");
	}

	/** { configured, folder, files: [{ name, text }] }, as VS Code's readSessions finds them. */
	private static String readLogs() {
		Path folder = folder();
		JsonObject answer = new JsonObject();
		answer.addProperty("configured", folder != null);
		answer.addProperty("folder", folder == null ? "" : folder.toString());
		JsonArray files = new JsonArray();
		if (folder != null && Files.isDirectory(folder)) {
			try (DirectoryStream<Path> entries = Files.newDirectoryStream(folder, "*.jsonl")) {
				for (Path file : entries) {
					if (!Files.isRegularFile(file)) {
						continue;
					}
					JsonObject one = new JsonObject();
					one.addProperty("name", file.getFileName().toString());
					one.addProperty("text", Files.readString(file, StandardCharsets.UTF_8));
					files.add(one);
				}
			} catch (IOException e) {
				throw new IllegalStateException("Cannot read the logs in " + folder + ": " + describe(e), e);
			}
		}
		answer.add("files", files);
		return answer.toString();
	}

	@Override
	protected void addFunctions() {
		new BrowserFunction(this.browser, "sdeLogsRead") {
			@Override
			public Object function(Object[] arguments) {
				queue(LogsView::readLogs);
				return null;
			}
		};

		new BrowserFunction(this.browser, "sdeLogsAsset") {
			@Override
			public Object function(Object[] arguments) {
				queue(() -> {
					try {
						return readResource("resources/mermaid.min.js");
					} catch (IOException e) {
						throw new IllegalStateException(describe(e), e);
					}
				});
				return null;
			}
		};

		// Conversations chosen in the report, deleted after asking - their execution recordings are kept, as in VS Code.
		new BrowserFunction(this.browser, "sdeLogsClear") {
			@Override
			public Object function(Object[] arguments) {
				String ids = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "[]";
				queue(() -> {
					Path folder = folder();
					if (folder == null) {
						return "0";
					}
					List<Path> chosen = new ArrayList<>();
					for (var id : JsonParser.parseString(ids).getAsJsonArray()) {
						String name = id.getAsString();
						// A session's id is its file name; anything with a path in it is not one.
						if (!name.matches("[\\w.-]{1,200}")) {
							continue;
						}
						Path file = folder.resolve(name + ".jsonl");
						if (Files.isRegularFile(file)) {
							chosen.add(file);
						}
					}
					if (chosen.isEmpty() || !MessageDialog.openConfirm(browser.getShell(), "VERTEX",
							"Clear " + chosen.size() + " selected conversation log(s)? Execution recordings are kept.")) {
						return "0";
					}
					for (Path file : chosen) {
						try {
							Files.delete(file);
						} catch (IOException e) {
							throw new IllegalStateException("Cannot delete " + file + ": " + describe(e), e);
						}
					}
					return String.valueOf(chosen.size());
				});
				return null;
			}
		};

		new BrowserFunction(this.browser, "sdeLogsChooseFolder") {
			@Override
			public Object function(Object[] arguments) {
				queue(() -> {
					DirectoryDialog dialog = new DirectoryDialog(browser.getShell());
					dialog.setText("VERTEX: Choose Log Folder");
					String chosen = dialog.open();
					if (chosen != null) {
						try {
							AssistantPreferences.setLogPath(chosen);
						} catch (java.util.prefs.BackingStoreException e) {
							throw new IllegalStateException("The log folder could not be saved: " + describe(e), e);
						}
					}
					return chosen == null ? "" : chosen;
				});
				return null;
			}
		};

		// The log settings: the VERTEX Assistant preferences, where the folder and what is logged are chosen.
		new BrowserFunction(this.browser, "sdeLogsSettings") {
			@Override
			public Object function(Object[] arguments) {
				browser.getDisplay().asyncExec(() -> PreferencesUtil.createPreferenceDialogOn(browser.getShell(),
						"org.vertex.abap.ui.assistant.preferences", null, null).open());
				return null;
			}
		};

		// An object a log names: a local file in Eclipse's editor, an ABAP object in ADT's - on the system the log
		// names when this workspace has a project of that name, otherwise on the one the reader picks.
		new BrowserFunction(this.browser, "sdeLogsOpen") {
			@Override
			public Object function(Object[] arguments) {
				String json = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "{}";
				queue(() -> {
					JsonObject object = JsonParser.parseString(json).getAsJsonObject();
					if (object.has("path")) {
						Path file = Paths.get(object.get("path").getAsString());
						if (!Files.isRegularFile(file)) {
							throw new IllegalStateException("The logged file " + file + " is not there.");
						}
						try {
							IDE.openEditorOnFileStore(getSite().getPage(), EFS.getLocalFileSystem().getStore(file.toUri()));
						} catch (Exception e) {
							throw new IllegalStateException("Cannot open " + file + ": " + describe(e), e);
						}
						return "";
					}
					String name = object.get("object_name").getAsString().toUpperCase();
					String type = object.get("object_type").getAsString().toUpperCase();
					if (!name.matches("[A-Z0-9_/$~]{1,40}")) {
						throw new IllegalArgumentException("Invalid object name " + name + ".");
					}
					String named = object.has("system") ? object.get("system").getAsString() : null;
					IProject project = named == null ? null : ResourcesPlugin.getWorkspace().getRoot().getProject(named);
					system = project != null && project.exists() ? named : null;
					String[] adt = adtObject(name, type);
					com.sap.adt.tools.core.model.adtcore.IAdtObjectReference reference = IAdtCoreFactory.eINSTANCE.createAdtObjectReference();
					reference.setUri(adt[0]);
					reference.setName(name);
					reference.setType(adt[1]);
					IEditorPart editor = AdtNavigationServiceFactory.createNavigationService().navigate(abapProject(), reference, true);
					if (editor == null) {
						throw new IllegalStateException("ADT did not open " + name + ".");
					}
					return "";
				});
				return null;
			}
		};
	}
}
