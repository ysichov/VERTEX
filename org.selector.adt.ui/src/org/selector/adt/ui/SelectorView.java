package org.selector.adt.ui;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.e4.ui.model.application.ui.MElementContainer;
import org.eclipse.e4.ui.model.application.ui.MUIElement;
import org.eclipse.e4.ui.model.application.ui.advanced.MPlaceholder;
import org.eclipse.e4.ui.model.application.ui.basic.MPart;
import org.eclipse.e4.ui.model.application.ui.basic.MPartSashContainerElement;
import org.eclipse.e4.ui.model.application.ui.basic.MPartStack;
import org.eclipse.e4.ui.model.application.ui.basic.MStackElement;
import org.eclipse.e4.ui.model.application.ui.basic.MWindow;
import org.eclipse.e4.ui.workbench.modeling.EModelService;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.IViewPart;
import org.eclipse.ui.IWorkbenchPage;
import org.eclipse.ui.part.ViewPart;
import org.osgi.framework.FrameworkUtil;

import com.sap.adt.communication.resources.AdtRestResourceFactory;
import com.sap.adt.communication.resources.IRestResource;
import com.sap.adt.communication.resources.IRestResourceFactory;
import com.sap.adt.destinations.ui.logon.AdtLogonServiceUIFactory;
import com.sap.adt.project.IAdtCoreProject;
import com.sap.adt.tools.core.project.AdtProjectServiceFactory;
import com.sap.adt.tools.core.project.IAbapProjectService;

/**
 * Hosts resources/table.html and serves it two functions: sdeLoad reads a table,
 * sdeOpen starts another instance of this view.
 * <p>
 * Everything the user operates lives in the page; this class is transport. That
 * split is what lets the same page run under a VS Code extension later.
 */
public class SelectorView extends ViewPart {

	public static final String ID = "org.selector.adt.ui.view";

	private static final String PAGE = "resources/table.html";

	private static final String PLACEHOLDER = "/*INIT*/null/*INIT*/";

	/** Secondary ids must be unique per instance. */
	private static int counter = 0;

	private Browser browser;

	/** Answer waiting to be picked up by sdeTake. */
	private String pending;

