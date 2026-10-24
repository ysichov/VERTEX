package org.vertex.abap.ui;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.eclipse.swt.browser.BrowserFunction;

import com.sap.adt.communication.resources.IRestResource;

/**
 * Run Select's window: the rows of a SELECT run through ADT's data preview. The decision and the page are VS Code's
 * (select-query.run), made in the page's analysis worker; a SELECT that SelecTor can say opens in VERTEX Tools instead,
 * and this window closes.
 */
public class RunSelectView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.runSelect";

	static final class Target {
		final String project;
		final String text;
		final int offset;

		Target(String project, String text, int offset) {
			this.project = project;
			this.text = text;
			this.offset = offset;
		}
	}

	static final Map<String, Target> TARGETS = new ConcurrentHashMap<>();

	private static final String PAGE = "assistant/run-select.html";
	private static int counter;
	private Target target;

	private Target target() {
		if (target == null) {
			target = TARGETS.remove(String.valueOf(getViewSite().getSecondaryId()));
		}
		return target;
	}

	@Override
	protected String page() {
		return PAGE;
	}

	@Override
	protected String projectName() {
		Target t = target();
		return t == null ? null : t.project;
	}

	@Override
	protected String title(String object) {
		return object.equals(getViewSite().getSecondaryId()) ? "Run Select" : object;
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
		// The source is ABAP, and ABAP may hold "</script>" in a literal.
		return ("{\"text\":" + AssistantBridge.quote(t.text) + ",\"offset\":" + t.offset + "}").replace("<", "\\u003c");
	}

	@Override
	protected void addContentHandlers(IRestResource resource) {
		super.addContentHandlers(resource);
		addAdtTextHandlers(resource);
	}

	@Override
	protected void addFunctions() {
		// The data preview and the dictionary are read in the analysis worker over this project's ADT session.
		addAnalysisFunctions();
		// A SELECT that SelecTor can say: VERTEX Tools opens on its table with the plan, and this window goes.
		new BrowserFunction(this.browser, "sdeRunSelectTools") {
			@Override
			public Object function(Object[] arguments) {
				String opens = arguments.length > 0 && arguments[0] != null ? String.valueOf(arguments[0]) : "{}";
				browser.getDisplay().asyncExec(() -> {
					if (browser.isDisposed()) {
						return;
					}
					Target t = target();
					String name = com.google.gson.JsonParser.parseString(opens).getAsJsonObject().get("name").getAsString();
					String id = MetricsView.encode(name, "TABL", t == null ? "" : t.project, ++counter) + SEPARATOR + "select";
					ToolsView.OPENS.put(id, opens);
					try {
						DetachedView.show(getSite().getPage(), ToolsView.ID, id);
					} catch (Exception e) {
						ToolsView.OPENS.remove(id);
						org.eclipse.jface.dialogs.MessageDialog.openError(browser.getShell(), "VERTEX", "Cannot open VERTEX Tools: " + describe(e));
						return;
					}
					getSite().getPage().hideView(RunSelectView.this);
				});
				return null;
			}
		};
	}
}
