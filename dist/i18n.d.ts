/**
 * Lightweight runtime internationalization for user-facing strings.
 * Documentation defaults to English (README.md) with Chinese in README.zh.md;
 * runtime output follows the configured locale, defaulting to English.
 *
 * Only strings shown to a human (tool results, status output) are localized.
 * Developer logs and model-facing tool descriptions remain English.
 */
export type Locale = 'en' | 'zh';
export type LocalePreference = 'auto' | Locale;
declare const en: {
    readonly 'status.empty': "No deepjit artifacts yet.";
    readonly 'status.nameRequired': "name is required for {action}";
    readonly 'status.unknown': "unknown artifact \"{name}\"";
    readonly 'status.fileMissing': "artifact \"{name}\" file is missing: {path}";
    readonly 'status.alreadyDisabled': "artifact \"{name}\" is already disabled";
    readonly 'status.alreadyActive': "artifact \"{name}\" is already active";
    readonly 'status.disabled': "disabled \"{name}\"";
    readonly 'status.enabled': "enabled \"{name}\"";
    readonly 'status.deleted': "deleted \"{name}\"";
    readonly 'status.unknownAction': "unknown action \"{action}\"";
    readonly 'flow.unknown': "unknown flow \"{name}\" (deepjit_status list shows available flows)";
    readonly 'flow.disabled': "flow \"{name}\" is disabled";
    readonly 'flow.noSteps': "flow \"{name}\" has no steps";
    readonly 'flow.recursive': "flow \"{name}\" references deepjit's own tools; recursive JIT flows are not allowed";
};
export type MessageKey = keyof typeof en;
/**
 * Resolve and apply the active locale.
 * Priority: explicit preference (non-auto) > dsh-provided locale > environment
 * (LC_ALL/LANG) > English.
 * @param preference - user config override; 'auto' defers to dsh/env.
 * @param dshLocale - locale reported by the harness (e.g. the web client's
 *   `locale` settings namespace), when available.
 */
export declare function setLocale(preference: LocalePreference, dshLocale?: unknown): void;
export declare function getLocale(): Locale;
/** Translate a message key, substituting {param} placeholders. */
export declare function t(key: MessageKey, params?: Record<string, string>): string;
export {};
