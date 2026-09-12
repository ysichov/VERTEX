# Installing and recovering

How to put VERTEX into Eclipse, and how to get out again when a p2 install goes wrong. Written after
it went wrong here, on 11 September 2026, and cost an evening.

The VS Code half needs none of this: it installs from the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap) and
touches nothing but its own folder.

## Install into a separate Eclipse first

Not a preference. A p2 install does not add files to a running installation — it **recomputes the
wiring of every bundle in it**. An installation can carry a latent inconsistency for months, resolve
around it by luck on every start, and only fail when something forces a fresh resolve. That
something can be your plugin, and then the breakage looks like yours.

So the first install of anything goes into an Eclipse you can throw away.

## The bundle pool is shared, and it is on C:

The Eclipse Installer (Oomph) puts bundles in a pool under `%USERPROFILE%\.p2\pool` and shares it
between every installation it makes. Two consequences:

- An install writes to state that other installations read.
- Deleting one Eclipse does not remove what it added to the pool.

A **zip package** from [eclipse.org/downloads/packages](https://www.eclipse.org/downloads/packages/)
has no pool: profile, configuration and bundles all live under the folder you unpacked, and the
whole installation is one directory you can copy or delete. For trying a plugin out, that is the
right shape.

With the installer, switch to Advanced Mode and set the Bundle Pool yourself, or turn it off.

## Installing the feature

The p2 repository is built into `docs/` and published at `https://ysichov.github.io/VERTEX/` — see
[README.md](README.md) for how it is made.

| Route | How | When |
|---|---|---|
| Archive | zip up `docs/`, then Install New Software → Add → **Archive** | Trying it out. p2 resolves against one local file. |
| URL | Install New Software → Add → `https://ysichov.github.io/VERTEX/` | Normal use. *Check for Updates* then finds new versions. |

Installed this way on a freshly unpacked Eclipse with ADT and nothing else, it goes in without
incident — that is how the published build was checked.

Either way p2 refuses the install on an Eclipse without ADT, because the feature declares the SAP
bundles as prerequisites rather than shipping them.

## Reverting an install

p2 keeps every configuration it has ever had. **Help → About Eclipse IDE → Installation Details →
Installation History**, pick the state from before the install, **Revert**.

This is the whole safety net, and it is p2's, not ours. It restores the exact bundle set that
worked, and it undoes only what changed since.

**The headless director cannot do it.** This looks like it should work and does not:

```
eclipsec.exe -application org.eclipse.equinox.p2.director -revert 1788541063213
```

It answers `Unable to load repositories`, because a revert needs a metadata repository and the
bundle pool is an artifact repository only. Adding `-artifactrepository file:/…/.p2/pool` does not
help. The UI succeeds where this fails because it has the repository list from the preferences.

Two more traps with the director:

- **Never pass `-destination`** at a self-installation. It creates a second, empty profile registry
  beside the real one and then reports `The installable unit … has not been found`, which reads as
  "the feature is not installed" when it is.
- The real profile of an Oomph installation is under `%USERPROFILE%\.p2\org.eclipse.equinox.p2.engine\profileRegistry\`,
  not under the Eclipse folder. `-uninstallIU` with no `-destination` finds it.

Uninstalling the feature headlessly does work:

```
eclipsec.exe -application org.eclipse.equinox.p2.director -uninstallIU org.vertex.abap.feature.feature.group
```

## When Eclipse will not start after an install

The symptom is a splash that never finishes, high CPU, and a process Windows reports as not
responding. A thread dump names it exactly:

```
"main" … waiting on condition
  at org.eclipse.equinox.internal.simpleconfigurator.ConfigApplier.refreshPackages
  at org.eclipse.equinox.internal.simpleconfigurator.ConfigApplier.refreshAllBundles
  at org.eclipse.equinox.internal.simpleconfigurator.SimpleConfiguratorImpl.applyConfiguration
```

That is the OSGi package refresh after a configuration change, and it never completes. The main
thread is *waiting*, not working — its own CPU stays near zero while the process burns minutes. Each
launch re-applies the same pending change and stops in the same place.

Take the dump with the JRE Eclipse itself runs on:

```
jcmd.exe <pid> Thread.print
```

`-clean` and clearing `configuration/org.eclipse.osgi` let it start again here, but did not fix the
resolution: **they change the configuration, and it is applying the configuration that hangs.**

### Read the whole log, not the tail

`configuration/<timestamp>.log` rotates into `<timestamp>.bak_0.log` … `.bak_9.log`. A bad resolve
writes megabytes, so the file you open is the tail and can look clean while ten files beside it are
full of the failure. Count across all of them:

```bash
for f in configuration/<stem>.log configuration/<stem>.bak_*.log; do
  grep -c "Could not resolve module" "$f"
done
```

Reading only the tail here produced a confident "the conflict is gone" that was wrong.

### What a uses-constraint violation looks like

```
Could not resolve module: com.sap.adt.textelements
  Unresolved requirement: Require-Bundle: com.sap.adt.compatibility
    → com.sap.adt.communication
      → org.apache.httpcomponents.client5.httpclient5
        → Import-Package: org.slf4j
          → slf4j.api
            → osgi.extender=osgi.serviceloader.processor
              Bundle was not resolved because of a uses constraint violation.
```

One broken wiring at the bottom takes out a hundred bundles above it. Here the pool held
`org.objectweb.asm` at both 9.9.1 and 9.10.1 with `org.objectweb.asm.commons` at 9.9.1 only, so
`org.apache.aries.spifly`, whose import range is the wide `[9.6.0,10.0.0)`, was wired to both
versions through two chains.

**Deleting the duplicate is not the fix.** The profile records hard requirements on both:

```
name='org.objectweb.asm' range='[9.10.1,9.11.0)'
name='org.objectweb.asm' range='[9.9.1,9.10.0)'
```

Removing either version breaks whatever pinned it. Read those ranges before touching anything:

```bash
gzip -dc <newest>.profile.gz | grep -oE "name='org\.objectweb\.asm[a-z.]*' range='[^']*'" | sort -u
```

## Can this break somebody else's Eclipse

Honestly: installing anything can, and the honest part is knowing why.

The failure here needed a precondition that a fresh installation does not have — a bundle pool
already holding two versions of one library with the newer set incomplete, accumulated over
months of installs. A p2 install does not create that. It recomputes the wiring, and a wiring
that had been resolving around the flaw by luck stopped resolving.

So the risk is not zero and it is not ours to promise away. What makes it survivable:

- **An Eclipse from a zip package is one folder.** Install it, add ADT, check it works, then
  copy the folder. Recovery becomes a paste rather than an evening. This is worth more than
  any p2 revert, because it does not depend on p2 being able to read its own repositories.
- **The feature adds no third-party bundle.** One plugin, seven imports, all platform or ADT.
  It cannot introduce the duplicate that causes this class of failure.
- **Installation History is there** if the copy was not made.

## Ruling VERTEX in or out

The feature contributes exactly one bundle and declares seven imports, all of them platform or ADT:

```
org.eclipse.ui  org.eclipse.core.runtime  org.eclipse.core.resources
com.sap.adt.communication  com.sap.adt.project  com.sap.adt.tools.core.base
com.sap.adt.destinations.ui
```

No third-party library travels with it, so it cannot introduce a duplicate. If a resolution failure
survives uninstalling the feature, it is not in the plugin — though the install may well be what
forced the resolve that exposed it.
