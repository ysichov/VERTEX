CLASS zcl_vx_diff DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    "! Type aliases from ZIF_VX_VERS_TYPES (defined there for standalone compatibility)
    TYPES ty_diff_op TYPE zif_vx_vers_types=>ty_diff_op.
    TYPES ty_t_diff  TYPE zif_vx_vers_types=>ty_t_diff.
    TYPES ty_t_int   TYPE STANDARD TABLE OF i WITH DEFAULT KEY.

    "! Pair deleted vs inserted lines inside one change block via an LCS over
    "! HAS_COMMON_CHARS. Returns matched 1-based index pairs (et_del_pair[k] in
    "! it_dels pairs with et_ins_pair[k] in it_ins), ascending. Single source of
    "! truth shared by inline and two-pane rendering so both align identically.
    CLASS-METHODS pair_change_block
      IMPORTING it_dels     TYPE string_table
                it_ins      TYPE string_table
      EXPORTING et_del_pair TYPE ty_t_int
                et_ins_pair TYPE ty_t_int.

    "! Line-level LCS diff between two source tables.
    CLASS-METHODS compute_diff
      IMPORTING it_old           TYPE abaptxt255_tab
                it_new           TYPE abaptxt255_tab
                i_title          TYPE csequence DEFAULT 'Computing diff'
                i_confirm_key    TYPE csequence OPTIONAL
                "! One user option ("Case/ind"): folds change blocks whose lines
                "! match after removing ALL whitespace and upper-casing.
                i_ignore_case    TYPE abap_bool DEFAULT abap_false
                "! Detection mode: skip the cosmetic post-passes (CLEANUP_SEMANTIC,
                "! PAIR_COMMENTED_TWINS). Both exist to make a diff read well on
                "! screen and both manufacture '-'/'+' out of identical lines, which
                "! a caller that asks "did anything actually change?" must not see.
                "! The declaration-aware paths stay on — they pair, they don't invent.
                i_raw_ops        TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(result)    TYPE ty_t_diff.

    "! Offset of the comment part of one ABAP source line, -1 when it has none.
    "! A '*' in the first non-blank position comments the whole line (result 0);
    "! otherwise the first '"' that is NOT inside a literal ('...', `...`, |...|)
    "! opens the comment and everything from there on is comment text.
    CLASS-METHODS comment_offset
      IMPORTING iv_text       TYPE string
      RETURNING VALUE(result) TYPE i.

    "! Inline char-level diff for a single line pair.
    "!   iv_side = 'B' → both sides inline (default)
    "!   iv_side = 'N' → only insertion highlighted (new side)
    "!   iv_side = 'O' → only deletion highlighted (old side)
    CLASS-METHODS char_diff_html
      IMPORTING iv_old          TYPE string
                iv_new          TYPE string
                iv_side         TYPE c DEFAULT 'B'
                iv_ignore_case  TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(result) TYPE string.

    "! True if iv_a and iv_b are similar enough for pairing in change blocks.
    "! Used by diff_to_html to decide whether two changed lines are similar enough to pair.
    CLASS-METHODS has_common_chars
      IMPORTING iv_a          TYPE string
                iv_b          TYPE string
      RETURNING VALUE(result) TYPE abap_bool.

    "! Count edit runs in the middle parts of two strings (after stripping common prefix/suffix).
    "! Tokenizes by spaces and does a greedy forward LCS on tokens.
    "! Public so debug_diff_html can display per-pair metrics.
    CLASS-METHODS count_edit_runs
      IMPORTING iv_a          TYPE string
                iv_b          TYPE string
      RETURNING VALUE(result) TYPE i.

    "! Build a blame map by replaying diffs between consecutive versions in
    "! [i_from, i_to] for (i_objtype, i_objname). For every '+' line the current
    "! version's author is recorded; '-' lines go to et_blame_deleted.
    CLASS-METHODS build_blame_map
      IMPORTING it_versions      TYPE zif_vx_vers_types=>ty_t_version_row
                i_objtype        TYPE versobjtyp
                i_objname        TYPE versobjnam
                i_from           TYPE versno
                i_to             TYPE versno
                i_title          TYPE csequence OPTIONAL
      EXPORTING et_blame_deleted TYPE zif_vx_vers_types=>ty_blame_map
      RETURNING VALUE(result)    TYPE zif_vx_vers_types=>ty_blame_map.

    "! True for trivial structural delimiter lines (ENDIF., ELSE., ENDLOOP., …).
    "! Such lines occur everywhere, so they must never anchor pairing nor count
    "! as "moved" lines — they would cross-link unrelated code. Robust to indent.
    CLASS-METHODS is_trivial_anchor
      IMPORTING iv_line       TYPE string
      RETURNING VALUE(result) TYPE abap_bool.

  PROTECTED SECTION.
  PRIVATE SECTION.
    "! Plain line-level diff (RS_CMP + post-passes). This is what COMPUTE_DIFF
    "! used to be; it is now also the per-declaration engine of DIFF_DECLARATIONS.
    CLASS-METHODS diff_lines
      IMPORTING it_old        TYPE abaptxt255_tab
                it_new        TYPE abaptxt255_tab
                i_ignore_case TYPE abap_bool DEFAULT abap_false
                i_raw_ops     TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(result) TYPE ty_t_diff.

    "! Declaration-aware diff for class section includes: pairs the declarations
    "! of both sides by signature via ZCL_VX_DIFF_DECL and diffs each pair in
    "! isolation, so line matching can never cross a declaration boundary.
    "! Returns empty when the sources cannot be split into declarations.
    "! IV_TEXT_KEYS is passed on to ZCL_VX_DIFF_DECL=>PAIR_DECLARATIONS: set for
    "! generated DPC bodies, where ordinary statements must pair by text too.
    CLASS-METHODS diff_declarations
      IMPORTING it_old        TYPE abaptxt255_tab
                it_new        TYPE abaptxt255_tab
                i_ignore_case TYPE abap_bool DEFAULT abap_false
                iv_text_keys  TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(result) TYPE ty_t_diff.

    "! Semantic cleanup: demote equality runs that consist SOLELY of trivial
    "! structural lines (blank lines, ENDIF./ELSE./TRY./ENDLOOP. …) and are
    "! flanked by changes on both sides into delete+insert, so a large replaced
    "! region is not fragmented by such everywhere-matching anchors. Meaningful
    "! common lines (IF sy-subrc EQ 0., etc.) are kept as '=' anchors.
    CLASS-METHODS cleanup_semantic
      CHANGING ct_ops TYPE ty_t_diff.

    "! Post-pass over RS_CMP output: move each deleted line to sit right before
    "! its commented-out twin among the inserts (same text after stripping
    "! leading spaces/'*'), so "old code commented out" renders as a
    "! modification instead of an unrelated delete + insert far apart.
    CLASS-METHODS pair_commented_twins
      CHANGING ct_ops TYPE ty_t_diff.

    CLASS-METHODS collapse_token_ops
      CHANGING ct_ops TYPE ty_t_diff.

    CLASS-METHODS count_char_edit_runs
      IMPORTING iv_a          TYPE string
                iv_b          TYPE string
      RETURNING VALUE(result) TYPE i.

    "! Minimal HTML escaping for &, <, >.
    CLASS-METHODS esc_html
      IMPORTING iv_text       TYPE string
      RETURNING VALUE(result) TYPE string.

    "! Emits one unchanged run of CHAR_DIFF_HTML, greying whatever part of it
    "! falls inside the comment of the rendered line. IV_OFF is the run's offset
    "! in that line, IV_CMT the line's COMMENT_OFFSET (-1 = no comment).
    CLASS-METHODS emit_eq_run
      IMPORTING iv_text       TYPE string
                iv_off        TYPE i
                iv_cmt        TYPE i
      RETURNING VALUE(result) TYPE string.
ENDCLASS.



