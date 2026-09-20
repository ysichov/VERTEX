(function(root){
"use strict";
function upper(value) { return encodeURIComponent(String(value || "").toUpperCase()); }
const SERVICES = {

  table: {
    page: "table.html",
    title: "SelecTor",
    // name, rows, query
    load: function (args) {
      let p = "/sap/bc/adt/vertex/table/" + upper(args[0])
            + "?rows=" + encodeURIComponent(args[1] || 100);
      if (args[2]) {
        p += "&" + args[2];
      }
      return p;
    },
    // table, taken, rows, query, cross, build
    join: function (args) {
      let p = "/sap/bc/adt/vertex/join/" + upper(args[0]);
      let n = 0;
      // The resource stops at the first missing t-parameter, so the numbering
      // has to be contiguous however gappy the list arrives.
      String(args[1] || "").split(",").forEach(function (raw) {
        const name = raw.trim();
        if (!name) {
          return;
        }
        n++;
        p += (n === 1 ? "?" : "&") + "t" + n + "=" + upper(name);
      });
      [args[2] > 0 ? "rows=" + args[2] : "", args[3] || "", args[4] || "", args[5] || ""]
        .forEach(function (part) {
          if (!part) {
            return;
          }
          p += (n === 0 && p.indexOf("?") === -1 ? "?" : "&") + part;
        });
      return p;
    }
  },

  metrics: {
    page: "metrics.html",
    title: "Metrics",
    // name, type - the ADT type travels with its subtype, CLAS/OC
    load: function (args) {
      let p = "/sap/bc/adt/vertex/metrics/" + upper(args[0]);
      if (args[1]) {
        p += "?type=" + encodeURIComponent(args[1]);
      }
      return p;
    },
    class: function (args) {
      return "/sap/bc/adt/vertex/" + (String(args[1]).toUpperCase() === "DEVC" ? "package/" : "class/") + upper(args[0]);
    },
    // name, type, mode, include, unit, expand, depth. The include comes for
    // the scheme, because it is what identifies the code: for a class it is
    // the method's own include, for a program it is not. The flow is about
    // the whole object and names neither.
    flow: function (args) {
      let p = "/sap/bc/adt/vertex/flow/" + upper(args[0])
            + "?mode=" + encodeURIComponent(args[2] || "scheme");
      if (args[3]) {
        p += "&include=" + encodeURIComponent(args[3]);
      }
      if (args[1]) {
        p += "&type=" + encodeURIComponent(args[1]);
      }
      if (args[4]) {
        // A method is named CLASS=>METHOD, which an untouched query string
        // would split at the equals sign.
        p += "&unit=" + encodeURIComponent(args[4]);
      }
      if (args[5]) {
        p += "&expand=" + encodeURIComponent(args[5]);
      }
      if (args[6]) {
        p += "&depth=" + encodeURIComponent(args[6]);
      }
      return p;
    }
  },

  versions: {
    page: "versions.html",
    title: "Versions",
    // name, type, part, ptype, from, to
    load: function (args) {
      let p = "/sap/bc/adt/vertex/versions/" + upper(args[0])
            + "?type=" + encodeURIComponent(args[1] || "");
      if (args[2]) {
        // A part name is a VRSD key: thirty characters of object padded with
        // blanks, then the method. encodeURIComponent writes a space as %20,
        // which is what the other side reads; a '+' would be a space only
        // under form encoding.
        p += "&part=" + encodeURIComponent(args[2]);
        p += "&ptype=" + encodeURIComponent(args[3] || "");
      }
      if (args[5]) {
        // An empty from is the oldest version, compared against nothing.
        p += "&from=" + encodeURIComponent(args[4] || "");
        p += "&to=" + encodeURIComponent(args[5]);
      }
      return p;
    },
    // request, remote, part, ptype - a review compared against another system is
    // a different review, so the other system belongs in the request. An empty
    // part asks for the summary; a named one asks for that object's blocks.
    review: function (args) {
      let p = "/sap/bc/adt/vertex/review/" + upper(args[0]);
      let lead = "?";
      if (args[1]) {
        p += lead + "remote=" + encodeURIComponent(args[1]);
        lead = "&";
      }
      if (args[2]) {
        p += lead + "part=" + encodeURIComponent(args[2]);
        p += "&ptype=" + encodeURIComponent(args[3] || "");
      }
      return p;
    },
    // request, remote, part, ptype, body - a write goes to the review's own
    // path; what it does is in the body, and the answer is the part as it now
    // stands.
    act: function (args) {
      return SERVICES.versions.review(args);
    },
    // request, remote, body - building a review. With no body it asks what the
    // request holds; with one it prepares the object the body names and writes
    // it. One object per call, so a request of any size is a walk the page
    // drives rather than one call that has to survive being slow.
    prepare: function (args) {
      let p = "/sap/bc/adt/vertex/prepare/" + upper(args[0]);
      if (args[1]) {
        p += "?remote=" + encodeURIComponent(args[1]);
      }
      return p;
    },
    // user, released - the transport requests of one user, found by whose they
    // are rather than by number. An empty user is whoever is logged on: the
    // server knows who that is, and the page does not. "true" adds the released
    // requests to the open ones.
    requests: function (args) {
      let p = "/sap/bc/adt/vertex/requests";
      let lead = "?";
      if (args[0]) {
        p += lead + "user=" + upper(args[0]);
        lead = "&";
      }
      if (args[1]) {
        p += lead + "released=" + encodeURIComponent(args[1]);
      }
      return p;
    }
  }
};
const routesApi = { SERVICES, WRITES: { act: 4, prepare: 2 } };
if (typeof module !== "undefined") module.exports = routesApi; else root.VertexRoutes = routesApi;
})(typeof window === "undefined" ? globalThis : window);
