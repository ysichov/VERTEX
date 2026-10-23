package org.vertex.abap.ui;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.eclipse.core.runtime.Adapters;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.text.BadLocationException;
import org.eclipse.jface.text.IDocument;
import org.eclipse.jface.text.ITextSelection;
import org.eclipse.jface.viewers.ISelection;
import org.eclipse.swt.custom.StyledText;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.swt.widgets.Listener;
import org.eclipse.swt.SWT;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.texteditor.ITextEditor;

/**
 * Path to This Line: the conditions under which the line at the cursor runs inside its METHOD or FORM. The path and its
 * page are VS Code's (reach-path.js), built in the page's analysis worker from the editor's text; this view hands it the
 * text and cursor, shows in the editor the lines the page links to, and - as VS Code's panel does - builds the path of
 * each line clicked in that editor afterwards.
 */
public class ReachPathView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.reachPath";

	static final class Target {
		final IEditorPart editor;
		final AdtEditor object;
		/** CLAS or PROG: how the parser reads the text. */
		final String type;
		final String text;
		final int offset;
		final int line;

		Target(IEditorPart editor, AdtEditor object, String type, String text, int offset, int line) {
			this.editor = editor;
			this.object = object;
			this.type = type;
			this.text = text;
			this.offset = offset;
			this.line = line;
		}
	}

	static final Map<String, Target> TARGETS = new ConcurrentHashMap<>();

	private static final String PAGE = "assistant/reach-path.html";

	private Target target;

	/** The editor's text widget and the click listener on it, taken off when this window closes. */
	private StyledText widget;
	private Listener click;

	@Override
	protected String page() {
		return PAGE;
	}

	@Override
	protected String projectName() {
		Target t = target();
		return t == null ? null : t.object.project.getName();
	}

	/** Named by the line once the page has built its path. */
	@Override
	protected String title(String object) {
		Target t = target();
		if (t == null) {
			return "Path to line";
		}
		return object.equals(getViewSite().getSecondaryId()) ? "Path to line: " + t.object.ownerName() : object + " (" + t.object.ownerName() + ")";
	}

	private Target target() {
		if (target == null) {
			target = TARGETS.remove(String.valueOf(getViewSite().getSecondaryId()));
		}
		return target;
	}

	@Override
	protected String readResource(String path) throws IOException {
		String value = super.readResource(path);
		if (!path.equals(PAGE)) {
			return value;
		}
		return value.replace("/*ECLIPSE_FRONTEND*/", (super.readResource("resources/eclipse-frontend.js").replace("/*FRONTEND_BUNDLE*/",
				AssistantBridge.quote(super.readResource("resources/vertex-frontend.js")).replace("<", "\\u003c"))).replace("</script", "<\\/script"));
	}

	@Override
	protected String initialLiteral() {
		Target t = target();
		if (t == null) {
			return "null";
		}
		String json = "{\"name\":" + AssistantBridge.quote(t.object.ownerName())
				+ ",\"objectType\":" + AssistantBridge.quote(t.type)
				+ ",\"relative\":" + PathPreferences.methodRelativeLines()
				+ "," + at(t.text, t.offset, t.line) + "}";
		// The source is ABAP, and ABAP may hold "</script>" in a literal.
		return json.replace("<", "\\u003c");
	}

	private static String at(String text, int offset, int line) {
		return "\"text\":" + AssistantBridge.quote(text) + ",\"offset\":" + offset + ",\"line\":" + line;
	}

	@Override
	public void createPartControl(Composite parent) {
		super.createPartControl(parent);
		follow();
	}

	/** A click in the editor the command ran in builds the path of the clicked line; a line this window opened does not. */
	private void follow() {
		Target t = target();
		if (t == null) {
			return;
		}
		ITextEditor text = Adapters.adapt(t.editor, ITextEditor.class);
		Control control = text == null ? null : t.editor.getAdapter(Control.class);
		if (!(control instanceof StyledText)) {
			return;
		}
		widget = (StyledText) control;
		click = event -> {
			if (event.button != 1 || browser.isDisposed()) {
				return;
			}
			// After the editor has moved its cursor to the click.
			widget.getDisplay().asyncExec(() -> sendCursor(text));
		};
		widget.addListener(SWT.MouseUp, click);
	}

	private void sendCursor(ITextEditor text) {
		if (browser.isDisposed() || text.getDocumentProvider() == null) {
			return;
		}
		ISelection selection = text.getSelectionProvider().getSelection();
		IDocument document = text.getDocumentProvider().getDocument(text.getEditorInput());
		if (!(selection instanceof ITextSelection) || document == null) {
			return;
		}
		int offset = ((ITextSelection) selection).getOffset();
		try {
			String json = "{" + at(document.get(), offset, document.getLineOfOffset(offset) + 1) + "}";
			browser.execute("vertexReachAt(" + AssistantBridge.quote(json) + ")");
		} catch (BadLocationException e) {
			// A selection outside the text has no line to build a path for.
		}
	}

	@Override
	public void dispose() {
		if (widget != null && !widget.isDisposed() && click != null) {
			widget.removeListener(SWT.MouseUp, click);
		}
		super.dispose();
	}

	@Override
	protected void addFunctions() {
		// The worker the path is built in is the analysis one; nothing in it reads SAP for a path.
		addAnalysisFunctions();
		new BrowserFunction(this.browser, "sdeReachAsset") {
			@Override
			public Object function(Object[] arguments) {
				String name = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "";
				queue(() -> {
					if (!name.equals("controls")) {
						throw new IllegalArgumentException("Unknown asset " + name + ".");
					}
					try {
						return readResource("resources/vertex-controls.css");
					} catch (IOException e) {
						throw new IllegalStateException(describe(e), e);
					}
				});
				return null;
			}
		};
		// Shows a line in the editor the command ran in. Not queue(): the page is not waiting for an answer.
		new BrowserFunction(this.browser, "sdeReachReveal") {
			@Override
			public Object function(Object[] arguments) {
				int line = arguments.length > 0 && arguments[0] != null ? (int) Double.parseDouble(String.valueOf(arguments[0])) : 1;
				browser.getDisplay().asyncExec(() -> {
					if (browser.isDisposed()) {
						return;
					}
					try {
						reveal(line);
					} catch (RuntimeException e) {
						MessageDialog.openError(browser.getShell(), "VERTEX", describe(e));
					}
				});
				return null;
			}
		};
	}

	private void reveal(int line) {
		Target t = target();
		ITextEditor text = t == null ? null : Adapters.adapt(t.editor, ITextEditor.class);
		if (text == null || text.getDocumentProvider() == null || t.editor.getEditorInput() == null) {
			throw new IllegalStateException("The editor this path was built in is closed. Run the command again.");
		}
		IDocument document = text.getDocumentProvider().getDocument(text.getEditorInput());
		int at = Math.max(0, Math.min(document.getNumberOfLines() - 1, line - 1));
		try {
			text.selectAndReveal(document.getLineOffset(at), 0);
		} catch (BadLocationException e) {
			throw new IllegalStateException("Line " + line + " is not in " + t.editor.getTitle() + ".", e);
		}
		t.editor.getSite().getPage().activate(t.editor);
	}
}
