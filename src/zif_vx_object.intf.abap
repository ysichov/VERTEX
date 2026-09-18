"! Interface for all version object handlers (program, class, function, TR),
"! carried from AVE.
INTERFACE zif_vx_object
  PUBLIC.

  TYPES ty_t_korr_range TYPE RANGE OF trkorr.

  "! Popup display settings (maps to selection screen checkboxes)
  TYPES:
    BEGIN OF ty_settings,
      show_diff       TYPE abap_bool,
      layout          TYPE abap_bool,
      two_pane        TYPE abap_bool,
      no_toc          TYPE abap_bool,
      "! One option: case- AND whitespace-insensitive diff ("Case/ind" toggle)
      ignore_case     TYPE abap_bool,
      compact         TYPE abap_bool,
      remove_dup      TYPE abap_bool,
      blame           TYPE abap_bool,
      "! Comment control ("Comment check"): mark every changed block that names
      "! no transport request, and every object whose first block is not the
      "! change description. A shop convention, not an ABAP rule, so it is off
      "! unless asked for. Read by the code review, which is not carried here yet.
      comment_check   TYPE abap_bool,
      "! Keep generated code out of Code Review: framework includes authored by
      "! SAP* and the SEGW model classes (*_MPC, *_MPC_EXT, *_DPC). Off means
      "! they are reviewed like any other object.
      ignore_generated TYPE abap_bool,
      filter_user     TYPE versuser,
      date_from       TYPE versdate,
      code_review     TYPE abap_bool,
      system          TYPE verssysnam,
      filter_korrnum  TYPE trkorr,
      filter_korrnums TYPE ty_t_korr_range,
      "! Also read the objects of the S-tasks belonging to the entered requests
      include_tasks   TYPE abap_bool,
      "! Endpoint of the LLM provider. Empty = the built-in URL of the selected
      "! provider; no SM59 destination is used, the call goes through
      "! CL_HTTP_CLIENT=>CREATE_BY_URL.
      url             TYPE text255,
      "! SSL identity from STRUST used for that call (default ANONYM)
      ssl_id          TYPE ssfapplssl,
      model           TYPE text255,
      apikey          TYPE text255,
      provider        TYPE string,
      "! Frontend folder holding the review profiles (<profile>.md / .json)
      prompt_path     TYPE text255,
      "! Selected profile name — file name without extension
      prompt_profile  TYPE text255,
      "! Full frontend path of a single .md file with the system prompt. Takes
      "! precedence over PROMPT_PATH/PROMPT_PROFILE; empty falls back to them
      "! and finally to the instructions built into the report.
      system_file     TYPE text255,
      "! Output token cap per AI request
      max_tokens      TYPE i,
      "! Diagnostics: the Debug button of the version view and the Code Review
      "! diagnostics log under the report. Off for everyone who just reviews.
      debug           TYPE abap_bool,
      "! Cost metrics of a review scope: the Metrics page and the estimate
      "! columns/band selection of the Prepare picker. Collecting them reads the
      "! version history of every part, so they are asked for, not assumed.
      metrics         TYPE abap_bool,
      "! Open objects in the SAP GUI workbench instead of Eclipse. That
      "! navigation is synchronous, so AVE gets control back when the editor is
      "! left and can recompute the object it was left on; the adt:// URL is
      "! handed to the OS and never reports back.
      gui_nav         TYPE abap_bool,
    END OF ty_settings.

  "! A single versionable part of an object (e.g. one method, one include)
  TYPES:
    BEGIN OF ty_part,
      class       TYPE string,      "class
      unit        TYPE string,      "method/include
      object_name TYPE versobjnam,   " VRSD object name
      type        TYPE versobjtyp,   " VRSD object type (REPS, METH, CLSD, …)
    END OF ty_part,
    ty_t_part TYPE STANDARD TABLE OF ty_part WITH DEFAULT KEY.

  "! Returns the list of versionable parts for this object
  METHODS get_parts
    RETURNING
      VALUE(result) TYPE ty_t_part
    RAISING
      zcx_vx.

  "! Returns the logical object name
  METHODS get_name
    RETURNING
      VALUE(result) TYPE string.

  "! Returns TRUE if the object exists in the current system
  METHODS check_exists
    RETURNING
      VALUE(result) TYPE abap_bool.

ENDINTERFACE.
