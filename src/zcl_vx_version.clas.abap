"! Represents one version of a versionable object part.
"! Loads metadata from VRSD and source code via SVRS_GET_REPS_FROM_OBJECT.
CLASS zcl_vx_version DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    CONSTANTS:
      BEGIN OF c_version,
        latest_db TYPE versno VALUE 0,
        latest    TYPE versno VALUE 99998,
        active    TYPE versno VALUE 99998,
        modified  TYPE versno VALUE 99999,
      END OF c_version.

    DATA version_number TYPE versno      READ-ONLY.
    DATA request        TYPE verskorrno  READ-ONLY.
    DATA task           TYPE verskorrno  READ-ONLY.
    DATA author         TYPE versuser    READ-ONLY.
    DATA author_name    TYPE ad_namtext  READ-ONLY.
    DATA date           TYPE versdate    READ-ONLY.
    DATA time           TYPE verstime    READ-ONLY.
    DATA objtype        TYPE versobjtyp  READ-ONLY.
    DATA objname        TYPE versobjnam  READ-ONLY.

    METHODS constructor
      IMPORTING
        !vrsd TYPE vrsd
      RAISING
        zcx_vx.

    "! Loads and returns the raw source code for this version
    METHODS get_source
      RETURNING
        VALUE(result) TYPE abaptxt255_tab
      RAISING
        zcx_vx.

    "! Loads DDLS source via cl_svrs_tlogo_controller for any caller.
    "! i_versno is the EXTERNAL version number (e.g. 99998 for active, 00001 etc.).
    CLASS-METHODS load_ddls_source
      IMPORTING i_objname     TYPE versobjnam
                i_versno      TYPE versno
      RETURNING VALUE(result) TYPE abaptxt255_tab.

  PRIVATE SECTION.

    DATA vrsd TYPE vrsd.

    METHODS load_attributes.

    "! Overwrite author/date/time from the task if possible
    "! (task owner better reflects who actually changed the code)
    METHODS load_latest_task
      RAISING zcx_vx.

    METHODS load_author_name
      RAISING zcx_vx.

ENDCLASS.


CLASS zcl_vx_version IMPLEMENTATION.

  METHOD constructor.
    me->vrsd = vrsd.
    load_attributes( ).
    load_latest_task( ).
    load_author_name( ).
  ENDMETHOD.

  METHOD get_source.
    IF vrsd-objtype = 'DDLS'.
      result = load_ddls_source(
        i_objname = vrsd-objname
        i_versno  = me->version_number ).
      RETURN.
    ENDIF.

    DATA lt_trdir TYPE trdir_it.

    CALL FUNCTION 'SVRS_GET_REPS_FROM_OBJECT'
      EXPORTING
        object_name = vrsd-objname
        object_type = vrsd-objtype
        versno      = zcl_vx_versno=>to_internal( me->version_number )
      TABLES
        repos_tab   = result
        trdir_tab   = lt_trdir
      EXCEPTIONS
        no_version  = 1
        OTHERS      = 2.
    " subrc <> 0 → empty source, not treated as error
  ENDMETHOD.


  METHOD load_ddls_source.
    DATA: lo_controller TYPE REF TO cl_svrs_tlogo_controller,
          lo_db_view    TYPE REF TO cl_svrs_tlogo_db_view,
          lo_log_view   TYPE REF TO cl_svrs_tlogo_log_view.
    FIELD-SYMBOLS: <content> TYPE any,
                   <ddlsrc>  TYPE ANY TABLE,
                   <row>     TYPE any,
                   <field>   TYPE any.
    TRY.
        CREATE OBJECT lo_controller.
        lo_db_view = lo_controller->get_object(
          iv_objtype     = 'DDLS'
          iv_objname     = i_objname
          iv_versno      = i_versno
          iv_destination = '' ).
        CHECK lo_db_view IS BOUND.
        lo_log_view = lo_db_view->convert_to_log_view( ).
        CHECK lo_log_view IS BOUND AND lo_log_view->ar_content IS BOUND.
        ASSIGN lo_log_view->ar_content->* TO <content>.
        CHECK sy-subrc = 0.
        ASSIGN COMPONENT 'DDLSOURCE' OF STRUCTURE <content> TO <ddlsrc>.
        CHECK sy-subrc = 0.
        LOOP AT <ddlsrc> ASSIGNING <row>.
          ASSIGN COMPONENT 1 OF STRUCTURE <row> TO <field>.
          IF sy-subrc = 0.
            DATA lv_line TYPE string.
            lv_line = <field>.
            APPEND CONV abaptxt255( lv_line ) TO result.
          ENDIF.
        ENDLOOP.
      CATCH cx_root.
    ENDTRY.
  ENDMETHOD.

  METHOD load_attributes.
    me->version_number = vrsd-versno.
    me->author         = vrsd-author.
    me->date           = vrsd-datum.
    me->time           = vrsd-zeit.
    me->request        = vrsd-korrnum.
    me->objtype        = vrsd-objtype.
    me->objname        = vrsd-objname.
  ENDMETHOD.

  METHOD load_latest_task.
    IF me->request IS INITIAL.
      RETURN.
    ENDIF.

    " Active version (99998): date/time/author already set correctly from
    " SVRS_GET_VERSION_DIRECTORY in zcl_vx_vrsd — don't overwrite with task data.
    IF me->version_number = c_version-active.
      RETURN.
    ENDIF.

    " korrnum is a request — find the responsible task within it
    DATA(lo_request) = NEW zcl_vx_request( me->request ).
    DATA(ls_e070) = lo_request->get_task_for_object(
      object_type  = vrsd-objtype
      object_name  = vrsd-objname
      version_date = me->date
      version_time = me->time ).
    IF ls_e070-trkorr IS NOT INITIAL.
      me->task   = ls_e070-trkorr.
      me->author = ls_e070-as4user.
*      me->date   = ls_e070-as4date.
*      me->time   = ls_e070-as4time.
    ENDIF.
  ENDMETHOD.

  METHOD load_author_name.
    me->author_name = NEW zcl_vx_author( )->get_name( me->author ).
  ENDMETHOD.

ENDCLASS.
