package org.vertex.abap.ui;

/** Static Calls and Logic analysis; it does not create or control a debug session. */
public class VisualFlowAnalysisView extends ToolsView {
    public static final String ID="org.vertex.abap.ui.view.visualFlowAnalysis";
    @Override protected String title(String object){return "Visual Flow Analysis";}
    @Override protected String initialLiteral(){
        String initial=super.initialLiteral();
        return initial.equals("null")?"{\"action\":\"flow\",\"visualFlow\":true}":initial.substring(0,initial.length()-1)+",\"action\":\"flow\",\"visualFlow\":true}";
    }
}
