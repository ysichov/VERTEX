CLASS zcl_vx_adt_res_prepare DEFINITION
  PUBLIC
  INHERITING FROM cl_adt_rest_resource
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    "! Building a review, one object at a time.
    "!
    "! AVE prepares a whole request in one go, inside a SAP GUI dialog, and had
    "! to carry an interrupter and a cost estimate to survive it: a dialog work
    "! process is killed at RDISP/MAX_WPRUN_TIME, so it mattered a great deal
    "! whether a request would take two seconds or three hours. Neither is
    "! carried here. The walk belongs to whoever is driving - GET says what the
    "! objects are, POST does one of them - so every call is one object long,
    "! nothing to time out, and stopping is a matter of not asking again.
    "!
    "! What one POST leaves behind is written to ZAVE_REVIEW before it answers.
    "! A closed window therefore loses the object it was on and nothing before
    "! it, and asking GET again says what is already there.
    METHODS get REDEFINITION.
    METHODS post REDEFINITION.

  PRIVATE SECTION.
    "! One object of the request. HUNKS is what the stored review already holds
    "! for it - zero means either that it has not been walked yet or that it
    "! carries no changed line, which are not the same thing and are not worth
    "! guessing between: walking an object twice costs a second, and skipping
    "! one that was never walked loses it from the review.
    TYPES: BEGIN OF ty_object,
             objtype    TYPE string,
             obj_name   TYPE string,
             class_name TYPE string,
             unit       TYPE string,
             hunks      TYPE i,
           END OF ty_object,
           tt_object TYPE STANDARD TABLE OF ty_object WITH EMPTY KEY.

    "! The objects a request records, unexpanded: a class arrives as CLAS and is
    "! expanded into its sections and methods by the preparation itself, which is
    "! also what decides that they belong together. Expanding here would be a
    "! second opinion about it.
    METHODS objects_of
      IMPORTING i_trkorr       TYPE trkorr
      RETURNING VALUE(rt_part) TYPE zif_vx_object=>ty_t_part
      RAISING   zcx_vx cx_adt_res_bad_request.

    "! Which versions of an object count as this request's change.
    "!
    "! Objects are not recorded under the request itself but under its tasks, so
    "! the tasks are the numbers a version is matched against and the request is
    "! their parent. Getting this pair wrong does not fail: it pairs the new
    "! version against the wrong old one and the diff then reads as a change
    "! nobody made.
    METHODS options_for
      IMPORTING i_trkorr          TYPE trkorr
                i_remote          TYPE verssysnam
                io_request        TYPE REF TO if_adt_rest_request
      RETURNING VALUE(rs_options) TYPE zcl_vx_review_build=>ty_options
      RAISING   cx_adt_rest.

    "! One of the settings that used to be a checkbox on AVE's selection screen.
    "! Not passed means AVE's own default for it, which is not always "off" and
    "! is not this resource's to reinvent: a review prepared here and one
    "! prepared there have to be the same review.
    METHODS flag_param
      IMPORTING io_request    TYPE REF TO if_adt_rest_request
                i_name        TYPE string
                i_default     TYPE abap_bool
      RETURNING VALUE(rv_yes) TYPE abap_bool
      RAISING   cx_adt_rest.

    METHODS bad_request
      IMPORTING i_text TYPE string
      RAISING   cx_adt_res_bad_request.

    "! ZCX_VX carries no text of its own - its constructor only passes the
    "! exception it wrapped - so the sentence worth showing is down the chain.
    CLASS-METHODS reason
      IMPORTING ix_error       TYPE REF TO cx_root
      RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.


