package org.vertex.abap.ui;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import org.eclipse.swt.browser.BrowserFunction;

/**
 * The version history of one ABAP object: its versionable parts, and for the
 * part on display who changed it, when, and under which request.
 * <p>
 * The numbers are AVE's, reached over an ADT resource. A part is asked for by
 * name and type rather than by index, because the two arrive together and an
 * index would break the moment the parts list is filtered.
 */
public class VersionsView extends PageView {

	public static final String ID = "org.vertex.abap.ui.view.versions";

	static String encode(String object, String type, String project, int counter) {
		return object + SEPARATOR + type + SEPARATOR + project + SEPARATOR + counter;
	}

	@Override
	protected String page() {
		return "resources/versions.html";
	}

	@Override
	protected String projectName() {
		return part(2);
	}

	@Override
	protected String title(String object) {
		return "Versions: " + object;
	}

	@Override
	protected void addFunctions() {
		new BrowserFunction(this.browser, "sdeLoad") {
			@Override
			public Object function(Object[] arguments) {
				final String object = text(arguments, 0);
				final String type = text(arguments, 1);
				// Empty until the user picks a part; then the parts list is
				// already on screen and only the versions are asked for.
				final String partName = text(arguments, 2);
				final String partType = text(arguments, 3);
				// Empty again until a version is picked, and then the answer is
				// the difference between the two rather than the list.
				final String from = text(arguments, 4);
				final String to = text(arguments, 5);
				queue(() -> read(path(object, type, partName, partType, from, to)));
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

	private static String text(Object[] arguments, int index) {
		return index < arguments.length && arguments[index] != null
				? String.valueOf(arguments[index]) : "";
	}

	/**
	 * A part name is a VRSD object name: thirty characters of object plus the
	 * method, so it carries trailing spaces and, for a class pool, equals signs.
	 * It has to be encoded rather than pasted into the query.
	 */
	private static String path(String object, String type, String partName, String partType,
			String from, String to) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/zsde/versions/")
				.append(object.toUpperCase());
		path.append("?type=").append(escape(type));
		if (!partName.isEmpty()) {
			path.append("&part=").append(escape(partName));
			path.append("&ptype=").append(escape(partType));
		}
		if (!to.isEmpty()) {
			// An empty from is the oldest version, which is compared against
			// nothing at all - the resource reads that as every line added.
			path.append("&from=").append(escape(from));
			path.append("&to=").append(escape(to));
		}
		return path.toString();
	}

	private static String escape(String value) {
		try {
			// URLEncoder writes a space as '+', which stands for a space only
			// under form encoding. A part key is mostly spaces - the class name
			// padded to thirty characters - so it is percent-encoded strictly,
			// leaving nothing for the other side to interpret.
			return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20");
		} catch (UnsupportedEncodingException e) {
			// UTF-8 is guaranteed present; saying so beats a silent fallback.
			throw new IllegalStateException("UTF-8 is not available in this JRE.", e);
		}
	}
}
