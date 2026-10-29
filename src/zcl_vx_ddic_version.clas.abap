"! A version of a dictionary object - data element (DTED), domain (DOMD), table
"! or structure (TABD) - as text lines a line diff can compare. ADT keeps no
"! version history of these on older releases, so the front ends read the
"! version directory (VRSD) themselves and ask here for the text of a version.
"!
"! The active state is read from the active definition (DDIF_*_GET): version
"! management does not fill a never-versioned object's active version. Any
"! other version comes from SVRS_GET_VERSION_LOCAL. Restored from VERTEX's
"! ZCL_VX_VERSION2 (removed in 0.8.8, when the windows moved to ADT).
CLASS zcl_vx_ddic_version DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    "! IV_TYPE: DTED, DOMD or TABD. IV_VERSNO: a VRSD version number, or
    "! 00000 / 99998 / empty for the active state.
    CLASS-METHODS lines
      IMPORTING iv_type         TYPE versobjtyp
                iv_name         TYPE versobjnam
                iv_versno       TYPE versno OPTIONAL
      RETURNING VALUE(rt_lines) TYPE string_table
      RAISING   cx_adt_res_bad_request.

  PRIVATE SECTION.
    TYPES: BEGIN OF ty_field,
             position   TYPE i,
             fieldname  TYPE fieldname,
             keyflag    TYPE keyflag,
             rollname   TYPE rollname,
             checktable TYPE checktable,
             datatype   TYPE datatype_d,
             leng       TYPE ddleng,
             decimals   TYPE decimals,
             notnull    TYPE notnull,
             ddtext     TYPE ddtext,
           END OF ty_field,
           tt_field TYPE STANDARD TABLE OF ty_field WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_value,
             valpos     TYPE valpos,
             domvalue_l TYPE domvalue_l,
             domvalue_h TYPE domvalue_h,
             ddtext     TYPE val_text,
           END OF ty_value,
           tt_value TYPE STANDARD TABLE OF ty_value WITH DEFAULT KEY.

    CLASS-METHODS active_lines
      IMPORTING iv_type         TYPE versobjtyp
                iv_name         TYPE versobjnam
      RETURNING VALUE(rt_lines) TYPE string_table
      RAISING   cx_adt_res_bad_request.

    CLASS-METHODS version_lines
      IMPORTING iv_type         TYPE versobjtyp
                iv_name         TYPE versobjnam
                iv_versno       TYPE versno
      RETURNING VALUE(rt_lines) TYPE string_table
      RAISING   cx_adt_res_bad_request.

    "! The row of a per-language table in the logon language, else the first.
    CLASS-METHODS logon_row
      IMPORTING it_rows       TYPE ANY TABLE
      RETURNING VALUE(rr_row) TYPE REF TO data.

    CLASS-METHODS value_of
      IMPORTING is_row          TYPE any
                iv_name         TYPE string
      RETURNING VALUE(rv_value) TYPE string.

    CLASS-METHODS dtel_lines
      IMPORTING is_dd04v        TYPE any
      RETURNING VALUE(rt_lines) TYPE string_table.

    CLASS-METHODS doma_lines
      IMPORTING is_dd01v        TYPE any
                it_values       TYPE tt_value
      RETURNING VALUE(rt_lines) TYPE string_table.

    CLASS-METHODS tabd_lines
      IMPORTING is_dd02v        TYPE any
                it_fields       TYPE tt_field
      RETURNING VALUE(rt_lines) TYPE string_table.

    CLASS-METHODS fail
      IMPORTING iv_text TYPE string
      RAISING   cx_adt_res_bad_request.
ENDCLASS.



