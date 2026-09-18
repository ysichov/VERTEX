CLASS zcl_vx_appl DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.

    " One line of the selection panel. ZCL_VX_TOOLS carries these for its own
    " filter cache and reads two fields of them, FIELD_LABEL and RANGE; the rest
    " are here because the panel that fills them in SDE writes the whole row.
    "
    " SDE's own copy has two more fields, TRANSMITTER and RECEIVER, which are the
    " drag-and-drop wiring of the grid. They are not dropped for tidiness:
    " ZCL_SDE_RECEIVER holds a reference to ZCL_SDE_TABLE_VIEWER and one to
    " ZCL_SDE_SEL_OPT, so keeping the two fields would pull the whole SAP GUI of
    " the tool back in behind a type nobody here reads - 2787 lines to carry two
    " references that are always initial without a window.
    TYPES:
      BEGIN OF selection_display_s,
        ind         TYPE i,
        field_label TYPE lvc_fname,
        int_type(1),
        inherited   TYPE aqadh_type_of_icon,
        emitter     TYPE aqadh_type_of_icon,
        sign        TYPE tvarv_sign,
        opti        TYPE tvarv_opti,
        option_icon TYPE aqadh_type_of_icon,
        low         TYPE string,
        high        TYPE string,
        more_icon   TYPE aqadh_type_of_icon,
        range       TYPE aqadh_t_ranges,
        name        TYPE reptext,
        element     TYPE text60,
        domain      TYPE text60,
        datatype    TYPE string,
        length      TYPE i,
        color       TYPE lvc_t_scol,
        style       TYPE lvc_t_styl,
        drop_down   TYPE int4,
      END OF selection_display_s,

      BEGIN OF t_lang,
        spras(4),
        sptxt    TYPE sptxt,
      END OF t_lang.

    CLASS-DATA mt_lang TYPE TABLE OF t_lang.

    " In SDE these mirror the report's selection screen, which a caller over HTTP
    " does not have. They keep their names so the moved logic reads unchanged;
    " over HTTP the row count arrives with the request and GV_ROWS stays zero,
    " which every reader already treats as "no global limit set".
    CLASS-DATA: gv_rows TYPE i,
                gv_path TYPE string. "frontend folder for saved join layouts

    CLASS-METHODS init_lang.
ENDCLASS.

CLASS zcl_vx_appl IMPLEMENTATION.
  METHOD init_lang.
    SELECT c~spras t~sptxt INTO CORRESPONDING FIELDS OF TABLE mt_lang
      FROM t002c AS c
      INNER JOIN t002t AS t
      ON c~spras = t~sprsl
      WHERE t~spras = sy-langu
      ORDER BY c~ladatum DESCENDING c~lauzeit DESCENDING.
  ENDMETHOD.
ENDCLASS.
