"use strict";

/*
 * Vitrine Designer -- D2 Manifest-Validator.
 *
 * Minimaler, in sich geschlossener JSON-Schema-Auswerter (Draft-2020-12-
 * Teilmenge), reines Browser-JS ohne Abhaengigkeit -- kein Ajv, kein
 * @cfworker/json-schema zur Laufzeit im Browser (die Node-seitige Nutzung
 * dieser Bibliotheken in registry/ bleibt davon unberuehrt, siehe
 * THIRD-PARTY.md). Grund: Laufwerk Z: erlaubt keinen Build-Schritt fuer den
 * Designer (siehe app.js-Kopfkommentar aus D1) -- eine npm-Abhaengigkeit
 * muesste gebuendelt werden, was hier nicht geht.
 *
 * Dieser Auswerter ist absichtlich eine JS-Portierung von
 * mod/src/main/java/de/spassglas/vitrine/manifest/ManifestSchemaValidator.java:
 * gleiche Reihenfolge der Pruefungen, gleiche Formulierungen (Charter-Regel
 * 8 "Ein Schema, zwei Seiten" -- beide Seiten lesen dieselbe Datei
 * registry/schema/vitrine.schema.json und benennen dieselben Verstoesse).
 * Unterstuetzte Schluesselwoerter: type, required, properties,
 * additionalProperties (nur als false), pattern, enum, const, minLength,
 * maxLength, minItems, maxItems, uniqueItems, items -- exakt die Teilmenge,
 * die vitrine.schema.json tatsaechlich benutzt.
 *
 * Zwei Sichten auf dieselbe Pruefung:
 *   - validate(schema, instance)         -> flache Liste von Meldungen,
 *     mit derselben Zusammenfassung mehrerer fehlender Pflichtfelder wie
 *     der Java-Parser ("Pflichtfelder fehlen: 'a', 'b'").
 *   - validateDetailed(schema, instance) -> Liste von {field, message},
 *     ein Eintrag je Verstoss (auch bei mehreren fehlenden Pflichtfeldern
 *     je ein eigener Eintrag) -- fuer die Live-Anzeige direkt am Formularfeld.
 *
 * Kein DOM-Zugriff in dieser Datei -- unter Node direkt testbar (siehe
 * designer/test/schema-validate.test.js) und im Browser per <script>
 * eingebunden (kein type="module", siehe D1-Begruendung).
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.VitrineSchemaValidator = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  var PATTERN_HINTS = {
    id: "Namespace-Bezeichner mit mindestens zwei durch Punkt getrennten " +
      "Kleinbuchstaben/Ziffern/Bindestrich-Segmenten, z. B. 'autor.paketname'",
    version: "Semantic Versioning 2.0.0, z. B. '1.0.0'",
    capabilities: "punktgetrennter Kleinbuchstaben-Bezeichner, z. B. 'hud.read'",
    icon: "relativer Pfad ohne '..' und ohne fuehrenden '/', endet auf '.png'",
    screenshots: "relativer Pfad ohne '..' und ohne fuehrenden '/', " +
      "endet auf '.png', '.jpg' oder '.jpeg'",
    homepage: "muss mit 'https://' beginnen"
  };

  function baseFieldName(fieldPath) {
    var bracket = fieldPath.indexOf("[");
    return bracket >= 0 ? fieldPath.substring(0, bracket) : fieldPath;
  }

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function describeType(value) {
    if (value === null || value === undefined) {
      return "null";
    }
    if (Array.isArray(value)) {
      return "array";
    }
    if (typeof value === "object") {
      return "object";
    }
    if (typeof value === "string") {
      return "string";
    }
    if (typeof value === "boolean") {
      return "boolean";
    }
    if (typeof value === "number") {
      return Number.isInteger(value) ? "integer" : "number";
    }
    return "unbekannt";
  }

  function matchesType(type, value) {
    switch (type) {
      case "object":
        return isPlainObject(value);
      case "array":
        return Array.isArray(value);
      case "string":
        return typeof value === "string";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "number":
        return typeof value === "number";
      case "boolean":
        return typeof value === "boolean";
      default:
        return true;
    }
  }

  function deepEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      for (var i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  function isMissing(value) {
    return value === undefined || value === null;
  }

  /** Fuegt fuer jedes fehlende Pflichtfeld einen eigenen Eintrag an (kind: "required"). */
  function checkRequired(schema, instance, out) {
    if (!schema.required) {
      return;
    }
    schema.required.forEach(function (fieldName) {
      if (!Object.prototype.hasOwnProperty.call(instance, fieldName) || isMissing(instance[fieldName])) {
        out.push({ field: fieldName, kind: "required", message: "Pflichtfeld '" + fieldName + "' fehlt" });
      }
    });
  }

  function checkAdditionalProperties(schema, instance, out) {
    if (schema.additionalProperties !== false) {
      return;
    }
    var properties = schema.properties || {};
    Object.keys(instance).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        out.push({
          field: key,
          kind: "additional",
          message: "Unbekanntes Feld '" + key + "' ist nicht erlaubt (zusaetzliche Felder " +
            "sind in diesem Schema nicht zugelassen)"
        });
      }
    });
  }

  function validateObject(schema, instance, out) {
    checkRequired(schema, instance, out);
    checkAdditionalProperties(schema, instance, out);

    var properties = schema.properties || {};
    Object.keys(properties).forEach(function (fieldName) {
      if (Object.prototype.hasOwnProperty.call(instance, fieldName) && !isMissing(instance[fieldName])) {
        validateValue(fieldName, properties[fieldName], instance[fieldName], out);
      }
    });
  }

  function validateValue(fieldPath, schema, value, out) {
    var type = schema.type;
    if (type && !matchesType(type, value)) {
      out.push({
        field: fieldPath,
        kind: "type",
        message: "Feld '" + fieldPath + "' hat falschen Typ: erwartet " + type +
          ", gefunden " + describeType(value)
      });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(schema, "const")) {
      if (!deepEqual(schema.const, value)) {
        out.push({
          field: fieldPath,
          kind: "const",
          message: "Feld '" + fieldPath + "' hat ungueltigen Wert: erwartet genau " + schema.const +
            ", gefunden " + value
        });
      }
    }

    if (schema.enum) {
      var matches = schema.enum.some(function (candidate) {
        return deepEqual(candidate, value);
      });
      if (!matches) {
        out.push({
          field: fieldPath,
          kind: "enum",
          message: "Feld '" + fieldPath + "' hat ungueltigen Wert '" + value + "', erlaubt sind: " +
            schema.enum.join(", ")
        });
      }
    }

    if (type === "string") {
      validateString(fieldPath, schema, value, out);
    } else if (type === "array") {
      validateArray(fieldPath, schema, value, out);
    }
  }

  function validateString(fieldPath, schema, actual, out) {
    if (schema.minLength !== undefined) {
      var minLength = schema.minLength;
      if (actual.length < minLength) {
        if (minLength <= 1 && actual.length === 0) {
          out.push({ field: fieldPath, kind: "minLength", message: "Feld '" + fieldPath + "' darf nicht leer sein" });
        } else {
          out.push({
            field: fieldPath,
            kind: "minLength",
            message: "Feld '" + fieldPath + "' ist zu kurz: mindestens " + minLength +
              " Zeichen erforderlich, hat " + actual.length
          });
        }
      }
    }
    if (schema.maxLength !== undefined && actual.length > schema.maxLength) {
      out.push({
        field: fieldPath,
        kind: "maxLength",
        message: "Feld '" + fieldPath + "' ist zu lang: hoechstens " + schema.maxLength +
          " Zeichen erlaubt, hat " + actual.length
      });
    }
    if (schema.pattern) {
      var regex = new RegExp(schema.pattern);
      if (!regex.test(actual)) {
        var hint = PATTERN_HINTS[baseFieldName(fieldPath)];
        out.push({
          field: fieldPath,
          kind: "pattern",
          message: "Feld '" + fieldPath + "' entspricht nicht dem erwarteten Muster" +
            (hint ? " (" + hint + ")" : " (" + schema.pattern + ")") + ": '" + actual + "'"
        });
      }
    }
  }

  function validateArray(fieldPath, schema, actual, out) {
    if (schema.minItems !== undefined && actual.length < schema.minItems) {
      out.push({
        field: fieldPath,
        kind: "minItems",
        message: "Feld '" + fieldPath + "' hat zu wenige Eintraege: mindestens " + schema.minItems +
          " erforderlich, hat " + actual.length
      });
    }
    if (schema.maxItems !== undefined && actual.length > schema.maxItems) {
      out.push({
        field: fieldPath,
        kind: "maxItems",
        message: "Feld '" + fieldPath + "' hat zu viele Eintraege: hoechstens " + schema.maxItems +
          " erlaubt, hat " + actual.length
      });
    }
    if (schema.uniqueItems) {
      var seen = {};
      for (var i = 0; i < actual.length; i++) {
        var key = JSON.stringify(actual[i]);
        if (Object.prototype.hasOwnProperty.call(seen, key)) {
          out.push({
            field: fieldPath,
            kind: "uniqueItems",
            message: "Feld '" + fieldPath + "' enthaelt den doppelten Eintrag '" + actual[i] + "'"
          });
          break;
        }
        seen[key] = true;
      }
    }
    if (schema.items) {
      for (var j = 0; j < actual.length; j++) {
        validateValue(fieldPath + "[" + j + "]", schema.items, actual[j], out);
      }
    }
  }

  /**
   * Strukturierte Verstoss-Liste, ein Eintrag je Regel (auch bei mehreren
   * fehlenden Pflichtfeldern je ein eigener Eintrag) -- fuer die Anzeige
   * direkt am jeweiligen Formularfeld.
   */
  function validateDetailed(schema, instance) {
    var out = [];
    if (!isPlainObject(instance)) {
      out.push({ field: null, kind: "root", message: "Wurzelelement ist kein JSON-Objekt, sondern " + describeType(instance) });
      return out;
    }
    validateObject(schema, instance, out);
    return out;
  }

  /**
   * Flache Meldungsliste, wortgleich zu ManifestSchemaValidator#validate auf
   * der Java-Seite: mehrere fehlende Pflichtfelder werden zu einer
   * gemeinsamen Meldung zusammengefasst ("Pflichtfelder fehlen: 'a', 'b'"),
   * alle anderen Meldungen folgen einzeln in derselben Reihenfolge.
   */
  function validate(schema, instance) {
    var entries = validateDetailed(schema, instance);
    var strings = [];

    var missingRequired = entries
      .filter(function (e) { return e.kind === "required"; })
      .map(function (e) { return e.field; });

    if (missingRequired.length === 1) {
      strings.push("Pflichtfeld '" + missingRequired[0] + "' fehlt");
    } else if (missingRequired.length > 1) {
      strings.push("Pflichtfelder fehlen: " + missingRequired.map(function (n) { return "'" + n + "'"; }).join(", "));
    }

    entries.forEach(function (e) {
      if (e.kind !== "required") {
        strings.push(e.message);
      }
    });

    return strings;
  }

  return {
    validate: validate,
    validateDetailed: validateDetailed,
    describeType: describeType,
    baseFieldName: baseFieldName
  };
});
