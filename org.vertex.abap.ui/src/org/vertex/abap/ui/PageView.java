package org.vertex.abap.ui;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.function.Supplier;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.jface.viewers.LabelProvider;
import org.eclipse.jface.window.Window;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.program.Program;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.dialogs.ElementListSelectionDialog;
import org.eclipse.ui.part.ViewPart;
import org.osgi.framework.FrameworkUtil;

import com.sap.adt.communication.resources.AdtRestResourceFactory;
import com.sap.adt.communication.resources.IRestResource;
import com.sap.adt.communication.resources.IRestResourceFactory;
import com.sap.adt.communication.resources.ResourceNotFoundException;
import com.sap.adt.destinations.ui.logon.AdtLogonServiceUIFactory;
import com.sap.adt.project.IAdtCoreProject;
import com.sap.adt.tools.core.project.AdtProjectServiceFactory;

/**
 * A view that is nothing but a browser and a way back to ABAP: it loads a page
 * from the bundle, answers it over the sdeLoad / sdeTake / sdeReady contract,
 * and reads one ADT resource on the system the instance belongs to.
 * <p>
 * Everything the user operates lives in the page. That split is what lets the
 * same page run under a VS Code host, and it is why this class holds no widget
 * of its own.
 */
public abstract class PageView extends ViewPart {

	/** Not a regex metacharacter, and not legal in ABAP object names. */
	protected static final String SEPARATOR = "~";

	private static final String PLACEHOLDER = "/*INIT*/null/*INIT*/";

	protected Browser browser;

	/** The system this window talks to, once resolved. */
	private IProject project;

	/** Answer waiting to be picked up by sdeTake. */
	private String pending;

	/** Bundle-relative path of the page this view hosts. */
	protected abstract String page();

	/**
	 * The JavaScript literal the page starts from, substituted for its INIT
	 * marker. Built here rather than in the page, because only the view knows
	 * what the instance was opened for.
	 */
	protected abstract String initialLiteral();

	/**
	 * Where sdeTake and the ADT plumbing are already in place, this adds what
	 * the page itself calls - sdeLoad, and whatever else the service needs.
	 */
	protected abstract void addFunctions();

	/** The part of the secondary id holding the project name. */
	protected abstract String projectName();

	/**
	 * The tab name for the object on display. Several windows can stand on one
	 * object, so a service that shares that object with another says which it
	 * is - and it says so first, because Eclipse truncates a tab from the right.
	 */
	protected String title(String object) {
		return object;
	}

	@Override
	public void createPartControl(Composite parent) {
		this.browser = new Browser(parent, SWT.EDGE);

		// Called once Java says the answer is ready. Handing over a string that
		// is already in memory is instant, so doing it in a callback is safe.
		new BrowserFunction(this.browser, "sdeTake") {
			@Override
			public Object function(Object[] arguments) {
				String result = pending;
				pending = null;
				return result;
			}
		};

		// Opening a link must not navigate the view away from the page it is
		// on, so it goes to whatever the desktop uses for a browser.
		new BrowserFunction(this.browser, "sdeBrowse") {
			@Override
			public Object function(Object[] arguments) {
				if (arguments.length > 0 && arguments[0] != null) {
					Program.launch(String.valueOf(arguments[0]));
				}
				return null;
			}
		};

		// The page reports what it has loaded, so a window driven from its own
		// input bar does not keep the name of the object it was opened on.
		new BrowserFunction(this.browser, "sdeTitle") {
			@Override
			public Object function(Object[] arguments) {
				if (arguments.length > 0 && arguments[0] != null) {
					String object = String.valueOf(arguments[0]);
					if (!object.isEmpty()) {
						setPartName(title(object));
					}
				}
				return null;
			}
		};

		addFunctions();
		if (this instanceof SelectorView || this instanceof VersionsView || this instanceof ChatView) {
			new AssistantBridge(this);
		}

		String opened = part(0);
		if (opened != null) {
			setPartName(title(opened));
		}

		try {
			this.browser.setText(readPage().replace(PLACEHOLDER, initialLiteral()));
		} catch (IOException e) {
			this.browser.setText(errorPage(describe(e)));
		}
	}

