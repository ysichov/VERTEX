CLASS zcl_vx_adt_res_metrics DEFINITION
  PUBLIC
  INHERITING FROM cl_adt_rest_resource
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS get REDEFINITION.

  PRIVATE SECTION.
    " One code unit - a method, FORM, module or function. The token detail
    " ZCL_VX_ACE_METRICS also returns is left out: it is debugging material and
    " larger than everything else together.
    TYPES: BEGIN OF ty_unit,
             include     TYPE string,
             unit_type   TYPE string,
             unit_name   TYPE string,
             visibility  TYPE string,
             cyclomatic  TYPE i,
             loc         TYPE i,
             lloc        TYPE i,
             cloc        TYPE i,
             mi          TYPE p LENGTH 8 DECIMALS 2,
             volume      TYPE p LENGTH 12 DECIMALS 2,
             difficulty  TYPE p LENGTH 8 DECIMALS 2,
             effort      TYPE p LENGTH 15 DECIMALS 2,
             time_t      TYPE p LENGTH 12 DECIMALS 2,
             bugs        TYPE p LENGTH 8 DECIMALS 3,
             n1          TYPE i,
             n2          TYPE i,
             big_n1      TYPE i,
             big_n2      TYPE i,
             vocabulary  TYPE i,
             prog_length TYPE i,
           END OF ty_unit,
           tt_unit TYPE STANDARD TABLE OF ty_unit WITH EMPTY KEY.

    TYPES: BEGIN OF ty_totals,
             units          TYPE i,
             cyclomatic     TYPE i,
             avg_cyclomatic TYPE p LENGTH 8 DECIMALS 2,
             loc            TYPE i,
             lloc           TYPE i,
             cloc           TYPE i,
             volume         TYPE p LENGTH 12 DECIMALS 2,
             effort         TYPE p LENGTH 15 DECIMALS 2,
             time_t         TYPE p LENGTH 12 DECIMALS 2,
             bugs           TYPE p LENGTH 8 DECIMALS 3,
           END OF ty_totals.

    " One row in the package overview.  The detailed units remain available
    " when the reader opens the object itself; a package must stay a concise
    " list of its repository objects, like ACE's package metrics window.
    TYPES: BEGIN OF ty_object,
             object         TYPE string,
             object_type    TYPE string,
             units          TYPE i,
             cyclomatic     TYPE i,
             avg_cyclomatic TYPE p LENGTH 8 DECIMALS 2,
             loc            TYPE i,
             lloc           TYPE i,
             cloc           TYPE i,
             volume         TYPE p LENGTH 12 DECIMALS 2,
             effort         TYPE p LENGTH 15 DECIMALS 2,
             time_t         TYPE p LENGTH 12 DECIMALS 2,
             bugs           TYPE p LENGTH 8 DECIMALS 3,
             unit_rows      TYPE tt_unit,
           END OF ty_object,
           tt_object TYPE STANDARD TABLE OF ty_object WITH EMPTY KEY.

    METHODS package_metrics
      IMPORTING iv_package TYPE string
      EXPORTING et_objects TYPE tt_object
                es_totals  TYPE ty_totals.

ENDCLASS.


