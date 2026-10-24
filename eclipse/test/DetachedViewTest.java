package org.vertex.abap.ui;

import org.eclipse.e4.ui.model.application.ui.advanced.MAdvancedFactory;
import org.eclipse.e4.ui.model.application.ui.basic.MBasicFactory;

/** Run with Eclipse's bundle pool on the classpath; no workbench or SAP connection is needed. */
public final class DetachedViewTest {
    public static void main(String[] args) {
        var perspective = MAdvancedFactory.INSTANCE.createPerspective();
        perspective.setVisible(false);
        var outer = MBasicFactory.INSTANCE.createPartSashContainer();
        var inner = MBasicFactory.INSTANCE.createPartSashContainer();
        var stack = MBasicFactory.INSTANCE.createPartStack();
        var sibling = MBasicFactory.INSTANCE.createPartStack();
        var placeholder = MAdvancedFactory.INSTANCE.createPlaceholder();
        var part = MBasicFactory.INSTANCE.createPart();
        placeholder.setRef(part);
        perspective.getChildren().add(outer);
        outer.getChildren().add(inner);
        inner.getChildren().add(stack);
        inner.getChildren().add(sibling);
        stack.getChildren().add(placeholder);
        outer.setVisible(false);
        inner.setVisible(false);
        stack.setVisible(true); // The reported case: visible stack, invisible ancestors.
        sibling.setVisible(false);
        placeholder.setToBeRendered(false);
        DetachedView.revealPath(placeholder);
        check(outer.isVisible() && inner.isVisible() && stack.isVisible(), "hidden sashes must be revealed");
        check(placeholder.isToBeRendered(), "the shared placeholder must be rendered");
        check(!sibling.isVisible(), "unrelated stacks must stay hidden");
        check(!perspective.isVisible(), "opening a view must not activate another perspective");
        inner.setVisible(false);
        DetachedView.revealPath(placeholder);
        check(inner.isVisible(), "reopening an existing view must repair its hidden parent again");
        DetachedView.revealPath(null);
        System.out.println("DetachedView: hidden ancestors, shared placeholder, reopen and sibling isolation passed");
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
