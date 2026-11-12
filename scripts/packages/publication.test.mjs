import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { selectPublicationPackages, validatePublicationClosure } from "./publication.mjs";

const workspacePackages = () =>
  readdirSync(new URL("../../packages/", import.meta.url)).map((name) =>
    JSON.parse(readFileSync(new URL(`../../packages/${name}/package.json`, import.meta.url))),
  );

test("packed editor SDK consumers accept one shared compatible SDK patch", () => {
  const consumers = ["@md-editor/core", "@md-editor/editor", "@md-editor/plugin-host"];
  const sdk = workspacePackages().find((pkg) => pkg.name === "@md-editor/plugin-sdk");
  const nextPatch = semver.inc(sdk.version, "patch");
  const directory = mkdtempSync(join(tmpdir(), "inkpoint-sdk-ranges-"));
  try {
    // Only inspect pnpm's converted manifests here; dist consumption is verified
    // separately, and this regression must also work before the first build.
    execFileSync(
      "pnpm",
      [
        ...consumers.flatMap((name) => ["--filter", name]),
        "-r",
        "pack",
        "--config.ignore-scripts=true",
        "--pack-destination",
        directory,
      ],
      { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: "pipe" },
    );
    assert.equal(readdirSync(directory).length, consumers.length);
    for (const file of readdirSync(directory)) {
      const pkg = JSON.parse(
        execFileSync("tar", ["-xOf", join(directory, file), "package/package.json"], {
          encoding: "utf8",
        }),
      );
      const range = pkg.dependencies[sdk.name];
      assert.ok(
        semver.satisfies(nextPatch, range),
        `${pkg.name}: ${sdk.name}@${nextPatch} does not satisfy ${range}`,
      );
      assert.ok(!semver.satisfies("0.1.0", range), `${pkg.name} accepts the incompatible SDK`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public package closure excludes the six application packages", () => {
  assert.deepEqual(
    selectPublicationPackages(workspacePackages())
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

test("core/editor publication includes only their six runtime packages", () => {
  assert.deepEqual(
    selectPublicationPackages(workspacePackages(), ["@md-editor/core", "@md-editor/editor"])
      .map((pkg) => pkg.name)
      .toSorted(),
    [
      "@md-editor/core",
      "@md-editor/editor",
      "@md-editor/markdown-fidelity",
      "@md-editor/plugin-host",
      "@md-editor/plugin-sdk",
      "@md-editor/shared",
    ],
  );
});

test("repeated roots produce each package once in first-seen order", () => {
  const packages = [
    { name: "@md-editor/first", dependencies: { "@md-editor/shared": "workspace:*" } },
    { name: "@md-editor/second", dependencies: { "@md-editor/shared": "workspace:*" } },
    { name: "@md-editor/shared" },
  ];
  assert.deepEqual(
    selectPublicationPackages(packages, [
      "@md-editor/second",
      "@md-editor/first",
      "@md-editor/second",
      "@md-editor/first",
    ]).map((pkg) => pkg.name),
    ["@md-editor/second", "@md-editor/first", "@md-editor/shared"],
  );
});

test("scoped publication follows runtime and peer cycles but ignores dev dependencies", () => {
  const packages = [
    {
      name: "@md-editor/root",
      dependencies: { "@md-editor/dependency": "workspace:*" },
      devDependencies: { "@md-editor/private": "workspace:*" },
    },
    {
      name: "@md-editor/dependency",
      optionalDependencies: { "@md-editor/optional": "workspace:*" },
      peerDependencies: { "@md-editor/root": "*" },
    },
    { name: "@md-editor/optional" },
    { name: "@md-editor/private", private: true },
    { name: "@md-editor/deferred" },
  ];
  assert.deepEqual(
    selectPublicationPackages(packages, ["@md-editor/root"]).map((pkg) => pkg.name),
    ["@md-editor/root", "@md-editor/dependency", "@md-editor/optional"],
  );
});

test("scoped publication rejects unknown and private roots", () => {
  const packages = [{ name: "@md-editor/private", private: true }];
  assert.throws(
    () => selectPublicationPackages(packages, ["@md-editor/missing"]),
    /missing.*unknown/,
  );
  assert.throws(
    () => selectPublicationPackages(packages, ["@md-editor/private"]),
    /private.*private/,
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
