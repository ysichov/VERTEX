package org.vertex.abap.ui;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import org.eclipse.core.commands.AbstractHandler;
import org.eclipse.core.commands.ExecutionEvent;
import org.eclipse.core.commands.ExecutionException;
import org.eclipse.core.resources.IMarker;
import org.eclipse.core.runtime.Adapters;
import org.eclipse.core.runtime.CoreException;
import org.eclipse.debug.core.DebugPlugin;
import org.eclipse.debug.core.model.IBreakpoint;
import org.eclipse.jface.text.BadLocationException;
import org.eclipse.jface.text.IDocument;
import org.eclipse.jface.text.ITextSelection;
import org.eclipse.jface.text.Position;
import org.eclipse.jface.text.source.Annotation;
import org.eclipse.jface.text.source.IAnnotationModel;
import org.eclipse.jface.viewers.ISelection;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.handlers.HandlerUtil;
import org.eclipse.ui.texteditor.ITextEditor;
import org.eclipse.ui.texteditor.SimpleMarkerAnnotation;

/**
 * VERTEX: Analyze Variable Value Origin, on the cursor in an ADT source editor. What the editor shows - the object,
 * its text, the cursor and the breakpoints on its rulers - is taken here, while the editor is the active part, and
 * handed to a Value origin window, which reads SAP and runs the analysis in its page.
 */
public class ValueOriginHandler extends AbstractHandler {

	/** ADT's own line breakpoints; its statement, exception and message breakpoints are not on a line. */
	private static final String LINE_BREAKPOINT = "com.sap.adt.debugger.lineBreakpointMarker";
	private static int counter;

	@Override
	public Object execute(ExecutionEvent event) throws ExecutionException {
		Shell shell = HandlerUtil.getActiveShell(event);
		IEditorPart editor = HandlerUtil.getActiveEditor(event);
		AdtEditor object = editor == null ? null : AdtEditor.of(editor);
		if (object == null || object.project == null) {
			SelectionContext.report(shell, "Select a variable in an ABAP source editor of an ABAP project.");
			return null;
		}
		String type = originType(object.type);
		// An editor's object URI is the object's or, for an open source, already the source's own.
		String path = object.uri.endsWith("/source/main") ? object.uri : ActivateHandler.sourcePath(object);
		if (type == null || path == null) {
			SelectionContext.report(shell, "Value origin runs on the source of a program, a class, an interface or a function module, not "
					+ object.type + ". A class is analysed from its Global Class tab.");
			return null;
		}
		ITextEditor text = Adapters.adapt(editor, ITextEditor.class);
		if (text == null || text.getDocumentProvider() == null) {
			SelectionContext.report(shell, "The editor of " + object.name + " does not offer its text.");
			return null;
		}
		if (editor.isDirty()) {
			SelectionContext.report(shell, "Save and activate the source before ACE analysis. ACE reads active SAP code.");
			return null;
		}
		ISelection selection = text.getSelectionProvider().getSelection();
		if (!(selection instanceof ITextSelection)) {
			SelectionContext.report(shell, "Place the cursor on a variable.");
			return null;
		}
		IDocument document = text.getDocumentProvider().getDocument(text.getEditorInput());
		int offset = ((ITextSelection) selection).getOffset();
		int line, column;
		try {
			line = document.getLineOfOffset(offset);
			column = offset - document.getLineOffset(line);
		} catch (BadLocationException e) {
			throw new ExecutionException("The cursor is outside the editor's text", e);
		}

		String id = String.valueOf(++counter);
		ValueOriginView.TARGETS.put(id, new ValueOriginView.Target(editor, object, type, path, document.get(), offset, line + 1, column,
				breakpoints(text, document)));
		try {
			IWorkbenchPage page = HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage();
			page.showView(ValueOriginView.ID, id, IWorkbenchPage.VIEW_ACTIVATE);
		} catch (Exception e) {
			ValueOriginView.TARGETS.remove(id);
			throw new ExecutionException("Cannot open the VERTEX Value origin window", e);
		}
		return null;
	}

	/** The object type the ACE origin index is asked for, as VS Code names it; null for one it does not analyse. */
	static String originType(String adtType) {
		if (adtType == null) {
			return null;
		}
		switch (adtType) {
		case "PROG/P": return "PROG";
		case "CLAS/OC": return "CLAS";
		case "INTF/OI": return "INTF";
		case "FUGR/FF": return "FUNC";
		default: return null;
		}
	}

	/**
	 * The lines of the enabled ADT line breakpoints the editor shows, found the way ADT finds the breakpoint on a line
	 * of its editor: the markers of the editor's annotation model, at the line their annotation stands on now.
	 */
	private static List<Integer> breakpoints(ITextEditor text, IDocument document) throws ExecutionException {
		List<Integer> lines = new ArrayList<>();
		IAnnotationModel model = text.getDocumentProvider().getAnnotationModel(text.getEditorInput());
		if (model == null) {
			return lines;
		}
		try {
			for (Iterator<Annotation> it = model.getAnnotationIterator(); it.hasNext();) {
				Annotation annotation = it.next();
				if (!(annotation instanceof SimpleMarkerAnnotation)) {
					continue;
				}
				IMarker marker = ((SimpleMarkerAnnotation) annotation).getMarker();
				if (marker == null || !marker.exists() || !marker.isSubtypeOf(LINE_BREAKPOINT)) {
					continue;
				}
				IBreakpoint breakpoint = DebugPlugin.getDefault().getBreakpointManager().getBreakpoint(marker);
				Position position = model.getPosition(annotation);
				if (breakpoint == null || !breakpoint.isEnabled() || position == null) {
					continue;
				}
				int line = document.getLineOfOffset(position.getOffset()) + 1;
				if (!lines.contains(line)) {
					lines.add(line);
				}
			}
		} catch (CoreException | BadLocationException e) {
			throw new ExecutionException("Cannot read the breakpoints of the editor", e);
		}
		return lines;
	}
}
