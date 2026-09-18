"! Object handler for a CDS View (DDLS).
"! Returns one part of type DDLS; source is loaded via cl_svrs_tlogo_controller.
CLASS zcl_vx_object_ddls DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    METHODS constructor
      IMPORTING
        !name TYPE versobjnam.

  PRIVATE SECTION.
    DATA name TYPE versobjnam.

ENDCLASS.


CLASS zcl_vx_object_ddls IMPLEMENTATION.

  METHOD constructor.
    me->name = name.
  ENDMETHOD.

  METHOD zif_vx_object~check_exists.
    DATA lv_name TYPE tadir-obj_name.
    lv_name = name.
    SELECT SINGLE pgmid FROM tadir
      WHERE pgmid    = 'R3TR'
        AND object   = 'DDLS'
        AND obj_name = @lv_name
        AND delflag  = ' '
      INTO @DATA(lv_pgmid).
    result = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD zif_vx_object~get_name.
    result = name.
  ENDMETHOD.

  METHOD zif_vx_object~get_parts.
    result = VALUE #( (
      unit        = CONV #( name )
      object_name = name
      type        = 'DDLS' ) ).
  ENDMETHOD.

ENDCLASS.
