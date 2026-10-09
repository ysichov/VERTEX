"! Writes a review into ZAVE_REVIEW, and nothing else. The review is built,
"! approved, declined and commented on in the front end - VS Code or Eclipse -
"! in the payload AVE keeps there; this only stores the result, so that AVE and
"! every VERTEX window read the same review. A data preview can read the table
"! but not write it, which is the whole reason this class exists.
"!
"! POST /sap/bc/adt/vertex/store/{request}?remote=SID&expect=STAMP
"!   body: the payload as JSON, with its LAST_SAVED_AT already set
"! EXPECT is the LAST_SAVED_AT the writer read; empty when it read no review.
"! A row whose stamp is not that one was saved by somebody else in between,
"! and the write is refused - there is no merge here, and pretending there is
"! would be how a review quietly loses work.
CLASS zcl_vx_adt_res_store DEFINITION
  PUBLIC
  INHERITING FROM cl_adt_rest_resource
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS post REDEFINITION.

  PROTECTED SECTION.
  PRIVATE SECTION.
    " Only the stamp is read out of a stored payload.
    TYPES: BEGIN OF ty_stamp,
             last_saved_at TYPE timestampl,
             last_saved_by TYPE syuname,
           END OF ty_stamp.

    METHODS bad_request
      IMPORTING i_text TYPE string
      RAISING   cx_adt_res_bad_request.
ENDCLASS.



CLASS zcl_vx_adt_res_store IMPLEMENTATION.


  METHOD post.
    DATA lv_trkorr TYPE trkorr.
    DATA lv_remote TYPE verssysnam.
    DATA lv_expect TYPE string.
    DATA lv_body   TYPE string.

    request->get_uri_attribute( EXPORTING name      = 'name'
                                          mandatory = abap_true
                                IMPORTING value     = lv_trkorr ).
    TRANSLATE lv_trkorr TO UPPER CASE.
    request->get_uri_query_parameter( EXPORTING name      = 'remote'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_remote ).
    TRANSLATE lv_remote TO UPPER CASE.
    request->get_uri_query_parameter( EXPORTING name      = 'expect'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_expect ).
    request->get_body_data(
      EXPORTING content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      IMPORTING data            = lv_body ).

    IF lv_body IS INITIAL.
      bad_request( |A review to store is sent as its payload; the body was empty.| ).
    ENDIF.

    " The key is (TRKORR, REMOTE). A table without REMOTE is one AVE created
    " before the field existed, and writing by TRKORR alone would overwrite the
    " review of every remote system for that request.
    SELECT SINGLE fieldname FROM dd03l
      WHERE tabname   = 'ZAVE_REVIEW'
        AND fieldname = 'REMOTE'
        AND as4local  = 'A'
      INTO @DATA(lv_field).
    IF sy-subrc <> 0.
      bad_request( |ZAVE_REVIEW on this system has no REMOTE key field, or does not exist.|
                && | It ships in VERTEX's src/; pull it with abapGit.| ).
    ENDIF.

    DATA lv_tabname TYPE tabname VALUE 'ZAVE_REVIEW'.
    DATA lv_stored  TYPE string.
    SELECT SINGLE payload FROM (lv_tabname)
      WHERE trkorr = @lv_trkorr
        AND remote = @lv_remote
      INTO @lv_stored.
    DATA(lv_exists) = xsdbool( sy-subrc = 0 ).

    " The stamp the writer read must still be the stamp stored.
    DATA ls_stored TYPE ty_stamp.
    IF lv_exists = abap_true AND lv_stored IS NOT INITIAL.
      /ui2/cl_json=>deserialize( EXPORTING json = lv_stored
                                 CHANGING  data = ls_stored ).
    ENDIF.
    DATA lv_expected TYPE timestampl.
    IF lv_expect IS NOT INITIAL.
      TRY.
          lv_expected = lv_expect.
        CATCH cx_sy_conversion_error.
          bad_request( |EXPECT "{ lv_expect }" is not a stamp.| ).
      ENDTRY.
    ENDIF.
    IF ( lv_expect IS INITIAL AND lv_exists = abap_true )
       OR ( lv_expect IS NOT INITIAL AND lv_expected <> ls_stored-last_saved_at ).
      bad_request( COND #( WHEN lv_exists = abap_false
                           THEN |The review of { lv_trkorr } was deleted while the page was open. Read it again, then write.|
                           ELSE |{ ls_stored-last_saved_by } saved the review of { lv_trkorr } while the page|
                             && | was open. Read it again, then write.| ) ).
    ENDIF.

    IF lv_exists = abap_true.
      UPDATE (lv_tabname)
        SET payload = @lv_body
        WHERE trkorr = @lv_trkorr
          AND remote = @lv_remote.
    ELSE.
      DATA lr_row TYPE REF TO data.
      CREATE DATA lr_row TYPE (lv_tabname).
      ASSIGN lr_row->* TO FIELD-SYMBOL(<ls_row>).
      ASSIGN COMPONENT 'TRKORR'  OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_trkorr>).
      ASSIGN COMPONENT 'REMOTE'  OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_remote>).
      ASSIGN COMPONENT 'PAYLOAD' OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_payload>).
      <lv_trkorr>  = lv_trkorr.
      <lv_remote>  = lv_remote.
      <lv_payload> = lv_body.
      INSERT (lv_tabname) FROM @<ls_row>.
    ENDIF.
    IF sy-subrc <> 0.
      bad_request( |The review of { lv_trkorr } could not be written to ZAVE_REVIEW.| ).
    ENDIF.

    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = |\{"stored":true\}| ).
  ENDMETHOD.


  METHOD bad_request.
    RAISE EXCEPTION TYPE cx_adt_res_bad_request
      EXPORTING explanation = i_text.
  ENDMETHOD.
ENDCLASS.
