import { readFileSync, existsSync } from 'node:fs';
import { qualityScore } from './store.js';
import { t } from './i18n.js';
import { metrics } from './metrics.js';
/** The deepjit_status tool: inspect and manage compiled artifacts. */
export class StatusTool {
    store;
    feedback;
    dirs;
    log;
    constructor(store, feedback, dirs, log) {
        this.store = store;
        this.feedback = feedback;
        this.dirs = dirs;
        this.log = log;
    }
    get toolDefinition() {
        return {
            name: 'deepjit_status',
            description: 'Inspect and manage deepjit JIT-compiled artifacts. list shows all skills and flows with their status; ' +
                'show prints the file content; disable/enable toggle availability; delete removes the artifact.',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'show', 'disable', 'enable', 'delete', 'metrics'],
                        description: 'Operation to perform',
                    },
                    type: { type: 'string', enum: ['skill', 'flow'], description: 'Artifact type (list only)' },
                    name: { type: 'string', description: 'Artifact name, e.g. "deepjit-summarize-repo"' },
                },
                required: ['action'],
            },
            output: {
                schema: { type: 'string' },
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            execute: (args) => this.handle(args),
        };
    }
    handle(args) {
        switch (args.action) {
            case 'list': {
                const rows = this.store.listArtifacts(args.type);
                if (rows.length === 0)
                    return t('status.empty');
                const lines = rows.map((r) => {
                    const fileOk = existsSync(r.file_path);
                    const q = qualityScore(r.use_count, r.success_count);
                    return `- [${r.status}] ${r.type} ${r.name} — ${r.description ?? ''} (quality: ${q}, uses: ${r.use_count}, ${fileOk ? 'file ok' : 'MISSING FILE'})`;
                });
                return `deepjit artifacts (${rows.length}):\n${lines.join('\n')}`;
            }
            case 'show': {
                if (!args.name)
                    return t('status.nameRequired', { action: 'show' });
                const row = this.store.getArtifact(args.name);
                if (!row)
                    return t('status.unknown', { name: args.name ?? '' });
                if (!existsSync(row.file_path))
                    return t('status.fileMissing', { name: args.name, path: row.file_path });
                const content = readFileSync(row.file_path, 'utf8');
                return `# ${row.name}\nstatus: ${row.status}\npath: ${row.file_path}\n\n${content.slice(0, 6000)}`;
            }
            case 'disable': {
                const r = this.applyAction('disable', args.name);
                if (r.code === 'name-required')
                    return t('status.nameRequired', { action: 'disable' });
                if (r.code === 'unknown')
                    return t('status.unknown', { name: args.name ?? '' });
                if (r.code === 'already-disabled')
                    return t('status.alreadyDisabled', { name: args.name ?? '' });
                return t('status.disabled', { name: args.name ?? '' });
            }
            case 'enable': {
                const r = this.applyAction('enable', args.name);
                if (r.code === 'name-required')
                    return t('status.nameRequired', { action: 'enable' });
                if (r.code === 'unknown')
                    return t('status.unknown', { name: args.name ?? '' });
                if (r.code === 'already-active')
                    return t('status.alreadyActive', { name: args.name ?? '' });
                return t('status.enabled', { name: args.name ?? '' });
            }
            case 'delete': {
                const r = this.applyAction('delete', args.name);
                if (r.code === 'name-required')
                    return t('status.nameRequired', { action: 'delete' });
                if (r.code === 'unknown')
                    return t('status.unknown', { name: args.name ?? '' });
                return t('status.deleted', { name: args.name ?? '' });
            }
            case 'metrics': {
                const snap = metrics.snapshot();
                const lines = Object.entries(snap).map(([k, v]) => `${k}: ${v}`);
                return lines.length ? `deepjit metrics:\n${lines.join('\n')}` : t('status.empty');
            }
            default:
                return t('status.unknownAction', { action: args.action });
        }
    }
    /**
     * Shared mutation path for the agent tool and the Web action route. Performs
     * the exact feedback+store sequence and returns a stable code, never a message.
     */
    applyAction(action, name) {
        if (!name)
            return { ok: false, code: 'name-required' };
        const row = this.store.getArtifact(name);
        if (!row)
            return { ok: false, code: 'unknown' };
        if (action === 'disable') {
            if (row.status === 'disabled')
                return { ok: false, code: 'already-disabled' };
            this.feedback.disable(name);
            this.store.updateArtifactStatus(name, 'disabled');
            this.log(`deepjit: disabled artifact ${name}`);
            return { ok: true, code: 'ok' };
        }
        if (action === 'enable') {
            if (row.status === 'active')
                return { ok: false, code: 'already-active' };
            this.feedback.enable(name);
            this.store.updateArtifactStatus(name, 'active');
            this.log(`deepjit: enabled artifact ${name}`);
            return { ok: true, code: 'ok' };
        }
        this.feedback.remove(name);
        this.store.deleteArtifact(name);
        this.log(`deepjit: deleted artifact ${name}`);
        return { ok: true, code: 'ok' };
    }
}
//# sourceMappingURL=status-tool.js.map