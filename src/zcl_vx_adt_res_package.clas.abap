CLASS zcl_vx_adt_res_package DEFINITION
  PUBLIC INHERITING FROM cl_adt_rest_resource FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get REDEFINITION.
ENDCLASS.
CLASS zcl_vx_adt_res_package IMPLEMENTATION.
  METHOD get.
    DATA lv_name TYPE string.
    request->get_uri_attribute( EXPORTING name = 'name' mandatory = abap_true IMPORTING value = lv_name ).
    lv_name = to_upper( lv_name ).
    SELECT SINGLE devclass FROM tdevc WHERE devclass = @lv_name INTO @DATA(lv_package).
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE cx_adt_res_not_found EXPORTING resource_type = 'package' resource_id = lv_name.
    ENDIF.
    " Exact package: no implicit recursion or silently truncated diagrams.
    SELECT object, obj_name FROM tadir
      WHERE pgmid = 'R3TR' AND devclass = @lv_package
        AND ( object = 'CLAS' OR object = 'INTF' ) AND delflag = @space
      ORDER BY object, obj_name INTO TABLE @DATA(lt_objects) UP TO 101 ROWS.
    IF lines( lt_objects ) > 100.
      RAISE EXCEPTION TYPE cx_adt_res_bad_request
        EXPORTING explanation = 'This package contains more than 100 classes/interfaces. Select a smaller package.'.
    ENDIF.
    DATA(ls_graph) = VALUE zcl_vx_ace_uml=>ty_graph( object = lv_name ).
    LOOP AT lt_objects INTO DATA(ls_object).
      zcl_vx_ace_uml=>collect( EXPORTING i_name = CONV #( ls_object-obj_name ) CHANGING cs_graph = ls_graph ).
    ENDLOOP.
    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data = /ui2/cl_json=>serialize( data = ls_graph pretty_name = /ui2/cl_json=>pretty_mode-low_case ) ).
  ENDMETHOD.
ENDCLASS.
