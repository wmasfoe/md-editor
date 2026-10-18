/**
 * @file semver.ts
 * @description 版本号解析与比较（自 router.ts 拆出，行为不变）。
 */

function parseSemverComponents(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .replace(/^desktop-v/i, "")
    .replace(/^android-v/i, "")
    .replace(/^mobile-v/i, "")
    .split(".")
    .map((num) => parseInt(num, 10) || 0);
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemverComponents(a);
  const pb = parseSemverComponents(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
