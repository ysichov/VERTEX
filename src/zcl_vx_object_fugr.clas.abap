"! Object handler for a function group.
"! Returns the main SAPL include plus all L-prefixed sub-includes from TRDIR.
CLASS zcl_vx_object_fugr DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    METHODS constructor
      IMPORTING
        !name TYPE rs38l_area
      RAISING
        zcx_vx.

  PRIVATE SECTION.
    DATA name TYPE rs38l_area.

ENDCLASS.


CLASS zcl_vx_object_fugr IMPLEMENTATION.

  METHOD constructor.
    me->name = name.
  ENDMETHOD.

  METHOD zif_vx_object~check_exists.
    " Use a typed CHAR variable, not a string — Open SQL CHAR-column equality
    " against a string host variable fails on trailing-blank handling.
    DATA lv_main TYPE trdir-name.
    lv_main = |SAPL{ name }|.
    SELECT SINGLE @abap_true INTO @result
      FROM trdir
      WHERE name = @lv_main.
  ENDMETHOD.

  METHOD zif_vx_object~get_name.
    result = name.
  ENDMETHOD.

  METHOD zif_vx_object~get_parts.
    DATA lv_main TYPE trdir-name.
    lv_main = |SAPL{ name }|.

    " ── Main include SAPL<FUGR> (global data / LOAD) ────────────────
    APPEND VALUE #(
      unit        = CONV #( lv_main )
      object_name = CONV #( lv_main )
      type        = 'REPS'
    ) TO result.

    " Map each function-module U-include (L<FUGR>U<nn>) to its function name,
    " so it is shown as a FUNC part (with proper FM versioning) instead of REPS.
    TYPES: BEGIN OF ty_fm_map,
             incl     TYPE versobjnam,
             funcname TYPE rs38l_fnam,
           END OF ty_fm_map.
    DATA lt_fm_map TYPE HASHED TABLE OF ty_fm_map WITH UNIQUE KEY incl.
    SELECT funcname, include FROM tfdir
      WHERE pname = @lv_main
      INTO TABLE @DATA(lt_func).
    LOOP AT lt_func INTO DATA(ls_func).
      INSERT VALUE #(
        incl     = |L{ name }U{ ls_func-include }|
        funcname = ls_func-funcname ) INTO TABLE lt_fm_map.
    ENDLOOP.

    " ── Sub-includes L<FUGR>* ───────────────────────────────────────
    " FM includes → FUNC part (function module); everything else → REPS.
    " Only real source includes (SQLX = 'X').
    DATA lv_mask TYPE trdir-name.
    lv_mask = |L{ name }%|.
    SELECT name FROM trdir
      WHERE name LIKE @lv_mask
        AND sqlx = @abap_true
      ORDER BY name
      INTO TABLE @DATA(lt_incl).
    LOOP AT lt_incl INTO DATA(ls_incl).
      READ TABLE lt_fm_map INTO DATA(ls_fm)
        WITH KEY incl = CONV versobjnam( ls_incl-name ).
      IF sy-subrc = 0.
        " Function module — show as FUNC, like a directly selected FM.
        APPEND VALUE #(
          unit        = CONV #( ls_fm-funcname )
          object_name = CONV #( ls_fm-funcname )
          type        = 'FUNC'
        ) TO result.
      ELSE.
        APPEND VALUE #(
          unit        = CONV #( ls_incl-name )
          object_name = CONV #( ls_incl-name )
          type        = 'REPS'
        ) TO result.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
