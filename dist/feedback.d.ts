import type { CompiledArtifact } from './summarizer.ts';
export interface SkillRegistryLike {
    register(skill: {
        name: string;
        description: string;
        whenToUse?: string;
        content: string;
    }): () => void;
    get(name: string): Promise<unknown>;
    on(event: 'skills/change', handler: () => void): (() => void) | void;
}
/**
 * Writes compiled artifacts to the isolated deepjit directory and makes them
 * live in dsh: mechanism A relies on the skill-filesystem provider watching
 * the directory (customSkillDirs in cordis.patch.yml); mechanism B registers
 * the skill at runtime when A is not in effect.
 */
export declare class ArtifactFeedback {
    private runtimeRegistrations;
    private watchers;
    private dirs;
    private skills;
    private log;
    constructor(dirs: {
        skillDir: string;
        flowDir: string;
    }, skills: SkillRegistryLike, log: (msg: string) => void);
    publish(artifact: CompiledArtifact): Promise<{
        mode: 'filesystem' | 'runtime';
        filePath: string;
        name: string;
    }>;
    private waitForDiscovery;
    private registerRuntime;
    /** Rename skill dir / flow file to *.disabled so watchers unload it. */
    disable(name: string): void;
    /** Reverse of disable. */
    enable(name: string): void;
    remove(name: string): void;
    private unregisterRuntime;
    disposeAll(): void;
}
