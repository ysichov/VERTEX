package org.vertex.abap.ui;

import org.eclipse.core.expressions.PropertyTester;
import org.eclipse.ui.IEditorPart;

/**
 * Whether the active editor is one VERTEX's editor commands work on, decided the way the commands decide it
 * (AdtEditor), for the editor's context menu. ADT puts its own editor commands behind a tester of its own for the
 * same reason: an ADT editor's input does not adapt to the object reference a plugin.xml test could name.
 */
public class EditorTester extends PropertyTester {

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
		case "valueOriginSource": return ValueOriginHandler.originType(object.type) != null;
		default: return false;
		}
	}
}
