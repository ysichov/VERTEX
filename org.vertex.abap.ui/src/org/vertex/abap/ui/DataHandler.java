package org.vertex.abap.ui;

/** Table data for the selected table or view. */
public class DataHandler extends ServiceHandler {

	@Override
	protected String viewId() {
		return SelectorView.ID;
	}

	@Override
	protected String secondaryId(SelectionContext context, int instance) {
		return SelectorView.encode(context.object.getName(), context.project.getName(), instance);
	}

	@Override
	protected String description() {
		return "the data explorer";
	}
}
