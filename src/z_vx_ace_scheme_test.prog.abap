REPORT z_vx_ace_scheme_test.

" Backend probe for the Logic diagram. It deliberately uses the same ACE
" source, unit boundary and scanner data as the ADT Flow resource.
PARAMETERS p_class TYPE seoclsname OBLIGATORY DEFAULT 'ZCL_CALC_LOG'.
PARAMETERS p_method TYPE seocpdname OBLIGATORY DEFAULT 'ADD'.

START-OF-SELECTION.
  DATA(lv_class) = to_upper( CONV string( p_class ) ).
  DATA(lv_method) = to_upper( CONV string( p_method ) ).
  DATA lv_head TYPE string.
  DATA lv_program TYPE program.
  zcl_vx_ace_source=>resolve( EXPORTING i_name     = lv_class
                                         i_type     = 'CLAS'
                               IMPORTING ev_type    = lv_head
                                         ev_program = lv_program ).
  DATA(ls_source) = zcl_vx_ace_source=>parse( lv_program ).

  DATA lv_include TYPE program.
  DATA lv_from TYPE i.
  DATA lv_to TYPE i.
  LOOP AT ls_source-tt_progs INTO DATA(ls_candidate).
    DATA(lt_units) = zcl_vx_ace_metrics=>unit_boundaries(
      is_parse_data = ls_source is_prog = ls_candidate ).
    LOOP AT lt_units INTO DATA(ls_candidate_unit).
      IF to_upper( ls_candidate_unit-qname ) = |{ lv_class }=>{ lv_method }|.
        lv_include = ls_candidate-include.
        lv_from = ls_candidate_unit-line_from.
        lv_to = ls_candidate_unit-line_to.
        EXIT.
      ENDIF.
    ENDLOOP.
    IF lv_include IS NOT INITIAL.
      EXIT.
    ENDIF.
  ENDLOOP.
  IF lv_include IS INITIAL.
    WRITE: / |Method { lv_class }=>{ lv_method } was not found by ACE.|.
    RETURN.
  ENDIF.

  zcl_vx_ace_parser=>parse_calls( EXPORTING i_program = lv_program i_include = lv_include
                                  CHANGING  cs_source = ls_source ).
  READ TABLE ls_source-tt_progs INTO DATA(ls_prog) WITH KEY include = lv_include.
  IF sy-subrc <> 0 OR ls_prog-scan IS NOT BOUND.
    WRITE: / |ACE scan for include { lv_include } is unavailable.|.
    RETURN.
  ENDIF.

  WRITE: / |ACE statements: { lv_class }=>{ lv_method } (include { lv_include })|.
  ULINE.
  WRITE: / 'Index', 8 'Line', 16 'Keyword', 34 'Tokens'.
  ULINE.

  LOOP AT ls_prog-t_keywords INTO DATA(ls_kw).
    READ TABLE ls_prog-scan->statements INDEX ls_kw-index INTO DATA(ls_stmt).
    CHECK sy-subrc = 0.
    READ TABLE ls_prog-scan->tokens INDEX ls_stmt-from INTO DATA(ls_first_token).
    CHECK sy-subrc = 0.
    CHECK ls_first_token-row >= lv_from AND ls_first_token-row <= lv_to.

    DATA(lv_text) = ``.
    LOOP AT ls_prog-scan->tokens INTO DATA(ls_token) FROM ls_stmt-from TO ls_stmt-to.
      CHECK ls_token-str IS NOT INITIAL.
      lv_text = COND string( WHEN lv_text IS INITIAL THEN ls_token-str
                             ELSE |{ lv_text } { ls_token-str }| ).
    ENDLOOP.
    CONDENSE lv_text.
    WRITE: / ls_kw-index UNDER 'Index', ls_first_token-row UNDER 'Line',
             ls_kw-name UNDER 'Keyword', lv_text UNDER 'Tokens'.
  ENDLOOP.