CLASS ZCL_VX_DIFF IMPLEMENTATION.


  METHOD compute_diff.
    " Class section includes (PUBLIC/PROTECTED/PRIVATE SECTION) are regenerated
    " by SAP with an ARBITRARY declaration order — a method that sat on line 9
    " can sit on line 57 in the next version without being touched. A plain line
    " diff then reports the move as delete+insert far apart AND matches the
    " "importing" / "!IV_X type Y" lines of one method against those of another
    " (they are identical everywhere), which shreds the section into noise.
    " Such sources are therefore diffed declaration by declaration, pairing
    " declarations by signature instead of by position.
    IF it_old IS NOT INITIAL AND it_new IS NOT INITIAL
       AND zcl_vx_diff_decl=>is_section_source( it_src = it_old ) = abap_true
       AND zcl_vx_diff_decl=>is_section_source( it_src = it_new ) = abap_true.
      result = diff_declarations( it_old        = it_old
                                  it_new        = it_new
                                  i_ignore_case = i_ignore_case ).
      IF result IS NOT INITIAL.
        RETURN.
      ENDIF.
      " no declaration could be recognized → fall back to the plain line diff
    ENDIF.

    " Generated Gateway DPC method bodies have the same problem one level down:
    " the local DATA declarations and the per-entity-set statement blocks are
    " emitted in an arbitrary order, so a regeneration reports dozens of moved
    " but literally identical DATA lines and identical calls as changes. Diff
    " them statement by statement, pairing declarations by signature and every
    " other statement by its own text.
    IF it_old IS NOT INITIAL AND it_new IS NOT INITIAL
       AND zcl_vx_diff_decl=>is_generated_dpc_source( it_src = it_old ) = abap_true
       AND zcl_vx_diff_decl=>is_generated_dpc_source( it_src = it_new ) = abap_true.
      result = diff_declarations( it_old        = it_old
                                  it_new        = it_new
                                  i_ignore_case = i_ignore_case
                                  iv_text_keys  = abap_true ).
      IF result IS NOT INITIAL.
        RETURN.
      ENDIF.
    ENDIF.

    result = diff_lines( it_old        = it_old
                         it_new        = it_new
                         i_ignore_case = i_ignore_case
                         i_raw_ops     = i_raw_ops ).
  ENDMETHOD.


  METHOD diff_declarations.
    DATA(lt_pairs) = zcl_vx_diff_decl=>pair_declarations( it_old       = it_old
                                                           it_new       = it_new
                                                           iv_text_keys = iv_text_keys ).
    IF lt_pairs IS INITIAL.
      RETURN.
    ENDIF.

    DATA lt_slice_o TYPE abaptxt255_tab.
    DATA lt_slice_n TYPE abaptxt255_tab.
    DATA lv_i       TYPE i.

    LOOP AT lt_pairs INTO DATA(ls_pair).
      CLEAR: lt_slice_o, lt_slice_n.
      IF ls_pair-old_from > 0.
        lv_i = ls_pair-old_from.
        WHILE lv_i <= ls_pair-old_to.
          APPEND it_old[ lv_i ] TO lt_slice_o.
          lv_i = lv_i + 1.
        ENDWHILE.
      ENDIF.
      IF ls_pair-new_from > 0.
        lv_i = ls_pair-new_from.
        WHILE lv_i <= ls_pair-new_to.
          APPEND it_new[ lv_i ] TO lt_slice_n.
          lv_i = lv_i + 1.
        ENDWHILE.
      ENDIF.

      " Declaration only in the new version
      IF lt_slice_o IS INITIAL.
        LOOP AT lt_slice_n INTO DATA(ls_ins).
          APPEND VALUE ty_diff_op( op = '+' text = CONV string( ls_ins ) ) TO result.
        ENDLOOP.
        CONTINUE.
      ENDIF.

      " Declaration only in the old version
      IF lt_slice_n IS INITIAL.
        LOOP AT lt_slice_o INTO DATA(ls_del).
          APPEND VALUE ty_diff_op( op = '-' text = CONV string( ls_del ) ) TO result.
        ENDLOOP.
        CONTINUE.
      ENDIF.

      " Same declaration, byte-identical → unchanged even if it moved
      IF lt_slice_o = lt_slice_n.
        LOOP AT lt_slice_n INTO DATA(ls_eq).
          APPEND VALUE ty_diff_op( op = '=' text = CONV string( ls_eq ) ) TO result.
        ENDLOOP.
        CONTINUE.
      ENDIF.

      " Same declaration, changed content: align the parameter order first so a
      " re-sorted signature does not count as a change, then diff in isolation.
      lt_slice_o = zcl_vx_diff_decl=>align_params( it_old = lt_slice_o
                                                    it_new = lt_slice_n ).
      IF lt_slice_o = lt_slice_n.
        LOOP AT lt_slice_n INTO ls_eq.
          APPEND VALUE ty_diff_op( op = '=' text = CONV string( ls_eq ) ) TO result.
        ENDLOOP.
        CONTINUE.
      ENDIF.

      APPEND LINES OF diff_lines( it_old        = lt_slice_o
                                  it_new        = lt_slice_n
                                  i_ignore_case = i_ignore_case ) TO result.
    ENDLOOP.
  ENDMETHOD.


  METHOD diff_lines.
    " RS_CMP_COMPUTE_DELTA: text_tab1=new(pri), text_tab2=old(sec)
    " Confirmed by debugger (pa0001.persk added in new version):
    "   LINE1=52, LINE2=0, FLAG1='D', FLAG2='E', TEXT1=pa0001.persk
    "   → LINE2=0 means absent in old(tab2) → exists only in new(tab1) → INSERTED → op '+', TEXT1
    "   LINE1=0, FLAG1='E', FLAG2='I', TEXT2=...
    "   → LINE1=0 means absent in new(tab1) → exists only in old(tab2) → DELETED  → op '-', TEXT2
    "   FLAG1='M', FLAG2='M': TEXT1=new, TEXT2=old → op '-' TEXT2, op '+' TEXT1
    "   FLAG1=' ', FLAG2=' ' → equal → op '=' TEXT1

    DATA lt_old TYPE rswsourcet.
    DATA lt_new TYPE rswsourcet.
    LOOP AT it_old INTO DATA(ls_oi).
      APPEND CONV string( ls_oi ) TO lt_old.
    ENDLOOP.
    LOOP AT it_new INTO DATA(ls_ni).
      APPEND CONV string( ls_ni ) TO lt_new.
    ENDLOOP.

    DATA lt_delta TYPE TABLE OF rsedcresul.
    DATA ls_delta TYPE rsedcresul.

    CALL FUNCTION 'RS_CMP_COMPUTE_DELTA'
      EXPORTING
        compare_mode      = '1'
      TABLES
        text_tab1         = lt_old
        text_tab2         = lt_new
        text_tab_res      = lt_delta
      EXCEPTIONS
        parameter_invalid = 1
        OTHERS            = 2.

    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    LOOP AT lt_delta INTO ls_delta.
      IF ls_delta-flag1 = space AND ls_delta-flag2 = space.
        " Equal
        APPEND VALUE ty_diff_op( op = '=' text = CONV string( ls_delta-text1 ) ) TO result.

      ELSEIF ls_delta-line1 = 0.
        " Absent in new(tab1) → only in old(tab2) → deleted
        APPEND VALUE ty_diff_op( op = '-' text = CONV string( ls_delta-text2 ) ) TO result.

      ELSEIF ls_delta-line2 = 0.
        " Absent in old(tab2) → only in new(tab1) → inserted
        APPEND VALUE ty_diff_op( op = '+' text = CONV string( ls_delta-text1 ) ) TO result.

      ELSEIF ls_delta-flag1 = 'M' AND ls_delta-flag2 = 'M'.
        " Modified: TEXT1=new(tab1), TEXT2=old(tab2)
        APPEND VALUE ty_diff_op( op = '-' text = CONV string( ls_delta-text2 ) ) TO result.
        APPEND VALUE ty_diff_op( op = '+' text = CONV string( ls_delta-text1 ) ) TO result.

      ELSE.
        APPEND VALUE ty_diff_op( op = '=' text = CONV string( ls_delta-text1 ) ) TO result.
      ENDIF.
    ENDLOOP.

    " Post-pass: ignore-case/indent filter.
    " Whole change blocks are folded, not just adjacent couples: inside every
    " maximal run of consecutive '-'/'+' ops each deletion is matched with an
    " insertion whose text is identical after removing ALL whitespace (leading,
    " trailing and internal/alignment) and upper-casing. Every matched pair
    " collapses into one '=' line carrying the new text, so the new-side line
    " numbering is unaffected.
    "
    " Block-aware on purpose. RS_CMP reports a re-indented region as a run of
    " deletions followed by a run of insertions (and sometimes '+' before '-'),
    " which the old adjacent-pair pass could not see; the region survived as a
    " change and diff_to_html then rendered it with whitespace-only inline
    " markers (green boxes on otherwise identical code).
    IF i_ignore_case = abap_true.
      TYPES: BEGIN OF ty_fold,
               key  TYPE string,
               idx  TYPE i,
               used TYPE abap_bool,
             END OF ty_fold.
      " Sorted by KEY so the deletion→insertion lookup below stays logarithmic;
      " a full-file rewrite can put thousands of ops into a single block.
      DATA lt_fold_ins TYPE SORTED TABLE OF ty_fold WITH NON-UNIQUE KEY key idx.
      DATA lt_fold_drop TYPE HASHED TABLE OF i WITH UNIQUE KEY table_line.
      DATA lt_fold_eq   TYPE HASHED TABLE OF i WITH UNIQUE KEY table_line.
      DATA lt_out    TYPE ty_t_diff.
      DATA lv_norm   TYPE string.
      DATA lv_idx    TYPE i.
      DATA lv_tot    TYPE i.
      DATA lv_blk_end TYPE i.
      DATA lv_scan   TYPE i.

      lv_tot = lines( result ).
      lv_idx = 1.
      WHILE lv_idx <= lv_tot.
        IF result[ lv_idx ]-op = '='.
          APPEND result[ lv_idx ] TO lt_out.
          lv_idx = lv_idx + 1.
          CONTINUE.
        ENDIF.

        " Delimit the change block [lv_idx, lv_blk_end).
        lv_blk_end = lv_idx.
        WHILE lv_blk_end <= lv_tot AND result[ lv_blk_end ]-op <> '='.
          lv_blk_end = lv_blk_end + 1.
        ENDWHILE.

        CLEAR: lt_fold_ins, lt_fold_drop, lt_fold_eq.
        lv_scan = lv_idx.
        WHILE lv_scan < lv_blk_end.
          IF result[ lv_scan ]-op = '+'.
            lv_norm = result[ lv_scan ]-text.
            CONDENSE lv_norm NO-GAPS.
            INSERT VALUE ty_fold( key = to_upper( lv_norm ) idx = lv_scan ) INTO TABLE lt_fold_ins.
          ENDIF.
          lv_scan = lv_scan + 1.
        ENDWHILE.

        " Greedy first-unused matching, deletions in source order.
        lv_scan = lv_idx.
        WHILE lv_scan < lv_blk_end.
          IF result[ lv_scan ]-op = '-'.
            lv_norm = result[ lv_scan ]-text.
            CONDENSE lv_norm NO-GAPS.
            lv_norm = to_upper( lv_norm ).
            LOOP AT lt_fold_ins ASSIGNING FIELD-SYMBOL(<fold_ins>) WHERE key = lv_norm.
              CHECK <fold_ins>-used = abap_false.
              <fold_ins>-used = abap_true.
              INSERT lv_scan INTO TABLE lt_fold_drop.
              INSERT <fold_ins>-idx INTO TABLE lt_fold_eq.
              EXIT.
            ENDLOOP.
          ENDIF.
          lv_scan = lv_scan + 1.
        ENDWHILE.

        " Re-emit in source order: matched deletions vanish, their insert
        " partners become '=' so only indentation/case differed.
        lv_scan = lv_idx.
        WHILE lv_scan < lv_blk_end.
          IF line_exists( lt_fold_drop[ table_line = lv_scan ] ).
            " matched deletion — dropped
          ELSEIF line_exists( lt_fold_eq[ table_line = lv_scan ] ).
            APPEND VALUE ty_diff_op( op = '=' text = result[ lv_scan ]-text ) TO lt_out.
          ELSE.
            APPEND result[ lv_scan ] TO lt_out.
          ENDIF.
          lv_scan = lv_scan + 1.
        ENDWHILE.

        lv_idx = lv_blk_end.
      ENDWHILE.
      result = lt_out.
    ENDIF.

