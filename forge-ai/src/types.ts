export type Status = 'loading' | 'success' | 'error' | 'warning'

export type ActivityKind =
  | 'thinking' | 'read' | 'create' | 'edit' | 'delete' | 'command' | 'bash'
  | 'install' | 'search' | 'test' | 'build' | 'completed' | 'error'

export interface Activity {
  id: string
  kind: ActivityKind
  label: string
  target?: string
  status: Status
  durationMs?: number
  details?: string
  /** For file edits: the path affected */
  filePath?: string
  /** Grouped commands (e.g. "Ran commands 3") */
  children?: Activity[]
  /** For start_process: id of the background process (enables the preview card) */
  processId?: string
  /** inspect_app: JPEG data URL of the page */
  screenshot?: string
  /** Set while waiting to retry a transient provider error */
  retry?: { attempt: number; waitMs: number; reason: string } | null
}

export interface PlanItem { title: string; status: 'pending' | 'in_progress' | 'done' }
export interface CheckpointRef { before: string; after?: string; undone?: boolean }

export interface Attachment { id: string; name: string; size: number; type: string; dataUrl?: string }

export interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  createdAt: number
  attachments?: Attachment[]
  activities?: Activity[]
  agent?: AgentId
  elapsedMs?: number
  plan?: PlanItem[]
  checkpoint?: CheckpointRef
}

export type TaskState = 'idle' | 'working' | 'done' | 'stopped' | 'error'

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  workspaceId: string
  messages: Message[]
  state: TaskState
}

export type AgentId = 'agent' | 'team' | 'code' | 'debug' | 'review'

export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  content?: string
  previous?: string
  size?: number
}

export interface Server {
  id: string
  name: string
  port: number
  status: 'running' | 'starting' | 'stopped' | 'error'
}

export interface Workspace {
  id: string
  name: string
  quotaMB: number
  fileQuota: number
  root: FileNode[]
  servers: Server[]
  env: 'ready' | 'busy' | 'offline'
}
