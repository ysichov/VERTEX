package org.vertex.abap.ui;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.IEditorReference;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.IWorkbenchPage;

import com.sap.adt.communication.resources.IRestResource;
import com.sap.adt.tools.core.model.adtcore.IAdtCoreFactory;
import com.sap.adt.tools.core.ui.navigation.AdtNavigationServiceFactory;

/**
 * The VERTEX chat: free prompts about ABAP code on the system of one ABAP
 * project. Reads go over that project's ADT session, and opening an object is
 * ADT's own navigation, so the chat never holds a connection of its own.
 */
public class ChatView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.chat";

	@Override
	protected String page() {
		return "resources/chat.html";
	}

	@Override
	protected String projectName() {
		return part(0);
	}

	@Override
	protected String title(String object) {
		return "VERTEX Chat: " + object;
	}

	@Override
	protected String initialLiteral() {
		return "null";
	}

	@Override
	protected void addFunctions() {
		// Resolving the project can ask the user to pick one, which must not
		// happen inside the browser callback.
		new BrowserFunction(this.browser, "sdeProject") {
			@Override
			public Object function(Object[] arguments) {
				queue(() -> abapProject().getName());
				return null;
			}
		};
	}

	@Override
	public void createPartControl(org.eclipse.swt.widgets.Composite parent) {
		super.createPartControl(parent);
		// The workbench owns Ctrl+C; without a handler of this view's own nothing is copied.
		getViewSite().getActionBars().setGlobalActionHandler(org.eclipse.ui.actions.ActionFactory.COPY.getId(),
				new org.eclipse.jface.action.Action() {
					@Override
					public void run() {
						Object selected = browser.evaluate("return window.getSelection().toString();");
						if (selected instanceof String && !((String) selected).isEmpty()) {
							org.eclipse.swt.dnd.Clipboard clipboard = new org.eclipse.swt.dnd.Clipboard(browser.getDisplay());
							try {
								clipboard.setContents(new Object[] { selected },
										new org.eclipse.swt.dnd.Transfer[] { org.eclipse.swt.dnd.TextTransfer.getInstance() });
							} finally {
								clipboard.dispose();
							}
						}
					}
				});
		getViewSite().getActionBars().updateActionBars();
	}

	@Override
	protected String accept(String path) {
		return path.startsWith("/sap/bc/adt/repository/informationsystem/search") ? "application/xml" : "text/plain";
	}

	@Override
	protected void addContentHandlers(IRestResource resource) {
		super.addContentHandlers(resource);
		resource.addContentHandler(new TextContentHandler("text/plain"));
		resource.addContentHandler(new TextContentHandler("application/xml"));
	}

	/**
	 * The open editors as JSON metadata - titles, and for ADT objects their name,
	 * type and project; never source. Runs on the UI thread.
	 */
	String editorContext() {
		IWorkbenchPage page = getSite().getPage();
		if (page == null) {
			return "{\"active\":null,\"open\":[]}";
		}
		IEditorPart activeEditor = page.getActiveEditor();
		StringBuilder open = new StringBuilder();
		String active = "null";
		for (IEditorReference reference : page.getEditorReferences()) {
			// Not restored editors stay closed: getEditor(false) does not open them.
			IEditorPart editor = reference.getEditor(false);
			AdtEditor adt = AdtEditor.of(editor);
			StringBuilder item = new StringBuilder("{\"title\":").append(AssistantBridge.quote(reference.getTitle()))
					.append(",\"tooltip\":").append(AssistantBridge.quote(String.valueOf(reference.getTitleToolTip())))
					.append(",\"dirty\":").append(reference.isDirty());
			if (adt != null) {
				item.append(",\"name\":").append(AssistantBridge.quote(String.valueOf(adt.name)))
						.append(",\"type\":").append(AssistantBridge.quote(String.valueOf(adt.type)))
						.append(",\"project\":").append(AssistantBridge.quote(adt.project == null ? "" : adt.project.getName()));
			}
			item.append("}");
			if (open.length() > 0) {
				open.append(",");
			}
			open.append(item);
			if (editor != null && editor == activeEditor) {
				active = item.toString();
			}
		}
		return "{\"active\":" + active + ",\"open\":[" + open + "]}";
	}

	/** Puts a prepared question into the input for the user to send or edit. */
	void prompt(String text) {
		if (!browser.isDisposed()) {
			browser.execute("(function(){var p=document.getElementById('prompt');p.value=" + AssistantBridge.quote(text)
					+ ";p.focus();})()");
		}
	}

	private static final Pattern FIELD = Pattern.compile("\"(uri|name|type)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

	/** Opens one object in ADT's editor on this chat's project. Called from the bridge worker. */
	String open(String target, Display display) {
		String uri = null, name = null, type = null;
		Matcher m = FIELD.matcher(target);
		while (m.find()) {
			String value = m.group(2).replace("\\\"", "\"").replace("\\\\", "\\");
			switch (m.group(1)) {
			case "uri": uri = value; break;
			case "name": name = value; break;
			default: type = value;
			}
		}
		if (uri == null || !uri.startsWith("/sap/bc/adt/") || uri.contains("..") || name == null || type == null) {
			return "ERROR:Invalid object to open.";
		}
		final String objectUri = uri, objectName = name, objectType = type;
		final String[] result = new String[1];
		display.syncExec(() -> {
			try {
				if (browser.isDisposed()) throw new IllegalStateException("The VERTEX chat was closed.");
				com.sap.adt.tools.core.model.adtcore.IAdtObjectReference reference =
						IAdtCoreFactory.eINSTANCE.createAdtObjectReference();
				reference.setUri(objectUri);
				reference.setName(objectName);
				reference.setType(objectType);
				IEditorPart editor = AdtNavigationServiceFactory.createNavigationService()
						.navigate(abapProject(), reference, true);
				result[0] = editor == null ? "ERROR:ADT did not open " + objectName + "." : "OK";
			} catch (RuntimeException e) {
				result[0] = "ERROR:" + describe(e);
			}
		});
		return result[0];
	}
}
