CLASS zcl_vx_review_store DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    CLASS-METHODS has_review_table
      RETURNING
        VALUE(result) TYPE abap_bool.

    "! Does ZAVE_REVIEW carry the REMOTE key field? A table created before it
    "! existed does not, and a dynamic WHERE on a column that is not there
    "! raises CX_SY_DYNAMIC_OSQL_SEMANTICS — which the caller would read as
    "! "no review saved" and every stored review would vanish from view. So the
    "! field is asked for once and the statement is built accordingly.
    CLASS-METHODS has_remote_field
      RETURNING
        VALUE(result) TYPE abap_bool.

    "! One saved review per request AND per remote system. A review run with a
    "! remote system is a different review: its baseline is the state the other
    "! system already has, not the version before the request, so its diffs,
    "! its blocks and its approvals are not the ones of the plain review. They
    "! must not overwrite each other, hence REMOTE is part of the key.
    "! Empty REMOTE = the review without a remote comparison.
    CLASS-METHODS load_review_payload
      IMPORTING
        iv_trkorr     TYPE trkorr
        iv_remote     TYPE verssysnam OPTIONAL
      CHANGING
        cs_payload    TYPE any
      RETURNING
        VALUE(result) TYPE abap_bool.

    "! Drops the saved review of one request and remote system — what
    "! "Delete and recalc" starts with. Lives here for the same reason the read
    "! and the write do: the table name and the key are known to this class and
    "! to nothing else, so adding a key field is a change in one place.
    "! KEEP (moved): both statements used to sit as direct SQL in
    "! ZCL_AVE_ACR_WORKFLOW=>DELETE_AND_RECALC_SELECTED, and when REMOTE became
    "! part of the key only the repository was adjusted. They kept deleting by
    "! TRKORR alone, so a recalc inside the review compared against another
    "! system wiped the plain review as well — approvals, comments and save
    "! history. An assumption about where the table is touched is only worth
    "! anything when the architecture enforces it.
    CLASS-METHODS delete_review_payload
      IMPORTING
        iv_trkorr     TYPE trkorr
        iv_remote     TYPE verssysnam OPTIONAL
      RETURNING
        VALUE(result) TYPE abap_bool.

    CLASS-METHODS save_review_payload
      IMPORTING
        iv_trkorr     TYPE trkorr
        iv_remote     TYPE verssysnam OPTIONAL
        is_payload    TYPE any
      RETURNING
        VALUE(result) TYPE abap_bool.

  PRIVATE SECTION.
    CLASS-DATA gv_remote_field TYPE c LENGTH 1.
ENDCLASS.


