CLASS zcl_vx_version_list DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    TYPES ty_version_row TYPE zif_vx_vers_types=>ty_version_row.
    TYPES ty_t_version_row TYPE zif_vx_vers_types=>ty_t_version_row.

    TYPES:
      BEGIN OF ty_result,
        versions       TYPE ty_t_version_row,
        creator        TYPE versuser,
        new_version    TYPE ty_version_row,
        old_version    TYPE ty_version_row,
        remote_version TYPE ty_version_row,
        "! Baseline of the RETROFIT comparison alone — the newest local version
        "! whose request the other system already has. Never the review pair:
        "! **the code review must not differ by one character depending on
        "! whether a remote system was entered.** It only widens snapshot 1 of
        "! the subtraction, so requests that are still to move are not reported
        "! as divergences of this one.
        "! Initial when no remote system is given, or when nothing of ours was
        "! found in its version directory.
        retro_old_version TYPE ty_version_row,
      END OF ty_result.

    CLASS-METHODS load
      IMPORTING
        iv_objtype               TYPE versobjtyp
        iv_objname               TYPE versobjnam
        iv_date_from             TYPE versdate OPTIONAL
        iv_remove_dup            TYPE abap_bool DEFAULT abap_false
        iv_no_toc                TYPE abap_bool DEFAULT abap_true
        iv_ignore_case           TYPE abap_bool DEFAULT abap_true
        iv_filter_korrnum        TYPE trkorr OPTIONAL
        it_filter_korrnums       TYPE zif_vx_object=>ty_t_korr_range OPTIONAL
        it_filter_parent_korrnums TYPE zif_vx_object=>ty_t_korr_range OPTIONAL
        iv_system                TYPE verssysnam OPTIONAL
        "! Put the remote baseline row into RESULT-VERSIONS as well. True for the
        "! Version Explorer, where it is a row you can diff a local version
        "! against. False for Code Review, which only needs it as the retrofit
        "! baseline and gets it from RESULT-REMOTE_VERSION: in the list it is a
        "! foreign row among this system's history, and everything walking that
        "! list — the blame replay above all — has to know to step over it.
        iv_remote_in_list        TYPE abap_bool DEFAULT abap_true
        "! No request scope (package / plain object Code Review): pair the current
        "! state against the version of the last RELEASED transport.
        iv_pair_released         TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(result)            TYPE ty_result.

    "! Lightweight pair loader for batch scenarios (Observer quick diff).
    "! Reads VRSD directly — no zcl_vx_version construction, no metadata enrichment.
    "! Returns only new_version / old_version; versions list is left empty.
    CLASS-METHODS load_light
      IMPORTING
        iv_objtype        TYPE versobjtyp
        iv_objname        TYPE versobjnam
        iv_filter_korrnum TYPE trkorr
      RETURNING
        VALUE(result)     TYPE ty_result.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_rel_cache,
        korrnum  TYPE trkorr,
        released TYPE abap_bool,
      END OF ty_rel_cache.
    CLASS-DATA gt_rel_cache TYPE HASHED TABLE OF ty_rel_cache WITH UNIQUE KEY korrnum.

    "! True when the request of a version is released — either the request itself
    "! or (for an S/R task or a T-copy) the K request it belongs to. E070-TRSTATUS
    "! 'R' = released, 'N' = released with import protection.
    CLASS-METHODS is_released_korr
      IMPORTING
        iv_korrnum    TYPE clike
      RETURNING
        VALUE(result) TYPE abap_bool.

    CLASS-METHODS map_to_e071_key
      IMPORTING
        iv_objtype     TYPE versobjtyp
        iv_objname     TYPE versobjnam
      EXPORTING
        ev_object      TYPE e071-object
        ev_obj_name    TYPE e071-obj_name.

    TYPES ty_t_scope_korr TYPE SORTED TABLE OF trkorr WITH UNIQUE KEY table_line.

    "! True when the request of a version belongs to the selected scope even
    "! though its korrnum is not one of the selected keys: a transport of copies
    "! carries the request's content under its own number, an S/R task under the
    "! task number. ZCL_VX_REQUEST=>RESOLVE_PARENT_K maps all of them back.
    "! Written for the T case — a ToC created after the request's own version is
    "! the newer end state of that very change, not a foreign transport, and
    "! comparing korrnums directly hides it.
    CLASS-METHODS korr_resolves_into_scope
      IMPORTING
        iv_korrnum    TYPE clike
        it_scope      TYPE ty_t_scope_korr
      RETURNING
        VALUE(result) TYPE abap_bool.
ENDCLASS.


