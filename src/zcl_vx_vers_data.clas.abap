CLASS zcl_vx_vers_data DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    CLASS-DATA mv_no_toc TYPE abap_bool.

    "! Full name of a user (USR01/AD display name).
    CLASS-METHODS get_user_name
      IMPORTING iv_user       TYPE versuser
      RETURNING VALUE(result) TYPE ad_namtext.

    "! Author of the most recent version of an object (from VRSD).
    CLASS-METHODS get_latest_author
      IMPORTING i_type        TYPE versobjtyp
                i_name        TYPE versobjnam
      RETURNING VALUE(result) TYPE versuser.

    "! True if the object exists in the system (TADIR / SEOCOMPO check).
    CLASS-METHODS check_part_exists
      IMPORTING i_type        TYPE versobjtyp
                i_name        TYPE versobjnam
                i_class_name  TYPE seoclsname OPTIONAL
      RETURNING VALUE(result) TYPE abap_bool.

    "! Object-type description text (lazy-loaded from TRINT_OBJECT_TABLE, cached).
    CLASS-METHODS get_type_text
      IMPORTING i_type        TYPE versobjtyp
      RETURNING VALUE(result) TYPE as4text.

    "! True if the given object type is supported for Code Review.
    CLASS-METHODS is_supported_object_type
      IMPORTING iv_objtype    TYPE versobjtyp
      RETURNING VALUE(result) TYPE abap_bool.

    "! True if any part of the class has changed vs its prior K-type version.
    CLASS-METHODS check_class_has_author
      IMPORTING i_class_name  TYPE string
                i_korrnum     TYPE verskorrno OPTIONAL
                i_ignore_case TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(result) TYPE abap_bool.

    "! True if the latest version of the object was authored by i_user AND
    "! its source differs from the nearest prior version whose transport
    "! Builds a version list (newest-first, trfunction filled) for a given object.
    "! Used to feed is_substantive_user_change without extra DB queries at check time.
    CLASS-METHODS build_versions_for_check
      IMPORTING i_type        TYPE versobjtyp
                i_name        TYPE versobjnam
      RETURNING VALUE(result) TYPE zif_vx_vers_types=>ty_t_version_row.

    "! Returns true if the latest version in it_versions differs from the
    "! nearest prior K-type version (source comparison).
    CLASS-METHODS is_substantive_user_change
      IMPORTING it_versions   TYPE zif_vx_vers_types=>ty_t_version_row
                i_type        TYPE versobjtyp
                i_name        TYPE versobjnam
                i_korrnum     TYPE verskorrno OPTIONAL
                i_ignore_case TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(result) TYPE abap_bool.

    "! Drop consecutive versions whose source is identical (ignoring all
    "! whitespace and case unless i_ignore_case is false). Input must be sorted newest-first.
    "! i_keep_korrnum: version with this korrnum is never removed (e.g. current TR baseline).
    "! When filled, source comparison is limited to the relevant window around this TR.
    CLASS-METHODS remove_duplicate_versions
      IMPORTING i_keep_korrnum TYPE trkorr OPTIONAL
                i_ignore_case  TYPE abap_bool DEFAULT abap_true
      CHANGING  ct_versions    TYPE zif_vx_vers_types=>ty_t_version_row.

    "! Line count of the currently active source for a part (0 when unavailable,
    "! e.g. for CLSD/RELE which have no source).
    CLASS-METHODS get_active_line_count
      IMPORTING i_type        TYPE versobjtyp
                i_name        TYPE versobjnam
      RETURNING VALUE(result) TYPE i.

    "! Read source of a single version. Builds a synthetic VRSD row if none
    "! is stored yet (e.g. version pending in an unreleased task).
    CLASS-METHODS get_ver_source
      IMPORTING i_objtype     TYPE versobjtyp
                i_objname     TYPE versobjnam
                i_versno      TYPE versno
                i_korrnum     TYPE trkorr  OPTIONAL
                i_author      TYPE versuser OPTIONAL
                i_datum       TYPE versdate OPTIONAL
                i_zeit        TYPE verstime OPTIONAL
      RETURNING VALUE(result) TYPE abaptxt255_tab.

