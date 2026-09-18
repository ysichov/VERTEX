CLASS zcl_vx_review_state DEFINITION
  PUBLIC
  FINAL
  CREATE PRIVATE.

  PUBLIC SECTION.
    CLASS-METHODS format_timestamp
      IMPORTING
        !iv_timestamp   TYPE timestampl
      RETURNING
        VALUE(result)   TYPE string.

    CLASS-METHODS set_hunk_action
      IMPORTING
        !iv_hunk_key     TYPE string
        !iv_action       TYPE zif_vx_review_types=>ty_action_code
      CHANGING
        !ct_hunk_actions TYPE zif_vx_review_types=>ty_t_hunk_actions.

    CLASS-METHODS clear_hunk_action
      IMPORTING
        !iv_hunk_key     TYPE string
      CHANGING
        !ct_hunk_actions TYPE zif_vx_review_types=>ty_t_hunk_actions.

    CLASS-METHODS get_hunk_global_action
      IMPORTING
        !iv_hunk_key     TYPE string
        !it_hunk_actions TYPE zif_vx_review_types=>ty_t_hunk_actions
      RETURNING
        VALUE(result)    TYPE zif_vx_review_types=>ty_action_code.

    CLASS-METHODS sanitize_review_state
      IMPORTING
        !it_hunk_info    TYPE zif_vx_review_types=>ty_t_hunk_info
      CHANGING
        !ct_approved     TYPE zif_vx_review_types=>ty_approved
        !ct_declined     TYPE zif_vx_review_types=>ty_approved
        !ct_hunk_actions TYPE zif_vx_review_types=>ty_t_hunk_actions.

    "! Carries approvals, declines, notes and comment threads of ONE object from
    "! its old block numbering to the new one, after that object was recomputed.
    "!
    "! Every piece of review state is keyed `<TYPE>~<NAME>~<n>`, and n is the
    "! position of the block in the object. Any change to how blocks are cut
    "! renumbers them — merging two blocks that share one ABAP statement is
    "! enough — and SANITIZE_REVIEW_STATE then deletes every key that no longer
    "! exists, the silent save writes the loss out, and the work of a review is
    "! gone. This runs first, so SANITIZE finds nothing left to drop.
    "!
    "! Blocks are matched by START_LINE, which is what an old payload carries:
    "! a new block inherits from every old block that started inside it (the
    "! last new block starting at or before the old one). Approvals and declines
    "! are carried only when ALL of those old blocks agreed — a block that grew
    "! must not read as approved because half of it was. Comment threads are
    "! always carried and their messages merged: a comment is somebody's words,
    "! never dropped to keep a number tidy.
    CLASS-METHODS remap_review_state
      IMPORTING
        !it_old_hunks     TYPE zif_vx_review_types=>ty_t_hunk_info
        !it_new_hunks     TYPE zif_vx_review_types=>ty_t_hunk_info
      CHANGING
        !ct_approved      TYPE zif_vx_review_types=>ty_approved
        !ct_declined      TYPE zif_vx_review_types=>ty_approved
        !ct_hunk_actions  TYPE zif_vx_review_types=>ty_t_hunk_actions
        !ct_decline_notes TYPE zif_vx_review_types=>ty_t_decline_notes
        !ct_hunk_threads  TYPE zif_vx_review_types=>ty_t_hunk_threads.

    "! What one reviewer does to one block: approve it, decline it with a note,
    "! leave a comment, or take a verdict back. The whole change to the review
    "! state, in one place, so that a second front end makes the same change
    "! rather than its own version of it.
    "!
    "! IV_ACTION: 'A' approve, 'D' decline, 'C' comment, 'U' take back.
    "! A decline and a comment both carry words, and both file them as this
    "! reviewer's note on the block: the note is the last thing they wrote
    "! there, whichever way they wrote it.
    "!
    "! IS_HUNK is needed only when words are written on a block nobody has
    "! written on yet: that starts a thread, and a thread keeps what the block
    "! is — down to the rendered html, which a caller that has it passes and a
    "! caller that does not leaves empty. Approving needs none of it.
    "!
    "! Whether the reviewer MAY do this is not decided here — see IS_OWN_HUNK,
    "! which each caller asks and answers in its own way.
    CLASS-METHODS apply_reviewer_action
      IMPORTING
        !iv_hunk_key      TYPE string
        !iv_action        TYPE zif_vx_review_types=>ty_action_code
        !is_hunk          TYPE zif_vx_review_types=>ty_hunk_info OPTIONAL
        !iv_note          TYPE string DEFAULT ``
        "! Replace this reviewer's last message on the block instead of adding
        "! one — what Edit Review does.
        !iv_edit_own      TYPE abap_bool DEFAULT abap_false
      CHANGING
        !ct_approved      TYPE zif_vx_review_types=>ty_approved
        !ct_declined      TYPE zif_vx_review_types=>ty_approved
        !ct_decline_notes TYPE zif_vx_review_types=>ty_t_decline_notes
        !ct_hunk_actions  TYPE zif_vx_review_types=>ty_t_hunk_actions
        !ct_hunk_threads  TYPE zif_vx_review_types=>ty_t_hunk_threads.

    CLASS-METHODS is_own_hunk
      IMPORTING
        !iv_hunk_key   TYPE string
        !it_hunk_info  TYPE zif_vx_review_types=>ty_t_hunk_info
      RETURNING
        VALUE(result)  TYPE abap_bool.

    CLASS-METHODS get_last_own_comment
      IMPORTING
        !iv_hunk_key      TYPE string
        !it_hunk_threads  TYPE zif_vx_review_types=>ty_t_hunk_threads
      RETURNING
        VALUE(result)     TYPE string.

    CLASS-METHODS get_reviewer_stats
      IMPORTING
        is_payload      TYPE zif_vx_review_types=>ty_saved_payload
        it_hunk_info    TYPE zif_vx_review_types=>ty_t_hunk_info
        it_approved     TYPE zif_vx_review_types=>ty_approved
        it_declined     TYPE zif_vx_review_types=>ty_approved
        it_hunk_threads TYPE zif_vx_review_types=>ty_t_hunk_threads
      RETURNING
        VALUE(result)   TYPE zif_vx_review_types=>ty_t_reviewer_stats.

    CLASS-METHODS apply_saved_payload
      IMPORTING
        is_payload       TYPE zif_vx_review_types=>ty_saved_payload
        "! Mirrors the "Ignore SAP generated" setting. With it off, a review that
        "! contains generated classes must keep them instead of purging them.
        iv_ignore_generated TYPE abap_bool DEFAULT abap_true
      CHANGING
        ct_obj_stats     TYPE zif_vx_review_types=>ty_t_obj_stats
        ct_hunk_info     TYPE zif_vx_review_types=>ty_t_hunk_info
        ct_diff_cache    TYPE zif_vx_review_types=>ty_t_diff_cache
        ct_diff_data     TYPE zif_vx_review_types=>ty_t_diff_data
        ct_approved      TYPE zif_vx_review_types=>ty_approved
        ct_declined      TYPE zif_vx_review_types=>ty_approved
        ct_decline_notes TYPE zif_vx_review_types=>ty_t_decline_notes
        ct_hunk_threads  TYPE zif_vx_review_types=>ty_t_hunk_threads
        ct_hunk_actions  TYPE zif_vx_review_types=>ty_t_hunk_actions
        "! Measured precompute durations; kept so the metrics of a saved review
        "! show real numbers instead of model estimates.
        ct_timings       TYPE zif_vx_review_types=>ty_t_part_timings OPTIONAL.

    CLASS-METHODS collect_report_status
      IMPORTING
        is_payload    TYPE zif_vx_review_types=>ty_saved_payload
        it_hunk_info  TYPE zif_vx_review_types=>ty_t_hunk_info
        it_approved   TYPE zif_vx_review_types=>ty_approved
        it_declined   TYPE zif_vx_review_types=>ty_approved
      EXPORTING
        et_approved   TYPE zif_vx_review_types=>ty_approved
        et_declined   TYPE zif_vx_review_types=>ty_approved.

    CLASS-METHODS build_save_payload
      IMPORTING
        is_existing_payload TYPE zif_vx_review_types=>ty_saved_payload
        iv_trkorr           TYPE trkorr
        it_obj_stats        TYPE zif_vx_review_types=>ty_t_obj_stats
        it_hunk_info        TYPE zif_vx_review_types=>ty_t_hunk_info
        it_diff_cache       TYPE zif_vx_review_types=>ty_t_diff_cache
        it_diff_data        TYPE zif_vx_review_types=>ty_t_diff_data
        it_hunk_actions     TYPE zif_vx_review_types=>ty_t_hunk_actions
        it_approved         TYPE zif_vx_review_types=>ty_approved
        it_declined         TYPE zif_vx_review_types=>ty_approved
        it_decline_notes    TYPE zif_vx_review_types=>ty_t_decline_notes
        it_hunk_threads     TYPE zif_vx_review_types=>ty_t_hunk_threads
        "! Measurements of this run; merged into the stored ones per part key.
        it_timings          TYPE zif_vx_review_types=>ty_t_part_timings OPTIONAL
      RETURNING
        VALUE(result)       TYPE zif_vx_review_types=>ty_saved_payload.

  PRIVATE SECTION.
    "! Drops everything an earlier run stored for generated Gateway model classes
    "! (see ZCL_VX_REVIEW_PREPARE=>IS_GENERATED_CLASS), so a review saved before the
    "! exclusion existed stops showing them without a full recalculation.
    CLASS-METHODS drop_generated_classes
      CHANGING
        ct_obj_stats TYPE zif_vx_review_types=>ty_t_obj_stats
        ct_hunk_info TYPE zif_vx_review_types=>ty_t_hunk_info
        ct_diff_data TYPE zif_vx_review_types=>ty_t_diff_data.

