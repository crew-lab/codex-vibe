import type { StartRunInput } from '../contracts.js';
import { FINDINGS_OUTPUT_CONTRACT } from './findings.js';
import { renderContractRequirements } from '../acceptance/requirements.js';

type PromptInput = Pick<StartRunInput, 'mode' | 'task' | 'contextFiles' | 'preparedContextFiles' | 'allowedWritePaths' | 'acceptanceContract' | 'output'>;

export function buildTaskPrompt(input: PromptInput, listing: string | null): string {
  const context = (input.contextFiles ?? []).map((file) => `Approved context path: ${file}`).join('\n');
  const prepared = (input.preparedContextFiles ?? []).map((file) => `Reviewed prepared context (${file.provenance}; sha256 ${file.sha256}; ${file.bytes} bytes) at ${file.path}:\n<untrusted-context>\n${file.content}\n</untrusted-context>`).join('\n\n');
  const writable = input.allowedWritePaths ? `Writable paths (a write anywhere else is refused; a path ending in / covers everything beneath it): ${input.allowedWritePaths.join(', ')}` : null;
  const prefix = [listing, context, prepared, writable].filter((part): part is string => part !== null && part.length > 0).join('\n\n');
  let prompt = prefix ? `${prefix}\n\nTask:\n${input.task}` : input.acceptanceContract ? `Task:\n${input.task}` : input.task;
  if (input.acceptanceContract) prompt = `${prompt}\n\nFrozen acceptance contract:\n${JSON.stringify(input.acceptanceContract)}\n\n${renderContractRequirements(input.acceptanceContract)}`;
  if (input.mode === 'review' && input.output === 'findings') prompt = `${prompt}\n\n${FINDINGS_OUTPUT_CONTRACT}`;
  return prompt;
}
