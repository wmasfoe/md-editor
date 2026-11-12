import assert from "node:assert/strict";
import semver from "semver";

/** A public package must have a complete, public workspace dependency closure. */
export function selectPublicationPackages(packages, roots) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const selected = roots
    ? roots.map((name) => {
        const pkg = byName.get(name);
        assert.ok(pkg, `${name} is an unknown publication root`);
        assert.ok(!pkg.private, `${name} is private`);
        return pkg;
      })
    : packages.filter((pkg) => !pkg.private);
  const names = new Set(selected.map((pkg) => pkg.name));
  // Appending discovered packages visits their runtime closure too, including
  // peers and optional dependencies, without pulling in development-only tools.
  for (const pkg of selected) {
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    })) {
      const dependency = byName.get(name);
      assert.ok(!dependency?.private, `${pkg.name} depends on private package ${name}`);
      if (dependency && !names.has(name)) {
        names.add(name);
        selected.push(dependency);
      }
    }
  }
  return selected;
}

/** Validate the packed manifests, where workspace ranges have become npm ranges. */
export function validatePublicationClosure(manifests) {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  for (const manifest of manifests) {
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith("@md-editor/")) continue;
        // npm lets optionalDependencies override the same name in dependencies.
        if (section === "dependencies" && Object.hasOwn(manifest.optionalDependencies ?? {}, name))
          continue;
        const dependency = byName.get(name);
        const optional =
          section === "optionalDependencies" ||
          (section === "peerDependencies" && manifest.peerDependenciesMeta?.[name]?.optional);
        if (!dependency && optional) continue;
        assert.ok(dependency, `${manifest.name}: ${name} missing from publication closure`);
        assert.ok(
          semver.satisfies(dependency.version, range),
          `${manifest.name}: ${name}@${dependency.version} does not satisfy ${section} ${range}`,
        );
      }
    }
  }
}
