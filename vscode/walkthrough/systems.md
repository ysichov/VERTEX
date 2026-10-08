# Your SAP systems

VERTEX reaches ADT over HTTP(S), so it needs the address of each system's ICM - which SAP Logon does not store.

**Import SAP Systems** builds the list from what this computer already knows:

- **SAP Logon** - each system's host and instance (a logon group through its message server)
- **Eclipse ADT** - the client and user of each system, from the workspaces Eclipse lists as recent
- **The port** - the usual ones are tried (443NN, 80NN, 44300, 8000, 50000 ...) and only addresses that answer are offered
- **WebGUI** for the debugger - found where it is served

You pick the systems; nothing is written before that. They go to the `vertex.systems` setting, where they can also be edited by hand.
