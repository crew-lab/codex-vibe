const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(value: string): bigint[] | undefined {
  return value.length <= 64 && STABLE_VERSION.test(value) ? value.split('.').map((part) => BigInt(part)) : undefined;
}

export function isStableVersionAtLeast(value: string, minimum: string): boolean {
  const actual = versionParts(value);
  const floor = versionParts(minimum);
  if (!actual || !floor) return false;
  for (let index = 0; index < 3; index++) {
    if (actual[index]! > floor[index]!) return true;
    if (actual[index]! < floor[index]!) return false;
  }
  return true;
}
