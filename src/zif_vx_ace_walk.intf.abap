"! <p class="shorttext synchronized">Code-flow walk context</p>
"! What ZCL_VX_ACE_SOURCE_PARSER reads and writes while it walks a program.
"! The walk used to reach these six fields through the GUI controller of the
"! tool it came from, which is why pure analysis could not run without a
"! window it never draws in. ZCL_VX_ACE_WALK implements this and holds
"! nothing else, so an ADT resource has somewhere to put the walk. ACE's own
"! window implements the same interface, which is how the two stay one walk.
INTERFACE zif_vx_ace_walk PUBLIC.

  " The two values a walk has to start from, as constants: an interface
  " attribute cannot carry VALUE - only a constant can - so every
  " implementation assigns these in its own constructor, which is what
  " ACE's window has always done.
  "! Depth the walk follows a call chain to before it stops.
  CONSTANTS c_hist_depth TYPE i VALUE 19 .
  "! "Only Z" on. Cleared, the walk descends into SAP's own code.
  CONSTANTS c_only_z TYPE x VALUE '01' .

  " The parse the walk reads from and fills as it resolves calls.
  DATA ms_sources TYPE zif_vx_ace_parse_data=>ts_parse_data .
  " "Only Z" - whether the walk stays out of SAP's own code.
  DATA m_zcode TYPE x .
  " How deep the walk follows a call chain before it stops.
  DATA m_hist_depth TYPE i .
  " Calls already descended into, so a cycle ends.
  DATA mt_calls TYPE zif_vx_ace_parse_data=>tt_call .
  " The walk's answer: the units in the order the code would run them.
  DATA mt_steps TYPE zif_vx_ace_parse_data=>tt_step_counter .
  " Number of the step written last.
  DATA m_step TYPE i .

ENDINTERFACE.
