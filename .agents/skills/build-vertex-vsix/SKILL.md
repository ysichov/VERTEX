---
name: build-vertex-vsix
description: Build or rebuild the VERTEX repository's VSIX only when the user clearly instructs VERTEX to do so now, such as "собери VSIX", "пересобери", a standalone "vsix", "VSIX +1", or "build version 0.9.111". Do not run for questions asking whether or when a build is possible or permitted, including "я сделал апрув — можно собирать?"; answer those questions without building. A version number alone or a question about building is not an execution request.
---

Jev selects whether to build the current version or increment it. VERTEX executes the workflow without calling the selected assistant. Follow the detailed [VSIX workflow](../../../vsix_skill.md); the [version procedure](../../../vsix-version.md) lists the files and the [build procedure](../../../vsix.md) describes packaging and verification.
