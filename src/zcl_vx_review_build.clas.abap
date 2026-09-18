CLASS zcl_vx_review_build DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    TYPES ty_part_row TYPE zif_vx_vers_types=>ty_part_row.
    TYPES ty_version_row TYPE zif_vx_vers_types=>ty_version_row.
    TYPES ty_t_version_row TYPE zif_vx_vers_types=>ty_t_version_row.
    TYPES ty_diff_op TYPE zif_vx_vers_types=>ty_diff_op.
    TYPES ty_t_diff TYPE zif_vx_vers_types=>ty_t_diff.
    TYPES ty_blame_map TYPE zif_vx_vers_types=>ty_blame_map.

    TYPES:
      BEGIN OF ty_options,
        date_from              TYPE versdate,
        remove_dup             TYPE abap_bool,
        no_toc                 TYPE abap_bool,
        "! One option: case- AND whitespace-insensitive diff ("Case/ind" toggle)
        ignore_case            TYPE abap_bool,
        filter_korrnum         TYPE trkorr,
        filter_korrnums        TYPE zif_vx_object=>ty_t_korr_range,
        filter_parent_korrnums TYPE zif_vx_object=>ty_t_korr_range,
        "! No request selected (package review): pair against the last released transport
        pair_released          TYPE abap_bool,
        system                 TYPE verssysnam,
        filter_user            TYPE versuser,
        blame                  TYPE abap_bool,
        "! Skip generated code (SAP* authored includes, SEGW model classes)
        ignore_generated       TYPE abap_bool,
        two_pane               TYPE abap_bool,
        compact                TYPE abap_bool,
        debug                  TYPE abap_bool,
      END OF ty_options.

    CLASS-METHODS precompute_part
      IMPORTING
        is_part       TYPE ty_part_row
        is_options    TYPE ty_options
      CHANGING
        ct_versions   TYPE ty_t_version_row
        ct_acr_stats  TYPE zif_vx_review_types=>ty_t_obj_stats
        ct_hunk_info  TYPE zif_vx_review_types=>ty_t_hunk_info
        ct_diff_data  TYPE zif_vx_review_types=>ty_t_diff_data
        ct_cr_diag    TYPE string_table.

    CLASS-METHODS precompute_class_parts
      IMPORTING
        iv_class_name TYPE seoclsname
        is_options    TYPE ty_options
      CHANGING
        ct_versions   TYPE ty_t_version_row
        ct_acr_stats  TYPE zif_vx_review_types=>ty_t_obj_stats
        ct_hunk_info  TYPE zif_vx_review_types=>ty_t_hunk_info
        ct_diff_data  TYPE zif_vx_review_types=>ty_t_diff_data
        ct_cr_diag    TYPE string_table
      RETURNING
        VALUE(result) TYPE abap_bool.

    "! Expands a function group into its include parts (SAPL* + L*) and
    "! precomputes each REPS include. FUGR-only, mirrors precompute_class_parts.
    CLASS-METHODS precompute_fugr_parts
      IMPORTING
        iv_fugr_name  TYPE rs38l_area
        is_options    TYPE ty_options
      CHANGING
        ct_versions   TYPE ty_t_version_row
        ct_acr_stats  TYPE zif_vx_review_types=>ty_t_obj_stats
        ct_hunk_info  TYPE zif_vx_review_types=>ty_t_hunk_info
        ct_diff_data  TYPE zif_vx_review_types=>ty_t_diff_data
        ct_cr_diag    TYPE string_table
      RETURNING
        VALUE(result) TYPE abap_bool.

    "! Builds retrofit (moving-violation) hunks from the remote->new diff.
    "! Self-contained: groups hunks, skips ones fully covered by the primary
    "! review, renders each hunk's html, and classifies the warning text.
    "! Public so the popup can regenerate hunk html on the fly at view time.
    CLASS-METHODS collect_retrofit_hunks
      IMPORTING
        is_part          TYPE ty_part_row
        it_diff          TYPE zif_vx_vers_types=>ty_t_diff
        it_review_lines  TYPE zif_vx_review_types=>ty_review_lines
        iv_versno_new    TYPE versno
        iv_new_text      TYPE string
        iv_remote_versno TYPE versno
        iv_old_text      TYPE string
        iv_system        TYPE verssysnam
        iv_author        TYPE versuser
        iv_display_name  TYPE string
        iv_two_pane      TYPE abap_bool
        iv_ignore_case   TYPE abap_bool
        "! One flag per line of IT_DIFF from MARK_EXPECTED_OPS: is this operation
        "! accounted for by the request? Authoritative when supplied and sized to
        "! IT_DIFF; IT_REVIEW_LINES is the fallback for reviews saved before it.
        it_expected      TYPE zif_vx_review_types=>ty_t_flag OPTIONAL
        "! P_DEBUG: append the coverage decision to every hunk — which of its
        "! changed lines the engine did and did not find in the review of this
        "! request. A hunk is a violation precisely when one of them is missing.
        iv_debug         TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(result)    TYPE zif_vx_review_types=>ty_t_hunk_info.

    "! Hunks of one rebuilt retrofit comparison plus the diff they were built
    "! from — the caller stores that diff, so the next view renders from it
    "! instead of reading the remote system again.
    TYPES:
      BEGIN OF ty_retrofit_rebuild,
        hunks TYPE zif_vx_review_types=>ty_t_hunk_info,
        diff  TYPE zif_vx_vers_types=>ty_t_diff,
      END OF ty_retrofit_rebuild.

    "! Subtracts the review diff from the remote one. Both describe the SAME new
    "! version, so in a system pair that is in sync their change scripts are the
    "! same script and cancel out completely; whatever the remote diff has left
    "! over is the divergence. Matching is by counted key, not by set membership:
    "! one changed line in the request accounts for exactly one changed line over
    "! there, and the other two occurrences of the same text stay unexplained.
    "! Returns one flag per line of IT_DIFF_RMT ('=' lines are always expected).
    CLASS-METHODS mark_expected_ops
      IMPORTING it_diff_rmt   TYPE zif_vx_vers_types=>ty_t_diff
                it_diff_rev   TYPE zif_vx_vers_types=>ty_t_diff
      RETURNING VALUE(result) TYPE zif_vx_review_types=>ty_t_flag.

    "! Comparison key of one source line: upper-cased and stripped of ALL
    "! whitespace. The other system indents and re-formats independently of ours,
    "! so nothing that compares lines ACROSS the two may compare raw text.
    CLASS-METHODS norm_cmp_line
      IMPORTING iv_text       TYPE clike
      RETURNING VALUE(result) TYPE string.

    "! Rebuilds the retrofit hunks of one object from the systems themselves:
    "! reads the remote source and the local new version again and runs the same
    "! remote->new diff PRECOMPUTE_PART runs. The stored review normally carries
    "! that diff, but a review saved before it was persisted has only the hunk
    "! metadata — the warning is there, the code behind it is not. Everything
    "! needed is still readable, so it is computed at view time instead of
    "! rendering "Diff not available".
    "! Returns empty when the remote system cannot be read; the caller then keeps
    "! whatever the review stored.
    CLASS-METHODS rebuild_retrofit_hunks
      IMPORTING
        is_hunk          TYPE zif_vx_review_types=>ty_hunk_info
        "! Change lines of the primary review diff (|op|text|), so hunks that are
        "! part of this request drop out exactly as they do during Prepare.
        it_review_lines  TYPE zif_vx_review_types=>ty_review_lines OPTIONAL
        iv_system        TYPE verssysnam
        iv_two_pane      TYPE abap_bool
        iv_ignore_case   TYPE abap_bool
        iv_debug         TYPE abap_bool DEFAULT abap_false
      RETURNING
        VALUE(result)    TYPE ty_retrofit_rebuild.

  PRIVATE SECTION.
    "! Author of the reviewed range when there is exactly one, plus the version
    "! metadata to annotate the lines with. AUTHOR stays empty when the range is
    "! shared by several authors (then only a replay can tell them apart) or when
    "! there is nothing to attribute.
    TYPES:
      BEGIN OF ty_range_author,
        author      TYPE versuser,
        author_name TYPE ad_namtext,
        datum       TYPE versdate,
        zeit        TYPE verstime,
        versno_text TYPE string,
        korrnum     TYPE verskorrno,
        task        TYPE trkorr,
        task_text   TYPE string,
        versions    TYPE i,
        "! Distinct authors found in the range. Filled even when there are
        "! several — that is what the diagnostics report.
        authors     TYPE i,
      END OF ty_range_author.

    "! Mirrors the version selection of ZCL_VX_DIFF=>BUILD_BLAME_MAP: the
    "! versions of this object within [iv_from .. iv_to], ordered by version. The
    "! oldest one is the baseline the replay starts from and never attributes
    "! lines itself, so its author does not count.
    CLASS-METHODS single_range_author
      IMPORTING
        it_versions   TYPE ty_t_version_row
        iv_objtype    TYPE versobjtyp
        iv_objname    TYPE versobjnam
        iv_from       TYPE versno
        iv_to         TYPE versno
      RETURNING
        VALUE(result) TYPE ty_range_author.

    CLASS-METHODS append_diag
      IMPORTING
        iv_text    TYPE string
      CHANGING
        ct_cr_diag TYPE string_table.

    "! Extracts the &lt;tr&gt; rows from a diff_to_html fragment.

    CLASS-METHODS load_versions
      IMPORTING
        iv_objtype        TYPE versobjtyp
        iv_objname        TYPE versobjnam
        is_options        TYPE ty_options
      EXPORTING
        ev_new_version    TYPE ty_version_row
        ev_old_version    TYPE ty_version_row
        ev_remote_version TYPE ty_version_row
        "! Retrofit baseline — see ZCL_VX_VERSION_LIST=>TY_RESULT. Used for
        "! snapshot 1 of the subtraction only, never for the review pair.
        ev_retro_old_version TYPE ty_version_row
      CHANGING
        ct_versions       TYPE ty_t_version_row.
ENDCLASS.


