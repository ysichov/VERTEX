# ABAP VERTEX Tools

**VERTEX** is the ABAP Version, Code and Data Explorer: one front end over three
SAP GUI tools, in VS Code and in Eclipse ADT, from the same pages.

| Window | What it shows |
|---|---|
| **SelecTor** | A table, its selection panel, the join builder and the pivot cross |
| **Metrics** | Per-unit code metrics of a class, program or function group |
| **Versions** | The version history of an object, the diff between two versions, and the saved code review of a transport request |

## It needs an ABAP backend

This extension is one half of VERTEX. The other half is a set of ADT resources
that have to be installed on the SAP system, and the tools they read:

| Repository | What it is for |
|---|---|
| [Simple-Data-Explorer](https://github.com/ysichov/Simple-Data-Explorer) | The ADT resources every VERTEX window reads |
| [ACE](https://github.com/ysichov/ACE) | The metrics |
| [AVE](https://github.com/ysichov/AVE) | The version history, the diff and the review |

Pull each with [abapGit](https://abapgit.org) and activate it, then register the
BAdI implementation `ZSDE_ADT_RES_APP` on `BADI_ADT_REST_RFC_APPLICATION` with
the filter `STATIC_URI_PATH` covering `/sap/bc/adt/zsde/*`.

Until that is done, every window opens on a page saying so, with these links on
it. Nothing is broken; the backend has simply never been put there.

## Settings

The Eclipse plugin inherits its connection from the ABAP project. There is no
project to inherit from here, so the systems are a list and one of them is
active.

```json
"vertex.systems": [
  {
    "name": "DEV",
    "url": "https://host.example.com:44300",
    "client": "100",
    "user": "DEVELOPER"
  }
],
"vertex.active": "DEV"
```

The `url` is the ICM port, not the one SAP GUI connects to. The password is
asked once per system and kept in the operating system's credential store.
`allowInsecureCertificate` accepts a certificate that cannot be verified, which
development systems often have; it is off by default on purpose.

## Commands

- **VERTEX: Open SelecTor**
- **VERTEX: Open Metrics**
- **VERTEX: Open Versions**
- **VERTEX: Switch System**
- **VERTEX: Forget Password**

## What it writes

Everything reads, with one exception: approving, declining and commenting in a
code review writes to `ZAVE_REVIEW` through AVE's own code. A review is prepared
in AVE; this reads it and adds verdicts to it.

## Licence

MIT. See [the project](https://github.com/ysichov/VERTEX).
