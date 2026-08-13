import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-session';
import '@deepseek-ai/dsh-tools';
import '@deepseek-ai/cordis-plugin-timer';
import { type DeepJitConfig } from './config.ts';
export { Config } from './config.ts';
export declare const name = "deepjit";
export declare const inject: string[];
export declare function apply(ctx: Context, config: DeepJitConfig): void;
