"! Object handler for an ABAP interface (one INTF part)
CLASS zcl_vx_object_intf DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    METHODS constructor
      IMPORTING
        !name TYPE seoclsname.

  PRIVATE SECTION.
    DATA name TYPE seoclsname.

ENDCLASS.


CLASS zcl_vx_object_intf IMPLEMENTATION.

  METHOD constructor.
    me->name = name.
  ENDMETHOD.

  METHOD zif_vx_object~check_exists.
    SELECT SINGLE @abap_true INTO @result
      FROM seoclass
      WHERE clsname = @name
        AND clstype = '1'.
  ENDMETHOD.

  METHOD zif_vx_object~get_name.
    result = name.
  ENDMETHOD.

  METHOD zif_vx_object~get_parts.
    " Interface source is stored in a generated include; versions are
    " accessible via SVRS with objtype = 'REPS'.
    DATA lv_incname TYPE program.
    TRY.
        lv_incname = cl_oo_classname_service=>get_intfsec_name( name ).
      CATCH cx_root.
        lv_incname = name.
    ENDTRY.

    result = VALUE #( (
      unit        = CONV #( name )
      object_name = CONV #( lv_incname )
      type        = 'REPS' ) ).
  ENDMETHOD.

ENDCLASS.
