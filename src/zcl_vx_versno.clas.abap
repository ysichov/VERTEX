"! Converts between internal (DB) and external version numbers.
"! In the DB the latest version is stored as 0, but externally we use 99998
"! so that versions sort correctly (latest = highest).
CLASS zcl_vx_versno DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.

    CLASS-METHODS to_internal
      IMPORTING
                versno        TYPE versno
      RETURNING VALUE(result) TYPE versno.

    CLASS-METHODS to_external
      IMPORTING
                versno        TYPE versno
      RETURNING VALUE(result) TYPE versno.

ENDCLASS.


CLASS zcl_vx_versno IMPLEMENTATION.

  METHOD to_internal.
    " 99998 = active/latest externally → 0 in DB
    result = COND #(
      WHEN versno = 99998 THEN 0
      ELSE versno ).
  ENDMETHOD.

  METHOD to_external.
    " 0 in DB → 99998 externally (sorts after real versions)
    result = COND #(
      WHEN versno = 0 THEN 99998
      ELSE versno ).
  ENDMETHOD.

ENDCLASS.