CLASS zcl_vx_version_list IMPLEMENTATION.

  METHOD load.
    CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
      EXPORTING
        percentage = 0
        text       = CONV char70( |Loading versions for { iv_objtype } { iv_objname }| ).

    TRY.
        DATA(lo_vrsd) = NEW zcl_vx_vrsd(
          type      = iv_objtype
          name      = iv_objname
          no_toc    = abap_false
          date_from = iv_date_from ).
      CATCH zcx_vx.
        RETURN.
    ENDTRY.

    DATA(lv_vrsd_total) = lines( lo_vrsd->vrsd_list ).
    LOOP AT lo_vrsd->vrsd_list INTO DATA(ls_vrsd).
      IF sy-tabix = 1 OR sy-tabix = lv_vrsd_total OR sy-tabix MOD 10 = 0.
        CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
          EXPORTING
            percentage = CONV i( sy-tabix * 20 / COND i( WHEN lv_vrsd_total > 0 THEN lv_vrsd_total ELSE 1 ) )
            text       = CONV char70( |Reading version metadata ({ sy-tabix }/{ lv_vrsd_total })| ).
      ENDIF.

      TRY.
          DATA(lo_ver) = NEW zcl_vx_version( ls_vrsd ).
          APPEND VALUE ty_version_row(
            versno         = lo_ver->version_number
            versno_text    = COND #( WHEN lo_ver->version_number = zcl_vx_version=>c_version-active
                                     THEN 'Active'
                                     ELSE CONV string( lo_ver->version_number + 0 ) )
            datum          = lo_ver->date
            zeit           = lo_ver->time
            author         = ls_vrsd-author
            author_name    = zcl_vx_vers_data=>get_user_name( ls_vrsd-author )
            obj_owner      = lo_ver->author
            obj_owner_name = lo_ver->author_name
            korrnum        = lo_ver->request
            task           = lo_ver->task
            objtype        = lo_ver->objtype
            objname        = lo_ver->objname ) TO result-versions.
        CATCH zcx_vx.
      ENDTRY.
    ENDLOOP.

    SORT result-versions BY versno DESCENDING datum DESCENDING zeit DESCENDING.

    DATA lv_seen_active TYPE abap_bool.
    DATA lv_seen_modified TYPE abap_bool.
    DATA lv_active_idx TYPE i VALUE 1.
    DATA lv_modified_idx TYPE i VALUE 1.
    LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<vr>).
      IF <vr>-versno = zcl_vx_version=>c_version-active.
        IF lv_seen_active = abap_true.
          <vr>-versno_text = |Active ({ lv_active_idx })|.
          lv_active_idx = lv_active_idx + 1.
        ELSE.
          lv_seen_active = abap_true.
        ENDIF.
      ELSEIF <vr>-versno = zcl_vx_version=>c_version-modified.
        IF lv_seen_modified = abap_true.
          <vr>-versno_text = |Modified ({ lv_modified_idx })|.
          lv_modified_idx = lv_modified_idx + 1.
        ELSE.
          lv_seen_modified = abap_true.
        ENDIF.
      ENDIF.
    ENDLOOP.

    LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<ver_trf>).
      CHECK <ver_trf>-korrnum IS NOT INITIAL AND <ver_trf>-trfunction IS INITIAL.
      <ver_trf>-trfunction = zcl_vx_request=>get_header( CONV #( <ver_trf>-korrnum ) )-trfunction.
      LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<ver_trf2>)
        WHERE korrnum = <ver_trf>-korrnum AND trfunction IS INITIAL.
        <ver_trf2>-trfunction = <ver_trf>-trfunction.
      ENDLOOP.
    ENDLOOP.

    TYPES:
      BEGIN OF ty_obj_key,
        object   TYPE e071-object,
        obj_name TYPE e071-obj_name,
      END OF ty_obj_key.
    TYPES:
      BEGIN OF ty_task_cand,
        trkorr  TYPE trkorr,
        strkorr TYPE trkorr,
        as4user TYPE as4user,
        as4date TYPE as4date,
        as4time TYPE as4time,
      END OF ty_task_cand.
    TYPES:
      BEGIN OF ty_korr_key,
        korrnum TYPE trkorr,
      END OF ty_korr_key.
    TYPES:
      BEGIN OF ty_task_date,
        trkorr  TYPE trkorr,
        as4date TYPE e070-as4date,
        as4time TYPE e070-as4time,
      END OF ty_task_date.

    DATA lt_keys TYPE SORTED TABLE OF ty_obj_key WITH UNIQUE KEY object obj_name.
    DATA lt_all_tasks TYPE STANDARD TABLE OF ty_task_cand.
    DATA lt_request_tasks TYPE STANDARD TABLE OF ty_task_cand.
    DATA lt_korr_keys TYPE SORTED TABLE OF ty_korr_key WITH UNIQUE KEY korrnum.
    DATA lv_e071_type TYPE e071-object.
    DATA lv_e071_name TYPE e071-obj_name.

    map_to_e071_key(
      EXPORTING
        iv_objtype  = iv_objtype
        iv_objname  = iv_objname
      IMPORTING
        ev_object   = lv_e071_type
        ev_obj_name = lv_e071_name ).

    INSERT VALUE #( object = lv_e071_type obj_name = lv_e071_name ) INTO TABLE lt_keys.
    IF lv_e071_type = 'PROG'.
      INSERT VALUE #( object = 'REPS' obj_name = lv_e071_name ) INTO TABLE lt_keys.
    ELSEIF lv_e071_type = 'REPS'.
      INSERT VALUE #( object = 'PROG' obj_name = lv_e071_name ) INTO TABLE lt_keys.
    ENDIF.

    CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
      EXPORTING
        percentage = 35
        text       = CONV char70( |Reading S-requests for { iv_objtype } { iv_objname }| ).

    " A K can carry both S (task) and R (repair) child requests — match either.
    DATA lt_trf_task_types TYPE RANGE OF e070-trfunction.
    lt_trf_task_types = VALUE #(
      ( sign = 'I' option = 'EQ' low = 'S' )
      ( sign = 'I' option = 'EQ' low = 'R' ) ).
    " Build lt_korr_keys from the K/T requests selected on the selection screen.
    " Request headers come from the cached reader: LOAD runs once per reviewed
    " part, so without the cache these lookups repeat for every object.
    IF iv_filter_korrnum IS NOT INITIAL.
      DATA(lv_fkv_trf) = zcl_vx_request=>get_header( iv_filter_korrnum )-trfunction.
      IF lv_fkv_trf = 'K' OR lv_fkv_trf = 'T'.
        INSERT VALUE #( korrnum = iv_filter_korrnum ) INTO TABLE lt_korr_keys.
      ENDIF.
    ENDIF.
    LOOP AT it_filter_korrnums INTO DATA(ls_fk) WHERE sign = 'I' AND option = 'EQ' AND low IS NOT INITIAL.
      DATA(lv_fk_trf) = zcl_vx_request=>get_header( CONV #( ls_fk-low ) )-trfunction.
      IF lv_fk_trf = 'K' OR lv_fk_trf = 'T'.
        INSERT VALUE #( korrnum = ls_fk-low ) INTO TABLE lt_korr_keys.
      ENDIF.
    ENDLOOP.
    LOOP AT it_filter_parent_korrnums INTO DATA(ls_pk) WHERE sign = 'I' AND option = 'EQ' AND low IS NOT INITIAL.
      DATA(lv_pk_trf) = zcl_vx_request=>get_header( CONV #( ls_pk-low ) )-trfunction.
      IF lv_pk_trf = 'K' OR lv_pk_trf = 'T'.
        INSERT VALUE #( korrnum = ls_pk-low ) INTO TABLE lt_korr_keys.
      ENDIF.
    ENDLOOP.

    " No selection-screen filter (plain Version Explorer): use every K-version in
    " the list as scope, so S/R-tasks can still be resolved for K- and T-versions.
    IF lt_korr_keys IS INITIAL.
      LOOP AT result-versions INTO DATA(ls_k_ver)
        WHERE trfunction = 'K' AND korrnum IS NOT INITIAL.
        INSERT VALUE #( korrnum = ls_k_ver-korrnum ) INTO TABLE lt_korr_keys.
      ENDLOOP.
    ENDIF.

    " All S/R-children of the selected K-request(s).
    IF lt_korr_keys IS NOT INITIAL.
      SELECT trkorr, strkorr, as4user, as4date, as4time
        FROM e070
        FOR ALL ENTRIES IN @lt_korr_keys
        WHERE strkorr    = @lt_korr_keys-korrnum
          AND trfunction IN @lt_trf_task_types
        INTO CORRESPONDING FIELDS OF TABLE @lt_request_tasks.
      SORT lt_request_tasks BY as4date DESCENDING as4time DESCENDING.
    ENDIF.

    " Candidate authoring tasks: ONLY the S/R-children of the selected K that
    " actually carry THIS object in E071 — either per-method (LIMU METH) or, when
    " the class was regenerated as a whole, at class level (R3TR CLAS). A task that
    " does not contain the object is never a candidate (spec: S/R must belong to the
    " selected K and contain the analysed object).
    DATA lt_obj_keys LIKE lt_keys.
    lt_obj_keys = lt_keys.
    IF lv_e071_type = 'METH'.
      INSERT VALUE #( object = 'CLAS' obj_name = CONV e071-obj_name( lv_e071_name(30) ) )
        INTO TABLE lt_obj_keys.
    ELSEIF lv_e071_type = 'CPUB' OR lv_e071_type = 'CPRO'
        OR lv_e071_type = 'CPRI' OR lv_e071_type = 'CDEF'.
      " Class section parts may be logged at class level (R3TR CLAS) on full
      " regeneration — same CLAS fallback as for methods. ev_obj_name is already
      " reduced to the class name by map_to_e071_key.
      INSERT VALUE #( object = 'CLAS' obj_name = lv_e071_name )
        INTO TABLE lt_obj_keys.
    ENDIF.
    DATA lr_scope_tasks TYPE RANGE OF trkorr.
    LOOP AT lt_request_tasks INTO DATA(ls_scope_task).
      APPEND VALUE #( sign = 'I' option = 'EQ' low = ls_scope_task-trkorr ) TO lr_scope_tasks.
    ENDLOOP.
    IF lr_scope_tasks IS NOT INITIAL.
      SELECT e070~trkorr, e070~strkorr, e070~as4user, e070~as4date, e070~as4time
        FROM e071
        INNER JOIN e070 ON e070~trkorr = e071~trkorr
        FOR ALL ENTRIES IN @lt_obj_keys
        WHERE e071~object   = @lt_obj_keys-object
          AND e071~obj_name = @lt_obj_keys-obj_name
          AND e070~trkorr  IN @lr_scope_tasks
        INTO TABLE @lt_all_tasks.
      SORT lt_all_tasks BY trkorr.
      DELETE ADJACENT DUPLICATES FROM lt_all_tasks COMPARING trkorr.
      SORT lt_all_tasks BY as4date DESCENDING as4time DESCENDING.
    ENDIF.

    DATA(lv_match_total) = lines( result-versions ).
    LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<ver>).
      IF sy-tabix = 1 OR sy-tabix = lv_match_total OR sy-tabix MOD 10 = 0.
        CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
          EXPORTING
            percentage = 35 + CONV i( sy-tabix * 25 / COND i( WHEN lv_match_total > 0 THEN lv_match_total ELSE 1 ) )
            text       = CONV char70( |Matching S-request ({ sy-tabix }/{ lv_match_total })| ).
      ENDIF.

      " The version was recorded under the task itself — no matching needed, and in
      " particular no date comparison. This must cover R the same as S: an R-task
      " carries an unusable date, so letting an R-version fall through to the
      " date-based branches below leaves it without task and owner.
      IF <ver>-trfunction = 'S' OR <ver>-trfunction = 'R'.
        <ver>-task = <ver>-korrnum.
        " ...and the owner of that task, which the line above used to leave
        " empty although the comment already claimed otherwise. The task is the
        " authoritative answer to "who works on this object in this request";
        " without it the attribution falls through to the version author, and
        " for an Active row that is whoever last activated the object — which in
        " a ChaRM landscape is regularly a developer who never touched it, and
        " the whole object was then credited to them.
        READ TABLE lt_all_tasks INTO DATA(ls_sr_task)
          WITH KEY trkorr = CONV trkorr( <ver>-korrnum ).
        IF sy-subrc <> 0.
          " Not among the tasks carrying this object (the version may predate the
          " current E071 content) — the request's own task list still names it.
          READ TABLE lt_request_tasks INTO ls_sr_task
            WITH KEY trkorr = CONV trkorr( <ver>-korrnum ).
        ENDIF.
        IF sy-subrc = 0 AND ls_sr_task-as4user IS NOT INITIAL.
          <ver>-obj_owner      = ls_sr_task-as4user.
          <ver>-obj_owner_name = zcl_vx_vers_data=>get_user_name( ls_sr_task-as4user ).
        ENDIF.
        CONTINUE.
      ENDIF.

      " For a T-copy: the T's E071 CORR/MERG entries name the MAIN request (a K) it was
      " merged from — the first 10 chars of obj_name are that K. Restrict the candidates
      " to all S/R-tasks subordinate to that K, prefer those that actually carry this
      " object, then pick the nearest preceding one by date/time. A single candidate is
      " taken as-is (R-tasks may carry an unusable date, so we do not drop the only one).
      IF <ver>-trfunction = 'T'.
        IF <ver>-korrnum IS NOT INITIAL.
          SELECT obj_name FROM e071
            WHERE trkorr = @<ver>-korrnum
              AND pgmid  = 'CORR'
              AND object = 'MERG'
            INTO TABLE @DATA(lt_merg_obj).

          " The K-request(s) named in CORR/MERG.
          DATA lr_merg_k TYPE RANGE OF trkorr.
          CLEAR lr_merg_k.
          LOOP AT lt_merg_obj INTO DATA(lv_merg_obj).
            APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_merg_obj+0(10) ) TO lr_merg_k.
          ENDLOOP.

          DATA lt_merg_cand TYPE STANDARD TABLE OF ty_task_cand.
          CLEAR lt_merg_cand.
          IF lr_merg_k IS NOT INITIAL.
            " Only S/R-tasks subordinate to the CORR/MERG K that carry THIS object
            " (per-method LIMU METH, or class-level R3TR CLAS on full regeneration).
            SELECT e070~trkorr, e070~strkorr, e070~as4user, e070~as4date, e070~as4time
              FROM e071
              INNER JOIN e070 ON e070~trkorr = e071~trkorr
              FOR ALL ENTRIES IN @lt_obj_keys
              WHERE e071~object   = @lt_obj_keys-object
                AND e071~obj_name = @lt_obj_keys-obj_name
                AND e070~strkorr IN @lr_merg_k
                AND e070~trfunction IN @lt_trf_task_types
              INTO TABLE @lt_merg_cand.
            SORT lt_merg_cand BY trkorr.
            DELETE ADJACENT DUPLICATES FROM lt_merg_cand COMPARING trkorr.
            SORT lt_merg_cand BY as4date DESCENDING as4time DESCENDING.
          ENDIF.

          " Pick the nearest preceding candidate by date/time. Date IS meaningful for
          " S-tasks (correct timestamps), so this selects the right S. R-tasks carry a
          " date/time in the FUTURE and will fail this check — when nothing precedes
          " (e.g. only an R remains), fall back to the newest candidate so the R is
          " still taken (the set is already constrained to the CORR/MERG K + object).
          DATA(ls_merg_pick) = VALUE ty_task_cand( ).
          LOOP AT lt_merg_cand INTO DATA(ls_merg_c).
            CHECK ls_merg_c-as4date < <ver>-datum
               OR ( ls_merg_c-as4date = <ver>-datum AND ls_merg_c-as4time <= <ver>-zeit ).
            ls_merg_pick = ls_merg_c.
            EXIT.
          ENDLOOP.
          IF ls_merg_pick IS INITIAL.
            READ TABLE lt_merg_cand INTO ls_merg_pick INDEX 1.
          ENDIF.

          IF ls_merg_pick IS NOT INITIAL.
            <ver>-task           = ls_merg_pick-trkorr.
            <ver>-obj_owner      = ls_merg_pick-as4user.
            <ver>-obj_owner_name = zcl_vx_vers_data=>get_user_name( ls_merg_pick-as4user ).
          ENDIF.
        ENDIF.
        " T is resolved only from S/R subordinate to its CORR/MERG K — never arbitrary tasks.
        CONTINUE.
      ENDIF.

      " For a K-version: prefer the candidate task that is a direct child of this K.
      IF <ver>-trfunction = 'K' AND <ver>-korrnum IS NOT INITIAL.
        LOOP AT lt_all_tasks INTO DATA(ls_k_task) WHERE strkorr = <ver>-korrnum.
          <ver>-task           = ls_k_task-trkorr.
          <ver>-obj_owner      = ls_k_task-as4user.
          <ver>-obj_owner_name = zcl_vx_vers_data=>get_user_name( ls_k_task-as4user ).
          EXIT.
        ENDLOOP.
        IF <ver>-task IS NOT INITIAL.
          CONTINUE.
        ENDIF.
      ENDIF.

      " **A version with no KORRNUM has no request, and nobody may lend it one.**
      " Everything below this point matches the version against LT_ALL_TASKS — the
      " S/R children of the *selected* K that carry this object — and neither of the
      " two loops can tell such a version apart: their only guard fires for
      " TRFUNCTION = 'K', which a version without a request does not have either.
      " v1 of a class, written before the object was ever put into a transport,
      " therefore took the newest task of the reviewed request, and LT_ALL_TASKS
      " holds exactly one candidate as soon as that request carries the class at
      " all (R3TR CLAS is the key added for METH and the section parts above). The
      " 2023 version then counted as ours: it was the only numbered version "in
      " scope", so it became the NEW endpoint, nothing sits below v1 to serve as a
      " baseline, and the review reported the whole 2023 source as code newly
      " written by a 2026 request — for every part of the class at once.
      " Its legitimate route stays open: the ALT_KORRNUMS block below asks the SVRS
      " directory which request recorded the version *here*, and it only considers
      " versions whose task is still empty.
      CHECK <ver>-korrnum IS NOT INITIAL.

      " Nearest preceding candidate by date/time (K-versions only — S and T already
      " handled above). lt_all_tasks holds only S/R-children of the selected K that
      " contain this object, so any match here is guaranteed relevant.
      LOOP AT lt_all_tasks INTO DATA(ls_cand).
        CHECK ls_cand-as4date < <ver>-datum
           OR ( ls_cand-as4date = <ver>-datum AND ls_cand-as4time <= <ver>-zeit ).
        " KEEP (replaced): the parent constraint was asked only of a K —
        "   IF <ver>-trfunction = 'K' AND ls_cand-strkorr <> <ver>-korrnum.
        " A version whose request is not in E070 has no TRFUNCTION either: an
        " imported version carries the request of the system it was made in
        " (an ER4 number in an ER6 system), so the guard never fired and the
        " version could be handed a task of the *reviewed* request instead —
        " LT_ALL_TASKS holds nothing else. A task is only ever an answer for
        " the request it belongs to, whatever the version's TRFUNCTION says.
        IF ls_cand-strkorr <> <ver>-korrnum.
          CONTINUE.
        ENDIF.
        <ver>-task           = ls_cand-trkorr.
        <ver>-obj_owner      = ls_cand-as4user.
        <ver>-obj_owner_name = zcl_vx_vers_data=>get_user_name( ls_cand-as4user ).
        EXIT.
      ENDLOOP.

      " Same fallback as in the T-branch above: nothing precedes the version by date.
      " E070-AS4DATE is the request header's last-changed stamp, not the moment the
      " object entered the task, so a long-lived task (typically an R) carries a date
      " past its own versions and never wins the comparison. Take the newest candidate
      " instead — lt_all_tasks only holds S/R-children of the selected K that contain
      " this object, and the K-parent constraint is re-applied here.
      IF <ver>-task IS INITIAL.
        LOOP AT lt_all_tasks INTO DATA(ls_fb_cand).
          " KEEP (replaced): as above, the constraint was asked only of a K —
          "   IF <ver>-trfunction = 'K' AND ls_fb_cand-strkorr <> <ver>-korrnum.
          " This loop drops the date comparison, so it was the one that could
          " claim any version for the reviewed request. It keeps its purpose —
          " an R task carries a date past its own versions — because such a
          " task is a child of the version's own K and passes the guard.
          IF ls_fb_cand-strkorr <> <ver>-korrnum.
            CONTINUE.
          ENDIF.
          <ver>-task           = ls_fb_cand-trkorr.
          <ver>-obj_owner      = ls_fb_cand-as4user.
          <ver>-obj_owner_name = zcl_vx_vers_data=>get_user_name( ls_fb_cand-as4user ).
          EXIT.
        ENDLOOP.
      ENDIF.
    ENDLOOP.

    " A version that came in with an import carries the request of the system it
    " was made in (an ER4 number in an ER6 system), and no local task can be found
    " for it — the K it names has no tasks here. The SVRS directory, which is what
    " SE80 lists, names the local request that recorded the version instead. When
    " that is one of our tasks, the version is our change carried on here, not a
    " foreign one, so it is taken as the version's task and matched against the
    " scope like any other.
    LOOP AT lo_vrsd->alt_korrnums INTO DATA(ls_alt_korr).
      READ TABLE result-versions ASSIGNING FIELD-SYMBOL(<ver_alt>)
        WITH KEY versno = ls_alt_korr-versno.
      CHECK sy-subrc = 0 AND <ver_alt>-task IS INITIAL.
      DATA(ls_alt_hdr) = zcl_vx_request=>get_header( ls_alt_korr-korrnum ).
      CHECK ls_alt_hdr-found = abap_true.
      IF ls_alt_hdr-trfunction = 'S' OR ls_alt_hdr-trfunction = 'R'.
        <ver_alt>-task = ls_alt_korr-korrnum.
      ENDIF.
    ENDLOOP.

    IF iv_filter_korrnum IS NOT INITIAL
       OR it_filter_parent_korrnums IS NOT INITIAL
       OR it_filter_korrnums IS NOT INITIAL.
      TYPES:
        BEGIN OF ty_version_work,
          row      TYPE ty_version_row,
          req      TYPE trkorr,
          as4date  TYPE e070-as4date,
          as4time  TYPE e070-as4time,
          selected TYPE abap_bool,
        END OF ty_version_work.
      DATA lt_selected_keys TYPE SORTED TABLE OF ty_korr_key WITH UNIQUE KEY korrnum.
      DATA lt_parent_keys TYPE SORTED TABLE OF ty_korr_key WITH UNIQUE KEY korrnum.
      DATA lt_parent_tasks TYPE STANDARD TABLE OF ty_task_date.
      DATA lt_selected_tasks TYPE STANDARD TABLE OF ty_task_date WITH DEFAULT KEY.
      DATA lt_work TYPE STANDARD TABLE OF ty_version_work WITH DEFAULT KEY.
      DATA lt_filtered_versions TYPE ty_t_version_row.
      DATA lv_low_date TYPE e070-as4date.
      DATA lv_low_time TYPE e070-as4time.
      DATA lv_high_date TYPE e070-as4date.
      DATA lv_high_time TYPE e070-as4time.
      DATA lv_selected_kept TYPE abap_bool.
      DATA lv_previous_kept TYPE abap_bool.
      DATA lv_selected_top_versno TYPE versno.
      DATA lv_is_s_selection TYPE abap_bool.   " selected request is an S/R task

      IF iv_filter_korrnum IS NOT INITIAL.
        DATA(ls_single_filter_hdr) = zcl_vx_request=>get_header( iv_filter_korrnum ).
        DATA(lv_single_filter_trf) = ls_single_filter_hdr-trfunction.
        DATA(lv_single_filter_parent) = ls_single_filter_hdr-strkorr.
        IF ls_single_filter_hdr-found = abap_true.
          IF lv_single_filter_trf = 'S' OR lv_single_filter_trf = 'R'.
            lv_is_s_selection = abap_true.
            INSERT VALUE #( korrnum = iv_filter_korrnum ) INTO TABLE lt_selected_keys.
            IF lv_single_filter_parent IS NOT INITIAL.
              INSERT VALUE #( korrnum = lv_single_filter_parent ) INTO TABLE lt_parent_keys.
            ENDIF.
          ELSEIF lv_single_filter_trf = 'K'.
            INSERT VALUE #( korrnum = iv_filter_korrnum ) INTO TABLE lt_selected_keys.
            INSERT VALUE #( korrnum = iv_filter_korrnum ) INTO TABLE lt_parent_keys.
          ELSEIF lv_single_filter_trf = 'T'.
            INSERT VALUE #( korrnum = iv_filter_korrnum ) INTO TABLE lt_selected_keys.
          ENDIF.
        ENDIF.
      ENDIF.

      LOOP AT it_filter_korrnums INTO DATA(ls_filter_korrnum)
        WHERE sign = 'I' AND option = 'EQ' AND low IS NOT INITIAL.
        DATA(ls_filter_hdr) = zcl_vx_request=>get_header( CONV #( ls_filter_korrnum-low ) ).
        DATA(lv_filter_trf) = ls_filter_hdr-trfunction.
        DATA(lv_filter_parent) = ls_filter_hdr-strkorr.
        CHECK ls_filter_hdr-found = abap_true.
        IF lv_filter_trf = 'S' OR lv_filter_trf = 'R'.
          lv_is_s_selection = abap_true.
          INSERT VALUE #( korrnum = ls_filter_korrnum-low ) INTO TABLE lt_selected_keys.
          IF lv_filter_parent IS NOT INITIAL.
            INSERT VALUE #( korrnum = lv_filter_parent ) INTO TABLE lt_parent_keys.
          ENDIF.
        ELSEIF lv_filter_trf = 'K'.
          INSERT VALUE #( korrnum = ls_filter_korrnum-low ) INTO TABLE lt_selected_keys.
          INSERT VALUE #( korrnum = ls_filter_korrnum-low ) INTO TABLE lt_parent_keys.
        ELSEIF lv_filter_trf = 'T'.
          INSERT VALUE #( korrnum = ls_filter_korrnum-low ) INTO TABLE lt_selected_keys.
        ENDIF.
      ENDLOOP.

      LOOP AT it_filter_parent_korrnums INTO DATA(ls_parent_filter)
        WHERE sign = 'I' AND option = 'EQ' AND low IS NOT INITIAL.
        DATA(ls_parent_filter_hdr) = zcl_vx_request=>get_header( CONV #( ls_parent_filter-low ) ).
        IF ls_parent_filter_hdr-found = abap_true AND ls_parent_filter_hdr-trfunction = 'T'.
          INSERT VALUE #( korrnum = ls_parent_filter-low ) INTO TABLE lt_selected_keys.
        ELSE.
          INSERT VALUE #( korrnum = ls_parent_filter-low ) INTO TABLE lt_parent_keys.
        ENDIF.
      ENDLOOP.

      IF lt_parent_keys IS NOT INITIAL.
        SELECT trkorr, as4date, as4time
          FROM e070
          FOR ALL ENTRIES IN @lt_parent_keys
          WHERE strkorr = @lt_parent_keys-korrnum
            AND trfunction IN @lt_trf_task_types
          INTO TABLE @lt_parent_tasks.
        SORT lt_parent_tasks BY as4date ASCENDING as4time ASCENDING.
        READ TABLE lt_parent_tasks INTO DATA(ls_low_task) INDEX 1.
        IF sy-subrc = 0.
          lv_low_date = ls_low_task-as4date.
          lv_low_time = ls_low_task-as4time.
        ENDIF.
      ENDIF.

      " Set of S/R-child tasks of the selected K. A version whose -task is one of
      " these is part of our change (in scope) even if its own request (e.g. a T-copy)
      " is not directly selected — this matches the broader scope used by the code
      " reviewer, so the retained baseline is a truly older, out-of-scope version.
      DATA lt_scope_child_tasks TYPE SORTED TABLE OF trkorr WITH UNIQUE KEY table_line.
      LOOP AT lt_parent_tasks INTO DATA(ls_scope_child).
        INSERT ls_scope_child-trkorr INTO TABLE lt_scope_child_tasks.
      ENDLOOP.

      IF lt_selected_keys IS INITIAL.
        LOOP AT lt_parent_tasks INTO DATA(ls_parent_task).
          INSERT VALUE #( korrnum = ls_parent_task-trkorr ) INTO TABLE lt_selected_keys.
        ENDLOOP.
      ENDIF.

      " Every request number the selection stands for, in one set: what a version
      " korrnum is checked against when it does not match any of them directly —
      " a transport of copies resolves to the K it was merged from.
      DATA lt_scope_korr TYPE ty_t_scope_korr.
      LOOP AT lt_selected_keys INTO DATA(ls_scope_sel).
        INSERT ls_scope_sel-korrnum INTO TABLE lt_scope_korr.
      ENDLOOP.
      LOOP AT lt_parent_keys INTO DATA(ls_scope_par).
        INSERT ls_scope_par-korrnum INTO TABLE lt_scope_korr.
      ENDLOOP.
      LOOP AT lt_scope_child_tasks INTO DATA(lv_scope_task).
        INSERT lv_scope_task INTO TABLE lt_scope_korr.
      ENDLOOP.

      IF lt_selected_keys IS NOT INITIAL.
        SELECT trkorr, as4date, as4time
          FROM e070
          FOR ALL ENTRIES IN @lt_selected_keys
          WHERE trkorr = @lt_selected_keys-korrnum
          INTO TABLE @lt_selected_tasks.
        SORT lt_selected_tasks BY as4date ASCENDING as4time ASCENDING.
        IF lv_low_date IS INITIAL.
          READ TABLE lt_selected_tasks INTO DATA(ls_low_selected) INDEX 1.
          IF sy-subrc = 0.
            lv_low_date = ls_low_selected-as4date.
            lv_low_time = ls_low_selected-as4time.
          ENDIF.
        ENDIF.
        READ TABLE lt_selected_tasks INTO DATA(ls_high_task) INDEX lines( lt_selected_tasks ).
        IF sy-subrc = 0.
          lv_high_date = ls_high_task-as4date.
          lv_high_time = ls_high_task-as4time.
        ENDIF.
      ENDIF.

      IF lv_is_s_selection = abap_true.
        " S/R task selected: do NOT trim by scope/date. The S carries its change
        " in the Active source (often not yet released, so no numbered version is
        " "in scope"). Keep the full history untouched — the pair selection then
        " takes Active as the new endpoint and the nearest K as baseline.
      ELSEIF lv_low_date IS NOT INITIAL AND lv_high_date IS NOT INITIAL.
        LOOP AT result-versions INTO DATA(ls_ver).
          DATA(lv_req) = COND trkorr(
            WHEN ls_ver-trfunction = 'K' OR ls_ver-trfunction = 'T'
            THEN CONV trkorr( ls_ver-korrnum )
            WHEN ls_ver-korrnum IS NOT INITIAL
             AND line_exists( lt_selected_keys[ korrnum = CONV trkorr( ls_ver-korrnum ) ] )
            THEN CONV trkorr( ls_ver-korrnum )
            WHEN ls_ver-task IS NOT INITIAL THEN CONV trkorr( ls_ver-task )
            ELSE CONV trkorr( ls_ver-korrnum ) ).
          DATA(lv_req_date) = CONV e070-as4date( ls_ver-datum ).
          DATA(lv_req_time) = CONV e070-as4time( ls_ver-zeit ).
          DATA(lv_is_selected) = xsdbool(
            line_exists( lt_selected_keys[ korrnum = lv_req ] )
            OR ( ls_ver-korrnum IS NOT INITIAL
             AND line_exists( lt_selected_keys[ korrnum = CONV trkorr( ls_ver-korrnum ) ] ) )
            OR ( ls_ver-task IS NOT INITIAL
             AND line_exists( lt_scope_child_tasks[ table_line = CONV trkorr( ls_ver-task ) ] ) )
            " ...and the request's own transports of copies, whose korrnum matches
            " nothing above. Without this a ToC written AFTER the request's own
            " version is not "selected", so the version trimming drops it as newer
            " than the scope and the review ends one version too early.
            OR korr_resolves_into_scope( iv_korrnum = ls_ver-korrnum
                                         it_scope   = lt_scope_korr ) ).
          APPEND VALUE #(
            row      = ls_ver
            req      = lv_req
            as4date  = lv_req_date
            as4time  = lv_req_time
            selected = lv_is_selected )
            TO lt_work.
          IF lv_is_selected = abap_true
             AND ( lv_selected_top_versno IS INITIAL OR ls_ver-versno > lv_selected_top_versno ).
            lv_selected_top_versno = ls_ver-versno.
          ENDIF.
        ENDLOOP.
        SORT lt_work BY row-versno DESCENDING as4date DESCENDING as4time DESCENDING.

        DATA ls_dropped_active TYPE ty_version_row.
        LOOP AT lt_work INTO DATA(ls_work).
          " When a TR filter is active, always drop local Active/Modified pseudo-versions
          " from the display — the remote row already represents the current state.
          " Keep the real Active row aside though: it carries the true author/owner
          " and request, so the pair selection can use it as the NEW endpoint.
          IF ls_work-row-versno = zcl_vx_version=>c_version-active
          OR ls_work-row-versno = zcl_vx_version=>c_version-modified.
            IF ls_dropped_active IS INITIAL.
              ls_dropped_active = ls_work-row.
            ELSEIF ls_dropped_active-versno = zcl_vx_version=>c_version-modified
               AND ls_work-row-versno = zcl_vx_version=>c_version-active.
              ls_dropped_active = ls_work-row.   " prefer Active over Modified
            ENDIF.
            CONTINUE.
          ELSEIF lv_selected_top_versno IS NOT INITIAL
             AND ls_work-row-versno > lv_selected_top_versno.
            CONTINUE.
          ENDIF.
          IF ls_work-selected = abap_true.
            APPEND ls_work-row TO lt_filtered_versions.
            lv_selected_kept = abap_true.
            CONTINUE.
          ENDIF.
          IF ls_work-as4date > lv_high_date
            OR ( ls_work-as4date = lv_high_date AND ls_work-as4time > lv_high_time ).
            CONTINUE.
          ENDIF.
          IF lv_selected_kept = abap_true
             AND ( ls_work-row-trfunction = 'K' OR ls_work-row-trfunction = 'T' )
             AND NOT line_exists( lt_parent_keys[ korrnum = CONV trkorr( ls_work-row-korrnum ) ] )
             AND NOT line_exists( lt_selected_keys[ korrnum = CONV trkorr( ls_work-row-korrnum ) ] )
             AND ( ls_work-row-trfunction <> 'T'
                OR ls_work-row-task IS INITIAL
                OR NOT line_exists( lt_selected_keys[ korrnum = CONV trkorr( ls_work-row-task ) ] ) ).
            APPEND ls_work-row TO lt_filtered_versions.
            lv_previous_kept = abap_true.
            " EXPERIMENT (do not delete): keep scanning past a ToC to also retain a
            " real K below it. Disabled — the first previous version (foreign T or K)
            " is the baseline; we do not dig further for a K.
            "  IF ls_work-row-trfunction = 'K'.
            "    EXIT.
            "  ENDIF.
            EXIT.
          ENDIF.
          IF ls_work-as4date > lv_low_date
            OR ( ls_work-as4date = lv_low_date AND ls_work-as4time >= lv_low_time ).
            APPEND ls_work-row TO lt_filtered_versions.
            lv_selected_kept = abap_true.
            CONTINUE.
          ENDIF.
          IF lv_selected_kept = abap_true
             AND lv_previous_kept = abap_false.
            APPEND ls_work-row TO lt_filtered_versions.
            lv_previous_kept = abap_true.
            EXIT.
          ENDIF.
        ENDLOOP.
        SORT lt_filtered_versions BY versno DESCENDING datum DESCENDING zeit DESCENDING.
        result-versions = lt_filtered_versions.
      ELSEIF lt_parent_keys IS NOT INITIAL OR lt_selected_keys IS NOT INITIAL.
        " Scope is set but no release dates could be derived — this happens when
        " the selected request is NOT yet released (e.g. an open S task: its
        " parent K has no released content). Do NOT wipe the versions: keep the
        " full history so the pair selection can take Active as the new endpoint
        " and find the nearest K as baseline.
        " EXPERIMENT (do not delete): previously this cleared all versions.
        "  CLEAR result-versions.
      ENDIF.
    ENDIF.

    LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<ver_owner_guard>)
      WHERE trfunction = 'K' AND task IS INITIAL.
      <ver_owner_guard>-obj_owner      = <ver_owner_guard>-author.
      <ver_owner_guard>-obj_owner_name = <ver_owner_guard>-author_name.
    ENDLOOP.

    DATA ls_creator_ver TYPE ty_version_row.
    LOOP AT result-versions INTO DATA(ls_creator_scan).
      IF ls_creator_ver IS INITIAL OR ls_creator_scan-versno < ls_creator_ver-versno.
        ls_creator_ver = ls_creator_scan.
      ENDIF.
    ENDLOOP.
    IF ls_creator_ver IS NOT INITIAL.
      result-creator = COND versuser(
        WHEN ls_creator_ver-obj_owner IS NOT INITIAL THEN ls_creator_ver-obj_owner
        ELSE ls_creator_ver-author ).
    ENDIF.

    " Request texts: one read for every request in the list instead of one
    " SELECT SINGLE per version (a long history made that N round trips).
    TYPES: BEGIN OF ty_korr_text,
             trkorr  TYPE trkorr,
             as4text TYPE e07t-as4text,
           END OF ty_korr_text.
    DATA lt_korr_texts TYPE STANDARD TABLE OF ty_korr_text WITH DEFAULT KEY.
    DATA lr_korr_text TYPE RANGE OF trkorr.

    LOOP AT result-versions INTO DATA(ls_korr_scan).
      CHECK ls_korr_scan-korrnum IS NOT INITIAL.
      APPEND VALUE #( sign = 'I' option = 'EQ' low = ls_korr_scan-korrnum ) TO lr_korr_text.
    ENDLOOP.
    SORT lr_korr_text BY low.
    DELETE ADJACENT DUPLICATES FROM lr_korr_text COMPARING low.

    IF lr_korr_text IS NOT INITIAL.
      SELECT trkorr, as4text FROM e07t
        WHERE trkorr IN @lr_korr_text
          AND langu  = @sy-langu
        INTO CORRESPONDING FIELDS OF TABLE @lt_korr_texts.
    ENDIF.

    LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<ver2>).
      CHECK <ver2>-korrnum IS NOT INITIAL.
      READ TABLE lt_korr_texts INTO DATA(ls_korr_text)
        WITH KEY trkorr = <ver2>-korrnum.
      <ver2>-korr_text = COND #( WHEN sy-subrc = 0 THEN ls_korr_text-as4text ELSE `` ).

      IF <ver2>-trfunction IS INITIAL.
        <ver2>-trfunction = zcl_vx_request=>get_header( CONV #( <ver2>-korrnum ) )-trfunction.
      ENDIF.
    ENDLOOP.

    IF iv_remove_dup = abap_true.
      CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
        EXPORTING
          percentage = 70
          text       = CONV char70( |Checking duplicate versions for { iv_objtype } { iv_objname }| ).
      zcl_vx_vers_data=>remove_duplicate_versions(
        EXPORTING
          i_keep_korrnum = iv_filter_korrnum
          i_ignore_case  = iv_ignore_case
        CHANGING
          ct_versions    = result-versions ).
      LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<ver_dup_owner_guard>)
        WHERE trfunction = 'K' AND task IS INITIAL.
        <ver_dup_owner_guard>-obj_owner      = <ver_dup_owner_guard>-author.
        <ver_dup_owner_guard>-obj_owner_name = <ver_dup_owner_guard>-author_name.
      ENDLOOP.
    ENDIF.

    " Pair selection: only when a K/T/S filter is active (same condition as version
    " filtering above). Uses the scope structures already built by the filter block —
    " lt_selected_keys, lt_scope_child_tasks, lv_low_date/lv_low_time — so the scope
    " is derived exactly once from user-supplied parameters, never re-derived from
    " version data. When no filter is active there is no trimming and no pair.
    IF iv_filter_korrnum IS NOT INITIAL
       OR it_filter_korrnums IS NOT INITIAL
       OR it_filter_parent_korrnums IS NOT INITIAL.
      " NEW endpoint = the newest version that belongs to the selected request.
      " If the request has no such version (its changes are still in the Active
      " object), take the Active/Modified state instead.
      " KEEP (replaced): a ToC was skipped outright here —
      "   CHECK ls_new_cand-trfunction <> 'T'.
      " with the note "a ToC is only a transport copy and is never the NEW
      " endpoint". That holds for a foreign ToC. Our own ToC is the same change
      " under another number, and when it was written after the request's own
      " version (v38 by ToC, v37 by the request) it is the newer end state — the
      " one that will actually move — so the review has to end there.
      CLEAR result-new_version.

      " The active state is newer than every numbered version, so when it belongs
      " to the scope itself it IS the end state the review has to reach.
      " KEEP (replaced): there was no test here at all — Active became the NEW
      " endpoint only through the fallback further down, i.e. only when NO
      " numbered version was in scope. An object that was moved by a ToC of the
      " request (v63) and then changed again under one of the request's own tasks
      " (Active) therefore ended its review at v63: the last change, the one
      " still sitting in the active source, was not reviewed at all.
      " Read from LS_DROPPED_ACTIVE when a TR filter removed the row from the
      " displayed list, from the list itself when it did not (a task scope is not
      " trimmed). Active wins over Modified, the same order the fallback uses.
      DATA ls_act_cand TYPE ty_version_row.
      CLEAR ls_act_cand.
      IF ls_dropped_active IS NOT INITIAL.
        ls_act_cand = ls_dropped_active.
      ELSE.
        READ TABLE result-versions INTO ls_act_cand
          WITH KEY versno = zcl_vx_version=>c_version-active.
        IF sy-subrc <> 0.
          CLEAR ls_act_cand.
          READ TABLE result-versions INTO ls_act_cand
            WITH KEY versno = zcl_vx_version=>c_version-modified.
          IF sy-subrc <> 0.
            CLEAR ls_act_cand.
          ENDIF.
        ENDIF.
      ENDIF.
      DATA lv_act_in_scope TYPE abap_bool.
      CLEAR lv_act_in_scope.
      IF ls_act_cand IS NOT INITIAL.
        DATA(lv_act_korr) = COND trkorr(
          WHEN ls_act_cand-task    IS NOT INITIAL THEN CONV trkorr( ls_act_cand-task )
          WHEN ls_act_cand-korrnum IS NOT INITIAL THEN CONV trkorr( ls_act_cand-korrnum )
          ELSE VALUE trkorr( ) ).
        IF lv_act_korr IS NOT INITIAL
           AND ( line_exists( lt_selected_keys[ korrnum = lv_act_korr ] )
              OR line_exists( lt_scope_child_tasks[ table_line = lv_act_korr ] )
              OR korr_resolves_into_scope( iv_korrnum = ls_act_cand-korrnum
                                           it_scope   = lt_scope_korr ) ).
          lv_act_in_scope = abap_true.
        ENDIF.
      ENDIF.

      " The newest numbered version that belongs to the selected request — the
      " state the request itself produced. LV_FOREIGN_ABOVE remembers whether
      " anything numbered sits ABOVE it that is not ours.
      DATA ls_own_new TYPE ty_version_row.
      DATA lv_foreign_above TYPE abap_bool.
      CLEAR: ls_own_new, lv_foreign_above.
      LOOP AT result-versions INTO DATA(ls_new_cand).
        CHECK ls_own_new IS INITIAL.
        " Active/Modified are decided above, where Active is preferred over
        " Modified — versno 99999 sorts above 99998, so this loop would pick the
        " inactive state first.
        CHECK ls_new_cand-versno <> zcl_vx_version=>c_version-active
          AND ls_new_cand-versno <> zcl_vx_version=>c_version-modified.
        DATA(lv_new_korr) = COND trkorr(
          WHEN ls_new_cand-task    IS NOT INITIAL THEN CONV trkorr( ls_new_cand-task )
          WHEN ls_new_cand-korrnum IS NOT INITIAL THEN CONV trkorr( ls_new_cand-korrnum )
          ELSE VALUE trkorr( ) ).
        IF lv_new_korr IS NOT INITIAL
           AND ( line_exists( lt_selected_keys[ korrnum = lv_new_korr ] )
              OR line_exists( lt_scope_child_tasks[ table_line = lv_new_korr ] )
              OR korr_resolves_into_scope( iv_korrnum = ls_new_cand-korrnum
                                           it_scope   = lt_scope_korr ) ).
          ls_own_new = ls_new_cand.   " versions sorted desc → newest in scope
          EXIT.
        ENDIF.
        " A numbered version newer than the request's own end state and not part
        " of it. A version whose request cannot be determined counts here too:
        " unknown work above ours is not work this review may claim.
        lv_foreign_above = abap_true.
      ENDLOOP.

      " **The active state is only the end of THIS request when nothing else got
      " in between.** Active is newer than every numbered version, so where the
      " request's own version is the newest one, Active is simply that same work
      " carried on — the case the rule was written for (an object moved by a ToC
      " of the request and then changed again under one of its tasks).
      " But when other requests have written versions on top of ours — v171 by
      " the reviewed request, v172..v175 by another one, then Active — Active
      " holds THEIR work as well. Taking it as the NEW endpoint then reviewed
      " code the request never wrote, and, worse, handed the retrofit comparison
      " a local source full of foreign changes: every one of them came out as a
      " divergence from the other system and was reported as a moving violation
      " of this request. The version that will actually move is v171, so the
      " review and the retrofit both end there.
      IF ls_own_new IS NOT INITIAL AND lv_foreign_above = abap_true.
        result-new_version = ls_own_new.
      ELSEIF lv_act_in_scope = abap_true.
        result-new_version = ls_act_cand.
      ELSE.
        result-new_version = ls_own_new.
      ENDIF.

      IF result-new_version IS INITIAL.
        " No own (non-ToC) version in scope → take the Active/Modified object.
        READ TABLE result-versions INTO DATA(ls_new_act)
          WITH KEY versno = zcl_vx_version=>c_version-active.
        IF sy-subrc <> 0.
          READ TABLE result-versions INTO ls_new_act
            WITH KEY versno = zcl_vx_version=>c_version-modified.
        ENDIF.
        IF sy-subrc = 0.
          result-new_version = ls_new_act.
        ELSEIF ls_dropped_active IS NOT INITIAL.
          " The TR filter dropped the real Active row from the list — reuse it.
          " It already carries the true author/owner, request and date from VRSD.
          result-new_version = ls_dropped_active.
        ENDIF.
      ENDIF.
      IF result-new_version IS NOT INITIAL.
        " Build own-scope set: all selected K/S/R/T plus all S/R children of parent K.
        DATA lt_pair_own TYPE HASHED TABLE OF trkorr WITH UNIQUE KEY table_line.
        LOOP AT lt_selected_keys INTO DATA(ls_pair_sel).
          INSERT ls_pair_sel-korrnum INTO TABLE lt_pair_own.
        ENDLOOP.
        LOOP AT lt_scope_child_tasks INTO DATA(lv_pair_ch).
          INSERT lv_pair_ch INTO TABLE lt_pair_own.
        ENDLOOP.
        IF result-new_version-task IS NOT INITIAL.
          INSERT CONV trkorr( result-new_version-task ) INTO TABLE lt_pair_own.
        ENDIF.

        " Baseline = the first version OUTSIDE the selected request — that may
        " well be a foreign ToC (T) of another request, not necessarily a K. Only
        " the request's OWN ToC must be excluded, which is detected by resolving
        " each ToC's korrnum to its parent K.
        " The walk starts right below the version chosen as NEW.
        " KEEP (replaced): it used to start at a fixed index 2 —
        "   LOOP AT result-versions INTO DATA(ls_bsl_ver) FROM 2.
        " which assumes NEW sits at index 1. It does not: the list can open with
        " Active/Modified rows (they are only dropped by the trimming, which is
        " skipped whenever the scope is a task rather than a request), and the
        " scope itself can hold several versions. Starting at 2 then walks over
        " versions NEWER than NEW — and the first of them that is out of scope
        " becomes the "previous" version, i.e. the review compares backwards.
        " Starts at 0, not at 1: when NEW is the Active state the TR filter took
        " out of the list, it is not found below and the walk has to consider
        " every row — including the first. Defaulting to 1 skipped the newest
        " numbered version, so a request whose newest numbered version was its
        " own ToC got the version *before* that ToC as its baseline.
        DATA(lv_bsl_start) = 0.
        LOOP AT result-versions INTO DATA(ls_bsl_idx).
          IF ls_bsl_idx-versno  = result-new_version-versno
             AND ls_bsl_idx-korrnum = result-new_version-korrnum.
            lv_bsl_start = sy-tabix.
            EXIT.
          ENDIF.
        ENDLOOP.
        LOOP AT result-versions INTO DATA(ls_bsl_ver) FROM lv_bsl_start + 1.
          " --- EXPERIMENT (do not delete): blanket "skip all T, baseline only K".
          " Disabled — baseline may legitimately be a foreign T predecessor.
          "  IF ls_bsl_ver-trfunction = 'T'.
          "    CONTINUE.
          "  ENDIF.
          " A ToC (T) carries the selected request's changes under its own korrnum.
          " Resolve it to the parent K; if that lands in own scope, the ToC is the
          " request's OWN copy → skip. A foreign ToC stays a valid baseline.
          IF ls_bsl_ver-trfunction = 'T' AND ls_bsl_ver-korrnum IS NOT INITIAL.
            DATA(lt_bsl_parent) = zcl_vx_request=>resolve_parent_k( CONV trkorr( ls_bsl_ver-korrnum ) ).
            DATA(lv_toc_in_scope) = abap_false.
            LOOP AT lt_bsl_parent INTO DATA(ls_bsl_parent).
              IF ls_bsl_parent-low IS NOT INITIAL
                 AND line_exists( lt_pair_own[ table_line = CONV trkorr( ls_bsl_parent-low ) ] ).
                lv_toc_in_scope = abap_true.
                EXIT.
              ENDIF.
            ENDLOOP.
            IF lv_toc_in_scope = abap_true.
              CONTINUE.
            ENDIF.
          ENDIF.
          DATA(lv_bsl_korr) = COND trkorr(
            WHEN ls_bsl_ver-task    IS NOT INITIAL THEN CONV trkorr( ls_bsl_ver-task )
            WHEN ls_bsl_ver-korrnum IS NOT INITIAL THEN CONV trkorr( ls_bsl_ver-korrnum )
            ELSE VALUE trkorr( ) ).
          " Still in scope → skip
          IF lv_bsl_korr IS NOT INITIAL
             AND line_exists( lt_pair_own[ table_line = lv_bsl_korr ] ).
            CONTINUE.
          ENDIF.
          " Older than scope start → definitive baseline
          IF lv_low_date IS NOT INITIAL
             AND ( ls_bsl_ver-datum < lv_low_date
                OR ( ls_bsl_ver-datum = lv_low_date AND ls_bsl_ver-zeit < lv_low_time ) ).
            result-old_version = ls_bsl_ver.
            EXIT.
          ENDIF.
          " Not in scope → baseline
          IF lv_bsl_korr IS NOT INITIAL.
            result-old_version = ls_bsl_ver.
            EXIT.
          ENDIF.
        ENDLOOP.

        " New-object / v1 guards — mirror select_diff_pair logic.
        IF result-old_version IS INITIAL.
          IF result-new_version-versno <> '00001'.
            " Object existed before this request; oldest available is the baseline.
            READ TABLE result-versions INTO result-old_version
              INDEX lines( result-versions ).
            " But if that oldest version is itself inside the selected request's
            " scope, the object was created by this request → it is a fully NEW
            " object, so compare against emptiness, not against its own v1.
            DATA(lv_oldest_korr) = COND trkorr(
              WHEN result-old_version-task    IS NOT INITIAL THEN CONV trkorr( result-old_version-task )
              WHEN result-old_version-korrnum IS NOT INITIAL THEN CONV trkorr( result-old_version-korrnum )
              ELSE VALUE trkorr( ) ).
            IF result-old_version-versno = result-new_version-versno
               OR ( lv_oldest_korr IS NOT INITIAL
                    AND line_exists( lt_pair_own[ table_line = lv_oldest_korr ] ) ).
              CLEAR result-old_version.  " single version, or created in this request → new object
            ENDIF.
          ENDIF.
          " Else: versno=1 → new object, no baseline needed.
        ELSEIF result-old_version-versno = '00001'
           AND lv_low_date IS NOT INITIAL
           AND ( result-old_version-datum < lv_low_date
              OR ( result-old_version-datum = lv_low_date
               AND result-old_version-zeit < lv_low_time ) ).
          " v1 predates scope start → genuine baseline, keep it.
        ELSEIF result-old_version-versno = '00001'
           AND result-old_version-korrnum = result-new_version-korrnum.
          " v1 of the same request → object was created in this request → new object.
          CLEAR result-old_version.
        ELSEIF result-old_version-versno = '00001'
           AND ( result-old_version-trfunction = 'K'
              OR result-old_version-trfunction = 'T' )
           AND result-old_version-korrnum <> result-new_version-korrnum.
          " v1 from an earlier request → genuine baseline, keep it.
        ELSEIF result-old_version-versno = '00001'.
          " v1 otherwise → treat as new object.
          CLEAR result-old_version.
        ENDIF.
      ENDIF.

    ELSEIF iv_pair_released = abap_true.
      " ── No request scope (package review, or a plain object review without a
      " selected TR): the change under review is everything that happened since
      " the last RELEASED transport. NEW = the current state (Active/Modified, or
      " the newest version if no active row exists), OLD = the newest version that
      " belongs to a released request. No version trimming is applied — the full
      " history stays visible in the version grid.
      DATA ls_rel_new TYPE ty_version_row.
      READ TABLE result-versions INTO ls_rel_new INDEX 1.
      IF sy-subrc = 0.
        DATA(lv_rel_new_is_pseudo) = xsdbool(
          ls_rel_new-versno = zcl_vx_version=>c_version-active
          OR ls_rel_new-versno = zcl_vx_version=>c_version-modified ).
        DATA(lv_rel_new_released) = abap_false.
        IF lv_rel_new_is_pseudo = abap_false AND ls_rel_new-korrnum IS NOT INITIAL.
          lv_rel_new_released = is_released_korr( ls_rel_new-korrnum ).
        ENDIF.

        IF lv_rel_new_released = abap_false.
          " The newest state is unreleased (Active/Modified or a version in an open
          " request) → it is the NEW endpoint of the review.
          result-new_version = ls_rel_new.
          LOOP AT result-versions INTO DATA(ls_rel_cand) FROM 2.
            CHECK ls_rel_cand-versno <> zcl_vx_version=>c_version-active
              AND ls_rel_cand-versno <> zcl_vx_version=>c_version-modified.
            CHECK ls_rel_cand-korrnum IS NOT INITIAL.
            CHECK is_released_korr( ls_rel_cand-korrnum ) = abap_true.
            result-old_version = ls_rel_cand.
            EXIT.
          ENDLOOP.
          " No released predecessor at all → the object has never been transported,
          " so it is reviewed as a newly created object (old_version stays empty).
        ENDIF.
        " Else: the newest version is itself the last released one → nothing
        " happened since the release, the pair stays empty and the object is skipped.
      ENDIF.
    ENDIF.

    " Hide ToC versions from the DISPLAY only — done after pair selection so the
    " pairing still sees them (a ToC carries the selected request's changes; its
    " removal must not strand the request and force NEW onto an older version).
    IF iv_no_toc = abap_true.
      CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
        EXPORTING
          percentage = 95
          text       = CONV char70( |Filtering TOC versions for { iv_objtype } { iv_objname }| ).
      DELETE result-versions WHERE trfunction = 'T'.
    ENDIF.

    IF iv_system IS NOT INITIAL.
      DATA lt_remote_dir TYPE vrsd_tab.
      DATA lt_remote_lversn TYPE TABLE OF vrsn.
      DATA lv_dest TYPE tmssysnam.
      lv_dest = iv_system.
      CALL FUNCTION 'SVRS_REMOTE_MANAGER'
        EXPORTING
          iv_command            = 'SVRS_GET_VERSION_DIRECTORY_40'
          iv_tarsystem          = lv_dest
          objname               = iv_objname
          objtype               = iv_objtype
        TABLES
          lversno_list          = lt_remote_lversn
          version_list          = lt_remote_dir
        EXCEPTIONS
          no_entry              = 1
          communication_failure = 2
          system_failure        = 3
          OTHERS                = 4.
      DATA ls_remote_scan TYPE vrsd.
      IF sy-subrc = 0.
        IF iv_filter_korrnum IS NOT INITIAL.
          " With TR filter: prefer the version just BEFORE the selected TR in remote
          " (production state before this change). If the TR has not yet been
          " released to the remote system, fall back to the current Active state.
          READ TABLE lt_remote_dir WITH KEY korrnum = iv_filter_korrnum INTO ls_remote_scan.
          IF sy-subrc = 0.
            READ TABLE lt_remote_dir INDEX sy-tabix + 1 INTO ls_remote_scan.
          ENDIF.
          IF ls_remote_scan IS INITIAL.
            " TR not yet in remote — show whatever is currently active there.
            READ TABLE lt_remote_dir INDEX 1 INTO ls_remote_scan.
          ENDIF.
        ELSE.
          " Without TR filter: show the current Active version of the remote system.
          READ TABLE lt_remote_dir INDEX 1 INTO ls_remote_scan.
        ENDIF.
      ENDIF.
      " If the remote baseline collapsed to the active/00000 placeholder (our
      " cross-system TR could not be matched by korrnum in the remote directory),
      " keep it as the remote ACTIVE state but normalize the version number to the
      " external active value (99998) so SVRS_GET_VERSION_REMOTE reads the current
      " active source there. That active state is exactly what our transport will
      " overwrite when moved -> the correct Code Review retrofit baseline.
      IF ls_remote_scan IS NOT INITIAL
         AND ( ls_remote_scan-versno = '00000'
            OR ls_remote_scan-versno = zcl_vx_version=>c_version-active ).
        ls_remote_scan-versno = zcl_vx_version=>c_version-active.
      ENDIF.
      IF ls_remote_scan IS NOT INITIAL.
        DATA(lv_remote_versno_text) = COND string(
          WHEN ls_remote_scan-versno = '00000'
            OR ls_remote_scan-versno = zcl_vx_version=>c_version-active
          THEN |Active ({ iv_system })|
          ELSE |{ CONV string( ls_remote_scan-versno + 0 ) } ({ iv_system })| ).
        " One row from the remote system: either the baseline before the TR
        " (if the TR was found in remote) or the current Active state (fallback).
        DATA(ls_remote_row) = VALUE ty_version_row(
          system      = iv_system
          versno      = ls_remote_scan-versno
          versno_text = lv_remote_versno_text
          datum       = ls_remote_scan-datum
          zeit        = ls_remote_scan-zeit
          author      = ls_remote_scan-author
          author_name = zcl_vx_vers_data=>get_user_name( ls_remote_scan-author )
          korrnum     = ls_remote_scan-korrnum
          objtype     = iv_objtype
          objname     = iv_objname ).
        " Remote row at INDEX 2: newest local version stays at INDEX 1 (current),
        " remote becomes INDEX 2 (previous/baseline) — auto-diff picks it naturally.
        " Only where the row is meant to be read as a version, i.e. the Explorer.
        IF iv_remote_in_list = abap_true.
          INSERT ls_remote_row INTO result-versions INDEX 2.
        ENDIF.

        " Store remote row separately so Code Review can compute retrofit diff
        " (new vs remote) in addition to the primary local diff (new vs old).
        " old_version stays as the local baseline — do NOT overwrite it here.
        result-remote_version = ls_remote_row.

        " ── Baseline of the RETROFIT comparison ──────────────────────────────
        " **Only of the retrofit comparison.** A request is rarely alone: pick
        " the last of a series that still has to move and the ones before it are
        " not over there either. Left out of snapshot 1, every one of their
        " changed lines comes out of the subtraction as a divergence of this
        " request. So the subtraction starts where the other system stands —
        " and the review pair does not move: whether a remote system was entered
        " must not change the review by one character.
        "
        " Answered per object, out of the other system's own version directory
        " (already read above): the newest local version whose request is
        " recorded there. Found nothing — the object never arrived, or it was
        " retrofitted by hand under their own numbers — leaves the baseline as
        " the pair selection built it.
        "
        " Code Review only. The Version Explorer gets the remote row in its list
        " and picks the two sides by hand; moving its baseline would change what
        " it auto-diffs.
        IF iv_remote_in_list = abap_false
           AND result-new_version IS NOT INITIAL
           AND lt_remote_dir IS NOT INITIAL.
          DATA lt_remote_korr TYPE HASHED TABLE OF trkorr WITH UNIQUE KEY table_line.
          CLEAR lt_remote_korr.
          LOOP AT lt_remote_dir INTO DATA(ls_rmt_korr_row).
            CHECK ls_rmt_korr_row-korrnum IS NOT INITIAL.
            INSERT CONV trkorr( ls_rmt_korr_row-korrnum ) INTO TABLE lt_remote_korr.
            " Their directory can hold our ToC while we hold the K, or the other
            " way round, so both sides are resolved to the parent K as well.
            DATA(lt_rmt_parents) = zcl_vx_request=>resolve_parent_k( CONV trkorr( ls_rmt_korr_row-korrnum ) ).
            LOOP AT lt_rmt_parents INTO DATA(ls_rmt_parent).
              CHECK ls_rmt_parent-low IS NOT INITIAL.
              INSERT CONV trkorr( ls_rmt_parent-low ) INTO TABLE lt_remote_korr.
            ENDLOOP.
          ENDLOOP.

          " The walk starts right below the version chosen as NEW, exactly like
          " the ordinary baseline walk.
          DATA(lv_rb_start) = 0.
          LOOP AT result-versions INTO DATA(ls_rb_idx).
            IF ls_rb_idx-versno     = result-new_version-versno
               AND ls_rb_idx-korrnum = result-new_version-korrnum.
              lv_rb_start = sy-tabix.
              EXIT.
            ENDIF.
          ENDLOOP.

          DATA lv_rb_found TYPE abap_bool.
          CLEAR lv_rb_found.
          LOOP AT result-versions INTO DATA(ls_rb) FROM lv_rb_start + 1.
            CHECK ls_rb-versno <> zcl_vx_version=>c_version-active
              AND ls_rb-versno <> zcl_vx_version=>c_version-modified.
            CHECK ls_rb-korrnum IS NOT INITIAL.
            DATA(lv_rb_korr) = CONV trkorr( ls_rb-korrnum ).

            " Every number this version can be known by.
            DATA lt_rb_keys TYPE HASHED TABLE OF trkorr WITH UNIQUE KEY table_line.
            CLEAR lt_rb_keys.
            INSERT lv_rb_korr INTO TABLE lt_rb_keys.
            DATA(lt_rb_parents) = zcl_vx_request=>resolve_parent_k( lv_rb_korr ).
            LOOP AT lt_rb_parents INTO DATA(ls_rb_parent).
              CHECK ls_rb_parent-low IS NOT INITIAL.
              INSERT CONV trkorr( ls_rb_parent-low ) INTO TABLE lt_rb_keys.
            ENDLOOP.

            " Still the selected request's own work — never a shared baseline,
            " not even when the other system has already received it.
            DATA(lv_rb_own) = abap_false.
            IF lt_pair_own IS NOT INITIAL.
              LOOP AT lt_rb_keys INTO DATA(lv_rb_key).
                IF line_exists( lt_pair_own[ table_line = lv_rb_key ] ).
                  lv_rb_own = abap_true.
                  EXIT.
                ENDIF.
              ENDLOOP.
            ENDIF.
            CHECK lv_rb_own = abap_false.

            LOOP AT lt_rb_keys INTO lv_rb_key.
              IF line_exists( lt_remote_korr[ table_line = lv_rb_key ] ).
                lv_rb_found = abap_true.
                EXIT.
              ENDIF.
            ENDLOOP.
            IF lv_rb_found = abap_true.
              " KEEP (replaced): this used to be RESULT-OLD_VERSION, i.e. the
              " review pair itself. With the other system years behind, the
              " baseline walked back years with it and the review filled up with
              " everyone else's changes — foreign authors, foreign dates, code
              " commented out in 2020. The review pair is none of the retrofit
              " check's business.
              result-retro_old_version = ls_rb.
              EXIT.
            ENDIF.
          ENDLOOP.
        ENDIF.
      ENDIF.
    ENDIF.
  ENDMETHOD.


  METHOD load_light.
    " Read all VRSD rows for this object, newest first. Active (versno=0) rows
    " are skipped — for diff purposes the newest numbered version is what matters.
    TYPES: BEGIN OF ty_vrow,
             versno  TYPE versno,
             korrnum TYPE trkorr,
             author  TYPE versuser,
             datum   TYPE versdate,
             zeit    TYPE verstime,
           END OF ty_vrow.
    DATA lt_vrows TYPE TABLE OF ty_vrow.
    SELECT versno, korrnum, author, datum, zeit
      FROM vrsd
      WHERE objtype = @iv_objtype
        AND objname = @iv_objname
        AND versno <> '00000'
      ORDER BY versno DESCENDING
      INTO TABLE @lt_vrows.

    " Scope check per distinct korrnum: a VRSD korrnum belongs to the K when it
    " IS the K, is an S/R child of the K, or is a T-copy merged from the K
    " (resolve_parent_k handles all three). Cache the decision per korrnum.
    TYPES: BEGIN OF ty_scope_cache,
             korrnum  TYPE trkorr,
             in_scope TYPE abap_bool,
           END OF ty_scope_cache.
    DATA lt_scope_cache TYPE HASHED TABLE OF ty_scope_cache WITH UNIQUE KEY korrnum.

    LOOP AT lt_vrows INTO DATA(ls_vr).
      DATA(lv_ext) = zcl_vx_versno=>to_external( ls_vr-versno ).
      DATA(lv_in_scope) = abap_false.
      READ TABLE lt_scope_cache INTO DATA(ls_cache) WITH KEY korrnum = ls_vr-korrnum.
      IF sy-subrc = 0.
        lv_in_scope = ls_cache-in_scope.
      ELSE.
        DATA(lt_parents) = zcl_vx_request=>resolve_parent_k( ls_vr-korrnum ).
        " The request number sits in LOW — comparing the whole range line against
        " it never matches.
        lv_in_scope = xsdbool( line_exists( lt_parents[ low = iv_filter_korrnum ] ) ).
        INSERT VALUE #( korrnum = ls_vr-korrnum in_scope = lv_in_scope ) INTO TABLE lt_scope_cache.
      ENDIF.

      APPEND VALUE ty_version_row(
        versno      = lv_ext
        versno_text = CONV string( lv_ext + 0 )
        korrnum     = ls_vr-korrnum
        author      = ls_vr-author
        datum       = ls_vr-datum
        zeit        = ls_vr-zeit
        " reuse trfunction field to carry the scope flag for the pair walk below
        trfunction  = COND #( WHEN lv_in_scope = abap_true THEN 'X' ELSE '' ) ) TO result-versions.
    ENDLOOP.

    " new_version: newest row in K scope (rows are sorted newest first).
    LOOP AT result-versions INTO DATA(ls_nv) WHERE trfunction = 'X'.
      result-new_version = ls_nv.
      EXIT.
    ENDLOOP.
    CHECK result-new_version IS NOT INITIAL.

    " old_version: first row AFTER new_version that is outside K scope.
    DATA lv_past_new TYPE abap_bool.
    LOOP AT result-versions INTO DATA(ls_ov).
      IF lv_past_new = abap_false.
        IF ls_ov-versno = result-new_version-versno
           AND ls_ov-korrnum = result-new_version-korrnum.
          lv_past_new = abap_true.
        ENDIF.
        CONTINUE.
      ENDIF.
      IF ls_ov-trfunction <> 'X'.
        result-old_version = ls_ov.
        EXIT.
      ENDIF.
    ENDLOOP.

    " Clear the borrowed trfunction flag so callers see clean rows.
    CLEAR: result-new_version-trfunction, result-old_version-trfunction.
    LOOP AT result-versions ASSIGNING FIELD-SYMBOL(<v_clr>).
      CLEAR <v_clr>-trfunction.
    ENDLOOP.

    " New-object guard: the K wrote v1 → object created in this K, no baseline.
    IF result-old_version IS INITIAL AND result-new_version-versno <> '00001'.
      " Object existed before; oldest available version is the baseline.
      DATA(lv_last) = lines( result-versions ).
      IF lv_last > 1.
        READ TABLE result-versions INTO result-old_version INDEX lv_last.
        IF result-old_version-versno = result-new_version-versno.
          CLEAR result-old_version.
        ELSE.
          " If the oldest version is also in K scope (e.g. created by an S/R task
          " of this K), the object was created within this K → new object, no baseline.
          READ TABLE lt_scope_cache INTO DATA(ls_old_cache)
            WITH KEY korrnum = result-old_version-korrnum.
          IF sy-subrc = 0 AND ls_old_cache-in_scope = abap_true.
            CLEAR result-old_version.
          ENDIF.
        ENDIF.
      ENDIF.
    ENDIF.
  ENDMETHOD.


  METHOD korr_resolves_into_scope.
    DATA lv_korrnum TYPE trkorr.
    lv_korrnum = iv_korrnum.
    CHECK lv_korrnum IS NOT INITIAL.
    CHECK it_scope IS NOT INITIAL.

    LOOP AT zcl_vx_request=>resolve_parent_k( lv_korrnum ) INTO DATA(ls_parent).
      CHECK ls_parent-low IS NOT INITIAL.
      IF line_exists( it_scope[ table_line = CONV trkorr( ls_parent-low ) ] ).
        result = abap_true.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD is_released_korr.
    DATA lv_korrnum TYPE trkorr.
    lv_korrnum = iv_korrnum.
    CHECK lv_korrnum IS NOT INITIAL.

    READ TABLE gt_rel_cache INTO DATA(ls_cached) WITH KEY korrnum = lv_korrnum.
    IF sy-subrc = 0.
      result = ls_cached-released.
      RETURN.
    ENDIF.

    " A version may be recorded under the K itself, under one of its S/R tasks, or
    " under a T-copy merged from it — resolve_parent_k covers all three. The release
    " state that matters is always the one of the parent K.
    DATA(lt_parents) = zcl_vx_request=>resolve_parent_k( lv_korrnum ).
    APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_korrnum ) TO lt_parents.

    LOOP AT lt_parents INTO DATA(ls_parent) WHERE low IS NOT INITIAL.
      SELECT SINGLE trstatus FROM e070
        WHERE trkorr = @ls_parent-low
        INTO @DATA(lv_trstatus).
      IF sy-subrc = 0 AND ( lv_trstatus = 'R' OR lv_trstatus = 'N' ).
        result = abap_true.
        EXIT.
      ENDIF.
    ENDLOOP.

    INSERT VALUE #( korrnum = lv_korrnum released = result ) INTO TABLE gt_rel_cache.
  ENDMETHOD.


  METHOD map_to_e071_key.
    ev_object = SWITCH e071-object( iv_objtype
      WHEN 'REPS' OR 'REPT' THEN 'PROG'
      WHEN 'CINC' OR 'CLSD' THEN 'CLAS'
      ELSE iv_objtype ).
    ev_obj_name = iv_objname.
    CASE iv_objtype.
      WHEN 'CINC' OR 'CLSD' OR 'CPUB' OR 'CPRO' OR 'CPRI' OR 'REPT'.
        DATA(lv_eq) = find( val = ev_obj_name sub = '=' ).
        IF lv_eq > 0.
          ev_obj_name = ev_obj_name(lv_eq).
        ENDIF.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
