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
				// AVE's switches over the list, one letter each: T keeps
				// transport-of-copies versions, D drops duplicates, I ignores
				// case and indentation.
				final String flags = text(arguments, 6);
				queue(() -> read(path(object, type, partName, partType, from, to, flags)));
				return null;
			}
		};


		// The saved review of a transport request: a different question about the
		// same scope, so a function of its own rather than a flag on sdeLoad.
		new BrowserFunction(this.browser, "sdeReview") {
			@Override
			public Object function(Object[] arguments) {
				final String request = text(arguments, 0);
				final String remote = text(arguments, 1);
				// Empty for the summary of the whole request; named when one of
				// its objects is opened, and then the answer is that object's
				// blocks and the lines they were cut from.
				final String partName = text(arguments, 2);
				final String partType = text(arguments, 3);
				queue(() -> read(reviewPath(request, remote, partName, partType)));
				return null;
			}
		};


		// The transport requests of one user, found by whose they are rather than
		// by number. An empty user is whoever is logged on: the server knows who
		// that is, and the page does not.
		new BrowserFunction(this.browser, "sdeRequests") {
			@Override
			public Object function(Object[] arguments) {
				final String user = text(arguments, 0);
				// "true" for the released requests as well; empty for open ones.
				final String released = text(arguments, 1);
				queue(() -> read(requestsPath(user, released)));
				return null;
			}
		};


		// Approving, declining and commenting - the first thing in VERTEX that
		// changes state on the server. The answer is the part as it now stands,
		// so the page renders one shape whether it asked or wrote.
		new BrowserFunction(this.browser, "sdeAct") {
			@Override
			public Object function(Object[] arguments) {
				final String request = text(arguments, 0);
				final String remote = text(arguments, 1);
				final String partName = text(arguments, 2);
				final String partType = text(arguments, 3);
				// Already JSON: the page builds it, because the page is what knows
				// which block and which words.
				final String body = text(arguments, 4);
				queue(() -> write(reviewPath(request, remote, partName, partType), body));
				return null;
			}
		};


		// Building a review. Asked with nothing in the body it says what the
		// request holds; asked with an object it prepares that one and writes it.
		// One object per call: a request of any size is then a walk this page
		// drives, with nothing long enough to be cut off at the other end, and
		// stopping is a matter of not asking again.
		new BrowserFunction(this.browser, "sdePrepare") {
			@Override
			public Object function(Object[] arguments) {
				final String request = text(arguments, 0);
				final String remote = text(arguments, 1);
				// Already JSON: the page builds it, because the page is what is
				// walking the list and knows which object it is on.
				final String body = text(arguments, 2);
				if (body.isEmpty()) {
					queue(() -> read(preparePath(request, remote)));
				} else {
					queue(() -> write(preparePath(request, remote), body));
				}
				return null;
			}
		};
	}

	private static String preparePath(String request, String remote) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/vertex/prepare/")
				.append(request.toUpperCase());
		if (!remote.isEmpty()) {
			path.append("?remote=").append(escape(remote));
		}
		return path.toString();
	}

	/**
	 * @param remote the other development system a review was run against; a
	 *               review compared with one is a different review, and its
	 *               approvals are not the ones of the plain review
	 */
	private static String reviewPath(String request, String remote, String partName, String partType) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/vertex/review/")
				.append(request.toUpperCase());
		char lead = '?';
		if (!remote.isEmpty()) {
			path.append(lead).append("remote=").append(escape(remote));
			lead = '&';
		}
		if (!partName.isEmpty()) {
			path.append(lead).append("part=").append(escape(partName));
			path.append("&ptype=").append(escape(partType));
		}
		return path.toString();
	}

	private static String requestsPath(String user, String released) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/vertex/requests");
		char lead = '?';
		if (!user.isEmpty()) {
			path.append(lead).append("user=").append(escape(user.toUpperCase()));
			lead = '&';
		}
		if (!released.isEmpty()) {
			path.append(lead).append("released=").append(escape(released));
		}
		return path.toString();
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
			String from, String to, String flags) {
		StringBuilder path = new StringBuilder("/sap/bc/adt/vertex/versions/")
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
		if (!partName.isEmpty()) {
			if (flags.contains("T")) path.append("&toc=X");
			if (flags.contains("D")) path.append("&dups=X");
			if (flags.contains("I")) path.append("&ic=X");
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