protected section.
  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_type_text,
        type TYPE versobjtyp,
        text TYPE as4text,
      END OF ty_type_text.
    CLASS-DATA mt_type_cache TYPE HASHED TABLE OF ty_type_text WITH UNIQUE KEY type.
    CLASS-DATA mv_cache_loaded TYPE abap_bool VALUE abap_false.
    CLASS-METHODS load_type_cache.
ENDCLASS.



CLASS ZCL_VX_VERS_DATA IMPLEMENTATION.


  METHOD get_user_name.
    result = NEW zcl_vx_author( )->get_name( iv_user ).
  ENDMETHOD.


  METHOD get_latest_author.
    DATA(lo_vrsd) = NEW zcl_vx_vrsd( type = i_type name = i_name ).
    IF lo_vrsd->vrsd_list IS INITIAL. RETURN. ENDIF.
    DATA(lt_list) = lo_vrsd->vrsd_list.
    SORT lt_list BY versno DESCENDING.
    result = lt_list[ 1 ]-author.
  ENDMETHOD.


  METHOD check_part_exists.
    IF i_type = 'RELE'.
      result = abap_true.
      RETURN.
    ENDIF.

    " METH: check existence directly in SEOCOMPO (class/method component table).
    " Accepts both spellings of the part name — the plain component name and the
    " VRSD one, where the class is padded to 30 chars in front of the method.
    IF i_type = 'METH'.
      DATA lv_meth_cmpname TYPE seocmpname.
      DATA lv_cmptype      TYPE seocmptype VALUE '1'.
      DATA lv_meth_class   TYPE seoclsname.
      DATA(lv_meth_plain)  = condense( CONV string( i_name ) ).
      DATA(lv_meth_prefix) = condense( CONV string( i_name(30) ) ).
      DATA(lv_meth_tail)   = condense( CONV string( i_name+30 ) ).
      lv_meth_class   = i_class_name.
      lv_meth_cmpname = lv_meth_plain.
      IF lv_meth_tail IS NOT INITIAL
         AND ( lv_meth_class IS INITIAL
            OR to_upper( lv_meth_prefix ) = to_upper( CONV string( lv_meth_class ) ) ).
        lv_meth_class   = lv_meth_prefix.
        lv_meth_cmpname = lv_meth_tail.
      ENDIF.
      IF lv_meth_class IS INITIAL.
        " Nothing to check against — never claim the method is gone.
        result = abap_true.
        RETURN.
      ENDIF.
      SELECT SINGLE clsname FROM seocompo
        WHERE clsname = @lv_meth_class
          AND cmpname = @lv_meth_cmpname
          AND cmptype = @lv_cmptype
        INTO @DATA(lv_cls_found).
      IF sy-subrc = 0.
        result = abap_true.
        RETURN.
      ENDIF.

      " **A redefinition is not in SEOCOMPO.** The component belongs to the
      " class that DECLARES it; a subclass that redefines it is recorded in
      " SEOREDEF. A Gateway _DPC_EXT class is almost nothing but redefinitions
      " of its generated _DPC base, so asking SEOCOMPO alone reported every one
      " of its methods as deleted and Code Review dropped the whole class
      " without a word beyond one SKIP line.
      SELECT SINGLE clsname FROM seoredef
        WHERE clsname = @lv_meth_class
          AND mtdname = @lv_meth_cmpname
        INTO @DATA(lv_redef_found).
      IF sy-subrc = 0.
        result = abap_true.
        RETURN.
      ENDIF.

      " Neither table knows this spelling — an interface implementation, an
      " alias, a name the VRSD entry carries differently. That is ignorance,
      " not proof of deletion: while the CLASS is there, the method stays
      " reviewable. Only a class that is gone makes its parts gone.
      SELECT SINGLE clsname FROM seoclass
        WHERE clsname = @lv_meth_class
        INTO @DATA(lv_meth_cls_exists).
      result = boolc( sy-subrc = 0 ).
      RETURN.
    ENDIF.

    " Class pool and class sections have no repository entry of their own — the
    " class carries it, so they are checked against SEOCLASS. KEEP (replaced):
    " these types used to report abap_true unconditionally, which kept the
    " sections of a deleted class alive; their VRSD history survives the deletion
    " and Code Review then paired the newest version against nothing and showed
    " the whole section as freshly written code.
    IF i_type = 'CPUB' OR i_type = 'CPRO' OR i_type = 'CPRI' OR i_type = 'CLSD'.
      " result = abap_true.
      " RETURN.
      DATA lv_sec_class TYPE seoclsname.
      DATA(lv_sec_text) = condense( CONV string( i_name ) ).
      IF i_class_name IS NOT INITIAL.
        lv_sec_text = condense( CONV string( i_class_name ) ).
      ENDIF.
      " Section include names carry the class padded with '=' — cut the padding.
      DATA(lv_sec_eq) = find( val = lv_sec_text sub = '=' ).
      IF lv_sec_eq > 0.
        lv_sec_text = substring( val = lv_sec_text len = lv_sec_eq ).
      ENDIF.
      lv_sec_class = lv_sec_text.
      IF lv_sec_class IS INITIAL.
        result = abap_true.
        RETURN.
      ENDIF.
      SELECT SINGLE clsname FROM seoclass
        WHERE clsname = @lv_sec_class
        INTO @DATA(lv_sec_found).
      result = boolc( sy-subrc = 0 ).
      RETURN.
    ENDIF.

    " Programs and includes: TRDIR is the authority — the same place SE38 looks.
    " TADIR is not: an include of a function group or of a class has no R3TR PROG
    " entry of its own, and a deleted program can leave its TADIR entry behind,
    " in which case the parts list called it alive and Code Review reviewed its
    " surviving versions as a brand-new object.
    IF i_type = 'REPS' OR i_type = 'REPT' OR i_type = 'PROG'.
      DATA lv_trdir_name TYPE trdir-name.
      lv_trdir_name = i_name.
      SELECT SINGLE name FROM trdir
        WHERE name = @lv_trdir_name
        INTO @DATA(lv_trdir_found).
      result = boolc( sy-subrc = 0 ).
      RETURN.
    ENDIF.

    " Function modules are LIMU objects: TADIR only holds the R3TR FUGR around
    " them, so a TADIR lookup could never find one.
    IF i_type = 'FUNC'.
      DATA lv_func_name TYPE tfdir-funcname.
      lv_func_name = i_name.
      SELECT SINGLE funcname FROM tfdir
        WHERE funcname = @lv_func_name
        INTO @DATA(lv_func_found).
      result = boolc( sy-subrc = 0 ).
      RETURN.
    ENDIF.

    " Everything left (CLAS, FUGR, DDLS, DDIC definitions, …) is a repository
    " object with an R3TR entry of its own.
    DATA lv_tadir_type TYPE tadir-object.
    IF i_type = 'TABD'.
      lv_tadir_type = 'TABL'.   " VRSD 'TABD' = table definition, exists as TABL in TADIR/TR
    ELSEIF i_type = 'DOMD'.
      lv_tadir_type = 'DOMA'.   " VRSD 'DOMD' = domain, exists as DOMA in TADIR/TR
    ELSEIF i_type = 'DTED'.
      lv_tadir_type = 'DTEL'.   " VRSD 'DTED' = data element, exists as DTEL in TADIR/TR
    ELSE.
      lv_tadir_type = i_type.
    ENDIF.

    DATA lv_obj_name TYPE tadir-obj_name.
    lv_obj_name = i_name.
    DATA lv_pgmid TYPE tadir-pgmid.
    SELECT SINGLE pgmid FROM tadir
      WHERE pgmid    = 'R3TR'
        AND object   = @lv_tadir_type
        AND obj_name = @lv_obj_name
        AND delflag  = ' '
      INTO @lv_pgmid.
    result = boolc( sy-subrc = 0 ).
  ENDMETHOD.


  METHOD get_type_text.
    IF mv_cache_loaded = abap_false.
      load_type_cache( ).
    ENDIF.
    READ TABLE mt_type_cache ASSIGNING FIELD-SYMBOL(<c>) WITH TABLE KEY type = i_type.
    IF sy-subrc = 0.
      result = <c>-text.
    ENDIF.
  ENDMETHOD.


  METHOD is_supported_object_type.
    result = xsdbool(
      iv_objtype = 'CLAS'
      OR iv_objtype = 'CLSD'
      OR iv_objtype = 'CPRI'
      OR iv_objtype = 'CPRO'
      OR iv_objtype = 'CPUB'
      OR iv_objtype = 'METH'
      OR iv_objtype = 'PROG'
      OR iv_objtype = 'REPS'
      OR iv_objtype = 'DDLS'
      OR iv_objtype = 'FUNC'
      OR iv_objtype = 'FUGR'
      OR iv_objtype = 'TABD'
      OR iv_objtype = 'DOMD'
      OR iv_objtype = 'DTED' ).
  ENDMETHOD.


  METHOD load_type_cache.
    mv_cache_loaded = abap_true.
    DATA lt_types_out TYPE STANDARD TABLE OF ko100.
    CALL FUNCTION 'TRINT_OBJECT_TABLE'
      EXPORTING iv_complete  = 'X'
      TABLES    tt_types_out = lt_types_out.
    LOOP AT lt_types_out INTO DATA(ls_ko100).
      INSERT VALUE #( type = ls_ko100-object text = ls_ko100-text )
        INTO TABLE mt_type_cache.
    ENDLOOP.
  ENDMETHOD.


  METHOD remove_duplicate_versions.
    TYPES: BEGIN OF ty_prev,
             objtype TYPE versobjtyp,
             objname TYPE versobjnam,
             norm_src TYPE string_table,
             raw_src TYPE abaptxt255_tab,
             has_src TYPE abap_bool,
             base_idx TYPE i,
             owner   TYPE versuser,
             owner_name TYPE ad_namtext,
             datum   TYPE versdate,
             zeit    TYPE verstime,
             work_idx TYPE i,
           END OF ty_prev.
    TYPES: BEGIN OF ty_work,
             row      TYPE zif_vx_vers_types=>ty_version_row,
             norm_src TYPE string_table,
             raw_src  TYPE abaptxt255_tab,
             orig_idx TYPE i,
             check    TYPE abap_bool,
             keep     TYPE abap_bool,
             base      TYPE abap_bool,
            END OF ty_work.
    DATA lt_prev_map TYPE HASHED TABLE OF ty_prev WITH UNIQUE KEY objtype objname.
    DATA lt_result   TYPE zif_vx_vers_types=>ty_t_version_row.
    DATA lt_work     TYPE STANDARD TABLE OF ty_work WITH DEFAULT KEY.
    FIELD-SYMBOLS <ver> TYPE ty_work.
    FIELD-SYMBOLS <p>   TYPE ty_prev.

    " ct_versions can contain rows for multiple (objtype,objname) pairs mixed
    " together (e.g. all methods of a class sorted globally by versno).
    " Analyze chronologically so duplicate runs keep the earliest version.
    LOOP AT ct_versions INTO DATA(ls_input_ver).
      DATA ls_work TYPE ty_work.
      ls_work-row = ls_input_ver.
      ls_work-orig_idx = sy-tabix.
      APPEND ls_work TO lt_work.
    ENDLOOP.
    SORT lt_work BY row-objtype row-objname row-versno ASCENDING row-datum ASCENDING row-zeit ASCENDING.

    IF i_keep_korrnum IS INITIAL.
      LOOP AT lt_work ASSIGNING <ver>.
        <ver>-check = abap_true.
      ENDLOOP.
    ELSE.
      DATA(lv_group_start) = 1.
      WHILE lv_group_start <= lines( lt_work ).
        READ TABLE lt_work INTO DATA(ls_group) INDEX lv_group_start.
        DATA(lv_group_end) = lv_group_start.
        DATA(lv_selected_idx) = 0.

        WHILE lv_group_end <= lines( lt_work ).
          READ TABLE lt_work ASSIGNING FIELD-SYMBOL(<group_ver>) INDEX lv_group_end.
          IF <group_ver>-row-objtype <> ls_group-row-objtype
          OR <group_ver>-row-objname <> ls_group-row-objname.
            EXIT.
          ENDIF.
          IF <group_ver>-row-korrnum = i_keep_korrnum.
            lv_selected_idx = lv_group_end.
          ENDIF.
          lv_group_end = lv_group_end + 1.
        ENDWHILE.

        IF lv_selected_idx > 0.
          DATA(lv_prev_k_idx) = 0.
          DATA(lv_scan_idx) = lv_selected_idx - 1.
          WHILE lv_scan_idx >= lv_group_start.
            READ TABLE lt_work ASSIGNING <group_ver> INDEX lv_scan_idx.
            IF <group_ver>-row-trfunction = 'K'.
              lv_prev_k_idx = lv_scan_idx.
              EXIT.
            ENDIF.
            lv_scan_idx = lv_scan_idx - 1.
          ENDWHILE.

          DATA(lv_check_from) = COND i(
            WHEN lv_prev_k_idx > lv_group_start THEN lv_prev_k_idx - 1
            ELSE lv_group_start ).
          DATA(lv_mark_idx) = lv_check_from.
          WHILE lv_mark_idx <= lv_selected_idx.
            READ TABLE lt_work ASSIGNING <group_ver> INDEX lv_mark_idx.
            <group_ver>-check = abap_true.
            IF lv_mark_idx = lv_check_from.
              <group_ver>-base = abap_true.
            ENDIF.
            lv_mark_idx = lv_mark_idx + 1.
          ENDWHILE.
        ENDIF.

        lv_group_start = lv_group_end.
      ENDWHILE.
    ENDIF.

    DATA(lv_total) = 0.
    LOOP AT lt_work TRANSPORTING NO FIELDS WHERE check = abap_true.
      lv_total = lv_total + 1.
    ENDLOOP.
    DATA(lv_check_idx) = 0.

    LOOP AT lt_work ASSIGNING <ver>.
      DATA(lv_work_idx) = sy-tabix.
      IF <ver>-check <> abap_true.
        <ver>-keep = abap_true.
        CONTINUE.
      ENDIF.

      lv_check_idx = lv_check_idx + 1.
      IF lv_check_idx = 1 OR lv_check_idx = lv_total OR lv_check_idx MOD 5 = 0.
        CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
          EXPORTING percentage = CONV i( lv_check_idx * 100 / COND i( WHEN lv_total > 0 THEN lv_total ELSE 1 ) )
                    text       = CONV char70( |Checking duplicates { <ver>-row-objtype } { <ver>-row-objname } ({ lv_check_idx }/{ lv_total })| ).
      ENDIF.

      " Read source directly from SVRS — bypass zcl_vx_version constructor,
      " whose load_latest_task can raise zcx_vx and leave lt_cur_src empty
      " for some versions while others succeed, producing spurious diffs.
      DATA lt_cur_src TYPE abaptxt255_tab.
      CLEAR lt_cur_src.
      IF <ver>-row-objtype = 'DDLS'.
        lt_cur_src = zcl_vx_version=>load_ddls_source(
          i_objname = <ver>-row-objname
          i_versno  = <ver>-row-versno ).
      ELSE.
        DATA lt_trdir TYPE trdir_it.
        DATA(lv_db_no) = zcl_vx_versno=>to_internal( <ver>-row-versno ).
        CALL FUNCTION 'SVRS_GET_REPS_FROM_OBJECT'
          EXPORTING object_name = <ver>-row-objname
                    object_type = <ver>-row-objtype
                    versno      = lv_db_no
          TABLES    repos_tab   = lt_cur_src
                    trdir_tab   = lt_trdir
          EXCEPTIONS no_version = 1 OTHERS = 2.
        IF sy-subrc <> 0. CLEAR lt_cur_src. ENDIF.
      ENDIF.

      " Fast path for case-sensitive mode: compare raw source tables directly.
      " The normalized path ignores leading whitespace from pretty-printer reindent.
      DATA lt_cur_norm  TYPE string_table.
      DATA lt_prev_norm TYPE string_table.
      DATA lt_prev_raw  TYPE abaptxt255_tab.
      CLEAR lt_cur_norm. CLEAR lt_prev_norm.
      CLEAR lt_prev_raw.
      IF i_ignore_case = abap_true.
        " Same normalization as the ignore-case/indent fold in
        " ZCL_VX_DIFF=>COMPUTE_DIFF (all whitespace removed + upper case),
        " so "version is a duplicate" and "diff between the two is empty" agree.
        LOOP AT lt_cur_src INTO DATA(ls_cn).
          DATA(lv_cn) = CONV string( ls_cn ).
          CONDENSE lv_cn NO-GAPS.
