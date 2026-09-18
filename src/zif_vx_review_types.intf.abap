interface ZIF_VX_REVIEW_TYPES
  public .

  TYPES ty_approved TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.

  "! Transport request numbers found somewhere — in the comments of a changed
  "! block, or in the version history of one object. Lives here rather than on
  "! ZCL_VX_REVIEW_PREPARE because two other classes name it in their signatures:
  "! in the standalone build every class is local, and a class referring to a
  "! type of a class that abapmerge emits later fails with "Direct access to
  "! components of the global class … is not possible". An interface type is
  "! always in scope, because the interfaces come first.
  TYPES ty_t_korr_found TYPE SORTED TABLE OF trkorr WITH UNIQUE KEY table_line.

  TYPES ty_action_code TYPE c LENGTH 1.

  "! Comment-control verdict of one changed block — see TY_HUNK_INFO-REQ_REF.
  "! Fully typed here rather than left as a bare 'c': a RETURNING parameter may
  "! not be generic, and ZCL_VX_REVIEW_PREPARE=>BLOCK_REQUEST_VERDICT returns one.
  TYPES ty_req_ref TYPE c LENGTH 1.

  TYPES:
    BEGIN OF ty_hunk_action,
      hunk_key      TYPE string,
      reviewer      TYPE syuname,
      reviewer_name TYPE ad_namtext,
      action        TYPE ty_action_code,
      changed_at    TYPE timestampl,
    END OF ty_hunk_action.
  TYPES ty_t_hunk_actions TYPE STANDARD TABLE OF ty_hunk_action WITH DEFAULT KEY.

  "! Decline notes: key = hunk key (OBJTYPE~OBJNAME~N), value = note text
  TYPES:
    BEGIN OF ty_decline_note,
      hunk_key TYPE string,
      note     TYPE string,
    END OF ty_decline_note.
  TYPES ty_t_decline_notes TYPE HASHED TABLE OF ty_decline_note WITH UNIQUE KEY hunk_key.

  TYPES:
    BEGIN OF ty_decline_msg,
      author      TYPE syuname,
      author_name TYPE ad_namtext,
      created_at  TYPE timestampl,
      is_decline  TYPE abap_bool,
      text        TYPE string,
    END OF ty_decline_msg.
  TYPES ty_t_decline_msgs TYPE STANDARD TABLE OF ty_decline_msg WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_hunk_info,
      hunk_key        TYPE string,
      objtype         TYPE versobjtyp,
      obj_name        TYPE versobjnam,
      class_name      TYPE seoclsname,
      display_name    TYPE string,
      hunk_no         TYPE i,
      start_line      TYPE i,
      change_count    TYPE i,
      change_kind     TYPE string,
      author          TYPE versuser,
      author_name     TYPE ad_namtext,
      versno_new      TYPE versno,
      versno_old      TYPE versno,
      versno_new_text TYPE string,
      versno_old_text TYPE string,
      html            TYPE string,
      "! Retrofit warning text (non-initial = hunk diverges vs remote system)
      retrofit        TYPE string,
      "! Comment control: do the new lines of this block name a transport
      "! request? ' ' = no verdict, 'X' = one of this review's, 'R' = another
      "! system's (retrofitted code, marked not faulted), 'V' = the same and
      "! confirmed by this object's own version history, 'N' = one of ours that
      "! does not exist here (typed wrong), 'T' = a task of ours instead of the
      "! request, 'W' = one of ours that exists but is not this review's,
      "! '-' = none at all.
      "! The blank is not a third opinion, it is the absence of one: a review
      "! saved before the check existed carries none, and a block without a
      "! verdict must not read as a failed one. Filled on every Prepare by
      "! ZCL_VX_REVIEW_HUNK_INFO=>COLLECT; whether it is shown is P_CMTCHK,
      "! read where the review is drawn.
      req_ref         TYPE ty_req_ref,
      "! Comment control of the OBJECT this block belongs to: does the request
      "! add a change description at the top of it, before the first line of
      "! code? Same three states as REQ_REF, same reason for the blank.
      "! One verdict per part, stamped on each of its blocks — only block #1 is
      "! ever read, the rest are there so a dropped block cannot lose it.
      "! See ZCL_VX_REVIEW_PREPARE=>DIFF_HAS_CHANGE_DESCR.
      obj_descr       TYPE ty_req_ref,
    END OF ty_hunk_info.
  TYPES ty_t_hunk_info TYPE HASHED TABLE OF ty_hunk_info WITH UNIQUE KEY hunk_key.

  "! Where one changed block sits in a diff. OP_FROM and OP_TO index IT_DIFF and
  "! include the context the block swallowed - the lines inside an unfinished
  "! statement, and a blank line kept because more changes follow.
  "! START_LINE is the line of the NEW version the block opens on, counting
  "! insertions and context but not deletions, which is the same number
  "! TY_HUNK_INFO-START_LINE carries. BLANK marks a block that changes nothing
  "! visible: it is cut like any other, and numbered like none.
  "! Produced by ZCL_VX_REVIEW_HUNKS=>HUNK_RANGES, which is the one walk that
  "! decides where AVE's blocks begin and end.
  TYPES:
    BEGIN OF ty_hunk_range,
      op_from    TYPE i,
      op_to      TYPE i,
      start_line TYPE i,
      blank      TYPE abap_bool,
    END OF ty_hunk_range.
  TYPES ty_t_hunk_range TYPE STANDARD TABLE OF ty_hunk_range WITH DEFAULT KEY.

  "! Set of changed lines (|op|text|) used to cross-check retrofit hunks
  TYPES ty_review_lines TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.

  "! One flag per diff operation, parallel to a ty_t_diff
  TYPES ty_t_flag TYPE STANDARD TABLE OF abap_bool WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_hunk_thread,
      hunk_key        TYPE string,
      objtype         TYPE versobjtyp,
      obj_name        TYPE versobjnam,
      class_name      TYPE seoclsname,
      display_name    TYPE string,
      hunk_no         TYPE i,
      start_line      TYPE i,
      change_count    TYPE i,
      change_kind     TYPE string,
      versno_new      TYPE versno,
      versno_old      TYPE versno,
      versno_new_text TYPE string,
      versno_old_text TYPE string,
      html            TYPE string,
      messages        TYPE ty_t_decline_msgs,
    END OF ty_hunk_thread.
  TYPES ty_t_hunk_threads TYPE HASHED TABLE OF ty_hunk_thread WITH UNIQUE KEY hunk_key.

  TYPES:
    BEGIN OF ty_saved_thread,
      hunk_key        TYPE string,
      objtype         TYPE versobjtyp,
      obj_name        TYPE versobjnam,
      class_name      TYPE seoclsname,
      display_name    TYPE string,
      hunk_no         TYPE i,
      start_line      TYPE i,
      change_count    TYPE i,
      change_kind     TYPE string,
      author          TYPE versuser,
      author_name     TYPE ad_namtext,
      versno_new      TYPE versno,
      versno_old      TYPE versno,
      versno_new_text TYPE string,
      versno_old_text TYPE string,
      html            TYPE string,
      messages        TYPE ty_t_decline_msgs,
    END OF ty_saved_thread.
  TYPES ty_t_saved_threads TYPE STANDARD TABLE OF ty_saved_thread WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_saved_key,
      hunk_key TYPE string,
    END OF ty_saved_key.
  TYPES ty_t_saved_keys TYPE STANDARD TABLE OF ty_saved_key WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_saved_note,
      hunk_key TYPE string,
      note     TYPE string,
    END OF ty_saved_note.
  TYPES ty_t_saved_notes TYPE STANDARD TABLE OF ty_saved_note WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_saved_user_state,
      reviewer      TYPE syuname,
      reviewer_name TYPE ad_namtext,
      saved_at      TYPE timestampl,
      approved      TYPE ty_t_saved_keys,
      declined      TYPE ty_t_saved_keys,
      notes         TYPE ty_t_saved_notes,
    END OF ty_saved_user_state.
  TYPES ty_t_saved_user_state TYPE STANDARD TABLE OF ty_saved_user_state WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_saved_history,
      saved_at       TYPE timestampl,
      saved_by       TYPE syuname,
      saved_by_name  TYPE ad_namtext,
      approved_count TYPE i,
      declined_count TYPE i,
      note_count     TYPE i,
    END OF ty_saved_history.
  TYPES ty_t_saved_history TYPE STANDARD TABLE OF ty_saved_history WITH DEFAULT KEY.

  "! Per-instance cache for rendered diff HTML.
  TYPES:
    BEGIN OF ty_diff_cache_key,
      objtype     TYPE versobjtyp,
      objname     TYPE versobjnam,
      system_o    TYPE verssysnam,
      system_n    TYPE verssysnam,
      versno_o    TYPE versno,
      versno_n    TYPE versno,
      blame       TYPE abap_bool,
      two_pane    TYPE abap_bool,
      compact     TYPE abap_bool,
      debug       TYPE abap_bool,
      ignore_case   TYPE abap_bool,
    END OF ty_diff_cache_key.
  TYPES:
    BEGIN OF ty_diff_cache,
      key  TYPE ty_diff_cache_key,
      html TYPE string,
    END OF ty_diff_cache.
  TYPES ty_t_diff_cache TYPE HASHED TABLE OF ty_diff_cache WITH UNIQUE KEY key.

  "! Persisted review diff data. HTML is derived from this at load/render time.
  TYPES:
    BEGIN OF ty_diff_data_key,
      objtype       TYPE versobjtyp,
      objname       TYPE versobjnam,
      versno_o      TYPE versno,
      versno_n      TYPE versno,
      blame         TYPE abap_bool,
      "! Case AND whitespace insensitivity — one option. Payloads written before
      "! the merge also carry IGNORE_INDENT; /ui2/cl_json drops it on load.
      ignore_case   TYPE abap_bool,
    END OF ty_diff_data_key.
  TYPES:
    BEGIN OF ty_diff_data,
      key           TYPE ty_diff_data_key,
      diff          TYPE zif_vx_vers_types=>ty_t_diff,
      blame_map     TYPE zif_vx_vers_types=>ty_blame_map,
      blame_deleted TYPE zif_vx_vers_types=>ty_blame_map,
      huge_source   TYPE abap_bool,
      title         TYPE string,
      meta          TYPE string,
      is_created    TYPE abap_bool,
      "! Marks the remote retrofit (moving-violation) diff, regenerated on the fly
      retrofit      TYPE abap_bool,
      "! Retrofit row only: the changed lines of the review diff this remote diff
      "! was measured against. Superseded by EXPECTED — kept for reviews saved
      "! before it existed, and as the fallback when the two op lists cannot be
      "! matched up (see COLLECT_RETROFIT_HUNKS).
      review_lines  TYPE ty_review_lines,
      "! Retrofit row only, one flag per line of DIFF: was this operation also
      "! made by the request? Produced by MARK_EXPECTED_OPS, which subtracts the
      "! review diff from this one — in a system pair that is in sync the two
      "! change scripts cancel out completely and nothing is left. Stored because
      "! the view regenerates the hunks from DIFF alone and must reach the same
      "! verdict, or the hunk numbering the html is keyed on shifts.
      expected      TYPE ty_t_flag,
      "! Ready-made page of a DDIC object (TABD/DOMD/DTED). Those have no line
      "! diff to re-render from — their review page is a field/value table — and
      "! the saved payload clears every hunk html, so the html is kept here.
      html          TYPE string,
    END OF ty_diff_data.
  TYPES ty_t_diff_data TYPE HASHED TABLE OF ty_diff_data WITH UNIQUE KEY key.

  "! Per-author change contribution inside one object diff
  TYPES:
    BEGIN OF ty_author_stats,
      author      TYPE versuser,
      author_name TYPE ad_namtext,
      ins_count   TYPE i,
      del_count   TYPE i,
      mod_count   TYPE i,
      hunk_count  TYPE i,
      "! Hunks of this author split by kind. Filled from the very same hunk list
      "! as HUNK_COUNT, so summing the authors of one object reproduces the
      "! object's HUNK_INS / HUNK_MOD / HUNK_DEL exactly.
      hunk_ins    TYPE i,
      hunk_mod    TYPE i,
      hunk_del    TYPE i,
    END OF ty_author_stats.
  TYPES ty_t_author_stats TYPE STANDARD TABLE OF ty_author_stats WITH DEFAULT KEY.

  "! Per-reviewer action totals for the report header
  TYPES:
    BEGIN OF ty_reviewer_stats,
      reviewer      TYPE syuname,
      reviewer_name TYPE ad_namtext,
      appr_count    TYPE i,
      decl_count    TYPE i,
      total_count   TYPE i,
      saved_at      TYPE timestampl,
    END OF ty_reviewer_stats.
  TYPES ty_t_reviewer_stats TYPE STANDARD TABLE OF ty_reviewer_stats WITH DEFAULT KEY.

  "! Statistics for one changed object: version pair, counts, blame breakdown
  TYPES:
    BEGIN OF ty_obj_stats,
      objtype     TYPE versobjtyp,
      class_name  TYPE seoclsname,   " parent class for METH / CPUB / CPRO / CPRI / CINC
      obj_name    TYPE versobjnam,
      versno_new  TYPE versno,
      versno_old  TYPE versno,
      author      TYPE versuser,
      author_name TYPE ad_namtext,
      datum       TYPE versdate,
      zeit        TYPE verstime,
      ins_count   TYPE i,
      del_count   TYPE i,
      mod_count   TYPE i,
      hunk_count  TYPE i,
      hunk_ins    TYPE i,   " blocks with only added lines
      hunk_mod    TYPE i,   " blocks with both added and deleted lines (modified)
      hunk_del    TYPE i,   " blocks with only deleted lines
      display_name  TYPE string,
      bt_authors    TYPE ty_t_author_stats,
      is_created    TYPE abap_bool,   " abap_true = object is brand-new (no prior version)
    END OF ty_obj_stats.
  TYPES ty_t_obj_stats TYPE STANDARD TABLE OF ty_obj_stats WITH DEFAULT KEY.

  "! Measured cost of precomputing one part. Written on every Prepare run and
  "! kept in the saved payload, so the estimate shown before the next Prepare
  "! is based on what this system actually took, not on a model constant.
  TYPES:
    BEGIN OF ty_part_timing,
      part_key    TYPE string,
      objtype     TYPE versobjtyp,
      obj_name    TYPE versobjnam,
      "! Wall-clock seconds spent in the precompute of this part. Kept for
      "! payloads written before MSECS existed; MSECS is the authoritative value.
      secs        TYPE i,
      "! Wall-clock milliseconds — most parts finish in a few seconds, so whole
      "! seconds are too coarse both to display and to calibrate from.
      msecs       TYPE i,
      versions    TYPE i,
      lines       TYPE i,
      blame       TYPE abap_bool,
      "! What the model predicted for this part right before the run, in
      "! milliseconds, for both modes. Kept so the next estimate is calibrated
      "! against the prediction made on the very same input, not against a model
      "! re-evaluated later on possibly changed version counts.
      "! The `_MS` suffix is also what keeps a payload written by the earlier
      "! build — where these held whole seconds — from being read as
      "! milliseconds and skewing the calibration by a factor of a thousand.
      est_nb_ms   TYPE i,
      est_bl_ms   TYPE i,
      measured_at TYPE timestampl,
    END OF ty_part_timing.
  TYPES ty_t_part_timings TYPE STANDARD TABLE OF ty_part_timing WITH DEFAULT KEY.

  TYPES:
    BEGIN OF ty_saved_payload,
      schema_version TYPE i,
      trkorr         TYPE trkorr,
      last_saved_at  TYPE timestampl,
      last_saved_by  TYPE syuname,
      obj_stats      TYPE ty_t_obj_stats,
      hunks          TYPE ty_t_hunk_info,
      diff_data      TYPE ty_t_diff_data,
      hunk_actions   TYPE ty_t_hunk_actions,
      user_states    TYPE ty_t_saved_user_state,
      threads        TYPE ty_t_saved_threads,
      history        TYPE ty_t_saved_history,
      "! Measured precompute durations per part (see TY_PART_TIMING). Older
      "! payloads have no such node; /ui2/cl_json leaves it empty then.
      timings        TYPE ty_t_part_timings,
    END OF ty_saved_payload.


endinterface.
