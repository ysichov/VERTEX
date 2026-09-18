CLASS zcl_vx_review_stats DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    "! Compute ins/del/mod counts from a diff, mirroring the pairing logic of diff_to_html.
    "! When it_blame is supplied, also builds per-author contribution in et_authors
    "! including per-author hunk_count (each change block attributed to the first blamed line).
    "! Hunks consisting entirely of blank/whitespace lines are excluded from hunk_count.
    "! IV_DEF_AUTHOR is booked for changed lines the blame map does not know
    "! (a line the blame replay could not attribute). Without it such rows are
    "! silently dropped from the per-author totals while the hunk they sit in is
    "! still counted, which makes "Blocks" exceed "Rows" in the report.
    CLASS-METHODS from_diff
      IMPORTING it_diff    TYPE zif_vx_vers_types=>ty_t_diff
                it_blame   TYPE zif_vx_vers_types=>ty_blame_map OPTIONAL
                iv_def_author TYPE versuser OPTIONAL
                iv_def_name   TYPE ad_namtext OPTIONAL
      EXPORTING ev_ins     TYPE i
                ev_del     TYPE i
                ev_mod     TYPE i
                et_authors TYPE zif_vx_review_types=>ty_t_author_stats.

    "! Kind of one hunk ('added' / 'changed' / 'deleted'), decided with the SAME
    "! greedy del<->ins pairing FROM_DIFF uses for the row counts. Classifying a
    "! hunk as 'changed' merely because it contains both a '+' and a '-' breaks
    "! the report invariant "blocks of kind X <= rows of kind X": a delete whose
    "! insert is unrelated is a delete row plus an insert row, not a modification.
    CLASS-METHODS classify_hunk
      IMPORTING it_dels       TYPE string_table
                it_ins        TYPE string_table
      RETURNING VALUE(result) TYPE string.

    "! Returns abap_true if every changed line in the hunk is blank/whitespace-only.
    CLASS-METHODS is_blank_hunk
      IMPORTING it_lines      TYPE string_table
      RETURNING VALUE(result) TYPE abap_bool.

  PROTECTED SECTION.
  PRIVATE SECTION.
    CLASS-METHODS add_blame
      IMPORTING iv_text       TYPE string
                iv_op         TYPE c          " '+' = ins, '~' = mod
                iv_new_hunk   TYPE abap_bool DEFAULT abap_false
                it_blame      TYPE zif_vx_vers_types=>ty_blame_map
                iv_def_author TYPE versuser OPTIONAL
                iv_def_name   TYPE ad_namtext OPTIONAL
      CHANGING  ct_authors    TYPE zif_vx_review_types=>ty_t_author_stats.

ENDCLASS.