CLASS zcl_vx_adt_res_prepare IMPLEMENTATION.

  METHOD get.
    DATA lv_trkorr TYPE string.
    DATA lv_remote TYPE string.

    request->get_uri_attribute( EXPORTING name      = 'name'
                                          mandatory = abap_true
                                IMPORTING value     = lv_trkorr ).
    TRANSLATE lv_trkorr TO UPPER CASE.
    request->get_uri_query_parameter( EXPORTING name      = 'remote'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_remote ).
    TRANSLATE lv_remote TO UPPER CASE.

    DATA lt_part TYPE zif_vx_object=>ty_t_part.
    TRY.
        lt_part = objects_of( CONV #( lv_trkorr ) ).
      CATCH zcx_vx INTO DATA(lx_parts).
        bad_request( |{ lv_trkorr } could not be read: { reason( lx_parts ) }| ).
    ENDTRY.

    " What a previous run already wrote. A prepare that stopped halfway - a
    " closed window, a connection lost - left everything it finished in the
    " table, and this is how the next one sees it rather than starting over.
    DATA(lv_table) = zcl_vx_review_store=>has_review_table( ).
    DATA ls_payload TYPE zif_vx_review_types=>ty_saved_payload.
    DATA lv_saved TYPE abap_bool.
    IF lv_table = abap_true.
      lv_saved = zcl_vx_review_store=>load_review_payload(
                   EXPORTING iv_trkorr  = CONV #( lv_trkorr )
                             iv_remote  = CONV #( lv_remote )
                   CHANGING  cs_payload = ls_payload ).
    ENDIF.

    DATA lt_object TYPE tt_object.
    LOOP AT lt_part INTO DATA(ls_part).
      DATA lv_hunks TYPE i.
      CLEAR lv_hunks.
      LOOP AT ls_payload-hunks INTO DATA(ls_hunk).
        " A class is filed under its own name on every part of it; everything
        " else under its type and name. The same two shapes the preparation
        " deletes by, so that what is counted here and what a rerun replaces
        " are one set.
        IF ( ls_part-type = 'CLAS' AND ls_hunk-class_name = ls_part-object_name )
           OR ( ls_part-type <> 'CLAS' AND ls_hunk-objtype = ls_part-type
                                       AND ls_hunk-obj_name = ls_part-object_name ).
          lv_hunks = lv_hunks + 1.
        ENDIF.
      ENDLOOP.
      APPEND VALUE #( objtype    = ls_part-type
                      obj_name   = ls_part-object_name
                      class_name = ls_part-class
                      unit       = ls_part-unit
                      hunks      = lv_hunks ) TO lt_object.
    ENDLOOP.

    DATA(lv_body) =
      |\{"request":"{ to_lower( lv_trkorr ) }",| &&
      |"remote":"{ to_lower( lv_remote ) }",| &&
      |"table":{ COND string( WHEN lv_table = abap_true THEN `true` ELSE `false` ) },| &&
      |"saved":{ COND string( WHEN lv_saved = abap_true THEN `true` ELSE `false` ) },| &&
      |"objects":{ /ui2/cl_json=>serialize(
                     data        = lt_object
                     pretty_name = /ui2/cl_json=>pretty_mode-low_case ) }\}|.

    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = lv_body ).
  ENDMETHOD.


  METHOD post.
    DATA lv_trkorr TYPE string.
    DATA lv_remote TYPE string.
    DATA lv_object TYPE string.
    DATA lv_objtype TYPE string.

    request->get_uri_attribute( EXPORTING name      = 'name'
                                          mandatory = abap_true
                                IMPORTING value     = lv_trkorr ).
    request->get_uri_query_parameter( EXPORTING name      = 'object'
                                                mandatory = abap_true
                                      IMPORTING value     = lv_object ).
    request->get_uri_query_parameter( EXPORTING name      = 'objtype'
                                                mandatory = abap_true
                                      IMPORTING value     = lv_objtype ).
    request->get_uri_query_parameter( EXPORTING name      = 'remote'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_remote ).
    TRANSLATE lv_trkorr  TO UPPER CASE.
    TRANSLATE lv_object  TO UPPER CASE.
    TRANSLATE lv_objtype TO UPPER CASE.
    TRANSLATE lv_remote  TO UPPER CASE.

    IF zcl_vx_review_store=>has_review_table( ) = abap_false.
      bad_request( |This system has no ZAVE_REVIEW table, so a review has|
                && | nowhere to be written. It ships in this repository under src/.| ).
    ENDIF.

    " The object has to be one the request records. Preparing anything else
    " would file a block under a review it does not belong to, and the key it
    " is filed under says nothing about that.
    DATA lt_part TYPE zif_vx_object=>ty_t_part.
    TRY.
        lt_part = objects_of( CONV #( lv_trkorr ) ).
      CATCH zcx_vx INTO DATA(lx_parts).
        bad_request( |{ lv_trkorr } could not be read: { reason( lx_parts ) }| ).
    ENDTRY.
    READ TABLE lt_part INTO DATA(ls_part)
      WITH KEY type = lv_objtype object_name = lv_object.
    IF sy-subrc <> 0.
      bad_request( |{ lv_objtype } { lv_object } is not an object of { lv_trkorr }.| ).
    ENDIF.

    DATA ls_payload TYPE zif_vx_review_types=>ty_saved_payload.
    " A request with nothing saved yet is the normal first call, not an error:
    " the payload stays empty and this object is the first one in it.
    zcl_vx_review_store=>load_review_payload(
      EXPORTING iv_trkorr  = CONV #( lv_trkorr )
                iv_remote  = CONV #( lv_remote )
      CHANGING  cs_payload = ls_payload ).

    DATA lt_obj_stats  TYPE zif_vx_review_types=>ty_t_obj_stats.
    DATA lt_hunk_info  TYPE zif_vx_review_types=>ty_t_hunk_info.
    DATA lt_diff_cache TYPE zif_vx_review_types=>ty_t_diff_cache.
    DATA lt_diff_data  TYPE zif_vx_review_types=>ty_t_diff_data.
    DATA lt_approved   TYPE zif_vx_review_types=>ty_approved.
    DATA lt_declined   TYPE zif_vx_review_types=>ty_approved.
    DATA lt_notes      TYPE zif_vx_review_types=>ty_t_decline_notes.
    DATA lt_threads    TYPE zif_vx_review_types=>ty_t_hunk_threads.
    DATA lt_actions    TYPE zif_vx_review_types=>ty_t_hunk_actions.
    DATA lt_timings    TYPE zif_vx_review_types=>ty_t_part_timings.

    zcl_vx_review_state=>apply_saved_payload(
      EXPORTING
        is_payload          = ls_payload
        " AVE drops generated Gateway classes here when its own setting says
        " to. That setting is AVE's, and a prepare from here must add what it
        " walked and take nothing else away.
        iv_ignore_generated = abap_false
      CHANGING
        ct_obj_stats        = lt_obj_stats
        ct_hunk_info        = lt_hunk_info
        ct_diff_cache       = lt_diff_cache
        ct_diff_data        = lt_diff_data
        ct_approved         = lt_approved
        ct_declined         = lt_declined
        ct_decline_notes    = lt_notes
        ct_hunk_threads     = lt_threads
        ct_hunk_actions     = lt_actions
        ct_timings          = lt_timings ).

    " Every approval, decline, note and thread is keyed on the position of a
    " block inside its object, and recomputing an object renumbers them - two
    " blocks sharing one statement merging into one is enough. So the blocks
    " are photographed before and after and the state is carried across; the
    " sanitiser that runs afterwards then finds nothing left to drop. Without
    " this, preparing an object a second time throws away the review of it and
    " the save writes the loss out.
    DATA lt_before TYPE zif_vx_review_types=>ty_t_hunk_info.
    DATA lt_after  TYPE zif_vx_review_types=>ty_t_hunk_info.
    LOOP AT lt_hunk_info INTO DATA(ls_before).
      IF ( ls_part-type = 'CLAS' AND ls_before-class_name = ls_part-object_name )
         OR ( ls_part-type <> 'CLAS' AND ls_before-objtype = ls_part-type
                                     AND ls_before-obj_name = ls_part-object_name ).
        INSERT ls_before INTO TABLE lt_before.
      ENDIF.
    ENDLOOP.

    DATA(ls_row) = VALUE zcl_vx_review_build=>ty_part_row(
                     class       = ls_part-class
                     name        = ls_part-unit
                     object_name = ls_part-object_name
                     type        = ls_part-type ).
    DATA(ls_options) = options_for( i_trkorr   = CONV #( lv_trkorr )
                                    i_remote   = CONV #( lv_remote )
                                    io_request = request ).
    DATA lt_versions TYPE zcl_vx_review_build=>ty_t_version_row.
    DATA lt_diag     TYPE string_table.

    " What this object had is replaced, not added to: a rerun after the object
    " changed again must not leave the blocks of the previous run beside the
    " new ones.
    IF ls_part-type = 'CLAS'.
      DELETE lt_obj_stats WHERE class_name = ls_part-object_name.
      DELETE lt_hunk_info WHERE class_name = ls_part-object_name.
      DELETE lt_diff_data WHERE key-objname = ls_part-object_name.
      zcl_vx_review_build=>precompute_class_parts(
        EXPORTING iv_class_name = CONV #( ls_part-object_name )
                  is_options    = ls_options
        CHANGING  ct_versions   = lt_versions
                  ct_acr_stats  = lt_obj_stats
                  ct_hunk_info  = lt_hunk_info
                  ct_diff_data  = lt_diff_data
                  ct_cr_diag    = lt_diag ).
    ELSEIF ls_part-type = 'FUGR'.
      zcl_vx_review_build=>precompute_fugr_parts(
        EXPORTING iv_fugr_name  = CONV #( ls_part-object_name )
                  is_options    = ls_options
        CHANGING  ct_versions   = lt_versions
                  ct_acr_stats  = lt_obj_stats
                  ct_hunk_info  = lt_hunk_info
                  ct_diff_data  = lt_diff_data
                  ct_cr_diag    = lt_diag ).
    ELSE.
      DELETE lt_obj_stats WHERE objtype = ls_part-type AND obj_name = ls_part-object_name.
      DELETE lt_hunk_info WHERE objtype = ls_part-type AND obj_name = ls_part-object_name.
      DELETE lt_diff_data WHERE key-objtype = ls_part-type AND key-objname = ls_part-object_name.
      zcl_vx_review_build=>precompute_part(
        EXPORTING is_part       = ls_row
                  is_options    = ls_options
        CHANGING  ct_versions   = lt_versions
                  ct_acr_stats  = lt_obj_stats
                  ct_hunk_info  = lt_hunk_info
                  ct_diff_data  = lt_diff_data
                  ct_cr_diag    = lt_diag ).
    ENDIF.

    LOOP AT lt_hunk_info INTO DATA(ls_after).
      IF ( ls_part-type = 'CLAS' AND ls_after-class_name = ls_part-object_name )
         OR ( ls_part-type <> 'CLAS' AND ls_after-objtype = ls_part-type
                                     AND ls_after-obj_name = ls_part-object_name ).
        INSERT ls_after INTO TABLE lt_after.
      ENDIF.
    ENDLOOP.

    zcl_vx_review_state=>remap_review_state(
      EXPORTING it_old_hunks     = lt_before
                it_new_hunks     = lt_after
      CHANGING  ct_approved      = lt_approved
                ct_declined      = lt_declined
                ct_hunk_actions  = lt_actions
                ct_decline_notes = lt_notes
                ct_hunk_threads  = lt_threads ).

    zcl_vx_review_state=>sanitize_review_state(
      EXPORTING it_hunk_info    = lt_hunk_info
      CHANGING  ct_approved     = lt_approved
                ct_declined     = lt_declined
                ct_hunk_actions = lt_actions ).

    DATA(ls_next) = zcl_vx_review_state=>build_save_payload(
      is_existing_payload = ls_payload
      iv_trkorr           = CONV #( lv_trkorr )
      it_obj_stats        = lt_obj_stats
      it_hunk_info        = lt_hunk_info
      it_diff_cache       = lt_diff_cache
      it_diff_data        = lt_diff_data
      it_hunk_actions     = lt_actions
      it_approved         = lt_approved
      it_declined         = lt_declined
      it_decline_notes    = lt_notes
      it_hunk_threads     = lt_threads
      it_timings          = lt_timings ).

    IF zcl_vx_review_store=>save_review_payload(
         iv_trkorr  = CONV #( lv_trkorr )
         iv_remote  = CONV #( lv_remote )
         is_payload = ls_next ) = abap_false.
      bad_request( |ZAVE_REVIEW would not take the write.| ).
    ENDIF.

    DATA(lv_body) =
      |\{"request":"{ to_lower( lv_trkorr ) }",| &&
      |"objtype":"{ to_lower( lv_objtype ) }",| &&
      |"object":"{ to_lower( lv_object ) }",| &&
      |"hunks":{ lines( lt_after ) },| &&
      |"carried":{ lines( lt_before ) },| &&
      |"diagnostics":{ /ui2/cl_json=>serialize( data = lt_diag ) }\}|.

    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = lv_body ).
  ENDMETHOD.


  METHOD objects_of.
    DATA(lo_object) = NEW zcl_vx_object_factory( )->get_instance(
                          object_type = zcl_vx_object_factory=>gc_type-tr
                          object_name = CONV #( i_trkorr ) ).
    rt_part = lo_object->get_parts( ).
    IF rt_part IS INITIAL.
      bad_request( |{ i_trkorr } records no object this review could be built from.| ).
    ENDIF.
  ENDMETHOD.


  METHOD flag_param.
    DATA lv_value TYPE string.
    io_request->get_uri_query_parameter( EXPORTING name      = i_name
                                                   mandatory = abap_false
                                         IMPORTING value     = lv_value ).
    TRANSLATE lv_value TO UPPER CASE.
    " Absent and "switched off" are different answers: a caller that says
    " nothing gets AVE's default, a caller that says no gets no.
    rv_yes = COND #( WHEN lv_value IS INITIAL                             THEN i_default
                     WHEN lv_value = `X` OR lv_value = `TRUE`
                       OR lv_value = `1` OR lv_value = `ON`               THEN abap_true
                     ELSE                                                      abap_false ).
  ENDMETHOD.


  METHOD options_for.
    " The tasks of the request are what a version carries in its KORRNUM; the
    " request itself is their parent. A request with no tasks stands for both.
    DATA lt_task TYPE zif_vx_object=>ty_t_korr_range.
    SELECT trkorr FROM e070
      WHERE strkorr = @i_trkorr
      INTO TABLE @DATA(lt_child).
    LOOP AT lt_child INTO DATA(lv_child).
      APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_child ) TO lt_task.
    ENDLOOP.
    IF lt_task IS INITIAL.
      APPEND VALUE #( sign = 'I' option = 'EQ' low = i_trkorr ) TO lt_task.
    ENDIF.

    rs_options = VALUE #(
      filter_korrnum         = i_trkorr
      filter_korrnums        = lt_task
      filter_parent_korrnums = VALUE #( ( sign = 'I' option = 'EQ' low = i_trkorr ) )
      " A request was named, so the change under review is what it carries and
      " not everything since the last release.
      pair_released          = abap_false
      system                 = i_remote
      " What used to be the checkboxes of AVE's selection screen, with AVE's own
      " defaults: P_BLAME, P_ICASE and P_IGNGEN all ship ticked, P_RMDP does not.
      " They are the caller's to change and not this resource's to decide, and
      " the defaults are copied rather than chosen - a review prepared from here
      " and one prepared in AVE have to be the same review. Worth knowing what
      " each costs: BLAME reads the whole version history of every part, and
      " IGNORE_GENERATED leaves generated classes out of the review entirely.
      blame                  = flag_param( io_request = io_request i_name = `blame`
                                           i_default = abap_true )
      ignore_case            = flag_param( io_request = io_request i_name = `ignorecase`
                                           i_default = abap_true )
      ignore_generated       = flag_param( io_request = io_request i_name = `ignoregenerated`
                                           i_default = abap_true )
      remove_dup             = flag_param( io_request = io_request i_name = `removedup`
                                           i_default = abap_false )
      " Not settings at all any more: NO_TOC, TWO_PANE and COMPACT chose how
      " AVE's ABAP drew the review, and DEBUG appended its diagnostics to the
      " drawing. Nothing here draws.
      no_toc                 = abap_false
      two_pane               = abap_false
      compact                = abap_false
      debug                  = abap_false ).
  ENDMETHOD.


  METHOD bad_request.
    RAISE EXCEPTION TYPE cx_adt_res_bad_request
      EXPORTING explanation = i_text.
  ENDMETHOD.


  METHOD reason.
    DATA(lo_error) = ix_error.
    WHILE lo_error IS BOUND.
      DATA(lv_text) = lo_error->get_text( ).
      IF lv_text IS NOT INITIAL.
        IF rv_text IS INITIAL.
          rv_text = lv_text.
        ELSE.
          rv_text = rv_text && ` - ` && lv_text.
        ENDIF.
      ENDIF.
      lo_error = lo_error->previous.
    ENDWHILE.
    IF rv_text IS INITIAL.
      rv_text = `it raised an exception carrying no message.`.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
