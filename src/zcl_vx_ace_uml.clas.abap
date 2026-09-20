CLASS zcl_vx_ace_uml DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_method,
             name TYPE string,
             visibility TYPE string,
             is_static TYPE abap_bool,
             signature TYPE string,
           END OF ty_method,
           tt_methods TYPE STANDARD TABLE OF ty_method WITH EMPTY KEY,
           BEGIN OF ty_node,
             name TYPE string,
             kind TYPE string,
             methods TYPE tt_methods,
           END OF ty_node,
           tt_nodes TYPE STANDARD TABLE OF ty_node WITH EMPTY KEY,
           BEGIN OF ty_edge,
             source TYPE string,
             target TYPE string,
             kind TYPE string,
           END OF ty_edge,
           tt_edges TYPE STANDARD TABLE OF ty_edge WITH EMPTY KEY,
           BEGIN OF ty_graph,
             object TYPE string,
             nodes TYPE tt_nodes,
             edges TYPE tt_edges,
           END OF ty_graph.
    CLASS-METHODS collect
      IMPORTING i_name TYPE string
      CHANGING cs_graph TYPE ty_graph
      RAISING cx_adt_res_not_found cx_adt_res_bad_request.
ENDCLASS.
CLASS zcl_vx_ace_uml IMPLEMENTATION.
  METHOD collect.
    DATA(lv_name) = to_upper( i_name ).
    DATA lv_type TYPE string.
    DATA lv_program TYPE program.
    zcl_vx_ace_source=>resolve( EXPORTING i_name = lv_name i_type = 'CLAS'
      IMPORTING ev_type = lv_type ev_program = lv_program ).
    DATA(ls_source) = zcl_vx_ace_source=>parse( lv_program ).
    DATA(ls_node) = VALUE ty_node( name = lv_name kind = 'class' ).
    LOOP AT ls_source-tt_class_defs INTO DATA(ls_def) WHERE class = lv_name.
      IF ls_def-is_intf = abap_true. ls_node-kind = 'interface'. ENDIF.
      IF ls_def-super IS NOT INITIAL.
        APPEND VALUE #( source = lv_name target = ls_def-super kind = 'inheritance' ) TO cs_graph-edges.
      ENDIF.
    ENDLOOP.
    " Reuse ACE's declaration index: it includes parameterless methods.
    LOOP AT ls_source-tt_calls_line INTO DATA(ls_method)
        WHERE class = lv_name AND eventtype = 'METHOD'.
      DATA(ls_member) = VALUE ty_method( name = ls_method-eventname
        visibility = SWITCH #( ls_method-meth_type WHEN 1 THEN 'public'
          WHEN 2 THEN 'protected' WHEN 3 THEN 'private' ELSE 'unknown' ) ).
      IF ls_node-kind = 'interface'. ls_member-visibility = 'public'. ENDIF.
      READ TABLE ls_source-tt_progs INTO DATA(ls_prog) WITH KEY include = ls_method-def_include.
      IF sy-subrc = 0 AND ls_prog-scan IS BOUND.
        READ TABLE ls_prog-scan->statements INDEX ls_method-def_ind INTO DATA(ls_stmt).
        IF sy-subrc = 0.
          LOOP AT ls_prog-scan->tokens INTO DATA(ls_token) FROM ls_stmt-from TO ls_stmt-to.
            IF ls_token-str = 'CLASS-METHODS'. ls_member-is_static = abap_true. ENDIF.
            ls_member-signature = |{ ls_member-signature } { ls_token-str }|.
          ENDLOOP.
          ls_member-signature = condense( ls_member-signature ).
        ENDIF.
      ENDIF.
      APPEND ls_member TO ls_node-methods.
    ENDLOOP.
    " Read declarations only. CU/CO/CI are the global visibility includes.
    LOOP AT ls_source-tt_progs INTO ls_prog.
      CHECK ls_prog-scan IS BOUND.
      DATA lv_context TYPE string.
      CLEAR lv_context.
      DATA(lv_include) = CONV string( ls_prog-include ).
      IF lv_include CP '*CU' OR lv_include CP '*CO' OR lv_include CP '*CI'.
        lv_context = lv_name.
      ENDIF.
      LOOP AT ls_prog-scan->statements INTO ls_stmt.
        READ TABLE ls_prog-scan->tokens INDEX ls_stmt-from INTO DATA(ls_first).
        CHECK sy-subrc = 0.
        READ TABLE ls_prog-scan->tokens INDEX ls_stmt-from + 1 INTO DATA(ls_second).
        IF ls_first-str = 'CLASS' OR ls_first-str = 'INTERFACE'.
          lv_context = ls_second-str.
        ELSEIF ls_first-str = 'ENDCLASS' OR ls_first-str = 'ENDINTERFACE' OR ls_first-str = 'METHOD'.
          CLEAR lv_context.
        ENDIF.
        CHECK lv_context = lv_name.
        IF ls_first-str = 'INTERFACES'.
          APPEND VALUE #( source = lv_name target = ls_second-str kind = 'implementation' ) TO cs_graph-edges.
        ENDIF.
        CHECK ls_first-str = 'DATA' OR ls_first-str = 'CLASS-DATA'
           OR ls_first-str = 'METHODS' OR ls_first-str = 'CLASS-METHODS'.
        DATA lv_prev TYPE string.
        DATA lv_ref TYPE abap_bool.
        CLEAR: lv_prev, lv_ref.
        LOOP AT ls_prog-scan->tokens INTO ls_token FROM ls_stmt-from TO ls_stmt-to.
          IF lv_ref = abap_true AND ls_token-str <> 'TO'.
            SELECT SINGLE clsname FROM seoclass WHERE clsname = @ls_token-str INTO @DATA(lv_target).
            IF sy-subrc = 0 AND lv_target <> lv_name.
              APPEND VALUE #( source = lv_name target = lv_target kind = 'dependency' ) TO cs_graph-edges.
            ENDIF.
            lv_ref = abap_false.
          ENDIF.
          IF lv_prev = 'REF' AND ls_token-str = 'TO'. lv_ref = abap_true. ENDIF.
          lv_prev = ls_token-str.
        ENDLOOP.
      ENDLOOP.
    ENDLOOP.
    SORT ls_node-methods BY name.
    DELETE ADJACENT DUPLICATES FROM ls_node-methods COMPARING name.
    APPEND ls_node TO cs_graph-nodes.
    SORT cs_graph-edges BY source target kind.
    DELETE ADJACENT DUPLICATES FROM cs_graph-edges COMPARING source target kind.
  ENDMETHOD.
ENDCLASS.
