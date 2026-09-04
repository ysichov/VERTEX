package org.selector.adt.ui;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.eclipse.core.resources.IProject;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.NullProgressMonitor;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.widgets.Composite;
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
 * Fetches table data over the ADT session the ABAP project already holds and
 * renders it with the page in resources/table.html.
 * <p>
 * The page knows nothing about SAP: it receives finished JSON from the host.
 * That is deliberate, so the same page can later be driven by a VS Code
 * extension instead of this view.
 */
public class SelectorView extends ViewPart {

	public static final String ID = "org.selector.adt.ui.view";

	/** Relative to the system root; the destination supplies host and port. */
	private static final String RESOURCE = "/sap/bc/adt/zsde/table/T001?rows=100";

	private static final String PAGE = "resources/table.html";

	private static final String PLACEHOLDER = "/*DATA*/null/*DATA*/";

	private Browser browser;

	@Override
	public void createPartControl(Composite parent) {
		this.browser = new Browser(parent, SWT.EDGE);
		try {
			this.browser.setText(readPage().replace(PLACEHOLDER, embeddable(fetch())));
		} catch (Exception e) {
			this.browser.setText(errorPage(e));
		}
	}

	/**
	 * Runs on the UI thread. Fine for a hundred rows; reading real volumes
	 * belongs in a Job.
	 */
	private String fetch() {
		IAbapProjectService projectService = AdtProjectServiceFactory.createProjectService();
		IProject[] projects = projectService.getAvailableAbapProjects();
		if (projects.length == 0) {
			throw new IllegalStateException(
					"No ABAP project in this workspace. Create one, then reopen this view.");
		}

		IProject project = projects[0];
		IAdtCoreProject adtProject = project.getAdapter(IAdtCoreProject.class);
		if (adtProject == null) {
			throw new IllegalStateException(
					"Project " + project.getName() + " does not adapt to IAdtCoreProject.");
		}

		// The destination is registered lazily, on first contact with the system.
		// After a restart the project exists but nothing has connected yet, so the
		// request would fail with "destination ... is not registered".
		IStatus logon = AdtLogonServiceUIFactory.createLogonServiceUI().ensureLoggedOn(project);
		if (!logon.isOK()) {
			throw new IllegalStateException(
				"Logon to " + project.getName() + " failed: " + logon.getMessage());
		}

		IRestResourceFactory factory = AdtRestResourceFactory.createRestResourceFactory();
		IRestResource resource = factory.createResourceWithStatelessSession(URI.create(RESOURCE),
				adtProject.getDestinationId());
		resource.addContentHandler(new JsonContentHandler());

		return resource.get(new NullProgressMonitor(), String.class);
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

	/**
	 * Keeps a stray "&lt;/script&gt;" inside the data from ending the script
	 * element the JSON is embedded in.
	 */
	private static String embeddable(String json) {
		return json.replace("</", "<\\/");
	}

	private static String errorPage(Exception e) {
		StringBuilder sb = new StringBuilder();
		for (Throwable t = e; t != null; t = t.getCause()) {
			if (sb.length() > 0) {
				sb.append("\n\ncaused by ").append(t.getClass().getName()).append('\n');
			}
			sb.append(t.getMessage() == null ? t.getClass().getName() : t.getMessage());
		}
		return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>"
				+ "<pre style=\"font:12px Consolas,monospace;color:#a5292a;padding:12px;"
				+ "white-space:pre-wrap\">" + escape(sb.toString()) + "</pre></body></html>";
	}

	private static String escape(String text) {
		return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
	}

	@Override
	public void setFocus() {
		this.browser.setFocus();
	}
}
