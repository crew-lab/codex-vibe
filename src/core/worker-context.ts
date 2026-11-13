import type { RunMode } from '../contracts.js';

export type WorkerKind = 'vibe' | 'agy';

const ROLE: Readonly<Record<RunMode, string>> = {
  review: 'You review code for a supervising engineer. You answer one question about the code in this workspace and change nothing.',
  edit: 'You implement one bounded change for a supervising engineer, in a Git worktree made for this task. Your file changes are exported as a patch and checked after you finish.'
};

const VIBE_READ = 'read_file returns at most 2,000 lines or 64,000 bytes per call, so pass offset and limit to read further into a long file; given a directory below the workspace root it lists the entries, but the root itself cannot be listed. A path may be absolute or relative to the workspace root. There is no search tool.';

const TOOLS: Readonly<Record<WorkerKind, Readonly<Record<RunMode, string>>>> = {
  vibe: {
    review: `Tools: read_file only. ${VIBE_READ}`,
    edit: `Tools: read_file, write_file and edit. ${VIBE_READ} edit replaces old_string, which must be copied exactly, whitespace included, from the file as you last read it. write_file takes at most 64,000 bytes.`
  },
  agy: {
    review: 'Tools: file view, directory listing, file name search and text search, inside this workspace only. Writes are refused.',
    edit: 'Tools: file view, directory listing, file name search and text search, and file write and replace, inside this workspace only.'
  }
};

const REFUSED = 'Every other tool is refused: no shell, no commands, no network, no browser and no questions to the user. Do not call them and do not plan around them.';
const NO_EXECUTION = 'You cannot run code, tests, a compiler or a linter. Reason from the source, and never say that something was run, tested or verified.';

const WORK: Readonly<Record<RunMode, readonly string[]>> = {
  review: [
    'Read the files the task names, in the order given, then answer. Read another file only when the question cannot be answered without it.',
    'For each input or case the task asks you to evaluate, work it through the code step by step and state the value or error the code produces and the line that decides it, whether or not it is a defect. Where a rule names a threshold, check the code at exactly that value and on either side of it.',
    'Give the conclusion first, then each finding with its file, its function or line, the input that triggers it and the wrong behaviour against the stated requirement. "No defect found in the inspected scope" is a valid answer; do not invent a finding. When the task gives an output format, follow it exactly: its labels, their order and any JSON block it asks for.',
    'Once you have answered, stop.'
  ],
  edit: [
    'Read each file before you change it. Change only what the task asks, only in the paths it allows, with the smallest diff that does it. Match the surrounding style. Add no code comments unless the task asks for them. Leave no trailing whitespace and keep each file\'s final newline. Create no scratch, note or summary files.',
    'Because nothing can be run, check your work by reading it again: import and export names and paths agree, and every value that may be undefined or null is narrowed before use.',
    'When the change is written, give the final answer: what changed, then every file you changed or created. Then stop; do not wait, retry or keep exploring.'
  ]
};

export function workerRules(worker: WorkerKind, mode: RunMode): string {
  return [ROLE[mode], TOOLS[worker][mode], REFUSED, NO_EXECUTION, ...WORK[mode]].join('\n');
}
