"! Shared types of the version and diff core, carried from AVE.
"! One source for the version list, the diff and whoever renders them.
INTERFACE zif_vx_vers_types
  PUBLIC.

  "! One row in the popup parts list: original object part plus display metadata.
  TYPES:
    BEGIN OF ty_part_row,
      class       TYPE string,
      name        TYPE string,
      display_name TYPE string,
      type        TYPE versobjtyp,
      type_text   TYPE as4text,
      object_name TYPE versobjnam,
      requests    TYPE string,
      trs         TYPE i,
      exists_flag TYPE abap_bool,
      rows        TYPE i,
      rowcolor(4) TYPE c,
    END OF ty_part_row.
  TYPES ty_t_part_row TYPE STANDARD TABLE OF ty_part_row WITH DEFAULT KEY.

  "! One diff operation: op = '=' (equal), '-' (deleted), '+' (inserted)
  TYPES:
    BEGIN OF ty_diff_op,
      op(1)   TYPE c,
      text    TYPE string,
    END OF ty_diff_op.
  TYPES ty_t_diff TYPE STANDARD TABLE OF ty_diff_op WITH DEFAULT KEY.

  "! Version row: one VRSD entry enriched with author/task/request display data.
  TYPES:
    BEGIN OF ty_version_row,
      system         TYPE verssysnam,
      objname        TYPE versobjnam,
      versno         TYPE versno,
      versno_text    TYPE string,
      datum          TYPE versdate,
      zeit           TYPE verstime,
      author         TYPE versuser,
      author_name    TYPE ad_namtext,
      obj_owner      TYPE versuser,
      obj_owner_name TYPE ad_namtext,
      korrnum        TYPE verskorrno,
      task           TYPE trkorr,
      korr_text      TYPE string,
      objtype        TYPE versobjtyp,
      trfunction     TYPE e070-trfunction,
      rowcolor(4)    TYPE c,
    END OF ty_version_row.
  TYPES ty_t_version_row TYPE STANDARD TABLE OF ty_version_row WITH DEFAULT KEY.

  "! Blame entry: a source line annotated with author/version info
  TYPES:
    BEGIN OF ty_blame_entry,
      text        TYPE string,
      author      TYPE versuser,
      author_name TYPE ad_namtext,
      datum       TYPE versdate,
      zeit        TYPE verstime,
      versno_text TYPE string,
      korrnum     TYPE verskorrno,
      task        TYPE trkorr,
      task_text   TYPE string,
    END OF ty_blame_entry.
  TYPES ty_blame_map TYPE STANDARD TABLE OF ty_blame_entry WITH DEFAULT KEY.

  "! One dictionary-table field (from DD03V), used for structured TABD comparison.
  TYPES:
    BEGIN OF ty_tabd_field,
      position   TYPE i,
      fieldname  TYPE fieldname,
      keyflag    TYPE keyflag,
      rollname   TYPE rollname,
      checktable TYPE checktable,
      datatype   TYPE datatype_d,
      leng       TYPE ddleng,
      decimals   TYPE decimals,
      notnull    TYPE notnull,
      ddtext     TYPE ddtext,
    END OF ty_tabd_field.
  TYPES ty_t_tabd_field TYPE STANDARD TABLE OF ty_tabd_field WITH DEFAULT KEY.

  "! A dictionary table version: header attributes plus its field list.
  TYPES:
    BEGIN OF ty_tabd,
      tabname  TYPE tabname,
      ddtext   TYPE ddtext,
      tabclass TYPE tabclass,
      contflag TYPE contflag,
      fields   TYPE ty_t_tabd_field,
    END OF ty_tabd.

  "! One domain fixed value (from DD07V), used for structured DOMA comparison.
  TYPES:
    BEGIN OF ty_doma_value,
      valpos     TYPE valpos,
      domvalue_l TYPE domvalue_l,
      domvalue_h TYPE domvalue_h,
      appval     TYPE ddappval,
      ddtext     TYPE val_text,
    END OF ty_doma_value.
  TYPES ty_t_doma_value TYPE STANDARD TABLE OF ty_doma_value WITH DEFAULT KEY.

  "! A domain version: header attributes plus its fixed-value list.
  TYPES:
    BEGIN OF ty_doma,
      domname   TYPE domname,
      ddtext    TYPE ddtext,
      datatype  TYPE datatype_d,
      leng      TYPE ddleng,
      outputlen TYPE outputlen,
      decimals  TYPE decimals,
      convexit  TYPE convexit,
      entitytab TYPE entitytab,
      values    TYPE ty_t_doma_value,
    END OF ty_doma.

  "! A data element version (from DD04V): the attributes shown as a name/value list.
  TYPES:
    BEGIN OF ty_dtel,
      rollname  TYPE rollname,
      domname   TYPE domname,
      datatype  TYPE datatype_d,
      leng      TYPE ddleng,
      decimals  TYPE decimals,
      outputlen TYPE outputlen,
      convexit  TYPE convexit,
      lowercase TYPE lowercase,
      signflag  TYPE signflag,
      shlpname  TYPE shlpname,
      shlpfield TYPE shlpfield,
      memoryid  TYPE memoryid,
      ddtext    TYPE as4text,
      reptext   TYPE reptext,
      scrtext_s TYPE scrtext_s,
      scrtext_m TYPE scrtext_m,
      scrtext_l TYPE scrtext_l,
    END OF ty_dtel.

ENDINTERFACE.
