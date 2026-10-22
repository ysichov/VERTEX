// Build a releasable VSIX. Do not call vsce with --no-dependencies: that switch
// produces an extension which installs but cannot load abap-adt-api.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const targets = ["universal", "win32-x64", "darwin-arm64"];
const required = [
    "extension/THIRD-PARTY-NOTICES.md",
    "extension/package.json",
    "extension/node_modules/abap-adt-api/package.json",
    "extension/node_modules/abap-adt-api/LICENSE",
    "extension/node_modules/@abaplint/core/package.json",
    "extension/node_modules/@abaplint/core/build/src/index.js",
    "extension/licenses/abaplint-MIT.txt",
    "extension/node_modules/@abaplint/transpiler-cli/abap_transpile",
    "extension/node_modules/@abaplint/runtime/package.json",
    "extension/vendor/open-abap-core/LICENSE",
    "extension/vendor/open-abap-core/REVISION",
    "extension/vendor/open-abap-core/src/ddic/dtel/mandt.dtel.xml",
    "extension/vendor/open-abap-core/src/exceptions/cx_sy_zerodivide.clas.abap",
    "extension/node_modules/temporal-polyfill/package.json",
    "extension/node_modules/temporal-spec/package.json",
    "extension/node_modules/temporal-utils/package.json",
    "extension/local-run.js",
    "extension/local-trace.js",
    "extension/local-debug-vars.js",
    "extension/local-debug-adapter.js",
    "extension/value-origin-linter.js",
    "extension/value-origin-demand.js",
    "extension/frontend-analysis.js",
    "extension/call-graph.js",
    "extension/ace-scheme.js",
    "extension/log-report.js",
    "extension/log-snapshot.js",
    "extension/resources/mermaid.min.js",
    "extension/pages/sap-debug-runs.html",
    "extension/assistant-debug-recording.js",
    "extension/resources/log-report.html",
    "extension/resources/metrics.html",
    "extension/resources/versions.html",
    "extension/pages/visual-debug.html",
    "extension/node_modules/@mcp-abap-adt/auth-broker/package.json",
    "extension/node_modules/@mcp-abap-adt/auth-broker/COPYING",
    "extension/node_modules/@mcp-abap-adt/auth-broker/LICENSE",
    "extension/node_modules/@mcp-abap-adt/auth-errors/package.json",
    "extension/node_modules/@mcp-abap-adt/auth-errors/COPYING",
    "extension/node_modules/@mcp-abap-adt/auth-errors/LICENSE",
    "extension/node_modules/@mcp-abap-adt/auth-providers/package.json",
    "extension/node_modules/@mcp-abap-adt/auth-providers/COPYING",
    "extension/node_modules/@mcp-abap-adt/auth-providers/LICENSE",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth-broker/package.json",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth-broker/COPYING",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth-broker/LICENSE",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth-sap/package.json",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth-sap/COPYING",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth-sap/LICENSE",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth/package.json",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth/COPYING",
    "extension/node_modules/@mcp-abap-adt/interfaces-auth/LICENSE",
    "extension/node_modules/@mcp-abap-adt/interfaces-utils/package.json",
    "extension/node_modules/@mcp-abap-adt/interfaces-utils/COPYING",
    "extension/node_modules/@mcp-abap-adt/interfaces-utils/LICENSE",
    "extension/node_modules/@mcp-abap-adt/auth-stores/package.json",
    "extension/node_modules/@mcp-abap-adt/auth-stores/COPYING",
    "extension/node_modules/@mcp-abap-adt/auth-stores/LICENSE",
    "extension/node_modules/@mcp-abap-adt/connection/package.json",
    "extension/node_modules/@mcp-abap-adt/connection/COPYING",
    "extension/node_modules/@mcp-abap-adt/connection/LICENSE",
    "extension/node_modules/@mcp-abap-adt/interfaces-adt-connection/package.json",
    "extension/node_modules/@mcp-abap-adt/interfaces-adt-connection/COPYING",
    "extension/node_modules/@mcp-abap-adt/interfaces-adt-connection/LICENSE",
    "extension/node_modules/@mcp-abap-adt/interfaces-network/package.json",
    "extension/node_modules/@mcp-abap-adt/interfaces-network/COPYING",
    "extension/node_modules/@mcp-abap-adt/interfaces-network/LICENSE"
];