	/**
	 * Hands work back to the event loop and returns at once. Nothing slow may
	 * run inside a BrowserFunction: the callback executes in the WebView2
	 * message pump, and blocking it makes Edge time out with "Waiting for Edge
	 * operation to terminate".
	 */
	protected void queue(Supplier<String> work) {
		this.browser.getDisplay().asyncExec(() -> deliver(work));
	}

	/** Does the slow work outside the browser callback, then wakes the page. */
	private void deliver(Supplier<String> work) {
		if (this.browser.isDisposed()) {
			return;
		}
		try {
			this.pending = work.get();
		} catch (Exception e) {
			// A resource that is not there is a setup state, not a failure: the
			// plugin is installed on this machine and the ABAP half has never
			// been put on the system. The page says what to install; it needs
			// to be told which of the two this is.
			this.pending = "ERROR:" + (missingBackend(e) ? "NOBACKEND:" : "") + describe(e);
		}
		wake();
	}

	/**
	 * Reports a failure through the page rather than a dialog, for work that did
	 * not come from a page request and so has no answer to return.
	 */
	protected void fail(String text) {
		this.pending = "ERROR:" + text;
		wake();
	}

	private void wake() {
		if (!this.browser.isDisposed()) {
			// No arguments, so nothing has to be escaped into JavaScript.
			this.browser.execute("sdeReady()");
		}
	}

	/**
	 * Reads one ADT resource over the session of this instance's project. Runs
	 * on the UI thread, which is also what ensureLoggedOn needs - fine while the
	 * request is a reaction to a click; real volumes belong in a Job.
	 *
	 * @param path relative to the system root; the destination supplies host and
	 *             port
	 */
	protected String read(String path) {
		return get(resource(path), path);
	}

	/**
	 * The media type to ask for, for a view that reads standard ADT resources: some
	 * of them refuse a request without an Accept header. Null sends none.
	 */
	protected String accept(String path) {
		return null;
	}

	private String get(IRestResource resource, String path) {
		String type = accept(path);
		if (type == null) {
			return resource.get(new NullProgressMonitor(), String.class);
		}
		com.sap.adt.communication.message.IHeaders headers = com.sap.adt.communication.message.HeadersFactory.newHeaders();
		headers.addField(com.sap.adt.communication.message.HeadersFactory.newField("Accept", type));
		return resource.get(new NullProgressMonitor(), headers, String.class);
	}

	/** Logon and project selection stay on SWT; network I/O runs in the worker. */
	String assistantRead(String path, org.eclipse.swt.widgets.Display display) {
		final IRestResource[] target = new IRestResource[1];
		final RuntimeException[] failure = new RuntimeException[1];
		display.syncExec(() -> {
			try {
				if (browser.isDisposed()) throw new IllegalStateException("The VERTEX window was closed.");
				target[0] = resource(path);
			} catch (RuntimeException e) { failure[0] = e; }
		});
		if (failure[0] != null) throw failure[0];
		return get(target[0], path);
	}

	/**
	 * Writes to one ADT resource over the same session as {@link #read}. The ADT
	 * communication layer carries the CSRF token for the destination, so nothing
	 * here has to fetch one.
	 *
	 * @param body the request body, already JSON
	 */
	protected String write(String path, String body) {
		return resource(path).post(new NullProgressMonitor(), String.class, body);
	}

	private IRestResource resource(String path) {
		IProject project = abapProject();
		IAdtCoreProject adtProject = project.getAdapter(IAdtCoreProject.class);
		if (adtProject == null) {
			throw new IllegalStateException(
					"Project " + project.getName() + " does not adapt to IAdtCoreProject.");
		}

		IStatus logon = AdtLogonServiceUIFactory.createLogonServiceUI().ensureLoggedOn(project);
		if (!logon.isOK()) {
			throw new IllegalStateException(
					"Logon to " + project.getName() + " failed: " + logon.getMessage());
		}

		IRestResourceFactory factory = AdtRestResourceFactory.createRestResourceFactory();
		IRestResource resource = factory.createResourceWithStatelessSession(URI.create(path),
				adtProject.getDestinationId());
		addContentHandlers(resource);
		return resource;
	}

