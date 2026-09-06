#!/usr/bin/env node
"use strict";

/*
 * Vitrine CLI -- Einstiegspunkt (ROADMAP D7). Subcommands: init, validate,
 * pack, sign. Keine neue npm-Abhaengigkeit (Charter-Regel 5): Argument-
 * Parsing von Hand, Validierung ueber designer/schema-validate.js (Charter-
 * Regel 8: "Ein Schema, zwei Seiten"), ZIP-Bau und Ed25519-Signatur nur mit
 * Node-Bordmitteln (siehe cli/lib/zip-writer.js, cli/lib/signing.js).
 *
 * Aufruf: node cli/vitrine.js <subcommand> [...] | npx vitrine <subcommand> [...]
 */

const fs = require("node:fs");
const path = require("node:path");

const { validateManifest, SCHEMA_PATH } = require("./lib/schema.js");
const { defaultManifest, README_TEXT } = require("./lib/init-template.js");
const { packDirectory, MANIFEST_ENTRY_NAME } = require("./lib/pack.js");
const { signFile, defaultKeyDir } = require("./lib/signing.js");

const USAGE = `Vitrine CLI

Verwendung:
  node cli/vitrine.js init <ordner>
  node cli/vitrine.js validate <ordner>
  node cli/vitrine.js pack <ordner> <ausgabe.vpkg>
  node cli/vitrine.js sign <paket.vpkg>

  node cli/vitrine.js --help
`;

function fail(message) {
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}

// --- init ------------------------------------------------------------------

function cmdInit(args) {
  const targetDir = args[0];
  if (!targetDir) {
    fail("init: Ordnerpfad fehlt. Verwendung: node cli/vitrine.js init <ordner>");
    return;
  }
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    fail("init: Ordner '" + targetDir + "' existiert bereits und ist nicht leer -- init bricht ab, statt etwas zu ueberschreiben.");
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, "assets"), { recursive: true });

  const manifestPath = path.join(targetDir, MANIFEST_ENTRY_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(defaultManifest(), null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(targetDir, "README.md"), README_TEXT, "utf8");
  // Platzhalter, damit der leere "assets"-Ordner in git ueberlebt -- kein Asset, nur ein Marker.
  fs.writeFileSync(path.join(targetDir, "assets", ".gitkeep"), "", "utf8");

  process.stdout.write(
    "Projekt angelegt in '" + targetDir + "':\n" +
      "  " + manifestPath + "\n" +
      "  " + path.join(targetDir, "README.md") + "\n" +
      "  " + path.join(targetDir, "assets") + "\\ (leer)\n"
  );
}

// --- validate ----------------------------------------------------------------

function readManifestInstance(folder) {
  const manifestPath = path.join(folder, MANIFEST_ENTRY_NAME);
  if (!fs.existsSync(folder)) {
    throw new Error("Ordner '" + folder + "' existiert nicht");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Datei '" + manifestPath + "' existiert nicht");
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  let instance;
  try {
    instance = JSON.parse(raw);
  } catch (e) {
    throw new Error("'" + manifestPath + "' ist kein gueltiges JSON: " + e.message);
  }
  return { manifestPath, instance };
}

function cmdValidate(args) {
  const folder = args[0];
  if (!folder) {
    fail("validate: Ordnerpfad fehlt. Verwendung: node cli/vitrine.js validate <ordner>");
    return;
  }

  let manifestPath;
  let instance;
  try {
    ({ manifestPath, instance } = readManifestInstance(folder));
  } catch (e) {
    fail("validate: " + e.message);
    return;
  }

  const errors = validateManifest(instance);
  if (errors.length === 0) {
    process.stdout.write(
      "'" + manifestPath + "' ist gueltig (keine Verstoesse gegen " + path.relative(process.cwd(), SCHEMA_PATH) + ")\n"
    );
    return;
  }

  process.stderr.write("'" + manifestPath + "' verletzt das Manifest-Schema:\n");
  for (const message of errors) {
    process.stderr.write("  - " + message + "\n");
  }
  process.exitCode = 1;
}

// --- pack --------------------------------------------------------------------

function cmdPack(args) {
  const [sourceDir, outputPath] = args;
  if (!sourceDir || !outputPath) {
    fail("pack: Argumente fehlen. Verwendung: node cli/vitrine.js pack <ordner> <ausgabe.vpkg>");
    return;
  }
  if (!fs.existsSync(sourceDir)) {
    fail("pack: Ordner '" + sourceDir + "' existiert nicht");
    return;
  }

  try {
    const result = packDirectory(sourceDir, outputPath);
    process.stdout.write(
      "'" + outputPath + "' gebaut: " + result.entries.length + " Eintraege, " + result.byteLength + " Bytes\n"
    );
  } catch (e) {
    fail("pack: " + e.message);
  }
}

// --- sign ----------------------------------------------------------------------

function cmdSign(args) {
  const vpkgPath = args[0];
  if (!vpkgPath) {
    fail("sign: Paketpfad fehlt. Verwendung: node cli/vitrine.js sign <paket.vpkg>");
    return;
  }

  try {
    const { sidecarPath, keyInfo } = signFile(vpkgPath);
    process.stdout.write(
      "'" + vpkgPath + "' signiert.\n" +
        "  Begleitdatei: " + sidecarPath + "\n" +
        "  Schluessel: " + keyInfo.privateKeyPath + (keyInfo.generated ? " (neu erzeugt)" : " (vorhanden)") + "\n"
    );
  } catch (e) {
    fail("sign: " + e.message);
  }
}

// --- Einstieg --------------------------------------------------------------------

function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case "init":
      cmdInit(rest);
      break;
    case "validate":
      cmdValidate(rest);
      break;
    case "pack":
      cmdPack(rest);
      break;
    case "sign":
      cmdSign(rest);
      break;
    default:
      fail("Unbekanntes Subcommand '" + command + "'.\n\n" + USAGE);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, defaultKeyDir };
