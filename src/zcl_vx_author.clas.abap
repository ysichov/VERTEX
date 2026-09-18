"! Resolves SAP username to display name, with caching
CLASS zcl_vx_author DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    "! Returns the user's full name, or the username if the user no longer exists
    METHODS get_name
      IMPORTING
        !uname        TYPE syuname
      RETURNING
        VALUE(result) TYPE string.

  PROTECTED SECTION.
  PRIVATE SECTION.

    TYPES:
      BEGIN OF ty_s_author,
        uname TYPE syuname,
        name  TYPE string,
      END OF ty_s_author,
      ty_t_author TYPE SORTED TABLE OF ty_s_author WITH UNIQUE KEY uname.

    CLASS-DATA authors TYPE ty_t_author.

ENDCLASS.


CLASS zcl_vx_author IMPLEMENTATION.

  METHOD get_name.
    DATA author LIKE LINE OF authors.

    READ TABLE authors INTO author WITH KEY uname = uname.
    IF sy-subrc <> 0.
      author-uname = uname.
      SELECT name_textc INTO author-name
        UP TO 1 ROWS
        FROM user_addr
        WHERE bname = uname
        ORDER BY name_textc.
        EXIT.
      ENDSELECT.

      " If user_addr returned nothing or just the login back - read from ADRP
      IF sy-subrc <> 0 OR author-name = uname OR author-name IS INITIAL.
        DATA lv_persnumber TYPE usr21-persnumber.
        SELECT SINGLE persnumber FROM usr21
          WHERE bname = @uname
          INTO @lv_persnumber.
        IF sy-subrc = 0 AND lv_persnumber IS NOT INITIAL.
          DATA lv_first TYPE adrp-name_first.
          DATA lv_last  TYPE adrp-name_last.
          SELECT SINGLE name_first, name_last FROM adrp
            WHERE persnumber = @lv_persnumber
            INTO (@lv_first, @lv_last).
          IF sy-subrc = 0 AND ( lv_first IS NOT INITIAL OR lv_last IS NOT INITIAL ).
            author-name = condense( |{ lv_first } { lv_last }| ).
          ENDIF.
        ENDIF.
      ENDIF.

      IF author-name IS INITIAL.
        author-name = uname.
      ENDIF.
      INSERT author INTO TABLE authors.
    ENDIF.
    result = author-name.
  ENDMETHOD.

ENDCLASS.
