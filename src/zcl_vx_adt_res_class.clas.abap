CLASS zcl_vx_adt_res_class DEFINITION
  PUBLIC INHERITING FROM cl_adt_rest_resource FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get REDEFINITION.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_method,
             name       TYPE string,
             visibility TYPE string,
             parameters TYPE zif_vx_ace_parse_data=>tt_params,
           END OF ty_method,
           tt_method TYPE STANDARD TABLE OF ty_method WITH EMPTY KEY,
           BEGIN OF ty_result,
             class   TYPE string,
             methods TYPE tt_method,
           END OF ty_result.
ENDCLASS.

CLASS zcl_vx_adt_res_class IMPLEMENTATION.
  METHOD get.
    DATA lv_name TYPE string.
    request->get_uri_attribute( EXPORTING name = 'name' mandatory = abap_true
                                IMPORTING value = lv_name ).

    DATA lv_type TYPE string.
    DATA lv_program TYPE program.
    zcl_vx_ace_source=>resolve( EXPORTING i_name = lv_name i_type = 'CLAS'
                                 IMPORTING ev_type = lv_type ev_program = lv_program ).
    DATA(ls_source) = zcl_vx_ace_source=>parse( lv_program ).

    DATA lt_method TYPE tt_method.
    LOOP AT ls_source-t_params INTO DATA(ls_param).
      READ TABLE lt_method ASSIGNING FIELD-SYMBOL(<method>)
        WITH KEY name = to_lower( ls_param-name ).
      IF sy-subrc <> 0.
        APPEND VALUE #( name = to_lower( ls_param-name )
                        visibility = 'public' ) TO lt_method.
        READ TABLE lt_method ASSIGNING <method> INDEX lines( lt_method ).
      ENDIF.
      APPEND ls_param TO <method>-parameters.
    ENDLOOP.

    DATA(ls_result) = VALUE ty_result( class = to_lower( lv_name ) methods = lt_method ).
    DATA(lv_body) = /ui2/cl_json=>serialize(
      data = ls_result
      pretty_name = /ui2/cl_json=>pretty_mode-low_case ).
    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data = lv_body ).
  ENDMETHOD.
ENDCLASS.
