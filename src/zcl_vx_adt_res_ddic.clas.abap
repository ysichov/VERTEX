"! The text of a dictionary object's version, for the front ends' line diff,
"! where ADT keeps no version history of data elements, domains and tables.
"!
"! GET /sap/bc/adt/vertex/ddic/{type}?name=NAME&versno=NNNNN
"!   type:   DTED, DOMD or TABD (VRSD's part types)
"!   versno: a VRSD version number; 00000, 99998 or none for the active state
"! Answers {"lines":["...", ...]}.
CLASS zcl_vx_adt_res_ddic DEFINITION
  PUBLIC
  INHERITING FROM cl_adt_rest_resource
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS get REDEFINITION.

  PROTECTED SECTION.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_answer,
             lines TYPE string_table,
           END OF ty_answer.
ENDCLASS.



CLASS zcl_vx_adt_res_ddic IMPLEMENTATION.


  METHOD get.
    DATA lv_type   TYPE versobjtyp.
    DATA lv_name   TYPE versobjnam.
    DATA lv_versno TYPE versno.

    request->get_uri_attribute( EXPORTING name      = 'type'
                                          mandatory = abap_true
                                IMPORTING value     = lv_type ).
    TRANSLATE lv_type TO UPPER CASE.
    " The name is a query parameter: a namespaced name carries slashes a path segment cannot.
    request->get_uri_query_parameter( EXPORTING name      = 'name'
                                                mandatory = abap_true
                                      IMPORTING value     = lv_name ).
    TRANSLATE lv_name TO UPPER CASE.
    request->get_uri_query_parameter( EXPORTING name      = 'versno'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_versno ).

    DATA(ls_answer) = VALUE ty_answer( lines = zcl_vx_ddic_version=>lines( iv_type   = lv_type
                                                                           iv_name   = lv_name
                                                                           iv_versno = lv_versno ) ).
    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = /ui2/cl_json=>serialize( data        = ls_answer
                                                 pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
  ENDMETHOD.
ENDCLASS.
