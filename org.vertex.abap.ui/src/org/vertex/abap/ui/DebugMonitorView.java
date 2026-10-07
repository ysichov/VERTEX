package org.vertex.abap.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.eclipse.core.runtime.jobs.Job;
import org.eclipse.core.runtime.Status;
import org.eclipse.debug.core.DebugPlugin;
import org.eclipse.debug.core.IDebugEventSetListener;
import org.eclipse.debug.core.model.IDebugTarget;
import org.eclipse.debug.core.model.IThread;
import org.eclipse.debug.core.model.IStackFrame;
import org.eclipse.debug.core.model.IVariable;
import org.eclipse.swt.browser.BrowserFunction;
import com.sap.adt.debugger.IAbapStackFrame;
import com.sap.adt.debugger.IAbapThread;

/** Observes the existing ADT session through exported interfaces; no new debug connection. */
public class DebugMonitorView extends VisualFlowAnalysisView {
 public static final String ID="org.vertex.abap.ui.view.debugMonitor";
 private IDebugEventSetListener listener;
 private final AtomicInteger revision=new AtomicInteger();
 private volatile int selected=-1;
 private volatile boolean closed;
 @Override protected String title(String object){return "VERTEX Debug Monitor";}
 @Override protected String initialLiteral(){String initial=super.initialLiteral();return initial.substring(0,initial.length()-1)+",\"debugMonitor\":true}";}
 @Override protected void addFunctions(){
  super.addFunctions();
  new BrowserFunction(browser,"sdeMonitorRefresh"){@Override public Object function(Object[] args){if(args.length>0)selected=((Number)args[0]).intValue();refreshMonitor();return null;}};
 }
 @Override public void createPartControl(org.eclipse.swt.widgets.Composite parent){
  super.createPartControl(parent);listener=events->refreshMonitor();DebugPlugin.getDefault().addDebugEventListener(listener);
  browser.addDisposeListener(event->{closed=true;revision.incrementAndGet();DebugPlugin.getDefault().removeDebugEventListener(listener);});
  browser.getDisplay().timerExec(800,()->{if(!closed)refreshMonitor();});
 }
 private void refreshMonitor(){
  int serial=revision.incrementAndGet();
  Job.create("Read ADT debug session",monitor->{
   String payload;
   try{
    List<IAbapThread> sessions=new ArrayList<>();
    for(IDebugTarget target:DebugPlugin.getDefault().getLaunchManager().getDebugTargets()){
     if(target.isTerminated())continue;
     for(IThread thread:target.getThreads())if(thread instanceof IAbapThread&&!thread.isTerminated())sessions.add((IAbapThread)thread);
    }
    StringBuilder choices=new StringBuilder("[");for(int i=0;i<sessions.size();i++){if(i>0)choices.append(',');choices.append(AssistantBridge.quote(sessions.get(i).getName()));}choices.append(']');
    int index=selected>=0&&selected<sessions.size()?selected:sessions.size()==1?0:-1;
    StringBuilder out=new StringBuilder("{\"sessions\":").append(choices).append(",\"selected\":").append(index);
    if(index<0)out.append(",\"status\":").append(AssistantBridge.quote(sessions.isEmpty()?"No ADT debug session":"Select an ADT debug thread"));
    else{
     IAbapThread thread=sessions.get(index);boolean suspended=thread.isSuspended();out.append(",\"status\":").append(AssistantBridge.quote(suspended?"Stopped":"Running"));
     if(suspended){
      IStackFrame[] frames=thread.getStackFrames();out.append(",\"frames\":[");
      for(int i=0;i<frames.length;i++){
       if(i>0)out.append(',');IStackFrame frame=frames[i];out.append("{\"name\":").append(AssistantBridge.quote(frame.getName())).append(",\"line\":").append(frame.getLineNumber());
       if(frame instanceof IAbapStackFrame){IAbapStackFrame abap=(IAbapStackFrame)frame;out.append(",\"uri\":").append(AssistantBridge.quote(String.valueOf(abap.getUri()))).append(",\"program\":").append(AssistantBridge.quote(abap.getProgramName())).append(",\"absoluteLine\":").append(abap.getAbsoluteLineNumber());}
       out.append('}');
      }out.append("],\"variables\":[");
      if(frames.length>0){IVariable[] variables=frames[0].getVariables();for(int i=0;i<Math.min(variables.length,100);i++){if(i>0)out.append(',');IVariable variable=variables[i];String value;try{value=variable.getValue().getValueString();}catch(Exception e){value="Unavailable: "+e.getMessage();}if(value!=null&&value.length()>2000)value=value.substring(0,2000)+"…";out.append("{\"name\":").append(AssistantBridge.quote(variable.getName())).append(",\"value\":").append(AssistantBridge.quote(value==null?"":value)).append('}');}}
      out.append(']');
     }
    }payload=out.append('}').toString();
   }catch(Exception e){payload="{\"status\":"+AssistantBridge.quote("Cannot read ADT session: "+e.getMessage())+"}";}
   final String value=payload;if(!closed&&revision.get()==serial)browser.getDisplay().asyncExec(()->{if(!closed&&!browser.isDisposed()&&revision.get()==serial)browser.execute("if(typeof sdeMonitorState==='function')sdeMonitorState("+value+");");});
   return Status.OK_STATUS;
  }).schedule();
 }
}
