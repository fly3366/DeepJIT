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
}
export type { StatusArgs };
