/** Compare a Node version against a minimum, including minor/patch boundaries. */
export function nodeVersionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string, allowTwoPart: boolean): number[] | undefined => {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(value);
    if (!allowTwoPart && match?.[3] === undefined) return undefined;
    return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : undefined;
  };
  const actual = parse(version, false);
  const required = parse(minimum, true);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
