"! Declaration-aware pairing for class section sources (PUBLIC / PROTECTED /
"! PRIVATE SECTION includes).
"!
"! SAP regenerates section includes with an ARBITRARY declaration order: a
"! method sitting on line 9 in one version can sit on line 57 in the next one
"! without anybody touching it. A plain line diff then
"!   * reports every moved declaration as a deletion far away from its insert,
"!   * and — much worse — matches the "importing" / "!IV_X type Y" lines of ONE
"!     method against those of ANOTHER method, because those lines are literally
"!     identical everywhere, which shreds the whole section into noise hunks.
"!
"! PAIR_DECLARATIONS splits both sides into declaration blocks and pairs them by
"! signature key (declaration kind + declared name) regardless of position, so
"! ZCL_VX_DIFF can diff each declaration in isolation. ALIGN_PARAMS does
"! the same one level deeper for the parameters of a single method signature.
CLASS zcl_vx_diff_decl DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    "! One slot of the paired section, in NEW-side order.
    "! OLD_FROM = 0 → declaration exists only in the new version (inserted)
    "! NEW_FROM = 0 → declaration exists only in the old version (deleted)
    TYPES:
      BEGIN OF ty_pair,
        key      TYPE string,
        old_from TYPE i,
        old_to   TYPE i,
        new_from TYPE i,
        new_to   TYPE i,
      END OF ty_pair.
    TYPES ty_t_pair TYPE STANDARD TABLE OF ty_pair WITH DEFAULT KEY.

    "! True when IT_SRC is a class section include, i.e. its first statement is
    "! PUBLIC / PROTECTED / PRIVATE SECTION. Deliberately narrow: only those
    "! sources are generated with an unstable declaration order, and only for
    "! them is declaration order semantically irrelevant.
    CLASS-METHODS is_section_source
      IMPORTING it_src        TYPE abaptxt255_tab
      RETURNING VALUE(result) TYPE abap_bool.

    "! True when IT_SRC is a generated Gateway DPC method body, recognized by
    "! the generator banner SAP puts on top of it ("This class has been
    "! generated …" together with the DPC include name). Those bodies are
    "! regenerated with an arbitrary order of the local DATA declarations and of
    "! the per-entity-set blocks, so the same instability as in class sections
    "! applies — with the difference that the body also contains ordinary
    "! statements, which are then paired by their own text instead of by
    "! position (see IV_TEXT_KEYS of PAIR_DECLARATIONS).
    CLASS-METHODS is_generated_dpc_source
      IMPORTING it_src        TYPE abaptxt255_tab
      RETURNING VALUE(result) TYPE abap_bool.

    "! Pair the declarations of two section sources by signature key. The result
    "! tiles BOTH sources completely (every line of IT_OLD and IT_NEW belongs to
    "! exactly one pair), ordered by the new side; a deleted declaration is
    "! emitted next to the declaration it preceded in the old source.
    "! IV_TEXT_KEYS = abap_true keys every non-declaration statement by its own
    "! normalized text instead of by position, so identical statements (the
    "! repeated CALL METHOD / copy_data_to_ref blocks of a generated DPC body)
    "! pair with each other no matter where the generator put them.
    CLASS-METHODS pair_declarations
      IMPORTING it_old        TYPE abaptxt255_tab
                it_new        TYPE abaptxt255_tab
                iv_text_keys  TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(result) TYPE ty_t_pair.

    "! Reorder the parameter lines of an old method declaration so they follow
    "! the parameter order of the new declaration (matched by group + parameter
    "! name). The run of parameters that carries the statement-terminating '.'
    "! is left untouched, so the closing period never travels upwards.
    CLASS-METHODS align_params
      IMPORTING it_old        TYPE abaptxt255_tab
                it_new        TYPE abaptxt255_tab
      RETURNING VALUE(result) TYPE abaptxt255_tab.

  PROTECTED SECTION.
  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_block,
        key  TYPE string,
        from TYPE i,
        to   TYPE i,
      END OF ty_block.
    TYPES ty_t_block TYPE STANDARD TABLE OF ty_block WITH DEFAULT KEY.
    TYPES ty_t_int   TYPE STANDARD TABLE OF i WITH DEFAULT KEY.

    "! Split a section source into declaration blocks. Blocks tile the source:
    "! leading blank/comment lines belong to the statement that follows them.
    CLASS-METHODS parse_blocks
      IMPORTING it_src        TYPE abaptxt255_tab
                iv_text_keys  TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(result) TYPE ty_t_block.

    "! Strip the comment part of a line and report whether the line closes the
    "! current statement (a '.' outside of string literals).
    CLASS-METHODS split_code
      IMPORTING iv_line TYPE string
      EXPORTING ev_code TYPE string
                ev_ends TYPE abap_bool.

    "! Signature key of a declaration statement: kind + declared name, e.g.
    "! 'M:CREATE_PROCESS_HEADER', 'D:MT_DWS_CACHE', 'T:GTY_S_PERM_DATA_BUFFER'.
    "! Empty for anything that is not a declaration (section headers, …).
    CLASS-METHODS decl_key
      IMPORTING iv_stmt       TYPE string
      RETURNING VALUE(result) TYPE string.

    "! Per-line parameter keys ('<group>:<name>') of a method declaration;
    "! empty for the method head, the group keywords and comment lines.
    CLASS-METHODS param_keys
      IMPORTING it_src        TYPE abaptxt255_tab
      RETURNING VALUE(result) TYPE string_table.
