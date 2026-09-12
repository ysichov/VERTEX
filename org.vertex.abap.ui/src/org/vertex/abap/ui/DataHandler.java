package org.vertex.abap.ui;

/** Table data for the selected table or view. */
public class DataHandler extends ServiceHandler {

	@Override
	protected String viewId() {
		return SelectorView.ID;
	}

	@Override
	protected String secondaryId(SelectionContext context, int instance) {
		// SelecTor reads a table. Opened on a class or a program, the name would
		// be asked for as a table and answered with a 404, which the page cannot
		// tell from "the backend is not installed". An empty field says nothing
		// false and leaves the window ready for a name.
		String name = readsAsTable(context.object.getType()) ? context.object.getName() : "";
		return SelectorView.encode(name, context.project.getName(), instance);
	}

	/** The ADT type carries a subtype - TABL/DT, DDLS/DF - and the head decides. */
	private static boolean readsAsTable(String adtType) {
		String head = adtType == null ? "" : adtType.split("/")[0];
		return "TABL".equals(head) || "VIEW".equals(head) || "DDLS".equals(head);
	}

	@Override
	protected String description() {
		return "the data explorer";
	}
}
