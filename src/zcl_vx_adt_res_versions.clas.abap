CLASS zcl_vx_adt_res_versions DEFINITION
  PUBLIC
  INHERITING FROM cl_adt_rest_resource
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    METHODS get REDEFINITION.

  PRIVATE SECTION.
    " One versionable part of an object: a program is one, a class is its
    " sections, its local includes and one per method. SECTION is public,
    " protected or private for a class's sections and its methods, so a client
    " can group them the way SE80 does, and empty for everything else.
    TYPES: BEGIN OF ty_part,
             class     TYPE string,
             unit      TYPE string,
             name      TYPE string,
             part_type TYPE string,
             section   TYPE string,
           END OF ty_part,
           tt_part TYPE STANDARD TABLE OF ty_part WITH EMPTY KEY.

    " Which section a class's methods are declared in, by method name.
    TYPES: BEGIN OF ty_section,
             method  TYPE seocpdname,
             section TYPE string,
           END OF ty_section,
           tt_section TYPE SORTED TABLE OF ty_section WITH UNIQUE KEY method.

    " Dates and times are passed as the dictionary holds them, YYYYMMDD and
    " HHMMSS. Formatting belongs to the reader, who knows the locale.
    TYPES: BEGIN OF ty_version,
             version     TYPE string,
             date        TYPE string,
             time        TYPE string,
             author      TYPE string,
             author_name TYPE string,
             request     TYPE string,
             task        TYPE string,
           END OF ty_version,
           tt_version TYPE STANDARD TABLE OF ty_version WITH EMPTY KEY.

    " One line of the diff. The op is what AVE's engine returns: '=' kept,
    " '-' from the old version, '+' from the new one.
    TYPES: BEGIN OF ty_op,
             op   TYPE string,
             text TYPE string,
           END OF ty_op,
           tt_op TYPE STANDARD TABLE OF ty_op WITH EMPTY KEY.

    "! A part worth offering. A class is generated with all three section
    "! includes and several local ones whether anything was put in them or not,
    "! and a part that holds nothing answers "no versions recorded" after a
    "! click that was never worth making. What is skipped: an include that does
    "! not exist, one with no lines, and a section carrying nothing but its own
    "! header. An include that exists and has content is kept whatever its
    "! history says - the history is the next question, not this one.
    METHODS worth_showing
      IMPORTING is_part       TYPE zif_vx_object=>ty_part
      RETURNING VALUE(rv_yes) TYPE abap_bool.

    "! A section include holding nothing but its own header line. AVE's rule,
    "! carried here rather than read from it: sixteen lines of predicate were
    "! not worth a dependency on the whole review half. Comment lines carry no
    "! declaration and do not count against it.
    CLASS-METHODS is_empty_section
      IMPORTING it_source     TYPE abaptxt255_tab
      RETURNING VALUE(rv_yes) TYPE abap_bool.

    "! The section each method of a class is declared in, as the class builder
    "! keeps it and SE80 draws its icons from: SEOCOMPODF for the class's own
    "! methods, SEOREDEF for the ones it redefines. Read from the tables rather
    "! than by parsing the class, which would cost a parse per class opened.
    CLASS-METHODS sections
      IMPORTING i_class           TYPE seoclsname
      RETURNING VALUE(rt_section) TYPE tt_section.

    "! The section one part belongs to: a section part is its own, a method is
    "! looked up, and anything else belongs to none.
    CLASS-METHODS section_of
      IMPORTING is_part           TYPE zif_vx_object=>ty_part
                it_section        TYPE tt_section
      RETURNING VALUE(rv_section) TYPE string.

    METHODS not_found
      IMPORTING i_type TYPE string
                i_id   TYPE string
      RAISING   cx_adt_res_not_found.

    METHODS bad_request
      IMPORTING i_text TYPE string
      RAISING   cx_adt_res_bad_request.

    " ZCX_VX carries no text of its own - its constructor only passes the
    " exception it wrapped - so the sentence worth showing is down the chain.
    CLASS-METHODS reason
      IMPORTING ix_error       TYPE REF TO cx_root
      RETURNING VALUE(rv_text) TYPE string.

    " The source of one recorded version. A number that is not in the directory
    " is refused rather than diffed against nothing, which would report the
    " whole part as added and look like a real answer.
    METHODS source_of
      IMPORTING io_vrsd          TYPE REF TO zcl_vx_vrsd
                i_versno         TYPE versno
      RETURNING VALUE(rt_source) TYPE abaptxt255_tab
      RAISING   zcx_vx cx_adt_res_bad_request.
