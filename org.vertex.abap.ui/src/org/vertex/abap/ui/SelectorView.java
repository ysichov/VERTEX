package org.vertex.abap.ui;

import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.IWorkbenchPage;

/**
 * Table data: the page reads one table and renders the grid, and the selection
 * panel it builds travels back as indexed query parameters.
 */
public class SelectorView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view";

	/** Secondary ids must be unique per instance. */
	private static int counter = 0;

	static String encode(String table, String project, int counter) {
		return table + SEPARATOR + project + SEPARATOR + counter;
	}

	@Override
	protected String page() {
		return "resources/table.html";
	}

	@Override
	protected String projectName() {
		return part(1);
	}

	@Override
	public void createPartControl(Composite parent) {
		String table = part(0);
		if (table != null) {
			setPartName(table);
		}
		super.createPartControl(parent);
	}

	@Override
	protected void addFunctions() {
		new BrowserFunction(this.browser, "sdeLoad") {
			@Override
			public Object function(Object[] arguments) {
				final String table = String.valueOf(arguments[0]);
				final int rows = (int) Double.parseDouble(String.valueOf(arguments[1]));
				// The page builds and encodes the selection parameters itself.
				final String query = arguments.length > 2 && arguments[2] != null
					? String.valueOf(arguments[2]) : "";
				queue(() -> read(path(table, rows, query)));
				return null;
			}
		};

		new BrowserFunction(this.browser, "sdeOpen") {
			@Override
			public Object function(Object[] arguments) {
				final String table = String.valueOf(arguments[0]);
				browser.getDisplay().asyncExec(() -> openAnother(table));
				return null;
			}
		};
	}

	@Override
	protected String initialLiteral() {
		String table = part(0);
		return table == null ? "null" : "'" + table + "'";
	}

	private static String path(String table, int rows, String query) {
		String path = "/sap/bc/adt/zsde/table/" + table.toUpperCase() + "?rows=" + rows;
		if (query != null && !query.isEmpty()) {
			path = path + "&" + query;
		}
		return path;
	}

	private void openAnother(String table) {
		try {
			counter++;
			// A plain tab. Eclipse stacks it where the perspective puts the view,
			// and dragging one out to sit beside another is a native gesture that
			// the workbench remembers.
			getViewSite().getPage().showView(ID,
					encode(table.toUpperCase(), abapProject().getName(), counter),
					IWorkbenchPage.VIEW_ACTIVATE);
		} catch (Exception e) {
			// Reuse the page's own error path rather than a dialog.
			fail(describe(e));
		}
	}
}
