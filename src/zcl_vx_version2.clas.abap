CLASS zcl_vx_version2 DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    "! Load source for a local version (active, modified, or historical)
    "! @parameter iv_objtype | Object type e.g. REPS, METH, FUNC, CLSD, INTF, DDLS
    "! @parameter iv_objname | Object name (long form, as in VRSD-OBJNAME)
    "! @parameter iv_versno  | Version number (external: 99998=active, 99999=modified, or real versno)
    CLASS-METHODS get_source_local
      IMPORTING
        iv_objtype    TYPE versobjtyp
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
      RETURNING
        VALUE(result) TYPE abaptxt255_tab
      RAISING
        zcx_vx.

    "! Load local source via SVRS2 and fall back to legacy VRSD/SVRS reader.
    CLASS-METHODS get_source_local_compat
      IMPORTING
        iv_objtype    TYPE versobjtyp
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
        iv_korrnum    TYPE verskorrno OPTIONAL
        iv_author     TYPE versuser OPTIONAL
        iv_datum      TYPE versdate OPTIONAL
        iv_zeit       TYPE verstime OPTIONAL
      RETURNING
        VALUE(result) TYPE abaptxt255_tab
      RAISING
        zcx_vx.

    "! Load source from a remote system via TMS
    "! @parameter iv_objtype | Object type
    "! @parameter iv_objname | Object name
    "! @parameter iv_versno  | Version number (99998 = active on remote system)
    "! @parameter iv_system  | TMS system name e.g. 'PRD'
    CLASS-METHODS get_source_remote
      IMPORTING
        iv_objtype    TYPE versobjtyp
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
        iv_system     TYPE tmscsys-sysnam
      RETURNING
        VALUE(result) TYPE abaptxt255_tab
      RAISING
        zcx_vx.

    "! Load a dictionary table version as structured header + field list.
    "! Local read when iv_system is empty, remote TMS read otherwise.
    CLASS-METHODS get_tabd
      IMPORTING
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
        iv_system     TYPE tmscsys-sysnam OPTIONAL
      RETURNING
        VALUE(result) TYPE zif_vx_vers_types=>ty_tabd
      RAISING
        zcx_vx.

    "! Load a dictionary domain version as structured header + fixed-value list.
    "! Local read when iv_system is empty, remote TMS read otherwise.
    CLASS-METHODS get_doma
      IMPORTING
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
        iv_system     TYPE tmscsys-sysnam OPTIONAL
      RETURNING
        VALUE(result) TYPE zif_vx_vers_types=>ty_doma
      RAISING
        zcx_vx.

    "! Load a dictionary data element version as a structured attribute set.
    "! Local read when iv_system is empty, remote TMS read otherwise.
    CLASS-METHODS get_dtel
      IMPORTING
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
        iv_system     TYPE tmscsys-sysnam OPTIONAL
      RETURNING
        VALUE(result) TYPE zif_vx_vers_types=>ty_dtel
      RAISING
        zcx_vx.

  PRIVATE SECTION.

    "! Build a SVRS2_VERSIONABLE_OBJECT ready for LOCAL/REMOTE call
    CLASS-METHODS build_object
      IMPORTING
        iv_objtype    TYPE versobjtyp
        iv_objname    TYPE versobjnam
        iv_versno     TYPE versno
      RETURNING
        VALUE(result) TYPE svrs2_versionable_object.

    "! Extract source lines from the filled SVRS2_VERSIONABLE_OBJECT.
    "! For TLOGO objects (DDLS etc.): deserializes TLOG-CONTENT via cl_svrs_tlogo_db_view.
    "! For ABAP objects: tries ABAPTEXT -> REPS -> XSSRC in the type-named component.
    CLASS-METHODS extract_source
      IMPORTING
        is_object     TYPE svrs2_versionable_object
      RETURNING
        VALUE(result) TYPE abaptxt255_tab.

    "! Deserialize TLOG-CONTENT from a filled versionable object and extract source.
    "! Works for both local and remote — caller just passes the filled object.
    CLASS-METHODS extract_tlog_source
      IMPORTING
        is_object     TYPE svrs2_versionable_object
      RETURNING
        VALUE(result) TYPE abaptxt255_tab.

    "! Render TABD dictionary table definition as diff-friendly text lines.
    CLASS-METHODS extract_tabd_source
      IMPORTING
        is_object     TYPE svrs2_versionable_object
      RETURNING
        VALUE(result) TYPE abaptxt255_tab.

    "! Extract structured TABD header + field list from a filled versionable object.
    CLASS-METHODS extract_tabd_struct
      IMPORTING
        is_object     TYPE svrs2_versionable_object
      RETURNING
        VALUE(result) TYPE zif_vx_vers_types=>ty_tabd.

    "! Extract structured DOMA header + fixed-value list from a filled versionable object.
    CLASS-METHODS extract_doma_struct
      IMPORTING
        is_object     TYPE svrs2_versionable_object
      RETURNING
        VALUE(result) TYPE zif_vx_vers_types=>ty_doma.

    "! Extract structured DTEL attribute set from a filled versionable object.
    CLASS-METHODS extract_dtel_struct
      IMPORTING
        is_object     TYPE svrs2_versionable_object
      RETURNING
        VALUE(result) TYPE zif_vx_vers_types=>ty_dtel.

