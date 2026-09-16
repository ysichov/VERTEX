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
