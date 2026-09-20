CLASS zcl_vx_adt_res_class DEFINITION
  PUBLIC INHERITING FROM cl_adt_rest_resource FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get REDEFINITION.
ENDCLASS.
CLASS zcl_vx_adt_res_class IMPLEMENTATION.
  METHOD get.
    DATA lv_name TYPE string.
    request->get_uri_attribute( EXPORTING name = 'name' mandatory = abap_true IMPORTING value = lv_name ).
    DATA(ls_graph) = VALUE zcl_vx_ace_uml=>ty_graph( object = to_upper( lv_name ) ).
    zcl_vx_ace_uml=>collect( EXPORTING i_name = lv_name CHANGING cs_graph = ls_graph ).
    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data = /ui2/cl_json=>serialize( data = ls_graph pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
  ENDMETHOD.
ENDCLASS.
