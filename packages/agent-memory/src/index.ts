export type RuntimeMemoryKind =
  | 'research-fact'
  | 'source-constraint'
  | 'evaluation-result'
  | 'workflow-checkpoint'
  | 'user-approved-preference'

export interface RuntimeMemoryRecord {
  id: string
  workspaceId: string
  kind: RuntimeMemoryKind
  statement: string
  sourceIds: string[]
  confidence: number
  createdAt: string
  expiresAt: string | null
  approvedBy: string | null
  containsInstructionLikeContent: boolean
}

const instructionPatterns = [
  /ignore (all|previous|prior) instructions/i,
  /system prompt/i,
  /run (this|the following) command/i,
  /delete .*file/i,
  /change .*permissions/i,
  /install .*dependency/i
]

export function containsInstructionLikeContent(statement: string): boolean {
  return instructionPatterns.some((pattern) => pattern.test(statement))
}

export function createRuntimeMemory(
  input: Omit<RuntimeMemoryRecord, 'containsInstructionLikeContent'>
): RuntimeMemoryRecord {
  if (input.confidence < 0 || input.confidence > 1) {
    throw new Error('Runtime memory confidence must be between 0 and 1')
  }
  return {
    ...input,
    containsInstructionLikeContent: containsInstructionLikeContent(input.statement)
  }
}

export function canUseAsInstruction(record: RuntimeMemoryRecord): false {
  void record
  return false
}
