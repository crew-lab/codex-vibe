export function fail(message: string, code = 1): never {
  process.exitCode = code;
  throw Object.assign(new Error(message), { code: 'VSUP_INVALID_ARGUMENT' });
}

export function configInvalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'VSUP_CONFIG_INVALID' });
}