CLASS zcl_vx_review_store IMPLEMENTATION.



  METHOD has_review_table.
    SELECT SINGLE tabname
      FROM dd02l
      WHERE tabname  = 'ZAVE_REVIEW'
        AND as4local = 'A'
        AND tabclass = 'TRANSP'
      INTO @DATA(lv_tabname).

    result = xsdbool( sy-subrc = 0 AND lv_tabname IS NOT INITIAL ).
  ENDMETHOD.


  METHOD has_remote_field.
    " Only the positive answer is cached. A field cannot disappear, but it can
    " very well APPEAR while AVE is running — extending the table is exactly
    " what the setup page asks for — and a remembered "no" would then keep
    " writing with the two-field key: the review with a remote system would
    " overwrite the one without, which is the row it was split from in the
    " first place. The read costs a buffered DD03L access.
    IF gv_remote_field = 'X'.
      result = abap_true.
      RETURN.
    ENDIF.

    SELECT SINGLE fieldname
      FROM dd03l
      WHERE tabname   = 'ZAVE_REVIEW'
        AND fieldname = 'REMOTE'
        AND as4local  = 'A'
      INTO @DATA(lv_field).
    result = xsdbool( sy-subrc = 0 AND lv_field IS NOT INITIAL ).
    IF result = abap_true.
      gv_remote_field = 'X'.
    ENDIF.
  ENDMETHOD.


  METHOD load_review_payload.
    CLEAR cs_payload.
    " The key is (TRKORR, REMOTE) and there is no second way of reading it.
    " KEEP (replaced): a table without the REMOTE column used to be read with
    "   SELECT ... WHERE trkorr = @iv_trkorr
    " as a compatibility fallback. Nobody asked for that fallback and it is
    " what destroyed data: the same row then answered — and was written by —
    " both the plain review and the one compared against another system.
    " Until the field exists there is no review to read; SHOW pops the setup
    " page for exactly that reason.
    CHECK has_remote_field( ) = abap_true.

    DATA lv_payload_json TYPE string.
    DATA lv_tabname TYPE tabname VALUE 'ZAVE_REVIEW'.

    TRY.
        SELECT SINGLE payload
          FROM (lv_tabname)
          WHERE trkorr = @iv_trkorr
            AND remote = @iv_remote
          INTO @lv_payload_json.
      CATCH cx_sy_dynamic_osql_semantics
            cx_sy_dynamic_osql_syntax
            cx_sy_open_sql_db.
        RETURN.
    ENDTRY.

    IF sy-subrc <> 0 OR lv_payload_json IS INITIAL.
      RETURN.
    ENDIF.

    TRY.
        /ui2/cl_json=>deserialize(
          EXPORTING json = lv_payload_json
          CHANGING  data = cs_payload ).
        result = abap_true.
      CATCH cx_root.
        CLEAR cs_payload.
    ENDTRY.
  ENDMETHOD.


  METHOD delete_review_payload.
    CHECK has_review_table( ) = abap_true.
    " Same rule as the read and the write: one key, no fallback. Deleting by
    " TRKORR alone would take every remote system's review with it.
    CHECK has_remote_field( ) = abap_true.

    DATA lv_tabname TYPE tabname VALUE 'ZAVE_REVIEW'.
    TRY.
        DELETE FROM (lv_tabname)
          WHERE trkorr = @iv_trkorr
            AND remote = @iv_remote.
        result = xsdbool( sy-subrc = 0 ).
      CATCH cx_sy_dynamic_osql_semantics
            cx_sy_dynamic_osql_syntax
            cx_sy_open_sql_db.
        CLEAR result.
    ENDTRY.
  ENDMETHOD.


  METHOD save_review_payload.
    DATA lv_tabname TYPE tabname VALUE 'ZAVE_REVIEW'.
    DATA lr_review_db TYPE REF TO data.
    DATA(lv_payload_json) = /ui2/cl_json=>serialize( data = is_payload ).

    " Same rule as on the read: one key, no fallback. `UPDATE … WHERE trkorr`
    " alone matches the row of EVERY remote system for that request, so the
    " review compared against ER4 overwrites the plain one or the other way
    " round, depending on which ran last. The save is refused instead, and the
    " caller says so.
    IF has_remote_field( ) = abap_false.
      RETURN.
    ENDIF.

    TRY.
        UPDATE (lv_tabname)
          SET payload = @lv_payload_json
          WHERE trkorr = @iv_trkorr
            AND remote = @iv_remote.
        IF sy-subrc <> 0.
          CREATE DATA lr_review_db TYPE (lv_tabname).
          ASSIGN lr_review_db->* TO FIELD-SYMBOL(<ls_review_db>).
          IF <ls_review_db> IS ASSIGNED.
            ASSIGN COMPONENT 'TRKORR' OF STRUCTURE <ls_review_db> TO FIELD-SYMBOL(<lv_trkorr>).
            ASSIGN COMPONENT 'PAYLOAD' OF STRUCTURE <ls_review_db> TO FIELD-SYMBOL(<lv_payload>).
            ASSIGN COMPONENT 'REMOTE' OF STRUCTURE <ls_review_db> TO FIELD-SYMBOL(<lv_remote>).
            IF <lv_remote> IS ASSIGNED.
              <lv_remote> = iv_remote.
            ELSE.
              sy-subrc = 4.   " the guard above says the field is there
            ENDIF.
            IF sy-subrc = 0 AND <lv_trkorr> IS ASSIGNED AND <lv_payload> IS ASSIGNED.
              <lv_trkorr> = iv_trkorr.
              <lv_payload> = lv_payload_json.
              INSERT (lv_tabname) FROM @<ls_review_db>.
            ELSE.
              sy-subrc = 4.
            ENDIF.
          ELSE.
            sy-subrc = 4.
          ENDIF.
        ENDIF.
      CATCH cx_sy_create_data_error
            cx_sy_dynamic_osql_semantics
            cx_sy_dynamic_osql_syntax
            cx_sy_open_sql_db.
        sy-subrc = 4.
    ENDTRY.

    result = xsdbool( sy-subrc = 0 ).
  ENDMETHOD.

ENDCLASS.