CLASS zcl_vx_review_build IMPLEMENTATION.

  METHOD mark_expected_ops.
    " Remaining budget per changed line of the review diff.
    TYPES: BEGIN OF ty_budget,
             key   TYPE string,
             count TYPE i,
           END OF ty_budget.
    DATA lt_budget TYPE HASHED TABLE OF ty_budget WITH UNIQUE KEY key.

    LOOP AT it_diff_rev INTO DATA(ls_rev) WHERE op = '+' OR op = '-'.
      DATA(lv_rev_norm) = norm_cmp_line( ls_rev-text ).
      " Blank lines are not code and take no part in the accounting — see below.
      IF lv_rev_norm IS INITIAL.
        CONTINUE.
      ENDIF.
      DATA(lv_rev_key) = |{ ls_rev-op }\|{ lv_rev_norm }|.
      READ TABLE lt_budget ASSIGNING FIELD-SYMBOL(<budget>) WITH TABLE KEY key = lv_rev_key.
      IF sy-subrc = 0.
        <budget>-count = <budget>-count + 1.
      ELSE.
        INSERT VALUE ty_budget( key = lv_rev_key count = 1 ) INTO TABLE lt_budget.
      ENDIF.
    ENDLOOP.

    LOOP AT it_diff_rmt INTO DATA(ls_rmt).
      IF ls_rmt-op <> '+' AND ls_rmt-op <> '-'.
        APPEND abap_true TO result.
        CONTINUE.
      ENDIF.
      DATA(lv_rmt_norm) = norm_cmp_line( ls_rmt-text ).
      " A blank line is never something the other system loses. The two diffs
      " place blanks wherever their alignment happens to fall — nothing is more
      " fungible in an LCS — so an unpaired one is an accounting difference, not
      " a divergence. Left in, a single stray blank kept an entire block of
      " otherwise fully accounted-for changes standing as a violation.
      IF lv_rmt_norm IS INITIAL.
        APPEND abap_true TO result.
        CONTINUE.
      ENDIF.
      DATA(lv_rmt_key) = |{ ls_rmt-op }\|{ lv_rmt_norm }|.
      READ TABLE lt_budget ASSIGNING <budget> WITH TABLE KEY key = lv_rmt_key.
      IF sy-subrc = 0 AND <budget>-count > 0.
        <budget>-count = <budget>-count - 1.
        APPEND abap_true TO result.
      ELSE.
        APPEND abap_false TO result.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD norm_cmp_line.
    " **A comment counts as much as a line of code.** Only a blank line drops
    " out: it condenses to nothing, so its key is empty and the accounting
    " ignores it.
    "
    " KEEP (replaced): the comment used to be cut off before the key was formed —
    "   DATA(lv_cmt) = zcl_vx_diff=>comment_offset( lv_line ).
    "   IF lv_cmt >= 0. lv_line = substring( val = lv_line len = lv_cmt ). ENDIF.
    " with the note "a divergence that lives in a comment is not something the
    " other system loses". It is exactly what the other system loses: the change
    " history stands in comments. A block of theirs reading
    "   * 10.08.2026 |CT770018 |ER4K9A16AT| INC3823847 …
    " is the record of a change made over there, and our move deletes it — but
    " with comments cut out the line had an empty key, passed as expected, and
    " the whole header block never appeared among the violations. The reviewer
    " then saw the code that would be overwritten and not the entry saying who
    " wrote it and why.
    "
    " Our own notes cost nothing: they are added by the request, so the review
    " diff carries them too and the subtraction cancels them out.
    "
    " Indentation and case are still folded away, because the other system
    " formats independently of ours.
    DATA(lv_line) = CONV string( iv_text ).
    result = to_upper( condense( val = lv_line ) ).
    REPLACE ALL OCCURRENCES OF ` ` IN result WITH ``.
  ENDMETHOD.


  METHOD append_diag.
    CHECK iv_text IS NOT INITIAL.
    IF lines( ct_cr_diag ) < 300.
      APPEND iv_text TO ct_cr_diag.
    ENDIF.
  ENDMETHOD.


  METHOD single_range_author.
    DATA lt_range TYPE ty_t_version_row.

    CHECK iv_from IS NOT INITIAL.

    " SYSTEM IS INITIAL for the same reason as in BUILD_BLAME_MAP: the remote
    " baseline row is not a step of this system's history, and counting it here
    " would let a remote author decide whether the replay is needed and who the
    " single author is.
    LOOP AT it_versions INTO DATA(ls_ver)
      WHERE versno  >= iv_from
        AND versno  <= iv_to
        AND objtype  = iv_objtype
        AND objname  = iv_objname
        AND system  IS INITIAL.
      APPEND ls_ver TO lt_range.
    ENDLOOP.
    SORT lt_range BY versno ASCENDING datum ASCENDING zeit ASCENDING.

    " Fewer than two versions means the replay produces nothing at all; leave it
    " to BUILD_BLAME_MAP so that behaviour stays in one place.
    CHECK lines( lt_range ) >= 2.

    " Index 1 is the baseline: the replay starts from its source and credits
    " nobody for it, so only the versions after it carry authorship.
    DATA lt_authors TYPE SORTED TABLE OF versuser WITH UNIQUE KEY table_line.
    DATA(lv_author) = VALUE versuser( ).
    DATA(lv_unknown) = abap_false.
    LOOP AT lt_range INTO DATA(ls_step) FROM 2.
      DATA(lv_step_author) = COND versuser(
        WHEN ls_step-obj_owner IS NOT INITIAL THEN ls_step-obj_owner
        ELSE ls_step-author ).
      IF lv_step_author IS INITIAL.
        lv_unknown = abap_true.   " a replay may still resolve it per line
        CONTINUE.
      ENDIF.
      INSERT lv_step_author INTO TABLE lt_authors.
      lv_author = lv_step_author.
    ENDLOOP.

    " Reported either way, so the diagnostics can say why a replay was needed.
    result-versions = lines( lt_range ).
    result-authors  = lines( lt_authors ).
    IF lv_unknown = abap_true OR lines( lt_authors ) <> 1.
      CLEAR lv_author.
    ENDIF.
    CHECK lv_author IS NOT INITIAL.

    " Annotate with the newest version of the range — the state the diff shows.
    DATA(ls_last) = lt_range[ lines( lt_range ) ].
    result = VALUE #(
      author      = lv_author
      author_name = COND #( WHEN ls_last-obj_owner IS NOT INITIAL
                            THEN ls_last-obj_owner_name
                            ELSE ls_last-author_name )
      datum       = ls_last-datum
      zeit        = ls_last-zeit
      versno_text = ls_last-versno_text
      korrnum     = ls_last-korrnum
      task        = ls_last-task
      task_text   = ls_last-korr_text
      versions    = lines( lt_range )
      authors     = lines( lt_authors ) ).
  ENDMETHOD.


  METHOD load_versions.
    DATA(ls_result) = zcl_vx_version_list=>load(
      iv_objtype                = iv_objtype
      iv_objname                = iv_objname
      iv_date_from              = is_options-date_from
      iv_remove_dup             = is_options-remove_dup
      iv_no_toc                 = is_options-no_toc
      iv_ignore_case            = is_options-ignore_case
      iv_filter_korrnum         = is_options-filter_korrnum
      it_filter_korrnums        = is_options-filter_korrnums
      it_filter_parent_korrnums = is_options-filter_parent_korrnums
      iv_system                 = is_options-system
      " The retrofit baseline arrives in EV_REMOTE_VERSION below; in CT_VERSIONS
      " it is a row of another system among this one's history, and the blame
      " replay reading that list credited every line the remote already had to a
      " developer of that system.
      iv_remote_in_list         = abap_false
      iv_pair_released          = is_options-pair_released ).

    ct_versions       = ls_result-versions.
    ev_new_version    = ls_result-new_version.
    ev_old_version    = ls_result-old_version.
    ev_remote_version = ls_result-remote_version.
    ev_retro_old_version = ls_result-retro_old_version.
  ENDMETHOD.


  METHOD precompute_class_parts.
    DATA(lv_before) = lines( ct_acr_stats ).
    append_diag(
      EXPORTING iv_text = |CLASS { iv_class_name }: expanding class parts|
      CHANGING  ct_cr_diag = ct_cr_diag ).
    TRY.
        DATA(lo_obj) = NEW zcl_vx_object_factory( )->get_instance(
          object_type = zcl_vx_object_factory=>gc_type-class
          object_name = CONV #( iv_class_name ) ).
        DATA(lt_cr_parts) = lo_obj->get_parts( ).
        append_diag(
          EXPORTING iv_text = |CLASS { iv_class_name }: { lines( lt_cr_parts ) } part(s) found|
          CHANGING  ct_cr_diag = ct_cr_diag ).
        DATA(lv_cr_total) = lines( lt_cr_parts ).
        LOOP AT lt_cr_parts INTO DATA(ls_part).
          IF ls_part-type = 'CLSD' OR ls_part-type = 'RELE'.
            append_diag(
              EXPORTING iv_text = |SKIP { ls_part-type } { ls_part-object_name }: class technical part is not reviewed directly|
              CHANGING  ct_cr_diag = ct_cr_diag ).
            CONTINUE.
          ENDIF.
          append_diag(
            EXPORTING iv_text = |CLASS PART { ls_part-type } { ls_part-object_name }: { ls_part-unit }|
            CHANGING  ct_cr_diag = ct_cr_diag ).
          " Make recompute idempotent, the same way PRECOMPUTE_FUGR_PARTS does.
          " The caller can only drop the caches of the class it was asked to
          " recompute, and a technical part is not named after it: a method is
          " stored under the class padded to 30 characters plus the method name,
          " so DELETE ... WHERE key-objname = <class> never matched one. The
          " stale entry then survived, and CT_DIFF_CACHE has a unique key — the
          " freshly computed html was silently not inserted and the object view
          " kept showing the diff from before the change.
          DELETE ct_acr_stats  WHERE objtype = ls_part-type AND obj_name = ls_part-object_name.
          DELETE ct_hunk_info  WHERE objtype = ls_part-type AND obj_name = ls_part-object_name.
          DELETE ct_diff_data  WHERE key-objtype = ls_part-type AND key-objname = ls_part-object_name.
          precompute_part(
            EXPORTING
              is_part    = VALUE #(
                type        = ls_part-type
                name        = ls_part-unit
                class       = ls_part-class
                object_name = ls_part-object_name )
              is_options = is_options
            CHANGING
              ct_versions   = ct_versions
              ct_acr_stats  = ct_acr_stats
              ct_hunk_info  = ct_hunk_info
              ct_diff_data  = ct_diff_data
              ct_cr_diag    = ct_cr_diag ).
        ENDLOOP.
      CATCH cx_root INTO DATA(lx_class_parts).
        append_diag(
          EXPORTING iv_text = |SKIP CLAS { iv_class_name }: cannot expand class parts - { lx_class_parts->get_text( ) }|
          CHANGING  ct_cr_diag = ct_cr_diag ).
    ENDTRY.
    result = boolc( lines( ct_acr_stats ) > lv_before ).
  ENDMETHOD.


  METHOD precompute_fugr_parts.
    DATA(lv_before) = lines( ct_acr_stats ).
    append_diag(
      EXPORTING iv_text = |FUGR { iv_fugr_name }: expanding function group parts|
      CHANGING  ct_cr_diag = ct_cr_diag ).
    TRY.
        DATA(lo_obj) = NEW zcl_vx_object_factory( )->get_instance(
          object_type = zcl_vx_object_factory=>gc_type-fugr
          object_name = CONV #( iv_fugr_name ) ).
        DATA(lt_cr_parts) = lo_obj->get_parts( ).
        append_diag(
          EXPORTING iv_text = |FUGR { iv_fugr_name }: { lines( lt_cr_parts ) } include(s) found|
          CHANGING  ct_cr_diag = ct_cr_diag ).
        DATA(lv_cr_total) = lines( lt_cr_parts ).
        LOOP AT lt_cr_parts INTO DATA(ls_part).
          append_diag(
            EXPORTING iv_text = |FUGR PART { ls_part-type } { ls_part-object_name }: { ls_part-unit }|
            CHANGING  ct_cr_diag = ct_cr_diag ).
          " Make recompute idempotent: drop prior cached data for this include
          " before precompute_part appends fresh stats (it APPENDs acr_stats).
          DELETE ct_acr_stats  WHERE objtype = ls_part-type AND obj_name = ls_part-object_name.
          DELETE ct_hunk_info  WHERE objtype = ls_part-type AND obj_name = ls_part-object_name.
          DELETE ct_diff_data  WHERE key-objtype = ls_part-type AND key-objname = ls_part-object_name.
          precompute_part(
            EXPORTING
              is_part    = VALUE #(
                type        = ls_part-type
                name        = ls_part-unit
                class       = ls_part-class
                object_name = ls_part-object_name )
              is_options = is_options
            CHANGING
              ct_versions   = ct_versions
              ct_acr_stats  = ct_acr_stats
              ct_hunk_info  = ct_hunk_info
              ct_diff_data  = ct_diff_data
              ct_cr_diag    = ct_cr_diag ).
        ENDLOOP.
      CATCH cx_root INTO DATA(lx_fugr_parts).
        append_diag(
          EXPORTING iv_text = |SKIP FUGR { iv_fugr_name }: cannot expand function group parts - { lx_fugr_parts->get_text( ) }|
          CHANGING  ct_cr_diag = ct_cr_diag ).
    ENDTRY.
    result = boolc( lines( ct_acr_stats ) > lv_before ).
  ENDMETHOD.


  METHOD precompute_part.
    " Generated Gateway/SEGW classes (MPC, MPC_EXT, DPC) are regenerated from the
    " OData model — nothing in them is a hand-written change. Checked here as well
    " as in the workflow so class expansion (CPUB/CPRI/METH parts) cannot slip one
    " through. DPC_EXT is not matched and stays reviewable.
    IF is_options-ignore_generated = abap_true
       AND ( zcl_vx_review_prepare=>is_generated_class( is_part-object_name ) = abap_true
          OR ( is_part-class IS NOT INITIAL
           AND zcl_vx_review_prepare=>is_generated_class( is_part-class ) = abap_true ) ).
      append_diag(
        EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: generated Gateway class (MPC / MPC_EXT / DPC)|
        CHANGING  ct_cr_diag = ct_cr_diag ).
      RETURN.
    ENDIF.

    " Deleted object with surviving version history. Checked here as well as in
    " the workflow so a part that comes out of a class or function-group
    " expansion — a deleted method, the sections of a deleted class — cannot slip
    " through and be reviewed as if it had just been written.
    IF zcl_vx_review_prepare=>is_deleted_object( is_part ) = abap_true.
      append_diag(
        EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: object does not exist any more (deleted, versions kept)|
        CHANGING  ct_cr_diag = ct_cr_diag ).
      RETURN.
    ENDIF.

    IF is_part-type = 'CLAS'.
      append_diag(
        EXPORTING iv_text = |SKIP CLAS { is_part-object_name }: aggregate row has no direct diff source|
        CHANGING  ct_cr_diag = ct_cr_diag ).
      RETURN.
    ENDIF.

    IF is_part-type = 'FUGR'.
      append_diag(
        EXPORTING iv_text = |SKIP FUGR { is_part-object_name }: aggregate row has no direct diff source|
        CHANGING  ct_cr_diag = ct_cr_diag ).
      RETURN.
    ENDIF.

    DATA(ls_effective_part) = is_part.
    IF ls_effective_part-class IS INITIAL.
      CASE ls_effective_part-type.
        WHEN 'CPUB' OR 'CPRO' OR 'CPRI' OR 'CLSD' OR 'CINC' OR 'CDEF' OR 'METH'.
          DATA(lv_effective_objname) = CONV string( ls_effective_part-object_name ).
          FIND FIRST OCCURRENCE OF '=' IN lv_effective_objname MATCH OFFSET DATA(lv_effective_eq).
          IF sy-subrc = 0 AND lv_effective_eq > 0.
            ls_effective_part-class = CONV #( lv_effective_objname(lv_effective_eq) ).
          ELSEIF ls_effective_part-type <> 'METH'.
            ls_effective_part-class = CONV #( ls_effective_part-object_name ).
          ENDIF.
      ENDCASE.
    ENDIF.


    DATA ls_new    TYPE ty_version_row.
    DATA ls_old    TYPE ty_version_row.
    DATA ls_remote TYPE ty_version_row.
    load_versions(
      EXPORTING
        iv_objtype        = is_part-type
        iv_objname        = is_part-object_name
        is_options        = is_options
      IMPORTING
        ev_new_version    = ls_new
        ev_old_version    = ls_old
        ev_retro_old_version = DATA(ls_retro_old)
        ev_remote_version = ls_remote
      CHANGING
        ct_versions       = ct_versions ).
    append_diag(
      EXPORTING iv_text = |REMOTE { is_part-type } { is_part-object_name }: system={ ls_remote-system }, versno={ ls_remote-versno }, opt_sys={ is_options-system }|
      CHANGING  ct_cr_diag = ct_cr_diag ).
    IF ct_versions IS INITIAL
       AND ( is_options-filter_korrnum IS NOT INITIAL
          OR is_options-filter_korrnums IS NOT INITIAL
          OR is_options-filter_parent_korrnums IS NOT INITIAL ).
      append_diag(
        EXPORTING iv_text = |FALLBACK { is_part-type } { is_part-object_name }: no versions in selected request scope, probing active source|
        CHANGING  ct_cr_diag = ct_cr_diag ).
    ENDIF.
    DATA(lv_scope_korrnum) = is_options-filter_korrnum.
    IF lv_scope_korrnum IS INITIAL.
      READ TABLE is_options-filter_korrnums INTO DATA(ls_scope_korrnum) INDEX 1.
      IF sy-subrc = 0.
        lv_scope_korrnum = ls_scope_korrnum-low.
      ENDIF.
    ENDIF.
    IF lv_scope_korrnum IS INITIAL.
      READ TABLE is_options-filter_parent_korrnums INTO DATA(ls_scope_parent_korrnum) INDEX 1.
      IF sy-subrc = 0.
        lv_scope_korrnum = ls_scope_parent_korrnum-low.
      ENDIF.
    ENDIF.
    DATA lt_active_probe TYPE abaptxt255_tab.
    IF ct_versions IS INITIAL.
      lt_active_probe = zcl_vx_version2=>get_source_local_compat(
        iv_objtype = is_part-type
        iv_objname = is_part-object_name
        iv_versno  = zcl_vx_version=>c_version-active
        iv_korrnum = lv_scope_korrnum
        iv_author  = sy-uname
        iv_datum   = sy-datum
        iv_zeit    = sy-uzeit ).
      " DDIC structured objects (table/domain/data element) have no line source;
      " probe the active dictionary definition instead so a synthetic active
      " version row is still created for newly created objects.
      IF lt_active_probe IS INITIAL
         AND ( is_part-type = 'TABD' OR is_part-type = 'DOMD' OR is_part-type = 'DTED' ).
        TRY.
            CASE is_part-type.
              WHEN 'TABD'.
                zcl_vx_version2=>get_tabd(
                  iv_objname = is_part-object_name
                  iv_versno  = zcl_vx_version=>c_version-active ).
              WHEN 'DOMD'.
                zcl_vx_version2=>get_doma(
                  iv_objname = is_part-object_name
                  iv_versno  = zcl_vx_version=>c_version-active ).
              WHEN 'DTED'.
                zcl_vx_version2=>get_dtel(
                  iv_objname = is_part-object_name
                  iv_versno  = zcl_vx_version=>c_version-active ).
            ENDCASE.
            " Mark the active definition as present (content unused for DDIC types).
            APPEND `X` TO lt_active_probe.
          CATCH zcx_vx.
        ENDTRY.
      ENDIF.
      IF lt_active_probe IS INITIAL
         AND is_part-type = 'METH'
         AND is_part-class IS NOT INITIAL
         AND is_part-name IS NOT INITIAL.
        DATA lv_meth_cl_key TYPE seoclskey.
        DATA lt_meth_includes TYPE seop_methods_w_include.
        lv_meth_cl_key = is_part-class.
        CALL FUNCTION 'SEO_CLASS_GET_METHOD_INCLUDES'
          EXPORTING
            clskey   = lv_meth_cl_key
          IMPORTING
            includes = lt_meth_includes
          EXCEPTIONS
            _internal_class_not_existing = 1
            OTHERS                       = 2.
        IF sy-subrc = 0.
          LOOP AT lt_meth_includes INTO DATA(ls_meth_include).
            CHECK ls_meth_include-cpdkey-cpdname = is_part-name.
            READ REPORT ls_meth_include-incname INTO lt_active_probe.
            IF sy-subrc = 0 AND lt_active_probe IS NOT INITIAL.
              append_diag(
                EXPORTING iv_text = |NEW OBJECT { is_part-type } { is_part-object_name }: active method include { ls_meth_include-incname } read|
                CHANGING  ct_cr_diag = ct_cr_diag ).
            ENDIF.
            EXIT.
          ENDLOOP.
        ENDIF.
      ENDIF.
      IF lt_active_probe IS NOT INITIAL.
        DATA(lv_synth_trfunction) = VALUE e070-trfunction( ).
        IF lv_scope_korrnum IS NOT INITIAL.
          SELECT SINGLE trfunction
            FROM e070
            WHERE trkorr = @lv_scope_korrnum
            INTO @lv_synth_trfunction.
        ENDIF.
        APPEND VALUE ty_version_row(
          versno         = zcl_vx_version=>c_version-active
          versno_text    = `Active`
          datum          = sy-datum
          zeit           = sy-uzeit
          author         = sy-uname
          author_name    = zcl_vx_vers_data=>get_user_name( sy-uname )
          obj_owner      = sy-uname
          obj_owner_name = zcl_vx_vers_data=>get_user_name( sy-uname )
          korrnum        = lv_scope_korrnum
          " Scope is the task itself (S or R) — no matching, no date involved.
          task           = COND #( WHEN lv_synth_trfunction = 'S'
                                     OR lv_synth_trfunction = 'R' THEN lv_scope_korrnum ELSE `` )
          objtype        = is_part-type
          objname        = is_part-object_name
          trfunction     = lv_synth_trfunction ) TO ct_versions.
        " load returned nothing so pair fields are empty; derive from synthetic row.
        IF ls_new IS INITIAL.
          READ TABLE ct_versions INTO ls_new INDEX 1.
        ENDIF.
        append_diag(
          EXPORTING iv_text = |NEW OBJECT { is_part-type } { is_part-object_name }: no versions, active source found|
          CHANGING  ct_cr_diag = ct_cr_diag ).
      ENDIF.
    ENDIF.
    IF ct_versions IS INITIAL.
      append_diag(
        EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: no versions after filters; filter TR={ is_options-filter_korrnum }, date_from={ is_options-date_from }|
        CHANGING  ct_cr_diag = ct_cr_diag ).
      RETURN.
    ENDIF.

    append_diag(
      EXPORTING iv_text = |VERS { is_part-type } { is_part-object_name }: { lines( ct_versions ) } version(s) after filters|
      CHANGING  ct_cr_diag = ct_cr_diag ).
    LOOP AT ct_versions INTO DATA(ls_vdiag).
      append_diag(
        EXPORTING iv_text = |  VER { ls_vdiag-versno_text }/{ ls_vdiag-versno } trf={ ls_vdiag-trfunction } korr={ ls_vdiag-korrnum } task={ ls_vdiag-task }|
        CHANGING  ct_cr_diag = ct_cr_diag ).
    ENDLOOP.
    append_diag(
      EXPORTING iv_text = |  >> PICKED new={ ls_new-versno_text }/{ ls_new-versno } trf={ ls_new-trfunction } korr={ ls_new-korrnum } | &&
                          |old={ ls_old-versno_text }/{ ls_old-versno } trf={ ls_old-trfunction } korr={ ls_old-korrnum }|
      CHANGING  ct_cr_diag = ct_cr_diag ).

    " Pair (ls_new / ls_old) comes from load_versions → zcl_vx_version_list=>load.
    " No separate select_diff_pair call; scope is derived once from user-selected K.
    CHECK ls_new IS NOT INITIAL.

    " Exclude SAP auto-generated code (e.g. function-group framework includes
    " SAPL<area> / L<area>UXX, authored by 'SAP*') from Code Review — it is not
    " reviewable and pollutes the developer list.
    IF is_options-ignore_generated = abap_true
       AND zcl_vx_review_prepare=>is_sap_generated_author( ls_new-author ) = abap_true.
      append_diag(
        EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: SAP auto-generated code (author { ls_new-author })|
        CHANGING  ct_cr_diag = ct_cr_diag ).
      RETURN.
    ENDIF.

    DATA(lv_is_created) = COND abap_bool( WHEN ls_old IS INITIAL THEN abap_true ELSE abap_false ).
    DATA(lv_versno_new) = ls_new-versno.
    DATA(lv_tadir_author) = VALUE versuser( ).

    DATA(lv_diag_old_pair) = COND string(
      WHEN ls_old IS INITIAL THEN `(empty/new object)`
      ELSE |{ ls_old-versno_text }/{ ls_old-versno }| ).
    append_diag(
      EXPORTING iv_text = |PAIR { is_part-type } { is_part-object_name }: new={ ls_new-versno_text }/{ lv_versno_new }, old={ lv_diag_old_pair }|
      CHANGING  ct_cr_diag = ct_cr_diag ).

    " Why the pair ends where it ends. Read straight from VRSD, so a version the
    " scope filter dropped still shows up here — that is the whole point: a
    " transport of copies carries the request's change under its own number, and
    " when it is written after the request's own version, ending the review on
    " the request's version means reviewing one version less than what will move.
    " KEPT=X means the version survived into the reviewed list.
    IF is_options-debug = abap_true.
      " The scope the versions are matched against, exactly as the popup passed
      " it — the other half of the answer to "why did the review stop there".
      DATA(lv_scope_sel) = ``.
      LOOP AT is_options-filter_korrnums INTO DATA(ls_scope_flt).
        CHECK ls_scope_flt-low IS NOT INITIAL.
        lv_scope_sel = COND string( WHEN lv_scope_sel IS INITIAL THEN CONV string( ls_scope_flt-low )
                                    ELSE |{ lv_scope_sel },{ ls_scope_flt-low }| ).
      ENDLOOP.
      DATA(lv_scope_par) = ``.
      LOOP AT is_options-filter_parent_korrnums INTO DATA(ls_scope_par_flt).
        CHECK ls_scope_par_flt-low IS NOT INITIAL.
        lv_scope_par = COND string( WHEN lv_scope_par IS INITIAL THEN CONV string( ls_scope_par_flt-low )
                                    ELSE |{ lv_scope_par },{ ls_scope_par_flt-low }| ).
      ENDLOOP.
      append_diag(
        EXPORTING iv_text = |VSCOPE-IN { is_part-type } { is_part-object_name }: | &&
                            |korr={ is_options-filter_korrnum } | &&
                            |tasks={ COND string( WHEN lv_scope_sel IS INITIAL THEN `(none)` ELSE lv_scope_sel ) } | &&
                            |parents={ COND string( WHEN lv_scope_par IS INITIAL THEN `(none)` ELSE lv_scope_par ) }|
        CHANGING  ct_cr_diag = ct_cr_diag ).

      SELECT versno, korrnum FROM vrsd
        WHERE objtype = @is_part-type
          AND objname = @is_part-object_name
          AND versno <> '00000'
        ORDER BY versno DESCENDING
        INTO TABLE @DATA(lt_scope_top)
        UP TO 5 ROWS.
      LOOP AT lt_scope_top INTO DATA(ls_scope_top).
        DATA(lv_scope_ext) = zcl_vx_versno=>to_external( ls_scope_top-versno ).
        DATA(lv_scope_parents) = ``.
        LOOP AT zcl_vx_request=>resolve_parent_k( ls_scope_top-korrnum ) INTO DATA(ls_scope_parent).
          CHECK ls_scope_parent-low IS NOT INITIAL.
          lv_scope_parents = COND string(
            WHEN lv_scope_parents IS INITIAL THEN CONV string( ls_scope_parent-low )
            ELSE |{ lv_scope_parents },{ ls_scope_parent-low }| ).
        ENDLOOP.
        READ TABLE ct_versions TRANSPORTING NO FIELDS
          WITH KEY objtype = is_part-type
                   objname = is_part-object_name
                   versno  = lv_scope_ext.
        DATA(lv_scope_kept) = COND string( WHEN sy-subrc = 0 THEN `X` ELSE `-` ).
        DATA(ls_scope_hdr) = zcl_vx_request=>get_header( ls_scope_top-korrnum ).
        append_diag(
          EXPORTING iv_text = |VSCOPE { is_part-type } { is_part-object_name }: | &&
                              |v{ CONV string( lv_scope_ext + 0 ) } korr={ ls_scope_top-korrnum } | &&
                              |trf={ ls_scope_hdr-trfunction } strkorr={ ls_scope_hdr-strkorr } | &&
                              |parents={ COND string( WHEN lv_scope_parents IS INITIAL THEN `(none)` ELSE lv_scope_parents ) } | &&
                              |kept={ lv_scope_kept }|
          CHANGING  ct_cr_diag = ct_cr_diag ).
      ENDLOOP.
    ENDIF.
    IF lv_is_created = abap_true.
      DATA(ls_author_lookup) = zcl_vx_review_prepare=>get_created_object_author( is_part ).
      lv_tadir_author = ls_author_lookup-author.
      LOOP AT ls_author_lookup-diag_lines INTO DATA(lv_author_diag).
        append_diag(
          EXPORTING iv_text = lv_author_diag
          CHANGING  ct_cr_diag = ct_cr_diag ).
      ENDLOOP.
    ENDIF.

    DATA(lv_versno_old) = ls_old-versno.

    IF is_options-filter_user IS NOT INITIAL.
      DATA(lv_effective_author) = COND versuser(
        WHEN lv_is_created = abap_true AND lv_tadir_author IS NOT INITIAL THEN lv_tadir_author
        WHEN ls_new-obj_owner IS NOT INITIAL THEN ls_new-obj_owner
        ELSE ls_new-author ).
      IF lv_effective_author <> is_options-filter_user.
        append_diag(
          EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: author filter { is_options-filter_user }, effective author { lv_effective_author }|
          CHANGING  ct_cr_diag = ct_cr_diag ).
        RETURN.
      ENDIF.
    ENDIF.

    " ── Dictionary tables: structured field-level review, one hunk per table ──
    IF is_part-type = 'TABD'.
      TRY.
          DATA ls_tabd_o TYPE zif_vx_vers_types=>ty_tabd.
          IF lv_is_created = abap_false.
            ls_tabd_o = zcl_vx_version2=>get_tabd(
              iv_objname = is_part-object_name
              iv_versno  = lv_versno_old
              iv_system  = ls_old-system ).
          ENDIF.
          DATA(ls_tabd_n) = zcl_vx_version2=>get_tabd(
            iv_objname = is_part-object_name
            iv_versno  = lv_versno_new
            iv_system  = ls_new-system ).

          " Field-level counts (added / changed / deleted)
          DATA lv_t_add TYPE i.
          DATA lv_t_chg TYPE i.
          DATA lv_t_del TYPE i.
          LOOP AT ls_tabd_n-fields INTO DATA(ls_nf).
            READ TABLE ls_tabd_o-fields INTO DATA(ls_of) WITH KEY fieldname = ls_nf-fieldname.
            IF sy-subrc <> 0.
              " New field (for a created table every field counts as added).
              lv_t_add = lv_t_add + 1.
            ELSEIF ls_nf-keyflag    <> ls_of-keyflag
                OR ls_nf-rollname   <> ls_of-rollname
                OR ls_nf-checktable <> ls_of-checktable
                OR ls_nf-datatype   <> ls_of-datatype
                OR ls_nf-leng       <> ls_of-leng
                OR ls_nf-decimals   <> ls_of-decimals
                OR ls_nf-ddtext     <> ls_of-ddtext.
              lv_t_chg = lv_t_chg + 1.
            ENDIF.
          ENDLOOP.
          IF lv_is_created = abap_false.
            LOOP AT ls_tabd_o-fields INTO DATA(ls_df).
              IF NOT line_exists( ls_tabd_n-fields[ fieldname = ls_df-fieldname ] ).
                lv_t_del = lv_t_del + 1.
              ENDIF.
            ENDLOOP.
          ENDIF.

          " A newly created table must always appear in the report, even when empty —
          " count the object itself as one insertion.
          IF lv_is_created = abap_true AND lv_t_add = 0 AND lv_t_chg = 0.
            lv_t_add = 1.
          ENDIF.

          IF lv_is_created = abap_false AND lv_t_add = 0 AND lv_t_chg = 0 AND lv_t_del = 0.
            append_diag(
              EXPORTING iv_text = |SKIP TABD { is_part-object_name }: no field changes|
              CHANGING  ct_cr_diag = ct_cr_diag ).
            RETURN.
          ENDIF.

          DATA(lv_meta_tabd) = COND string(
            WHEN lv_is_created = abap_true THEN |{ ls_new-versno_text } → (new object)|
            ELSE |{ ls_new-versno_text } → { ls_old-versno_text }| ).


          DATA(lv_tabd_author) = COND versuser(
            WHEN lv_is_created = abap_true AND lv_tadir_author IS NOT INITIAL THEN lv_tadir_author
            WHEN ls_new-obj_owner IS NOT INITIAL THEN ls_new-obj_owner
            ELSE ls_new-author ).
          DATA(lv_tabd_kind) = COND string(
            WHEN lv_t_add > 0 AND lv_t_del = 0 AND lv_t_chg = 0 THEN `added`
            WHEN lv_t_del > 0 AND lv_t_add = 0 AND lv_t_chg = 0 THEN `deleted`
            ELSE                                                     `changed` ).

          " Object-level diff cache (both pane variants share the same table html).

          " Persisted counterpart of the cache above. A DDIC page has no line
          " diff to be re-rendered from, and BUILD_SAVE_PAYLOAD clears every hunk
          " html, so a reopened review had nothing left to show for this table
          " ("Diff not available") although its field counts were still there.
          DELETE ct_diff_data WHERE key-objtype = is_part-type
                                AND key-objname = is_part-object_name.
          INSERT VALUE zif_vx_review_types=>ty_diff_data(
            key  = VALUE #(
              objtype     = is_part-type
              objname     = is_part-object_name
              versno_o    = lv_versno_old
              versno_n    = lv_versno_new
              blame       = is_options-blame
              ignore_case = is_options-ignore_case )
            title      = |{ is_part-type }: { is_part-object_name }|
            is_created = lv_is_created )
            INTO TABLE ct_diff_data.

          " Single hunk for the entire table.
          DELETE ct_hunk_info WHERE objtype = is_part-type AND obj_name = is_part-object_name.
          INSERT VALUE zif_vx_review_types=>ty_hunk_info(
            hunk_key        = |{ is_part-type }~{ is_part-object_name }~1|
            objtype         = is_part-type
            obj_name        = is_part-object_name
            class_name      = CONV #( ls_effective_part-class )
            display_name    = CONV string( is_part-name )
            hunk_no         = 1
            start_line      = 1
            change_count    = lv_t_add + lv_t_chg + lv_t_del
            change_kind     = lv_tabd_kind
            author          = lv_tabd_author
            author_name     = zcl_vx_vers_data=>get_user_name( lv_tabd_author )
            versno_new      = lv_versno_new
            versno_old      = lv_versno_old
            versno_new_text = ls_new-versno_text
            versno_old_text = ls_old-versno_text )
            INTO TABLE ct_hunk_info.

          " Object statistics (one hunk).
          DATA lt_tabd_auth TYPE zif_vx_review_types=>ty_t_author_stats.
          APPEND VALUE zif_vx_review_types=>ty_author_stats(
            author      = lv_tabd_author
            author_name = zcl_vx_vers_data=>get_user_name( lv_tabd_author )
            ins_count   = lv_t_add
            del_count   = lv_t_del
            mod_count   = lv_t_chg
            hunk_count  = 1 ) TO lt_tabd_auth.
          APPEND VALUE zif_vx_review_types=>ty_obj_stats(
            objtype      = is_part-type
            class_name   = CONV #( ls_effective_part-class )
            obj_name     = is_part-object_name
            display_name = CONV string( is_part-name )
            versno_new   = lv_versno_new
            versno_old   = lv_versno_old
            author       = lv_tabd_author
            author_name  = zcl_vx_vers_data=>get_user_name( lv_tabd_author )
            datum        = ls_new-datum
            zeit         = ls_new-zeit
            ins_count    = lv_t_add
            del_count    = lv_t_del
            mod_count    = lv_t_chg
            hunk_count   = 1
            hunk_ins     = COND #( WHEN lv_tabd_kind = `added`   THEN 1 ELSE 0 )
            hunk_mod     = COND #( WHEN lv_tabd_kind = `changed` THEN 1 ELSE 0 )
            hunk_del     = COND #( WHEN lv_tabd_kind = `deleted` THEN 1 ELSE 0 )
            bt_authors   = lt_tabd_auth
            is_created   = lv_is_created ) TO ct_acr_stats.

          append_diag(
            EXPORTING iv_text = |TABD { is_part-object_name }: +{ lv_t_add }/~{ lv_t_chg }/-{ lv_t_del }, single hunk|
            CHANGING  ct_cr_diag = ct_cr_diag ).
        CATCH zcx_vx INTO DATA(lx_tabd).
          append_diag(
            EXPORTING iv_text = |SKIP TABD { is_part-object_name }: { lx_tabd->get_text( ) }|
            CHANGING  ct_cr_diag = ct_cr_diag ).
      ENDTRY.
      RETURN.
    ENDIF.

    " ── Dictionary domains: structured fixed-value review, one hunk per domain ──
    IF is_part-type = 'DOMD'.
      TRY.
          DATA ls_doma_o TYPE zif_vx_vers_types=>ty_doma.
          IF lv_is_created = abap_false.
            ls_doma_o = zcl_vx_version2=>get_doma(
              iv_objname = is_part-object_name
              iv_versno  = lv_versno_old
              iv_system  = ls_old-system ).
          ENDIF.
          DATA(ls_doma_n) = zcl_vx_version2=>get_doma(
            iv_objname = is_part-object_name
            iv_versno  = lv_versno_new
            iv_system  = ls_new-system ).

          " Value-level counts (added / changed / deleted)
          DATA lv_d_add TYPE i.
          DATA lv_d_chg TYPE i.
          DATA lv_d_del TYPE i.
          LOOP AT ls_doma_n-values INTO DATA(ls_nv).
            READ TABLE ls_doma_o-values INTO DATA(ls_ov)
              WITH KEY domvalue_l = ls_nv-domvalue_l domvalue_h = ls_nv-domvalue_h.
            IF sy-subrc <> 0.
              " New value (for a created domain every value counts as added).
              lv_d_add = lv_d_add + 1.
            ELSEIF ls_nv-ddtext <> ls_ov-ddtext.
              lv_d_chg = lv_d_chg + 1.
            ENDIF.
          ENDLOOP.
          IF lv_is_created = abap_false.
            LOOP AT ls_doma_o-values INTO DATA(ls_dv).
              IF NOT line_exists( ls_doma_n-values[ domvalue_l = ls_dv-domvalue_l domvalue_h = ls_dv-domvalue_h ] ).
                lv_d_del = lv_d_del + 1.
              ENDIF.
            ENDLOOP.
          ENDIF.

          " A newly created domain must always appear in the report, even when it has
          " no fixed values — count the object itself as one insertion.
          IF lv_is_created = abap_true AND lv_d_add = 0 AND lv_d_chg = 0.
            lv_d_add = 1.
          ENDIF.

          IF lv_is_created = abap_false AND lv_d_add = 0 AND lv_d_chg = 0 AND lv_d_del = 0.
            append_diag(
              EXPORTING iv_text = |SKIP DOMA { is_part-object_name }: no value changes|
              CHANGING  ct_cr_diag = ct_cr_diag ).
            RETURN.
          ENDIF.

          DATA(lv_meta_doma) = COND string(
            WHEN lv_is_created = abap_true THEN |{ ls_new-versno_text } → (new object)|
            ELSE |{ ls_new-versno_text } → { ls_old-versno_text }| ).


          DATA(lv_doma_author) = COND versuser(
            WHEN lv_is_created = abap_true AND lv_tadir_author IS NOT INITIAL THEN lv_tadir_author
            WHEN ls_new-obj_owner IS NOT INITIAL THEN ls_new-obj_owner
            ELSE ls_new-author ).
          DATA(lv_doma_kind) = COND string(
            WHEN lv_d_add > 0 AND lv_d_del = 0 AND lv_d_chg = 0 THEN `added`
            WHEN lv_d_del > 0 AND lv_d_add = 0 AND lv_d_chg = 0 THEN `deleted`
            ELSE                                                     `changed` ).

          " Object-level diff cache (both pane variants share the same domain html).

          " Persisted counterpart of the cache above. A DDIC page has no line
          " diff to be re-rendered from, and BUILD_SAVE_PAYLOAD clears every hunk
          " html, so a reopened review had nothing left to show for this domain
          " ("Diff not available") although its field counts were still there.
          DELETE ct_diff_data WHERE key-objtype = is_part-type
                                AND key-objname = is_part-object_name.
          INSERT VALUE zif_vx_review_types=>ty_diff_data(
            key  = VALUE #(
              objtype     = is_part-type
              objname     = is_part-object_name
              versno_o    = lv_versno_old
              versno_n    = lv_versno_new
              blame       = is_options-blame
              ignore_case = is_options-ignore_case )
            title      = |{ is_part-type }: { is_part-object_name }|
            is_created = lv_is_created )
            INTO TABLE ct_diff_data.

          " Single hunk for the entire domain.
          DELETE ct_hunk_info WHERE objtype = is_part-type AND obj_name = is_part-object_name.
          INSERT VALUE zif_vx_review_types=>ty_hunk_info(
            hunk_key        = |{ is_part-type }~{ is_part-object_name }~1|
            objtype         = is_part-type
            obj_name        = is_part-object_name
            class_name      = CONV #( ls_effective_part-class )
            display_name    = CONV string( is_part-name )
            hunk_no         = 1
            start_line      = 1
            change_count    = lv_d_add + lv_d_chg + lv_d_del
            change_kind     = lv_doma_kind
            author          = lv_doma_author
            author_name     = zcl_vx_vers_data=>get_user_name( lv_doma_author )
            versno_new      = lv_versno_new
            versno_old      = lv_versno_old
            versno_new_text = ls_new-versno_text
            versno_old_text = ls_old-versno_text )
            INTO TABLE ct_hunk_info.

          " Object statistics (one hunk).
          DATA lt_doma_auth TYPE zif_vx_review_types=>ty_t_author_stats.
          APPEND VALUE zif_vx_review_types=>ty_author_stats(
            author      = lv_doma_author
            author_name = zcl_vx_vers_data=>get_user_name( lv_doma_author )
            ins_count   = lv_d_add
            del_count   = lv_d_del
            mod_count   = lv_d_chg
            hunk_count  = 1 ) TO lt_doma_auth.
          APPEND VALUE zif_vx_review_types=>ty_obj_stats(
            objtype      = is_part-type
            class_name   = CONV #( ls_effective_part-class )
            obj_name     = is_part-object_name
            display_name = CONV string( is_part-name )
            versno_new   = lv_versno_new
            versno_old   = lv_versno_old
            author       = lv_doma_author
            author_name  = zcl_vx_vers_data=>get_user_name( lv_doma_author )
            datum        = ls_new-datum
            zeit         = ls_new-zeit
            ins_count    = lv_d_add
            del_count    = lv_d_del
            mod_count    = lv_d_chg
            hunk_count   = 1
            hunk_ins     = COND #( WHEN lv_doma_kind = `added`   THEN 1 ELSE 0 )
            hunk_mod     = COND #( WHEN lv_doma_kind = `changed` THEN 1 ELSE 0 )
            hunk_del     = COND #( WHEN lv_doma_kind = `deleted` THEN 1 ELSE 0 )
            bt_authors   = lt_doma_auth
            is_created   = lv_is_created ) TO ct_acr_stats.

          append_diag(
            EXPORTING iv_text = |DOMA { is_part-object_name }: +{ lv_d_add }/~{ lv_d_chg }/-{ lv_d_del }, single hunk|
            CHANGING  ct_cr_diag = ct_cr_diag ).
        CATCH zcx_vx INTO DATA(lx_doma).
          append_diag(
            EXPORTING iv_text = |SKIP DOMA { is_part-object_name }: { lx_doma->get_text( ) }|
            CHANGING  ct_cr_diag = ct_cr_diag ).
      ENDTRY.
      RETURN.
    ENDIF.

    " ── Data elements: structured attribute review, one hunk per data element ──
    IF is_part-type = 'DTED'.
      TRY.
          DATA ls_dtel_o TYPE zif_vx_vers_types=>ty_dtel.
          IF lv_is_created = abap_false.
            ls_dtel_o = zcl_vx_version2=>get_dtel(
              iv_objname = is_part-object_name
              iv_versno  = lv_versno_old
              iv_system  = ls_old-system ).
          ENDIF.
          DATA(ls_dtel_n) = zcl_vx_version2=>get_dtel(
            iv_objname = is_part-object_name
            iv_versno  = lv_versno_new
            iv_system  = ls_new-system ).

          " Attribute-level change count (compare the relevant DD04V attributes).
          DATA lv_e_chg TYPE i.
          IF lv_is_created = abap_false.
            IF ls_dtel_n-domname   <> ls_dtel_o-domname.   lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-datatype  <> ls_dtel_o-datatype.  lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-leng      <> ls_dtel_o-leng.      lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-decimals  <> ls_dtel_o-decimals.  lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-outputlen <> ls_dtel_o-outputlen. lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-convexit  <> ls_dtel_o-convexit.  lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-lowercase <> ls_dtel_o-lowercase. lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-signflag  <> ls_dtel_o-signflag.  lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-shlpname  <> ls_dtel_o-shlpname.  lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-shlpfield <> ls_dtel_o-shlpfield. lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-memoryid  <> ls_dtel_o-memoryid.  lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-ddtext    <> ls_dtel_o-ddtext.    lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-reptext   <> ls_dtel_o-reptext.   lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-scrtext_s <> ls_dtel_o-scrtext_s. lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-scrtext_m <> ls_dtel_o-scrtext_m. lv_e_chg = lv_e_chg + 1. ENDIF.
            IF ls_dtel_n-scrtext_l <> ls_dtel_o-scrtext_l. lv_e_chg = lv_e_chg + 1. ENDIF.
          ENDIF.

          IF lv_is_created = abap_false AND lv_e_chg = 0.
            append_diag(
              EXPORTING iv_text = |SKIP DTEL { is_part-object_name }: no attribute changes|
              CHANGING  ct_cr_diag = ct_cr_diag ).
            RETURN.
          ENDIF.

          DATA(lv_meta_dtel) = COND string(
            WHEN lv_is_created = abap_true THEN |{ ls_new-versno_text } → (new object)|
            ELSE |{ ls_new-versno_text } → { ls_old-versno_text }| ).


          DATA(lv_dtel_author) = COND versuser(
            WHEN lv_is_created = abap_true AND lv_tadir_author IS NOT INITIAL THEN lv_tadir_author
            WHEN ls_new-obj_owner IS NOT INITIAL THEN ls_new-obj_owner
            ELSE ls_new-author ).
          DATA(lv_dtel_kind) = COND string(
            WHEN lv_is_created = abap_true THEN `added`
            ELSE                                `changed` ).

          " Object-level diff cache (both pane variants share the same html).

          " Persisted counterpart of the cache above. A DDIC page has no line
          " diff to be re-rendered from, and BUILD_SAVE_PAYLOAD clears every hunk
          " html, so a reopened review had nothing left to show for this data element
          " ("Diff not available") although its field counts were still there.
          DELETE ct_diff_data WHERE key-objtype = is_part-type
                                AND key-objname = is_part-object_name.
          INSERT VALUE zif_vx_review_types=>ty_diff_data(
            key  = VALUE #(
              objtype     = is_part-type
              objname     = is_part-object_name
              versno_o    = lv_versno_old
              versno_n    = lv_versno_new
              blame       = is_options-blame
              ignore_case = is_options-ignore_case )
            title      = |{ is_part-type }: { is_part-object_name }|
            is_created = lv_is_created )
            INTO TABLE ct_diff_data.

          " Single hunk for the entire data element.
          DELETE ct_hunk_info WHERE objtype = is_part-type AND obj_name = is_part-object_name.
          INSERT VALUE zif_vx_review_types=>ty_hunk_info(
            hunk_key        = |{ is_part-type }~{ is_part-object_name }~1|
            objtype         = is_part-type
            obj_name        = is_part-object_name
            class_name      = CONV #( ls_effective_part-class )
            display_name    = CONV string( is_part-name )
            hunk_no         = 1
            start_line      = 1
            change_count    = lv_e_chg
            change_kind     = lv_dtel_kind
            author          = lv_dtel_author
            author_name     = zcl_vx_vers_data=>get_user_name( lv_dtel_author )
            versno_new      = lv_versno_new
            versno_old      = lv_versno_old
            versno_new_text = ls_new-versno_text
            versno_old_text = ls_old-versno_text )
            INTO TABLE ct_hunk_info.

          " Object statistics (one hunk). Attribute changes count as modifications.
          DATA lt_dtel_auth TYPE zif_vx_review_types=>ty_t_author_stats.
          APPEND VALUE zif_vx_review_types=>ty_author_stats(
            author      = lv_dtel_author
            author_name = zcl_vx_vers_data=>get_user_name( lv_dtel_author )
            ins_count   = COND #( WHEN lv_is_created = abap_true THEN 1 ELSE 0 )
            del_count   = 0
            mod_count   = lv_e_chg
            hunk_count  = 1 ) TO lt_dtel_auth.
          APPEND VALUE zif_vx_review_types=>ty_obj_stats(
            objtype      = is_part-type
            class_name   = CONV #( ls_effective_part-class )
            obj_name     = is_part-object_name
            display_name = CONV string( is_part-name )
            versno_new   = lv_versno_new
            versno_old   = lv_versno_old
            author       = lv_dtel_author
            author_name  = zcl_vx_vers_data=>get_user_name( lv_dtel_author )
            datum        = ls_new-datum
            zeit         = ls_new-zeit
            ins_count    = COND #( WHEN lv_is_created = abap_true THEN 1 ELSE 0 )
            del_count    = 0
            mod_count    = lv_e_chg
            hunk_count   = 1
            hunk_ins     = COND #( WHEN lv_dtel_kind = `added`   THEN 1 ELSE 0 )
            hunk_mod     = COND #( WHEN lv_dtel_kind = `changed` THEN 1 ELSE 0 )
            hunk_del     = 0
            bt_authors   = lt_dtel_auth
            is_created   = lv_is_created ) TO ct_acr_stats.

          append_diag(
            EXPORTING iv_text = |DTEL { is_part-object_name }: ~{ lv_e_chg } attribute(s), single hunk|
            CHANGING  ct_cr_diag = ct_cr_diag ).
        CATCH zcx_vx INTO DATA(lx_dtel).
          append_diag(
            EXPORTING iv_text = |SKIP DTEL { is_part-object_name }: { lx_dtel->get_text( ) }|
            CHANGING  ct_cr_diag = ct_cr_diag ).
      ENDTRY.
      RETURN.
    ENDIF.

    TRY.
        DATA(lt_src_n) = zcl_vx_version2=>get_source_local_compat(
          iv_objtype = is_part-type
          iv_objname = is_part-object_name
          iv_versno  = lv_versno_new
          iv_korrnum = ls_new-korrnum
          iv_author  = ls_new-author
          iv_datum   = ls_new-datum
          iv_zeit    = ls_new-zeit ).
        IF lt_src_n IS INITIAL
           AND lv_is_created = abap_true
           AND lt_active_probe IS NOT INITIAL.
          lt_src_n = lt_active_probe.
        ENDIF.
        DATA lt_src_o TYPE abaptxt255_tab.
        IF ls_old IS NOT INITIAL.
          IF ls_old-system IS NOT INITIAL.
            lt_src_o = zcl_vx_version2=>get_source_remote(
              iv_objtype = is_part-type
              iv_objname = is_part-object_name
              iv_versno  = lv_versno_old
              iv_system  = ls_old-system ).
          ELSE.
            lt_src_o = zcl_vx_version2=>get_source_local_compat(
              iv_objtype = is_part-type
              iv_objname = is_part-object_name
              iv_versno  = lv_versno_old
              iv_korrnum = ls_old-korrnum
              iv_author  = ls_old-author
              iv_datum   = ls_old-datum
              iv_zeit    = ls_old-zeit ).
          ENDIF.
        ENDIF.


        DATA lt_diff TYPE ty_t_diff.
        IF lv_is_created = abap_true.
          append_diag(
            EXPORTING iv_text = |NEW OBJECT { is_part-type } { is_part-object_name }: no K baseline, whole source is one review block|
            CHANGING  ct_cr_diag = ct_cr_diag ).
          LOOP AT lt_src_n INTO DATA(ls_new_object_line).
            APPEND VALUE ty_diff_op(
              op   = '+'
              text = CONV string( ls_new_object_line ) ) TO lt_diff.
          ENDLOOP.
        ELSE.
          lt_diff = zcl_vx_diff=>compute_diff(
            it_old        = lt_src_o
            it_new        = lt_src_n
            i_title       = CONV #( is_part-object_name )
            i_confirm_key = |DIFF~{ is_part-type }~{ is_part-object_name }|
            i_ignore_case = is_options-ignore_case ).
        ENDIF.

        " Drop false-positive hunks that only touch the generated-timestamp
        " header line (DPC/MPC classes regenerate it on every generation).
        lt_diff = zcl_vx_review_prepare=>strip_generated_ts_diff( lt_diff ).

        IF lv_is_created = abap_true
           AND zcl_vx_review_prepare=>is_comments_only( lt_src_n ) = abap_true.
          append_diag(
            EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: new object contains only comment lines|
            CHANGING  ct_cr_diag = ct_cr_diag ).
          RETURN.
        ENDIF.

        " A newly created class always gets all three section includes, and the
        " unused ones hold nothing but their own 'protected section.' header —
        " no declarations, nothing to review.
        " Removing all declarations from an existing section stays a real change,
        " so the old side must be empty (or absent) as well.
        IF ( is_part-type = 'CPUB' OR is_part-type = 'CPRO' OR is_part-type = 'CPRI' )
           AND zcl_vx_review_prepare=>is_empty_section( lt_src_n ) = abap_true
           AND zcl_vx_review_prepare=>is_empty_section( lt_src_o ) = abap_true.
          append_diag(
            EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: section contains no declarations|
            CHANGING  ct_cr_diag = ct_cr_diag ).
          RETURN.
        ENDIF.

        DATA lt_blame         TYPE ty_blame_map.
        DATA lt_blame_deleted TYPE ty_blame_map.
        IF is_options-blame = abap_true AND ls_old IS NOT INITIAL.
          " Every version of the reviewed range by the same author? Then the
          " replay can only ever attribute lines to that one author, and running
          " a diff per version step buys nothing. Attribute the primary diff to
          " them directly — same result, none of the cost.
          DATA(ls_solo) = single_range_author(
            it_versions = ct_versions
            iv_objtype  = is_part-type
            iv_objname  = is_part-object_name
            iv_from     = lv_versno_old
            iv_to       = lv_versno_new ).

          IF ls_solo-author IS NOT INITIAL.
            append_diag(
              EXPORTING iv_text = |BLAME { is_part-type } { is_part-object_name }: | &&
                                  |single author { ls_solo-author } over { ls_solo-versions } version(s), replay skipped|
              CHANGING  ct_cr_diag = ct_cr_diag ).
            LOOP AT lt_diff INTO DATA(ls_solo_op).
              CASE ls_solo_op-op.
                WHEN '+'.
                  APPEND VALUE zif_vx_vers_types=>ty_blame_entry(
                    text        = ls_solo_op-text
                    author      = ls_solo-author
                    author_name = ls_solo-author_name
                    datum       = ls_solo-datum
                    zeit        = ls_solo-zeit
                    versno_text = ls_solo-versno_text
                    korrnum     = ls_solo-korrnum
                    task        = ls_solo-task
                    task_text   = ls_solo-task_text ) TO lt_blame.
                WHEN '-'.
                  APPEND VALUE zif_vx_vers_types=>ty_blame_entry(
                    text        = ls_solo_op-text
                    author      = ls_solo-author
                    author_name = ls_solo-author_name
                    datum       = ls_solo-datum
                    zeit        = ls_solo-zeit
                    versno_text = ls_solo-versno_text
                    korrnum     = ls_solo-korrnum
                    task        = ls_solo-task
                    task_text   = ls_solo-task_text ) TO lt_blame_deleted.
              ENDCASE.
            ENDLOOP.
          ELSE.
            " Why the shortcut did not apply — the number here is what the model
            " has to predict, and predicting it wrong is what makes an estimate
            " of a second stand next to a measurement of half a minute.
            append_diag(
              EXPORTING iv_text = |BLAME { is_part-type } { is_part-object_name }: | &&
                                  |{ ls_solo-authors } distinct author(s) over { ls_solo-versions } version(s), replay required|
              CHANGING  ct_cr_diag = ct_cr_diag ).
            lt_blame = zcl_vx_diff=>build_blame_map(
              EXPORTING it_versions      = ct_versions
                        i_objtype        = is_part-type
                        i_objname        = is_part-object_name
                        i_from           = lv_versno_old
                        i_to             = lv_versno_new
                        i_title          = |{ is_part-type }: { is_part-object_name }|
              IMPORTING et_blame_deleted = lt_blame_deleted ).
          ENDIF.
        ELSEIF is_options-blame = abap_true AND lv_is_created = abap_true.
          DATA(lv_new_obj_author) = COND versuser(
            WHEN lv_tadir_author IS NOT INITIAL THEN lv_tadir_author
            WHEN ls_new-obj_owner IS NOT INITIAL THEN ls_new-obj_owner
            ELSE ls_new-author ).
          DATA(lv_new_obj_author_name) = zcl_vx_vers_data=>get_user_name( lv_new_obj_author ).
          LOOP AT lt_src_n INTO DATA(ls_src_new_line).
            APPEND VALUE zif_vx_vers_types=>ty_blame_entry(
              text        = CONV string( ls_src_new_line )
              author      = lv_new_obj_author
              author_name = lv_new_obj_author_name
              datum       = ls_new-datum
              zeit        = ls_new-zeit
              versno_text = ls_new-versno_text
              korrnum     = ls_new-korrnum
              task        = ls_new-task
              task_text   = ls_new-korr_text ) TO lt_blame.
          ENDLOOP.
        ENDIF.


        DATA(lv_meta_cr) = COND string(
          WHEN lv_is_created = abap_true
          THEN |{ ls_new-versno_text } → (new object)|
          ELSE |{ ls_new-versno_text } → { ls_old-versno_text }| ).
        " SINGLE DIFF SOURCE: code review now uses the SAME diff as the version
        " explorer (raw compute_diff output) instead of the CR-only moved-line
        " filter, so both stay byte-for-byte consistent.
        " DO NOT DELETE until tested — the move-detection step is kept here,
        " commented out, in case we want to restore it.
