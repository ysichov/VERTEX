"! Represents an SAP transport request — reads E070/E071 data
CLASS zcl_vx_request DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    DATA id          TYPE trkorr    READ-ONLY.
    DATA description TYPE as4text   READ-ONLY.
    DATA status      TYPE trstatus  READ-ONLY.

    METHODS constructor
      IMPORTING
        !id TYPE trkorr
      RAISING
        zcx_vx.

    "! Header data of one request, read once per korrnum and cached.
    TYPES:
      BEGIN OF ty_header,
        trkorr     TYPE trkorr,
        trfunction TYPE e070-trfunction,
        trstatus   TYPE e070-trstatus,
        strkorr    TYPE e070-strkorr,
        as4user    TYPE e070-as4user,
        as4date    TYPE e070-as4date,
        as4time    TYPE e070-as4time,
        as4text    TYPE e07t-as4text,
        found      TYPE abap_bool,
      END OF ty_header.

    "! Cached E070/E07T header. The version list builds one request object per
    "! VRSD row, so without this the same header is read once per version and,
    "! for a class, once per version and technical part.
    CLASS-METHODS get_header
      IMPORTING
        iv_trkorr     TYPE trkorr
      RETURNING
        VALUE(result) TYPE ty_header.

    "! Drops the header/task caches. Called at the start of a Code Review
    "! preparation so a long-running session still sees fresh transport data.
    CLASS-METHODS clear_cache.

    "! Resolve the K-request(s) associated with iv_trkorr:
    "! K → itself, S/R → parent strkorr, T → CORR/MERG entries.
    CLASS-METHODS resolve_parent_k
      IMPORTING
        iv_trkorr     TYPE trkorr
      RETURNING
        VALUE(result) TYPE zif_vx_object=>ty_t_korr_range.

    "! Returns the task (E070) most likely responsible for the given object.
    "! Prefers single-task requests; falls back to E071 lookup.
    METHODS get_task_for_object
      IMPORTING
                object_type   TYPE versobjtyp
                object_name   TYPE versobjnam
                version_date  TYPE as4date OPTIONAL
                version_time  TYPE as4time OPTIONAL
      RETURNING VALUE(result) TYPE e070.

protected section.
  PRIVATE SECTION.

    TYPES ty_t_header TYPE HASHED TABLE OF ty_header WITH UNIQUE KEY trkorr.

    "! Tasks (S/R) that carry one object, keyed by the object itself — the
    "! underlying E071 x E070 read does not depend on the request, so the same
    "! result is reused for every version of that object.
    TYPES:
      BEGIN OF ty_obj_tasks,
        object   TYPE e071-object,
        obj_name TYPE e071-obj_name,
        tasks    TYPE STANDARD TABLE OF e070 WITH DEFAULT KEY,
      END OF ty_obj_tasks.
    TYPES ty_t_obj_tasks TYPE HASHED TABLE OF ty_obj_tasks WITH UNIQUE KEY object obj_name.

    "! Resolved parent K requests of one korrnum. The version list resolves the
    "! korrnum of every version of every part, and the T case costs an E071 read
    "! each time — the same transport of copies shows up in version after version.
    TYPES:
      BEGIN OF ty_parents,
        trkorr  TYPE trkorr,
        parents TYPE zif_vx_object=>ty_t_korr_range,
      END OF ty_parents.
    TYPES ty_t_parents TYPE HASHED TABLE OF ty_parents WITH UNIQUE KEY trkorr.

    CLASS-DATA gt_header_cache TYPE ty_t_header.
    CLASS-DATA gt_obj_task_cache TYPE ty_t_obj_tasks.
    CLASS-DATA gt_parent_cache TYPE ty_t_parents.

    "! E071 x E070 read of the S/R tasks containing one object, cached.
    CLASS-METHODS get_object_tasks
      IMPORTING
        iv_object     TYPE e071-object
        iv_obj_name   TYPE e071-obj_name
      RETURNING
        VALUE(result) TYPE ty_obj_tasks.

    METHODS populate_details
      IMPORTING
        !id TYPE trkorr
      RAISING
        zcx_vx.

    METHODS get_latest_task_for_object
      IMPORTING
                object_type   TYPE versobjtyp
                object_name   TYPE versobjnam
                version_date  TYPE as4date OPTIONAL
                version_time  TYPE as4time OPTIONAL
      RETURNING VALUE(result) TYPE e070.

ENDCLASS.



