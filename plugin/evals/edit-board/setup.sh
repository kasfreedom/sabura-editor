#!/usr/bin/env bash
# A small Sabura board: Cart -> Payment -> Order confirmed. Only the document
# block; the board script packs it into the full editor when it edits.
set -euo pipefail
cat > checkout.html <<'EOF_BOARD'
<!doctype html>
<script type="application/json" id="sabura-document">
{
  "assets": {},
  "ext:sabura:revision": {
    "contentDigest": "sha256:c17b8c4804b92772c3e427714ce7f57ab7acf56cfb73c75e87663d95e985a810",
    "parentId": null,
    "revisionId": "a78c2c3a77b3f68683bc67949f79623d",
    "version": 1
  },
  "groups": {},
  "id": "board_9xjp9vtap8k",
  "objects": {
    "c1": {
      "curveSide": 1,
      "endArrow": true,
      "fill": "none",
      "from": {
        "id": "cart"
      },
      "groupId": null,
      "id": "c1",
      "locked": false,
      "opacity": 1,
      "rotation": 0,
      "roughness": 1,
      "routing": "straight",
      "seed": 1367947836,
      "startArrow": false,
      "stroke": "#1e1e1e",
      "strokeStyle": "solid",
      "strokeWidth": 2,
      "text": "",
      "textStyle": {
        "align": "center",
        "bold": false,
        "color": "#1e1e1e",
        "fontFamily": "hand",
        "resolvedSize": 20,
        "size": "m"
      },
      "to": {
        "id": "payment"
      },
      "type": "connector"
    },
    "c2": {
      "curveSide": 1,
      "endArrow": true,
      "fill": "none",
      "from": {
        "id": "payment"
      },
      "groupId": null,
      "id": "c2",
      "locked": false,
      "opacity": 1,
      "rotation": 0,
      "roughness": 1,
      "routing": "straight",
      "seed": 292701133,
      "startArrow": false,
      "stroke": "#1e1e1e",
      "strokeStyle": "solid",
      "strokeWidth": 2,
      "text": "",
      "textStyle": {
        "align": "center",
        "bold": false,
        "color": "#1e1e1e",
        "fontFamily": "hand",
        "resolvedSize": 20,
        "size": "m"
      },
      "to": {
        "id": "confirm"
      },
      "type": "connector"
    },
    "cart": {
      "fill": "none",
      "groupId": null,
      "height": 80,
      "id": "cart",
      "locked": false,
      "opacity": 1,
      "rotation": 0,
      "roughness": 1,
      "seed": 496334216,
      "stroke": "#1e1e1e",
      "strokeStyle": "solid",
      "strokeWidth": 2,
      "text": "Cart",
      "textStyle": {
        "align": "center",
        "bold": false,
        "color": "#1e1e1e",
        "fontFamily": "hand",
        "resolvedSize": 20,
        "size": "m"
      },
      "type": "rectangle",
      "width": 180,
      "x": 0,
      "y": 0
    },
    "confirm": {
      "fill": "none",
      "groupId": null,
      "height": 80,
      "id": "confirm",
      "locked": false,
      "opacity": 1,
      "rotation": 0,
      "roughness": 1,
      "seed": 1488218761,
      "stroke": "#1e1e1e",
      "strokeStyle": "solid",
      "strokeWidth": 2,
      "text": "Order confirmed",
      "textStyle": {
        "align": "center",
        "bold": false,
        "color": "#1e1e1e",
        "fontFamily": "hand",
        "resolvedSize": 20,
        "size": "m"
      },
      "type": "rectangle",
      "width": 180,
      "x": 560,
      "y": 0
    },
    "payment": {
      "fill": "none",
      "groupId": null,
      "height": 80,
      "id": "payment",
      "locked": false,
      "opacity": 1,
      "rotation": 0,
      "roughness": 1,
      "seed": 691333885,
      "stroke": "#1e1e1e",
      "strokeStyle": "solid",
      "strokeWidth": 2,
      "text": "Payment",
      "textStyle": {
        "align": "center",
        "bold": false,
        "color": "#1e1e1e",
        "fontFamily": "hand",
        "resolvedSize": 20,
        "size": "m"
      },
      "type": "rectangle",
      "width": 180,
      "x": 280,
      "y": 0
    }
  },
  "order": [
    "cart",
    "payment",
    "confirm",
    "c1",
    "c2"
  ],
  "schemaVersion": "sabura/canvas/v1",
  "theme": {
    "background": "#fcfaf6",
    "defaultFill": "none",
    "defaultFontFamily": "hand",
    "defaultFontSize": "m",
    "defaultOpacity": 1,
    "defaultRoughness": 1,
    "defaultStroke": "#1e1e1e",
    "defaultStrokeWidth": 2,
    "gridColor": "rgba(70, 50, 20, 0.08)",
    "id": "paper",
    "name": "Paper",
    "palette": [
      "#1e1e1e",
      "#1971c2",
      "#2f9e44",
      "#e03131",
      "#f08c00",
      "#9c36b5",
      "#ffec99",
      "#b2f2bb",
      "#a5d8ff",
      "#ffc9c9",
      "#eebefa",
      "#ffffff"
    ]
  },
  "title": "Checkout"
}
</script>
EOF_BOARD
