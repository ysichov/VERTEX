package org.selector.adt.ui;

import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.part.ViewPart;

/**
 * Step 2: prove the data arrives. The view hosts an SWT Browser pointed at the
 * custom ADT resource; the browser widget handles the HTTP itself, including
 * whatever authentication the system asks for.
 * <p>
 * Reusing the ADT session, so that no separate login happens at all, is step 3.
 */
public class SelectorView extends ViewPart {

	public static final String ID = "org.selector.adt.ui.view";

	private static final String URL =
			"https://sap.example.com:44300/sap/bc/adt/zsde/table/T001?rows=5";

	private Browser browser;

	@Override
	public void createPartControl(Composite parent) {
		// SWT.EDGE pins the WebView2 backend. Without it SWT may fall back to the
		// legacy IE control on Windows, which cannot run the HTML/JS front end this
		// view is meant to host later.
		this.browser = new Browser(parent, SWT.EDGE);
		this.browser.setUrl(URL);
	}

	@Override
	public void setFocus() {
		this.browser.setFocus();
	}
}