*   Keep for reference — replaced by the block-aware fold above. Only looked at
*   an adjacent (-,+) couple, so multi-line reindents stayed visible as changes.
*   It was also gated on the now-removed I_IGNORE_INDENT alone, so the six call
*   sites that only passed I_IGNORE_CASE never folded anything.
*    IF i_ignore_indent = abap_true.
*      lv_tot = lines( result ).
*      lv_idx = 1.
*      WHILE lv_idx <= lv_tot.
*        DATA(ls_cur) = result[ lv_idx ].
*        IF ls_cur-op = '-' AND lv_idx < lv_tot AND result[ lv_idx + 1 ]-op = '+'.
*          DATA(ls_nxt) = result[ lv_idx + 1 ].
*          DATA lv_old_n TYPE string.
*          DATA lv_new_n TYPE string.
*          lv_old_n = ls_cur-text.
*          lv_new_n = ls_nxt-text.
*          CONDENSE lv_old_n NO-GAPS.
*          CONDENSE lv_new_n NO-GAPS.
*          lv_old_n = to_upper( lv_old_n ).
*          lv_new_n = to_upper( lv_new_n ).
*          IF lv_old_n = lv_new_n.
*            " Only indentation/case differs → treat as equal (keep new text)
*            APPEND VALUE ty_diff_op( op = '=' text = ls_nxt-text ) TO lt_out.
*            lv_idx = lv_idx + 2.
*            CONTINUE.
*          ENDIF.
*        ENDIF.
*        APPEND ls_cur TO lt_out.
*        lv_idx = lv_idx + 1.
*      ENDWHILE.
*      result = lt_out.
*    ENDIF.

    " Post-pass: semantic cleanup of fragmenting anchor lines. Runs after
    " the ignore-case fold — otherwise the fold would re-merge the demoted
    " trivial (-,+) pairs (e.g. ENDIF./ELSE.) straight back into '=' anchors.
    " Detection callers stop here: everything below reshapes an already correct
    " diff for the eye, and both passes turn identical lines into '-'/'+'.
    IF i_raw_ops = abap_true.
      RETURN.
    ENDIF.

    cleanup_semantic( CHANGING ct_ops = result ).

    " Post-pass: pair deleted lines with their commented-out twins among the
    " inserts (old code commented out and moved below an inserted block).
    " RS_CMP can't see this — the lines are not identical. MUST run after
    " cleanup_semantic: cleanup demotes a structural '=' (e.g. ENDIF. matched
    " to the new code) into '-'/'+', which makes the old line available to pair
    " with its commented twin instead of leaving a stray '-' next to a '+'.
    pair_commented_twins( CHANGING ct_ops = result ).

  ENDMETHOD.


  METHOD comment_offset.
    " ABAP has two comment forms: a '*' in column 1 comments the whole line,
    " and a '"' comments the rest of the line from wherever it stands — unless
    " it sits inside a literal, where it is ordinary text. Hence the small
    " scanner instead of a FIND.
    CONSTANTS: lc_code TYPE i VALUE 0,   " outside any literal
               lc_quot TYPE i VALUE 1,   " inside '...'
               lc_back TYPE i VALUE 2,   " inside `...`
               lc_tmpl TYPE i VALUE 3.   " inside |...|

    DATA lv_state TYPE i.
    DATA lv_i     TYPE i.
    DATA lv_c     TYPE c LENGTH 1.

    result = -1.

    DATA(lv_trimmed) = condense( val = iv_text ).
    IF lv_trimmed IS INITIAL.
      RETURN.
    ENDIF.

    " Leading '*' — kept lenient (first non-blank, not strictly column 1) so a
    " version source that arrives indented is still recognised, as before.
    IF lv_trimmed(1) = '*'.
      result = 0.
      RETURN.
    ENDIF.

    DATA(lv_len) = strlen( iv_text ).
    lv_state = lc_code.
    WHILE lv_i < lv_len.
      lv_c = iv_text+lv_i(1).
      IF lv_state = lc_code.
        IF lv_c = '"'.
          result = lv_i.
          RETURN.
        ELSEIF lv_c = `'`.
          lv_state = lc_quot.
        ELSEIF lv_c = '`'.
          lv_state = lc_back.
        ELSEIF lv_c = '|'.
          lv_state = lc_tmpl.
        ENDIF.
      ELSEIF lv_state = lc_quot.
        " '' inside a literal closes and re-opens it — same result.
        IF lv_c = `'`.
          lv_state = lc_code.
        ENDIF.
      ELSEIF lv_state = lc_back.
        IF lv_c = '`'.
          lv_state = lc_code.
        ENDIF.
      ELSE.
        IF lv_c = '\'.
          lv_i = lv_i + 1.               " escaped char in a string template
        ELSEIF lv_c = '|'.
          lv_state = lc_code.
        ENDIF.
      ENDIF.
      lv_i = lv_i + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD esc_html.
    result = iv_text.
    REPLACE ALL OCCURRENCES OF `&` IN result WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN result WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN result WITH `&gt;`.
  ENDMETHOD.


  METHOD emit_eq_run.
    DATA(lv_len) = strlen( iv_text ).
    IF iv_cmt < 0 OR iv_off + lv_len <= iv_cmt.
      result = esc_html( iv_text ).      " run is entirely code
      RETURN.
    ENDIF.

    DATA(lv_pre) = COND i( WHEN iv_cmt > iv_off THEN iv_cmt - iv_off ELSE 0 ).
    result = esc_html( substring( val = iv_text len = lv_pre ) ) &&
             |<span style="color:#999">| &&
             esc_html( substring( val = iv_text off = lv_pre ) ) &&
             |</span>|.
  ENDMETHOD.


  METHOD char_diff_html.
    " Build char-level LCS ops and render grouped spans.
    DATA lv_old_t TYPE string.
    DATA lv_new_t TYPE string.
    lv_old_t = iv_old.
    lv_new_t = iv_new.
    WHILE strlen( lv_old_t ) > 0 AND substring( val = lv_old_t off = strlen( lv_old_t ) - 1 len = 1 ) = ` `.
      lv_old_t = substring( val = lv_old_t off = 0 len = strlen( lv_old_t ) - 1 ).
    ENDWHILE.
    WHILE strlen( lv_new_t ) > 0 AND substring( val = lv_new_t off = strlen( lv_new_t ) - 1 len = 1 ) = ` `.
      lv_new_t = substring( val = lv_new_t off = 0 len = strlen( lv_new_t ) - 1 ).
    ENDWHILE.

    DATA(lv_lo) = strlen( lv_old_t ).
    DATA(lv_ln) = strlen( lv_new_t ).
    DATA(lv_cols) = lv_ln + 1.
    DATA(lv_rows) = lv_lo + 1.

    " Build comparison strings: uppercase when ignore_case, verbatim otherwise.
    " Used for LCS matching only; lv_old_t / lv_new_t still hold original text for rendering.
    DATA lv_old_cmp TYPE string.
    DATA lv_new_cmp TYPE string.
    IF iv_ignore_case = abap_true.
      lv_old_cmp = to_upper( lv_old_t ).
      lv_new_cmp = to_upper( lv_new_t ).
    ELSE.
      lv_old_cmp = lv_old_t.
      lv_new_cmp = lv_new_t.
    ENDIF.

    DATA lt_dp TYPE TABLE OF i.
    DATA(lv_size) = lv_rows * lv_cols.
    DO lv_size TIMES.
      APPEND 0 TO lt_dp.
    ENDDO.

    DATA lv_i TYPE i.
    DATA lv_j TYPE i.
    lv_i = 1.
    WHILE lv_i <= lv_lo.
      lv_j = 1.
      WHILE lv_j <= lv_ln.
        DATA(lv_cell) = lv_i * lv_cols + lv_j + 1.
        DATA(lv_off_o) = lv_i - 1.
        DATA(lv_off_n) = lv_j - 1.
        IF lv_old_cmp+lv_off_o(1) = lv_new_cmp+lv_off_n(1).
          DATA(lv_prev) = ( lv_i - 1 ) * lv_cols + ( lv_j - 1 ) + 1.
          lt_dp[ lv_cell ] = lt_dp[ lv_prev ] + 1.
        ELSE.
          DATA(lv_up)   = ( lv_i - 1 ) * lv_cols + lv_j + 1.
          DATA(lv_left) = lv_i * lv_cols + ( lv_j - 1 ) + 1.
          lt_dp[ lv_cell ] = COND i(
            WHEN lt_dp[ lv_up ] >= lt_dp[ lv_left ] THEN lt_dp[ lv_up ]
            ELSE lt_dp[ lv_left ] ).
        ENDIF.
        lv_j = lv_j + 1.
      ENDWHILE.
      lv_i = lv_i + 1.
    ENDWHILE.

    DATA lt_ops TYPE ty_t_diff.
    lv_i = lv_lo.
    lv_j = lv_ln.
    WHILE lv_i > 0 OR lv_j > 0.
      DATA(lv_off_bo) = lv_i - 1.
      DATA(lv_off_bn) = lv_j - 1.
      IF lv_i > 0 AND lv_j > 0 AND lv_old_cmp+lv_off_bo(1) = lv_new_cmp+lv_off_bn(1).
        INSERT VALUE ty_diff_op( op = '=' text = lv_old_t+lv_off_bo(1) ) INTO lt_ops INDEX 1.
        lv_i = lv_i - 1.
        lv_j = lv_j - 1.
      ELSEIF lv_j > 0.
        IF lv_i = 0.
          INSERT VALUE ty_diff_op( op = '+' text = lv_new_t+lv_off_bn(1) ) INTO lt_ops INDEX 1.
          lv_j = lv_j - 1.
        ELSEIF lt_dp[ lv_i * lv_cols + ( lv_j - 1 ) + 1 ] > lt_dp[ ( lv_i - 1 ) * lv_cols + lv_j + 1 ].
          INSERT VALUE ty_diff_op( op = '+' text = lv_new_t+lv_off_bn(1) ) INTO lt_ops INDEX 1.
          lv_j = lv_j - 1.
        ELSEIF lv_i > 0.
          INSERT VALUE ty_diff_op( op = '-' text = lv_old_t+lv_off_bo(1) ) INTO lt_ops INDEX 1.
          lv_i = lv_i - 1.
        ENDIF.
      ELSEIF lv_i > 0.
        INSERT VALUE ty_diff_op( op = '-' text = lv_old_t+lv_off_bo(1) ) INTO lt_ops INDEX 1.
        lv_i = lv_i - 1.
      ENDIF.
    ENDWHILE.

    collapse_token_ops( CHANGING ct_ops = lt_ops ).

    DATA(lv_del_style) = `background:#ffb3b3;color:#cc0000;padding:0 2px;outline:1px solid #c66`.
    DATA(lv_ins_style) = `background:#afffaf;color:#006600;padding:0 2px;outline:1px solid #6c6`.
    DATA lv_buf    TYPE string.
    DATA lv_buf_op TYPE c LENGTH 1.

    " Comment part of the line being rendered, so an unchanged run that falls
    " into it is greyed like a comment line. The inserted/deleted runs keep
    " their green/red — those mark the change, not the syntax.
    DATA(lv_cmt_ref) = COND i( WHEN iv_side = 'O' THEN comment_offset( lv_old_t )
                                                  ELSE comment_offset( lv_new_t ) ).
    DATA lv_pos_o TYPE i.
    DATA lv_pos_n TYPE i.
    DATA lv_run   TYPE i.

    LOOP AT lt_ops INTO DATA(ls_part).
      IF lv_buf_op IS INITIAL OR ls_part-op = lv_buf_op.
        lv_buf = lv_buf && ls_part-text.
        lv_buf_op = ls_part-op.
        CONTINUE.
      ENDIF.

      DATA(lv_emit) = lv_buf.
      lv_run = strlen( lv_buf ).
      REPLACE ALL OCCURRENCES OF `&` IN lv_emit WITH `&amp;`.
      REPLACE ALL OCCURRENCES OF `<` IN lv_emit WITH `&lt;`.
      REPLACE ALL OCCURRENCES OF `>` IN lv_emit WITH `&gt;`.
      CASE lv_buf_op.
        WHEN '='.
          result = result && emit_eq_run(
            iv_text = lv_buf
            iv_off  = COND i( WHEN iv_side = 'O' THEN lv_pos_o ELSE lv_pos_n )
            iv_cmt  = lv_cmt_ref ).
          lv_pos_o = lv_pos_o + lv_run.
          lv_pos_n = lv_pos_n + lv_run.
        WHEN '-'.
          lv_pos_o = lv_pos_o + lv_run.
          IF iv_side <> 'N'.
            DATA(lv_emit_cnd) = lv_emit.
            CONDENSE lv_emit_cnd.
            IF lv_emit_cnd IS NOT INITIAL.   " skip pure-space deletions (alignment gaps)
              REPLACE ALL OCCURRENCES OF ` ` IN lv_emit WITH `&nbsp;`.
              result = result && |<span style="{ lv_del_style }">{ lv_emit }</span>|.
            ENDIF.
          ENDIF.
        WHEN '+'.
          lv_pos_n = lv_pos_n + lv_run.
          IF iv_side <> 'O'.
            REPLACE ALL OCCURRENCES OF ` ` IN lv_emit WITH `&nbsp;`.
            IF iv_ignore_case = abap_true AND condense( val = lv_buf ) = ``.
              " Pure-space insertion (re-indent/alignment) — emit unhighlighted so
              " the layout is preserved but no green marker appears. Mirrors the
              " pure-space deletion skip above.
              result = result && lv_emit.
            ELSE.
              result = result && |<span style="{ lv_ins_style }">{ lv_emit }</span>|.
            ENDIF.
          ENDIF.
      ENDCASE.

      lv_buf = ls_part-text.
      lv_buf_op = ls_part-op.
    ENDLOOP.

    IF lv_buf IS NOT INITIAL.
      DATA(lv_emit_last) = lv_buf.
      REPLACE ALL OCCURRENCES OF `&` IN lv_emit_last WITH `&amp;`.
      REPLACE ALL OCCURRENCES OF `<` IN lv_emit_last WITH `&lt;`.
      REPLACE ALL OCCURRENCES OF `>` IN lv_emit_last WITH `&gt;`.
      CASE lv_buf_op.
        WHEN '='.
          result = result && emit_eq_run(
            iv_text = lv_buf
            iv_off  = COND i( WHEN iv_side = 'O' THEN lv_pos_o ELSE lv_pos_n )
            iv_cmt  = lv_cmt_ref ).
        WHEN '-'.
          IF iv_side <> 'N'.
            DATA(lv_emit_last_cnd) = lv_emit_last.
            CONDENSE lv_emit_last_cnd.
            IF lv_emit_last_cnd IS NOT INITIAL.  " skip pure-space deletions
              REPLACE ALL OCCURRENCES OF ` ` IN lv_emit_last WITH `&nbsp;`.
              result = result && |<span style="{ lv_del_style }">{ lv_emit_last }</span>|.
            ENDIF.
          ENDIF.
        WHEN '+'.
          IF iv_side <> 'O'.
            REPLACE ALL OCCURRENCES OF ` ` IN lv_emit_last WITH `&nbsp;`.
            IF iv_ignore_case = abap_true AND condense( val = lv_buf ) = ``.
              result = result && lv_emit_last.   " pure-space insertion — no marker
            ELSE.
              result = result && |<span style="{ lv_ins_style }">{ lv_emit_last }</span>|.
            ENDIF.
          ENDIF.
      ENDCASE.
    ENDIF.
  ENDMETHOD.


  METHOD has_common_chars.
    " Mirrors hasCommonChars() in html_simulator/diff.js.
    DATA lv_a TYPE string.
    DATA lv_b TYPE string.
    lv_a = iv_a.
    lv_b = iv_b.

    WHILE strlen( lv_a ) > 0 AND substring( val = lv_a off = 0 len = 1 ) = ` `.
      lv_a = substring( val = lv_a off = 1 len = strlen( lv_a ) - 1 ).
    ENDWHILE.
    WHILE strlen( lv_b ) > 0 AND substring( val = lv_b off = 0 len = 1 ) = ` `.
      lv_b = substring( val = lv_b off = 1 len = strlen( lv_b ) - 1 ).
    ENDWHILE.
    WHILE strlen( lv_a ) > 0 AND substring( val = lv_a off = strlen( lv_a ) - 1 len = 1 ) = ` `.
      lv_a = substring( val = lv_a off = 0 len = strlen( lv_a ) - 1 ).
    ENDWHILE.
    WHILE strlen( lv_b ) > 0 AND substring( val = lv_b off = strlen( lv_b ) - 1 len = 1 ) = ` `.
      lv_b = substring( val = lv_b off = 0 len = strlen( lv_b ) - 1 ).
    ENDWHILE.

    DATA(lv_la) = strlen( lv_a ).
    DATA(lv_lb) = strlen( lv_b ).
    IF lv_la = 0 OR lv_lb = 0.
      result = abap_true.
      RETURN.
    ENDIF.
    " Two structural delimiters must never pair — neither identical (ENDIF./ENDIF.)
    " nor different ones sharing only the 'END' prefix (ENDLOOP. vs ENDIF.).
    IF is_trivial_anchor( lv_a ) = abap_true AND is_trivial_anchor( lv_b ) = abap_true.
      result = abap_false.
      RETURN.
    ENDIF.
    IF lv_a = lv_b.
      result = abap_true.
      RETURN.
    ENDIF.

    DATA lv_shorter TYPE string.
    DATA lv_longer  TYPE string.
    IF lv_la < lv_lb.
      lv_shorter = lv_a.
      lv_longer  = lv_b.
    ELSE.
      lv_shorter = lv_b.
      lv_longer  = lv_a.
    ENDIF.

    DATA(lv_shifted) = COND string(
      WHEN strlen( lv_longer ) > 1 THEN substring( val = lv_longer off = 1 )
      ELSE `` ).
    IF lv_shifted = lv_shorter.
      result = abap_true.
      RETURN.
    ENDIF.

    DATA(lv_tail) = lv_shifted.
    WHILE strlen( lv_tail ) > 0 AND lv_tail(1) = ` `.
      lv_tail = substring( val = lv_tail off = 1 len = strlen( lv_tail ) - 1 ).
    ENDWHILE.
    IF lv_tail = lv_shorter.
      result = abap_true.
      RETURN.
    ENDIF.

    " One line's content is contained in the other
    " (e.g. commented-out: old="  email TYPE x," new="  "email TYPE x, "comment")
    IF strlen( lv_shorter ) >= 3 AND lv_longer CS lv_shorter.
      result = abap_true.
      RETURN.
    ENDIF.

    DATA lv_cp TYPE i VALUE 0.
    WHILE lv_cp < lv_la AND lv_cp < lv_lb.
      IF substring( val = lv_a off = lv_cp len = 1 ) =
         substring( val = lv_b off = lv_cp len = 1 ).
        lv_cp = lv_cp + 1.
      ELSE.
        EXIT.
      ENDIF.
    ENDWHILE.
    IF lv_cp < 3. result = abap_false. RETURN. ENDIF.

    " Prefix must cover ≥25% of the shorter line — prevents pairing lines that
    " share only a leading keyword (OR, AND, IF, ...) but differ in substance.
    DATA(lv_min_len) = nmin( val1 = lv_la val2 = lv_lb ).
    IF lv_cp * 4 < lv_min_len. result = abap_false. RETURN. ENDIF.

    " Strip common suffix to isolate the changed middle
    DATA lv_cs      TYPE i VALUE 0.
    DATA lv_la_rest TYPE i.
    DATA lv_lb_rest TYPE i.
    lv_la_rest = lv_la - lv_cp.
    lv_lb_rest = lv_lb - lv_cp.
    WHILE lv_cs < lv_la_rest AND lv_cs < lv_lb_rest.
      IF substring( val = lv_a off = lv_la - 1 - lv_cs len = 1 ) =
         substring( val = lv_b off = lv_lb - 1 - lv_cs len = 1 ).
        lv_cs = lv_cs + 1.
      ELSE.
        EXIT.
      ENDIF.
    ENDWHILE.
    DATA lv_mid_a  TYPE string.
    DATA lv_mid_b  TYPE string.
    DATA lv_mid_la TYPE i.
    DATA lv_mid_lb TYPE i.
    lv_mid_la = lv_la - lv_cp - lv_cs.
    lv_mid_lb = lv_lb - lv_cp - lv_cs.
    IF lv_mid_la > 0.
      lv_mid_a = substring( val = lv_a off = lv_cp len = lv_mid_la ).
    ENDIF.
    IF lv_mid_lb > 0.
      lv_mid_b = substring( val = lv_b off = lv_cp len = lv_mid_lb ).
    ENDIF.
    " More than 2 edit runs in the middle → lines differ in too many places to pair
    IF count_edit_runs( iv_a = lv_mid_a iv_b = lv_mid_b ) > 2.
      result = abap_false. RETURN.
    ENDIF.
    IF count_char_edit_runs( iv_a = lv_mid_a iv_b = lv_mid_b ) > 2.
      result = abap_false. RETURN.
    ENDIF.
    result = abap_true.
  ENDMETHOD.


  METHOD build_blame_map.
    DATA(lv_title) = COND string(
      WHEN i_title IS INITIAL THEN |{ i_objtype }: { i_objname }|
      ELSE CONV string( i_title ) ).

    " Filter versions for this object within [i_from, i_to] and order ascending.
    "
    " SYSTEM IS INITIAL keeps the replay to this system's own history. The remote
    " baseline row carries the target SID there, and its version number is
    " normalized to Active (99998) — the same number the local Active state has —
    " so the range test alone let it in, and the sort by date put it *before* the
    " local Active because its timestamp is older. Every line that already exists
    " in the remote system was then credited to whoever last touched it over
    " there, with that system's date: a developer who never worked in this system
    " appeared as the author of the change, and the real author lost the block.
    " The remote row is a comparison baseline for the retrofit check, never a
    " step in this system's history.
    DATA lt_vers TYPE zif_vx_vers_types=>ty_t_version_row.
    IF i_from IS INITIAL.
      " New object — all lines credited to the object version author
      LOOP AT it_versions INTO DATA(ls_v)
        WHERE versno  <= i_to
          AND objtype  = i_objtype
          AND objname  = i_objname
          AND system  IS INITIAL.
        APPEND ls_v TO lt_vers.
      ENDLOOP.
    ELSE.
      " Existing object — trace changes across versions
      LOOP AT it_versions INTO ls_v
        WHERE versno  >= i_from
          AND versno  <= i_to
          AND objtype  = i_objtype
          AND objname  = i_objname
          AND system  IS INITIAL.
        APPEND ls_v TO lt_vers.
      ENDLOOP.
    ENDIF.
    SORT lt_vers BY versno ASCENDING datum ASCENDING zeit ASCENDING.

    IF lt_vers IS INITIAL. RETURN. ENDIF.

    DATA lt_prev_src TYPE abaptxt255_tab.
    DATA lt_cur_src TYPE abaptxt255_tab.
    DATA(ls_first) = lt_vers[ 1 ].
    lt_prev_src = zcl_vx_vers_data=>get_ver_source(
      i_objtype = ls_first-objtype i_objname = ls_first-objname i_versno = ls_first-versno
      i_korrnum = ls_first-korrnum i_author  = ls_first-author
      i_datum   = ls_first-datum   i_zeit    = ls_first-zeit ).

    IF i_from IS INITIAL.
      LOOP AT lt_prev_src INTO DATA(ls_line).
        APPEND VALUE zif_vx_vers_types=>ty_blame_entry(
          text        = CONV string( ls_line )
          author      = COND #( WHEN ls_first-obj_owner IS NOT INITIAL THEN ls_first-obj_owner ELSE ls_first-author )
          author_name = COND #( WHEN ls_first-obj_owner IS NOT INITIAL THEN ls_first-obj_owner_name ELSE ls_first-author_name )
          datum       = ls_first-datum
          zeit        = ls_first-zeit
          versno_text = ls_first-versno_text
          korrnum     = ls_first-korrnum
          task        = ls_first-task
          task_text   = ls_first-korr_text
        ) TO result.
      ENDLOOP.
    ELSEIF lines( lt_vers ) < 2.
      RETURN.
    ENDIF.

    IF lines( lt_vers ) < 2. RETURN. ENDIF.

    DATA(lv_total) = lines( lt_vers ) - 1.
    DATA lv_idx TYPE i VALUE 2.
    WHILE lv_idx <= lines( lt_vers ).
      DATA(lv_step) = lv_idx - 1.
      CALL FUNCTION 'SAPGUI_PROGRESS_INDICATOR'
        EXPORTING percentage = CONV i( lv_step * 100 / lv_total )
                  text       = CONV char70( |{ lv_title } blame ({ lv_step }/{ lv_total })| ).
      DATA(ls_ver) = lt_vers[ lv_idx ].
      lt_cur_src = zcl_vx_vers_data=>get_ver_source(
        i_objtype = ls_ver-objtype i_objname = ls_ver-objname i_versno = ls_ver-versno
        i_korrnum = ls_ver-korrnum i_author  = ls_ver-author
        i_datum   = ls_ver-datum   i_zeit    = ls_ver-zeit ).
      DATA(lt_diff) = compute_diff(
        it_old  = lt_prev_src
        it_new  = lt_cur_src
        i_title = |{ lv_title } blame ({ lv_step }/{ lv_total })|
        i_confirm_key = |BLAME~{ i_objtype }~{ i_objname }| ).
      LOOP AT lt_diff INTO DATA(ls_d).
        IF ls_d-op = '+'.
          DATA(lv_text) = ls_d-text.
          DELETE result WHERE text = lv_text.
          APPEND VALUE zif_vx_vers_types=>ty_blame_entry(
            text        = lv_text
            author      = COND #( WHEN ls_ver-obj_owner IS NOT INITIAL THEN ls_ver-obj_owner ELSE ls_ver-author )
            author_name = COND #( WHEN ls_ver-obj_owner IS NOT INITIAL THEN ls_ver-obj_owner_name ELSE ls_ver-author_name )
            datum       = ls_ver-datum
            zeit        = ls_ver-zeit
            versno_text = ls_ver-versno_text
            korrnum     = ls_ver-korrnum
            task        = ls_ver-task
            task_text   = ls_ver-korr_text
          ) TO result.
        ELSEIF ls_d-op = '-'.
          DELETE et_blame_deleted WHERE text = ls_d-text.
          APPEND VALUE zif_vx_vers_types=>ty_blame_entry(
            text        = ls_d-text
            author      = COND #( WHEN ls_ver-obj_owner IS NOT INITIAL THEN ls_ver-obj_owner ELSE ls_ver-author )
            author_name = COND #( WHEN ls_ver-obj_owner IS NOT INITIAL THEN ls_ver-obj_owner_name ELSE ls_ver-author_name )
            datum       = ls_ver-datum
            zeit        = ls_ver-zeit
            versno_text = ls_ver-versno_text
            korrnum     = ls_ver-korrnum
            task        = ls_ver-task
            task_text   = ls_ver-korr_text
          ) TO et_blame_deleted.
          DELETE result WHERE text = ls_d-text.
        ENDIF.
      ENDLOOP.

      lt_prev_src = lt_cur_src.
      lv_idx = lv_idx + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD count_edit_runs.
    " Tokenize by spaces; keep non-empty tokens (single-char tokens like = ( ) are valid anchors)
    DATA lt_a       TYPE TABLE OF string.
    DATA lt_b       TYPE TABLE OF string.
    DATA lt_tmp     TYPE TABLE OF string.
    DATA lt_pair_ia TYPE TABLE OF i.   " greedy-matched indices in lt_a (1-based)
    DATA lt_pair_ib TYPE TABLE OF i.   " greedy-matched indices in lt_b (1-based)
    DATA lv_jstart  TYPE i.
    DATA lv_jb      TYPE i.
    DATA lv_ia      TYPE i.
    DATA lv_np      TYPE i.
    DATA lv_k       TYPE i.
    DATA lv_pia     TYPE i.
    DATA lv_pib     TYPE i.
    DATA lv_pia2    TYPE i.
    DATA lv_pib2    TYPE i.

    SPLIT iv_a AT ` ` INTO TABLE lt_a.
    SPLIT iv_b AT ` ` INTO TABLE lt_b.
    LOOP AT lt_a INTO DATA(lv_t). IF lv_t IS NOT INITIAL. APPEND lv_t TO lt_tmp. ENDIF. ENDLOOP.
  lt_a = lt_tmp. CLEAR lt_tmp.
  LOOP AT lt_b INTO lv_t. IF lv_t IS NOT INITIAL. APPEND lv_t TO lt_tmp. ENDIF. ENDLOOP.
