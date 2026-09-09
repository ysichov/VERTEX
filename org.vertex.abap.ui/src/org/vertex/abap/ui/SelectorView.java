package org.vertex.abap.ui;

import org.eclipse.swt.browser.BrowserFunction;
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

		// The join is a different question about the same table, so it is a
		// function of its own rather than a mode flag on sdeLoad.
		new BrowserFunction(this.browser, "sdeJoin") {
			@Override
			public Object function(Object[] arguments) {
				final String table = String.valueOf(arguments[0]);
				// The tables taken into the join, in the order they were taken:
				// the builder hands out an alias on first selection and never
				// reuses it, so the order is what keeps the aliases stable.
				final String taken = arguments.length > 1 && arguments[1] != null
					? String.valueOf(arguments[1]) : "";
				// Nought while the join is still being assembled: the statement
				// is worth seeing before it is worth running.
				final int rows = arguments.length > 2 && arguments[2] != null
					? (int) Double.parseDouble(String.valueOf(arguments[2])) : 0;
				// The same selection parameters the grid sends. A filter typed
				// on the table applies to the join built from it, which is what
				// it does in SDE.
				final String query = arguments.length > 3 && arguments[3] != null
					? String.valueOf(arguments[3]) : "";
				// The pivot cross, already encoded: r/c/v keys with the
				// aggregate of each measure in a.
				final String cross = arguments.length > 4 && arguments[4] != null
					? String.valueOf(arguments[4]) : "";
				queue(() -> read(joinPath(table, taken, rows, query, cross)));
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

	/** @param taken comma-separated table names, in the order they were chosen */
	private static String joinPath(String table, String taken, int rows, String query,
			String cross) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/zsde/join/")
				.append(table.toUpperCase());
		// The resource stops at the first missing t-parameter, so the numbering
		// has to be contiguous however gappy the list arrives.
		int n = 0;
		for (String raw : taken.split(",", -1)) {
			String name = raw.trim();
			if (name.isEmpty()) {
				continue;
			}
			n++;
			path.append(n == 1 ? "?" : "&");
			path.append("t").append(n).append("=").append(name.toUpperCase());
		}
		if (rows > 0) {
			path.append(n == 0 ? "?" : "&").append("rows=").append(rows);
			n++;
		}
		if (!query.isEmpty()) {
			path.append(n == 0 ? "?" : "&").append(query);
			n++;
		}
		if (!cross.isEmpty()) {
			path.append(n == 0 ? "?" : "&").append(cross);
		}
		return path.toString();
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