	@Override
	public void createPartControl(Composite parent) {
		this.browser = new Browser(parent, SWT.EDGE);

		new BrowserFunction(this.browser, "sdeLoad") {
			@Override
			public Object function(Object[] arguments) {
				final String table = String.valueOf(arguments[0]);
				final int rows = (int) Double.parseDouble(String.valueOf(arguments[1]));
				// The page builds and encodes the selection parameters itself.
				final String query = arguments.length > 2 && arguments[2] != null
					? String.valueOf(arguments[2]) : "";
				// Nothing slow may run here: this callback executes inside the
				// WebView2 message pump, and blocking it makes Edge time out with
				// "Waiting for Edge operation to terminate". Hand the work back to
				// the event loop and return at once.
				browser.getDisplay().asyncExec(() -> deliver(table, rows, query));
				return null;
			}
		};

		// Called once Java says the answer is ready. Handing over a string that is
		// already in memory is instant, so doing it in a callback is safe.
		new BrowserFunction(this.browser, "sdeTake") {
			@Override
			public Object function(Object[] arguments) {
				String result = pending;
				pending = null;
				return result;
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

		String initial = tableOfThisInstance();
		if (initial != null) {
			setPartName(initial);
		}

		try {
			this.browser.setText(readPage().replace(PLACEHOLDER,
					initial == null ? "null" : "'" + initial + "'"));
		} catch (IOException e) {
			this.browser.setText(errorPage(describe(e)));
		}
	}

	/**
	 * Runs on the UI thread, which is also what ensureLoggedOn needs. Fine while
	 * the request is a reaction to a click; real volumes belong in a Job.
	 */
	private String fetch(String table, int rows, String query) {
		IAbapProjectService projectService = AdtProjectServiceFactory.createProjectService();
		IProject[] projects = projectService.getAvailableAbapProjects();
		if (projects.length == 0) {
			throw new IllegalStateException(
					"No ABAP project in this workspace. Create one, then load again.");
		}

		IProject project = projects[0];
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

		String path = "/sap/bc/adt/zsde/table/" + table.toUpperCase() + "?rows=" + rows;
		if (query != null && !query.isEmpty()) {
			path = path + "&" + query;
		}
		URI uri = URI.create(path);
		IRestResourceFactory factory = AdtRestResourceFactory.createRestResourceFactory();
		IRestResource resource = factory.createResourceWithStatelessSession(uri,
				adtProject.getDestinationId());
		resource.addContentHandler(new JsonContentHandler());
		return resource.get(new NullProgressMonitor(), String.class);
	}

	/** Does the slow work outside the browser callback, then wakes the page. */
	private void deliver(String table, int rows, String query) {
		if (this.browser.isDisposed()) {
			return;
		}
		try {
			this.pending = fetch(table, rows, query);
		} catch (Exception e) {
			this.pending = "ERROR:" + describe(e);
		}
		wake();
	}

	private void wake() {
		if (!this.browser.isDisposed()) {
			// No arguments, so nothing has to be escaped into JavaScript.
			this.browser.execute("sdeReady()");
		}
	}

	private void openAnother(String table) {
		try {
			counter++;
			IViewPart opened = getViewSite().getPage().showView(ID,
					table.toUpperCase() + "@" + counter, IWorkbenchPage.VIEW_ACTIVATE);
			splitBeside(opened);
		} catch (Exception e) {
			this.pending = "ERROR:" + describe(e);
			wake();
		}
	}

	/**
	 * showView stacks the new instance on top of this one, where it hides behind
	 * the current tab. Put it beside instead, so two tables are readable at once.
	 * <p>
	 * A 3.x view is placed in the perspective through an MPlaceholder while the
	 * MPart itself is shared, so it is the placeholder that has to move.
	 */
	private void splitBeside(IViewPart opened) {
		EModelService modelService = getSite().getService(EModelService.class);
		MPart sourcePart = getSite().getService(MPart.class);
		MPart openedPart = opened.getSite().getService(MPart.class);
		if (modelService == null || sourcePart == null || openedPart == null) {
			throw new IllegalStateException("The E4 model services are not available here.");
		}

		MWindow window = modelService.getTopLevelWindowFor(sourcePart);
		MStackElement source = placed(modelService, window, sourcePart);
		MStackElement moved = placed(modelService, window, openedPart);

		MElementContainer<MUIElement> stack = source.getParent();
		if (!(stack instanceof MPartSashContainerElement)) {
			throw new IllegalStateException("Cannot split: this view is not in a part stack.");
		}

		MPartStack target = modelService.createModelElement(MPartStack.class);
		modelService.insert(target, (MPartSashContainerElement) stack,
				EModelService.RIGHT_OF, 0.5f);
		modelService.move(moved, target);
		modelService.bringToTop(moved);
	}

	private static MStackElement placed(EModelService modelService, MWindow window, MPart part) {
		MPlaceholder placeholder = modelService.findPlaceholderFor(window, part);
		return placeholder != null ? placeholder : part;
	}

	/** The table this instance was opened for, encoded in its secondary id. */
	private String tableOfThisInstance() {
		String secondaryId = getViewSite().getSecondaryId();
		if (secondaryId == null) {
			return null;
		}
		int at = secondaryId.indexOf('@');
		return at < 0 ? secondaryId : secondaryId.substring(0, at);
	}

	private String readPage() throws IOException {
		URL entry = FrameworkUtil.getBundle(SelectorView.class).getEntry(PAGE);
		if (entry == null) {
			throw new IOException(PAGE + " is missing from the bundle."
					+ " Check that build.properties lists resources/ under bin.includes.");
		}
		try (InputStream in = entry.openStream()) {
			return new String(in.readAllBytes(), StandardCharsets.UTF_8);
		}
	}

	private static String describe(Throwable e) {
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
