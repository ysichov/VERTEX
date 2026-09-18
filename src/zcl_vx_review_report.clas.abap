CLASS zcl_vx_review_report DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    "! The objects the review lists, in the order it lists them: the parts of a
    "! class under their class, everything else in sections by kind. Fills in the
    "! class name where the statistics carry none, and leaves out an object with
    "! no changed line, which there is nothing to say about.
    "! Public because a second front end has to show the same objects in the same
    "! grouping - reading this rather than restating it is what keeps the two
    "! from drifting into two opinions about where a method belongs.
    CLASS-METHODS report_objects
      IMPORTING it_obj_stats  TYPE zif_vx_review_types=>ty_t_obj_stats
      RETURNING VALUE(result) TYPE zif_vx_review_types=>ty_t_obj_stats.

    "! Section ordering for non-class objects (lower = earlier).
    CLASS-METHODS cat_order
      IMPORTING iv_objtype    TYPE versobjtyp
      RETURNING VALUE(result) TYPE i.

    "! Section heading for non-class objects, grouped by object kind.
    CLASS-METHODS cat_label
      IMPORTING iv_objtype    TYPE versobjtyp
      RETURNING VALUE(result) TYPE string.

ENDCLASS.



CLASS ZCL_VX_REVIEW_REPORT IMPLEMENTATION.






  METHOD report_objects.
    TYPES: BEGIN OF ty_sort,
             class_name TYPE seoclsname,
             cat_order  TYPE i,
             type_order TYPE i,
             obj_name   TYPE versobjnam,
             idx        TYPE i,
           END OF ty_sort.
    DATA lt_sort TYPE STANDARD TABLE OF ty_sort WITH DEFAULT KEY.
    DATA lt_sorted TYPE zif_vx_review_types=>ty_t_obj_stats.
    lt_sorted = it_obj_stats.

    LOOP AT lt_sorted INTO DATA(ls_s2).
      DATA(lv_ord) = SWITCH i( ls_s2-objtype
        WHEN 'CLSD' THEN 1 WHEN 'CPUB' THEN 2 WHEN 'CPRO' THEN 3
        WHEN 'CPRI' THEN 4 WHEN 'CINC' THEN 5 WHEN 'CDEF' THEN 6
        WHEN 'METH' THEN 7 ELSE 0 ).
      DATA(lv_class_name) = ls_s2-class_name.
      IF lv_class_name IS INITIAL.
        CASE ls_s2-objtype.
          WHEN 'CLSD' OR 'CPUB' OR 'CPRO' OR 'CPRI' OR 'CINC' OR 'CDEF'.
            DATA(lv_obj_name) = CONV string( ls_s2-obj_name ).
            FIND FIRST OCCURRENCE OF '=' IN lv_obj_name MATCH OFFSET DATA(lv_eq_pos).
            IF sy-subrc = 0. lv_obj_name = lv_obj_name(lv_eq_pos). ENDIF.
            lv_class_name = CONV #( lv_obj_name ).
        ENDCASE.
      ENDIF.
      " Non-class objects are split into category sections (programs, tables/structures,
      " domains/data elements, CDS). Class objects keep cat_order 0 (grouped by class).
      DATA(lv_cat_order) = COND i(
        WHEN lv_class_name IS NOT INITIAL THEN 0
        ELSE cat_order( ls_s2-objtype ) ).
      APPEND VALUE #( class_name = lv_class_name cat_order = lv_cat_order
                      type_order = lv_ord
                      obj_name = ls_s2-obj_name idx = sy-tabix ) TO lt_sort.
    ENDLOOP.
    SORT lt_sort BY class_name cat_order type_order obj_name.

    LOOP AT lt_sort INTO DATA(ls_ord).
      READ TABLE lt_sorted INTO DATA(ls_tmp) INDEX ls_ord-idx.
      IF ls_tmp-class_name IS INITIAL. ls_tmp-class_name = ls_ord-class_name. ENDIF.
      APPEND ls_tmp TO result.
    ENDLOOP.
    DELETE result WHERE ins_count = 0 AND del_count = 0 AND mod_count = 0.
  ENDMETHOD.


  METHOD cat_order.
    result = SWITCH i( iv_objtype
      WHEN 'TABD' THEN 2
      WHEN 'DOMD' THEN 3
      WHEN 'DTED' THEN 3
      WHEN 'DDLS' THEN 4
      ELSE             1 ).   " programs and everything else
  ENDMETHOD.


  METHOD cat_label.
    result = SWITCH string( iv_objtype
      WHEN 'TABD' THEN `Tables / Structures`
      WHEN 'DOMD' THEN `Domains / Data Elements`
      WHEN 'DTED' THEN `Domains / Data Elements`
      WHEN 'DDLS' THEN `CDS Views`
      ELSE             `Programs` ).
  ENDMETHOD.
ENDCLASS.
