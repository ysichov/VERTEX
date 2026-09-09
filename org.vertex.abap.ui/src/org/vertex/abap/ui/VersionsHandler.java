package org.vertex.abap.ui;

/** Version history of the selected object. */
public class VersionsHandler extends ServiceHandler {

	@Override
	protected String viewId() {
		return VersionsView.ID;
	}

	@Override
	protected String secondaryId(SelectionContext context, int instance) {
		return VersionsView.encode(context.object.getName(), context.object.getType(),
				context.project.getName(), instance);
	}

	@Override
	protected String description() {
		return "the versions view";
	}
}
