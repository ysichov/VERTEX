CLASS zcl_vx_adt_res_flow DEFINITION
  PUBLIC
  INHERITING FROM cl_adt_rest_resource
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS get REDEFINITION.

  PRIVATE SECTION.
    " What the window gets back: the mermaid text ACE writes, and enough about
    " what was drawn to caption it. The diagram is a string and nothing else -
    " the page owns how it is drawn, the same way it owns the metrics table.
    TYPES: BEGIN OF ty_answer,
             object    TYPE string,
             type      TYPE string,
             program   TYPE string,
             mode      TYPE string,
             include   TYPE string,
             unit      TYPE string,
             unit_type TYPE string,
             line_from TYPE i,
             line_to   TYPE i,
             steps     TYPE i,
             mermaid   TYPE string,
           END OF ty_answer.

    " Lines whose collapsed stretch is open, as the page echoes them back:
    " "12,40,73". They are node numbers of this diagram, so they mean nothing
    " outside the slice they were produced for.
    METHODS expanded
      IMPORTING i_list          TYPE string
      RETURNING VALUE(rt_lines) TYPE zcl_vx_ace_code_html=>tt_lines.

    " The statement map a debugger window steps by: for each include, where
    " every statement starts and ends and what kind it is. "plain" runs on to
    " the next statement; "call" and "flow" may go anywhere; "decl" is not
    " executed at all. The window predicts the next line only from plain to
    " plain and asks SAP for the stack everywhere else.
    " TARGET names the form of a FORM statement and of a plain PERFORM, so a
    " step into the call and back out of it can be predicted too. A PERFORM
    " into another program, on commit or with a dynamic name has none.
    TYPES: BEGIN OF ty_statement,
             line   TYPE i,
             to     TYPE i,
             kw     TYPE string,
             kind   TYPE string,
             target TYPE string,
           END OF ty_statement,
           ty_statements TYPE STANDARD TABLE OF ty_statement WITH EMPTY KEY,
           BEGIN OF ty_include,
             include    TYPE string,
             statements TYPE ty_statements,
           END OF ty_include,
           ty_includes TYPE STANDARD TABLE OF ty_include WITH EMPTY KEY,
           BEGIN OF ty_map,
             program  TYPE string,
             includes TYPE ty_includes,
           END OF ty_map.

    METHODS statements
      IMPORTING i_program    TYPE program
      RETURNING VALUE(rs_map) TYPE ty_map.

    METHODS kind
      IMPORTING io_scan  TYPE REF TO cl_ci_scan
                is_kw    TYPE zif_vx_ace_parse_data=>ts_kword
      RETURNING VALUE(r) TYPE string.
ENDCLASS.


