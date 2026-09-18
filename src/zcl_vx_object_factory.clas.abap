"! Factory for the version object handlers, carried from AVE. Creates the right
"! handler by object type string.
CLASS zcl_vx_object_factory DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.

    CONSTANTS:
      BEGIN OF gc_type,
        program  TYPE string VALUE 'PROG',
        class    TYPE string VALUE 'CLAS',
        intf     TYPE string VALUE 'INTF',
        function TYPE string VALUE 'FUNC',
        tr       TYPE string VALUE 'TR',
        package  TYPE string VALUE 'DEVC',
        ddls     TYPE string VALUE 'DDLS',
        fugr     TYPE string VALUE 'FUGR',
        tabd     TYPE string VALUE 'TABD',
        doma     TYPE string VALUE 'DOMD',
        dtel     TYPE string VALUE 'DTED',
      END OF gc_type.

    "! Returns an object handler for the given type+name.
    "! Raises ZCX_VX if the object does not exist.
    METHODS get_instance
      IMPORTING
        object_type   TYPE string
        object_name   TYPE sobj_name
      RETURNING
        VALUE(result) TYPE REF TO zif_vx_object
      RAISING
        zcx_vx.

ENDCLASS.


CLASS zcl_vx_object_factory IMPLEMENTATION.

  METHOD get_instance.
    result = SWITCH #(
      object_type
      WHEN gc_type-program  THEN NEW zcl_vx_object_prog( object_name )
      WHEN gc_type-class    THEN NEW zcl_vx_object_clas( CONV #( object_name ) )
      WHEN gc_type-intf     THEN NEW zcl_vx_object_intf( CONV #( object_name ) )
      WHEN gc_type-function THEN NEW zcl_vx_object_func( CONV #( object_name ) )
      WHEN gc_type-tr       THEN NEW zcl_vx_object_tr(   CONV #( object_name ) )
      WHEN gc_type-package  THEN NEW zcl_vx_object_pack( CONV #( object_name ) )
      WHEN gc_type-ddls     THEN NEW zcl_vx_object_ddls( CONV #( object_name ) )
      WHEN gc_type-fugr     THEN NEW zcl_vx_object_fugr( CONV #( object_name ) )
      " gc_type-tabd/doma/dtel already carry the VRSD part type (TABD/DOMD/DTED)
      WHEN gc_type-tabd OR gc_type-doma OR gc_type-dtel
                            THEN NEW zcl_vx_object_ddic( name    = CONV #( object_name )
                                                          iv_type = CONV #( object_type ) ) ).

    IF result IS NOT BOUND OR result->check_exists( ) = abap_false.
      RAISE EXCEPTION TYPE zcx_vx.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
