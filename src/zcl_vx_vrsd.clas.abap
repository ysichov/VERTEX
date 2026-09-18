"! Loads all VRSD records for a given object type/name.
"! Also appends artificial entries for the active (unreleased) and
"! modified (in-memory) versions, mirroring abapTimeMachine logic.
CLASS zcl_vx_vrsd DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    DATA vrsd_list TYPE vrsd_tab READ-ONLY.

    "! Versions whose SVRS directory entry names a different request than the
    "! VRSD row does. A version that arrived with an import carries the request
    "! of the system it came from in VRSD (an ER4 number in an ER6 system), while
    "! the directory — the list SE80 shows — knows the local request that
    "! recorded it here. Only the latter can be matched against a review scope.
    TYPES:
      BEGIN OF ty_alt_korr,
        versno  TYPE versno,
        korrnum TYPE trkorr,
      END OF ty_alt_korr.
    TYPES ty_t_alt_korr TYPE SORTED TABLE OF ty_alt_korr WITH UNIQUE KEY versno.
    DATA alt_korrnums TYPE ty_t_alt_korr READ-ONLY.

    METHODS constructor
      IMPORTING
        !type             TYPE versobjtyp
        !name             TYPE versobjnam
        ignore_unreleased TYPE abap_bool DEFAULT abap_false
        no_toc            TYPE abap_bool DEFAULT abap_false
        date_from         TYPE versdate  DEFAULT '00000000'.

protected section.
  PRIVATE SECTION.

    DATA type      TYPE versobjtyp.
    DATA name      TYPE versobjnam.
    DATA no_toc    TYPE abap_bool.
    DATA date_from TYPE versdate.
    DATA request_active_modif TYPE trkorr.

    METHODS load_from_table
      IMPORTING ignore_unreleased TYPE abap_bool.

    METHODS apply_date_from_cutoff.

    METHODS load_active_or_modified
      IMPORTING versno TYPE versno
      RAISING   zcx_vx.

    METHODS get_request_active_modif
      RETURNING VALUE(result) TYPE trkorr
      RAISING   zcx_vx.

    METHODS determine_request_active_modif
      RETURNING VALUE(result) TYPE trkorr
      RAISING   zcx_vx.

    METHODS get_versionable_object
      RETURNING VALUE(result) TYPE svrs2_versionable_object.

    METHODS get_versionable_object_mode
      IMPORTING versno        TYPE versno
      RETURNING VALUE(result) TYPE char1.

    METHODS read_vrsd
      IMPORTING versno        TYPE versno
      RETURNING VALUE(result) TYPE vrsd
      RAISING   zcx_vx.

ENDCLASS.



