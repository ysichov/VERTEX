package org.vertex.abap.ui;

import org.eclipse.core.resources.IFile;
import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.IResource;
import org.eclipse.core.runtime.Adapters;
import org.eclipse.ui.IEditorInput;
import org.eclipse.ui.IEditorPart;

import com.sap.adt.project.IProjectProvider;
import com.sap.adt.tools.core.IAdtObjectReference;

/**
 * The ADT object an editor shows. ADT registers its adapter to the EMF
 * reference for any object, not to the core one, so both are asked for, on the
 * input, the editor and the input's file.
 */
final class AdtEditor {

	final String name;
	final String type;
	/** Path of the object's ADT URI, without host or query. */
	final String uri;
	/** Null when ADT offers only the EMF reference. */
	final IAdtObjectReference object;
	final IFile file;
	final IProject project;

	private AdtEditor(String name, String type, String uri, IAdtObjectReference object, IFile file, IProject project) {
		this.name = name;
		this.type = type;
		this.uri = uri;
		this.object = object;
		this.file = file;
		this.project = project;
	}

	/** Null when the editor does not show an ADT object. */
	static AdtEditor of(IEditorPart editor) {
		if (editor == null || editor.getEditorInput() == null) {
			return null;
		}
		IEditorInput input = editor.getEditorInput();
		IFile file = Adapters.adapt(input, IFile.class);
		Object[] sources = file == null ? new Object[] { input, editor } : new Object[] { input, file, editor };

		IAdtObjectReference core = null;
		com.sap.adt.tools.core.model.adtcore.IAdtObjectReference model = null;
		for (Object source : sources) {
			if (core == null) core = Adapters.adapt(source, IAdtObjectReference.class);
			if (model == null) model = Adapters.adapt(source, com.sap.adt.tools.core.model.adtcore.IAdtObjectReference.class);
		}

		String name = null, type = null, uri = null;
		if (core != null && core.getUri() != null) {
			name = core.getName();
			type = core.getType();
			uri = core.getUri().getPath();
		} else if (model != null && model.getUri() != null) {
			name = model.getName();
			type = model.getType();
			uri = java.net.URI.create(model.getUri()).getPath();
		}
		if (uri == null || !uri.startsWith("/sap/bc/adt/")) {
			return null;
		}
		return new AdtEditor(name, type, uri, core, file, projectOf(input, file));
	}

	/**
	 * The object's ADT type, read from its URI when the type it was given is not one VERTEX knows. ADT 3.60 labels
	 * the Global Class tab of a class editor otherwise than CLAS/OC; its URI still says what the object is.
	 */
	String kind() {
		// ADT 3.60 opens a class's Global Class tab as the class's main include, CLAS/I: that is the class itself.
		if (classOfMain() != null) {
			return "CLAS/OC";
		}
		if (type != null && java.util.Set.of("PROG/P", "PROG/I", "CLAS/OC", "CLAS/I", "INTF/OI", "FUGR/FF", "FUGR/I").contains(type)) {
			return type;
		}
		String path = uri.endsWith("/source/main") ? uri.substring(0, uri.length() - "/source/main".length()) : uri;
		if (path.matches("/sap/bc/adt/oo/classes/[^/]+")) return "CLAS/OC";
		if (path.matches("/sap/bc/adt/oo/classes/[^/]+/includes/[^/]+")) return "CLAS/I";
		if (path.matches("/sap/bc/adt/oo/interfaces/[^/]+")) return "INTF/OI";
		if (path.matches("/sap/bc/adt/programs/programs/[^/]+")) return "PROG/P";
		if (path.matches("/sap/bc/adt/programs/includes/[^/]+")) return "PROG/I";
		if (path.matches("/sap/bc/adt/functions/groups/[^/]+/fmodules/[^/]+")) return "FUGR/FF";
		return type;
	}

	/** The object the analysis loads: the class itself for any of its parts, which ADT may name after the part. */
	String ownerName() {
		java.util.regex.Matcher m = java.util.regex.Pattern.compile("/sap/bc/adt/oo/classes/([^/]+)(/.*)?").matcher(uri);
		return m.matches() ? java.net.URLDecoder.decode(m.group(1), java.nio.charset.StandardCharsets.UTF_8).toUpperCase() : name;
	}

	/** The class's own URI when this editor shows its main include (/oo/classes/NAME/includes/main), else null. */
	String classOfMain() {
		String path = uri.endsWith("/source/main") ? uri.substring(0, uri.length() - "/source/main".length()) : uri;
		return path.matches("/sap/bc/adt/oo/classes/[^/]+/includes/main") ? path.substring(0, path.length() - "/includes/main".length()) : null;
	}

	private static IProject projectOf(IEditorInput input, IFile file) {
		if (file != null) {
			return file.getProject();
		}
		IProjectProvider provider = Adapters.adapt(input, IProjectProvider.class);
		if (provider != null) {
			return provider.getProject();
		}
		IResource resource = Adapters.adapt(input, IResource.class);
		return resource == null ? null : resource.getProject();
	}
}
