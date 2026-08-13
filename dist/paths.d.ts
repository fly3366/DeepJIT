import type { Context } from '@deepseek-ai/cordis';
/** Resolve the dsh home directory (~/.dsh by default). */
export declare function resolveHome(ctx: Context): string;
export declare function resolveDirs(ctx: Context, config: {
    dbPath?: string;
    skillDir?: string;
    flowDir?: string;
}): {
    home: string;
    dbPath: string;
    skillDir: string;
    flowDir: string;
};