ENDCLASS.



CLASS zcl_vx_diff_decl IMPLEMENTATION.


  METHOD is_section_source.
    LOOP AT it_src INTO DATA(ls_line).
      DATA lv_code TYPE string.
      split_code( EXPORTING iv_line = CONV string( ls_line )
                  IMPORTING ev_code = lv_code ).
      DATA(lv_txt) = to_upper( condense( lv_code ) ).
      IF lv_txt IS INITIAL.
        CONTINUE.                 " blank or pure comment line
      ENDIF.
      result = xsdbool(    lv_txt CP 'PUBLIC SECTION*'
                        OR lv_txt CP 'PROTECTED SECTION*'
                        OR lv_txt CP 'PRIVATE SECTION*' ).
      RETURN.                     " decision is taken on the FIRST code line
    ENDLOOP.
  ENDMETHOD.


  METHOD is_generated_dpc_source.
    DATA lv_gen TYPE abap_bool.
    DATA lv_dpc TYPE abap_bool.

    LOOP AT it_src INTO DATA(ls_line).
      IF sy-tabix > 20.
        EXIT.                       " the banner is always the first block
      ENDIF.
      DATA(lv_txt) = to_upper( CONV string( ls_line ) ).
      IF lv_txt CS 'HAS BEEN GENERATED'.
        lv_gen = abap_true.
      ENDIF.
      IF lv_txt CS 'DPC'.
        lv_dpc = abap_true.
      ENDIF.
    ENDLOOP.

    result = xsdbool( lv_gen = abap_true AND lv_dpc = abap_true ).
  ENDMETHOD.


  METHOD pair_declarations.
    DATA(lt_bo) = parse_blocks( it_src = it_old iv_text_keys = iv_text_keys ).
    DATA(lt_bn) = parse_blocks( it_src = it_new iv_text_keys = iv_text_keys ).
    IF lt_bo IS INITIAL OR lt_bn IS INITIAL.
      RETURN.
    ENDIF.

    " ---- match new blocks to old blocks by signature key ------------------
    " Sorted index so a section with hundreds of declarations stays cheap.
    " Duplicate keys (chained declarations) are consumed in source order.
    TYPES: BEGIN OF ty_okey,
             key  TYPE string,
             idx  TYPE i,
             used TYPE abap_bool,
           END OF ty_okey.
    DATA lt_okey TYPE SORTED TABLE OF ty_okey WITH NON-UNIQUE KEY key idx.
    LOOP AT lt_bo INTO DATA(ls_bo).
      INSERT VALUE ty_okey( key = ls_bo-key idx = sy-tabix ) INTO TABLE lt_okey.
    ENDLOOP.

    DATA lt_match TYPE ty_t_int.   " new index → old index (0 = unmatched)
    DATA lt_taken TYPE ty_t_int.   " old index → 1 when paired with a new block
    DATA lt_done  TYPE ty_t_int.   " old index → 1 when already emitted
    DO lines( lt_bn ) TIMES.
      APPEND 0 TO lt_match.
    ENDDO.
    DO lines( lt_bo ) TIMES.
      APPEND 0 TO lt_taken.
      APPEND 0 TO lt_done.
    ENDDO.

    LOOP AT lt_bn INTO DATA(ls_bn).
      DATA(lv_n) = sy-tabix.
      LOOP AT lt_okey ASSIGNING FIELD-SYMBOL(<okey>) WHERE key = ls_bn-key.
        CHECK <okey>-used = abap_false.
        <okey>-used            = abap_true.
        lt_match[ lv_n ]       = <okey>-idx.
        lt_taken[ <okey>-idx ] = 1.
        EXIT.
      ENDLOOP.
    ENDLOOP.

    " ---- emit in NEW order ------------------------------------------------
    LOOP AT lt_bn INTO ls_bn.
      lv_n = sy-tabix.
      DATA(lv_o) = lt_match[ lv_n ].
      IF lv_o = 0.
        APPEND VALUE ty_pair( key      = ls_bn-key
                              new_from = ls_bn-from
                              new_to   = ls_bn-to ) TO result.
        CONTINUE.
      ENDIF.

      " Deleted declarations travel with the declaration they preceded, so a
      " deletion is rendered in its old neighbourhood instead of at the bottom.
      DATA(lv_first) = lv_o.
      DATA(lv_j)     = lv_o - 1.
      WHILE lv_j >= 1.
        IF lt_taken[ lv_j ] <> 0 OR lt_done[ lv_j ] <> 0.
          EXIT.
        ENDIF.
        lv_first = lv_j.
        lv_j     = lv_j - 1.
      ENDWHILE.
      DATA(lv_k) = lv_first.
      WHILE lv_k < lv_o.
        APPEND VALUE ty_pair( key      = lt_bo[ lv_k ]-key
                              old_from = lt_bo[ lv_k ]-from
                              old_to   = lt_bo[ lv_k ]-to ) TO result.
        lt_done[ lv_k ] = 1.
        lv_k = lv_k + 1.
      ENDWHILE.

      APPEND VALUE ty_pair( key      = ls_bn-key
                            old_from = lt_bo[ lv_o ]-from
                            old_to   = lt_bo[ lv_o ]-to
                            new_from = ls_bn-from
                            new_to   = ls_bn-to ) TO result.
      lt_done[ lv_o ] = 1.
    ENDLOOP.

    " ---- deletions after the last matched declaration ---------------------
    LOOP AT lt_bo INTO ls_bo.
      IF lt_done[ sy-tabix ] = 0.
        APPEND VALUE ty_pair( key      = ls_bo-key
                              old_from = ls_bo-from
                              old_to   = ls_bo-to ) TO result.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD align_params.
    result = it_old.
    DATA(lv_no) = lines( it_old ).
    IF lv_no < 3 OR lines( it_new ) < 3.
      RETURN.                     " nothing to reorder in a one-liner
    ENDIF.

    DATA(lt_keys)  = param_keys( it_src = it_old ).
    DATA(lt_nkeys) = param_keys( it_src = it_new ).

    " New-side parameter order (compressed, without the unkeyed lines).
    DATA lt_order TYPE string_table.
    LOOP AT lt_nkeys INTO DATA(lv_nk).
      IF lv_nk IS NOT INITIAL.
        APPEND lv_nk TO lt_order.
      ENDIF.
    ENDLOOP.
    IF lines( lt_order ) < 2.
      RETURN.
    ENDIF.

    TYPES: BEGIN OF ty_sort,
             rank TYPE i,
             pos  TYPE i,
             line TYPE abaptxt255,
           END OF ty_sort.
    DATA lt_run     TYPE STANDARD TABLE OF ty_sort WITH DEFAULT KEY.
    DATA lv_changed TYPE abap_bool.
    DATA lv_i       TYPE i VALUE 1.

    WHILE lv_i <= lv_no.
      IF lt_keys[ lv_i ] IS INITIAL.
        lv_i = lv_i + 1.
        CONTINUE.
      ENDIF.

      " Maximal run of consecutive parameter lines = one parameter group.
      DATA(lv_end) = lv_i.
      WHILE lv_end < lv_no.
        IF lt_keys[ lv_end + 1 ] IS INITIAL.
          EXIT.
        ENDIF.
        lv_end = lv_end + 1.
      ENDWHILE.

      " A run reaching the last line carries the closing '.' — leave it alone.
      IF lv_end < lv_no.
        CLEAR lt_run.
        DATA(lv_p) = lv_i.
        WHILE lv_p <= lv_end.
          DATA(lv_rank) = 999999 + lv_p.   " unknown parameter → keep at the end
          LOOP AT lt_order INTO DATA(lv_ok).
            IF lv_ok = lt_keys[ lv_p ].
              lv_rank = sy-tabix.
              EXIT.
            ENDIF.
          ENDLOOP.
          APPEND VALUE ty_sort( rank = lv_rank
                                pos  = lv_p
                                line = it_old[ lv_p ] ) TO lt_run.
          lv_p = lv_p + 1.
        ENDWHILE.
        SORT lt_run BY rank ASCENDING pos ASCENDING.
        lv_p = lv_i.
        LOOP AT lt_run INTO DATA(ls_run).
          IF ls_run-pos <> lv_p.
            lv_changed = abap_true.
          ENDIF.
          result[ lv_p ] = ls_run-line.
          lv_p = lv_p + 1.
        ENDLOOP.
      ENDIF.

      lv_i = lv_end + 1.
    ENDWHILE.

    IF lv_changed = abap_false.
      result = it_old.
    ENDIF.
  ENDMETHOD.


  METHOD parse_blocks.
    DATA lv_start   TYPE i VALUE 0.
    DATA lv_blank   TYPE i VALUE 0.
    DATA lv_stmt    TYPE string.
    DATA lv_unkeyed TYPE i VALUE 0.
    DATA lv_blanks  TYPE i VALUE 0.
    DATA lv_comments TYPE i VALUE 0.
    DATA lv_cmt      TYPE string.
    DATA lv_ckey     TYPE string.

    LOOP AT it_src INTO DATA(ls_line).
      DATA(lv_idx) = sy-tabix.

      " A run of empty lines between two declarations is a block of its own.
      " Attaching it to the following declaration would make that declaration
      " compare unequal as soon as SAP regenerates the section with the blank
      " somewhere else — the very noise this class exists to remove. Blank runs
      " get their own key namespace so they only ever pair with each other.
      " condense( ) must not stand directly in front of IS INITIAL — a built-in
      " function is not a valid operand there ("Unexpected operator IS").
      DATA(lv_raw) = condense( CONV string( ls_line ) ).
      IF lv_start = 0 AND lv_raw IS INITIAL.
        IF lv_blank = 0.
          lv_blank = lv_idx.
        ENDIF.
        CONTINUE.
      ENDIF.
      IF lv_blank > 0.
        lv_blanks = lv_blanks + 1.
        APPEND VALUE ty_block( key  = |B:{ lv_blanks }|
                               from = lv_blank
                               to   = lv_idx - 1 ) TO result.
        lv_blank = 0.
      ENDIF.

      IF lv_start = 0.
        lv_start = lv_idx.
      ENDIF.

      DATA lv_code TYPE string.
      DATA lv_ends TYPE abap_bool.
      split_code( EXPORTING iv_line = CONV string( ls_line )
                  IMPORTING ev_code = lv_code
                            ev_ends = lv_ends ).
      DATA(lv_code_c) = condense( lv_code ).
      IF lv_code_c IS INITIAL.
        IF iv_text_keys = abap_true AND lv_stmt IS INITIAL.
          lv_cmt = lv_cmt && ` ` && condense( CONV string( ls_line ) ).
        ENDIF.
        CONTINUE.                 " comment line — belongs to the next statement
      ENDIF.

      " Generated body: a comment run standing in front of a statement becomes
      " a block of its own. The generator banner carries the generation
      " timestamp, so gluing it to the first DATA statement would make that
      " declaration compare unequal on every regeneration.
      IF iv_text_keys = abap_true AND lv_stmt IS INITIAL AND lv_start < lv_idx.
        lv_comments = lv_comments + 1.
        IF lv_comments = 1.
          " The first comment run is the generator banner: its timestamp differs
          " in every version, so it is matched positionally and its change is
          " reported once, instead of showing up as an unpaired delete+insert.
          lv_ckey = |C:1|.
        ELSE.
          " All other comment runs are the '*--- EntitySet - <name> ---*'
          " separators, shuffled together with the blocks they announce — key
          " them by text so they pair wherever they moved.
          lv_ckey = |C:{ to_upper( condense( lv_cmt ) ) }|.
        ENDIF.
        APPEND VALUE ty_block( key  = lv_ckey
                               from = lv_start
                               to   = lv_idx - 1 ) TO result.
        lv_start = lv_idx.
      ENDIF.
      CLEAR lv_cmt.

      lv_stmt = lv_stmt && ` ` && lv_code.
      IF lv_ends = abap_false.
        CONTINUE.                 " statement continues on the next line
      ENDIF.

      DATA(lv_key) = decl_key( iv_stmt = lv_stmt ).
      IF lv_key IS INITIAL.
        IF iv_text_keys = abap_true.
          " Generated body: an ordinary statement is keyed by its own text, so
          " an unchanged statement pairs with its twin wherever the generator
          " moved it. Identical repeated statements are consumed in source
          " order by PAIR_DECLARATIONS, which keeps the multiset balanced.
          lv_key = |S:{ to_upper( condense( lv_stmt ) ) }|.
        ELSE.
          " Section headers and anything unrecognized are matched positionally
          " (n-th unkeyed block of the old side ↔ n-th of the new side), so
          " 'private section.' never shows up as a change.
          lv_unkeyed = lv_unkeyed + 1.
          lv_key     = |U:{ lv_unkeyed }|.
        ENDIF.
      ENDIF.
      APPEND VALUE ty_block( key = lv_key from = lv_start to = lv_idx ) TO result.
      CLEAR: lv_start, lv_stmt.
    ENDLOOP.

    " Tail: a trailing blank run and an unterminated statement are mutually
    " exclusive (a blank run only accumulates while no block is open), but both
    " must be flushed so the blocks keep tiling the source without gaps.
    IF lv_blank > 0.
      lv_blanks = lv_blanks + 1.
      APPEND VALUE ty_block( key  = |B:{ lv_blanks }|
                             from = lv_blank
                             to   = lines( it_src ) ) TO result.
    ENDIF.
    IF lv_start > 0.
      " Trailing comments / unterminated statement.
      lv_unkeyed = lv_unkeyed + 1.
      APPEND VALUE ty_block( key  = |U:{ lv_unkeyed }|
                             from = lv_start
                             to   = lines( it_src ) ) TO result.
    ENDIF.
  ENDMETHOD.


  METHOD split_code.
    CLEAR: ev_code, ev_ends.
    DATA(lv_len) = strlen( iv_line ).
    IF lv_len = 0.
      RETURN.
    ENDIF.
    IF iv_line(1) = '*'.
      RETURN.                     " full-line comment
    ENDIF.

    DATA lv_quote TYPE c LENGTH 1.
    DATA lv_i     TYPE i VALUE 0.
    WHILE lv_i < lv_len.
      DATA(lv_c) = iv_line+lv_i(1).
      IF lv_quote IS NOT INITIAL.
        IF lv_c = lv_quote.
          CLEAR lv_quote.
        ENDIF.
      ELSEIF lv_c = '"'.
        RETURN.                   " trailing comment starts here
      ELSEIF lv_c = '''' OR lv_c = '`'.
        lv_quote = lv_c.
      ELSEIF lv_c = '.'.
        ev_ends = abap_true.
      ENDIF.
      ev_code = ev_code && lv_c.
      lv_i = lv_i + 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD decl_key.
    DATA(lv) = to_upper( iv_stmt ).
    " ':' only ever marks a chain, ',' and '.' only ever terminate an element —
    " turning them into separators makes the first tokens directly usable.
    REPLACE ALL OCCURRENCES OF ':' IN lv WITH ` `.
    REPLACE ALL OCCURRENCES OF ',' IN lv WITH ` `.
    REPLACE ALL OCCURRENCES OF '.' IN lv WITH ` `.
    CONDENSE lv.
    IF lv IS INITIAL.
      RETURN.
    ENDIF.

    SPLIT lv AT ` ` INTO TABLE DATA(lt_tok).
    IF lines( lt_tok ) < 2.
      RETURN.
    ENDIF.

    DATA lv_kind TYPE string.
    DATA(lv_kw) = lt_tok[ 1 ].
    CASE lv_kw.
      WHEN 'METHODS' OR 'CLASS-METHODS'.
        lv_kind = 'M'.            " same kind on purpose: instance ↔ static
      WHEN 'DATA' OR 'CLASS-DATA'.
        lv_kind = 'D'.            " stays paired when a field turns static
      WHEN 'CONSTANTS'.
        lv_kind = 'C'.
      WHEN 'TYPES'.
        lv_kind = 'T'.
      WHEN 'EVENTS' OR 'CLASS-EVENTS'.
        lv_kind = 'E'.
      WHEN 'ALIASES'.
        lv_kind = 'A'.
      WHEN 'INTERFACES'.
        lv_kind = 'I'.
      WHEN OTHERS.
        RETURN.                   " not a declaration → matched positionally
    ENDCASE.

    DATA(lv_name) = lt_tok[ 2 ].
    " Nested on purpose: a table expression inside a logical expression is
    " evaluated even when an earlier operand already decided the result.
    IF lv_name = 'BEGIN' AND lines( lt_tok ) >= 4.
      IF lt_tok[ 3 ] = 'OF'.
        lv_name = lt_tok[ 4 ].    " TYPES BEGIN OF <name> … END OF <name>
      ENDIF.
    ENDIF.
    IF strlen( lv_name ) > 1 AND lv_name(1) = '!'.
      lv_name = lv_name+1.
    ENDIF.
    IF lv_name IS INITIAL.
      RETURN.
    ENDIF.

    result = |{ lv_kind }:{ lv_name }|.
  ENDMETHOD.


  METHOD param_keys.
    DATA lv_group TYPE string.

    LOOP AT it_src INTO DATA(ls_line).
      DATA(lv_txt) = to_upper( condense( CONV string( ls_line ) ) ).
      APPEND `` TO result.
      DATA(lv_idx) = lines( result ).
      IF lv_txt IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_txt(1) = '*' OR lv_txt(1) = '"'.
        CONTINUE.
      ENDIF.

      " Parameter group keyword on its own line — generated signatures always
      " look like that. If it shares the line with a parameter the line simply
      " stays unkeyed and anchors the surrounding runs, which is still correct.
      CASE lv_txt.
        WHEN 'IMPORTING' OR 'EXPORTING' OR 'CHANGING'
          OR 'RETURNING' OR 'RAISING'   OR 'EXCEPTIONS'.
          lv_group = lv_txt.
          CONTINUE.
      ENDCASE.

      DATA lv_name TYPE string.
      CLEAR lv_name.
      IF lv_txt(1) = '!' AND strlen( lv_txt ) > 1.
        lv_name = lv_txt+1.
      ELSEIF lv_txt CP 'VALUE(*' AND strlen( lv_txt ) > 6.
        lv_name = lv_txt+6.
      ELSE.
        CONTINUE.                 " head line, RAISING class list, …
      ENDIF.

      " Cut the name at the first delimiter. Done with SPLIT rather than a
      " character scan on purpose: comparing a one-character substring of a
      " STRING against a blank literal depends on padding rules we do not want
      " to rely on here.
      REPLACE ALL OCCURRENCES OF '(' IN lv_name WITH ` `.
      REPLACE ALL OCCURRENCES OF ')' IN lv_name WITH ` `.
      CONDENSE lv_name.
      SPLIT lv_name AT ` ` INTO TABLE DATA(lt_parts).
      IF lt_parts IS INITIAL.
        CONTINUE.
      ENDIF.
      DATA(lv_pname) = lt_parts[ 1 ].
      IF lv_pname IS INITIAL.
        CONTINUE.
      ENDIF.
      result[ lv_idx ] = |{ lv_group }:{ lv_pname }|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
