REPORT z_vx_ace_scheme_test.

" Backend probe for the Logic diagram. It deliberately uses the same ACE
" source, unit boundary and scanner data as the ADT Flow resource.
PARAMETERS p_class TYPE seoclsname OBLIGATORY DEFAULT 'ZCL_CALC_LOG'.
PARAMETERS p_method TYPE seocpdname OBLIGATORY DEFAULT 'ADD'.

START-OF-SELECTION.
  DATA(lv_class) = to_upper( CONV string( p_class ) ).
  DATA(lv_method) = to_upper( CONV string( p_method ) ).
  DATA(ls_source) = zcl_vx_ace_source=>parse( CONV program( lv_class ) ).

  READ TABLE ls_source-tt_calls_line INTO DATA(ls_unit)
    WITH KEY class = lv_class eventtype = 'METHOD' eventname = lv_method.
  IF sy-subrc <> 0.
    WRITE: / |Method { lv_class }=>{ lv_method } was not found by ACE.|.
    RETURN.
  ENDIF.

  READ TABLE ls_source-tt_progs INTO DATA(ls_prog) WITH KEY include = ls_unit-include.
  IF sy-subrc <> 0 OR ls_prog-scan IS NOT BOUND.
    WRITE: / |ACE scan for include { ls_unit-include } is unavailable.|.
    RETURN.
  ENDIF.

  WRITE: / |ACE statements: { lv_class }=>{ lv_method } (include { ls_unit-include })|.
  ULINE.
  WRITE: / 'Index', 8 'Line', 16 'Keyword', 34 'Tokens'.
  ULINE.

  LOOP AT ls_prog-t_keywords INTO DATA(ls_kw)
      WHERE index >= ls_unit-index AND index <= ls_unit-end_idx.
    READ TABLE ls_prog-scan->statements INDEX ls_kw-index INTO DATA(ls_stmt).
    CHECK sy-subrc = 0.
    READ TABLE ls_prog-scan->tokens INDEX ls_stmt-from INTO DATA(ls_first_token).
    CHECK sy-subrc = 0.

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
