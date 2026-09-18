CLASS zcl_vx_review_hunks DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.


    CLASS-METHODS normalize_moved_line
      IMPORTING
        iv_text        TYPE string
        iv_ignore_case TYPE abap_bool
      RETURNING
        VALUE(result)  TYPE string.

ENDCLASS.


CLASS zcl_vx_review_hunks IMPLEMENTATION.


  METHOD hunk_ranges.
    DATA lv_diff_pos TYPE i VALUE 1.
    DATA lv_line     TYPE i VALUE 0.
    " One statement, one block — the same decision ZCL_VX_REVIEW_HUNK_INFO=>
    " COLLECT makes. It must be identical: that method indexes the html built
    " from these ranges by block number, and a block more or less on either side
    " shifts every one of them. LV_STMT_OPEN spans the whole walk, LV_STMT_BRIDGE
    " is per block.
    DATA lv_stmt_open   TYPE abap_bool.
    DATA lv_stmt_bridge TYPE i.
    DATA(lv_diff_total) = lines( it_diff ).

    WHILE lv_diff_pos <= lv_diff_total.
      READ TABLE it_diff INTO DATA(ls_hscan_start) INDEX lv_diff_pos.
      IF ls_hscan_start-op <> '-' AND ls_hscan_start-op <> '+'.
        IF ls_hscan_start-op = '='.
          lv_line = lv_line + 1.
          " Tracked over the whole walk — see ZCL_VX_REVIEW_HUNK_INFO=>COLLECT.
          zcl_vx_review_prepare=>update_stmt_open(
            EXPORTING iv_line = ls_hscan_start-text
            CHANGING  cv_open = lv_stmt_open ).
        ENDIF.
        lv_diff_pos = lv_diff_pos + 1.
        CONTINUE.
      ENDIF.

      DATA lt_hunk_diff TYPE zif_vx_vers_types=>ty_t_diff.
      DATA lt_hunk_lines TYPE string_table.
      CLEAR: lt_hunk_diff, lt_hunk_lines, lv_stmt_bridge.
      DATA(lv_start_line) = lv_line + 1.
      DATA(lv_hscan) = lv_diff_pos.

      WHILE lv_hscan <= lv_diff_total.
        READ TABLE it_diff INTO DATA(ls_hscan) INDEX lv_hscan.
        IF ls_hscan-op = '-' OR ls_hscan-op = '+'.
          APPEND ls_hscan TO lt_hunk_diff.
          APPEND CONV string( ls_hscan-text ) TO lt_hunk_lines.
          IF ls_hscan-op = '+'.
            zcl_vx_review_prepare=>update_stmt_open(
              EXPORTING iv_line = ls_hscan-text
              CHANGING  cv_open = lv_stmt_open ).
          ENDIF.
          lv_hscan = lv_hscan + 1.
        ELSEIF ls_hscan-op = '=' AND lv_stmt_open = abap_true
               AND lv_stmt_bridge < zcl_vx_review_prepare=>c_stmt_bridge_max.
          " Context that is still inside the statement — rendered with the
          " block, and not counted as one of its changed lines.
          lv_stmt_bridge = lv_stmt_bridge + 1.
          APPEND ls_hscan TO lt_hunk_diff.
          zcl_vx_review_prepare=>update_stmt_open(
            EXPORTING iv_line = ls_hscan-text
            CHANGING  cv_open = lv_stmt_open ).
          lv_hscan = lv_hscan + 1.
        ELSEIF ls_hscan-op = '=' AND condense( val = ls_hscan-text ) = ``.
          DATA(lv_hpeek) = lv_hscan + 1.
          DATA(lv_hextra) = 0.
          DATA(lv_hmore_changes) = abap_false.
          WHILE lv_hpeek <= lv_diff_total.
            READ TABLE it_diff INTO DATA(ls_hpeek) INDEX lv_hpeek.
            IF ls_hpeek-op = '-' OR ls_hpeek-op = '+'.
              lv_hmore_changes = abap_true.
              EXIT.
            ELSEIF ls_hpeek-op = '=' AND condense( val = ls_hpeek-text ) = `` AND lv_hextra < 1.
              lv_hextra = lv_hextra + 1.
              lv_hpeek = lv_hpeek + 1.
              CONTINUE.
            ELSE.
              EXIT.
            ENDIF.
          ENDWHILE.
          IF lv_hmore_changes = abap_true.
            APPEND ls_hscan TO lt_hunk_diff.
            lv_hscan = lv_hscan + 1.
          ELSE.
            EXIT.
          ENDIF.
        ELSE.
          EXIT.
        ENDIF.
      ENDWHILE.

      APPEND VALUE #( op_from    = lv_diff_pos
                      op_to      = lv_hscan - 1
                      start_line = lv_start_line
                      blank      = zcl_vx_review_stats=>is_blank_hunk( lt_hunk_lines )
                    ) TO result.

      LOOP AT lt_hunk_diff INTO DATA(ls_hunk_render_count).
        IF ls_hunk_render_count-op = '=' OR ls_hunk_render_count-op = '+'.
          lv_line = lv_line + 1.
        ENDIF.
      ENDLOOP.
      lv_diff_pos = lv_hscan.
    ENDWHILE.
  ENDMETHOD.


  METHOD filter_moved_lines.
    result = it_diff.

    TYPES:
      BEGIN OF ty_del_candidate,
        key TYPE string,
        idx TYPE i,
      END OF ty_del_candidate.

    DATA lt_del_candidates TYPE HASHED TABLE OF ty_del_candidate WITH UNIQUE KEY key idx.
    DATA lt_drop_idx TYPE HASHED TABLE OF i WITH UNIQUE KEY table_line.
    DATA lt_used_del TYPE HASHED TABLE OF i WITH UNIQUE KEY table_line.

    LOOP AT result INTO DATA(ls_del_candidate) WHERE op = '-'.
      " Trivial structural lines (ENDIF./ELSE./ENDLOOP./…) match each other
      " everywhere — never treat them as "moved", or a demoted structural anchor
      " would be folded back into '=' and fragment the review into tiny hunks.
      IF zcl_vx_diff=>is_trivial_anchor( CONV string( ls_del_candidate-text ) ) = abap_true.
        CONTINUE.
      ENDIF.
      DATA(lv_del_candidate_key) = normalize_moved_line(
        iv_text        = CONV string( ls_del_candidate-text )
        iv_ignore_case = iv_ignore_case ).
      "CHECK strlen( lv_del_candidate_key ) >= 8.
      INSERT VALUE ty_del_candidate(
        key = lv_del_candidate_key
        idx = sy-tabix ) INTO TABLE lt_del_candidates.
    ENDLOOP.

    LOOP AT result INTO DATA(ls_ins) WHERE op = '+'.
      DATA(lv_ins_idx) = sy-tabix.

      DATA(lv_key) = normalize_moved_line(
        iv_text        = CONV string( ls_ins-text )
        iv_ignore_case = iv_ignore_case ).
      CHECK lv_key IS NOT INITIAL.
      "CHECK strlen( lv_key ) >= 8.

      LOOP AT lt_del_candidates INTO DATA(ls_del_candidate_match)
        WHERE key = lv_key.
        IF NOT line_exists( lt_used_del[ table_line = ls_del_candidate_match-idx ] ).
          result[ lv_ins_idx ]-op = '='.
          INSERT ls_del_candidate_match-idx INTO TABLE lt_drop_idx.
          INSERT ls_del_candidate_match-idx INTO TABLE lt_used_del.
          EXIT.
        ENDIF.
      ENDLOOP.
    ENDLOOP.

    DATA lt_filtered TYPE zif_vx_vers_types=>ty_t_diff.
    LOOP AT result INTO DATA(ls_diff_row).
      IF line_exists( lt_drop_idx[ table_line = sy-tabix ] ).
        CONTINUE.
      ENDIF.
      APPEND ls_diff_row TO lt_filtered.
    ENDLOOP.
    result = lt_filtered.
  ENDMETHOD.

  METHOD normalize_moved_line.
    result = iv_text.
    CONDENSE result.
    DATA(lv_upper) = result.
    TRANSLATE lv_upper TO UPPER CASE.
    IF lv_upper CS `THIS CLASS HAS BEEN GENERATED`.
      result = `__AVE_GENERATED_CLASS_HEADER__`.
      RETURN.
    ENDIF.
    IF lv_upper CS `LC_GEN_DATE_TIME`
       AND lv_upper CS `TIMESTAMP`
       AND lv_upper CS `VALUE`.
      result = `__AVE_GENERATED_DATE_TIME__`.
      RETURN.
    ENDIF.
    IF iv_ignore_case = abap_true.
      TRANSLATE result TO UPPER CASE.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