function checkArchivePolicy(names, target) {
    if (!targets.includes(target)) throw new Error("Invalid target: " + target);
    const fail = message => { throw new Error("VSIX verification failed: " + message); };
    const bindings = names.filter(name => /[^/]*\+sap-rfc-lite[^/]*\.node$/i.test(name));
    for (const name of names) {
        const leaf = name.split("/").pop();
        if (/^dev_rfc.*\.log$/i.test(leaf)) fail("RFC diagnostic log " + name);
        if (/^(sapnwrfc\.dll|libsapnwrfc\.(so|dylib)|libsapucum\..*|sapucum\.dll|(?:icudt|icuin|icuuc|libicu)[^/]*)$/i.test(leaf)) fail("SAP SDK library " + name);
        if (/^sapnwrfc\.node$/i.test(leaf)) fail("local binding " + name);
    }
    if (target === "universal") {
        for (const platform of ["win32-x64", "darwin-arm64"])
            if (!bindings.some(name => name.includes("/node_modules/@mcp-abap-adt/sap-rfc-lite/prebuilds/" + platform + "/")))
                fail("missing " + platform + " sap-rfc-lite prebuilt binding.");
        for (const name of bindings)
            if (!/\/prebuilds\/(?:win32-x64|darwin-arm64)\//.test(name)) fail("unexpected binding " + name);
    } else {
        const own = "/node_modules/@mcp-abap-adt/sap-rfc-lite/prebuilds/" + target + "/";
        if (!bindings.some(name => name.includes(own))) fail("missing " + target + " sap-rfc-lite prebuilt binding.");
        for (const name of bindings) if (!name.includes(own)) fail("unexpected binding " + name);
    }
    if (!names.includes("extension/THIRD-PARTY-NOTICES.md")) fail("missing extension/THIRD-PARTY-NOTICES.md");
}

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// VSCE emits ordinary ZIPs. Reject ZIP64, multi-disk and encrypted archives explicitly.
// Central sizes also support entries whose local sizes live in a data descriptor.
function readZip(buffer) {
    const invalid = () => { throw new Error("Invalid or unsupported VSIX ZIP"); };
    const range = (offset, size) => { if (offset < 0 || offset + size > buffer.length) invalid(); };
    let end = buffer.length - 22;
    for (; end >= Math.max(0, buffer.length - 65557); end--) {
        if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break;
    }
    if (end < Math.max(0, buffer.length - 65557)) invalid();
    if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) invalid();
    const count = buffer.readUInt16LE(end + 10);
    const size = buffer.readUInt32LE(end + 12);
    let cursor = buffer.readUInt32LE(end + 16);
    const centralEnd = cursor + size;
    if (count === 65535 || count !== buffer.readUInt16LE(end + 8) || centralEnd !== end) invalid();
    const entries = new Map();
    for (let i = 0; i < count; i++) {
        range(cursor, 46);
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) invalid();
        const flags = buffer.readUInt16LE(cursor + 8);
        const method = buffer.readUInt16LE(cursor + 10);
        const crc = buffer.readUInt32LE(cursor + 16);
        const compressed = buffer.readUInt32LE(cursor + 20);
        const uncompressed = buffer.readUInt32LE(cursor + 24);
        const nameSize = buffer.readUInt16LE(cursor + 28);
        const next = cursor + 46 + nameSize + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
        const local = buffer.readUInt32LE(cursor + 42);
        if (flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || buffer.readUInt16LE(cursor + 34) || next > centralEnd) invalid();
        range(cursor, next - cursor);
        const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameSize);
        if (entries.has(name)) invalid();
        range(local, 30);
        if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) invalid();
        const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
        range(local, start - local);
        if (buffer.toString("utf8", local + 30, local + 30 + buffer.readUInt16LE(local + 26)) !== name || start + compressed > buffer.readUInt32LE(end + 16)) invalid();
        if (flags & 8) {
            const descriptor = start + compressed;
            const matches = offset => offset + 12 <= buffer.readUInt32LE(end + 16) &&
                buffer.readUInt32LE(offset) === crc && buffer.readUInt32LE(offset + 4) === compressed && buffer.readUInt32LE(offset + 8) === uncompressed;
            // Try both layouts: an unsigned descriptor's CRC can equal the signature.
            if (!matches(descriptor) && !(descriptor + 16 <= buffer.readUInt32LE(end + 16) && buffer.readUInt32LE(descriptor) === 0x08074b50 && matches(descriptor + 4))) invalid();
        } else if (buffer.readUInt32LE(local + 14) !== crc || buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== uncompressed) invalid();
        entries.set(name, () => {
            const packed = buffer.subarray(start, start + compressed);
            const inflated = method === 8 ? zlib.inflateRawSync(packed, { info: true, maxOutputLength: Math.max(1, uncompressed) }) : null;
            if (inflated && inflated.engine.bytesWritten !== compressed) invalid();
            const data = inflated ? inflated.buffer : packed;
            if (data.length !== uncompressed || crc32(data) !== crc) invalid();
            return data;
        });
        cursor = next;
    }
    if (cursor !== centralEnd) invalid();
    return entries;
}