*         Keep for reference — only stripped the indent, so alignment/case-only
*         reformats produced duplicate versions with an empty diff.
*         SHIFT lv_cn LEFT DELETING LEADING ` `.
          APPEND to_upper( lv_cn ) TO lt_cur_norm.
        ENDLOOP.
        <ver>-norm_src = lt_cur_norm.
      ELSE.
        <ver>-raw_src = lt_cur_src.
      ENDIF.

      DATA lv_has_prev TYPE abap_bool.
      lv_has_prev = abap_false.
      UNASSIGN <p>.
      READ TABLE lt_prev_map ASSIGNING <p>
        WITH TABLE KEY objtype = <ver>-row-objtype objname = <ver>-row-objname.
      IF sy-subrc = 0 AND <p>-has_src = abap_true.
        lv_has_prev = abap_true.
        IF i_ignore_case = abap_true.
          lt_prev_norm = <p>-norm_src.
        ELSE.
          lt_prev_raw = <p>-raw_src.
        ENDIF.
      ENDIF.

      DATA(lv_is_duplicate) = COND abap_bool(
        WHEN lv_has_prev = abap_true
         AND ( ( i_ignore_case = abap_true AND lt_cur_norm = lt_prev_norm )
            OR ( i_ignore_case = abap_false AND lt_cur_src = lt_prev_raw ) )
        THEN abap_true
        ELSE abap_false ).
      DATA(lv_keep_korrnum) = COND abap_bool(
        WHEN i_keep_korrnum IS NOT INITIAL AND <ver>-row-korrnum = i_keep_korrnum THEN abap_true
        ELSE abap_false ).
      DATA(lv_k_over_t) = COND abap_bool(
        WHEN lv_is_duplicate = abap_true
         AND <p> IS ASSIGNED
         AND <p>-work_idx IS NOT INITIAL
         AND <p>-base_idx IS INITIAL
         AND <ver>-row-trfunction = 'K'
         AND lt_work[ <p>-work_idx ]-row-trfunction = 'T'
         AND lt_work[ <p>-work_idx ]-base <> abap_true
         AND ( i_keep_korrnum IS INITIAL OR lt_work[ <p>-work_idx ]-row-korrnum <> i_keep_korrnum )
        THEN abap_true
        ELSE abap_false ).

      IF lv_is_duplicate = abap_true AND <p> IS ASSIGNED.
        <ver>-row-obj_owner      = <p>-owner.
        <ver>-row-obj_owner_name = <p>-owner_name.
