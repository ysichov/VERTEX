package org.vertex.abap.ui;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.runtime.Adapters;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.text.IDocument;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.custom.BusyIndicator;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.texteditor.ITextEditor;

import com.sap.adt.activation.AdtActivationPlugin;
import com.sap.adt.activation.IActivationService;
import com.sap.adt.activation.checklist.Message;
import com.sap.adt.activation.checklist.MessageList;
import com.sap.adt.communication.resources.IRestResource;

/**
 * Review before activation: the inactive source in SAP against the active one,
 * cut into blocks by the VS Code reviewer page. Approved blocks are saved
 * through the ADT editor itself - its lock, its transport dialog - and then
 * activated with ADT's activation service.
 */
public class ReviewView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.review";

	/** What a review was opened for, keyed by the view's secondary id. */
	static final class Target {
		final IEditorPart editor;
		final AdtEditor object;
		final IProject project;
		final String sourcePath;

		Target(IEditorPart editor, AdtEditor object, String sourcePath) {
			this.editor = editor;
			this.object = object;
			this.project = object.project;
			this.sourcePath = sourcePath;
		}
	}

	static final Map<String, Target> TARGETS = new ConcurrentHashMap<>();

	private Target target;
	private String before;
	private String after;
	private boolean applying;

	@Override
	protected String page() {
		return "resources/review.html";
	}

	@Override
	protected String projectName() {
		Target t = target();
		return t == null ? null : t.project.getName();
	}

	@Override
	protected String title(String object) {
		return "Review: " + object;
	}

	@Override
	protected String initialLiteral() {
		try {
			return AssistantBridge.quote(readResource("assistant/code-review.js"));
		} catch (IOException e) {
			throw new IllegalStateException(describe(e), e);
		}
	}

	@Override
	protected void addContentHandlers(IRestResource resource) {
		super.addContentHandlers(resource);
		resource.addContentHandler(new TextContentHandler("text/plain"));
	}

	private Target target() {
		if (target == null) {
			target = TARGETS.remove(String.valueOf(getViewSite().getSecondaryId()));
		}
		return target;
	}

	@Override
	protected void addFunctions() {
		new BrowserFunction(this.browser, "sdeLoad") {
			@Override
			public Object function(Object[] arguments) {
				queue(() -> {
					Target t = target();
					if (t == null) {
						throw new IllegalStateException("This review lost its editor. Close it and start the review again.");
					}
					before = read(t.sourcePath + "?version=active");
					after = read(t.sourcePath + "?version=workingArea");
					setPartName(title(t.object.name));
					return "{\"before\":" + AssistantBridge.quote(before)
							+ ",\"after\":" + AssistantBridge.quote(after)
							+ ",\"objectName\":" + AssistantBridge.quote(t.object.name)
							+ ",\"objectType\":" + AssistantBridge.quote(t.object.type)
							+ ",\"system\":" + AssistantBridge.quote(t.project.getName()) + "}";
				});
				return null;
			}
		};

		new BrowserFunction(this.browser, "sdeAskBlock") {
			@Override
			public Object function(Object[] arguments) {
				String text = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "";
				browser.getDisplay().asyncExec(() -> askChat(text));
				return null;
			}
		};

		new BrowserFunction(this.browser, "sdeApply") {
			@Override
			public Object function(Object[] arguments) {
				String body = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "";
				// Dialogs and the editor save must not run inside the browser callback.
				browser.getDisplay().asyncExec(() -> apply(body));
				return null;
			}
		};
	}

	private void askChat(String text) {
		try {
			IWorkbenchPage page = getSite().getPage();
			ChatView chat = (ChatView) page.showView(ChatView.ID);
			chat.prompt(text);
		} catch (Exception e) {
			post("error", "Cannot open VERTEX Chat: " + describe(e));
		}
	}

	private static final Pattern SOURCE = Pattern.compile("\"source\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
	private static final Pattern APPROVED = Pattern.compile("\"approved\"\\s*:\\s*\\[([0-9,\\s]*)\\]");

	private void apply(String body) {
		if (applying || browser.isDisposed()) {
			return;
		}
		applying = true;
		try {
			Target t = target();
			Matcher sourceMatch = SOURCE.matcher(body);
			Matcher approvedMatch = APPROVED.matcher(body);
			if (t == null || before == null || after == null || !sourceMatch.find() || !approvedMatch.find()
					|| approvedMatch.group(1).isBlank()) {
				throw new IllegalStateException("Approve at least one block.");
			}
			String reviewed = unescape(sourceMatch.group(1));
			ITextEditor text = Adapters.adapt(t.editor, ITextEditor.class);
			if (text == null || t.editor.getEditorInput() == null || text.getDocumentProvider() == null) {
				throw new IllegalStateException(t.object.name + " is no longer open in its editor. Open it and start a new review.");
			}
			if (t.editor.isDirty()) {
				throw new IllegalStateException("The editor of " + t.object.name
						+ " has unsaved changes. Save them (Ctrl+S) and start a new review: this review shows only what is saved in SAP.");
			}
			String inactive = read(t.sourcePath + "?version=workingArea");
			if (!normalize(inactive).equals(normalize(after))) {
				throw new IllegalStateException("The inactive source of " + t.object.name
						+ " changed in SAP since this review was opened. Nothing was saved or activated; start a new review.");
			}

			boolean partial = !normalize(reviewed).equals(normalize(after));
			IDocument document = text.getDocumentProvider().getDocument(t.editor.getEditorInput());
			if (partial) {
				boolean go = MessageDialog.openQuestion(getSite().getShell(), "VERTEX Review",
						"Declined blocks will be removed from the inactive version of " + t.object.name
								+ " in SAP before activation.\n\nThe editor keeps them afterwards as unsaved changes. Continue?");
				if (!go) {
					post("cancelled", "");
					return;
				}
				document.set(reviewed);
				BusyIndicator.showWhile(browser.getDisplay(), () -> t.editor.doSave(new NullProgressMonitor()));
				if (t.editor.isDirty()) {
					document.set(after);
					throw new IllegalStateException("ADT did not save the reviewed source (cancelled or failed). Nothing was activated;"
							+ " the editor shows the inactive source again, marked unsaved.");
				}
			}

			IActivationService service = AdtActivationPlugin.getDefault().getActivationServiceFactory()
					.createActivationService(t.project);
			final MessageList[] result = new MessageList[1];
			final Exception[] failure = new Exception[1];
			BusyIndicator.showWhile(browser.getDisplay(), () -> {
				try {
					if (t.object.object != null) result[0] = service.activate(List.of(t.object.object));
					else if (t.object.file != null) result[0] = service.activateFiles(List.of(t.object.file));
					else throw new IllegalStateException("ADT offers neither an object reference nor a file to activate for " + t.object.name + ".");
				}
				catch (Exception e) { failure[0] = e; }
			});
			if (failure[0] != null) {
				throw new IllegalStateException("Activation failed: " + describe(failure[0]), failure[0]);
			}
			String errors = errors(result[0]);
			if (!errors.isEmpty()) {
				throw new IllegalStateException("Activation failed" + (partial ? " (the reviewed source is saved inactive)" : "") + ": " + errors);
			}
			String active = read(t.sourcePath + "?version=active");
			if (!normalize(active).equals(normalize(reviewed))) {
				throw new IllegalStateException("Activation reported no error, but the active source differs from the reviewed one. Inspect "
						+ t.object.name + " in SAP before retrying.");
			}
			if (partial) {
				document.set(after);
			}
			post("saved", "");
		} catch (Exception e) {
			post("error", describe(e));
		} finally {
			applying = false;
		}
	}

	private static String errors(MessageList list) {
		if (list == null) {
			return "";
		}
		StringBuilder out = new StringBuilder();
		for (Object item : list.getMsg()) {
			Message message = (Message) item;
			String type = String.valueOf(message.getType()).toUpperCase();
			if (!(type.startsWith("E") || type.startsWith("A"))) {
				continue;
			}
			if (out.length() > 0) {
				out.append("; ");
			}
			if (message.isSetLine()) {
				out.append("line ").append(message.getLine()).append(": ");
			}
			out.append(message.getShortText() == null ? type : String.join(" ", message.getShortText().getTxt()));
		}
		return out.toString();
	}

	private void post(String action, String text) {
		if (browser.isDisposed()) {
			return;
		}
		String json = "{\"action\":" + AssistantBridge.quote(action) + ",\"message\":" + AssistantBridge.quote(text) + "}";
		browser.execute("sdeReviewMessage(" + AssistantBridge.quote(json) + ")");
	}

	private static String normalize(String text) {
		return text.replace("\r\n", "\n");
	}

	private static String unescape(String json) {
		StringBuilder out = new StringBuilder(json.length());
		for (int i = 0; i < json.length(); i++) {
			char c = json.charAt(i);
			if (c != '\\' || i + 1 >= json.length()) {
				out.append(c);
				continue;
			}
			char next = json.charAt(++i);
			switch (next) {
			case 'n': out.append('\n'); break;
			case 'r': out.append('\r'); break;
			case 't': out.append('\t'); break;
			case 'b': out.append('\b'); break;
			case 'f': out.append('\f'); break;
			case 'u': out.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16)); i += 4; break;
			default: out.append(next);
			}
		}
		return out.toString();
	}
}