CLASS zcl_vx_adt_res_flow IMPLEMENTATION.

  METHOD get.
    DATA: lv_name    TYPE string,
          lv_type    TYPE string,
          lv_head    TYPE string,
          lv_mode    TYPE string,
          lv_include TYPE string,
          lv_unit    TYPE string,
          lv_expand  TYPE string,
          lv_depth   TYPE string,
          lv_onlyz   TYPE string,
          lv_all     TYPE string,
          lv_params  TYPE string,
          lv_program TYPE program,
          lv_from    TYPE i,
          lv_to      TYPE i,
          lv_title   TYPE string,
          lv_utype   TYPE string,
          ls_answer  TYPE ty_answer.

    request->get_uri_attribute( EXPORTING name      = 'name'
                                          mandatory = abap_true
                                IMPORTING value     = lv_name ).

    request->get_uri_query_parameter( EXPORTING name      = 'type'
                                                mandatory = abap_false
                                                default   = 'PROG'
                                      IMPORTING value     = lv_type ).

    " Which picture. "scheme" is the branch structure of one unit, "calls" is
    " the order the units would run in. They read the same object and share
    " nothing beyond that, which is why the branch below is this wide.
    request->get_uri_query_parameter( EXPORTING name      = 'mode'
                                                mandatory = abap_false
                                                default   = 'scheme'
                                      IMPORTING value     = lv_mode ).
    lv_mode = to_lower( lv_mode ).

    zcl_vx_ace_source=>resolve( EXPORTING i_name     = lv_name
                                           i_type     = lv_type
                                 IMPORTING ev_type    = lv_head
                                           ev_program = lv_program ).

    ls_answer-object  = to_lower( lv_name ).
    ls_answer-type    = to_lower( lv_head ).
    ls_answer-program = to_lower( lv_program ).
    ls_answer-mode    = lv_mode.

    IF lv_mode = 'statements'.
      response->set_body_data(
        content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
        data            = /ui2/cl_json=>serialize( data        = statements( lv_program )
                                                   pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
      RETURN.
    ENDIF.

    IF lv_mode = 'calls'.

      request->get_uri_query_parameter( EXPORTING name      = 'depth'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_depth ).
      request->get_uri_query_parameter( EXPORTING name      = 'onlyz'
                                                  mandatory = abap_false
                                                  default   = 'X'
                                        IMPORTING value     = lv_onlyz ).
      request->get_uri_query_parameter( EXPORTING name      = 'all'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_all ).
      request->get_uri_query_parameter( EXPORTING name      = 'params'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_params ).
      " CALC=X draws the calculated path only, as ACE does in SAP GUI while
      " "Show All Steps" is off; without it, every step of every event.
      DATA lv_calc TYPE string.
      request->get_uri_query_parameter( EXPORTING name      = 'calc'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_calc ).

      " The walk needs somewhere to keep the parse, the step table and the
      " depth. That used to be the viewer object, built headless only so the
      " scanner had a field to write into; now it is the context itself, and
      " nothing in the chain knows what a window is.
      DATA(lo_walk) = NEW zcl_vx_ace_walk( ).

      IF lv_depth IS NOT INITIAL AND lv_depth CO '0123456789'.
        lo_walk->m_hist_depth = lv_depth.
      ENDIF.
      IF lv_onlyz IS INITIAL.
        CLEAR lo_walk->m_zcode.
      ENDIF.

      " What the viewer's PARSE_PROGRAM did, in the order it did it.
      zcl_vx_ace_parser=>parse( EXPORTING i_program = lv_program
                                          i_include = lv_program
                                CHANGING  cs_source = lo_walk->ms_sources ).

      " START names where the walk begins, as a double-click on an event or a
      " form in ACE's tree does: STYPE EVENT or FORM. Without it, the whole
      " program. The name is matched without regard to case, because the
      " window lists units as the metrics showed them.
      DATA lv_start TYPE string.
      DATA lv_stype TYPE string.
      request->get_uri_query_parameter( EXPORTING name      = 'start'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_start ).
      request->get_uri_query_parameter( EXPORTING name      = 'stype'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_stype ).
      lv_stype = to_upper( lv_stype ).

      IF lv_start IS NOT INITIAL AND lv_stype = 'EVENT'.
        DATA(lv_event) = ||.
        LOOP AT lo_walk->ms_sources-t_events INTO DATA(ls_event).
          IF to_upper( condense( ls_event-name ) ) = to_upper( condense( lv_start ) ).
            lv_event = ls_event-name.
            EXIT.
          ENDIF.
        ENDLOOP.
        IF lv_event IS INITIAL.
          RAISE EXCEPTION TYPE cx_adt_res_not_found
            EXPORTING resource_type = `event`
                      resource_id   = lv_start.
        ENDIF.
        zcl_vx_ace_source_parser=>code_execution_scanner(
          i_program = lv_program
          i_include = lv_program
          i_evname  = lv_event
          i_evtype  = 'EVENT'
          io_walk   = lo_walk ).
      ELSEIF lv_start IS NOT INITIAL AND lv_stype = 'FORM'.
        DATA(lv_form) = ||.
        LOOP AT lo_walk->ms_sources-tt_calls_line INTO DATA(ls_form_line) WHERE eventtype = 'FORM'.
          IF to_upper( ls_form_line-eventname ) = to_upper( condense( lv_start ) ).
            lv_form = ls_form_line-eventname.
            EXIT.
          ENDIF.
        ENDLOOP.
        IF lv_form IS INITIAL.
          RAISE EXCEPTION TYPE cx_adt_res_not_found
            EXPORTING resource_type = `form`
                      resource_id   = lv_start.
        ENDIF.
        zcl_vx_ace_source_parser=>parse_call_form(
          i_call_name = lv_form
          i_program   = lv_program
          i_include   = lv_program
          i_stack     = 0
          io_walk     = lo_walk ).
      ELSE.
        zcl_vx_ace_source_parser=>code_execution_scanner(
          i_program = lv_program
          i_include = lv_program
          io_walk   = lo_walk ).
      ENDIF.

      DATA lv_mm TYPE string.
      DATA lt_node_map TYPE zcl_vx_ace_flow=>tt_node_map.
      zcl_vx_ace_flow=>build_steps_flow(
        EXPORTING it_steps      = CONV zcl_vx_ace_flow=>tt_flow_steps( lo_walk->mt_steps )
                  i_all_methods = CONV boolean( lv_all )
                  i_with_params = CONV boolean( lv_params )
                  i_calc_path   = xsdbool( to_upper( lv_calc ) = 'X' )
        IMPORTING et_node_map   = lt_node_map
        CHANGING  cs_parse_data = lo_walk->ms_sources
        RECEIVING rv_mm         = lv_mm ).

      " How many steps the walk found. A class pool has no entry point of its
      " own, so none is a legitimate answer - and the window should say so
      " rather than show an empty frame.
      ls_answer-steps   = lines( lo_walk->mt_steps ).
      ls_answer-mermaid = lv_mm.

    ELSE.

      " The include is what identifies the code: for a class it is the
      " method's own CM include, for a program the include the unit was found
      " in. The metrics row carries it, so the window never works it out.
      request->get_uri_query_parameter( EXPORTING name      = 'include'
                                                  mandatory = abap_true
                                        IMPORTING value     = lv_include ).

      request->get_uri_query_parameter( EXPORTING name      = 'unit'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_unit ).

      request->get_uri_query_parameter( EXPORTING name      = 'expand'
                                                  mandatory = abap_false
                                                  default   = ''
                                        IMPORTING value     = lv_expand ).

      DATA(ls_source) = zcl_vx_ace_source=>parse( lv_program ).

      DATA(lv_inc) = CONV program( to_upper( lv_include ) ).

      " A call is what the picture is about: it gets a node of its own instead
      " of disappearing into an "N operations" block. The parser fills that
      " table one statement at a time, on demand, so the whole include has to
      " be asked for before the scheme is drawn.
      zcl_vx_ace_parser=>parse_calls( EXPORTING i_program = lv_program
                                             i_include = lv_inc
                                   CHANGING  cs_source = ls_source ).

      READ TABLE ls_source-tt_progs WITH KEY include = lv_inc INTO DATA(ls_prog).
      IF sy-subrc <> 0.
        RAISE EXCEPTION TYPE cx_adt_res_not_found
          EXPORTING resource_type = `include`
                    resource_id   = lv_include.
      ENDIF.

      IF lv_unit IS INITIAL.
        " No unit named: the whole include, which is what a program's
        " top-level code amounts to.
        lv_from  = 1.
        lv_to    = lines( ls_prog-source_tab ).
        lv_title = to_upper( lv_include ).
      ELSE.
        " ACE already knows where each unit of an include begins and ends, and
        " under which name the metrics list showed it. Asking it here is what
        " keeps the row that was clicked and the code that is drawn the same.
        DATA(lt_units) = zcl_vx_ace_metrics=>unit_boundaries( is_parse_data = ls_source
                                                           is_prog       = ls_prog ).
        LOOP AT lt_units INTO DATA(ls_unit).
          CHECK to_upper( ls_unit-qname ) = to_upper( lv_unit ).
          lv_from  = ls_unit-line_from.
          lv_to    = ls_unit-line_to.
          lv_title = ls_unit-qname.
          lv_utype = ls_unit-unit_type.
          EXIT.
        ENDLOOP.
        IF lv_from = 0 OR lv_to < lv_from.
          RAISE EXCEPTION TYPE cx_adt_res_not_found
            EXPORTING resource_type = `code unit`
                      resource_id   = lv_unit.
        ENDIF.
      ENDIF.

      " Only the unit's own lines go in. The keyword table and the scan stay
      " whole and are read through the offset, which is how ACE's own source
      " popups look at a stretch of an include.
      DATA lt_slice LIKE ls_prog-source_tab.
      LOOP AT ls_prog-source_tab ASSIGNING FIELD-SYMBOL(<lv_line>)
        FROM lv_from TO lv_to.
        APPEND <lv_line> TO lt_slice.
      ENDLOOP.

      ls_answer-include   = to_lower( lv_include ).
      ls_answer-unit      = lv_title.
      ls_answer-unit_type = to_lower( lv_utype ).
      ls_answer-line_from = lv_from.
      ls_answer-line_to   = lv_to.
      ls_answer-mermaid   = zcl_vx_ace_code_html=>build_scheme(
                              it_source   = lt_slice
                              it_kw       = ls_prog-t_keywords
                              io_scan     = ls_prog-scan
                              i_title     = lv_title
                              it_expanded = expanded( lv_expand )
                              i_offset    = lv_from ).

    ENDIF.

    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = /ui2/cl_json=>serialize( data        = ls_answer
                                                 pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
  ENDMETHOD.


  METHOD expanded.
    CHECK i_list IS NOT INITIAL.
    SPLIT i_list AT ',' INTO TABLE DATA(lt_part).
    LOOP AT lt_part INTO DATA(lv_part).
      CONDENSE lv_part.
      CHECK lv_part IS NOT INITIAL AND lv_part CO '0123456789'.
      APPEND CONV i( lv_part ) TO rt_lines.
    ENDLOOP.
  ENDMETHOD.


  METHOD statements.
    " ACE's parse: every include of the program, each with its keyword table
    " and the scan it came from. Only the level-1 statements of an include
    " are in its own table, so each include is listed with its own lines.
    DATA(ls_source) = zcl_vx_ace_source=>parse( i_program ).
    rs_map-program = to_lower( i_program ).
    LOOP AT ls_source-tt_progs INTO DATA(ls_prog) WHERE scan IS BOUND.
      DATA(ls_include) = VALUE ty_include( include = to_lower( ls_prog-include ) ).
      LOOP AT ls_prog-t_keywords INTO DATA(ls_kw).
        DATA(ls_statement) = VALUE ty_statement( line = ls_kw-line
                                                 to   = ls_kw-line
                                                 kw   = ls_kw-name ).
        READ TABLE ls_prog-scan->tokens INDEX ls_kw-to INTO DATA(ls_last).
        IF sy-subrc = 0.
          ls_statement-to = ls_last-row.
        ENDIF.
        ls_statement-kind = kind( io_scan = ls_prog-scan
                                  is_kw   = ls_kw ).
        IF ls_kw-name = 'FORM' OR ls_kw-name = 'PERFORM'.
          READ TABLE ls_prog-scan->tokens INDEX ls_kw-from + 1 INTO DATA(ls_form).
          IF sy-subrc = 0 AND ls_form-str NA '()'.
            ls_statement-target = ls_form-str.
            IF ls_kw-name = 'PERFORM'.
              LOOP AT ls_prog-scan->tokens INTO DATA(ls_word) FROM ls_kw-from + 2 TO ls_kw-to.
                IF ls_word-str = 'PROGRAM' OR ls_word-str = 'COMMIT' OR ls_word-str = 'ROLLBACK'
                OR ls_word-str = 'TASK' OR ls_word-str = 'SUBROUTINE'.
                  CLEAR ls_statement-target.
                  EXIT.
                ENDIF.
              ENDLOOP.
            ENDIF.
          ENDIF.
        ENDIF.
        APPEND ls_statement TO ls_include-statements.
      ENDLOOP.
      APPEND ls_include TO rs_map-includes.
    ENDLOOP.
  ENDMETHOD.


  METHOD kind.
    " Words padded with blanks, so that a keyword is found whole. A literal
    " holds at most 255 characters, so each list is joined at run time.
    DATA(lv_decl) =
         ` DATA TYPES CONSTANTS STATICS FIELD-SYMBOLS TABLES NODES PARAMETERS PARAMETER SELECT-OPTIONS SELECTION-SCREEN`
      && ` RANGES CONTROLS REPORT PROGRAM FUNCTION-POOL CLASS-POOL INTERFACE-POOL TYPE-POOL TYPE-POOLS INCLUDE DEFINE`
      && ` END-OF-DEFINITION CLASS ENDCLASS INTERFACE ENDINTERFACE METHODS CLASS-METHODS CLASS-DATA EVENTS CLASS-EVENTS`
      && ` ALIASES INTERFACES PUBLIC PROTECTED PRIVATE `.
    DATA(lv_flow) =
         ` IF ELSEIF ELSE ENDIF CASE WHEN ENDCASE DO ENDDO WHILE ENDWHILE LOOP ENDLOOP AT ENDAT ON ENDON CHECK EXIT`
      && ` CONTINUE RETURN TRY CATCH CLEANUP ENDTRY SELECT ENDSELECT PROVIDE ENDPROVIDE FORM ENDFORM METHOD ENDMETHOD`
      && ` FUNCTION ENDFUNCTION MODULE ENDMODULE START-OF-SELECTION END-OF-SELECTION INITIALIZATION LOAD-OF-PROGRAM`
      && ` TOP-OF-PAGE END-OF-PAGE GET STOP REJECT LEAVE WAIT FETCH OPEN CLOSE `.
    DATA(lv_call) =
         ` PERFORM CALL SUBMIT RAISE NEW +CALL_METHOD SET COMMIT ROLLBACK MESSAGE AUTHORITY-CHECK EXPORT IMPORT `.

    DATA(lv_kw) = ` ` && to_upper( is_kw-name ) && ` `.
    IF lv_decl CS lv_kw.
      r = `decl`.
      RETURN.
    ENDIF.
    IF lv_flow CS lv_kw.
      r = `flow`.
      RETURN.
    ENDIF.
    IF lv_call CS lv_kw.
      r = `call`.
      RETURN.
    ENDIF.
    " A functional call or a method call inside the statement: STRLEN( ...,
    " LO_X->RUN( ..., ZCL_Y=>MAKE( ... . An inline DATA( counts too - it is
    " the safe side: the window asks SAP instead of guessing.
    LOOP AT io_scan->tokens INTO DATA(ls_token) FROM is_kw-from TO is_kw-to.
      IF ls_token-str CP '*(' OR ls_token-str CS '->' OR ls_token-str CS '=>'.
        r = `call`.
        RETURN.
      ENDIF.
    ENDLOOP.
    r = `plain`.
  ENDMETHOD.

ENDCLASS.
