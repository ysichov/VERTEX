package org.vertex.abap.ui;

import org.eclipse.core.expressions.PropertyTester;
import org.eclipse.ui.IEditorPart;

/**
 * Whether the active editor is one VERTEX's editor commands work on, decided the way the commands decide it
 * (AdtEditor), for the editor's context menu. ADT puts its own editor commands behind a tester of its own for the
 * same reason: an ADT editor's input does not adapt to the object reference a plugin.xml test could name.
 */
public class EditorTester extends PropertyTester {

	private static final java.util.Set<String> REPORTED = java.util.concurrent.ConcurrentHashMap.newKeySet();

	@Override
	public boolean test(Object receiver, String property, Object[] args, Object expectedValue) {
		if (!(receiver instanceof IEditorPart)) {
			return false;
		}
		AdtEditor object = AdtEditor.of((IEditorPart) receiver);
		if (object == null) {
			return false;
		}
		switch (property) {
		// Any ADT object - VERTEX Tools and Activate.
		case "adtObject": return true;
		case "valueOriginSource": {
			boolean offered = ValueOriginHandler.originType(object.kind()) != null;
			// Said once per object in the Error Log: what an editor the analyses are not offered for reports itself as.
			if (!offered && REPORTED.add(object.uri)) {
				org.eclipse.core.runtime.Platform.getLog(EditorTester.class).info("VERTEX: no analyses for this editor - type "
						+ object.type + ", kind " + object.kind() + ", ADT URI " + object.uri + ", editor " + receiver.getClass().getName());
			}
			return offered;
		}
		default: return false;
		}
	}
}
