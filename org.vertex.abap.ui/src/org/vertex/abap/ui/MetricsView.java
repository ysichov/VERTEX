package org.vertex.abap.ui;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import org.eclipse.swt.browser.BrowserFunction;

/**
 * Code metrics of one ABAP object: McCabe complexity, Halstead and the
 * maintainability index per method, FORM or module.
 * <p>
 * The numbers are ACE's, reached over an ADT resource - see stage 9 of
 * dev_history.md for why the parse can run without SAP GUI at all. So is the
 * branch scheme behind the Flow button, which is the same parse read a second
 * way and answered as mermaid text.
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

		new BrowserFunction(this.browser, "sdeClass") {
			@Override
			public Object function(Object[] arguments) {
				final String object = argument(arguments, 0);
				final String type = argument(arguments, 1);
				queue(() -> read("/sap/bc/adt/vertex/" + ("DEVC".equalsIgnoreCase(type) ? "package/" : "class/") + escape(object.toUpperCase())));
				return null;
			}
		};

		// The branch scheme of one unit. It carries the include as well as the
		// name, because that is what identifies the code: for a class the two
		// are the same thing, for a program they are not.
		new BrowserFunction(this.browser, "sdeFlow") {
			@Override
			public Object function(Object[] arguments) {
				final String object = argument(arguments, 0);
				final String type = argument(arguments, 1);
				final String mode = argument(arguments, 2);
				final String include = argument(arguments, 3);
				final String unit = argument(arguments, 4);
				final String expand = argument(arguments, 5);
				final String depth = argument(arguments, 6);
				// The calculated path only, as ACE draws it in SAP GUI by default.
				final String calc = argument(arguments, 7);
				// Every event, form and method as its own block - ACE's All Blocks.
				final String all = argument(arguments, 8);
				// Where the walk starts: an event or a form, as in ACE's tree.
				final String start = argument(arguments, 9);
				final String startType = argument(arguments, 10);
				queue(() -> read(flowPath(object, type, mode, include, unit, expand, depth, calc, all,
						start, startType)));
				return null;
			}
		};

		// mermaid ships inside the plugin: this window has to work on a machine
		// that cannot reach the internet, and the document the browser is given
		// is a string with no address, so a script tag has nothing to resolve
		// against either way. It is megabytes, so it is handed over the first
		// time a diagram is asked for rather than on every open.
		new BrowserFunction(this.browser, "sdeAsset") {
			@Override
			public Object function(Object[] arguments) {
				final String name = argument(arguments, 0);
				queue(() -> asset(name));
				return null;
			}
		};
	}

	/** One argument of a page call, or "" where the page passed none. */
	private static String argument(Object[] arguments, int index) {
		return index < arguments.length && arguments[index] != null
			? String.valueOf(arguments[index]) : "";
	}

	/**
	 * A library the page asks for by name. The names are a fixed list rather
	 * than a path the page hands over, so this call can never read anything the
	 * plugin did not mean to ship.
	 */
	private String asset(String name) {
		if (!"mermaid".equals(name)) {
			throw new IllegalStateException("This window ships no asset called " + name + ".");
		}
		try {
			return readResource("resources/mermaid.min.js");
		} catch (IOException e) {
			throw new IllegalStateException(describe(e), e);
		}
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
		String path = "/sap/bc/adt/vertex/metrics/" + object.toUpperCase();
		if (type != null && !type.isEmpty()) {
			path = path + "?type=" + type;
		}
		return path;
	}

	private static String classPath(String object) {
		return "/sap/bc/adt/vertex/class/" + object.toUpperCase();
	}

	/**
	 * @param mode   which picture: the branch scheme of one unit, or the order
	 *               the whole object's units would run in
	 * @param unit   the qualified name the metrics row showed, CLASS=&gt;METHOD
	 *               for a method
	 * @param expand lines whose folded stretch the reader has opened, as the
	 *               page echoes them back
	 * @param depth  how far the flow follows calls; the scheme does not follow
	 *               any, and passes none
	 */
	private static String flowPath(String object, String type, String mode, String include,
			String unit, String expand, String depth, String calc, String all,
			String start, String startType) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/vertex/flow/")
			.append(object.toUpperCase())
			.append("?mode=").append(escape(mode.isEmpty() ? "scheme" : mode));
		if (!include.isEmpty()) {
			path.append("&include=").append(escape(include));
		}
		if (!type.isEmpty()) {
			path.append("&type=").append(escape(type));
		}
		if (!unit.isEmpty()) {
			path.append("&unit=").append(escape(unit));
		}
		if (!expand.isEmpty()) {
			path.append("&expand=").append(escape(expand));
		}
		if (!depth.isEmpty()) {
			path.append("&depth=").append(escape(depth));
		}
		if (!calc.isEmpty()) {
			path.append("&calc=X");
		}
		if (!all.isEmpty()) {
			path.append("&all=X");
		}
		if (!start.isEmpty()) {
			path.append("&start=").append(escape(start)).append("&stype=").append(escape(startType));
		}
		return path.toString();
	}

	/** A method name carries "=>", which an untouched query string would eat. */
	private static String escape(String value) {
		return URLEncoder.encode(value, StandardCharsets.UTF_8);
	}
}