function run(command, args, options = {}) {
    const windows = process.platform === "win32" && ["npm", "npx"].includes(command);
    // Invoke npm's CLI directly so cmd.exe cannot expand %...% in paths.
    // If Node has no adjacent npm install, the shim receives only safe relative
    // arguments (including the output filename); cwd is passed without a shell.
    const cli = windows ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", command + "-cli.js") : null;
    const shell = windows && !fs.existsSync(cli);
    if (shell && args.some(arg => !/^[a-zA-Z0-9@/._-]+$/.test(arg))) throw new Error("Unsafe Windows shim argument");
    const result = spawnSync(windows ? (shell ? command + ".cmd" : process.execPath) : command,
        windows && !shell ? [cli, ...args] : args,
        { cwd: __dirname, stdio: "inherit", ...options, shell });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(command + " failed (exit " + result.status + ")");
}

function main(args) {
    let target = "universal", keepNodeModules = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--target" && targets.includes(args[i + 1])) target = args[++i];
        else if (args[i] === "--keep-node-modules") keepNodeModules = true;
        else throw new Error("Usage: node package.js [--target universal|win32-x64|darwin-arm64] [--keep-node-modules]");
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
    const stem = manifest.name + "-" + manifest.version + (target === "universal" ? "" : "-" + target);
    const final = path.join(__dirname, stem + ".vsix");
    const candidate = path.join(__dirname, stem + ".candidate.vsix");
    const rfcRoots = ["node_modules/@mcp-abap-adt/sap-rfc-lite", "node_modules/@mcp-abap-adt/connection/node_modules/@mcp-abap-adt/sap-rfc-lite"];
    fs.rmSync(candidate, { force: true });
    try {
        run("npm", ["ci"]);
        const installed = rfcRoots.filter(relative => fs.existsSync(path.join(__dirname, relative)));
        if (!installed.length) throw new Error("Missing optional sap-rfc-lite package.");
        for (const relative of installed) {
            const rfc = path.resolve(__dirname, relative);
            const prebuilds = path.join(rfc, "prebuilds");
            const keep = target === "universal" ? ["win32-x64", "darwin-arm64"] : [target];
            for (const platform of keep) {
                const own = path.join(prebuilds, platform);
                if (!fs.existsSync(own) || !fs.readdirSync(own, { withFileTypes: true }).some(file => file.isFile() && file.name.endsWith(".node"))) throw new Error("Missing sap-rfc-lite prebuilds/" + platform + "/*.node.");
            }
            const remove = fs.readdirSync(prebuilds, { withFileTypes: true }).filter(dir => dir.isDirectory() && !keep.includes(dir.name)).map(dir => path.join(prebuilds, dir.name));
            remove.push(path.join(rfc, "build"));
            for (const item of remove) {
                if (!path.resolve(item).startsWith(rfc + path.sep)) throw new Error("Refusing to remove path outside sap-rfc-lite: " + item);
                fs.rmSync(item, { recursive: true, force: true });
            }
        }
        run("npx", ["--yes", "@vscode/vsce", "package", "--out", process.platform === "win32" ? path.basename(candidate) : candidate, ...(target === "universal" ? [] : ["--target", target])]);
        const archive = readZip(fs.readFileSync(candidate));
        const names = [...archive.keys()];
        console.log(names.join("\n"));
        checkArchivePolicy(names, target);
        const expected = [...required];
        for (const relative of installed) for (const file of ["package.json", "LICENSE", "NOTICE"]) expected.push("extension/" + relative + "/" + file);
        for (const name of expected) if (!archive.has(name)) throw new Error("VSIX verification failed: missing " + name);
        // Read every entry, including directories, before promotion.
        for (const read of archive.values()) read();
        const metrics = archive.get("extension/resources/metrics.html")().toString("utf8");
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-package-"));
        try {
            const page = path.join(temp, "metrics.html");
            fs.writeFileSync(page, metrics);
            run(process.execPath, ["--test", path.join(__dirname, "test", "scheme-navigation.test.js")], { env: { ...process.env, VERTEX_METRICS_HTML: page } });
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
        for (const needle of ['function renderUmlParts()', 'var UML_SECTIONS', 'mode === "scheme" && classMetrics()']) if (!metrics.includes(needle)) throw new Error("VSIX verification failed: UML Parts navigator is missing " + needle);
        const inside = JSON.parse(archive.get("extension/package.json")().toString("utf8"));
        if (inside.version !== manifest.version) throw new Error("VSIX verification failed: expected version " + manifest.version + ", got " + inside.version);
        fs.renameSync(candidate, final);
        console.log("Verified VSIX: " + final);
    } finally {
        try { fs.rmSync(candidate, { force: true }); }
        finally {
            if (!keepNodeModules) {
                console.log("Restoring the developer install with npm ci (use --keep-node-modules to keep the target install).");
                run("npm", ["ci"]);
            }
        }
    }
}
module.exports = { checkArchivePolicy, readZip, crc32 };
if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
