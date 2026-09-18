"! Object handler for the simple Dictionary types: table/structure (TABD),
"! domain (DOMD) and data element (DTED). All three behave identically —
"! one part named after the object, existence checked in the matching DDIC
"! header table — so a single handler covers them.
"! Source is loaded via SVRS_GET_VERSION_LOCAL.
CLASS zcl_vx_object_ddic DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    "! iv_type is the VRSD part type: TABD, DOMD or DTED.
    METHODS constructor
      IMPORTING
        !name    TYPE versobjnam
        !iv_type TYPE versobjtyp.

  PRIVATE SECTION.
    DATA name TYPE versobjnam.
    DATA type TYPE versobjtyp.

ENDCLASS.


CLASS zcl_vx_object_ddic IMPLEMENTATION.

  METHOD constructor.
    me->name = name.
    me->type = iv_type.
  ENDMETHOD.

  METHOD zif_vx_object~check_exists.
    " The header tables differ in name and key field, so the SELECTs stay
    " static and separate — only the surrounding handler is shared.
    DATA lv_tabname  TYPE dd02l-tabname.
    DATA lv_domname  TYPE dd01l-domname.
    DATA lv_rollname TYPE dd04l-rollname.

    CASE type.
      WHEN 'TABD'.
        lv_tabname = name.
        SELECT SINGLE tabname FROM dd02l
          WHERE tabname  = @lv_tabname
            AND as4local = 'A'
          INTO @DATA(lv_tabd_found).
      WHEN 'DOMD'.
        lv_domname = name.
        SELECT SINGLE domname FROM dd01l
          WHERE domname  = @lv_domname
            AND as4local = 'A'
          INTO @DATA(lv_domd_found).
      WHEN 'DTED'.
        lv_rollname = name.
        SELECT SINGLE rollname FROM dd04l
          WHERE rollname = @lv_rollname
            AND as4local = 'A'
          INTO @DATA(lv_dted_found).
      WHEN OTHERS.
        RETURN.
    ENDCASE.

    result = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD zif_vx_object~get_name.
    result = name.
  ENDMETHOD.

  METHOD zif_vx_object~get_parts.
    result = VALUE #( (
      unit        = CONV #( name )
      object_name = name
      type        = type ) ).
  ENDMETHOD.

ENDCLASS.
