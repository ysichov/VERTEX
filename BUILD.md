# Building and publishing

Both halves of VERTEX are built by hand, from the same sources, and this is how. Nothing here is
needed to *use* it: installing is in [README.md](README.md), and getting out of a bad install is in
[INSTALL.md](INSTALL.md).

## The Eclipse update site

Eclipse installs **features**, not bare plugins, so `org.vertex.abap.feature/` wraps the one
plugin and `category.xml` beside it gives the install dialog something to list.

Empty `docs/` first, keeping `.nojekyll` and `index.html`: the export **adds to** an existing
`content.jar` instead of replacing it, and three exports in a row leave three builds in the
catalogue. `index.html` is not part of the p2 repository and Eclipse never reads it; it is there
because the address is a link people click, and a bare p2 repository answers a browser with a
404. It tells whoever landed there to paste the address into Help → Install New Software.

**Two files pin the compiler to Java 21, and they are read by different things.**
`javacSource` and `javacTarget` in `org.vertex.abap.ui/build.properties` are what the
*export* obeys; `org.vertex.abap.ui/.settings/org.eclipse.jdt.core.prefs` is what the
workspace build obeys. Neither covers for the other. Without them the build follows
whichever JRE the workspace bound to the `JavaSE-21` execution environment, and on an
Eclipse carrying only a newer one that lands at 26 against a compliance of 21. Eclipse
tolerates the mismatch; the export does not. It fails with *Compliance level '21' is incompatible with target level '26'*, and
still writes a jar — **with the resources and no class files at all**. That plugin installs
and does nothing. It cost one release on 12 September 2026, and the log that said so was
inside the `logs.zip` the export drops into the target folder. Delete that zip before
committing; it is the export's own log, not part of the repository.

File → Export → Plug-in Development → **Deployable features** → tick
`org.vertex.abap.feature` → a destination directory → the *Options* tab → **Generate p2
repository**, and point *Categorize repository* at `category.xml`. What comes out is a p2
repository: `content.jar`, `artifacts.jar`, `features/` and `plugins/`. Ticking **Export
source** as well puts the Java sources beside the plugin, which is what the category already
refers to.

`docs/` is published by GitHub Pages from the `main` branch, which is where the address above
comes from. **Pages is not required** to hand the build over, though:

| Route | How a user installs it | Cost |
|---|---|---|
| Zip it, attach to a GitHub Release | Help → Install New Software → Add → **Archive** → the zip | Nothing to host; no update checks |
| Publish it at a URL, e.g. GitHub Pages | Help → Install New Software → Add → the URL | Needs Pages on; Eclipse can then check for updates |

The second is what an update site is for, and the only one where *Check for Updates* finds a new
version. The first is enough to give somebody a build.

The plugin stays a jar (`unpack="false"`): the pages are read with `Bundle.getEntry`, which
reads from inside one.

## The VS Code extension

`vscode/` has no dependencies and no build step of its own. Packaging is
[vsce](https://www.npmjs.com/package/@vscode/vsce):

```bash
npx @vscode/vsce package
```

The one thing that is not obvious: **the pages live in the Eclipse plugin's bundle**, and a vsix
carries only the extension folder. `vscode:prepublish` runs `copy-pages.js`, which copies them into
`vscode/resources/`, and `extension.js` prefers that folder when it exists and falls back to the
sibling plugin when running from a checkout. One source of truth, one copy made at packaging time,
nothing to decide at run time. `vscode/resources/` is in `.gitignore` for the same reason.

Check the result before publishing: the vsix must list `resources/metrics.html`, `resources/table.html`
and `resources/versions.html`. Without them the extension installs and every window opens blank.

Publishing needs a publisher on the Marketplace and a Personal Access Token from Azure DevOps with
the Marketplace / Manage scope:

```bash
npx @vscode/vsce login YuriiSychov
```

Then `vsce publish`, or upload the vsix on the Marketplace page. The Marketplace refuses a second
upload of a version it already has, so bump `version` in `package.json` first. The publisher in
`package.json` must match the account exactly.

## The landing page

`docs/index.html` is not part of the p2 repository and Eclipse never reads it. It is there
because the update-site address is a link people click, and a bare p2 repository answers a
browser with a 404. It carries two things that go stale on their own: the **version** and a
short **what's new**. Both are written by hand, next to each other, and both belong in the
same edit as the version bump below.

## Versions

The Eclipse bundle and the VS Code extension carry the same number by hand; nothing enforces it.
`0.2.1.qualifier` in `MANIFEST.MF` and in `feature.xml` becomes `0.2.1.<build timestamp>` on export,
so every export is a distinct version and *Check for Updates* can see it.