	/** The VERTEX resources answer JSON; a view reading standard ADT resources adds more. */
	protected void addContentHandlers(IRestResource resource) {
		resource.addContentHandler(new JsonContentHandler());
	}

	/**
	 * The system this window reads from. It travels in the secondary id, because
	 * that is the only per-instance state Eclipse restores after a restart.
	 */
	protected IProject abapProject() {
		if (this.project != null && this.project.isAccessible()) {
			return this.project;
		}
		String name = projectName();
		if (name != null) {
			IProject named = ResourcesPlugin.getWorkspace().getRoot().getProject(name);
			if (named.exists()) {
				this.project = named;
				return this.project;
			}
		}
		this.project = withoutAProject(name);
		return this.project;
	}

	/**
	 * Which system to read from when the secondary id names no project, or names
	 * one this workspace no longer has. Opened from an object there is one to
	 * inherit; opened through Show View, or after the workspace changed, there
	 * is not - one project is then unambiguous, several are not, and the user is
	 * asked rather than guessed at.
	 *
	 * @param name the project the id named, or null when it named none
	 */
	protected IProject withoutAProject(String name) {
		IProject[] projects = AdtProjectServiceFactory.createProjectService()
			.getAvailableAbapProjects();
		if (projects.length == 0) {
			throw new IllegalStateException(
				"No ABAP project in this workspace. Create one, then load again.");
		}
		if (projects.length == 1) {
			return projects[0];
		}
		ElementListSelectionDialog dialog = new ElementListSelectionDialog(
			getSite().getShell(), new LabelProvider() {
				@Override
				public String getText(Object element) {
					return ((IProject) element).getName();
				}
			});
		dialog.setTitle("VERTEX");
		dialog.setMessage("Which ABAP project should this window read from?");
		dialog.setElements(projects);
		if (dialog.open() != Window.OK) {
			throw new IllegalStateException("No system was chosen, so nothing was read.");
		}
		return (IProject) dialog.getFirstResult();
	}

	/** One part of the secondary id, or null when it is not there. */
	protected String part(int index) {
		String secondaryId = getViewSite().getSecondaryId();
		if (secondaryId == null) {
			return null;
		}
		String[] parts = secondaryId.split(SEPARATOR, -1);
		return index < parts.length && !parts[index].isEmpty() ? parts[index] : null;
	}

	private String readPage() throws IOException {
		return readResource(page());
	}

	/**
	 * Reads a file that ships inside the bundle, as text. A page is one such
	 * file; a library a page needs is another, and neither can be fetched over
	 * a URL, because the browser is handed its document as a string and so has
	 * no address to resolve anything against.
	 *
	 * @param path bundle-relative, e.g. resources/mermaid.min.js
	 */
	protected String readResource(String path) throws IOException {
		URL entry = FrameworkUtil.getBundle(getClass()).getEntry(path);
		if (entry == null) {
			throw new IOException(path + " is missing from the bundle."
					+ " Check that build.properties lists resources/ under bin.includes.");
		}
		try (InputStream in = entry.openStream()) {
			return new String(in.readAllBytes(), StandardCharsets.UTF_8);
		}
	}

	private static boolean missingBackend(Throwable e) {
		for (Throwable t = e; t != null; t = t.getCause()) {
			if (t instanceof ResourceNotFoundException) {
				return true;
			}
		}
		return false;
	}

	protected static String describe(Throwable e) {
		StringBuilder sb = new StringBuilder();
		for (Throwable t = e; t != null; t = t.getCause()) {
			if (sb.length() > 0) {
				sb.append(" | ");
			}
			sb.append(t.getMessage() == null ? t.getClass().getName() : t.getMessage());
		}
		return sb.toString();
	}

	private static String errorPage(String text) {
		return "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>"
				+ "<pre style='font:12px Consolas,monospace;color:#a5292a;padding:12px'>"
				+ escape(text) + "</pre></body></html>";
	}

	private static String escape(String text) {
		return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
	}

	@Override
	public void setFocus() {
		this.browser.setFocus();
	}
}