lt_b = lt_tmp.

DATA(lv_na) = lines( lt_a ).
DATA(lv_nb) = lines( lt_b ).
IF lv_na = 0 AND lv_nb = 0. RETURN.         ENDIF.
IF lv_na = 0 OR  lv_nb = 0. result = 1. RETURN. ENDIF.

    " Greedy forward scan: find matching token pairs (ia, ib) in ascending order
lv_jstart = 1.
DO lv_na TIMES.
  lv_ia = sy-index.
  lv_jb = lv_jstart.
  WHILE lv_jb <= lv_nb.
    IF lt_a[ lv_ia ] = lt_b[ lv_jb ].
      APPEND lv_ia TO lt_pair_ia.
      APPEND lv_jb TO lt_pair_ib.
      lv_jstart = lv_jb + 1.
      EXIT.
    ENDIF.
    lv_jb = lv_jb + 1.
  ENDWHILE.
ENDDO.

lv_np = lines( lt_pair_ia ).
IF lv_np = 0. result = 1. RETURN. ENDIF.

    " Count edit runs: unmatched region before first island,
    " between consecutive islands, and after last island
lv_pia = lt_pair_ia[ 1 ].
lv_pib = lt_pair_ib[ 1 ].
IF lv_pia > 1 OR lv_pib > 1. result = result + 1. ENDIF.
DO lv_np - 1 TIMES.
  lv_k    = sy-index.
  lv_pia  = lt_pair_ia[ lv_k ].
  lv_pib  = lt_pair_ib[ lv_k ].
  lv_pia2 = lt_pair_ia[ lv_k + 1 ].
  lv_pib2 = lt_pair_ib[ lv_k + 1 ].
  IF lv_pia2 > lv_pia + 1 OR lv_pib2 > lv_pib + 1.
    result = result + 1.
  ENDIF.