*        <ver>-row-datum          = <p>-datum.
*        <ver>-row-zeit           = <p>-zeit.
      ENDIF.

      IF lv_has_prev = abap_false OR lv_is_duplicate = abap_false OR lv_keep_korrnum = abap_true OR lv_k_over_t = abap_true.
        <ver>-keep = abap_true.
        IF lv_k_over_t = abap_true.
          lt_work[ <p>-work_idx ]-keep = abap_false.
          <p>-norm_src   = lt_cur_norm.
          <p>-raw_src    = lt_cur_src.
          <p>-has_src    = abap_true.
          <p>-base_idx   = COND #( WHEN <ver>-base = abap_true THEN lv_work_idx ELSE 0 ).
          <p>-owner      = <ver>-row-obj_owner.
          <p>-owner_name = <ver>-row-obj_owner_name.
          <p>-datum      = <ver>-row-datum.
          <p>-zeit       = <ver>-row-zeit.
          <p>-work_idx   = lv_work_idx.
        ELSEIF lv_is_duplicate = abap_false.
          IF <p> IS ASSIGNED.
            <p>-norm_src   = lt_cur_norm.
            <p>-raw_src    = lt_cur_src.
            <p>-has_src    = abap_true.
            <p>-base_idx   = COND #( WHEN <ver>-base = abap_true THEN lv_work_idx ELSE 0 ).
            <p>-owner      = <ver>-row-obj_owner.
            <p>-owner_name = <ver>-row-obj_owner_name.
            <p>-datum      = <ver>-row-datum.
            <p>-zeit       = <ver>-row-zeit.
            <p>-work_idx   = lv_work_idx.
          ELSE.
            INSERT VALUE #( objtype    = <ver>-row-objtype
                            objname    = <ver>-row-objname
                            norm_src   = lt_cur_norm
                            raw_src    = lt_cur_src
                            has_src    = abap_true
                            base_idx   = COND #( WHEN <ver>-base = abap_true THEN lv_work_idx ELSE 0 )
                            owner      = <ver>-row-obj_owner
                            owner_name = <ver>-row-obj_owner_name
                            datum      = <ver>-row-datum
                            zeit       = <ver>-row-zeit
                            work_idx   = lv_work_idx )
              INTO TABLE lt_prev_map.
          ENDIF.
        ENDIF.
      ENDIF.
      UNASSIGN <p>.
    ENDLOOP.

    SORT lt_work BY orig_idx ASCENDING.
    LOOP AT lt_work ASSIGNING <ver> WHERE keep = abap_true.
      APPEND <ver>-row TO lt_result.
    ENDLOOP.

    ct_versions = lt_result.
  ENDMETHOD.


  METHOD get_active_line_count.
    DATA lv_incname TYPE progname.
    DATA lt_src TYPE TABLE OF string.
    TRY.
        CASE i_type.
          WHEN 'CLSD' OR 'RELE' OR 'DEVC' OR 'FUGR' OR 'CLAS'.
            " Aggregate / header types — no single source.
            RETURN.
          WHEN 'DDLS'.
            result = lines( zcl_vx_version=>load_ddls_source(
              i_objname = i_name
              i_versno  = zcl_vx_version=>c_version-active ) ).
            RETURN.
          WHEN 'INTF'.
            lv_incname = cl_oo_classname_service=>get_interfacepool_name( CONV #( i_name ) ).
          WHEN 'CPUB'.
            lv_incname = cl_oo_classname_service=>get_pubsec_name( CONV #( i_name ) ).
          WHEN 'CPRO'.
            lv_incname = cl_oo_classname_service=>get_prosec_name( CONV #( i_name ) ).
          WHEN 'CPRI'.
            lv_incname = cl_oo_classname_service=>get_prisec_name( CONV #( i_name ) ).
          WHEN 'METH'.
            " i_name layout (VRSD convention): class (30-char, blank-padded) + method
            "IF strlen( i_name ) <= 30.
            "  RETURN.
            "ENDIF.
            "DATA(lv_cls) = CONV seoclsname( i_name(30) ).
            "DATA lv_mtd TYPE seocpdname.
            "lv_mtd = i_name+30.
            "CONDENSE lv_cls.
            "CONDENSE lv_mtd.
            "IF lv_cls IS INITIAL OR lv_mtd IS INITIAL.
            "  RETURN.
            "ENDIF.
            "lv_incname = cl_oo_classname_service=>get_method_include(
            "  mtdkey = VALUE #( clsname = lv_cls cpdname = lv_mtd ) ).
          WHEN OTHERS.
            lv_incname = i_name.
        ENDCASE.
        IF lv_incname IS INITIAL. RETURN. ENDIF.
        READ REPORT lv_incname INTO lt_src.
        IF sy-subrc = 0.
          result = lines( lt_src ).
        ENDIF.
      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.


  METHOD get_ver_source.
    DATA lt_vrsd TYPE vrsd_tab.
    DATA(lv_vno) = zcl_vx_versno=>to_internal( i_versno ).
    SELECT * FROM vrsd
      WHERE objtype = @i_objtype
        AND objname = @i_objname
        AND versno  = @lv_vno
      INTO TABLE @lt_vrsd UP TO 1 ROWS.
    IF lt_vrsd IS INITIAL.
      " Synthetic VRSD row so SVRS_GET_REPS_FROM_OBJECT can still resolve the source.
      APPEND VALUE vrsd(
        objtype = i_objtype
        objname = i_objname
        versno  = lv_vno
        korrnum = i_korrnum
        author  = i_author
        datum   = i_datum
        zeit    = i_zeit
      ) TO lt_vrsd.
    ENDIF.
    result = NEW zcl_vx_version( lt_vrsd[ 1 ] )->get_source( ).
  ENDMETHOD.


  METHOD check_class_has_author.
    TRY.
        DATA(lo_obj) = NEW zcl_vx_object_factory( )->get_instance(
          object_type = zcl_vx_object_factory=>gc_type-class
          object_name = CONV #( i_class_name ) ).
        LOOP AT lo_obj->get_parts( ) INTO DATA(ls_part).
          CHECK ls_part-type <> 'CLSD' AND ls_part-type <> 'RELE'.
          IF is_substantive_user_change(
               it_versions = build_versions_for_check( i_type = ls_part-type i_name = ls_part-object_name )
               i_type      = ls_part-type
               i_name      = ls_part-object_name
               i_korrnum   = i_korrnum
               i_ignore_case = i_ignore_case ) = abap_true.
            result = abap_true.
            RETURN.
          ENDIF.
        ENDLOOP.
      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.


  METHOD build_versions_for_check.
    TRY.
        DATA(lo_vrsd) = NEW zcl_vx_vrsd( type = i_type name = i_name no_toc = mv_no_toc ignore_unreleased = abap_false ).
      CATCH zcx_vx.
        RETURN.
    ENDTRY.

    " vrsd_list already has versno (external), korrnum, objtype, objname — no zcl_vx_version needed.
    LOOP AT lo_vrsd->vrsd_list INTO DATA(ls_vrsd).
      APPEND VALUE zif_vx_vers_types=>ty_version_row(
        versno  = ls_vrsd-versno
        korrnum = ls_vrsd-korrnum
        objtype = ls_vrsd-objtype
        objname = ls_vrsd-objname ) TO result.
    ENDLOOP.

    SORT result BY versno DESCENDING.

    " Fill trfunction from the cached E070 header — one read per unique korrnum,
    " and none at all once another part of the same request already asked for it.
    LOOP AT result ASSIGNING FIELD-SYMBOL(<v>).
      CHECK <v>-korrnum IS NOT INITIAL AND <v>-trfunction IS INITIAL.
      <v>-trfunction = zcl_vx_request=>get_header( CONV #( <v>-korrnum ) )-trfunction.
      " Propagate trfunction to all versions with same korrnum
      LOOP AT result ASSIGNING FIELD-SYMBOL(<v2>) WHERE korrnum = <v>-korrnum AND trfunction IS INITIAL.
        <v2>-trfunction = <v>-trfunction.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.


  METHOD is_substantive_user_change.
    " it_versions is already sorted newest-first with trfunction filled.
    " Find the target version (latest or i_korrnum) and nearest prior K-type version.
    IF it_versions IS INITIAL. RETURN. ENDIF.

    DATA ls_latest LIKE LINE OF it_versions.
    IF i_korrnum IS INITIAL.
      ls_latest = it_versions[ 1 ].
    ELSE.
      LOOP AT it_versions INTO ls_latest WHERE korrnum = i_korrnum.
        EXIT.
      ENDLOOP.
      IF ls_latest IS INITIAL.
        RETURN.
      ENDIF.
    ENDIF.

    DATA ls_prior LIKE ls_latest.
    LOOP AT it_versions INTO ls_prior
      WHERE versno < ls_latest-versno AND trfunction = 'K'.
      EXIT.
    ENDLOOP.
    IF ls_prior IS INITIAL.
      result = abap_true.
      RETURN.
    ENDIF.

    DATA lt_new TYPE abaptxt255_tab.
    DATA lt_old TYPE abaptxt255_tab.
    IF i_type = 'DDLS'.
      lt_new = zcl_vx_version=>load_ddls_source( i_objname = i_name i_versno = ls_latest-versno ).
      lt_old = zcl_vx_version=>load_ddls_source( i_objname = i_name i_versno = ls_prior-versno ).
    ELSE.
      DATA lt_trdir TYPE trdir_it.
      CALL FUNCTION 'SVRS_GET_REPS_FROM_OBJECT'
        EXPORTING object_name = i_name object_type = i_type
                  versno      = zcl_vx_versno=>to_internal( ls_latest-versno )
        TABLES    repos_tab   = lt_new trdir_tab = lt_trdir
        EXCEPTIONS no_version = 1 OTHERS = 2.
      IF sy-subrc <> 0. CLEAR lt_new. ENDIF.
      CALL FUNCTION 'SVRS_GET_REPS_FROM_OBJECT'
        EXPORTING object_name = i_name object_type = i_type
                  versno      = zcl_vx_versno=>to_internal( ls_prior-versno )
        TABLES    repos_tab   = lt_old trdir_tab = lt_trdir
        EXCEPTIONS no_version = 1 OTHERS = 2.
      IF sy-subrc <> 0. CLEAR lt_old. ENDIF.
    ENDIF.

    IF i_ignore_case = abap_false.
      result = boolc( lt_new <> lt_old ).
      RETURN.
    ENDIF.

    DATA(lt_diff) = zcl_vx_diff=>compute_diff(
      it_old        = lt_old
      it_new        = lt_new
      i_title       = |Checking changed object { i_type } { i_name }|
      i_confirm_key = |CHECK~{ i_type }~{ i_name }|
      i_ignore_case = abap_true ).

    LOOP AT lt_diff TRANSPORTING NO FIELDS WHERE op = '+' OR op = '-'.
      result = abap_true.
      RETURN.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