CLASS ZCL_VX_REQUEST IMPLEMENTATION.


  METHOD constructor.
    me->id = id.
    populate_details( id ).
  ENDMETHOD.


  METHOD populate_details.
    " E070 may be empty in sandbox/copy systems — an unfound header stays blank.
    DATA(ls_header) = get_header( id ).
    description = ls_header-as4text.
    status      = ls_header-trstatus.
  ENDMETHOD.


  METHOD get_header.
    CHECK iv_trkorr IS NOT INITIAL.

    READ TABLE gt_header_cache INTO result WITH TABLE KEY trkorr = iv_trkorr.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.

    CLEAR result.
    result-trkorr = iv_trkorr.
    SELECT e070~trfunction, e070~trstatus, e070~strkorr,
           e070~as4user, e070~as4date, e070~as4time, e07t~as4text
      INTO (@result-trfunction, @result-trstatus, @result-strkorr,
            @result-as4user, @result-as4date, @result-as4time, @result-as4text)
      UP TO 1 ROWS
      FROM e070
      LEFT JOIN e07t ON e07t~trkorr = e070~trkorr
      WHERE e070~trkorr = @iv_trkorr
      ORDER BY e07t~as4text, e070~trstatus.
      EXIT.
    ENDSELECT.
    result-found = xsdbool( sy-subrc = 0 ).

    " A miss is cached as well — a request absent from E070 stays absent.
    INSERT result INTO TABLE gt_header_cache.
  ENDMETHOD.


  METHOD clear_cache.
    CLEAR gt_header_cache.
    CLEAR gt_obj_task_cache.
    CLEAR gt_parent_cache.
  ENDMETHOD.


  METHOD get_object_tasks.
    READ TABLE gt_obj_task_cache INTO result
      WITH TABLE KEY object = iv_object obj_name = iv_obj_name.
    IF sy-subrc = 0.
      RETURN.
    ENDIF.

    DATA lt_trf_task_types TYPE RANGE OF e070-trfunction.
    lt_trf_task_types = VALUE #(
      ( sign = 'I' option = 'EQ' low = 'S' )
      ( sign = 'I' option = 'EQ' low = 'R' ) ).

    TYPES: BEGIN OF ty_obj_key,
             object   TYPE e071-object,
             obj_name TYPE e071-obj_name,
           END OF ty_obj_key.
    DATA lt_keys TYPE SORTED TABLE OF ty_obj_key WITH UNIQUE KEY object obj_name.

    INSERT VALUE #( object = iv_object obj_name = iv_obj_name ) INTO TABLE lt_keys.
    IF iv_object = 'PROG'.
      INSERT VALUE #( object = 'REPS' obj_name = iv_obj_name ) INTO TABLE lt_keys.
    ELSEIF iv_object = 'REPS'.
      INSERT VALUE #( object = 'PROG' obj_name = iv_obj_name ) INTO TABLE lt_keys.
    ENDIF.

    CLEAR result.
    result-object   = iv_object.
    result-obj_name = iv_obj_name.
    SELECT e070~trkorr, e070~strkorr, e070~as4user, e070~as4date, e070~as4time
      FROM e071
      INNER JOIN e070 ON e070~trkorr = e071~trkorr
      FOR ALL ENTRIES IN @lt_keys
      WHERE e071~object     = @lt_keys-object
        AND e071~obj_name   = @lt_keys-obj_name
        AND e070~trfunction IN @lt_trf_task_types
      INTO CORRESPONDING FIELDS OF TABLE @result-tasks.

    SORT result-tasks BY as4date DESCENDING as4time DESCENDING.
    INSERT result INTO TABLE gt_obj_task_cache.
  ENDMETHOD.


  METHOD resolve_parent_k.
    READ TABLE gt_parent_cache INTO DATA(ls_cached) WITH TABLE KEY trkorr = iv_trkorr.
    IF sy-subrc = 0.
      result = ls_cached-parents.
      RETURN.
    ENDIF.

    " Through the cached header: callers resolve every korrnum of an object's
    " version history, which without the cache is one SELECT per version.
    DATA(ls_header) = get_header( iv_trkorr ).
    IF ls_header-found = abap_false.
      RETURN.
    ENDIF.
    DATA(lv_trfunction) = ls_header-trfunction.
    DATA(lv_strkorr) = ls_header-strkorr.

    " RESULT is a RANGE table: the request number belongs in LOW. Appending it as
    " a plain value fills the flat structure byte by byte instead — SIGN gets the
    " first character, OPTION the next two, and LOW keeps only what is left
    " ('ER6K9A0WAA' → sign E, option R6, low K9A0WAA), so no caller ever matched a
    " resolved parent and every ToC/task resolution silently did nothing.
    CASE lv_trfunction.
      WHEN 'K'.
        APPEND VALUE #( sign = 'I' option = 'EQ' low = iv_trkorr ) TO result.
      WHEN 'S' OR 'R'.
        IF lv_strkorr IS NOT INITIAL.
          APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_strkorr ) TO result.
        ENDIF.
      WHEN 'T'.
        " The T's CORR/MERG entries name the K request(s) it was merged from.
        SELECT obj_name FROM e071
          WHERE trkorr = @iv_trkorr
            AND pgmid  = 'CORR'
            AND object = 'MERG'
          INTO TABLE @DATA(lt_merg_obj).
        LOOP AT lt_merg_obj INTO DATA(lv_merg_obj).
          APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_merg_obj(10) ) TO result.
        ENDLOOP.
        SORT result BY low.
        DELETE ADJACENT DUPLICATES FROM result COMPARING low.
        IF result IS INITIAL AND lv_strkorr IS NOT INITIAL.
          " No CORR/MERG entry — the copy was not created by the standard ToC
          " function. Some release tools instead leave the source request in
          " STRKORR, which is then the only link back to it. A T created the
          " normal way has STRKORR empty, so this changes nothing there.
          APPEND VALUE #( sign = 'I' option = 'EQ' low = lv_strkorr ) TO result.
        ENDIF.
    ENDCASE.

    INSERT VALUE #( trkorr = iv_trkorr parents = result ) INTO TABLE gt_parent_cache.
  ENDMETHOD.


  METHOD get_task_for_object.
    DATA(lv_object_type) = SWITCH versobjtyp( object_type
      WHEN 'REPS' OR 'REPT' THEN 'PROG'
      WHEN 'CINC' OR 'CLSD' OR
           'CPUB' OR 'CPRO' OR 'CPRI' THEN 'CLAS'
      ELSE object_type ).
    DATA(lv_object_name) = object_name.
    CASE object_type.
      WHEN 'CINC' OR 'CLSD' OR 'CPUB' OR 'CPRO' OR 'CPRI' OR 'REPT'.
        DATA(lv_eq) = find( val = lv_object_name sub = '=' ).
        IF lv_eq > 0.
          lv_object_name = lv_object_name(lv_eq).
        ENDIF.
    ENDCASE.

    result = get_latest_task_for_object(
      object_type  = lv_object_type
      object_name  = lv_object_name
      version_date = version_date
      version_time = version_time ).
  ENDMETHOD.


  METHOD get_latest_task_for_object.
    " Authoring tasks are the S (development) and R (repair) children of a K —
    " the same pair the version list matches against.
    DATA lt_trf_task_types TYPE RANGE OF e070-trfunction.
    lt_trf_task_types = VALUE #(
      ( sign = 'I' option = 'EQ' low = 'S' )
      ( sign = 'I' option = 'EQ' low = 'R' ) ).

    DATA(ls_request_header) = get_header( me->id ).
    DATA(lv_request_trfunction) = ls_request_header-trfunction.

    IF lv_request_trfunction IN lt_trf_task_types.
      " The request is the task itself — its own header is the answer.
      result-trkorr  = ls_request_header-trkorr.
      result-strkorr = ls_request_header-strkorr.
      result-as4user = ls_request_header-as4user.
      result-as4date = ls_request_header-as4date.
      result-as4time = ls_request_header-as4time.
      RETURN.
    ENDIF.

    " Candidate set depends on the object only, never on this request, so it is
    " read once per object and reused across all its versions.
    DATA(lt_tasks) = get_object_tasks(
      iv_object   = CONV #( object_type )
      iv_obj_name = CONV #( object_name ) )-tasks.

    LOOP AT lt_tasks INTO DATA(ls_task).
      CHECK version_date IS INITIAL
         OR ls_task-as4date < version_date
         OR ( ls_task-as4date = version_date AND ls_task-as4time <= version_time ).
      CHECK ( lv_request_trfunction <> 'K' AND lv_request_trfunction <> 'T' )
         OR ls_task-strkorr = me->id.
      result = ls_task.
      EXIT.
    ENDLOOP.

    " Nothing precedes the version by date. E070-AS4DATE is the header's last-changed
    " stamp, not the moment the object entered the task, so a long-lived task (typically
    " an R) can carry a date past its own versions and never win the comparison above.
    " Fall back to the newest candidate — the set already only holds tasks that contain
    " this object and, for a K/T, belong to this request.
    IF result IS INITIAL.
      LOOP AT lt_tasks INTO DATA(ls_fallback_task).
        CHECK ( lv_request_trfunction <> 'K' AND lv_request_trfunction <> 'T' )
           OR ls_fallback_task-strkorr = me->id.
        result = ls_fallback_task.
        EXIT.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
