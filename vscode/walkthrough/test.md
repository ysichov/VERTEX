# Test the connection

**Test SAP Systems** logs on to every configured system with its user and says, per system, what is wrong: no answer at that address, a certificate that cannot be verified, a refused user or password, or ADT services not active.

The password is asked once and kept in the operating system's credential store - never in settings. A refused one is dropped, so the next test asks again.
