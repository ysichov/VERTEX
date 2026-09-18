"! Object handler for an ABAP class.
"! Returns class sections (pool, pub/pro/pri, local types/impl) plus all methods.
CLASS zcl_vx_object_clas DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    INTERFACES zif_vx_object.

    METHODS constructor
      IMPORTING
        !name TYPE seoclsname
      RAISING
        zcx_vx.

protected section.
  PRIVATE SECTION.
    DATA name TYPE seoclsname.

ENDCLASS.



CLASS ZCL_VX_OBJECT_CLAS IMPLEMENTATION.


  METHOD constructor.
    me->name = name.
  ENDMETHOD.


  METHOD zif_vx_object~check_exists.
    TRY.
        cl_abap_classdescr=>describe_by_name(
          EXPORTING
            p_name         = name
          EXCEPTIONS
            type_not_found = 1
            OTHERS         = 2 ).
        result = boolc( sy-subrc = 0 ).
      CATCH cx_root.
        result = abap_false.
    ENDTRY.
  ENDMETHOD.


  METHOD zif_vx_object~get_name.
    result = name.
  ENDMETHOD.


  METHOD zif_vx_object~get_parts.
    TRY.
    " Fixed sections of the class
    result = VALUE #(
      ( class = name unit = 'Class pool'                 object_name = CONV #( name )                                  type = 'CLSD' )
      ( class = name unit = 'Public section'             object_name = CONV #( name )                                  type = 'CPUB' )
      ( class = name unit = 'Protected section'          object_name = CONV #( name )                                  type = 'CPRO' )
      ( class = name unit = 'Private section'            object_name = CONV #( name )                                  type = 'CPRI' )
      ( class = name unit = 'Local class definition'     object_name = CONV #( cl_oo_classname_service=>get_ccdef_name( name ) ) type = 'CDEF' )
      ( class = name unit = 'Local class implementation' object_name = CONV #( cl_oo_classname_service=>get_ccimp_name( name ) ) type = 'CINC' )
      ( class = name unit = 'Local macros'               object_name = CONV #( cl_oo_classname_service=>get_ccmac_name( name ) ) type = 'CINC' )
      ( class = name unit = 'Local types'                object_name = CONV #( cl_oo_classname_service=>get_cl_name( name ) )    type = 'REPS' )
      ( class = name unit = 'Test classes'               object_name = CONV #( cl_oo_classname_service=>get_ccau_name( name ) )  type = 'CINC' ) ).

    " One entry per method
    CALL METHOD cl_oo_classname_service=>get_all_method_includes
      EXPORTING
        clsname            = name
      RECEIVING
        result             = DATA(lt_meth)
      EXCEPTIONS
        class_not_existing = 1.

    CHECK sy-subrc = 0.

    " Загружаем все VRSD-записи для методов этого класса одним запросом
    DATA lv_like TYPE versobjnam.
    lv_like = name.
    lv_like+30 = '%'.
    DATA lt_vrsd_meth TYPE STANDARD TABLE OF vrsd WITH EMPTY KEY.
    SELECT objname FROM vrsd
      WHERE objtype = 'METH'
        AND objname LIKE @lv_like
      INTO TABLE @lt_vrsd_meth.

    LOOP AT lt_meth INTO DATA(method_include).
      DATA lv_objname TYPE versobjnam.
      " Ищем точное имя из VRSD — SAP сам формирует ключ с правильным паддингом
      LOOP AT lt_vrsd_meth INTO DATA(ls_vrsd)
        WHERE objname+30 = method_include-cpdkey-cpdname.
        lv_objname = ls_vrsd-objname.
        EXIT.
      ENDLOOP.
      IF lv_objname IS INITIAL.
        " Fallback: паддинг вручную через CHAR-присваивание
        lv_objname = name.
        lv_objname+30 = method_include-cpdkey-cpdname.
      ENDIF.
      APPEND VALUE #(
        class       = name
        unit        = |{ method_include-cpdkey-cpdname }|
        object_name = lv_objname
        type        = 'METH'
      ) TO result.
      CLEAR lv_objname.
    ENDLOOP.
    CATCH cx_root INTO DATA(lx).
      RAISE EXCEPTION TYPE zcx_vx EXPORTING previous = lx.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