ENDDO.
lv_pia = lt_pair_ia[ lv_np ].
lv_pib = lt_pair_ib[ lv_np ].
IF lv_pia < lv_na OR lv_pib < lv_nb. result = result + 1. ENDIF.
  ENDMETHOD.


  METHOD count_char_edit_runs.
    DATA(lv_la) = strlen( iv_a ).
    DATA(lv_lb) = strlen( iv_b ).
    IF lv_la = 0 AND lv_lb = 0.
      RETURN.
    ENDIF.
    IF lv_la = 0 OR lv_lb = 0.
      result = 1.
      RETURN.
    ENDIF.

    DATA(lv_cols) = lv_lb + 1.
    DATA(lv_rows) = lv_la + 1.
    DATA lt_dp TYPE TABLE OF i.
    DATA(lv_size) = lv_rows * lv_cols.
    DO lv_size TIMES.
      APPEND 0 TO lt_dp.
    ENDDO.

    DATA lv_i TYPE i.
    DATA lv_j TYPE i.
    lv_i = 1.
    WHILE lv_i <= lv_la.
      lv_j = 1.
      WHILE lv_j <= lv_lb.
        DATA(lv_cell) = lv_i * lv_cols + lv_j + 1.
        DATA(lv_off_a) = lv_i - 1.
        DATA(lv_off_b) = lv_j - 1.
        IF iv_a+lv_off_a(1) = iv_b+lv_off_b(1).
          DATA(lv_prev) = ( lv_i - 1 ) * lv_cols + ( lv_j - 1 ) + 1.
          lt_dp[ lv_cell ] = lt_dp[ lv_prev ] + 1.
        ELSE.
          DATA(lv_up)   = ( lv_i - 1 ) * lv_cols + lv_j + 1.
          DATA(lv_left) = lv_i * lv_cols + ( lv_j - 1 ) + 1.
          lt_dp[ lv_cell ] = COND i(
            WHEN lt_dp[ lv_up ] >= lt_dp[ lv_left ] THEN lt_dp[ lv_up ]
            ELSE lt_dp[ lv_left ] ).
        ENDIF.
        lv_j = lv_j + 1.
      ENDWHILE.
      lv_i = lv_i + 1.
    ENDWHILE.

    DATA lt_ops TYPE ty_t_diff.
    lv_i = lv_la.
    lv_j = lv_lb.
    WHILE lv_i > 0 OR lv_j > 0.
      DATA(lv_back_a) = lv_i - 1.
      DATA(lv_back_b) = lv_j - 1.
      IF lv_i > 0 AND lv_j > 0 AND iv_a+lv_back_a(1) = iv_b+lv_back_b(1).
        INSERT VALUE ty_diff_op( op = '=' text = iv_a+lv_back_a(1) ) INTO lt_ops INDEX 1.
        lv_i = lv_i - 1.
        lv_j = lv_j - 1.
      ELSEIF lv_j > 0.
        IF lv_i = 0.
          INSERT VALUE ty_diff_op( op = '+' text = iv_b+lv_back_b(1) ) INTO lt_ops INDEX 1.
          lv_j = lv_j - 1.
        ELSEIF lt_dp[ lv_i * lv_cols + ( lv_j - 1 ) + 1 ] > lt_dp[ ( lv_i - 1 ) * lv_cols + lv_j + 1 ].
          INSERT VALUE ty_diff_op( op = '+' text = iv_b+lv_back_b(1) ) INTO lt_ops INDEX 1.
          lv_j = lv_j - 1.
        ELSE.
          INSERT VALUE ty_diff_op( op = '-' text = iv_a+lv_back_a(1) ) INTO lt_ops INDEX 1.
          lv_i = lv_i - 1.
        ENDIF.
      ELSE.
        INSERT VALUE ty_diff_op( op = '-' text = iv_a+lv_back_a(1) ) INTO lt_ops INDEX 1.
        lv_i = lv_i - 1.
      ENDIF.
    ENDWHILE.

    DATA lv_in_edit TYPE abap_bool.
    LOOP AT lt_ops INTO DATA(ls_op).
      IF ls_op-op = '='.
        lv_in_edit = abap_false.
      ELSEIF lv_in_edit = abap_false.
        result = result + 1.
        lv_in_edit = abap_true.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD is_trivial_anchor.
    " condense() removes leading/trailing blanks (and collapses inner runs), so a
    " line still matches regardless of its indentation.
    DATA(lv) = to_upper( condense( iv_line ) ).
    " strip trailing periods/spaces
    WHILE strlen( lv ) > 0
      AND ( substring( val = lv off = strlen( lv ) - 1 len = 1 ) = '.'
         OR substring( val = lv off = strlen( lv ) - 1 len = 1 ) = ` ` ).
      lv = substring( val = lv off = 0 len = strlen( lv ) - 1 ).
    ENDWHILE.
    result = xsdbool(
         lv = 'ENDIF'        OR lv = 'ELSE'      OR lv = 'ENDLOOP'
      OR lv = 'ENDTRY'       OR lv = 'ENDDO'     OR lv = 'ENDCASE'
      OR lv = 'ENDWHILE'     OR lv = 'ENDMETHOD' OR lv = 'ENDFORM'
      OR lv = 'ENDFUNCTION'  OR lv = 'ENDMODULE' OR lv = 'ENDCLASS'
      OR lv = 'ENDSELECT'    OR lv = 'ENDAT'     OR lv = 'ENDPROVIDE'
      OR lv = 'ENDINTERFACE' OR lv = 'TRY'       OR lv = 'ENDENHANCEMENT' ).
  ENDMETHOD.


  METHOD pair_change_block.
    CLEAR: et_del_pair, et_ins_pair.
    DATA(lv_nd) = lines( it_dels ).
    DATA(lv_ni) = lines( it_ins ).
    IF lv_nd = 0 OR lv_ni = 0.
      RETURN.
    ENDIF.

    DATA(lv_cols) = lv_ni + 1.
    DATA lt_dp TYPE TABLE OF i.
    DATA(lv_size) = ( lv_nd + 1 ) * lv_cols.
    DO lv_size TIMES.
      APPEND 0 TO lt_dp.
    ENDDO.

    DATA lv_d TYPE i.
    DATA lv_i TYPE i.
    lv_d = 1.
    WHILE lv_d <= lv_nd.
      lv_i = 1.
      WHILE lv_i <= lv_ni.
        DATA(lv_cell) = lv_d * lv_cols + lv_i + 1.
        IF has_common_chars( iv_a = it_dels[ lv_d ] iv_b = it_ins[ lv_i ] ) = abap_true.
          lt_dp[ lv_cell ] = lt_dp[ ( lv_d - 1 ) * lv_cols + ( lv_i - 1 ) + 1 ] + 1.
        ELSE.
          DATA(lv_up)   = ( lv_d - 1 ) * lv_cols + lv_i + 1.
          DATA(lv_left) = lv_d * lv_cols + ( lv_i - 1 ) + 1.
          lt_dp[ lv_cell ] = COND i(
            WHEN lt_dp[ lv_up ] >= lt_dp[ lv_left ] THEN lt_dp[ lv_up ]
            ELSE lt_dp[ lv_left ] ).
        ENDIF.
        lv_i = lv_i + 1.
      ENDWHILE.
      lv_d = lv_d + 1.
    ENDWHILE.

    lv_d = lv_nd.
    lv_i = lv_ni.
    WHILE lv_d > 0 AND lv_i > 0.
      IF has_common_chars( iv_a = it_dels[ lv_d ] iv_b = it_ins[ lv_i ] ) = abap_true.
        INSERT lv_d INTO et_del_pair INDEX 1.
        INSERT lv_i INTO et_ins_pair INDEX 1.
        lv_d = lv_d - 1.
        lv_i = lv_i - 1.
      ELSE.
        DATA(lv_up_bt)   = ( lv_d - 1 ) * lv_cols + lv_i + 1.
        DATA(lv_left_bt) = lv_d * lv_cols + ( lv_i - 1 ) + 1.
        IF lt_dp[ lv_up_bt ] >= lt_dp[ lv_left_bt ].
          lv_d = lv_d - 1.
        ELSE.
          lv_i = lv_i - 1.
        ENDIF.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.


  METHOD pair_commented_twins.
    DATA(lv_n) = lines( ct_ops ).
    IF lv_n = 0.
      RETURN.
    ENDIF.

    " Per-op normalized text (leading spaces/'*' stripped) and comment flag.
    DATA lt_norm   TYPE STANDARD TABLE OF string   WITH DEFAULT KEY.
    DATA lt_is_cmt TYPE STANDARD TABLE OF abap_bool WITH DEFAULT KEY.
    DATA lv_k    TYPE i.
    DATA lv_off  TYPE i.
    DATA lv_len  TYPE i.
    DATA lv_txt  TYPE string.
    DATA lv_norm TYPE string.

    lv_k = 1.
    WHILE lv_k <= lv_n.
      lv_txt = ct_ops[ lv_k ]-text.
      lv_len = strlen( lv_txt ).
      " skip leading spaces
      lv_off = 0.
      WHILE lv_off < lv_len AND lv_txt+lv_off(1) = ` `.
        lv_off = lv_off + 1.
      ENDWHILE.
      DATA(lv_cmt) = xsdbool( lv_off < lv_len AND lv_txt+lv_off(1) = '*' ).
      APPEND lv_cmt TO lt_is_cmt.
      " normalized: strip leading spaces and '*'
      WHILE lv_off < lv_len AND ( lv_txt+lv_off(1) = ` ` OR lv_txt+lv_off(1) = '*' ).
        lv_off = lv_off + 1.
      ENDWHILE.
      IF lv_off < lv_len.
        lv_norm = lv_txt+lv_off.
      ELSE.
        lv_norm = ``.
      ENDIF.
      APPEND lv_norm TO lt_norm.
      lv_k = lv_k + 1.
    ENDWHILE.

    " Pre-scan: greedily pair each commented '+' with the earliest still
    " available '-' of equal normalized content that appeared before it.
    TYPES: BEGIN OF ty_avail,
             norm TYPE string,
             idx  TYPE i,
           END OF ty_avail.
    DATA lt_avail TYPE SORTED TABLE OF ty_avail WITH NON-UNIQUE KEY norm.

    DATA lt_consumed   TYPE STANDARD TABLE OF abap_bool WITH DEFAULT KEY.  " '-' moved away
    DATA lt_pair_minus TYPE STANDARD TABLE OF i         WITH DEFAULT KEY.  " '+' → source '-' idx
    DATA lv_any TYPE abap_bool.
    DO lv_n TIMES.
      APPEND abap_false TO lt_consumed.
      APPEND 0          TO lt_pair_minus.
    ENDDO.

    lv_k = 1.
    WHILE lv_k <= lv_n.
      DATA(lv_op) = ct_ops[ lv_k ]-op.
      lv_norm = lt_norm[ lv_k ].
      IF lv_op = '-'.
        IF strlen( lv_norm ) >= 3.
          INSERT VALUE ty_avail( norm = lv_norm idx = lv_k ) INTO TABLE lt_avail.
        ENDIF.
      ELSEIF lv_op = '+' AND lt_is_cmt[ lv_k ] = abap_true AND strlen( lv_norm ) >= 3.
        READ TABLE lt_avail ASSIGNING FIELD-SYMBOL(<av>) WITH KEY norm = lv_norm BINARY SEARCH.
        IF sy-subrc = 0.
          DATA(lv_m) = <av>-idx.
          " raw text must actually differ (else RS_CMP would have made it '=')
          IF ct_ops[ lv_m ]-text <> ct_ops[ lv_k ]-text.
            lt_pair_minus[ lv_k ] = lv_m.
            lt_consumed[ lv_m ]   = abap_true.
            lv_any = abap_true.
          ENDIF.
          DELETE lt_avail INDEX sy-tabix.
        ENDIF.
      ENDIF.
      lv_k = lv_k + 1.
    ENDWHILE.

    IF lv_any = abap_false.
      RETURN.
    ENDIF.

    " Rebuild: drop moved '-' from their old place; emit them right before the
    " matching commented '+' as a modification pair.
    DATA lt_out TYPE ty_t_diff.
    lv_k = 1.
    WHILE lv_k <= lv_n.
      IF lt_consumed[ lv_k ] = abap_true.
        " moved away — skip here
      ELSEIF lt_pair_minus[ lv_k ] > 0.
        APPEND ct_ops[ lt_pair_minus[ lv_k ] ] TO lt_out.   " the '-' original
        APPEND ct_ops[ lv_k ]                  TO lt_out.   " the commented '+'
      ELSE.
        APPEND ct_ops[ lv_k ] TO lt_out.
      ENDIF.
      lv_k = lv_k + 1.
    ENDWHILE.
    ct_ops = lt_out.
  ENDMETHOD.


  METHOD cleanup_semantic.
    " Iterate to a fixpoint: each pass demotes eligible equality runs, which
    " merges the surrounding change runs and may expose further candidates.
    DATA lt_out   TYPE ty_t_diff.
    DATA lv_chg   TYPE abap_bool VALUE abap_true.
    DATA lv_n     TYPE i.
    DATA lv_i     TYPE i.
    DATA lv_a     TYPE i.   " equality run start
    DATA lv_b     TYPE i.   " equality run end
    DATA lv_k     TYPE i.
    DATA lv_all_trivial TYPE abap_bool.

    WHILE lv_chg = abap_true.
      lv_chg = abap_false.
      CLEAR lt_out.
      lv_n = lines( ct_ops ).
      lv_i = 1.
      WHILE lv_i <= lv_n.
        IF ct_ops[ lv_i ]-op <> '='.
          APPEND ct_ops[ lv_i ] TO lt_out.
          lv_i = lv_i + 1.
          CONTINUE.
        ENDIF.

        " Maximal equality run [lv_a .. lv_b]
        lv_a = lv_i.
        lv_b = lv_i.
        WHILE lv_b < lv_n AND ct_ops[ lv_b + 1 ]-op = '='.
          lv_b = lv_b + 1.
        ENDWHILE.

        " Demote the run only when it consists SOLELY of trivial structural
        " lines (ENDIF./ELSE./TRY./… and blanks) flanked by changes on both
        " sides. Meaningful common lines (e.g. IF sy-subrc EQ 0., AND ( … ))
        " must stay '=' anchors so identical code keeps matching across a big
        " replacement — never demote them on a length heuristic.
        IF lv_a > 1 AND lv_b < lv_n.
          lv_all_trivial = abap_true.
          lv_k = lv_a.
          WHILE lv_k <= lv_b.
            DATA(lv_ct_cond) = condense( ct_ops[ lv_k ]-text ).
            IF lv_ct_cond IS NOT INITIAL
               AND is_trivial_anchor( ct_ops[ lv_k ]-text ) = abap_false.
              lv_all_trivial = abap_false.
            ENDIF.
            lv_k = lv_k + 1.
          ENDWHILE.

          IF lv_all_trivial = abap_true.
            lv_k = lv_a.
            WHILE lv_k <= lv_b.
              APPEND VALUE ty_diff_op( op = '-' text = ct_ops[ lv_k ]-text ) TO lt_out.
              lv_k = lv_k + 1.
            ENDWHILE.
            lv_k = lv_a.
            WHILE lv_k <= lv_b.
              APPEND VALUE ty_diff_op( op = '+' text = ct_ops[ lv_k ]-text ) TO lt_out.
              lv_k = lv_k + 1.
            ENDWHILE.
            lv_chg = abap_true.
            lv_i = lv_b + 1.
            CONTINUE.
          ENDIF.
        ENDIF.

        " Keep equality run as-is
        lv_k = lv_a.
        WHILE lv_k <= lv_b.
          APPEND ct_ops[ lv_k ] TO lt_out.
          lv_k = lv_k + 1.
        ENDWHILE.
        lv_i = lv_b + 1.
      ENDWHILE.
      ct_ops = lt_out.
    ENDWHILE.
  ENDMETHOD.


  METHOD collapse_token_ops.
    " Collapse word tokens where both deletions AND insertions exist (>2 total)
    " into whole-token replace, rather than showing partial char-level matches.
