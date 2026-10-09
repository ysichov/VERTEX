package org.vertex.abap.ui;

/**
 * VERTEX: Backward Usage Analysis, on the cursor in an ADT source editor: where the values of the routine there go in
 * its callers, up through theirs, by SAP's where-used - the window Forward Usage Analysis opens, run the other way.
 */
public class BackwardUsageHandler extends ValueOriginHandler {

	@Override
	protected String direction() {
		return "backward";
	}
}
