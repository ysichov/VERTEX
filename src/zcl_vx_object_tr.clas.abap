"! Object handler for a Transport Request or Task.
"! Reads all objects from the TR and delegates to specific object handlers.
CLASS zcl_vx_object_tr DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    METHODS constructor
      IMPORTING
        !id TYPE trkorr.

    "! Returns the TR parts with CLAS/INTF rows expanded into their reviewable
    "! technical parts (CLSD/RELE skipped) — the same expansion Code Review uses.
    METHODS get_parts_expanded
      RETURNING
        VALUE(result) TYPE zif_vx_object=>ty_t_part
      RAISING
        zcx_vx.

protected section.
  PRIVATE SECTION.

    DATA id TYPE trkorr.

    METHODS get_object_keys
      RETURNING
        VALUE(result) TYPE trwbo_t_e071
      RAISING
        zcx_vx.

    METHODS get_object
      IMPORTING
        object_key    TYPE trwbo_s_e071
      RETURNING
        VALUE(result) TYPE REF TO zif_vx_object.

ENDCLASS.



CLASS ZCL_VX_OBJECT_TR IMPLEMENTATION.


  METHOD constructor.
    me->id = id.
  ENDMETHOD.


  METHOD get_object.
    TRY.
        result = COND #(
          " R3TR CLAS → single row (drill-in via double-click)
          WHEN object_key-pgmid = 'R3TR' AND object_key-object = 'CLAS'
            THEN NEW zcl_vx_object_clas( CONV #( object_key-obj_name ) )
          WHEN object_key-pgmid = 'R3TR' AND object_key-object = 'INTF'
            THEN NEW zcl_vx_object_intf( CONV #( object_key-obj_name ) )
          " R3TR PROG → program
          WHEN object_key-pgmid = 'R3TR' AND object_key-object = 'PROG'
            THEN NEW zcl_vx_object_prog( CONV #( object_key-obj_name ) )
          " R3TR FUGR → function group (main include + sub-includes)
          WHEN object_key-pgmid = 'R3TR' AND object_key-object = 'FUGR'
            THEN NEW zcl_vx_object_fugr( CONV #( object_key-obj_name ) )
          " LIMU FUNC → single function module
          WHEN object_key-pgmid = 'LIMU' AND object_key-object = 'FUNC'
            THEN NEW zcl_vx_object_func( CONV #( object_key-obj_name ) )
          " LIMU REPS → single program/include
          WHEN object_key-pgmid = 'LIMU' AND object_key-object = 'REPS'
            THEN NEW zcl_vx_object_prog( CONV #( object_key-obj_name ) )
          " R3TR TABL / LIMU TABD → dictionary table definition
          WHEN object_key-object = 'TABL' OR object_key-object = 'TABD'
            THEN NEW zcl_vx_object_ddic( name = CONV #( object_key-obj_name ) iv_type = 'TABD' )
          " R3TR DOMA / LIMU DOMA → dictionary domain
          WHEN object_key-object = 'DOMA' OR object_key-object = 'DOMD'
            THEN NEW zcl_vx_object_ddic( name = CONV #( object_key-obj_name ) iv_type = 'DOMD' )
          " R3TR DTEL / LIMU DTED → dictionary data element
          WHEN object_key-object = 'DTEL' OR object_key-object = 'DTED'
            THEN NEW zcl_vx_object_ddic( name = CONV #( object_key-obj_name ) iv_type = 'DTED' ) ).
      CATCH zcx_vx.
        CLEAR result.
    ENDTRY.
  ENDMETHOD.


  METHOD get_parts_expanded.
    DATA(lt_raw) = zif_vx_object~get_parts( ).

    " Collect the set of class names that have explicit METH entries.
    " When a task contains both R3TR CLAS and LIMU METH for the same class,
    " the METH entries are authoritative - expanding CLAS would add all methods
    " including untouched ones.
    DATA lt_meth_classes TYPE SORTED TABLE OF string WITH UNIQUE KEY table_line.
    LOOP AT lt_raw INTO DATA(ls_meth_chk) WHERE type = 'METH'.
      INSERT ls_meth_chk-class INTO TABLE lt_meth_classes.
    ENDLOOP.

    LOOP AT lt_raw INTO DATA(ls_part).
      IF ls_part-type = 'CLAS' OR ls_part-type = 'INTF'.
        " If explicit METH entries already cover this class, skip CLAS expansion —
        " the methods will be added by the METH rows directly.
        IF ls_part-type = 'CLAS'
           AND line_exists( lt_meth_classes[ table_line = CONV string( ls_part-object_name ) ] ).
          CONTINUE.
        ENDIF.
        TRY.
            DATA(lo_obj) = NEW zcl_vx_object_factory( )->get_instance(
              object_type = COND #( WHEN ls_part-type = 'CLAS'
                                    THEN zcl_vx_object_factory=>gc_type-class
                                    ELSE zcl_vx_object_factory=>gc_type-intf )
              object_name = CONV #( ls_part-object_name ) ).
            LOOP AT lo_obj->get_parts( ) INTO DATA(ls_cls_part).
              CASE ls_cls_part-type.
                WHEN 'CLSD' OR 'RELE' OR 'CINC' OR 'CDEF' OR 'REPS'.
                  CONTINUE.   " technical includes — never reviewed here
              ENDCASE.
              APPEND ls_cls_part TO result.
            ENDLOOP.
          CATCH zcx_vx.
            APPEND ls_part TO result.
        ENDTRY.
      ELSEIF ls_part-type = 'FUGR'.
        " Expand function group into its includes (SAPL* + L*) for Code Review
        TRY.
            DATA(lo_fugr) = NEW zcl_vx_object_factory( )->get_instance(
              object_type = zcl_vx_object_factory=>gc_type-fugr
              object_name = CONV #( ls_part-object_name ) ).
            APPEND LINES OF lo_fugr->get_parts( ) TO result.
          CATCH zcx_vx.
            APPEND ls_part TO result.
        ENDTRY.
      ELSE.
        APPEND ls_part TO result.
      ENDIF.
    ENDLOOP.

    SORT result BY type object_name.
    DELETE ADJACENT DUPLICATES FROM result COMPARING type object_name.
  ENDMETHOD.


  METHOD get_object_keys.
    DATA request_data TYPE trwbo_request.
    request_data-h-trkorr = id.

    CALL FUNCTION 'TRINT_READ_REQUEST'
      EXPORTING
        iv_read_objs  = abap_true
      CHANGING
        cs_request    = request_data
      EXCEPTIONS
        error_occured = 1
        OTHERS        = 2.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    result = request_data-objects.

    " A request's own header rarely carries objects directly - they are
    " released through its tasks. Collect the tasks' objects too, the same
    " way get_parts_expanded's Code Review counterpart does.
    SELECT trkorr FROM e070 WHERE strkorr = @id INTO TABLE @DATA(lt_tasks).
    LOOP AT lt_tasks INTO DATA(ls_task).
      CLEAR request_data.
      request_data-h-trkorr = ls_task-trkorr.
      CALL FUNCTION 'TRINT_READ_REQUEST'
        EXPORTING
          iv_read_objs  = abap_true
        CHANGING
          cs_request    = request_data
        EXCEPTIONS
          error_occured = 1
          OTHERS        = 2.
      IF sy-subrc = 0.
        APPEND LINES OF request_data-objects TO result.
      ENDIF.
    ENDLOOP.

    SORT result BY pgmid ASCENDING object ASCENDING obj_name ASCENDING.
    DELETE ADJACENT DUPLICATES FROM result COMPARING pgmid object obj_name.
  ENDMETHOD.


  METHOD zif_vx_object~check_exists.
    TRY.
        NEW zcl_vx_request( me->id ).
        result = abap_true.
      CATCH zcx_vx.
        result = abap_false.
    ENDTRY.
  ENDMETHOD.


  METHOD zif_vx_object~get_name.
    result = id.
  ENDMETHOD.


  METHOD zif_vx_object~get_parts.
    LOOP AT get_object_keys( ) INTO DATA(key).
      IF key-pgmid = 'R3TR' AND ( key-object = 'CLAS' OR key-object = 'INTF' OR key-object = 'FUGR' ).
        " CLAS/INTF is shown as a single row; double-click opens the object-level popup
        APPEND VALUE #(
          unit        = CONV string( key-obj_name )
          object_name = CONV versobjnam( key-obj_name )
          type        = CONV versobjtyp( key-object ) ) TO result.
      ELSEIF key-pgmid = 'LIMU' AND key-object = 'METH'.
        DATA lv_meth_cls  TYPE seoclsname.
        DATA lv_meth_name TYPE seocmpname.
        DATA lv_meth_raw  TYPE string.
        DATA lv_meth_objname TYPE versobjnam.
        DATA lt_meth_objnames TYPE SORTED TABLE OF versobjnam WITH UNIQUE KEY table_line.

        lv_meth_raw = key-obj_name.
        IF strlen( lv_meth_raw ) > 30.
          lv_meth_cls  = lv_meth_raw(30).
          lv_meth_name = lv_meth_raw+30.
        ELSE.
          CONDENSE lv_meth_raw.
          REPLACE ALL OCCURRENCES OF `=>` IN lv_meth_raw WITH ` `.
          REPLACE ALL OCCURRENCES OF `\`  IN lv_meth_raw WITH ` `.
          SPLIT lv_meth_raw AT ` ` INTO DATA(lv_cls_part) DATA(lv_meth_part).
          lv_meth_cls  = lv_cls_part.
          lv_meth_name = lv_meth_part.
        ENDIF.
        CONDENSE lv_meth_cls.
        CONDENSE lv_meth_name.

        IF lv_meth_cls IS NOT INITIAL AND lv_meth_name IS NOT INITIAL.
          lv_meth_objname = |{ lv_meth_cls WIDTH = 30 }{ lv_meth_name }|.
          INSERT lv_meth_objname INTO TABLE lt_meth_objnames.
        ELSEIF lv_meth_cls IS NOT INITIAL.
          DATA lt_meth_korr_range TYPE RANGE OF trkorr.
          DATA lv_meth_like TYPE versobjnam.
          APPEND VALUE #( sign = 'I' option = 'EQ' low = id ) TO lt_meth_korr_range.
          SELECT trkorr FROM e070
            WHERE strkorr = @id
            INTO TABLE @DATA(lt_meth_tasks).
          LOOP AT lt_meth_tasks INTO DATA(lv_meth_task).
            APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_meth_task ) TO lt_meth_korr_range.
          ENDLOOP.

          lv_meth_like = lv_meth_cls.
          lv_meth_like+30 = '%'.
          SELECT objname FROM vrsd
            WHERE objtype = 'METH'
              AND objname LIKE @lv_meth_like
              AND korrnum IN @lt_meth_korr_range
            INTO TABLE @DATA(lt_vrsd_meth_objnames).
          LOOP AT lt_vrsd_meth_objnames INTO lv_meth_objname.
            INSERT lv_meth_objname INTO TABLE lt_meth_objnames.
          ENDLOOP.
        ENDIF.

        LOOP AT lt_meth_objnames INTO lv_meth_objname.
          lv_meth_cls  = lv_meth_objname(30).
          lv_meth_name = lv_meth_objname+30.
          CONDENSE lv_meth_cls.
          CONDENSE lv_meth_name.
          APPEND VALUE #(
            class       = CONV string( lv_meth_cls )
            unit        = CONV string( lv_meth_name )
            object_name = lv_meth_objname
            type        = 'METH' ) TO result.
        ENDLOOP.
        CLEAR: lv_meth_cls, lv_meth_name, lv_meth_raw, lv_meth_objname, lt_meth_objnames.
      ELSE.
        DATA(obj) = get_object( key ).
        IF obj IS BOUND.
          APPEND LINES OF obj->get_parts( ) TO result.
        ELSE.
          " Unknown/unsupported type — show as-is so it's not silently dropped
          APPEND VALUE #(
            unit        = CONV string( key-obj_name )
            object_name = CONV versobjnam( key-obj_name )
            type        = CONV versobjtyp( key-object ) ) TO result.
        ENDIF.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
