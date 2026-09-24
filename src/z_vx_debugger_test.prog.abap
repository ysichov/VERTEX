REPORT z_vx_debugger_test.

TYPES: BEGIN OF ty_line,
         product TYPE c LENGTH 5,
         qty     TYPE i,
         price   TYPE p LENGTH 8 DECIMALS 2,
       END OF ty_line.

DATA gt_lines TYPE SORTED TABLE OF ty_line WITH UNIQUE KEY product.
DATA gv_total TYPE p LENGTH 10 DECIMALS 2.

START-OF-SELECTION.
  PERFORM add_line USING 'KB-101' 2 '150.00'.
  PERFORM add_line USING 'KB-102' 1 '220.00'.
  PERFORM add_line USING 'MS-201' 4 '45.00'.
  PERFORM add_line USING 'MS-202' 3 '80.00'.

  LOOP AT gt_lines INTO DATA(gs_line).
    gv_total = gv_total + gs_line-qty * gs_line-price.
  ENDLOOP.

  WRITE: / 'Invoice total:', gv_total.

FORM add_line USING iv_product iv_qty iv_price.
  DATA ls_new TYPE ty_line.
  ls_new-product = iv_product.
  ls_new-qty     = iv_qty.
  ls_new-price   = iv_price.
  INSERT ls_new INTO TABLE gt_lines.
ENDFORM.
