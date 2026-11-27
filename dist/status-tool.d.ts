import { DeepJitStore } from './store.ts';
import { ArtifactFeedback } from './feedback.ts';
interface StatusArgs {
    action: 'list' | 'show' | 'disable' | 'enable' | 'delete' | 'metrics';
    type?: 'skill' | 'flow';
    name?: string;
}
/** The deepjit_status tool: inspect and manage compiled artifacts. */
export declare class StatusTool {
    private store;
    private feedback;
    private dirs;
    private log;
    constructor(store: DeepJitStore, feedback: ArtifactFeedback, dirs: {
        skillDir: string;
        flowDir: string;
    }, log: (msg: string) => void);
    get toolDefinition(): object;
    private handle;
    /**
     * Shared mutation path for the agent tool and the Web action route. Performs
     * the exact feedback+store sequence and returns a stable code, never a message.
     */
    applyAction(action: 'enable' | 'disable' | 'delete', name?: string): {
        ok: boolean;
        code: string;
    };
}
export type { StatusArgs };
