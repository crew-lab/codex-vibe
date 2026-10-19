import { constants as fsConstants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { executableSearchPath } from '../config/config.js';

async function executableFileAt(candidate: string): Promise<string> {
  const real = await realpath(candidate);
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${candidate} is not a regular file`);
  await access(real, fsConstants.X_OK);
  return real;
}

export async function resolveExecutableFile(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (path.isAbsolute(command) || /[\\/]/.test(command)) return executableFileAt(path.resolve(command));
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of executableSearchPath(env)) {
    for (const extension of extensions) {
      try {
        return await executableFileAt(path.join(directory, `${command}${extension}`));
      } catch {
        continue;
      }
    }
  }
  throw new Error(`Executable ${command} was not found on PATH as a regular executable file.`);
}
