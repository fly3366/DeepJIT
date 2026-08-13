import { readFileSync, existsSync } from 'node:fs'
import { DeepJitStore } from './store.js'
import { ArtifactFeedback } from './feedback.js'

interface StatusArgs {
  action: 'list' | 'show' | 'disable' | 'enable' | 'delete'
  type?: 'skill' | 'flow'
  name?: string
}

/** The deepjit_status tool: inspect and manage compiled artifacts. */
export class StatusTool {
  constructor(
    private store: DeepJitStore,
    private feedback: ArtifactFeedback,
    private dirs: { skillDir: string; flowDir: string },
    private log: (msg: string) => void,
  ) {}

  get toolDefinition(): object {
    return {
      name: 'deepjit_status',
      description:
        'Inspect and manage deepjit JIT-compiled artifacts. list shows all skills and flows with their status; ' +
        'show prints the file content; disable/enable toggle availability; delete removes the artifact.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'show', 'disable', 'enable', 'delete'],
            description: 'Operation to perform',
          },
          type: { type: 'string', enum: ['skill', 'flow'], description: 'Artifact type (list only)' },
          name: { type: 'string', description: 'Artifact name, e.g. "deepjit-summarize-repo"' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      execute: (args: StatusArgs) => this.handle(args),
    }
  }

  private handle(args: StatusArgs): string {
    switch (args.action) {
      case 'list': {
        const rows = this.store.listArtifacts(args.type)
        if (rows.length === 0) return 'No deepjit artifacts yet.'
        const lines = rows.map((r) => {
          const fileOk = existsSync(r.file_path)
          return `- [${r.status}] ${r.type} ${r.name} — ${r.description ?? ''} (${fileOk ? 'file ok' : 'MISSING FILE'}, feedback: ${r.feedback_mode ?? 'n/a'})`
        })
        return `deepjit artifacts (${rows.length}):\n${lines.join('\n')}`
      }
      case 'show': {
        if (!args.name) return 'name is required for show'
        const row = this.store.getArtifact(args.name)
        if (!row) return `unknown artifact "${args.name}"`
        if (!existsSync(row.file_path)) return `artifact "${args.name}" file is missing: ${row.file_path}`
        const content = readFileSync(row.file_path, 'utf8')
        return `# ${row.name}\nstatus: ${row.status}\npath: ${row.file_path}\n\n${content.slice(0, 6000)}`
      }
      case 'disable': {
        if (!args.name) return 'name is required for disable'
        const row = this.store.getArtifact(args.name)
        if (!row) return `unknown artifact "${args.name}"`
        if (row.status === 'disabled') return `artifact "${args.name}" is already disabled`
        this.feedback.disable(args.name)
        this.store.updateArtifactStatus(args.name, 'disabled')
        this.log(`deepjit: disabled artifact ${args.name}`)
        return `disabled "${args.name}"`
      }
      case 'enable': {
        if (!args.name) return 'name is required for enable'
        const row = this.store.getArtifact(args.name)
        if (!row) return `unknown artifact "${args.name}"`
        if (row.status === 'active') return `artifact "${args.name}" is already active`
        this.feedback.enable(args.name)
        this.store.updateArtifactStatus(args.name, 'active')
        this.log(`deepjit: enabled artifact ${args.name}`)
        return `enabled "${args.name}"`
      }
      case 'delete': {
        if (!args.name) return 'name is required for delete'
        const row = this.store.getArtifact(args.name)
        if (!row) return `unknown artifact "${args.name}"`
        this.feedback.remove(args.name)
        this.store.deleteArtifact(args.name)
        this.log(`deepjit: deleted artifact ${args.name}`)
        return `deleted "${args.name}"`
      }
      default:
        return `unknown action "${args.action}"`
    }
  }
}

export type { StatusArgs }