CLASS zcl_vx_adt_res_metrics IMPLEMENTATION.

  METHOD get.
    DATA: lv_name    TYPE string,
          lv_type    TYPE string,
          lv_head    TYPE string,
          lv_program TYPE program,
          lt_unit    TYPE tt_unit,
          lt_object  TYPE tt_object.

    request->get_uri_attribute( EXPORTING name      = 'name'
                                          mandatory = abap_true
                                IMPORTING value     = lv_name ).

    request->get_uri_query_parameter( EXPORTING name      = 'type'
                                                mandatory = abap_false
                                                default   = 'PROG'
                                      IMPORTING value     = lv_type ).

    IF to_upper( lv_type ) = 'DEVC'.
      package_metrics( EXPORTING iv_package = lv_name
                       IMPORTING et_objects = lt_object
                                 es_totals  = DATA(ls_package_totals) ).
      DATA(lv_package_body) =
        |\{"object":"{ to_lower( lv_name ) }",| &&
        |"type":"devc","program":"{ to_lower( lv_name ) }",| &&
        |"totals":{ /ui2/cl_json=>serialize(
                      data        = ls_package_totals
                      pretty_name = /ui2/cl_json=>pretty_mode-low_case ) },| &&
        |"objects":{ /ui2/cl_json=>serialize(
                      data        = lt_object
                      pretty_name = /ui2/cl_json=>pretty_mode-low_case ) }\}|.
      response->set_body_data(
        content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
        data            = lv_package_body ).
      RETURN.
    ENDIF.

    zcl_vx_ace_source=>resolve( EXPORTING i_name     = lv_name
                                           i_type     = lv_type
                                 IMPORTING ev_type    = lv_head
                                           ev_program = lv_program ).

    DATA(ls_source) = zcl_vx_ace_source=>parse( lv_program ).

    DATA(ls_result) = zcl_vx_ace_metrics=>calculate( is_parse_data = ls_source
                                                  i_program     = lv_program ).

    LOOP AT ls_result-units ASSIGNING FIELD-SYMBOL(<ls_u>).
      DATA(lv_visibility) = CONV string( `` ).
      IF <ls_u>-unit_type = 'METHOD'.
        DATA(lv_method_name) = CONV string( <ls_u>-unit_name ).
        SPLIT lv_method_name AT '=>' INTO DATA(lv_class_name) lv_method_name.
        READ TABLE ls_source-tt_calls_line ASSIGNING FIELD-SYMBOL(<ls_call_metric>)
          WITH KEY include   = <ls_u>-include
                   class     = lv_class_name
                   eventtype = 'METHOD'
                   eventname = lv_method_name.
        IF sy-subrc = 0.
          lv_visibility = COND #(
            WHEN <ls_call_metric>-is_intf = abap_true OR <ls_call_metric>-meth_type = 1 THEN 'public'
            WHEN <ls_call_metric>-meth_type = 2 THEN 'protected'
            WHEN <ls_call_metric>-meth_type = 3 THEN 'private' ).
        ENDIF.
      ENDIF.
      APPEND VALUE #( include     = to_lower( <ls_u>-include )
                      unit_type   = to_lower( <ls_u>-unit_type )
                      unit_name   = to_lower( <ls_u>-unit_name )
                      visibility  = lv_visibility
                      cyclomatic  = <ls_u>-cyclomatic
                      loc         = <ls_u>-loc
                      lloc        = <ls_u>-lloc
                      cloc        = <ls_u>-cloc
                      mi          = <ls_u>-mi
                      volume      = <ls_u>-volume
                      difficulty  = <ls_u>-difficulty
                      effort      = <ls_u>-effort
                      time_t      = <ls_u>-time_t
                      bugs        = <ls_u>-bugs
                      n1          = <ls_u>-n1
                      n2          = <ls_u>-n2
                      big_n1      = <ls_u>-big_n1
                      big_n2      = <ls_u>-big_n2
                      vocabulary  = <ls_u>-vocabulary
                      prog_length = <ls_u>-prog_length ) TO lt_unit.
    ENDLOOP.

    DATA(ls_totals) = VALUE ty_totals(
        units          = lines( ls_result-units )
        cyclomatic     = ls_result-total_cyclomatic
        avg_cyclomatic = ls_result-avg_cyclomatic
        loc            = ls_result-total_loc
        lloc           = ls_result-total_lloc
        cloc           = ls_result-total_cloc
        volume         = ls_result-total_volume
        effort         = ls_result-total_effort
        time_t         = ls_result-total_time_t
        bugs           = ls_result-total_bugs ).

    DATA(lv_body) =
      |\{"object":"{ to_lower( lv_name ) }",| &&
      |"type":"{ to_lower( lv_head ) }",| &&
      |"program":"{ to_lower( lv_program ) }",| &&
      |"totals":{ /ui2/cl_json=>serialize(
                    data        = ls_totals
                    pretty_name = /ui2/cl_json=>pretty_mode-low_case ) },| &&
      |"units":{ /ui2/cl_json=>serialize(
                    data        = lt_unit
                    pretty_name = /ui2/cl_json=>pretty_mode-low_case ) }\}|.

    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = lv_body ).
  ENDMETHOD.


  METHOD package_metrics.
    DATA lv_package TYPE devclass.
    lv_package = to_upper( iv_package ).
    SELECT SINGLE devclass FROM tdevc WHERE devclass = @lv_package
      INTO @DATA(lv_exists).
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE cx_adt_res_not_found
        EXPORTING resource_type = 'package' resource_id = CONV string( lv_package ).
    ENDIF.

    " These are the repository objects ACE can parse as source.  DDIC and
    " other package entries are deliberately not represented as zero rows.
    SELECT object, obj_name FROM tadir
      WHERE pgmid = 'R3TR' AND devclass = @lv_package AND delflag = @space
        AND ( object = 'CLAS' OR object = 'INTF' OR object = 'PROG' )
      ORDER BY object, obj_name INTO TABLE @DATA(lt_tadir) UP TO 101 ROWS.
    IF lines( lt_tadir ) > 100.
      RAISE EXCEPTION TYPE cx_adt_res_bad_request
        EXPORTING explanation = 'This package contains more than 100 source objects. Select a smaller package.'.
    ENDIF.

    LOOP AT lt_tadir INTO DATA(ls_tadir).
      TRY.
          zcl_vx_ace_source=>resolve(
            EXPORTING i_name     = CONV string( ls_tadir-obj_name )
                      i_type     = CONV string( ls_tadir-object )
            IMPORTING ev_program = DATA(lv_program) ).
          DATA(ls_source) = zcl_vx_ace_source=>parse( lv_program ).
          DATA(ls_result) = zcl_vx_ace_metrics=>calculate(
            is_parse_data = ls_source i_program = lv_program ).
          DATA(ls_object) = VALUE ty_object(
            object         = to_lower( ls_tadir-obj_name )
            object_type    = to_lower( ls_tadir-object )
            units          = lines( ls_result-units )
            cyclomatic     = ls_result-total_cyclomatic
            avg_cyclomatic = ls_result-avg_cyclomatic
            loc            = ls_result-total_loc
            lloc           = ls_result-total_lloc
            cloc           = ls_result-total_cloc
            volume         = ls_result-total_volume
            effort         = ls_result-total_effort
            time_t         = ls_result-total_time_t
            bugs           = ls_result-total_bugs ).
          LOOP AT ls_result-units ASSIGNING FIELD-SYMBOL(<ls_unit>).
            DATA(lv_visibility2) = CONV string( `` ).
            IF <ls_unit>-unit_type = 'METHOD'.
              DATA(lv_method_name2) = CONV string( <ls_unit>-unit_name ).
              SPLIT lv_method_name2 AT '=>' INTO DATA(lv_class_name2) lv_method_name2.
              READ TABLE ls_source-tt_calls_line ASSIGNING FIELD-SYMBOL(<ls_call_package>)
                WITH KEY include   = <ls_unit>-include
                         class     = lv_class_name2
                         eventtype = 'METHOD'
                         eventname = lv_method_name2.
              IF sy-subrc = 0.
                lv_visibility2 = COND #(
                  WHEN <ls_call_package>-is_intf = abap_true OR <ls_call_package>-meth_type = 1 THEN 'public'
                  WHEN <ls_call_package>-meth_type = 2 THEN 'protected'
                  WHEN <ls_call_package>-meth_type = 3 THEN 'private' ).
              ENDIF.
            ENDIF.
            APPEND VALUE ty_unit(
              include     = to_lower( <ls_unit>-include )
              unit_type   = to_lower( <ls_unit>-unit_type )
              unit_name   = to_lower( <ls_unit>-unit_name )
              visibility  = lv_visibility2
              cyclomatic  = <ls_unit>-cyclomatic
              loc         = <ls_unit>-loc
              lloc        = <ls_unit>-lloc
              cloc        = <ls_unit>-cloc
              mi          = <ls_unit>-mi
              volume      = <ls_unit>-volume
              difficulty  = <ls_unit>-difficulty
              effort      = <ls_unit>-effort
              time_t      = <ls_unit>-time_t
              bugs        = <ls_unit>-bugs
              n1          = <ls_unit>-n1
              n2          = <ls_unit>-n2
              big_n1      = <ls_unit>-big_n1
              big_n2      = <ls_unit>-big_n2
              vocabulary  = <ls_unit>-vocabulary
              prog_length = <ls_unit>-prog_length ) TO ls_object-unit_rows.
          ENDLOOP.
          APPEND ls_object TO et_objects.
          ADD ls_object-units      TO es_totals-units.
          ADD ls_object-cyclomatic TO es_totals-cyclomatic.
          ADD ls_object-loc        TO es_totals-loc.
          ADD ls_object-lloc       TO es_totals-lloc.
          ADD ls_object-cloc       TO es_totals-cloc.
          es_totals-volume = es_totals-volume + ls_object-volume.
          es_totals-effort = es_totals-effort + ls_object-effort.
          es_totals-time_t = es_totals-time_t + ls_object-time_t.
          es_totals-bugs   = es_totals-bugs + ls_object-bugs.
        CATCH cx_adt_res_not_found cx_adt_res_bad_request.
          " A stale TADIR entry must not make the whole package unusable.
      ENDTRY.
    ENDLOOP.
    IF es_totals-units > 0.
      es_totals-avg_cyclomatic = CONV f( es_totals-cyclomatic ) / es_totals-units.
    ENDIF.
  ENDMETHOD.


ENDCLASS.