*        DATA(lt_review_diff) = zcl_vx_review_hunks=>filter_moved_lines(
*          it_diff        = lt_diff
*          iv_ignore_case = is_options-ignore_case ).
        DATA(lt_review_diff) = lt_diff.




        INSERT VALUE zif_vx_review_types=>ty_diff_data(
          key = VALUE #(
            objtype       = is_part-type
            objname       = is_part-object_name
            versno_o      = lv_versno_old
            versno_n      = lv_versno_new
            blame         = is_options-blame
            ignore_case   = is_options-ignore_case )
          diff          = lt_review_diff
          blame_map     = lt_blame
          blame_deleted = lt_blame_deleted
          huge_source   = COND #( WHEN lines( lt_src_o ) > 10000 OR lines( lt_src_n ) > 10000
                                  THEN abap_true ELSE abap_false )
          title         = |{ is_part-type }: { is_part-object_name }|
          meta          = lv_meta_cr
          is_created    = lv_is_created )
          INTO TABLE ct_diff_data.

        " Determined before the statistics: it is also the fallback owner for
        " changed lines the blame replay could not attribute, which keeps the
        " per-author row counts consistent with the per-author block counts.
        DATA(lv_author) = COND versuser(
          WHEN lv_is_created = abap_true AND lv_tadir_author IS NOT INITIAL THEN lv_tadir_author
          WHEN ls_new-obj_owner IS NOT INITIAL THEN ls_new-obj_owner
          ELSE ls_new-author ).

        DATA lv_ins TYPE i. DATA lv_del TYPE i. DATA lv_mod TYPE i.
        DATA lt_auth TYPE zif_vx_review_types=>ty_t_author_stats.
        zcl_vx_review_stats=>from_diff(
          EXPORTING it_diff       = lt_review_diff
                    it_blame      = lt_blame
                    iv_def_author = lv_author
                    iv_def_name   = zcl_vx_vers_data=>get_user_name( lv_author )
          IMPORTING ev_ins        = lv_ins
                    ev_del        = lv_del
                    ev_mod        = lv_mod
                    et_authors    = lt_auth ).

        DATA(lv_datum)  = ls_new-datum.
        DATA(lv_zeit)   = ls_new-zeit.
        DATA(lv_disp_name) = CONV string( is_part-name ).

        DATA lv_hunk_cnt     TYPE i VALUE 0.
        DATA lv_stat_hunk_ins TYPE i VALUE 0.
        DATA lv_stat_hunk_mod TYPE i VALUE 0.
        DATA lv_stat_hunk_del TYPE i VALUE 0.
        DATA lt_part_hunk_info TYPE zif_vx_review_types=>ty_t_hunk_info.

        " Every request this object's version history in THIS system knows —
        " an import records the source request in VRSD, so a foreign number
        " found here is a confirmed retrofit rather than a bare claim.
        DATA lt_obj_korrnums TYPE zif_vx_review_types=>ty_t_korr_found.
        CLEAR lt_obj_korrnums.
        LOOP AT ct_versions INTO DATA(ls_obj_korr_ver)
          WHERE objtype = is_part-type
            AND objname = is_part-object_name
            AND korrnum IS NOT INITIAL.
          INSERT CONV trkorr( ls_obj_korr_ver-korrnum ) INTO TABLE lt_obj_korrnums.
        ENDLOOP.

        DELETE ct_hunk_info WHERE objtype = is_part-type AND obj_name = is_part-object_name.
        zcl_vx_review_hunk_info=>collect(
          EXPORTING
            is_part            = ls_effective_part
            it_diff            = lt_review_diff
            it_blame           = lt_blame
            iv_author          = lv_author
            iv_display_name    = lv_disp_name
            iv_versno_new      = lv_versno_new
            iv_versno_old      = lv_versno_old
            iv_versno_new_text = ls_new-versno_text
            iv_versno_old_text = ls_old-versno_text
            iv_is_created      = lv_is_created
            it_obj_korrnums    = lt_obj_korrnums
          IMPORTING
            et_hunk_info       = lt_part_hunk_info
            ev_hunk_count      = lv_hunk_cnt
            ev_hunk_ins        = lv_stat_hunk_ins
            ev_hunk_mod        = lv_stat_hunk_mod
            ev_hunk_del        = lv_stat_hunk_del ).
        INSERT LINES OF lt_part_hunk_info INTO TABLE ct_hunk_info.

        " Retrofit analysis: when a remote system is configured, compute a second
        " diff (remote -> new) and flag any hunk that is NOT part of the current
        " TR review. Such hunks signal code that will be overwritten or re-inserted
        " in the remote system after the transport is moved.
        " The remote row is a valid retrofit baseline whenever it points to any
        " readable remote version — either the version before our TR (if the TR was
        " already moved there) OR the remote ACTIVE state (99998), which is the
        " current production code our transport will overwrite once moved.
        " Keep-note: the previous logic excluded 00000/Active and treated it as "TR
        " not found -> object new -> skip retrofit". That was wrong: failing to match
        " our cross-system TR by korrnum does NOT mean the object is new in remote.
        " The genuinely-absent case is still caught downstream (empty remote source /
        " no common lines). Original guard kept below for reference:
        "DATA(lv_remote_has_ver) = xsdbool(
        "  ls_remote IS NOT INITIAL
        "  AND ls_remote-versno IS NOT INITIAL
        "  AND ls_remote-versno <> '00000'
        "  AND ls_remote-versno <> zcl_vx_version=>c_version-active ).
        DATA(lv_remote_has_ver) = xsdbool(
          ls_remote IS NOT INITIAL
          AND ls_remote-versno IS NOT INITIAL ).

        IF ls_remote IS NOT INITIAL AND lv_remote_has_ver = abap_false.
          " No readable remote version at all → nothing to compare against.
          append_diag(
            EXPORTING iv_text = |RFTR { is_part-type } { is_part-object_name }: no readable version in { ls_remote-system }, skipping retrofit|
            CHANGING  ct_cr_diag = ct_cr_diag ).
        ELSEIF ls_remote IS NOT INITIAL AND lv_is_created = abap_true.
          " A request is selected but there is no local baseline before it, so the
          " object is effectively new here → no retrofit comparison makes sense.
          append_diag(
            EXPORTING iv_text = |RFTR { is_part-type } { is_part-object_name }: no local baseline before the request (new object), skipping retrofit|
            CHANGING  ct_cr_diag = ct_cr_diag ).
        ELSEIF lv_remote_has_ver = abap_true AND lv_is_created = abap_false.
          TRY.

              DATA lt_src_rmt TYPE abaptxt255_tab.
              lt_src_rmt = zcl_vx_version2=>get_source_remote(
                iv_objtype = is_part-type
                iv_objname = is_part-object_name
                iv_versno  = ls_remote-versno
                iv_system  = ls_remote-system ).

              IF lt_src_rmt IS INITIAL.
                " Object does not exist in the remote system yet → no retrofit needed.
                " A diff against an empty remote would mark the whole object as added,
                " which is meaningless.
                append_diag(
                  EXPORTING iv_text = |RFTR { is_part-type } { is_part-object_name }: object not present in { ls_remote-system } yet, skipping retrofit analysis|
                  CHANGING  ct_cr_diag = ct_cr_diag ).
              ELSE.
                " Secondary diff: remote (old) -> new version
                " Detection, not display: the retrofit diff answers "does this
                " object differ from the other system?", so it is computed on the
                " raw ops and with indentation/case folded away. The other system
                " indents and re-formats independently of ours — letting that
                " through produced violations on lines that are identical there.
                " Both sides down to the same shape first: a versioned read gives
                " the method body, an ACTIVE read wraps it in METHOD/ENDMETHOD.
                DATA(lt_rmt_cmp) = zcl_vx_review_prepare=>strip_method_wrapper( lt_src_rmt ).
                DATA(lt_new_cmp) = zcl_vx_review_prepare=>strip_method_wrapper( lt_src_n ).

                " Snapshot 1 of the subtraction starts where the other system
                " stands: with a series of requests still to move, the ones
                " before the selected one are just as absent over there, and
                " left out of snapshot 1 every line of theirs comes back as a
                " divergence of this request. **The review pair is untouched** —
                " LS_OLD stays what it was, so the review reads identically
                " whether a remote system was entered or not. Only this
                " comparison reaches further back.
                DATA lt_src_retro  TYPE abaptxt255_tab.
                DATA lt_retro_base TYPE abaptxt255_tab.
                CLEAR: lt_src_retro, lt_retro_base.
                IF ls_retro_old IS NOT INITIAL
                   AND ls_retro_old-versno <> lv_versno_old.
                  lt_src_retro = zcl_vx_version2=>get_source_local_compat(
                    iv_objtype = is_part-type
                    iv_objname = is_part-object_name
                    iv_versno  = ls_retro_old-versno
                    iv_korrnum = ls_retro_old-korrnum
                    iv_author  = ls_retro_old-author
                    iv_datum   = ls_retro_old-datum
                    iv_zeit    = ls_retro_old-zeit ).
                  append_diag(
                    EXPORTING iv_text = |RFTR { is_part-type } { is_part-object_name }: | &&
                                        |snapshot 1 from { ls_retro_old-versno_text }/{ ls_retro_old-versno } | &&
                                        |({ ls_retro_old-korrnum }) — the newest version { ls_remote-system } already has; | &&
                                        |review pair stays { ls_old-versno_text }|
                    CHANGING  ct_cr_diag = ct_cr_diag ).
                ENDIF.
                IF lt_src_retro IS NOT INITIAL.
                  lt_retro_base = lt_src_retro.
                ELSE.
                  lt_retro_base = lt_src_o.
                ENDIF.
                DATA(lt_old_cmp) = zcl_vx_review_prepare=>strip_method_wrapper( lt_retro_base ).

                " The whole retrofit analysis rests on one premise: in a system pair
                " that is in sync the other system holds OUR baseline. State it as a
                " check instead of leaving it to emerge from two diffs — when the two
                " sources are the same text, the two diffs are the same script, the
                " subtraction cancels to nothing, and there is nothing to warn about.
                " The remote diff below still runs (its ops are what a violation is
                " rendered from); the check exists so that "why did this object light
                " up at all" is answered by one diagnostics line naming the first
                " line where the other system stopped being our baseline, instead of
                " being reverse-engineered from the hunks.
                DATA lt_base_keys TYPE string_table.
                DATA lt_rmt_keys  TYPE string_table.
                LOOP AT lt_old_cmp INTO DATA(ls_base_ln).
                  DATA(lv_base_key) = norm_cmp_line( ls_base_ln ).
                  IF lv_base_key IS NOT INITIAL.
                    APPEND lv_base_key TO lt_base_keys.
                  ENDIF.
                ENDLOOP.
                LOOP AT lt_rmt_cmp INTO DATA(ls_rmt_ln).
                  DATA(lv_rmt_key2) = norm_cmp_line( ls_rmt_ln ).
                  IF lv_rmt_key2 IS NOT INITIAL.
                    APPEND lv_rmt_key2 TO lt_rmt_keys.
                  ENDIF.
                ENDLOOP.

                DATA(lv_base_eq) = xsdbool( lines( lt_base_keys ) = lines( lt_rmt_keys ) ).
                DATA lv_first_gap TYPE i.
                DATA lv_gap_count TYPE i.
                IF lines( lt_base_keys ) <> lines( lt_rmt_keys ).
                  lv_gap_count = abs( lines( lt_base_keys ) - lines( lt_rmt_keys ) ).
                ENDIF.
                DATA(lv_cmp_i) = 1.
                DATA(lv_cmp_n) = nmin( val1 = lines( lt_base_keys ) val2 = lines( lt_rmt_keys ) ).
                WHILE lv_cmp_i <= lv_cmp_n.
                  IF lt_base_keys[ lv_cmp_i ] <> lt_rmt_keys[ lv_cmp_i ].
                    lv_base_eq = abap_false.
                    lv_gap_count = lv_gap_count + 1.
                    IF lv_first_gap = 0.
                      lv_first_gap = lv_cmp_i.
                    ENDIF.
                  ENDIF.
                  lv_cmp_i = lv_cmp_i + 1.
                ENDWHILE.

                DATA(lv_base_txt) = COND string(
                  WHEN lv_base_eq = abap_true
                  THEN |{ ls_remote-system } holds exactly the review baseline | &&
                       |({ lines( lt_rmt_keys ) } code line(s)), no divergence|
                  ELSE |baseline { lines( lt_base_keys ) } code line(s) vs | &&
                       |{ ls_remote-system } { lines( lt_rmt_keys ) }, { lv_gap_count } differ, | &&
                       |first at { lv_first_gap }| ).
                append_diag(
                  EXPORTING iv_text = |RFTR { is_part-type } { is_part-object_name }: { lv_base_txt }|
                  CHANGING  ct_cr_diag = ct_cr_diag ).

                IF lv_base_eq = abap_false AND lv_first_gap > 0.
                  DATA(lv_base_line) = COND string(
                    WHEN lv_first_gap <= lines( lt_base_keys )
                    THEN lt_base_keys[ lv_first_gap ] ELSE `` ).
                  DATA(lv_rmt_line) = COND string(
                    WHEN lv_first_gap <= lines( lt_rmt_keys )
                    THEN lt_rmt_keys[ lv_first_gap ] ELSE `` ).
                  append_diag(
                    EXPORTING iv_text = |RFTR   base=[{ lv_base_line }] remote=[{ lv_rmt_line }]|
                    CHANGING  ct_cr_diag = ct_cr_diag ).
                ENDIF.

                DATA(lt_diff_rmt) = zcl_vx_diff=>compute_diff(
                  it_old        = lt_rmt_cmp
                  it_new        = lt_new_cmp
                  i_title       = CONV #( is_part-object_name )
                  i_confirm_key = |RFTR~{ is_part-type }~{ is_part-object_name }|
                  i_ignore_case = abap_true
                  i_raw_ops     = abap_true ).
                lt_diff_rmt = zcl_vx_review_prepare=>strip_generated_ts_diff( lt_diff_rmt ).
                DATA(lt_review_diff_rmt) = zcl_vx_review_hunks=>filter_moved_lines(
                  it_diff        = lt_diff_rmt
                  iv_ignore_case = abap_true ).

                " If the new source shares no common line with the remote one, the
                " object effectively does not exist in the remote system (the diff is
                " "everything added") → a retrofit comparison would be nonsense, skip.
                DATA(lv_rmt_common) = 0.
                LOOP AT lt_diff_rmt TRANSPORTING NO FIELDS WHERE op = '='.
                  lv_rmt_common = lv_rmt_common + 1.
                ENDLOOP.
                IF lv_rmt_common = 0 OR lv_base_eq = abap_true.
                  append_diag(
                    EXPORTING iv_text = COND string(
                      WHEN lv_base_eq = abap_true
                      THEN |RFTR { is_part-type } { is_part-object_name }: nothing to compare, the other system IS the baseline|
                      ELSE |RFTR { is_part-type } { is_part-object_name }: no common lines vs { ls_remote-system } (object absent/unrelated), skipping retrofit| )
                    CHANGING  ct_cr_diag = ct_cr_diag ).
                ELSE.

                " Reference diff for the comparison of the two diffs.
                "
                " In a system pair that is in sync the remote version IS our previous
                " version, so the remote diff must come out identical to the review
                " diff; whatever the two do NOT have in common is the divergence. That
                " only holds if both are produced the same way — and LT_REVIEW_DIFF is
                " not: it is the diff drawn on screen, carrying the toolbar settings and
                " the cosmetic post-passes. Comparing a raw, whitespace-folded remote
                " diff against it turns every parameter difference into a violation
                " (CLEANUP_SEMANTIC alone manufactures '-'/'+' pairs out of identical
                " trivial lines that the other diff never has). So the review diff is
                " recomputed here with the detection parameters. Both sources are
                " already in memory — this costs CPU, not a version read.
                DATA(lt_diff_det) = zcl_vx_diff=>compute_diff(
                  it_old        = lt_old_cmp
                  it_new        = lt_new_cmp
                  i_title       = CONV #( is_part-object_name )
                  i_confirm_key = |RFTD~{ is_part-type }~{ is_part-object_name }|
                  i_ignore_case = abap_true
                  i_raw_ops     = abap_true ).
                lt_diff_det = zcl_vx_review_prepare=>strip_generated_ts_diff( lt_diff_det ).
                lt_diff_det = zcl_vx_review_hunks=>filter_moved_lines(
                  it_diff        = lt_diff_det
                  iv_ignore_case = abap_true ).

                DATA lt_review_lines TYPE zif_vx_review_types=>ty_review_lines.
                LOOP AT lt_diff_det INTO DATA(ls_prim_op) WHERE op = '+' OR op = '-'.
                  INSERT |{ ls_prim_op-op }\|{ norm_cmp_line( ls_prim_op-text ) }|
                    INTO TABLE lt_review_lines.
                ENDLOOP.

                " The subtraction itself: everything the two change scripts have in
                " common cancels out, what the remote diff has left over is the
                " divergence.
                DATA(lt_expected) = mark_expected_ops(
                  it_diff_rmt = lt_review_diff_rmt
                  it_diff_rev = lt_diff_det ).

                " Build retrofit hunks directly from the secondary diff (self-contained:
                " grouping and coverage), avoiding index drift against COLLECT.
                DATA(lt_rmt_hunks) = collect_retrofit_hunks(
                  is_part          = ls_effective_part
                  it_diff          = lt_review_diff_rmt
                  it_review_lines  = lt_review_lines
                  it_expected      = lt_expected
                  iv_versno_new    = lv_versno_new
                  iv_new_text      = ls_new-versno_text
                  iv_remote_versno = ls_remote-versno
                  iv_old_text      = ls_remote-versno_text
                  iv_system        = ls_remote-system
                  iv_author        = ls_new-author
                  iv_display_name  = lv_disp_name
                  iv_two_pane      = abap_false
                  iv_ignore_case   = is_options-ignore_case
                  iv_debug         = is_options-debug ).
                LOOP AT lt_rmt_hunks INTO DATA(ls_rmt_h).
                  INSERT ls_rmt_h INTO TABLE ct_hunk_info.
                ENDLOOP.

                " Persist the secondary (remote->new) diff so the hunk html can be
                " regenerated on the fly at view time, exactly like normal hunks.
                IF lt_rmt_hunks IS NOT INITIAL.
                  INSERT VALUE zif_vx_review_types=>ty_diff_data(
                    key = VALUE #(
                      objtype     = is_part-type
                      objname     = is_part-object_name
                      versno_o    = ls_remote-versno
                      versno_n    = lv_versno_new
                      blame         = abap_false
                      ignore_case   = is_options-ignore_case )
                    diff         = lt_review_diff_rmt
                    title        = |{ is_part-type }: { is_part-object_name }|
                    is_created   = abap_false
                    retrofit     = abap_true
                    review_lines = lt_review_lines
                    expected     = lt_expected )
                    INTO TABLE ct_diff_data.
                ENDIF.

                append_diag(
                  EXPORTING iv_text = |RFTR { is_part-type } { is_part-object_name }: remote_src={ lines( lt_src_rmt ) }L, sec_diff={ lines( lt_review_diff_rmt ) }ops, retrofit_hunks={ lines( lt_rmt_hunks ) }|
                  CHANGING  ct_cr_diag = ct_cr_diag ).
                ENDIF.
              ENDIF.
            CATCH cx_root INTO DATA(lx_rftr).
              append_diag(
                EXPORTING iv_text = |RFTR ERROR { is_part-type } { is_part-object_name }: { lx_rftr->get_text( ) }|
                CHANGING  ct_cr_diag = ct_cr_diag ).
          ENDTRY.
        ENDIF.

        IF lv_is_created = abap_true.
          CLEAR lt_auth.
          APPEND VALUE zif_vx_review_types=>ty_author_stats(
            author      = lv_author
            author_name = zcl_vx_vers_data=>get_user_name( lv_author )
            ins_count   = lv_ins
            del_count   = lv_del
            mod_count   = lv_mod
            hunk_count  = lv_hunk_cnt ) TO lt_auth.
        ENDIF.

        LOOP AT lt_auth ASSIGNING FIELD-SYMBOL(<auth_cnt>).
          CLEAR: <auth_cnt>-hunk_count, <auth_cnt>-hunk_ins,
                 <auth_cnt>-hunk_mod, <auth_cnt>-hunk_del.
        ENDLOOP.
        LOOP AT ct_hunk_info INTO DATA(ls_auth_hi)
          WHERE objtype = is_part-type AND obj_name = is_part-object_name.
          " Retrofit (moving-violation) hunks are informational, not part of stats.
          CHECK ls_auth_hi-retrofit IS INITIAL.
          CHECK ls_auth_hi-author IS NOT INITIAL.
          READ TABLE lt_auth ASSIGNING <auth_cnt> WITH KEY author = ls_auth_hi-author.
          IF sy-subrc <> 0.
            APPEND VALUE zif_vx_review_types=>ty_author_stats(
              author      = ls_auth_hi-author
              author_name = ls_auth_hi-author_name ) TO lt_auth.
            READ TABLE lt_auth ASSIGNING <auth_cnt> WITH KEY author = ls_auth_hi-author.
          ENDIF.
          <auth_cnt>-hunk_count = <auth_cnt>-hunk_count + 1.
          CASE ls_auth_hi-change_kind.
            WHEN `added`.   <auth_cnt>-hunk_ins = <auth_cnt>-hunk_ins + 1.
            WHEN `deleted`. <auth_cnt>-hunk_del = <auth_cnt>-hunk_del + 1.
            WHEN OTHERS.    <auth_cnt>-hunk_mod = <auth_cnt>-hunk_mod + 1.
          ENDCASE.
        ENDLOOP.

        IF lt_blame IS INITIAL AND lt_auth IS NOT INITIAL.
          READ TABLE lt_auth ASSIGNING <auth_cnt> WITH KEY author = lv_author.
          IF sy-subrc = 0.
            <auth_cnt>-ins_count = lv_ins.
            <auth_cnt>-mod_count = lv_mod.
            <auth_cnt>-del_count = lv_del.
          ELSE.
            CLEAR lt_auth.
            APPEND VALUE zif_vx_review_types=>ty_author_stats(
              author      = lv_author
              author_name = zcl_vx_vers_data=>get_user_name( lv_author )
              ins_count   = lv_ins
              mod_count   = lv_mod
              del_count   = lv_del
              hunk_count  = lv_hunk_cnt
              hunk_ins    = lv_stat_hunk_ins
              hunk_mod    = lv_stat_hunk_mod
              hunk_del    = lv_stat_hunk_del ) TO lt_auth.
          ENDIF.
        ENDIF.

        IF lv_ins = 0 AND lv_del = 0 AND lv_mod = 0 AND lv_hunk_cnt = 0.
          " The retrofit diff is kept: nothing to review here does not mean
          " nothing will move. The object still travels with the request and
          " overwrites the other system with a state that carries none of the
          " request's changes — the most dangerous moving violation there is.
          " Deleting its diff too left the violation without any code to show
          " ("Diff not available" on the violations page) and unsaved with the
          " review. KEEP (replaced): the delete used to cover both diffs —
          "   DELETE ct_diff_data WHERE key-objtype = is_part-type
          "                         AND key-objname = is_part-object_name.
          DELETE ct_diff_data WHERE key-objtype = is_part-type
                                AND key-objname = is_part-object_name
                                AND retrofit    = abap_false.
          DATA(lv_kept_viol) = 0.
          LOOP AT ct_hunk_info TRANSPORTING NO FIELDS
            WHERE objtype = is_part-type
              AND obj_name = is_part-object_name
              AND retrofit IS NOT INITIAL.
            lv_kept_viol = lv_kept_viol + 1.
          ENDLOOP.
          append_diag(
            EXPORTING iv_text = |SKIP { is_part-type } { is_part-object_name }: diff has no changed lines/hunks| &&
                                COND string( WHEN lv_kept_viol > 0
                                             THEN |, { lv_kept_viol } moving violation(s) kept|
                                             ELSE `` )
            CHANGING  ct_cr_diag = ct_cr_diag ).
          RETURN.
        ENDIF.

        APPEND VALUE zif_vx_review_types=>ty_obj_stats(
          objtype      = is_part-type
          class_name   = CONV #( ls_effective_part-class )
          obj_name     = is_part-object_name
          display_name = lv_disp_name
          versno_new   = lv_versno_new
          versno_old   = lv_versno_old
          author       = lv_author
          author_name  = zcl_vx_vers_data=>get_user_name( lv_author )
          datum        = lv_datum
          zeit         = lv_zeit
          ins_count    = lv_ins
          del_count    = lv_del
          mod_count    = lv_mod
          hunk_count   = lv_hunk_cnt
          hunk_ins     = lv_stat_hunk_ins
          hunk_mod     = lv_stat_hunk_mod
          hunk_del     = lv_stat_hunk_del
          bt_authors   = lt_auth
          is_created   = lv_is_created )
          TO ct_acr_stats.

      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.




  METHOD rebuild_retrofit_hunks.
    CHECK is_hunk-retrofit IS NOT INITIAL.
    CHECK iv_system IS NOT INITIAL.

    TRY.
        " Same two sources PRECOMPUTE_PART diffed: the version of this request
        " and the one the other system has right now.
        DATA(lt_src_new) = zcl_vx_version2=>get_source_local_compat(
          iv_objtype = is_hunk-objtype
          iv_objname = is_hunk-obj_name
          iv_versno  = is_hunk-versno_new
          iv_author  = is_hunk-author ).
        DATA(lt_src_rmt) = zcl_vx_version2=>get_source_remote(
          iv_objtype = is_hunk-objtype
          iv_objname = is_hunk-obj_name
          iv_versno  = is_hunk-versno_old
          iv_system  = iv_system ).
        IF lt_src_new IS INITIAL OR lt_src_rmt IS INITIAL.
          RETURN.
        ENDIF.

        " Detection, not display — see PRECOMPUTE_PART: raw ops, indentation and
        " case folded away, regardless of the toolbar setting.
        DATA(lt_rmt_cmp) = zcl_vx_review_prepare=>strip_method_wrapper( lt_src_rmt ).
        DATA(lt_new_cmp) = zcl_vx_review_prepare=>strip_method_wrapper( lt_src_new ).

        DATA(lt_diff_rmt) = zcl_vx_diff=>compute_diff(
          it_old        = lt_rmt_cmp
          it_new        = lt_new_cmp
          i_title       = CONV #( is_hunk-obj_name )
          i_confirm_key = |RFTR~{ is_hunk-objtype }~{ is_hunk-obj_name }|
          i_ignore_case = abap_true
          i_raw_ops     = abap_true ).
        lt_diff_rmt = zcl_vx_review_prepare=>strip_generated_ts_diff( lt_diff_rmt ).

        " Same shape PRECOMPUTE_PART stores, so the caller can keep it and every
        " later view renders from the stored diff instead of the remote system.
        result-diff = zcl_vx_review_hunks=>filter_moved_lines(
          it_diff        = lt_diff_rmt
          iv_ignore_case = abap_true ).

        result-hunks = collect_retrofit_hunks(
          is_part          = VALUE #( type        = is_hunk-objtype
                                      object_name = is_hunk-obj_name
                                      class       = CONV string( is_hunk-class_name ) )
          it_diff          = result-diff
          it_review_lines  = it_review_lines
          iv_versno_new    = is_hunk-versno_new
          iv_new_text      = is_hunk-versno_new_text
          iv_remote_versno = is_hunk-versno_old
          iv_old_text      = is_hunk-versno_old_text
          iv_system        = iv_system
          iv_author        = is_hunk-author
          iv_display_name  = is_hunk-display_name
          iv_two_pane      = iv_two_pane
          iv_ignore_case   = iv_ignore_case
          iv_debug         = iv_debug ).
        IF result-hunks IS INITIAL.
          CLEAR result.
        ENDIF.
      CATCH cx_root.
        CLEAR result.
    ENDTRY.
  ENDMETHOD.


  METHOD collect_retrofit_hunks.
    DATA lv_pos TYPE i VALUE 1.
    DATA(lv_total) = lines( it_diff ).
    DATA lv_render_line TYPE i VALUE 0.
    DATA lv_seq TYPE i.
    " One statement, one block — as in the review blocks. LV_STMT_OPEN spans the
    " whole walk, LV_STMT_BRIDGE is per block.
    DATA lv_stmt_open   TYPE abap_bool.
    DATA lv_stmt_bridge TYPE i.

    " Line sets of both compared sides, normalized, for the artifact test below.
    " Taken from the diff itself: '=' and '-' tile the other system's source,
    " '=' and '+' tile ours. Keep-note: these arrived as IT_OLD_LINES /
    " IT_NEW_LINES parameters carrying the two sources. That worked in PREPARE
    " and nowhere else — BUILD_VIEW_HUNKS regenerates this html from the stored
    " diff alone and has no sources to pass, so the test was skipped there, more
    " hunks came out, and LV_SEQ numbered them differently. The stored hunks are
    " keyed on that number: the warnings stayed correct while the code rendered
    " under them belonged to other blocks. Deriving the sets from the diff makes
    " both paths decide identically by construction.
    DATA lt_old_norm TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.
    DATA lt_new_norm TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.
    LOOP AT it_diff INTO DATA(ls_side).
      DATA(lv_side_key) = norm_cmp_line( ls_side-text ).
      IF lv_side_key IS INITIAL.
        CONTINUE.
      ENDIF.
      IF ls_side-op = '=' OR ls_side-op = '-'.
        INSERT lv_side_key INTO TABLE lt_old_norm.
      ENDIF.
      IF ls_side-op = '=' OR ls_side-op = '+'.
        INSERT lv_side_key INTO TABLE lt_new_norm.
      ENDIF.
    ENDLOOP.

    " The flags are positional, so they are only trusted when they still line up
    " with the diff they were produced for.
    DATA(lv_use_exp) = xsdbool( lines( it_expected ) = lv_total AND lv_total > 0 ).

    WHILE lv_pos <= lv_total.
      READ TABLE it_diff INTO DATA(ls_start) INDEX lv_pos.
      IF ls_start-op <> '+' AND ls_start-op <> '-'.
        IF ls_start-op = '='.
          lv_render_line = lv_render_line + 1.
          zcl_vx_review_prepare=>update_stmt_open(
            EXPORTING iv_line = ls_start-text
            CHANGING  cv_open = lv_stmt_open ).
        ENDIF.
        lv_pos = lv_pos + 1.
        CONTINUE.
      ENDIF.

      " Gather a contiguous change block (bridge a single blank '=' line if
      " more changes follow), tracking change lines + signatures for coverage.
      DATA(lv_scan) = lv_pos.
      DATA lt_hunk_diff  TYPE zif_vx_vers_types=>ty_t_diff.
      DATA lt_hunk_lines TYPE string_table.
      DATA lt_sig        TYPE string_table.
      DATA lt_exp        TYPE zif_vx_review_types=>ty_t_flag.
      DATA lv_ins        TYPE i.
      DATA lv_del        TYPE i.
      CLEAR: lt_hunk_diff, lt_hunk_lines, lt_sig, lt_exp, lv_ins, lv_del,
             lv_stmt_bridge.
      WHILE lv_scan <= lv_total.
        READ TABLE it_diff INTO DATA(ls_s) INDEX lv_scan.
        IF ls_s-op = '+' OR ls_s-op = '-'.
          APPEND ls_s TO lt_hunk_diff.
          APPEND CONV string( ls_s-text ) TO lt_hunk_lines.
          APPEND |{ ls_s-op }\|{ norm_cmp_line( ls_s-text ) }| TO lt_sig.
          IF lv_use_exp = abap_true.
            APPEND it_expected[ lv_scan ] TO lt_exp.
          ENDIF.
          IF ls_s-op = '+'.
            lv_ins = lv_ins + 1.
            zcl_vx_review_prepare=>update_stmt_open(
              EXPORTING iv_line = ls_s-text
              CHANGING  cv_open = lv_stmt_open ).
          ELSE.
            lv_del = lv_del + 1.
          ENDIF.
          lv_scan = lv_scan + 1.
        ELSEIF ls_s-op = '=' AND lv_stmt_open = abap_true
               AND lv_stmt_bridge < zcl_vx_review_prepare=>c_stmt_bridge_max.
          lv_stmt_bridge = lv_stmt_bridge + 1.
          APPEND ls_s TO lt_hunk_diff.
          zcl_vx_review_prepare=>update_stmt_open(
            EXPORTING iv_line = ls_s-text
            CHANGING  cv_open = lv_stmt_open ).
          lv_scan = lv_scan + 1.
        ELSEIF ls_s-op = '=' AND condense( val = ls_s-text ) = ``.
          DATA(lv_peek) = lv_scan + 1.
          DATA(lv_more) = abap_false.
          WHILE lv_peek <= lv_total AND lv_peek <= lv_scan + 2.
            READ TABLE it_diff INTO DATA(ls_pk) INDEX lv_peek.
            IF ls_pk-op = '+' OR ls_pk-op = '-'.
              lv_more = abap_true.
              EXIT.
            ELSEIF ls_pk-op = '=' AND condense( val = ls_pk-text ) = ``.
              lv_peek = lv_peek + 1.
            ELSE.
              EXIT.
            ENDIF.
          ENDWHILE.
          IF lv_more = abap_true.
            APPEND ls_s TO lt_hunk_diff.
            lv_scan = lv_scan + 1.
          ELSE.
            EXIT.
          ENDIF.
        ELSE.
          EXIT.
        ENDIF.
      ENDWHILE.

      " Keep-note: an intermediate version kept only blocks with a '-' here
      " ("a violation is only what our move destroys there"), which threw away
      " the second kind — they deleted, we restore it. Both kinds are legitimate,
      " and the two-diff comparison below separates a restore from ordinary new
      " code without needing that guard:
      "     review '+' / remote '+'  the request adds it, they never had it → fine
      "     review '=' / remote '+'  it was already in OUR baseline and is gone
      "                              there → they deleted it, our move restores it
      "     remote '-' with no review '-'  they added it, our move wipes it
      "IF zcl_vx_review_stats=>is_blank_hunk( lt_hunk_lines ) = abap_false
      "   AND lv_del > 0.
      IF zcl_vx_review_stats=>is_blank_hunk( lt_hunk_lines ) = abap_false.
        " Coverage: the block drops out when the request accounts for every one of
        " its operations. With the flags that is the leftover of the subtraction;
        " without them (old review) it falls back to set membership, which cannot
        " see multiplicity — one changed line in the request then explained away
        " every occurrence of the same text over there.
        DATA(lv_covered) = abap_true.
        IF lv_use_exp = abap_true.
          LOOP AT lt_exp INTO DATA(lv_exp_flag).
            IF lv_exp_flag = abap_false.
              lv_covered = abap_false.
              EXIT.
            ENDIF.
          ENDLOOP.
        ELSE.
          LOOP AT lt_sig INTO DATA(lv_s).
            IF strlen( lv_s ) <= 2.       " '+|' / '-|' — blank line, never a violation
              CONTINUE.
            ENDIF.
            IF NOT line_exists( it_review_lines[ table_line = lv_s ] ).
              lv_covered = abap_false.
              EXIT.
            ENDIF.
          ENDLOOP.
        ENDIF.

        " Alignment artifact: every changed line of this hunk exists on the other
        " side anyway. SAP's own compare mis-anchors these two sources the same
        " way — repeated blocks (et_fcat = VALUE #( BASE et_fcat …) let the LCS
        " pair occurrence k with occurrence k+1, and the leftover reads as an
        " insertion. Nothing here would be overwritten in the other system.
        IF lv_covered = abap_false AND ( lt_old_norm IS NOT INITIAL OR lt_new_norm IS NOT INITIAL ).
          DATA(lv_artifact) = abap_true.
          LOOP AT lt_hunk_diff INTO DATA(ls_pc) WHERE op = '+' OR op = '-'.
            DATA(lv_pc_key) = norm_cmp_line( ls_pc-text ).
            IF lv_pc_key IS INITIAL.
              CONTINUE.
            ENDIF.
            IF ls_pc-op = '+'.
              IF NOT line_exists( lt_old_norm[ table_line = lv_pc_key ] ).
                lv_artifact = abap_false.
                EXIT.
              ENDIF.
            ELSE.
              IF NOT line_exists( lt_new_norm[ table_line = lv_pc_key ] ).
                lv_artifact = abap_false.
                EXIT.
              ENDIF.
            ENDIF.
          ENDLOOP.
          IF lv_artifact = abap_true.
            lv_covered = abap_true.
          ENDIF.
        ENDIF.

        IF lv_covered = abap_false.
          " Render the hunk with up to 3 context lines before/after.
          DATA lt_render TYPE zif_vx_vers_types=>ty_t_diff.
          CLEAR lt_render.
          DATA(lv_ctx_before) = 0.
          DATA(lv_cscan) = lv_pos - 1.
          WHILE lv_cscan >= 1 AND lv_ctx_before < 3.
            READ TABLE it_diff INTO DATA(ls_cb) INDEX lv_cscan.
            IF sy-subrc <> 0 OR ls_cb-op <> '='.
              EXIT.
            ENDIF.
            INSERT ls_cb INTO lt_render INDEX 1.
            lv_ctx_before = lv_ctx_before + 1.
            lv_cscan = lv_cscan - 1.
          ENDWHILE.
          INSERT LINES OF lt_hunk_diff INTO TABLE lt_render.
          DATA(lv_ctx_after) = 0.
          lv_cscan = lv_scan.
          WHILE lv_cscan <= lv_total AND lv_ctx_after < 3.
            READ TABLE it_diff INTO DATA(ls_ca) INDEX lv_cscan.
            IF sy-subrc <> 0 OR ls_ca-op <> '='.
              EXIT.
            ENDIF.
            APPEND ls_ca TO lt_render.
            lv_ctx_after = lv_ctx_after + 1.
            lv_cscan = lv_cscan + 1.
          ENDWHILE.

          DATA(lv_start_line) = lv_render_line - lv_ctx_before + 1.
          IF lv_start_line < 1.
            lv_start_line = 1.
          ENDIF.


          DATA(lv_kind) = COND string(
            WHEN lv_ins > 0 AND lv_del > 0 THEN `changed`
            WHEN lv_ins > 0                THEN `added`
            ELSE                               `deleted` ).
          DATA(lv_msg) = COND string(
            WHEN lv_kind = `deleted`
              THEN |will be overwritten(deleted) in { iv_system } after moving - retrofit needed!!!|
            WHEN lv_kind = `added`
              THEN |deleted will be inserted in { iv_system } after moving - retrofit needed!!!|
            ELSE |diverges from { iv_system } - will be overwritten/re-inserted after moving - retrofit needed!!!| ).

          lv_seq = lv_seq + 1.
          INSERT VALUE zif_vx_review_types=>ty_hunk_info(
            hunk_key        = |{ is_part-type }~{ is_part-object_name }~R{ lv_seq }|
            objtype         = is_part-type
            obj_name        = is_part-object_name
            class_name      = CONV #( is_part-class )
            display_name    = iv_display_name
            hunk_no         = lv_seq
            start_line      = lv_start_line
            change_count    = lv_ins + lv_del
            change_kind     = lv_kind
            author          = iv_author
            author_name     = zcl_vx_vers_data=>get_user_name( iv_author )
            versno_new      = iv_versno_new
            versno_old      = iv_remote_versno
            versno_new_text = iv_new_text
            versno_old_text = iv_old_text
            retrofit        = lv_msg )
            INTO TABLE result.
        ENDIF.
      ENDIF.

      " Advance the rendered-line counter past the consumed hunk ('=' and '+').
      LOOP AT lt_hunk_diff INTO DATA(ls_rc).
        IF ls_rc-op = '=' OR ls_rc-op = '+'.
          lv_render_line = lv_render_line + 1.
        ENDIF.
      ENDLOOP.
      lv_pos = lv_scan.
    ENDWHILE.
  ENDMETHOD.

ENDCLASS.
