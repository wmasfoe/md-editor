import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { selectPublicationPackages, validatePublicationClosure } from "./publication.mjs";

test("public package closure excludes the six application packages", () => {
  const packages = readdirSync(new URL("../../packages/", import.meta.url)).map((name) =>
    JSON.parse(readFileSync(new URL(`../../packages/${name}/package.json`, import.meta.url))),
  );
  assert.deepEqual(
    selectPublicationPackages(packages)
      .map((pkg) => pkg.name)
      .toSorted(),
    [
      "@md-editor/compiler",
      "@md-editor/core",
      "@md-editor/editor",
      "@md-editor/markdown-fidelity",
      "@md-editor/plugin-host",
      "@md-editor/plugin-sdk",
      "@md-editor/shared",
      "@md-editor/syntax-plugins",
    ],
  );
});

test("public packages cannot depend on private workspace packages", () => {
  assert.throws(
    () =>
      selectPublicationPackages([
        { name: "@md-editor/public", dependencies: { "@md-editor/private": "workspace:*" } },
        { name: "@md-editor/private", private: true },
      ]),
    /public.*private/,
  );
});

const dependency = { name: "@md-editor/dependency", version: "0.1.2" };
const consumer = (fields) => ({ name: "@md-editor/consumer", version: "0.1.0", ...fields });

for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const range of ["0.1.2", "^0.1.0", "~0.1.0", ">=0.1.0 <0.2.0", "^0.1.0 || ^1.0.0"]) {
    test(`packed ${section} accepts ${range} independently of archive filenames`, () => {
      validatePublicationClosure([
        consumer({ [section]: { [dependency.name]: range } }),
        dependency,
      ]);
    });
  }
  test(`packed ${section} rejects incompatible versions`, () => {
    assert.throws(
      () =>
        validatePublicationClosure([
          consumer({ [section]: { [dependency.name]: "^0.2.0" } }),
          dependency,
        ]),
      /consumer.*dependency.*0\.1\.2.*\^0\.2\.0/,
    );
  });
}

for (const section of ["dependencies", "peerDependencies"]) {
  test(`packed ${section} rejects a missing internal package`, () => {
    assert.throws(
      () => validatePublicationClosure([consumer({ [section]: { [dependency.name]: "*" } })]),
      /dependency.*missing/,
    );
  });
}

test("absent optional dependencies and peers are allowed", () => {
  validatePublicationClosure([
    consumer({
      optionalDependencies: { [dependency.name]: "^0.1.0" },
      peerDependencies: { "@md-editor/optional-peer": "^1.0.0" },
      peerDependenciesMeta: { "@md-editor/optional-peer": { optional: true } },
    }),
  ]);
});

test("optional dependencies override regular dependency ranges", () => {
  validatePublicationClosure([
    consumer({
      dependencies: { [dependency.name]: "^1.0.0" },
      optionalDependencies: { [dependency.name]: "^0.1.0" },
    }),
    dependency,
  ]);
});

test("a required dependency is not made optional by peer metadata", () => {
  assert.throws(
    () =>
      validatePublicationClosure([
        consumer({
          dependencies: { [dependency.name]: "^0.1.0" },
          peerDependenciesMeta: { [dependency.name]: { optional: true } },
        }),
      ]),
    /dependency.*missing/,
  );
});

test("peer ranges are checked even when the same package is also a dependency", () => {
  assert.throws(
    () =>
      validatePublicationClosure([
        consumer({
          dependencies: { [dependency.name]: "^0.1.0" },
          peerDependencies: { [dependency.name]: "^1.0.0" },
        }),
        dependency,
      ]),
    /consumer.*dependency.*0\.1\.2.*\^1\.0\.0/,
  );
});