DATA lt_result TYPE ty_t_diff.
DATA lv_ts     TYPE i VALUE 1.
DATA lv_te     TYPE i.
DATA lv_tk     TYPE i.
DATA lv_c0     TYPE string.
DATA lv_cn     TYPE string.
DATA lv_iw     TYPE abap_bool.
DATA lv_iwn    TYPE abap_bool.
DATA lv_opn    TYPE c LENGTH 1.
DATA lv_dc     TYPE i.
DATA lv_ic     TYPE i.
DATA lv_ot     TYPE string.
DATA lv_nt     TYPE string.
DATA lv_opk    TYPE c LENGTH 1.
DATA lv_ec     TYPE string.
DATA lv_wch    TYPE string VALUE
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.
DATA(lv_no) = lines( ct_ops ).
WHILE lv_ts <= lv_no.
  lv_c0 = ct_ops[ lv_ts ]-text.
  lv_iw = xsdbool( lv_c0 CO lv_wch ).
  IF lv_iw = abap_false AND ct_ops[ lv_ts ]-op = '='.
    APPEND ct_ops[ lv_ts ] TO lt_result.
    lv_ts = lv_ts + 1.
    CONTINUE.
  ENDIF.
  lv_te = lv_ts.
  WHILE lv_te < lv_no.
    lv_cn  = ct_ops[ lv_te + 1 ]-text.
    lv_iwn = xsdbool( lv_cn CO lv_wch ).
    lv_opn = ct_ops[ lv_te + 1 ]-op.
    IF lv_opn <> '=' OR lv_iwn = abap_true.
      lv_te = lv_te + 1.
    ELSE.
      EXIT.
    ENDIF.
  ENDWHILE.
  CLEAR: lv_dc, lv_ic, lv_ot, lv_nt.
  lv_tk = lv_ts.
  WHILE lv_tk <= lv_te.
    lv_opk = ct_ops[ lv_tk ]-op.
    lv_ec  = ct_ops[ lv_tk ]-text.
    CASE lv_opk.
      WHEN '-'.
        lv_ot = lv_ot && lv_ec.
        lv_dc = lv_dc + 1.
      WHEN '+'.
        lv_nt = lv_nt && lv_ec.
        lv_ic = lv_ic + 1.
      WHEN '='.
        lv_ot = lv_ot && lv_ec.
        lv_nt = lv_nt && lv_ec.
    ENDCASE.
    lv_tk = lv_tk + 1.
  ENDWHILE.
  IF lv_dc > 0 AND lv_ic > 0 AND lv_dc + lv_ic > 2.
    IF lv_ot IS NOT INITIAL.
      APPEND VALUE ty_diff_op( op = '-' text = lv_ot ) TO lt_result.
    ENDIF.
    IF lv_nt IS NOT INITIAL.
      APPEND VALUE ty_diff_op( op = '+' text = lv_nt ) TO lt_result.
    ENDIF.
  ELSE.
    lv_tk = lv_ts.
    WHILE lv_tk <= lv_te.
      APPEND ct_ops[ lv_tk ] TO lt_result.
      lv_tk = lv_tk + 1.
    ENDWHILE.
  ENDIF.
  lv_ts = lv_te + 1.
ENDWHILE.
ct_ops = lt_result.
  ENDMETHOD.
ENDCLASS.