ENDCLASS.


CLASS zcl_vx_version2 IMPLEMENTATION.

  METHOD get_source_local.
    DATA(lo_obj) = build_object( iv_objtype = iv_objtype
                                 iv_objname = iv_objname
                                 iv_versno  = iv_versno ).

    CALL FUNCTION 'SVRS_GET_VERSION_LOCAL'
      CHANGING
        object             = lo_obj
      EXCEPTIONS
        no_version         = 1
        version_unreadable = 2
        OTHERS             = 3.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    result = extract_source( lo_obj ).
  ENDMETHOD.


  METHOD get_source_local_compat.
    TRY.
        result = get_source_local(
          iv_objtype = iv_objtype
          iv_objname = iv_objname
          iv_versno  = iv_versno ).
        RETURN.
      CATCH zcx_vx.
    ENDTRY.

    DATA lt_vrsd TYPE vrsd_tab.
    DATA(lv_db_versno) = zcl_vx_versno=>to_internal( iv_versno ).
    SELECT * FROM vrsd
      WHERE objtype = @iv_objtype
        AND objname = @iv_objname
        AND versno  = @lv_db_versno
      INTO TABLE @lt_vrsd
      UP TO 1 ROWS.

    IF lt_vrsd IS INITIAL.
      APPEND VALUE vrsd(
        objtype = iv_objtype
        objname = iv_objname
        versno  = lv_db_versno
        korrnum = iv_korrnum
        author  = COND #( WHEN iv_author IS NOT INITIAL THEN iv_author ELSE sy-uname )
        datum   = iv_datum
        zeit    = iv_zeit ) TO lt_vrsd.
    ENDIF.

    result = NEW zcl_vx_version( lt_vrsd[ 1 ] )->get_source( ).
  ENDMETHOD.


  METHOD get_source_remote.
    DATA(lo_obj) = build_object( iv_objtype = iv_objtype
                                 iv_objname = iv_objname
                                 iv_versno  = iv_versno ).

    CALL FUNCTION 'SVRS_GET_VERSION_REMOTE'
      EXPORTING
        p_tarsystem         = iv_system
      CHANGING
        object              = lo_obj
      EXCEPTIONS
        no_version          = 1
        system_error        = 2
        communication_error = 3
        OTHERS              = 4.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    result = extract_source( lo_obj ).
  ENDMETHOD.


  METHOD build_object.
    result-objtype     = iv_objtype.
    result-objname     = iv_objname.
    result-versno      = iv_versno.
    result-header_only = abap_false.

    CALL FUNCTION 'SVRS_INITIALIZE_DATAPOINTER'
      CHANGING
        objtype      = result-objtype
        data_pointer = result-data_pointer.
  ENDMETHOD.


  METHOD extract_source.
    " TLOGO-based objects: TLOG-CONTENT is filled by LOCAL/REMOTE — deserialize it
    IF lines( is_object-tlog-content ) > 0.
      result = extract_tlog_source( is_object ).
      RETURN.
    ENDIF.

    " Dictionary table: render field list as text
    IF is_object-objtype = 'TABD'.
      result = extract_tabd_source( is_object ).
      RETURN.
    ENDIF.

    " Standard ABAP objects: component name = objtype (REPS, FUNC, METH, CLSD ...)
    FIELD-SYMBOLS: <typed>  TYPE any,
                   <source> TYPE abaptxt255_tab.

    ASSIGN COMPONENT is_object-objtype OF STRUCTURE is_object TO <typed>.
    CHECK sy-subrc = 0.

    " Field name for source varies: ABAPTEXT / REPS / XSSRC
    ASSIGN COMPONENT 'ABAPTEXT' OF STRUCTURE <typed> TO <source>.
    IF sy-subrc = 0.
      result = <source>.
      RETURN.
    ENDIF.

    ASSIGN COMPONENT 'REPS' OF STRUCTURE <typed> TO <source>.
    IF sy-subrc = 0.
      result = <source>.
      RETURN.
    ENDIF.

    ASSIGN COMPONENT 'XSSRC' OF STRUCTURE <typed> TO <source>.
    IF sy-subrc = 0.
      result = <source>.
    ENDIF.
  ENDMETHOD.


  METHOD extract_tlog_source.
    FIELD-SYMBOLS: <content> TYPE any,
                   <ddlsrc>  TYPE ANY TABLE,
                   <row>     TYPE any,
                   <field>   TYPE any.
    TRY.
        " Reconstruct db_view from the TLOG already filled by LOCAL/REMOTE
        DATA(lo_db_view) = cl_svrs_tlogo_db_view=>create_from_container(
          it_header  = is_object-tlog-header
          it_content = is_object-tlog-content
          iv_versno  = is_object-versno
          it_mdlog   = is_object-tlog-mdlog
          it_mdsrc   = is_object-smodisrc ).

        " Deserialize RAW -> logical view
        DATA(lo_controller) = cl_svrs_tlogo_controller=>get_instance( ).
        DATA(lo_config)     = lo_controller->get_config_class( is_object-objtype ).
        DATA(lo_log_view)   = lo_config->unpack_object( lo_db_view ).

        CHECK lo_log_view IS BOUND AND lo_log_view->ar_content IS BOUND.
        ASSIGN lo_log_view->ar_content->* TO <content>.
        CHECK sy-subrc = 0.

        " Component in the logical view named after object type (e.g. DDLSOURCE for DDLS)
        DATA(lv_component) = SWITCH #( is_object-objtype
          WHEN 'DDLS' THEN 'DDLSOURCE'
          ELSE              is_object-objtype ).
        ASSIGN COMPONENT lv_component OF STRUCTURE <content> TO <ddlsrc>.
        CHECK sy-subrc = 0.

        LOOP AT <ddlsrc> ASSIGNING <row>.
          ASSIGN COMPONENT 1 OF STRUCTURE <row> TO <field>.
          IF sy-subrc = 0.
            APPEND CONV abaptxt255( CONV string( <field> ) ) TO result.
          ENDIF.
        ENDLOOP.

      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.


  METHOD get_tabd.
    " Active local version: read the active DDIC definition directly. SVRS does
    " not populate the TABD substructure for the active version of a new /
    " never-versioned object, and a table created by the reviewed request has
    " nothing else — the field list came back empty and the review page showed
    " a table header with no rows. Same rule as GET_DOMA / GET_DTEL.
    IF iv_system IS INITIAL
       AND ( iv_versno = zcl_vx_version=>c_version-active OR iv_versno = 0 ).
      DATA ls_dd02v TYPE dd02v.
      DATA lt_dd03p TYPE STANDARD TABLE OF dd03p.
      DATA lv_tname TYPE ddobjname.
      lv_tname = iv_objname.
      CALL FUNCTION 'DDIF_TABL_GET'
        EXPORTING
          name          = lv_tname
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
        RAISE EXCEPTION TYPE zcx_vx.
      ENDIF.
      result-tabname  = ls_dd02v-tabname.
      result-ddtext   = ls_dd02v-ddtext.
      result-tabclass = ls_dd02v-tabclass.
      result-contflag = ls_dd02v-contflag.
      LOOP AT lt_dd03p INTO DATA(ls_dd03p).
        CHECK ls_dd03p-fieldname IS NOT INITIAL.
        " '.INCLUDE' / '.APPEND' mark where an include starts; the fields it
        " brings in are listed individually right after it.
        CHECK ls_dd03p-fieldname(1) <> '.'.
        CHECK NOT line_exists( result-fields[ fieldname = ls_dd03p-fieldname ] ).
        APPEND VALUE #(
          position   = ls_dd03p-position
          fieldname  = ls_dd03p-fieldname
          keyflag    = ls_dd03p-keyflag
          rollname   = ls_dd03p-rollname
          checktable = ls_dd03p-checktable
          datatype   = ls_dd03p-datatype
          leng       = ls_dd03p-leng
          decimals   = ls_dd03p-decimals
          notnull    = ls_dd03p-notnull
          ddtext     = ls_dd03p-ddtext ) TO result-fields.
      ENDLOOP.
      SORT result-fields BY position.
      RETURN.
    ENDIF.

    DATA(lo_obj) = build_object( iv_objtype = 'TABD'
                                 iv_objname = iv_objname
                                 iv_versno  = iv_versno ).

    IF iv_system IS NOT INITIAL.
      CALL FUNCTION 'SVRS_GET_VERSION_REMOTE'
        EXPORTING
          p_tarsystem         = iv_system
        CHANGING
          object              = lo_obj
        EXCEPTIONS
          no_version          = 1
          system_error        = 2
          communication_error = 3
          OTHERS              = 4.
    ELSE.
      CALL FUNCTION 'SVRS_GET_VERSION_LOCAL'
        CHANGING
          object             = lo_obj
        EXCEPTIONS
          no_version         = 1
          version_unreadable = 2
          OTHERS             = 3.
    ENDIF.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    result = extract_tabd_struct( lo_obj ).
  ENDMETHOD.


  METHOD get_doma.
    " Active local version: SVRS does not populate the DDIC substructure for the
    " active version of a (possibly never-versioned) object — read it directly.
    IF iv_system IS INITIAL
       AND ( iv_versno = zcl_vx_version=>c_version-active OR iv_versno = 0 ).
      DATA ls_dd01v   TYPE dd01v.
      DATA lt_dd07v   TYPE STANDARD TABLE OF dd07v.
      DATA lv_dname   TYPE ddobjname.
      lv_dname = iv_objname.
      CALL FUNCTION 'DDIF_DOMA_GET'
        EXPORTING
          name          = lv_dname
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
        RAISE EXCEPTION TYPE zcx_vx.
      ENDIF.
      result-domname   = ls_dd01v-domname.
      result-ddtext    = ls_dd01v-ddtext.
      result-datatype  = ls_dd01v-datatype.
      result-leng      = ls_dd01v-leng.
      result-outputlen = ls_dd01v-outputlen.
      result-decimals  = ls_dd01v-decimals.
      result-convexit  = ls_dd01v-convexit.
      result-entitytab = ls_dd01v-entitytab.
      LOOP AT lt_dd07v INTO DATA(ls_dd07v)
        WHERE ddlanguage = sy-langu OR ddlanguage IS INITIAL.
        CHECK ls_dd07v-domvalue_l IS NOT INITIAL OR ls_dd07v-ddtext IS NOT INITIAL.
        APPEND VALUE #(
          valpos     = ls_dd07v-valpos
          domvalue_l = ls_dd07v-domvalue_l
          domvalue_h = ls_dd07v-domvalue_h
          appval     = ls_dd07v-appval
          ddtext     = ls_dd07v-ddtext ) TO result-values.
      ENDLOOP.
      SORT result-values BY valpos domvalue_l.
      RETURN.
    ENDIF.

    DATA(lo_obj) = build_object( iv_objtype = 'DOMD'
                                 iv_objname = iv_objname
                                 iv_versno  = iv_versno ).

    IF iv_system IS NOT INITIAL.
      CALL FUNCTION 'SVRS_GET_VERSION_REMOTE'
        EXPORTING
          p_tarsystem         = iv_system
        CHANGING
          object              = lo_obj
        EXCEPTIONS
          no_version          = 1
          system_error        = 2
          communication_error = 3
          OTHERS              = 4.
    ELSE.
      CALL FUNCTION 'SVRS_GET_VERSION_LOCAL'
        CHANGING
          object             = lo_obj
        EXCEPTIONS
          no_version         = 1
          version_unreadable = 2
          OTHERS             = 3.
    ENDIF.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    result = extract_doma_struct( lo_obj ).
  ENDMETHOD.


  METHOD get_dtel.
    " Active local version: read the active DDIC definition directly (SVRS does not
    " populate the substructure for the active version of a new/never-versioned object).
    IF iv_system IS INITIAL
       AND ( iv_versno = zcl_vx_version=>c_version-active OR iv_versno = 0 ).
      DATA ls_dd04v TYPE dd04v.
      DATA lv_ename TYPE ddobjname.
      lv_ename = iv_objname.
      CALL FUNCTION 'DDIF_DTEL_GET'
        EXPORTING
          name          = lv_ename
          state         = 'A'
          langu         = sy-langu
        IMPORTING
          dd04v_wa      = ls_dd04v
        EXCEPTIONS
          illegal_input = 1
          OTHERS        = 2.
      IF sy-subrc <> 0 OR ls_dd04v-rollname IS INITIAL.
        RAISE EXCEPTION TYPE zcx_vx.
      ENDIF.
      result-rollname  = ls_dd04v-rollname.
      result-domname   = ls_dd04v-domname.
      result-datatype  = ls_dd04v-datatype.
      result-leng      = ls_dd04v-leng.
      result-decimals  = ls_dd04v-decimals.
      result-outputlen = ls_dd04v-outputlen.
      result-convexit  = ls_dd04v-convexit.
      result-lowercase = ls_dd04v-lowercase.
      result-signflag  = ls_dd04v-signflag.
      result-shlpname  = ls_dd04v-shlpname.
      result-shlpfield = ls_dd04v-shlpfield.
      result-memoryid  = ls_dd04v-memoryid.
      result-ddtext    = ls_dd04v-ddtext.
      result-reptext   = ls_dd04v-reptext.
      result-scrtext_s = ls_dd04v-scrtext_s.
      result-scrtext_m = ls_dd04v-scrtext_m.
      result-scrtext_l = ls_dd04v-scrtext_l.
      RETURN.
    ENDIF.

    DATA(lo_obj) = build_object( iv_objtype = 'DTED'
                                 iv_objname = iv_objname
                                 iv_versno  = iv_versno ).

    IF iv_system IS NOT INITIAL.
      CALL FUNCTION 'SVRS_GET_VERSION_REMOTE'
        EXPORTING
          p_tarsystem         = iv_system
        CHANGING
          object              = lo_obj
        EXCEPTIONS
          no_version          = 1
          system_error        = 2
          communication_error = 3
          OTHERS              = 4.
    ELSE.
      CALL FUNCTION 'SVRS_GET_VERSION_LOCAL'
        CHANGING
          object             = lo_obj
        EXCEPTIONS
          no_version         = 1
          version_unreadable = 2
          OTHERS             = 3.
    ENDIF.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    result = extract_dtel_struct( lo_obj ).
  ENDMETHOD.


  METHOD extract_tabd_struct.
    FIELD-SYMBOLS: <tabd>  TYPE any,
                   <dd02v> TYPE any,
                   <dd03v> TYPE ANY TABLE,
                   <row>   TYPE any,
                   <fld>   TYPE any.

    ASSIGN COMPONENT 'TABD' OF STRUCTURE is_object TO <tabd>.
    CHECK sy-subrc = 0.

    " Header attributes from DD02V
    ASSIGN COMPONENT 'DD02V' OF STRUCTURE <tabd> TO <dd02v>.
    IF sy-subrc = 0.
      ASSIGN COMPONENT 'TABNAME'  OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. result-tabname  = <fld>. ENDIF.
      ASSIGN COMPONENT 'DDTEXT'   OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. result-ddtext   = <fld>. ENDIF.
      ASSIGN COMPONENT 'TABCLASS' OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. result-tabclass = <fld>. ENDIF.
      ASSIGN COMPONENT 'CONTFLAG' OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. result-contflag = <fld>. ENDIF.
    ENDIF.

    " Field list from DD03V — keep one row per field in the logon language
    ASSIGN COMPONENT 'DD03V' OF STRUCTURE <tabd> TO <dd03v>.
    CHECK sy-subrc = 0.
    LOOP AT <dd03v> ASSIGNING <row>.
      " Skip non-logon-language duplicates (text rows repeat per DDLANGUAGE)
      ASSIGN COMPONENT 'DDLANGUAGE' OF STRUCTURE <row> TO <fld>.
      IF sy-subrc = 0 AND <fld> IS NOT INITIAL AND <fld> <> sy-langu.
        CONTINUE.
      ENDIF.

      DATA ls_field TYPE zif_vx_vers_types=>ty_tabd_field.
      CLEAR ls_field.
      ASSIGN COMPONENT 'FIELDNAME'  OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-fieldname  = <fld>. ENDIF.
      " A blank field name means a structural row (.INCLUDE etc.) — skip
      CHECK ls_field-fieldname IS NOT INITIAL.
      " Guard against duplicate field names already collected
      IF line_exists( result-fields[ fieldname = ls_field-fieldname ] ).
        CONTINUE.
      ENDIF.
      ASSIGN COMPONENT 'POSITION'   OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-position   = <fld>. ENDIF.
      ASSIGN COMPONENT 'KEYFLAG'    OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-keyflag    = <fld>. ENDIF.
      ASSIGN COMPONENT 'ROLLNAME'   OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-rollname   = <fld>. ENDIF.
      ASSIGN COMPONENT 'CHECKTABLE' OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-checktable = <fld>. ENDIF.
      ASSIGN COMPONENT 'DATATYPE'   OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-datatype   = <fld>. ENDIF.
      ASSIGN COMPONENT 'LENG'       OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-leng       = <fld>. ENDIF.
      ASSIGN COMPONENT 'DECIMALS'   OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-decimals   = <fld>. ENDIF.
      ASSIGN COMPONENT 'NOTNULL'    OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-notnull    = <fld>. ENDIF.
      ASSIGN COMPONENT 'DDTEXT'     OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_field-ddtext     = <fld>. ENDIF.
      APPEND ls_field TO result-fields.
    ENDLOOP.

    SORT result-fields BY position.
  ENDMETHOD.


  METHOD extract_doma_struct.
    FIELD-SYMBOLS: <doma>    TYPE any,
                   <dd01tab> TYPE ANY TABLE,
                   <dd01v>   TYPE any,
                   <dd07v>   TYPE ANY TABLE,
                   <row>     TYPE any,
                   <fld>     TYPE any.

    ASSIGN COMPONENT 'DOMD' OF STRUCTURE is_object TO <doma>.
    CHECK sy-subrc = 0.

    " Inside the versionable object DD01V is a TABLE (one row per language).
    " Pick the logon-language row, falling back to the first row.
    ASSIGN COMPONENT 'DD01V' OF STRUCTURE <doma> TO <dd01tab>.
    IF sy-subrc = 0.
      LOOP AT <dd01tab> ASSIGNING <row>.
        ASSIGN COMPONENT 'DDLANGUAGE' OF STRUCTURE <row> TO <fld>.
        IF sy-subrc = 0 AND <fld> IS NOT INITIAL AND <fld> <> sy-langu.
          IF <dd01v> IS NOT ASSIGNED.
            ASSIGN <row> TO <dd01v>.
          ENDIF.
          CONTINUE.
        ENDIF.
        ASSIGN <row> TO <dd01v>.
        EXIT.
      ENDLOOP.
    ENDIF.

    " Header attributes from the selected DD01V row
    IF <dd01v> IS ASSIGNED.
      ASSIGN COMPONENT 'DOMNAME'   OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-domname   = <fld>. ENDIF.
      ASSIGN COMPONENT 'DDTEXT'    OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-ddtext    = <fld>. ENDIF.
      ASSIGN COMPONENT 'DATATYPE'  OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-datatype  = <fld>. ENDIF.
      ASSIGN COMPONENT 'LENG'      OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-leng      = <fld>. ENDIF.
      ASSIGN COMPONENT 'OUTPUTLEN' OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-outputlen = <fld>. ENDIF.
      ASSIGN COMPONENT 'DECIMALS'  OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-decimals  = <fld>. ENDIF.
      ASSIGN COMPONENT 'CONVEXIT'  OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-convexit  = <fld>. ENDIF.
      ASSIGN COMPONENT 'ENTITYTAB' OF STRUCTURE <dd01v> TO <fld>. IF sy-subrc = 0. result-entitytab = <fld>. ENDIF.
    ENDIF.

    " Fixed values from DD07V — keep one row per value in the logon language
    ASSIGN COMPONENT 'DD07V' OF STRUCTURE <doma> TO <dd07v>.
    CHECK sy-subrc = 0.
    LOOP AT <dd07v> ASSIGNING <row>.
      " Skip non-logon-language duplicates (text rows repeat per DDLANGUAGE)
      ASSIGN COMPONENT 'DDLANGUAGE' OF STRUCTURE <row> TO <fld>.
      IF sy-subrc = 0 AND <fld> IS NOT INITIAL AND <fld> <> sy-langu.
        CONTINUE.
      ENDIF.

      DATA ls_value TYPE zif_vx_vers_types=>ty_doma_value.
      CLEAR ls_value.
      ASSIGN COMPONENT 'DOMVALUE_L' OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_value-domvalue_l = <fld>. ENDIF.
      ASSIGN COMPONENT 'DOMVALUE_H' OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_value-domvalue_h = <fld>. ENDIF.
      ASSIGN COMPONENT 'VALPOS'     OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_value-valpos     = <fld>. ENDIF.
      ASSIGN COMPONENT 'APPVAL'     OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_value-appval     = <fld>. ENDIF.
      ASSIGN COMPONENT 'DDTEXT'     OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. ls_value-ddtext     = <fld>. ENDIF.
      " A blank low value with no text is a structural/empty row — skip
      CHECK ls_value-domvalue_l IS NOT INITIAL OR ls_value-ddtext IS NOT INITIAL.
      " Guard against duplicate value keys already collected
      IF line_exists( result-values[ domvalue_l = ls_value-domvalue_l domvalue_h = ls_value-domvalue_h ] ).
        CONTINUE.
      ENDIF.
      APPEND ls_value TO result-values.
    ENDLOOP.

    SORT result-values BY valpos domvalue_l.
  ENDMETHOD.


  METHOD extract_dtel_struct.
    FIELD-SYMBOLS: <dtel>    TYPE any,
                   <dd04tab> TYPE ANY TABLE,
                   <dd04v>   TYPE any,
                   <row>     TYPE any,
                   <fld>     TYPE any.

    ASSIGN COMPONENT 'DTED' OF STRUCTURE is_object TO <dtel>.
    CHECK sy-subrc = 0.

    " Inside the versionable object DD04V is a TABLE (one row per language).
    " Pick the logon-language row, falling back to the first row.
    ASSIGN COMPONENT 'DD04V' OF STRUCTURE <dtel> TO <dd04tab>.
    CHECK sy-subrc = 0.
    LOOP AT <dd04tab> ASSIGNING <row>.
      ASSIGN COMPONENT 'DDLANGUAGE' OF STRUCTURE <row> TO <fld>.
      IF sy-subrc = 0 AND <fld> IS NOT INITIAL AND <fld> <> sy-langu.
        " keep looking for the logon-language row, but remember the first row
        IF <dd04v> IS NOT ASSIGNED.
          ASSIGN <row> TO <dd04v>.
        ENDIF.
        CONTINUE.
      ENDIF.
      ASSIGN <row> TO <dd04v>.
      EXIT.
    ENDLOOP.
    CHECK <dd04v> IS ASSIGNED.

    " Attributes from the selected DD04V row
    ASSIGN COMPONENT 'ROLLNAME'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-rollname  = <fld>. ENDIF.
    ASSIGN COMPONENT 'DOMNAME'   OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-domname   = <fld>. ENDIF.
    ASSIGN COMPONENT 'DATATYPE'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-datatype  = <fld>. ENDIF.
    ASSIGN COMPONENT 'LENG'      OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-leng      = <fld>. ENDIF.
    ASSIGN COMPONENT 'DECIMALS'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-decimals  = <fld>. ENDIF.
    ASSIGN COMPONENT 'OUTPUTLEN' OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-outputlen = <fld>. ENDIF.
    ASSIGN COMPONENT 'CONVEXIT'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-convexit  = <fld>. ENDIF.
    ASSIGN COMPONENT 'LOWERCASE' OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-lowercase = <fld>. ENDIF.
    ASSIGN COMPONENT 'SIGNFLAG'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-signflag  = <fld>. ENDIF.
    ASSIGN COMPONENT 'SHLPNAME'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-shlpname  = <fld>. ENDIF.
    ASSIGN COMPONENT 'SHLPFIELD' OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-shlpfield = <fld>. ENDIF.
    ASSIGN COMPONENT 'MEMORYID'  OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-memoryid  = <fld>. ENDIF.
    ASSIGN COMPONENT 'DDTEXT'    OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-ddtext    = <fld>. ENDIF.
    ASSIGN COMPONENT 'REPTEXT'   OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-reptext   = <fld>. ENDIF.
    ASSIGN COMPONENT 'SCRTEXT_S' OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-scrtext_s = <fld>. ENDIF.
    ASSIGN COMPONENT 'SCRTEXT_M' OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-scrtext_m = <fld>. ENDIF.
    ASSIGN COMPONENT 'SCRTEXT_L' OF STRUCTURE <dd04v> TO <fld>. IF sy-subrc = 0. result-scrtext_l = <fld>. ENDIF.
  ENDMETHOD.


  METHOD extract_tabd_source.
    FIELD-SYMBOLS: <tabd>  TYPE any,
                   <dd02v> TYPE any,
                   <dd03v> TYPE ANY TABLE,
                   <dd08v> TYPE ANY TABLE,
                   <row>   TYPE any,
                   <fld>   TYPE any.

    ASSIGN COMPONENT 'TABD' OF STRUCTURE is_object TO <tabd>.
    CHECK sy-subrc = 0.

    " Header from DD02V
    ASSIGN COMPONENT 'DD02V' OF STRUCTURE <tabd> TO <dd02v>.
    IF sy-subrc = 0.
      DATA lv_tabname  TYPE string.
      DATA lv_tabclass TYPE string.
      DATA lv_contflag TYPE string.
      DATA lv_ddtext   TYPE string.
      ASSIGN COMPONENT 'TABNAME'  OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. lv_tabname  = <fld>. ENDIF.
      ASSIGN COMPONENT 'TABCLASS' OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. lv_tabclass = <fld>. ENDIF.
      ASSIGN COMPONENT 'CONTFLAG' OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. lv_contflag = <fld>. ENDIF.
      ASSIGN COMPONENT 'DDTEXT'   OF STRUCTURE <dd02v> TO <fld>. IF sy-subrc = 0. lv_ddtext   = <fld>. ENDIF.
      APPEND CONV abaptxt255( |TABLE:        { lv_tabname }| )  TO result.
      APPEND CONV abaptxt255( |DESCRIPTION:  { lv_ddtext }| )   TO result.
      APPEND CONV abaptxt255( |TABLE CLASS:  { lv_tabclass }| ) TO result.
      APPEND CONV abaptxt255( |DELIVERY CL.: { lv_contflag }| ) TO result.
      APPEND CONV abaptxt255( '' )                               TO result.
    ENDIF.

    " Fields from DD03V
    ASSIGN COMPONENT 'DD03V' OF STRUCTURE <tabd> TO <dd03v>.
    IF sy-subrc = 0 AND lines( <dd03v> ) > 0.
      APPEND CONV abaptxt255(
        |{ 'FIELD'     WIDTH = 30 } { 'KEY' WIDTH = 3 } { 'ROLLNAME' WIDTH = 30 }| &&
        |{ 'TYPE' WIDTH = 8 } { 'LEN' WIDTH = 6 } { 'DEC' WIDTH = 4 } DESCRIPTION| )
        TO result.
      APPEND CONV abaptxt255( '----------------------------------------------------------------------------------------------' ) TO result.
      LOOP AT <dd03v> ASSIGNING <row>.
        DATA lv_field TYPE string.
        DATA lv_key   TYPE string.
        DATA lv_roll  TYPE string.
        DATA lv_dtype TYPE string.
        DATA lv_leng  TYPE string.
        DATA lv_dec   TYPE string.
        DATA lv_ftext TYPE string.
        ASSIGN COMPONENT 'FIELDNAME' OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_field = <fld>. ENDIF.
        ASSIGN COMPONENT 'KEYFLAG'   OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_key   = COND #( WHEN <fld> = 'X' THEN 'KEY' ELSE '' ). ENDIF.
        ASSIGN COMPONENT 'ROLLNAME'  OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_roll  = <fld>. ENDIF.
        ASSIGN COMPONENT 'DATATYPE'  OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_dtype = <fld>. ENDIF.
        ASSIGN COMPONENT 'LENG'      OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_leng  = |{ <fld> }|. ENDIF.
        ASSIGN COMPONENT 'DECIMALS'  OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_dec   = |{ <fld> }|. ENDIF.
        ASSIGN COMPONENT 'DDTEXT'    OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_ftext = <fld>. ENDIF.
        APPEND CONV abaptxt255(
          |{ lv_field WIDTH = 30 } { lv_key WIDTH = 3 } { lv_roll WIDTH = 30 }| &&
          |{ lv_dtype WIDTH = 8 } { lv_leng WIDTH = 6 } { lv_dec WIDTH = 4 } { lv_ftext }| )
          TO result.
      ENDLOOP.
    ENDIF.

    " Foreign keys from DD08V
    ASSIGN COMPONENT 'DD08V' OF STRUCTURE <tabd> TO <dd08v>.
    IF sy-subrc = 0 AND lines( <dd08v> ) > 0.
      APPEND CONV abaptxt255( '' ) TO result.
      APPEND CONV abaptxt255( 'FOREIGN KEYS:' ) TO result.
      APPEND CONV abaptxt255( '--------------------------------------------------------------------------------' ) TO result.
      LOOP AT <dd08v> ASSIGNING <row>.
        DATA lv_checktab TYPE string.
        DATA lv_fktext   TYPE string.
        ASSIGN COMPONENT 'CHECKTABLE' OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_checktab = <fld>. ENDIF.
        ASSIGN COMPONENT 'DDTEXT'     OF STRUCTURE <row> TO <fld>. IF sy-subrc = 0. lv_fktext   = <fld>. ENDIF.
        APPEND CONV abaptxt255( |CHECK TABLE: { lv_checktab WIDTH = 30 } { lv_fktext }| ) TO result.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
