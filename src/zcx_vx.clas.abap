"! Exception class of the version and diff core, carried from AVE.
CLASS zcx_vx DEFINITION
  PUBLIC
  INHERITING FROM cx_static_check
  CREATE PUBLIC.

  PUBLIC SECTION.

    METHODS constructor
      IMPORTING
        !textid   LIKE if_t100_message=>t100key OPTIONAL
        !previous LIKE previous OPTIONAL.

    CLASS-METHODS raise_from_syst
      RAISING
        zcx_vx.

ENDCLASS.


CLASS zcx_vx IMPLEMENTATION.

  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    CALL METHOD super->constructor
      EXPORTING
        previous = previous.
  ENDMETHOD.

  METHOD raise_from_syst.
    TRY.
        cx_proxy_t100=>raise_from_sy_msg( ).
      CATCH cx_proxy_t100 INTO DATA(exc_t100).
        RAISE EXCEPTION TYPE zcx_vx
          EXPORTING
            previous = exc_t100.
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