CLASS zcl_vx_ddic_version IMPLEMENTATION.


  METHOD lines.
    IF iv_type <> 'DTED' AND iv_type <> 'DOMD' AND iv_type <> 'TABD'.
      fail( |{ iv_type } is not a dictionary part this resource reads; DTED, DOMD and TABD are.| ).
    ENDIF.
    IF iv_versno IS INITIAL OR iv_versno = '00000' OR iv_versno = '99998'.
      rt_lines = active_lines( iv_type = iv_type iv_name = iv_name ).
    ELSE.
      rt_lines = version_lines( iv_type = iv_type iv_name = iv_name iv_versno = iv_versno ).
    ENDIF.
  ENDMETHOD.


  METHOD active_lines.
    DATA lv_name TYPE ddobjname.
    lv_name = iv_name.
    CASE iv_type.
      WHEN 'DTED'.
        DATA ls_dd04v TYPE dd04v.
        CALL FUNCTION 'DDIF_DTEL_GET'
          EXPORTING
            name          = lv_name
            state         = 'A'
            langu         = sy-langu
          IMPORTING
            dd04v_wa      = ls_dd04v
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_dd04v-rollname IS INITIAL.
          fail( |Data element { iv_name } has no active version.| ).
        ENDIF.
        rt_lines = dtel_lines( ls_dd04v ).

      WHEN 'DOMD'.
        DATA ls_dd01v TYPE dd01v.
        DATA lt_dd07v TYPE STANDARD TABLE OF dd07v.
        CALL FUNCTION 'DDIF_DOMA_GET'
          EXPORTING
            name          = lv_name
            state         = 'A'
            langu         = sy-langu
          IMPORTING
            dd01v_wa      = ls_dd01v
          TABLES
            dd07v_tab     = lt_dd07v
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_dd01v-domname IS INITIAL.
          fail( |Domain { iv_name } has no active version.| ).
        ENDIF.
        DATA lt_value TYPE tt_value.
        LOOP AT lt_dd07v INTO DATA(ls_dd07v) WHERE ddlanguage = sy-langu OR ddlanguage IS INITIAL.
          CHECK ls_dd07v-domvalue_l IS NOT INITIAL OR ls_dd07v-ddtext IS NOT INITIAL.
          APPEND VALUE #( valpos = ls_dd07v-valpos domvalue_l = ls_dd07v-domvalue_l
                          domvalue_h = ls_dd07v-domvalue_h ddtext = ls_dd07v-ddtext ) TO lt_value.
        ENDLOOP.
        rt_lines = doma_lines( is_dd01v = ls_dd01v it_values = lt_value ).

      WHEN 'TABD'.
        DATA ls_dd02v TYPE dd02v.
        DATA lt_dd03p TYPE STANDARD TABLE OF dd03p.
        CALL FUNCTION 'DDIF_TABL_GET'
          EXPORTING
            name          = lv_name
            state         = 'A'
            langu         = sy-langu
          IMPORTING
            dd02v_wa      = ls_dd02v
          TABLES
            dd03p_tab     = lt_dd03p
          EXCEPTIONS
            illegal_input = 1
            OTHERS        = 2.
        IF sy-subrc <> 0 OR ls_dd02v-tabname IS INITIAL.
          fail( |Table { iv_name } has no active version.| ).
        ENDIF.
        DATA lt_field TYPE tt_field.
        LOOP AT lt_dd03p INTO DATA(ls_dd03p).
          " '.INCLUDE' / '.APPEND' mark where an include starts; its fields follow one by one.
          CHECK ls_dd03p-fieldname IS NOT INITIAL AND ls_dd03p-fieldname(1) <> '.'.
          CHECK NOT line_exists( lt_field[ fieldname = ls_dd03p-fieldname ] ).
          APPEND VALUE #( position = ls_dd03p-position fieldname = ls_dd03p-fieldname keyflag = ls_dd03p-keyflag
                          rollname = ls_dd03p-rollname checktable = ls_dd03p-checktable datatype = ls_dd03p-datatype
                          leng = ls_dd03p-leng decimals = ls_dd03p-decimals notnull = ls_dd03p-notnull
                          ddtext = ls_dd03p-ddtext ) TO lt_field.
        ENDLOOP.
        rt_lines = tabd_lines( is_dd02v = ls_dd02v it_fields = lt_field ).
    ENDCASE.
  ENDMETHOD.


  METHOD version_lines.
    DATA ls_object TYPE svrs2_versionable_object.
    ls_object-objtype     = iv_type.
    ls_object-objname     = iv_name.
    ls_object-versno      = iv_versno.
    ls_object-header_only = abap_false.
    CALL FUNCTION 'SVRS_INITIALIZE_DATAPOINTER'
      CHANGING
        objtype      = ls_object-objtype
        data_pointer = ls_object-data_pointer.
    CALL FUNCTION 'SVRS_GET_VERSION_LOCAL'
      CHANGING
        object             = ls_object
      EXCEPTIONS
        no_version         = 1
        version_unreadable = 2
        OTHERS             = 3.
    IF sy-subrc <> 0.
      fail( |Version { iv_versno } of { iv_type } { iv_name } cannot be read (SVRS_GET_VERSION_LOCAL: { sy-subrc }).| ).
    ENDIF.

    FIELD-SYMBOLS: <ls_part> TYPE any,
                   <lt_rows> TYPE ANY TABLE,
                   <ls_row>  TYPE any.
    ASSIGN COMPONENT iv_type OF STRUCTURE ls_object TO <ls_part>.
    IF sy-subrc <> 0.
      fail( |Version { iv_versno } of { iv_type } { iv_name } holds no { iv_type } part.| ).
    ENDIF.

    CASE iv_type.
      WHEN 'DTED'.
        " Inside a version DD04V is a table, a row per language.
        ASSIGN COMPONENT 'DD04V' OF STRUCTURE <ls_part> TO <lt_rows>.
        IF sy-subrc <> 0.
          fail( |Version { iv_versno } of data element { iv_name } holds no DD04V.| ).
        ENDIF.
        DATA(lr_dd04v) = logon_row( <lt_rows> ).
        IF lr_dd04v IS NOT BOUND.
          fail( |Version { iv_versno } of data element { iv_name } holds no attributes.| ).
        ENDIF.
        ASSIGN lr_dd04v->* TO <ls_row>.
        rt_lines = dtel_lines( <ls_row> ).

      WHEN 'DOMD'.
        ASSIGN COMPONENT 'DD01V' OF STRUCTURE <ls_part> TO <lt_rows>.
        IF sy-subrc <> 0.
          fail( |Version { iv_versno } of domain { iv_name } holds no DD01V.| ).
        ENDIF.
        DATA(lr_dd01v) = logon_row( <lt_rows> ).
        IF lr_dd01v IS NOT BOUND.
          fail( |Version { iv_versno } of domain { iv_name } holds no attributes.| ).
        ENDIF.
        DATA lt_value TYPE tt_value.
        FIELD-SYMBOLS <lt_dd07v> TYPE ANY TABLE.
        ASSIGN COMPONENT 'DD07V' OF STRUCTURE <ls_part> TO <lt_dd07v>.
        IF sy-subrc = 0.
          LOOP AT <lt_dd07v> ASSIGNING <ls_row>.
            DATA(lv_lang) = value_of( is_row = <ls_row> iv_name = `DDLANGUAGE` ).
            CHECK lv_lang IS INITIAL OR lv_lang = sy-langu.
            DATA ls_value TYPE ty_value.
            ls_value-valpos     = value_of( is_row = <ls_row> iv_name = `VALPOS` ).
            ls_value-domvalue_l = value_of( is_row = <ls_row> iv_name = `DOMVALUE_L` ).
            ls_value-domvalue_h = value_of( is_row = <ls_row> iv_name = `DOMVALUE_H` ).
            ls_value-ddtext     = value_of( is_row = <ls_row> iv_name = `DDTEXT` ).
            CHECK ls_value-domvalue_l IS NOT INITIAL OR ls_value-ddtext IS NOT INITIAL.
            CHECK NOT line_exists( lt_value[ domvalue_l = ls_value-domvalue_l domvalue_h = ls_value-domvalue_h ] ).
            APPEND ls_value TO lt_value.
          ENDLOOP.
        ENDIF.
        ASSIGN lr_dd01v->* TO <ls_row>.
        rt_lines = doma_lines( is_dd01v = <ls_row> it_values = lt_value ).

      WHEN 'TABD'.
        FIELD-SYMBOLS <ls_dd02v> TYPE any.
        ASSIGN COMPONENT 'DD02V' OF STRUCTURE <ls_part> TO <ls_dd02v>.
        IF sy-subrc <> 0.
          fail( |Version { iv_versno } of table { iv_name } holds no DD02V.| ).
        ENDIF.
        DATA lt_field TYPE tt_field.
        ASSIGN COMPONENT 'DD03V' OF STRUCTURE <ls_part> TO <lt_rows>.
        IF sy-subrc = 0.
          LOOP AT <lt_rows> ASSIGNING <ls_row>.
            DATA(lv_flang) = value_of( is_row = <ls_row> iv_name = `DDLANGUAGE` ).
            CHECK lv_flang IS INITIAL OR lv_flang = sy-langu.
            DATA ls_field TYPE ty_field.
            ls_field-fieldname = value_of( is_row = <ls_row> iv_name = `FIELDNAME` ).
            CHECK ls_field-fieldname IS NOT INITIAL AND ls_field-fieldname(1) <> '.'.
            CHECK NOT line_exists( lt_field[ fieldname = ls_field-fieldname ] ).
            ls_field-position   = value_of( is_row = <ls_row> iv_name = `POSITION` ).
            ls_field-keyflag    = value_of( is_row = <ls_row> iv_name = `KEYFLAG` ).
            ls_field-rollname   = value_of( is_row = <ls_row> iv_name = `ROLLNAME` ).
            ls_field-checktable = value_of( is_row = <ls_row> iv_name = `CHECKTABLE` ).
            ls_field-datatype   = value_of( is_row = <ls_row> iv_name = `DATATYPE` ).
            ls_field-leng       = value_of( is_row = <ls_row> iv_name = `LENG` ).
            ls_field-decimals   = value_of( is_row = <ls_row> iv_name = `DECIMALS` ).
            ls_field-notnull    = value_of( is_row = <ls_row> iv_name = `NOTNULL` ).
            ls_field-ddtext     = value_of( is_row = <ls_row> iv_name = `DDTEXT` ).
            APPEND ls_field TO lt_field.
          ENDLOOP.
        ENDIF.
        rt_lines = tabd_lines( is_dd02v = <ls_dd02v> it_fields = lt_field ).
    ENDCASE.
  ENDMETHOD.


  METHOD logon_row.
    FIELD-SYMBOLS <ls_row> TYPE any.
    LOOP AT it_rows ASSIGNING <ls_row>.
      DATA(lv_lang) = value_of( is_row = <ls_row> iv_name = `DDLANGUAGE` ).
      IF rr_row IS NOT BOUND.
        GET REFERENCE OF <ls_row> INTO rr_row.
      ENDIF.
      IF lv_lang IS INITIAL OR lv_lang = sy-langu.
        GET REFERENCE OF <ls_row> INTO rr_row.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD value_of.
    FIELD-SYMBOLS <lv_value> TYPE any.
    ASSIGN COMPONENT iv_name OF STRUCTURE is_row TO <lv_value>.
    IF sy-subrc = 0.
      rv_value = |{ <lv_value> }|.
    ENDIF.
  ENDMETHOD.


  METHOD dtel_lines.
    " One attribute a line, named as SE11 names it: a change shows as the one line that changed.
    DATA(lt_names) = VALUE string_table(
      ( `DOMNAME` ) ( `DATATYPE` ) ( `LENG` ) ( `DECIMALS` ) ( `OUTPUTLEN` ) ( `CONVEXIT` ) ( `LOWERCASE` )
      ( `SIGNFLAG` ) ( `SHLPNAME` ) ( `SHLPFIELD` ) ( `MEMORYID` ) ( `DDTEXT` ) ( `REPTEXT` )
      ( `SCRTEXT_S` ) ( `SCRTEXT_M` ) ( `SCRTEXT_L` ) ).
    DATA(lt_labels) = VALUE string_table(
      ( `Domain` ) ( `Data type` ) ( `Length` ) ( `Decimals` ) ( `Output length` ) ( `Conversion exit` ) ( `Lower case` )
      ( `Sign` ) ( `Search help` ) ( `Search help field` ) ( `Parameter ID` ) ( `Short description` ) ( `Heading` )
      ( `Short label` ) ( `Medium label` ) ( `Long label` ) ).
    LOOP AT lt_names INTO DATA(lv_name).
      DATA(lv_label) = lt_labels[ sy-tabix ].
      APPEND |{ lv_label WIDTH = 18 }: { value_of( is_row = is_dd04v iv_name = lv_name ) }| TO rt_lines.
    ENDLOOP.
  ENDMETHOD.


  METHOD doma_lines.
    APPEND |{ `Short description` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `DDTEXT` ) }| TO rt_lines.
    APPEND |{ `Data type` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `DATATYPE` ) }| TO rt_lines.
    APPEND |{ `Length` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `LENG` ) }| TO rt_lines.
    APPEND |{ `Decimals` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `DECIMALS` ) }| TO rt_lines.
    APPEND |{ `Output length` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `OUTPUTLEN` ) }| TO rt_lines.
    APPEND |{ `Conversion exit` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `CONVEXIT` ) }| TO rt_lines.
    APPEND |{ `Lower case` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `LOWERCASE` ) }| TO rt_lines.
    APPEND |{ `Value table` WIDTH = 18 }: { value_of( is_row = is_dd01v iv_name = `ENTITYTAB` ) }| TO rt_lines.
    IF it_values IS NOT INITIAL.
      APPEND `` TO rt_lines.
      APPEND `Fixed values:` TO rt_lines.
      DATA(lt_values) = it_values.
      SORT lt_values BY valpos domvalue_l.
      LOOP AT lt_values INTO DATA(ls_value).
        APPEND |  { ls_value-domvalue_l WIDTH = 10 }{ COND string( WHEN ls_value-domvalue_h IS NOT INITIAL
                                                               THEN | - { ls_value-domvalue_h }| ) }  { ls_value-ddtext }| TO rt_lines.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.


  METHOD tabd_lines.
    APPEND |{ `Short description` WIDTH = 18 }: { value_of( is_row = is_dd02v iv_name = `DDTEXT` ) }| TO rt_lines.
    APPEND |{ `Table category` WIDTH = 18 }: { value_of( is_row = is_dd02v iv_name = `TABCLASS` ) }| TO rt_lines.
    APPEND |{ `Delivery class` WIDTH = 18 }: { value_of( is_row = is_dd02v iv_name = `CONTFLAG` ) }| TO rt_lines.
    APPEND `` TO rt_lines.
    " A field a line, so adding, removing or changing a field is the line of that field.
    DATA(lt_fields) = it_fields.
    SORT lt_fields BY position.
    LOOP AT lt_fields INTO DATA(ls_field).
      APPEND |{ ls_field-fieldname WIDTH = 30 } { COND string( WHEN ls_field-keyflag = abap_true THEN `KEY` ) WIDTH = 3 } |
          && |{ ls_field-rollname WIDTH = 30 } { ls_field-datatype WIDTH = 4 } { CONV i( ls_field-leng ) WIDTH = 6 } |
          && |{ CONV i( ls_field-decimals ) WIDTH = 3 } { COND string( WHEN ls_field-notnull = abap_true THEN `NN` ) WIDTH = 2 } |
          && |{ ls_field-checktable WIDTH = 16 } { ls_field-ddtext }| TO rt_lines.
    ENDLOOP.
  ENDMETHOD.


  METHOD fail.
    RAISE EXCEPTION TYPE cx_adt_res_bad_request
      EXPORTING explanation = iv_text.
  ENDMETHOD.
ENDCLASS.
