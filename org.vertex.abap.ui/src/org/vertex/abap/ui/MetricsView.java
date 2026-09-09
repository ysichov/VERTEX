package org.vertex.abap.ui;

import org.eclipse.swt.browser.BrowserFunction;

/**
 * Code metrics of one ABAP object: McCabe complexity, Halstead and the
 * maintainability index per method, FORM or module.
 * <p>
 * The numbers are ACE's, reached over an ADT resource - see stage 9 of
 * dev_history.md for why the parse can run without SAP GUI at all.
 */
public class MetricsView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.metrics";

	static String encode(String object, String type, String project, int counter) {
		return object + SEPARATOR + type + SEPARATOR + project + SEPARATOR + counter;
	}

	@Override
	protected String page() {
		return "resources/metrics.html";
	}

	@Override
	protected String projectName() {
		return part(2);
	}

	@Override
	protected String title(String object) {
		return "Metrics: " + object;
	}

	@Override
	protected void addFunctions() {
		new BrowserFunction(this.browser, "sdeLoad") {
			@Override
			public Object function(Object[] arguments) {
				final String object = String.valueOf(arguments[0]);
				final String type = arguments.length > 1 && arguments[1] != null
					? String.valueOf(arguments[1]) : "";
				queue(() -> read(path(object, type)));
				return null;
			}
		};
	}

	@Override
	protected String initialLiteral() {
		String object = part(0);
		if (object == null) {
			return "null";
		}
		String type = part(1);
		return "{name:'" + object + "',type:'" + (type == null ? "" : type) + "'}";
	}

	/**
	 * The ADT type carries a subtype - CLAS/OC, PROG/P. It travels as it is; the
	 * resource keeps the part in front of the slash.
	 */
	private static String path(String object, String type) {
		String path = "/sap/bc/adt/zsde/metrics/" + object.toUpperCase();
		if (type != null && !type.isEmpty()) {
			path = path + "?type=" + type;
		}
		return path;
	}
}