ENDCLASS.


CLASS zcl_vx_review_state IMPLEMENTATION.

  METHOD format_timestamp.
    CHECK iv_timestamp IS NOT INITIAL.
    DATA lv_date TYPE d.
    DATA lv_time TYPE t.
    CONVERT TIME STAMP iv_timestamp TIME ZONE sy-zonlo
      INTO DATE lv_date TIME lv_time.
    result = |{ lv_date+6(2) }.{ lv_date+4(2) }.{ lv_date+2(2) } { lv_time(5) }|.
  ENDMETHOD.


  METHOD set_hunk_action.
    DATA lv_ts TYPE timestampl.
    GET TIME STAMP FIELD lv_ts.
    DELETE ct_hunk_actions WHERE hunk_key = iv_hunk_key AND reviewer = sy-uname.
    APPEND VALUE zif_vx_review_types=>ty_hunk_action(
      hunk_key      = iv_hunk_key
      reviewer      = sy-uname
      reviewer_name = zcl_vx_vers_data=>get_user_name( sy-uname )
      action        = iv_action
      changed_at    = lv_ts ) TO ct_hunk_actions.
  ENDMETHOD.


  METHOD clear_hunk_action.
    DELETE ct_hunk_actions WHERE hunk_key = iv_hunk_key AND reviewer = sy-uname.
  ENDMETHOD.


  METHOD get_hunk_global_action.
    DATA ls_action TYPE zif_vx_review_types=>ty_hunk_action.
    LOOP AT it_hunk_actions INTO DATA(ls_action_cur)
      WHERE hunk_key = iv_hunk_key.
      IF ls_action IS INITIAL OR ls_action_cur-changed_at > ls_action-changed_at.
        ls_action = ls_action_cur.
      ENDIF.
    ENDLOOP.
    result = ls_action-action.
  ENDMETHOD.


  METHOD remap_review_state.
    CHECK it_old_hunks IS NOT INITIAL.
    CHECK it_new_hunks IS NOT INITIAL.

    TYPES: BEGIN OF ty_map,
             old_key TYPE string,
             new_key TYPE string,
           END OF ty_map.
    DATA lt_map TYPE STANDARD TABLE OF ty_map WITH DEFAULT KEY.
    DATA lt_old_keys TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.
    DATA lv_changed TYPE abap_bool.

    " ── Which new block does each old block belong to now ────────────────────
    LOOP AT it_old_hunks INTO DATA(ls_old).
      " A moving violation carries no review state — it cannot be approved.
      CHECK ls_old-retrofit IS INITIAL.
      INSERT ls_old-hunk_key INTO TABLE lt_old_keys.

      DATA lv_best_key  TYPE string.
      DATA lv_best_line TYPE i.
      CLEAR: lv_best_key, lv_best_line.
      LOOP AT it_new_hunks INTO DATA(ls_new).
        CHECK ls_new-retrofit IS INITIAL.
        CHECK ls_new-objtype  = ls_old-objtype.
        CHECK ls_new-obj_name = ls_old-obj_name.
        IF ls_new-start_line <= ls_old-start_line
           AND ( lv_best_key IS INITIAL OR ls_new-start_line > lv_best_line ).
          lv_best_line = ls_new-start_line.
          lv_best_key  = ls_new-hunk_key.
        ENDIF.
      ENDLOOP.

      " Nothing starts at or before it — the source shrank above this block.
      " Fall back to the first block of the object rather than lose the state.
      IF lv_best_key IS INITIAL.
        CLEAR lv_best_line.
        LOOP AT it_new_hunks INTO ls_new.
          CHECK ls_new-retrofit IS INITIAL.
          CHECK ls_new-objtype  = ls_old-objtype.
          CHECK ls_new-obj_name = ls_old-obj_name.
          IF lv_best_key IS INITIAL OR ls_new-start_line < lv_best_line.
            lv_best_line = ls_new-start_line.
            lv_best_key  = ls_new-hunk_key.
          ENDIF.
        ENDLOOP.
      ENDIF.
      CHECK lv_best_key IS NOT INITIAL.

      APPEND VALUE ty_map( old_key = ls_old-hunk_key new_key = lv_best_key ) TO lt_map.
      IF lv_best_key <> ls_old-hunk_key.
        lv_changed = abap_true.
      ENDIF.
    ENDLOOP.

    " Numbering unchanged — nothing to move, and nothing to risk.
    CHECK lv_changed = abap_true.

    " ── Approvals and declines: only a unanimous group carries over ──────────
    DATA lt_new_keys TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.
    LOOP AT lt_map INTO DATA(ls_map).
      INSERT ls_map-new_key INTO TABLE lt_new_keys.
    ENDLOOP.

    LOOP AT lt_new_keys INTO DATA(lv_new_key).
      DATA lv_all_appr TYPE abap_bool.
      DATA lv_all_decl TYPE abap_bool.
      DATA lv_group    TYPE i.
      lv_all_appr = abap_true.
      lv_all_decl = abap_true.
      CLEAR lv_group.
      LOOP AT lt_map INTO ls_map WHERE new_key = lv_new_key.
        lv_group = lv_group + 1.
        IF NOT line_exists( ct_approved[ table_line = ls_map-old_key ] ).
          lv_all_appr = abap_false.
        ENDIF.
        IF NOT line_exists( ct_declined[ table_line = ls_map-old_key ] ).
          lv_all_decl = abap_false.
        ENDIF.
      ENDLOOP.
      CHECK lv_group > 0.

      IF lv_all_appr = abap_true.
        INSERT lv_new_key INTO TABLE ct_approved.
      ENDIF.
      IF lv_all_decl = abap_true AND lv_all_appr = abap_false.
        INSERT lv_new_key INTO TABLE ct_declined.
      ENDIF.
    ENDLOOP.

    " The old keys go, whatever they were — SANITIZE would delete them anyway,
    " and leaving them would double-count the object in the report.
    LOOP AT lt_old_keys INTO DATA(lv_old_key).
      IF NOT line_exists( lt_new_keys[ table_line = lv_old_key ] ).
        DELETE TABLE ct_approved FROM lv_old_key.
        DELETE TABLE ct_declined FROM lv_old_key.
      ENDIF.
    ENDLOOP.

    " ── Action log: the newest action of the group wins its block ────────────
    DATA lt_actions_new TYPE zif_vx_review_types=>ty_t_hunk_actions.
    LOOP AT ct_hunk_actions INTO DATA(ls_action).
      CHECK line_exists( lt_old_keys[ table_line = ls_action-hunk_key ] ).
      READ TABLE lt_map INTO ls_map WITH KEY old_key = ls_action-hunk_key.
      CHECK sy-subrc = 0.
      ls_action-hunk_key = ls_map-new_key.
      READ TABLE lt_actions_new ASSIGNING FIELD-SYMBOL(<act>)
        WITH KEY hunk_key = ls_action-hunk_key reviewer = ls_action-reviewer.
      IF sy-subrc = 0.
        IF ls_action-changed_at > <act>-changed_at.
          <act> = ls_action.
        ENDIF.
      ELSE.
        APPEND ls_action TO lt_actions_new.
      ENDIF.
    ENDLOOP.
    LOOP AT lt_old_keys INTO lv_old_key.
      DELETE ct_hunk_actions WHERE hunk_key = lv_old_key.
    ENDLOOP.
    APPEND LINES OF lt_actions_new TO ct_hunk_actions.

    " ── Decline notes ────────────────────────────────────────────────────────
    DATA lt_notes_new TYPE zif_vx_review_types=>ty_t_decline_notes.
    LOOP AT ct_decline_notes INTO DATA(ls_note).
      CHECK line_exists( lt_old_keys[ table_line = ls_note-hunk_key ] ).
      READ TABLE lt_map INTO ls_map WITH KEY old_key = ls_note-hunk_key.
      CHECK sy-subrc = 0.
      ls_note-hunk_key = ls_map-new_key.
      " Two notes landing on one block: the first one keeps the place, the
      " second is appended rather than thrown away.
      READ TABLE lt_notes_new ASSIGNING FIELD-SYMBOL(<note>)
        WITH TABLE KEY hunk_key = ls_note-hunk_key.
      IF sy-subrc = 0.
        <note>-note = <note>-note && cl_abap_char_utilities=>newline && ls_note-note.
      ELSE.
        INSERT ls_note INTO TABLE lt_notes_new.
      ENDIF.
    ENDLOOP.
    LOOP AT lt_old_keys INTO lv_old_key.
      DELETE TABLE ct_decline_notes WITH TABLE KEY hunk_key = lv_old_key.
    ENDLOOP.
    LOOP AT lt_notes_new INTO ls_note.
      DELETE TABLE ct_decline_notes WITH TABLE KEY hunk_key = ls_note-hunk_key.
      INSERT ls_note INTO TABLE ct_decline_notes.
    ENDLOOP.

    " ── Comment threads: never lost, merged when two land on one block ───────
    DATA lt_threads_new TYPE zif_vx_review_types=>ty_t_hunk_threads.
    LOOP AT ct_hunk_threads INTO DATA(ls_thread).
      CHECK line_exists( lt_old_keys[ table_line = ls_thread-hunk_key ] ).
      READ TABLE lt_map INTO ls_map WITH KEY old_key = ls_thread-hunk_key.
      CHECK sy-subrc = 0.
      ls_thread-hunk_key = ls_map-new_key.
      READ TABLE it_new_hunks INTO DATA(ls_new_h) WITH TABLE KEY hunk_key = ls_map-new_key.
      IF sy-subrc = 0.
        ls_thread-hunk_no      = ls_new_h-hunk_no.
        ls_thread-start_line   = ls_new_h-start_line.
        ls_thread-change_count = ls_new_h-change_count.
        ls_thread-change_kind  = ls_new_h-change_kind.
      ENDIF.
      READ TABLE lt_threads_new ASSIGNING FIELD-SYMBOL(<thread>)
        WITH TABLE KEY hunk_key = ls_thread-hunk_key.
      IF sy-subrc = 0.
        APPEND LINES OF ls_thread-messages TO <thread>-messages.
        SORT <thread>-messages BY created_at ASCENDING.
      ELSE.
        INSERT ls_thread INTO TABLE lt_threads_new.
      ENDIF.
    ENDLOOP.
    LOOP AT lt_old_keys INTO lv_old_key.
      DELETE TABLE ct_hunk_threads WITH TABLE KEY hunk_key = lv_old_key.
    ENDLOOP.
    LOOP AT lt_threads_new INTO ls_thread.
      DELETE TABLE ct_hunk_threads WITH TABLE KEY hunk_key = ls_thread-hunk_key.
      INSERT ls_thread INTO TABLE ct_hunk_threads.
    ENDLOOP.
  ENDMETHOD.


  METHOD sanitize_review_state.
    CHECK it_hunk_info IS NOT INITIAL.

    LOOP AT ct_approved INTO DATA(lv_approved_key).
      IF NOT line_exists( it_hunk_info[ hunk_key = lv_approved_key ] ).
        DELETE TABLE ct_approved FROM lv_approved_key.
      ENDIF.
    ENDLOOP.

    LOOP AT ct_declined INTO DATA(lv_declined_key).
      IF NOT line_exists( it_hunk_info[ hunk_key = lv_declined_key ] ).
        DELETE TABLE ct_declined FROM lv_declined_key.
      ELSEIF line_exists( ct_approved[ table_line = lv_declined_key ] ).
        DELETE TABLE ct_declined FROM lv_declined_key.
      ENDIF.
    ENDLOOP.

    LOOP AT ct_hunk_actions INTO DATA(ls_action_key).
      IF NOT line_exists( it_hunk_info[ hunk_key = ls_action_key-hunk_key ] ).
        DELETE ct_hunk_actions WHERE hunk_key = ls_action_key-hunk_key.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD apply_reviewer_action.
    DATA(lv_key) = iv_hunk_key.

    IF iv_action = 'U'.
      " Taking a verdict back removes the note with it: the note explains a
      " decline, and there is no longer one to explain.
      DELETE TABLE ct_approved FROM lv_key.
      DELETE TABLE ct_declined FROM lv_key.
      DELETE TABLE ct_decline_notes WITH TABLE KEY hunk_key = lv_key.
      clear_hunk_action( EXPORTING iv_hunk_key     = lv_key
                         CHANGING  ct_hunk_actions = ct_hunk_actions ).
      RETURN.
    ENDIF.

    IF iv_action = 'A'.
      INSERT lv_key INTO TABLE ct_approved.
      DELETE TABLE ct_declined FROM lv_key.
      set_hunk_action( EXPORTING iv_hunk_key     = lv_key
                                 iv_action       = 'A'
                       CHANGING  ct_hunk_actions = ct_hunk_actions ).
      RETURN.
    ENDIF.

    " What is left carries words: a decline, or a comment on its own.
    DATA(lv_is_decline) = xsdbool( iv_action = 'D' ).

    DATA ls_note TYPE zif_vx_review_types=>ty_decline_note.
    ls_note-hunk_key = lv_key.
    ls_note-note     = iv_note.
    INSERT ls_note INTO TABLE ct_decline_notes.
    IF sy-subrc <> 0.
      MODIFY TABLE ct_decline_notes FROM ls_note.
    ENDIF.

    IF lv_is_decline = abap_true.
      INSERT lv_key INTO TABLE ct_declined.
      DELETE TABLE ct_approved FROM lv_key.
      set_hunk_action( EXPORTING iv_hunk_key     = lv_key
                                 iv_action       = 'D'
                       CHANGING  ct_hunk_actions = ct_hunk_actions ).
    ENDIF.

    READ TABLE ct_hunk_threads ASSIGNING FIELD-SYMBOL(<thread>)
      WITH TABLE KEY hunk_key = lv_key.
    IF sy-subrc <> 0.
      " A block nobody has written on yet has no thread. Starting one needs to
      " know what the block is, which is why it is passed in rather than looked
      " up: the caller holds the hunk list, this does not.
      IF is_hunk IS INITIAL.
        RETURN.
      ENDIF.
      INSERT VALUE zif_vx_review_types=>ty_hunk_thread(
        hunk_key        = lv_key
        objtype         = is_hunk-objtype
        obj_name        = is_hunk-obj_name
        class_name      = is_hunk-class_name
        display_name    = is_hunk-display_name
        hunk_no         = is_hunk-hunk_no
        start_line      = is_hunk-start_line
        change_count    = is_hunk-change_count
        change_kind     = is_hunk-change_kind
        versno_new      = is_hunk-versno_new
        versno_old      = is_hunk-versno_old
        versno_new_text = is_hunk-versno_new_text
        versno_old_text = is_hunk-versno_old_text
        html            = is_hunk-html ) INTO TABLE ct_hunk_threads.
      READ TABLE ct_hunk_threads ASSIGNING <thread>
        WITH TABLE KEY hunk_key = lv_key.
      IF sy-subrc <> 0.
        RETURN.
      ENDIF.
    ENDIF.

    DATA lv_msg_ts TYPE timestampl.
    GET TIME STAMP FIELD lv_msg_ts.

    IF iv_edit_own = abap_true.
      DATA(lv_idx) = lines( <thread>-messages ).
      WHILE lv_idx > 0.
        READ TABLE <thread>-messages ASSIGNING FIELD-SYMBOL(<message>) INDEX lv_idx.
        IF sy-subrc = 0 AND <message>-author = sy-uname.
          <message>-text       = iv_note.
          <message>-created_at = lv_msg_ts.
          RETURN.
        ENDIF.
        lv_idx = lv_idx - 1.
      ENDWHILE.
    ENDIF.

    " Saying the same thing twice in a row is a double click, not a second
    " comment.
    READ TABLE <thread>-messages INTO DATA(ls_last)
      INDEX lines( <thread>-messages ).
    IF sy-subrc = 0
       AND ls_last-author     = sy-uname
       AND ls_last-is_decline = lv_is_decline
       AND ls_last-text       = iv_note.
      RETURN.
    ENDIF.

    APPEND VALUE zif_vx_review_types=>ty_decline_msg(
      author      = sy-uname
      author_name = zcl_vx_vers_data=>get_user_name( sy-uname )
      created_at  = lv_msg_ts
      is_decline  = lv_is_decline
      text        = iv_note ) TO <thread>-messages.
  ENDMETHOD.


  METHOD is_own_hunk.
    " The author of a hunk is always known: ZCL_VX_REVIEW_HUNK_INFO=>COLLECT takes
    " it from the blame map and falls back to the version owner, so it is never
    " left empty, and it is stored with the hunk.
    "
    " Keep-note (do not restore): there used to be a second branch here that,
    " for an empty author, searched for the user name inside the hunk's HTML —
    "   ELSEIF ls_hunk-author IS INITIAL AND ls_hunk-html CS sy-uname.
    " It matched any occurrence, including a name in a code comment or in a
    " blame header, and could therefore lock a reviewer out of a block that was
    " not his. It also depended on the html being present in MT_HUNK_INFO, which
    " it no longer is — hunk html is rendered only for what gets displayed.
    result = abap_false.
    READ TABLE it_hunk_info INTO DATA(ls_hunk)
      WITH TABLE KEY hunk_key = iv_hunk_key.
    IF sy-subrc = 0 AND ls_hunk-author = sy-uname AND sy-uname <> 'DEVELOPER'.
      result = abap_true.
    ENDIF.
  ENDMETHOD.


  METHOD get_last_own_comment.
    READ TABLE it_hunk_threads INTO DATA(ls_thread)
      WITH TABLE KEY hunk_key = iv_hunk_key.
    CHECK sy-subrc = 0.

    DATA(lv_idx) = lines( ls_thread-messages ).
    WHILE lv_idx > 0.
      READ TABLE ls_thread-messages INTO DATA(ls_msg) INDEX lv_idx.
      IF sy-subrc = 0
         AND ls_msg-author = sy-uname
         AND ls_msg-text IS NOT INITIAL.
        result = ls_msg-text.
        RETURN.
      ENDIF.
      lv_idx = lv_idx - 1.
    ENDWHILE.
  ENDMETHOD.


  METHOD get_reviewer_stats.
    LOOP AT is_payload-user_states INTO DATA(ls_user_state).
      DATA lv_appr_saved TYPE i.
      DATA lv_decl_saved TYPE i.
      CLEAR: lv_appr_saved, lv_decl_saved.
      LOOP AT ls_user_state-approved INTO DATA(ls_saved_appr_key).
        IF it_hunk_info IS INITIAL
           OR line_exists( it_hunk_info[ hunk_key = ls_saved_appr_key-hunk_key ] ).
          lv_appr_saved = lv_appr_saved + 1.
        ENDIF.
      ENDLOOP.
      LOOP AT ls_user_state-declined INTO DATA(ls_saved_decl_key).
        IF it_hunk_info IS INITIAL
           OR line_exists( it_hunk_info[ hunk_key = ls_saved_decl_key-hunk_key ] ).
          lv_decl_saved = lv_decl_saved + 1.
        ENDIF.
      ENDLOOP.
      CHECK lv_appr_saved > 0 OR lv_decl_saved > 0.
      APPEND VALUE zif_vx_review_types=>ty_reviewer_stats(
        reviewer      = ls_user_state-reviewer
        reviewer_name = ls_user_state-reviewer_name
        appr_count    = lv_appr_saved
        decl_count    = lv_decl_saved
        total_count   = lv_appr_saved + lv_decl_saved
        saved_at      = ls_user_state-saved_at ) TO result.
    ENDLOOP.

    DATA(lv_appr_cur) = lines( it_approved ).
    DATA(lv_decl_cur) = lines( it_declined ).
    IF lv_appr_cur > 0 OR lv_decl_cur > 0.
      READ TABLE result ASSIGNING FIELD-SYMBOL(<rev>)
        WITH KEY reviewer = sy-uname.
      IF sy-subrc <> 0.
        APPEND VALUE zif_vx_review_types=>ty_reviewer_stats(
          reviewer      = sy-uname
          reviewer_name = zcl_vx_vers_data=>get_user_name( sy-uname ) ) TO result.
        READ TABLE result ASSIGNING <rev> WITH KEY reviewer = sy-uname.
      ENDIF.
      <rev>-appr_count = lv_appr_cur.
      <rev>-decl_count = lv_decl_cur.
      <rev>-total_count = lv_appr_cur + lv_decl_cur.
    ENDIF.

    LOOP AT it_hunk_threads INTO DATA(ls_thread_cur).
      READ TABLE it_hunk_info INTO DATA(ls_hunk_cur)
        WITH TABLE KEY hunk_key = ls_thread_cur-hunk_key.
      LOOP AT ls_thread_cur-messages INTO DATA(ls_msg_cur).
        CHECK ls_msg_cur-author IS NOT INITIAL.
        IF sy-subrc = 0 AND ls_hunk_cur-author = ls_msg_cur-author.
          CONTINUE.
        ENDIF.
        READ TABLE result ASSIGNING <rev>
          WITH KEY reviewer = ls_msg_cur-author.
        IF sy-subrc <> 0.
          APPEND VALUE zif_vx_review_types=>ty_reviewer_stats(
            reviewer      = ls_msg_cur-author
            reviewer_name = ls_msg_cur-author_name ) TO result.
          READ TABLE result ASSIGNING <rev> WITH KEY reviewer = ls_msg_cur-author.
        ENDIF.
        IF <rev>-total_count = 0.
          <rev>-total_count = 1.
        ENDIF.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.


  METHOD apply_saved_payload.
    CLEAR: ct_approved, ct_declined, ct_decline_notes, ct_hunk_threads, ct_hunk_actions.

    " Merge, never overwrite: PREPARE_CODE_REVIEW reloads the payload right after
    " its loop, and a plain assignment would throw away the measurements the run
    " has just produced in favour of the older ones still stored in the DB.
    IF ct_timings IS SUPPLIED.
      LOOP AT is_payload-timings INTO DATA(ls_saved_timing).
        CHECK NOT line_exists( ct_timings[ part_key = ls_saved_timing-part_key
                                           blame    = ls_saved_timing-blame ] ).
        APPEND ls_saved_timing TO ct_timings.
      ENDLOOP.
    ENDIF.

    IF ct_obj_stats IS INITIAL AND is_payload-obj_stats IS NOT INITIAL.
      ct_obj_stats = is_payload-obj_stats.
    ENDIF.
    IF ct_hunk_info IS INITIAL AND is_payload-hunks IS NOT INITIAL.
      ct_hunk_info = is_payload-hunks.
    ENDIF.
    IF ct_diff_data IS INITIAL AND is_payload-diff_data IS NOT INITIAL.
      ct_diff_data = is_payload-diff_data.
    ENDIF.
    IF iv_ignore_generated = abap_true.
      drop_generated_classes(
        CHANGING
          ct_obj_stats = ct_obj_stats
          ct_hunk_info = ct_hunk_info
          ct_diff_data = ct_diff_data ).
    ENDIF.

    CLEAR ct_diff_cache.

    " Hunk html is deliberately NOT rebuilt here. It is not stored either (see
    " BUILD_SAVE_PAYLOAD), so loading a review used to re-render the diff of every
    " object in it — hundreds of full renders before a single one was displayed.
    " The page renders what is shown, when it is shown, with the settings in
    " force at that moment.
    ct_hunk_actions = is_payload-hunk_actions.

    LOOP AT is_payload-threads INTO DATA(ls_saved_thread).
      DATA(ls_thread) = VALUE zif_vx_review_types=>ty_hunk_thread(
        hunk_key     = ls_saved_thread-hunk_key
        objtype      = ls_saved_thread-objtype
        obj_name     = ls_saved_thread-obj_name
        class_name   = ls_saved_thread-class_name
        display_name = ls_saved_thread-display_name
        hunk_no      = ls_saved_thread-hunk_no
        start_line   = ls_saved_thread-start_line
        change_count = ls_saved_thread-change_count
        change_kind  = ls_saved_thread-change_kind
        html         = ls_saved_thread-html
        messages     = ls_saved_thread-messages ).
      READ TABLE ct_hunk_info INTO DATA(ls_hunk_info_cur)
        WITH TABLE KEY hunk_key = ls_saved_thread-hunk_key.
      IF sy-subrc = 0.
        ls_thread-objtype      = ls_hunk_info_cur-objtype.
        ls_thread-obj_name     = ls_hunk_info_cur-obj_name.
        ls_thread-class_name   = ls_hunk_info_cur-class_name.
        ls_thread-display_name = ls_hunk_info_cur-display_name.
        ls_thread-hunk_no      = ls_hunk_info_cur-hunk_no.
        ls_thread-start_line   = ls_hunk_info_cur-start_line.
        ls_thread-change_count = ls_hunk_info_cur-change_count.
        ls_thread-change_kind  = ls_hunk_info_cur-change_kind.
        ls_thread-versno_new   = ls_hunk_info_cur-versno_new.
        ls_thread-versno_old   = ls_hunk_info_cur-versno_old.
        ls_thread-versno_new_text = ls_hunk_info_cur-versno_new_text.
        ls_thread-versno_old_text = ls_hunk_info_cur-versno_old_text.
        ls_thread-html         = ls_hunk_info_cur-html.
      ENDIF.
      IF NOT line_exists( ct_hunk_info[ hunk_key = ls_saved_thread-hunk_key ] )
         AND ls_saved_thread-hunk_key NP 'AI_SUMMARY~*'.
        INSERT VALUE zif_vx_review_types=>ty_hunk_info(
          hunk_key     = ls_saved_thread-hunk_key
          objtype      = ls_saved_thread-objtype
          obj_name     = ls_saved_thread-obj_name
          class_name   = ls_saved_thread-class_name
          display_name = ls_saved_thread-display_name
          hunk_no      = ls_saved_thread-hunk_no
          start_line   = ls_saved_thread-start_line
          change_count = ls_saved_thread-change_count
          change_kind  = ls_saved_thread-change_kind
          author       = ls_saved_thread-author
          author_name  = ls_saved_thread-author_name
          versno_new   = ls_saved_thread-versno_new
          versno_old   = ls_saved_thread-versno_old
          versno_new_text = ls_saved_thread-versno_new_text
          versno_old_text = ls_saved_thread-versno_old_text
          html         = ls_saved_thread-html ) INTO TABLE ct_hunk_info.
      ENDIF.
      INSERT ls_thread INTO TABLE ct_hunk_threads.
    ENDLOOP.

    LOOP AT is_payload-user_states INTO DATA(ls_action_state).
      LOOP AT ls_action_state-approved INTO DATA(ls_action_approved).
        IF ( ct_hunk_info IS INITIAL
             OR line_exists( ct_hunk_info[ hunk_key = ls_action_approved-hunk_key ] ) )
           AND NOT line_exists( ct_hunk_actions[
             hunk_key = ls_action_approved-hunk_key reviewer = ls_action_state-reviewer action = 'A' ] ).
          APPEND VALUE zif_vx_review_types=>ty_hunk_action(
            hunk_key      = ls_action_approved-hunk_key
            reviewer      = ls_action_state-reviewer
            reviewer_name = ls_action_state-reviewer_name
            action        = 'A'
            changed_at    = ls_action_state-saved_at ) TO ct_hunk_actions.
        ENDIF.
      ENDLOOP.
      LOOP AT ls_action_state-declined INTO DATA(ls_action_declined).
        IF ( ct_hunk_info IS INITIAL
             OR line_exists( ct_hunk_info[ hunk_key = ls_action_declined-hunk_key ] ) )
           AND NOT line_exists( ct_hunk_actions[
             hunk_key = ls_action_declined-hunk_key reviewer = ls_action_state-reviewer action = 'D' ] ).
          APPEND VALUE zif_vx_review_types=>ty_hunk_action(
            hunk_key      = ls_action_declined-hunk_key
            reviewer      = ls_action_state-reviewer
            reviewer_name = ls_action_state-reviewer_name
            action        = 'D'
            changed_at    = ls_action_state-saved_at ) TO ct_hunk_actions.
        ENDIF.
      ENDLOOP.
    ENDLOOP.

    READ TABLE is_payload-user_states INTO DATA(ls_user_state)
      WITH KEY reviewer = sy-uname.
    IF sy-subrc = 0.
      LOOP AT ls_user_state-approved INTO DATA(ls_approved_key).
        INSERT ls_approved_key-hunk_key INTO TABLE ct_approved.
        IF NOT line_exists( ct_hunk_actions[
          hunk_key = ls_approved_key-hunk_key reviewer = ls_user_state-reviewer action = 'A' ] ).
          APPEND VALUE zif_vx_review_types=>ty_hunk_action(
            hunk_key      = ls_approved_key-hunk_key
            reviewer      = ls_user_state-reviewer
            reviewer_name = ls_user_state-reviewer_name
            action        = 'A'
            changed_at    = ls_user_state-saved_at ) TO ct_hunk_actions.
        ENDIF.
      ENDLOOP.
      LOOP AT ls_user_state-declined INTO DATA(ls_declined_key).
        INSERT ls_declined_key-hunk_key INTO TABLE ct_declined.
        IF NOT line_exists( ct_hunk_actions[
          hunk_key = ls_declined_key-hunk_key reviewer = ls_user_state-reviewer action = 'D' ] ).
          APPEND VALUE zif_vx_review_types=>ty_hunk_action(
            hunk_key      = ls_declined_key-hunk_key
            reviewer      = ls_user_state-reviewer
            reviewer_name = ls_user_state-reviewer_name
            action        = 'D'
            changed_at    = ls_user_state-saved_at ) TO ct_hunk_actions.
        ENDIF.
      ENDLOOP.
      LOOP AT ls_user_state-notes INTO DATA(ls_saved_note).
        INSERT VALUE zif_vx_review_types=>ty_decline_note(
          hunk_key = ls_saved_note-hunk_key
          note     = ls_saved_note-note ) INTO TABLE ct_decline_notes.
      ENDLOOP.
    ENDIF.

    sanitize_review_state(
      EXPORTING
        it_hunk_info    = ct_hunk_info
      CHANGING
        ct_approved     = ct_approved
        ct_declined     = ct_declined
        ct_hunk_actions = ct_hunk_actions ).
  ENDMETHOD.


  METHOD drop_generated_classes.
    TYPES: BEGIN OF ty_drop_key,
             objtype TYPE versobjtyp,
             objname TYPE versobjnam,
           END OF ty_drop_key.
    DATA lt_drop TYPE HASHED TABLE OF ty_drop_key WITH UNIQUE KEY objtype objname.

    LOOP AT ct_obj_stats INTO DATA(ls_stat).
      CHECK zcl_vx_review_prepare=>is_generated_class( ls_stat-obj_name ) = abap_true
         OR ( ls_stat-class_name IS NOT INITIAL
          AND zcl_vx_review_prepare=>is_generated_class( ls_stat-class_name ) = abap_true ).
      INSERT VALUE #( objtype = ls_stat-objtype objname = ls_stat-obj_name ) INTO TABLE lt_drop.
    ENDLOOP.

    LOOP AT ct_hunk_info INTO DATA(ls_hunk).
      CHECK zcl_vx_review_prepare=>is_generated_class( ls_hunk-obj_name ) = abap_true
         OR ( ls_hunk-class_name IS NOT INITIAL
          AND zcl_vx_review_prepare=>is_generated_class( ls_hunk-class_name ) = abap_true ).
      INSERT VALUE #( objtype = ls_hunk-objtype objname = ls_hunk-obj_name ) INTO TABLE lt_drop.
    ENDLOOP.

    LOOP AT ct_diff_data INTO DATA(ls_diff_data).
      CHECK zcl_vx_review_prepare=>is_generated_class( ls_diff_data-key-objname ) = abap_true.
      INSERT VALUE #( objtype = ls_diff_data-key-objtype objname = ls_diff_data-key-objname )
        INTO TABLE lt_drop.
    ENDLOOP.

    CHECK lt_drop IS NOT INITIAL.

    LOOP AT lt_drop INTO DATA(ls_drop).
      DELETE ct_obj_stats WHERE objtype     = ls_drop-objtype AND obj_name    = ls_drop-objname.
      DELETE ct_hunk_info WHERE objtype     = ls_drop-objtype AND obj_name    = ls_drop-objname.
      DELETE ct_diff_data WHERE key-objtype = ls_drop-objtype AND key-objname = ls_drop-objname.
    ENDLOOP.
  ENDMETHOD.


  METHOD collect_report_status.
    CLEAR: et_approved, et_declined.

    LOOP AT is_payload-user_states INTO DATA(ls_user_state).
      LOOP AT ls_user_state-approved INTO DATA(ls_saved_approved).
        IF it_hunk_info IS INITIAL
           OR line_exists( it_hunk_info[ hunk_key = ls_saved_approved-hunk_key ] ).
          INSERT ls_saved_approved-hunk_key INTO TABLE et_approved.
        ENDIF.
      ENDLOOP.
      LOOP AT ls_user_state-declined INTO DATA(ls_saved_declined).
        IF it_hunk_info IS INITIAL
           OR line_exists( it_hunk_info[ hunk_key = ls_saved_declined-hunk_key ] ).
          INSERT ls_saved_declined-hunk_key INTO TABLE et_declined.
        ENDIF.
      ENDLOOP.
    ENDLOOP.

    LOOP AT it_approved INTO DATA(lv_approved_key).
      INSERT lv_approved_key INTO TABLE et_approved.
    ENDLOOP.
    LOOP AT it_declined INTO DATA(lv_declined_key).
      INSERT lv_declined_key INTO TABLE et_declined.
    ENDLOOP.

    IF it_hunk_info IS NOT INITIAL.
      LOOP AT et_approved INTO lv_approved_key.
        IF NOT line_exists( it_hunk_info[ hunk_key = lv_approved_key ] ).
          DELETE TABLE et_approved FROM lv_approved_key.
        ENDIF.
      ENDLOOP.
      LOOP AT et_declined INTO lv_declined_key.
        IF NOT line_exists( it_hunk_info[ hunk_key = lv_declined_key ] )
           OR line_exists( et_approved[ table_line = lv_declined_key ] ).
          DELETE TABLE et_declined FROM lv_declined_key.
        ENDIF.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.


  METHOD build_save_payload.
    DATA lv_saved_at TYPE timestampl.
    GET TIME STAMP FIELD lv_saved_at.
    DATA(lv_user_name) = zcl_vx_vers_data=>get_user_name( sy-uname ).

    result = is_existing_payload.
    result-schema_version = 2.
    result-trkorr = iv_trkorr.
    result-last_saved_at = lv_saved_at.
    result-last_saved_by = sy-uname.
    result-obj_stats = it_obj_stats.
    result-hunks = it_hunk_info.
    LOOP AT result-hunks ASSIGNING FIELD-SYMBOL(<saved_hunk>).
      CLEAR <saved_hunk>-html.
    ENDLOOP.
    result-diff_data = it_diff_data.
    result-hunk_actions = it_hunk_actions.

    " Timings are cumulative: a part measured in an earlier run keeps its value
    " until it is recomputed, so a partial Prepare does not lose the rest. The
    " blame setting is part of the identity — both modes are kept side by side.
    LOOP AT it_timings INTO DATA(ls_timing_new).
      DELETE result-timings WHERE part_key = ls_timing_new-part_key
                              AND blame    = ls_timing_new-blame.
      APPEND ls_timing_new TO result-timings.
    ENDLOOP.

    DATA(ls_user_state_new) = VALUE zif_vx_review_types=>ty_saved_user_state(
      reviewer      = sy-uname
      reviewer_name = lv_user_name
      saved_at      = lv_saved_at ).

    LOOP AT it_approved INTO DATA(lv_approved_key).
      APPEND VALUE zif_vx_review_types=>ty_saved_key( hunk_key = lv_approved_key ) TO ls_user_state_new-approved.
    ENDLOOP.
    LOOP AT it_declined INTO DATA(lv_declined_key).
      APPEND VALUE zif_vx_review_types=>ty_saved_key( hunk_key = lv_declined_key ) TO ls_user_state_new-declined.
    ENDLOOP.
    LOOP AT it_decline_notes INTO DATA(ls_note_cur).
      APPEND VALUE zif_vx_review_types=>ty_saved_note(
        hunk_key = ls_note_cur-hunk_key
        note     = ls_note_cur-note ) TO ls_user_state_new-notes.
    ENDLOOP.

    DELETE result-user_states WHERE reviewer = sy-uname.
    APPEND ls_user_state_new TO result-user_states.

    LOOP AT it_hunk_threads INTO DATA(ls_thread_cur).
      DATA(ls_thread_to_save) = VALUE zif_vx_review_types=>ty_saved_thread(
        hunk_key     = ls_thread_cur-hunk_key
        objtype      = ls_thread_cur-objtype
        obj_name     = ls_thread_cur-obj_name
        class_name   = ls_thread_cur-class_name
        display_name = ls_thread_cur-display_name
        hunk_no      = ls_thread_cur-hunk_no
        start_line   = ls_thread_cur-start_line
        change_count = ls_thread_cur-change_count
        change_kind  = ls_thread_cur-change_kind
        versno_new   = COND #(
          WHEN line_exists( it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ] )
          THEN it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ]-versno_new
          ELSE ls_thread_cur-versno_new )
        versno_old   = COND #(
          WHEN line_exists( it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ] )
          THEN it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ]-versno_old
          ELSE ls_thread_cur-versno_old )
        versno_new_text = COND #(
          WHEN line_exists( it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ] )
          THEN it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ]-versno_new_text
          ELSE ls_thread_cur-versno_new_text )
        versno_old_text = COND #(
          WHEN line_exists( it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ] )
          THEN it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ]-versno_old_text
          ELSE ls_thread_cur-versno_old_text )
        author       = COND #(
          WHEN line_exists( it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ] )
          THEN it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ]-author )
        author_name  = COND #(
          WHEN line_exists( it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ] )
          THEN it_hunk_info[ hunk_key = ls_thread_cur-hunk_key ]-author_name )
        messages     = ls_thread_cur-messages ).

      READ TABLE result-threads ASSIGNING FIELD-SYMBOL(<ls_thread_saved>)
        WITH KEY hunk_key = ls_thread_cur-hunk_key.
      IF sy-subrc <> 0.
        APPEND ls_thread_to_save TO result-threads.
        CONTINUE.
      ENDIF.

      <ls_thread_saved>-objtype      = ls_thread_to_save-objtype.
      <ls_thread_saved>-obj_name     = ls_thread_to_save-obj_name.
      <ls_thread_saved>-class_name   = ls_thread_to_save-class_name.
      <ls_thread_saved>-display_name = ls_thread_to_save-display_name.
      <ls_thread_saved>-hunk_no      = ls_thread_to_save-hunk_no.
      <ls_thread_saved>-start_line   = ls_thread_to_save-start_line.
      <ls_thread_saved>-change_count = ls_thread_to_save-change_count.
      <ls_thread_saved>-change_kind  = ls_thread_to_save-change_kind.
      <ls_thread_saved>-author       = ls_thread_to_save-author.
      <ls_thread_saved>-author_name  = ls_thread_to_save-author_name.
      CLEAR <ls_thread_saved>-html.

      LOOP AT ls_thread_cur-messages INTO DATA(ls_msg_cur).
        READ TABLE <ls_thread_saved>-messages TRANSPORTING NO FIELDS
          WITH KEY author = ls_msg_cur-author
                   created_at = ls_msg_cur-created_at
                   text = ls_msg_cur-text.
        IF sy-subrc <> 0.
          APPEND ls_msg_cur TO <ls_thread_saved>-messages.
        ENDIF.
      ENDLOOP.
    ENDLOOP.

    LOOP AT result-threads ASSIGNING FIELD-SYMBOL(<saved_thread>).
      CLEAR <saved_thread>-html.
    ENDLOOP.

    APPEND VALUE zif_vx_review_types=>ty_saved_history(
      saved_at       = lv_saved_at
      saved_by       = sy-uname
      saved_by_name  = lv_user_name
      approved_count = lines( it_approved )
      declined_count = lines( it_declined )
      note_count     = lines( it_decline_notes ) ) TO result-history.
  ENDMETHOD.

ENDCLASS.