CLASS zcl_vx_review_stats IMPLEMENTATION.

  METHOD classify_hunk.
    IF it_dels IS INITIAL.
      result = `added`.
      RETURN.
    ENDIF.
    IF it_ins IS INITIAL.
      result = `deleted`.
      RETURN.
    ENDIF.

    DATA lt_matched TYPE STANDARD TABLE OF abap_bool WITH DEFAULT KEY.
    DO lines( it_ins ) TIMES.
      APPEND abap_false TO lt_matched.
    ENDDO.

    LOOP AT it_dels INTO DATA(lv_d).
      LOOP AT it_ins INTO DATA(lv_i).
        DATA(lv_ii) = sy-tabix.
        ASSIGN lt_matched[ lv_ii ] TO FIELD-SYMBOL(<m>).
        CHECK <m> = abap_false.
        IF zcl_vx_diff=>has_common_chars( iv_a = lv_d iv_b = lv_i ) = abap_true.
          result = `changed`.       " at least one real modification
          RETURN.
        ENDIF.
      ENDLOOP.
    ENDLOOP.

    " Both sides present but nothing pairs: the hunk is a pure removal plus a
    " pure addition. Report it as whichever side dominates — every one of those
    " rows is counted under that same kind, so the invariant holds.
    result = COND string( WHEN lines( it_ins ) >= lines( it_dels ) THEN `added` ELSE `deleted` ).
  ENDMETHOD.


  METHOD is_blank_hunk.
    result = abap_true.
    LOOP AT it_lines INTO DATA(lv_line).
      DATA(lv_trimmed) = lv_line.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN lv_trimmed WITH ``.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_trimmed WITH ``.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_trimmed WITH ``.
      CONDENSE lv_trimmed NO-GAPS.
      IF lv_trimmed <> ''.
        result = abap_false.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD from_diff.
    CLEAR ev_ins. CLEAR ev_del. CLEAR ev_mod. CLEAR et_authors.

    DATA lt_dels TYPE string_table.
    DATA lt_ins  TYPE string_table.

    " Append sentinel '=' to flush the last change block
    DATA lt_ops TYPE zif_vx_vers_types=>ty_t_diff.
    lt_ops = it_diff.
    APPEND VALUE #( op = '=' ) TO lt_ops.

    LOOP AT lt_ops INTO DATA(ls).
      CASE ls-op.
        WHEN '-'.
          APPEND CONV string( ls-text ) TO lt_dels.
        WHEN '+'.
          APPEND CONV string( ls-text ) TO lt_ins.
        WHEN '='.
          CHECK lt_dels IS NOT INITIAL OR lt_ins IS NOT INITIAL.

          " Skip hunks that contain only blank/whitespace lines — nothing to approve
          DATA lt_hunk_lines TYPE string_table.
          CLEAR lt_hunk_lines.
          LOOP AT lt_dels INTO DATA(lv_dl). APPEND lv_dl TO lt_hunk_lines. ENDLOOP.
          LOOP AT lt_ins  INTO DATA(lv_il). APPEND lv_il TO lt_hunk_lines. ENDLOOP.
          IF is_blank_hunk( lt_hunk_lines ) = abap_true.
            CLEAR lt_dels. CLEAR lt_ins.
            CONTINUE.
          ENDIF.

          " Parallel flag table: which ins lines have been matched already
          DATA lt_ins_matched TYPE STANDARD TABLE OF abap_bool WITH DEFAULT KEY.
          CLEAR lt_ins_matched.
          DO lines( lt_ins ) TIMES.
            APPEND abap_false TO lt_ins_matched.
          ENDDO.

          " First blamed line of the hunk claims the hunk_count for its author
          DATA lv_hunk_author TYPE versuser.
          CLEAR lv_hunk_author.

          " Greedy pairing: for each del, find first unmatched ins with has_common_chars
          LOOP AT lt_dels INTO DATA(lv_d).
            DATA lv_paired TYPE abap_bool.
            lv_paired = abap_false.
            LOOP AT lt_ins INTO DATA(lv_i).
              DATA(lv_ii) = sy-tabix.
              ASSIGN lt_ins_matched[ lv_ii ] TO FIELD-SYMBOL(<m>).
              CHECK <m> = abap_false.
              IF zcl_vx_diff=>has_common_chars( iv_a = lv_d iv_b = lv_i ) = abap_true.
                ev_mod = ev_mod + 1.
                <m> = abap_true.
                lv_paired = abap_true.
                IF it_blame IS SUPPLIED.
                  DATA(lv_first_mod) = COND abap_bool(
                    WHEN lv_hunk_author IS INITIAL THEN abap_true ELSE abap_false ).
                  add_blame( EXPORTING iv_text       = lv_i
                                       iv_op         = '~'
                                       iv_new_hunk   = lv_first_mod
                                       it_blame      = it_blame
                                       iv_def_author = iv_def_author
                                       iv_def_name   = iv_def_name
                             CHANGING  ct_authors    = et_authors ).
                  IF lv_first_mod = abap_true.
                    READ TABLE it_blame INTO DATA(ls_bm) WITH KEY text = lv_i.
                    IF sy-subrc = 0. lv_hunk_author = ls_bm-author. ENDIF.
                  ENDIF.
                ENDIF.
                EXIT.
              ENDIF.
            ENDLOOP.
            IF lv_paired = abap_false.
              ev_del = ev_del + 1.
            ENDIF.
          ENDLOOP.

          " Unmatched ins lines
          LOOP AT lt_ins INTO lv_i.
            lv_ii = sy-tabix.
            ASSIGN lt_ins_matched[ lv_ii ] TO <m>.
            CHECK <m> = abap_false.
            ev_ins = ev_ins + 1.
            IF it_blame IS SUPPLIED.
              DATA(lv_first_ins) = COND abap_bool(
                WHEN lv_hunk_author IS INITIAL THEN abap_true ELSE abap_false ).
              add_blame( EXPORTING iv_text       = lv_i
                                   iv_op         = '+'
                                   iv_new_hunk   = lv_first_ins
                                   it_blame      = it_blame
                                   iv_def_author = iv_def_author
                                   iv_def_name   = iv_def_name
                         CHANGING  ct_authors    = et_authors ).
              IF lv_first_ins = abap_true.
                READ TABLE it_blame INTO DATA(ls_bi) WITH KEY text = lv_i.
                IF sy-subrc = 0. lv_hunk_author = ls_bi-author. ENDIF.
              ENDIF.
            ENDIF.
          ENDLOOP.

          CLEAR lt_dels. CLEAR lt_ins. CLEAR lt_ins_matched. CLEAR lv_hunk_author.
      ENDCASE.
    ENDLOOP.
  ENDMETHOD.

  METHOD add_blame.
    DATA lv_author TYPE versuser.
    DATA lv_name   TYPE ad_namtext.

    READ TABLE it_blame INTO DATA(ls_b) WITH KEY text = iv_text.
    IF sy-subrc = 0.
      lv_author = ls_b-author.
      lv_name   = ls_b-author_name.
    ELSE.
      " Unattributed line — book it on the object's author instead of dropping
      " it, otherwise its hunk is counted in "Blocks" without any matching row.
      CHECK iv_def_author IS NOT INITIAL.
      lv_author = iv_def_author.
      lv_name   = iv_def_name.
    ENDIF.

    READ TABLE ct_authors ASSIGNING FIELD-SYMBOL(<a>) WITH KEY author = lv_author.
    IF sy-subrc <> 0.
      INSERT VALUE #( author = lv_author author_name = lv_name )
        INTO TABLE ct_authors.
      READ TABLE ct_authors ASSIGNING <a> WITH KEY author = lv_author.
    ENDIF.
    CASE iv_op.
      WHEN '+'. <a>-ins_count = <a>-ins_count + 1.
      WHEN '~'. <a>-mod_count = <a>-mod_count + 1.
    ENDCASE.
    IF iv_new_hunk = abap_true.
      <a>-hunk_count = <a>-hunk_count + 1.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