ENDCLASS.


CLASS zcl_vx_adt_res_versions IMPLEMENTATION.

  METHOD get.
    DATA: lv_name  TYPE string,
          lv_type  TYPE string,
          lv_sub   TYPE string,
          lv_part  TYPE string,
          lv_ptype TYPE string,
          lv_ave   TYPE string,
          lt_part  TYPE tt_part,
          lt_ver   TYPE tt_version,
          lv_from  TYPE versno,
          lv_to    TYPE versno,
          lv_toc   TYPE string,
          lv_dups  TYPE string,
          lv_ic    TYPE string,
          lt_op    TYPE tt_op,
          lt_old   TYPE abaptxt255_tab,
          lt_new   TYPE abaptxt255_tab,
          lv_body  TYPE string.

    request->get_uri_attribute( EXPORTING name      = 'name'
                                          mandatory = abap_true
                                IMPORTING value     = lv_name ).
    lv_name = to_upper( lv_name ).

    request->get_uri_query_parameter( EXPORTING name      = 'type'
                                                mandatory = abap_false
                                                default   = 'PROG'
                                      IMPORTING value     = lv_type ).
    lv_type = to_upper( lv_type ).
    " The caller may pass the ADT type as it comes from the object tree, with
    " its subtype: CLAS/OC, PROG/P. Only the part in front of the slash counts.
    SPLIT lv_type AT '/' INTO lv_type lv_sub.

    " Which part to read the versions of. Absent, the answer is the parts list
    " itself - the two together are the left and the middle pane of AVE, and
    " keeping them apart keeps a class of eighty methods from reading the
    " version directory eighty times to draw a list of names.
    request->get_uri_query_parameter( EXPORTING name      = 'part'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_part ).
    request->get_uri_query_parameter( EXPORTING name      = 'ptype'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_ptype ).

    " Both present, the answer is the difference between those two versions of
    " the part. An empty FROM is the oldest version compared against nothing,
    " which is how a first version reads: every line added.
    request->get_uri_query_parameter( EXPORTING name      = 'from'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_from ).
    request->get_uri_query_parameter( EXPORTING name      = 'to'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_to ).

    " AVE's three switches over the version list, each off unless asked for:
    " TOC=X keeps the versions written by transports of copies, DUPS=X drops a
    " version whose source is the same as the one before it, IC=X compares
    " without case and indentation - both the diff and the duplicate check.
    request->get_uri_query_parameter( EXPORTING name      = 'toc'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_toc ).
    request->get_uri_query_parameter( EXPORTING name      = 'dups'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_dups ).
    request->get_uri_query_parameter( EXPORTING name      = 'ic'
                                                mandatory = abap_false
                                      IMPORTING value     = lv_ic ).
    DATA(lv_no_toc)      = xsdbool( to_upper( lv_toc ) <> 'X' ).
    DATA(lv_remove_dup)  = xsdbool( to_upper( lv_dups ) = 'X' ).
    DATA(lv_ignore_case) = xsdbool( to_upper( lv_ic ) = 'X' ).

    " ADT names an object type differently from AVE's factory, and the DDIC
    " types carry their VRSD part type already.
    lv_ave = SWITCH string( lv_type
      WHEN 'CLAS' THEN 'CLAS'
      WHEN 'INTF' THEN 'INTF'
      WHEN 'PROG' THEN 'PROG'
      WHEN 'INCL' THEN 'PROG'
      WHEN 'FUGR' THEN 'FUGR'
      WHEN 'FUNC' THEN 'FUNC'
      WHEN 'DDLS' THEN 'DDLS'
      WHEN 'TABL' THEN 'TABD'
      WHEN 'DOMA' THEN 'DOMD'
      WHEN 'DTEL' THEN 'DTED'
      WHEN 'TR'   THEN 'TR'
      WHEN 'DEVC' THEN 'DEVC'
      ELSE '' ).

    IF lv_ave IS INITIAL.
      bad_request( |Type { lv_type } is not supported here.| &&
                   | Versions are read for CLAS, INTF, PROG, INCL, FUGR, FUNC,| &&
                   | DDLS, TABL, DOMA and DTEL.| ).
    ENDIF.

    TRY.
        DATA(lo_object) = NEW zcl_vx_object_factory( )->get_instance(
                              object_type = lv_ave
                              object_name = CONV #( lv_name ) ).
      CATCH zcx_vx.
        " The factory raises this for an object it cannot find. Not a 404: the
        " client reads a 404 as a system without this resource installed, and a
        " request typed on the wrong system would send the user to install it.
        bad_request( |{ SWITCH string( lv_type WHEN 'TR'   THEN `Transport request`
                                               WHEN 'DEVC' THEN `Package`
                                               ELSE lv_type ) } { lv_name }| &&
                     | does not exist in system { sy-sysid }, client { sy-mandt }.| ).
    ENDTRY.

    IF lv_part IS INITIAL.
      " Only a class has sections. A scope lists the methods of many classes,
      " and grouping those is not what a scope is for.
      DATA(lt_section) = COND tt_section( WHEN lv_type = 'CLAS'
                                          THEN sections( CONV #( lv_name ) ) ).
      TRY.
          DATA(lt_parts) = lo_object->get_parts( ).
          LOOP AT lt_parts INTO DATA(ls_part).
            " A scope lists objects, and an object is never empty in this sense.
            IF lv_type <> 'TR' AND lv_type <> 'DEVC'
               AND worth_showing( ls_part ) = abap_false.
              CONTINUE.
            ENDIF.
            APPEND VALUE #( class     = ls_part-class
                            unit      = ls_part-unit
                            name      = CONV string( ls_part-object_name )
                            part_type = ls_part-type
                            section   = COND string( WHEN lv_type = 'CLAS'
                                                     THEN section_of( is_part    = ls_part
                                                                      it_section = lt_section ) ) ) TO lt_part.
          ENDLOOP.
        CATCH zcx_vx INTO DATA(lx_parts).
          bad_request( |AVE cannot list the parts of { lv_name }: { reason( lx_parts ) }| ).
      ENDTRY.

      " A transport request and a package are scopes, not objects: what comes
      " back is the objects in them, and an object is drilled into rather than
      " asked for the versions of a part it does not have. The client is told
      " which of the two it is holding.
      DATA(lv_scope) = COND string( WHEN lv_type = 'TR' OR lv_type = 'DEVC'
                                    THEN `true` ELSE `false` ).

      lv_body = |\{"object":"{ to_lower( lv_name ) }",| &&
                |"type":"{ to_lower( lv_type ) }",| &&
                |"scope":{ lv_scope },| &&
                |"parts":{ /ui2/cl_json=>serialize(
                             data        = lt_part
                             pretty_name = /ui2/cl_json=>pretty_mode-low_case ) }\}|.
    ELSE.
      IF lv_ptype IS INITIAL.
        bad_request( |Reading the versions of part { lv_part } needs its type in ptype.| ).
      ENDIF.

      " A key that is not one of this object's parts reads as an object with no
      " history, which is indistinguishable from a part nobody ever changed.
      " The parts list is cheap by construction, so it is worth asking.
      TRY.
          DATA(lt_known) = lo_object->get_parts( ).
        CATCH zcx_vx INTO DATA(lx_known).
          bad_request( |AVE cannot list the parts of { lv_name }: { reason( lx_known ) }| ).
      ENDTRY.
      IF NOT line_exists( lt_known[ object_name = to_upper( lv_part )
                                    type        = to_upper( lv_ptype ) ] ).
        bad_request( |{ lv_part } of type { lv_ptype } is not a part of { lv_name }.| &&
                     | Ask for the parts list first; a method key carries the class name| &&
                     | padded to thirty characters and every blank of it matters.| ).
      ENDIF.

      TRY.
          " A diff reads both of its versions whatever the list shows, so the
          " TOC switch belongs to the list alone.
          DATA(lo_vrsd) = NEW zcl_vx_vrsd( type   = CONV #( to_upper( lv_ptype ) )
                                            name   = CONV #( to_upper( lv_part ) )
                                            no_toc = COND #( WHEN lv_to IS INITIAL THEN lv_no_toc ) ).

          IF lv_to IS INITIAL.
            " The rows go through AVE's own version-row type first, because that
            " is the shape its duplicate check reads: object type and name to
            " fetch each source, number, date and time to order them.
            DATA lt_row TYPE zif_vx_vers_types=>ty_t_version_row.
            LOOP AT lo_vrsd->vrsd_list INTO DATA(ls_vrsd).
              DATA(lo_version) = NEW zcl_vx_version( ls_vrsd ).
              APPEND VALUE #( objtype     = ls_vrsd-objtype
                              objname     = ls_vrsd-objname
                              versno      = lo_version->version_number
                              datum       = lo_version->date
                              zeit        = lo_version->time
                              author      = lo_version->author
                              author_name = lo_version->author_name
                              korrnum     = lo_version->request
                              task        = lo_version->task ) TO lt_row.
            ENDLOOP.
            " AVE's own check: it reads the sources and keeps the earliest of a
            " run of identical ones.
            IF lv_remove_dup = abap_true.
              zcl_vx_vers_data=>remove_duplicate_versions(
                EXPORTING i_ignore_case = lv_ignore_case
                CHANGING  ct_versions   = lt_row ).
            ENDIF.
            " What survived, in the flat shape the page reads: every field a
            " string, dates and times as the dictionary keeps them.
            LOOP AT lt_row INTO DATA(ls_row).
              APPEND VALUE #( version     = |{ ls_row-versno }|
                              date        = |{ ls_row-datum }|
                              time        = |{ ls_row-zeit }|
                              author      = CONV string( ls_row-author )
                              author_name = CONV string( ls_row-author_name )
                              request     = CONV string( ls_row-korrnum )
                              task        = CONV string( ls_row-task )
                            ) TO lt_ver.
            ENDLOOP.
            " AVE sorts the directory ascending so that 99998, its key for the
            " active version, lands after the numbered ones. A reader wants the
            " newest first, and so does the client: it compares a version with
            " the one below it, which is the change that version made.
            SORT lt_ver BY version DESCENDING.
          ELSE.
            lt_new = source_of( io_vrsd = lo_vrsd i_versno = lv_to ).
            IF lv_from IS NOT INITIAL.
              lt_old = source_of( io_vrsd = lo_vrsd i_versno = lv_from ).
            ENDIF.
          ENDIF.

        CATCH zcx_vx INTO DATA(lx_ver).
          bad_request( |AVE cannot read the versions of { lv_part }: { reason( lx_ver ) }| ).
      ENDTRY.

      IF lv_to IS INITIAL.
        lv_body = |\{"object":"{ to_lower( lv_name ) }",| &&
                  |"type":"{ to_lower( lv_type ) }",| &&
                  |"part":"{ to_lower( lv_part ) }",| &&
                  |"part_type":"{ to_lower( lv_ptype ) }",| &&
                  |"versions":{ /ui2/cl_json=>serialize(
                                  data        = lt_ver
                                  pretty_name = /ui2/cl_json=>pretty_mode-low_case ) }\}|.
      ELSE.
        " AVE's own engine, unchanged: it pairs the declarations of a class
        " section by signature rather than by position, because SAP regenerates
        " those includes in an arbitrary order and a plain line diff reports
        " every moved declaration as a deletion and an insertion far apart.
        DATA(lt_diff) = zcl_vx_diff=>compute_diff( it_old         = lt_old
                                                   it_new         = lt_new
                                                   i_ignore_case  = lv_ignore_case ).
        " The counts head the diff on the page. With IC=X a line that differs
        " only in case or indentation is kept, not deleted and added again.
        DATA lv_added   TYPE i.
        DATA lv_deleted TYPE i.
        DATA lv_kept    TYPE i.
        LOOP AT lt_diff INTO DATA(ls_diff).
          CASE ls_diff-op.
            WHEN '+'.  lv_added   = lv_added + 1.
            WHEN '-'.  lv_deleted = lv_deleted + 1.
            WHEN OTHERS. lv_kept  = lv_kept + 1.
          ENDCASE.
          APPEND VALUE #( op = CONV string( ls_diff-op ) text = ls_diff-text ) TO lt_op.
        ENDLOOP.

        " VERSNO is numeric, so an absent FROM would print as 00000 and read
        " like a version number somebody could look up.
        DATA(lv_from_text) = COND string( WHEN lv_from IS INITIAL THEN ``
                                          ELSE |{ lv_from }| ).

        lv_body = |\{"object":"{ to_lower( lv_name ) }",| &&
                  |"type":"{ to_lower( lv_type ) }",| &&
                  |"part":"{ to_lower( lv_part ) }",| &&
                  |"part_type":"{ to_lower( lv_ptype ) }",| &&
                  |"from":"{ lv_from_text }","to":"{ lv_to }",| &&
                  |"added":{ lv_added },"deleted":{ lv_deleted },"kept":{ lv_kept },| &&
                  |"ops":{ /ui2/cl_json=>serialize(
                             data        = lt_op
                             pretty_name = /ui2/cl_json=>pretty_mode-low_case ) }\}|.
      ENDIF.
    ENDIF.

    response->set_body_data(
      content_handler = NEW cl_adt_rest_plain_text_handler( content_type = if_rest_media_type=>gc_appl_json )
      data            = lv_body ).
  ENDMETHOD.


  METHOD worth_showing.
    DATA lt_source TYPE abaptxt255_tab.
    DATA lv_include TYPE program.

    rv_yes = abap_true.

    CASE is_part-type.
      WHEN 'CLSD'.
        " The class pool is generated from the class and says nothing a
        " developer wrote, so its versions are not worth a row.
        rv_yes = abap_false.
        RETURN.

      WHEN 'CPUB' OR 'CPRO' OR 'CPRI'.
        " A section's part name is the class; its text lives in a generated
        " include of its own.
        DATA(lv_class) = CONV seoclsname( is_part-class ).
        lv_include = SWITCH program( is_part-type
          WHEN 'CPUB' THEN cl_oo_classname_service=>get_pubsec_name( lv_class )
          WHEN 'CPRO' THEN cl_oo_classname_service=>get_prosec_name( lv_class )
          ELSE cl_oo_classname_service=>get_prisec_name( lv_class ) ).

      WHEN 'CINC' OR 'CDEF' OR 'REPS'.
        " The local includes carry their own program name as the part name.
        lv_include = is_part-object_name.

      WHEN OTHERS.
        " A method, a program, a DDIC object: not something that gets generated
        " empty alongside something else.
        RETURN.
    ENDCASE.

    READ REPORT lv_include INTO lt_source.
    IF sy-subrc <> 0 OR lt_source IS INITIAL.
      rv_yes = abap_false.
      RETURN.
    ENDIF.

    " AVE's rule, carried here: a newly generated class carries
    " 'protected section.' and nothing else, which is not a part to review.
    IF ( is_part-type = 'CPUB' OR is_part-type = 'CPRO' OR is_part-type = 'CPRI' )
       AND is_empty_section( lt_source ) = abap_true.
      rv_yes = abap_false.
    ENDIF.
  ENDMETHOD.


  METHOD is_empty_section.
    LOOP AT it_source INTO DATA(ls_line).
      DATA(lv_trimmed) = condense( to_upper( CONV string( ls_line ) ) ).
      CHECK lv_trimmed IS NOT INITIAL.
      " Comment lines carry no declaration.
      IF lv_trimmed(1) = '*' OR lv_trimmed(1) = '"'.
        CONTINUE.
      ENDIF.
      IF lv_trimmed <> `PUBLIC SECTION.`
         AND lv_trimmed <> `PROTECTED SECTION.`
         AND lv_trimmed <> `PRIVATE SECTION.`.
        RETURN.
      ENDIF.
    ENDLOOP.
    rv_yes = abap_true.
  ENDMETHOD.


  METHOD sections.
    " Where a method has an inactive version as well, the active one decides.
    SELECT cmpname, exposure, version FROM seocompodf
      WHERE clsname = @i_class
      ORDER BY cmpname, version DESCENDING
      INTO TABLE @DATA(lt_own).
    LOOP AT lt_own INTO DATA(ls_own).
      INSERT VALUE #( method  = ls_own-cmpname
                      section = SWITCH string( ls_own-exposure
                                  WHEN '2' THEN `public`
                                  WHEN '1' THEN `protected`
                                  WHEN '0' THEN `private` ) ) INTO TABLE rt_section.
    ENDLOOP.

    " A redefinition is not a component of the class that redefines it; its
    " section is recorded with the redefinition.
    SELECT mtdname, exposure FROM seoredef
      WHERE clsname = @i_class
      INTO TABLE @DATA(lt_redef).
    LOOP AT lt_redef INTO DATA(ls_redef).
      INSERT VALUE #( method  = ls_redef-mtdname
                      section = SWITCH string( ls_redef-exposure
                                  WHEN '2' THEN `public`
                                  WHEN '1' THEN `protected`
                                  WHEN '0' THEN `private` ) ) INTO TABLE rt_section.
    ENDLOOP.
  ENDMETHOD.


  METHOD section_of.
    CASE is_part-type.
      WHEN 'CPUB'.
        rv_section = `public`.
      WHEN 'CPRO'.
        rv_section = `protected`.
      WHEN 'CPRI'.
        rv_section = `private`.
      WHEN 'METH'.
        DATA(lv_method) = CONV seocpdname( is_part-unit ).
        IF lv_method CS '~'.
          " An interface's method is in neither table, and it is public,
          " because every method of an interface is.
          rv_section = `public`.
        ELSE.
          READ TABLE it_section INTO DATA(ls_section) WITH TABLE KEY method = lv_method.
          IF sy-subrc = 0.
            rv_section = ls_section-section.
          ENDIF.
        ENDIF.
    ENDCASE.
  ENDMETHOD.


  METHOD not_found.
    RAISE EXCEPTION TYPE cx_adt_res_not_found
      EXPORTING resource_type = i_type
                resource_id   = i_id.
  ENDMETHOD.


  METHOD bad_request.
    RAISE EXCEPTION TYPE cx_adt_res_bad_request
      EXPORTING explanation = i_text.
  ENDMETHOD.


  METHOD source_of.
    LOOP AT io_vrsd->vrsd_list INTO DATA(ls_vrsd) WHERE versno = i_versno.
      rt_source = NEW zcl_vx_version( ls_vrsd )->get_source( ).
      RETURN.
    ENDLOOP.
    bad_request( |Version { i_versno } is not in the version directory of this part.| ).
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
