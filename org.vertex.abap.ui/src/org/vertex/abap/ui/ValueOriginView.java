package org.vertex.abap.ui;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.eclipse.core.runtime.Adapters;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.text.BadLocationException;
import org.eclipse.jface.text.IDocument;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.texteditor.ITextEditor;

import com.sap.adt.communication.resources.IRestResource;
import com.sap.adt.tools.core.model.adtcore.IAdtCoreFactory;
import com.sap.adt.tools.core.ui.navigation.AdtNavigationServiceFactory;

/**
 * Value origin: where the value under the cursor came from, backwards across calls, without running the program.
 * The analysis and its page are the VS Code ones (assistant/value-origin.js); this view reads what they ask of SAP -
 * active ADT source parsed locally with abaplint - and opens in ADT's editor the places the page links to.
 */
public class ValueOriginView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.valueOrigin";

	/** What the command found in the editor, keyed by the view's secondary id. */
	static final class Target {
		final IEditorPart editor;
		final AdtEditor object;
		/** PROG, CLAS, INTF or FUNC: the type the ACE origin index is asked for. */
		final String type;
		/** The source the editor shows, as ADT addresses it. */
		final String sourcePath;
		final String text;
		final int offset;
		final int line;
		final int column;
		final List<Integer> breakpoints;

		Target(IEditorPart editor, AdtEditor object, String type, String sourcePath, String text, int offset, int line, int column,
				List<Integer> breakpoints) {
			this.editor = editor;
			this.object = object;
			this.type = type;
			this.sourcePath = sourcePath;
			this.text = text;
			this.offset = offset;
			this.line = line;
			this.column = column;
			this.breakpoints = breakpoints;
		}
	}

	static final Map<String, Target> TARGETS = new ConcurrentHashMap<>();

	private static final String PAGE = "assistant/value-origin.html";

	/** The page's assets, by the name it asks for. */
	private static final Map<String, String> ASSETS = Map.of("mermaid", "resources/mermaid.min.js", "flow", "resources/vertex-flow.js",
			"lens", "resources/vertex-lens.js", "controls", "resources/vertex-controls.css", "style", "assistant/value-origin.css");

	private Target target;

	/** The editor the last link opened, where its line is shown. */
	private IEditorPart opened;

	@Override
	protected String page() {
		return PAGE;
	}

	@Override
	protected String projectName() {
		Target t = target();
		return t == null ? null : t.object.project.getName();
	}

	/** Named by the variable once the page has found it; until then by the object, not by the window's number. */
	@Override
	protected String title(String variable) {
		Target t = target();
		if (t == null) {
			return "Value origin";
		}
		return variable.equals(getViewSite().getSecondaryId()) ? "Value origin: " + t.object.name
				: "Value origin: " + variable + " (" + t.object.name + ")";
	}

	private Target target() {
		if (target == null) {
			target = TARGETS.remove(String.valueOf(getViewSite().getSecondaryId()));
		}
		return target;
	}

	/** The page carries the analysis and the flow graph builder in itself; a script's text must not close its tag. */
	@Override
	protected String readResource(String path) throws IOException {
		String value = super.readResource(path);
		if (!path.equals(PAGE)) {
			return value;
		}
		return value.replace("/*FLOW_GRAPH*/", inline(super.readResource("resources/vertex-abap-control.js")) + "\n" + inline(super.readResource("resources/vertex-flow-graph.js")))
				.replace("/*ORIGIN_ENGINE*/", inline(super.readResource("assistant/value-origin.js")))
                .replace("/*ECLIPSE_FRONTEND*/", inline(super.readResource("resources/eclipse-frontend.js").replace("/*FRONTEND_BUNDLE*/", AssistantBridge.quote(super.readResource("resources/vertex-frontend.js")).replace("<", "\\u003c"))));
	}

	private static String inline(String script) {
		return script.replace("</script", "<\\/script");
	}

	@Override
	protected String initialLiteral() {
		Target t = target();
		if (t == null) {
			return "null";
		}
		StringBuilder points = new StringBuilder("[");
		for (Integer line : t.breakpoints) {
			points.append(points.length() > 1 ? "," : "").append(line);
		}
		points.append("]");
		String json = "{\"project\":" + AssistantBridge.quote(t.object.project.getName())
				+ ",\"name\":" + AssistantBridge.quote(t.object.name.toUpperCase())
				+ ",\"type\":" + AssistantBridge.quote(t.type)
				+ ",\"sourcePath\":" + AssistantBridge.quote(t.sourcePath)
				+ ",\"text\":" + AssistantBridge.quote(t.text)
				+ ",\"offset\":" + t.offset + ",\"line\":" + t.line + ",\"column\":" + t.column
				+ ",\"breakpoints\":" + points + "}";
		// The source is ABAP, and ABAP may hold "</script>" in a literal.
		return json.replace("<", "\\u003c");
	}

	@Override
	protected String accept(String path) {
		// Match the standard ADT client: metadata requires an explicit Accept.
        return path.contains("/source/") ? "text/plain" : "*/*";
	}

	@Override
	protected void addContentHandlers(IRestResource resource) {
		super.addContentHandlers(resource);
		addAdtTextHandlers(resource);
	}

	@Override
	protected void addFunctions() {
        addAnalysisFunctions();
		// Check the active source against the selected editor before local analysis.
		new BrowserFunction(this.browser, "sdeOriginRead") {
			@Override
			public Object function(Object[] arguments) {
				String path = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "";
				queue(() -> {
					Target t = target();
					if (t == null) {
						throw new IllegalStateException("This window lost the editor it was opened from. Close it and run the command again.");
					}
					if (!path.equals(t.sourcePath + "?version=active")) {
						throw new IllegalArgumentException("Unsupported Value origin resource: " + path);
					}
					return read(path);
				});
				return null;
			}
		};

		new BrowserFunction(this.browser, "sdeOriginAsset") {
			@Override
			public Object function(Object[] arguments) {
				String name = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "";
				queue(() -> {
					String path = ASSETS.get(name);
					if (path == null) {
						throw new IllegalArgumentException("Unknown asset " + name + ".");
					}
					try {
						return readResource(path);
					} catch (IOException e) {
						throw new IllegalStateException(describe(e), e);
					}
				});
				return null;
			}
		};

		// Opens an object in ADT's editor and answers its text, for the page to find the line in.
		new BrowserFunction(this.browser, "sdeOriginOpen") {
			@Override
			public Object function(Object[] arguments) {
				String name = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]).toUpperCase() : "";
				String type = arguments.length > 1 && arguments[1] != null ? String.valueOf(arguments[1]).toUpperCase() : "";
				queue(() -> {
					if (!name.matches("[A-Z0-9_/$]{1,40}")) {
						throw new IllegalArgumentException("Invalid object name " + name + ".");
					}
					String[] object = adtObject(name, type);
					com.sap.adt.tools.core.model.adtcore.IAdtObjectReference reference = IAdtCoreFactory.eINSTANCE.createAdtObjectReference();
					reference.setUri(object[0]);
					reference.setName(name);
					reference.setType(object[1]);
					IEditorPart editor = AdtNavigationServiceFactory.createNavigationService().navigate(abapProject(), reference, true);
					if (editor == null) {
						throw new IllegalStateException("ADT did not open " + name + ".");
					}
					opened = editor;
					return document(editor, name).get();
				});
				return null;
			}
		};

		// Shows a line: in the editor the command ran in ("origin"), or in the one the last link opened ("opened").
		new BrowserFunction(this.browser, "sdeOriginReveal") {
			@Override
			public Object function(Object[] arguments) {
				String which = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "";
				int line = arguments.length > 1 && arguments[1] != null ? (int) Double.parseDouble(String.valueOf(arguments[1])) : 1;
				// Not queue(): the page is not waiting for an answer. A failure is a dialog.
				browser.getDisplay().asyncExec(() -> {
					if (browser.isDisposed()) {
						return;
					}
					try {
						reveal(which.equals("origin") ? originEditor() : opened, line);
					} catch (RuntimeException e) {
						MessageDialog.openError(browser.getShell(), "VERTEX", describe(e));
					}
				});
				return null;
			}
		};
	}

	/** The editor the command ran in; reopened on its object when it has been closed since. */
	private IEditorPart originEditor() {
		Target t = target();
		if (t == null) {
			throw new IllegalStateException("This window lost the editor it was opened from. Close it and run the command again.");
		}
		ITextEditor text = Adapters.adapt(t.editor, ITextEditor.class);
		if (text != null && text.getDocumentProvider() != null && t.editor.getEditorInput() != null) {
			return t.editor;
		}
		com.sap.adt.tools.core.model.adtcore.IAdtObjectReference reference = IAdtCoreFactory.eINSTANCE.createAdtObjectReference();
		reference.setUri(t.object.uri);
		reference.setName(t.object.name);
		reference.setType(t.object.type);
		IEditorPart editor = AdtNavigationServiceFactory.createNavigationService().navigate(abapProject(), reference, true);
		if (editor == null) {
			throw new IllegalStateException("ADT did not open " + t.object.name + " again.");
		}
		return editor;
	}

	private static IDocument document(IEditorPart editor, String name) {
		ITextEditor text = Adapters.adapt(editor, ITextEditor.class);
		IDocument document = text == null || text.getDocumentProvider() == null ? null
				: text.getDocumentProvider().getDocument(text.getEditorInput());
		if (document == null) {
			throw new IllegalStateException("The editor of " + name + " does not offer its text.");
		}
		return document;
	}

	private void reveal(IEditorPart editor, int line) {
		if (editor == null) {
			throw new IllegalStateException("No editor was opened for this link.");
		}
		ITextEditor text = Adapters.adapt(editor, ITextEditor.class);
		IDocument document = document(editor, editor.getTitle());
		int at = Math.max(0, Math.min(document.getNumberOfLines() - 1, line - 1));
		try {
			text.selectAndReveal(document.getLineOffset(at), 0);
		} catch (BadLocationException e) {
			throw new IllegalStateException("Line " + line + " is not in " + editor.getTitle() + ".", e);
		}
		editor.getSite().getPage().activate(editor);
	}
}