CLASS ZCL_VX_VRSD IMPLEMENTATION.


  METHOD constructor.
    me->type      = type.
    me->name      = name.
    me->no_toc    = no_toc.
    me->date_from = date_from.
    load_from_table( ignore_unreleased ).
    IF ignore_unreleased = abap_false.
      TRY.
        load_active_or_modified( zcl_vx_version=>c_version-active ).
        " Modified (not-yet-activated workbench state) is intentionally skipped
      CATCH zcx_vx.
        " Object type not supported (e.g. CPUB, METH)
        " Released versions from DB are still available
      ENDTRY.
    ENDIF.
    SORT me->vrsd_list BY versno ASCENDING.
    apply_date_from_cutoff( ).
  ENDMETHOD.


  METHOD load_from_table.
    DATA versno_range TYPE RANGE OF versno.
    IF ignore_unreleased = abap_true.
      versno_range = VALUE #( sign = 'I' option = 'NE' ( low = '00000' ) ).
    ENDIF.

    DATA lt_trtype TYPE RANGE OF char1.
    IF me->no_toc = abap_true.
      APPEND VALUE #( sign = 'E' option = 'EQ' low = 'T' ) TO lt_trtype.
    ENDIF.

    IF lt_trtype IS INITIAL.
      SELECT v~* FROM vrsd AS v
        INNER JOIN e070 AS e ON e~trkorr = v~korrnum
        WHERE v~objtype = @me->type
          AND v~objname = @me->name
          AND v~versno IN @versno_range
        ORDER BY v~versno
        INTO TABLE @me->vrsd_list.
    ELSE.
      SELECT v~* FROM vrsd AS v
        INNER JOIN e070 AS e ON e~trkorr = v~korrnum
        WHERE v~objtype = @me->type
          AND v~objname = @me->name
          AND v~versno IN @versno_range
          AND e~trfunction IN @lt_trtype
        ORDER BY v~versno
        INTO TABLE @me->vrsd_list.
    ENDIF.

    " Convert internal 0 → external 99998 for consistent sorting
    LOOP AT me->vrsd_list REFERENCE INTO DATA(vrsd).
      vrsd->versno = zcl_vx_versno=>to_external( vrsd->versno ).
    ENDLOOP.

    " Supplement from SVRS_GET_VERSION_DIRECTORY_46 — accepts full OBJNAME (LIKE VRSD-OBJNAME)
    " and returns VERSION_LIST LIKE VRSD. Covers versions not yet written to VRSD
    " (e.g. activated into an unreleased task). Works for long names (METH ≤110 chars).
    DATA lt_dir46   TYPE vrsd_tab.
    DATA lt_lversno TYPE TABLE OF vrsn.
    CALL FUNCTION 'SVRS_GET_VERSION_DIRECTORY_46'
      EXPORTING
        objtype         = me->type
        objname         = me->name
      TABLES
        lversno_list    = lt_lversno
        version_list    = lt_dir46
      EXCEPTIONS
        no_entry        = 1
        OTHERS          = 2.
    IF sy-subrc = 0.
      LOOP AT lt_dir46 REFERENCE INTO DATA(ls_dir46).
        " Skip active (00000) and modified (99997) — handled by load_active_or_modified
        IF ls_dir46->versno = '00000' OR ls_dir46->versno = '99997'.
          CONTINUE.
        ENDIF.
        " Apply no_toc filter (skip TOC entries). Header comes from the cached
        " reader — the directory can hold hundreds of entries per object.
        IF me->no_toc = abap_true.
          IF zcl_vx_request=>get_header( CONV #( ls_dir46->korrnum ) )-trfunction = 'T'.
            CONTINUE.
          ENDIF.
        ENDIF.
        " Skip if already loaded from VRSD
        DATA(lv_ext) = zcl_vx_versno=>to_external( ls_dir46->versno ).
        READ TABLE me->vrsd_list INTO DATA(ls_known) WITH KEY versno = lv_ext.
        IF sy-subrc <> 0.
          ls_dir46->versno = lv_ext.
          INSERT ls_dir46->* INTO TABLE me->vrsd_list.
        ELSEIF ls_dir46->korrnum IS NOT INITIAL
           AND ls_dir46->korrnum <> ls_known-korrnum.
          " Same version, two request numbers: VRSD keeps the one the version was
          " imported with, the directory the one that recorded it in this system.
          INSERT VALUE #( versno = lv_ext korrnum = ls_dir46->korrnum )
            INTO TABLE me->alt_korrnums.
        ENDIF.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.


  METHOD apply_date_from_cutoff.
    " Nothing to do if no cutoff is set
    CHECK me->date_from <> '00000000'.

    " vrsd_list is sorted ASCENDING by versno at this point.
    " Find the newest regular version whose date is strictly before the cutoff —
    " this is the "predecessor" that must be kept.
    " Everything older than that version (lower versno) is dropped.

    DATA lv_cutoff_versno TYPE versno.

    LOOP AT me->vrsd_list INTO DATA(ls_v).
      " Skip pseudo-versions: active (99998) and modified (99999)
      IF ls_v-versno >= zcl_vx_version=>c_version-active.
        CONTINUE.
      ENDIF.
      IF ls_v-datum < me->date_from.
        lv_cutoff_versno = ls_v-versno.   " keep updating → ends up as the highest such versno
      ENDIF.
    ENDLOOP.

    " If no version predates the cutoff, nothing to remove
    CHECK lv_cutoff_versno IS NOT INITIAL.

    " EXPERIMENT (do not delete): force-keep the newest real K below the cutoff so
    " the baseline could be a K. Disabled — the baseline is the immediate foreign
    " predecessor (kept above), which may be a foreign ToC, not necessarily a K.
    "  DATA lv_keep_k_versno TYPE versno.
    "  DATA lv_trf TYPE e070-trfunction.
    "  LOOP AT me->vrsd_list INTO DATA(ls_kv) WHERE versno < lv_cutoff_versno
    "                                           AND versno < zcl_vx_version=>c_version-modified.
    "    CHECK ls_kv-korrnum IS NOT INITIAL.
    "    CLEAR lv_trf.
    "    SELECT SINGLE trfunction FROM e070 WHERE trkorr = @ls_kv-korrnum INTO @lv_trf.
    "    IF lv_trf = 'K'.
    "      lv_keep_k_versno = ls_kv-versno.
    "    ENDIF.
    "  ENDLOOP.

    " Delete every regular version strictly older than lv_cutoff_versno
    DELETE me->vrsd_list WHERE versno < lv_cutoff_versno
                           AND versno < zcl_vx_version=>c_version-modified.
  ENDMETHOD.


  METHOD load_active_or_modified.
    DATA ls_vrsd TYPE vrsd.

    IF versno = zcl_vx_version=>c_version-active.
      " Use SVRS_GET_VERSION_DIRECTORY_46 — accepts full OBJNAME (LIKE VRSD-OBJNAME),
      " works for both short (PROG/REPS) and long (METH ≤110 chars) names.
      " versno='00000' in the result = active version with exact korrnum/datum/zeit/author.
      " Do NOT use read_vrsd/SVRS_GET_VERSION_REPOSITORY mode='A' — it may return
      " metadata of the last activated virtual version (e.g. version 19 data).
      DATA lt_dir_a  TYPE vrsd_tab.
      DATA lt_lv_a   TYPE TABLE OF vrsn.
      CALL FUNCTION 'SVRS_GET_VERSION_DIRECTORY_46'
        EXPORTING  objtype      = me->type
                   objname      = me->name
        TABLES     lversno_list = lt_lv_a
                   version_list = lt_dir_a
        EXCEPTIONS no_entry     = 1  OTHERS = 2.
      IF sy-subrc <> 0.
        RETURN.
      ENDIF.
      " Active version stored internally as versno='00000'
      READ TABLE lt_dir_a INTO DATA(ls_a0)
        WITH KEY versno = '00000'.
      IF sy-subrc <> 0.
        RETURN.
      ENDIF.
      ls_vrsd-versno  = versno.   " our external key: 99998
      ls_vrsd-objtype = me->type.
      ls_vrsd-objname = me->name.
      ls_vrsd-korrnum = ls_a0-korrnum.
      ls_vrsd-datum   = ls_a0-datum.
      ls_vrsd-zeit    = ls_a0-zeit.
      ls_vrsd-author  = ls_a0-author.
    ELSE.
      " Modified or other special version — use repository + lock detection
      ls_vrsd = read_vrsd( versno ).
      IF ls_vrsd IS INITIAL OR ls_vrsd-author IS INITIAL.
        RETURN.
      ENDIF.
      ls_vrsd-versno  = versno.
      ls_vrsd-objtype = me->type.
      ls_vrsd-objname = me->name.
      ls_vrsd-korrnum = get_request_active_modif( ).
    ENDIF.

    READ TABLE me->vrsd_list ASSIGNING FIELD-SYMBOL(<existing>)
      WITH KEY versno = versno.
    IF sy-subrc = 0.
      <existing>-korrnum = ls_vrsd-korrnum.
      <existing>-datum   = ls_vrsd-datum.
      <existing>-zeit    = ls_vrsd-zeit.
      <existing>-author  = ls_vrsd-author.
    ELSE.
      INSERT ls_vrsd INTO TABLE me->vrsd_list.
    ENDIF.
  ENDMETHOD.


  METHOD determine_request_active_modif.
    DATA s_ko100   TYPE ko100.
    DATA locked    TYPE trparflag.
    DATA s_tlock   TYPE tlock.
    DATA s_tlock_key TYPE tlock_int.

    CALL FUNCTION 'TR_GET_PGMID_FOR_OBJECT'
      EXPORTING
        iv_object      = me->type
      IMPORTING
        es_type        = s_ko100
      EXCEPTIONS
        illegal_object = 1
        OTHERS         = 2.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.

    DATA(s_e071) = VALUE e071(
      pgmid    = s_ko100-pgmid
      object   = me->type
      obj_name = me->name ).

    CALL FUNCTION 'TR_CHECK_TYPE'
      EXPORTING
        wi_e071     = s_e071
      IMPORTING
        pe_result   = locked
        we_lock_key = s_tlock_key.
    IF locked <> 'L'.
      RETURN.
    ENDIF.

    CALL FUNCTION 'TRINT_CHECK_LOCKS'
      EXPORTING
        wi_lock_key = s_tlock_key
      IMPORTING
        we_lockflag = locked
        we_tlock    = s_tlock
      EXCEPTIONS
        empty_key   = 1
        OTHERS      = 2.
    IF sy-subrc <> 0.
      zcx_vx=>raise_from_syst( ).
    ENDIF.

    IF locked IS INITIAL.
      RETURN.
    ENDIF.

    result = s_tlock-trkorr.
  ENDMETHOD.


  METHOD get_request_active_modif.
    IF me->request_active_modif IS INITIAL.
      me->request_active_modif = determine_request_active_modif( ).
    ENDIF.
    result = me->request_active_modif.
  ENDMETHOD.


  METHOD read_vrsd.
    CALL FUNCTION 'SVRS_INITIALIZE_DATAPOINTER'
      CHANGING
        objtype      = me->type
        data_pointer = me->type.

    DATA(obj) = get_versionable_object( ).
    CALL FUNCTION 'SVRS_GET_VERSION_REPOSITORY'
      EXPORTING
        mode      = get_versionable_object_mode( versno )
      CHANGING
        obj       = obj
      EXCEPTIONS
        not_found = 1
        OTHERS    = 2.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    CALL FUNCTION 'SVRS_EXTRACT_INFO_FROM_OBJECT'
      EXPORTING
        object    = obj
      CHANGING
        vrsd_info = result.
  ENDMETHOD.


  METHOD get_versionable_object.
    result = VALUE #(
      objtype      = me->type
      data_pointer = me->type
      objname      = me->name
      header_only  = abap_true ).
  ENDMETHOD.


  METHOD get_versionable_object_mode.
    result = SWITCH #(
      versno
      WHEN zcl_vx_version=>c_version-active   THEN 'A'
      WHEN zcl_vx_version=>c_version-modified THEN 'M' ).
  ENDMETHOD.
ENDCLASS.
