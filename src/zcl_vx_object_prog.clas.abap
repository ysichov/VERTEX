"! Object handler for a single program or include (one REPS part)
CLASS zcl_vx_object_prog DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    METHODS constructor
      IMPORTING
        !name TYPE sobj_name.

  PRIVATE SECTION.
    DATA name TYPE sobj_name.

ENDCLASS.


CLASS zcl_vx_object_prog IMPLEMENTATION.

  METHOD constructor.
    me->name = name.
  ENDMETHOD.

  METHOD zif_vx_object~check_exists.
    SELECT SINGLE @abap_true INTO @result
      FROM trdir
      WHERE name = @name.
  ENDMETHOD.

  METHOD zif_vx_object~get_name.
    result = name.
  ENDMETHOD.

  METHOD zif_vx_object~get_parts.
    result = VALUE #( (
      unit        = CONV #( name )
      object_name = CONV #( name )
      type        = 'REPS' ) ).
  ENDMETHOD.

ENDCLASS.
