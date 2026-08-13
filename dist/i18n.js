/**
 * Lightweight runtime internationalization for user-facing strings.
 * Documentation defaults to English (README.md) with Chinese in README.zh.md;
 * runtime output follows the configured locale, defaulting to English.
 *
 * Only strings shown to a human (tool results, status output) are localized.
 * Developer logs and model-facing tool descriptions remain English.
 */
const en = {
    'status.empty': 'No deepjit artifacts yet.',
    'status.nameRequired': 'name is required for {action}',
    'status.unknown': 'unknown artifact "{name}"',
    'status.fileMissing': 'artifact "{name}" file is missing: {path}',
    'status.alreadyDisabled': 'artifact "{name}" is already disabled',
    'status.alreadyActive': 'artifact "{name}" is already active',
    'status.disabled': 'disabled "{name}"',
    'status.enabled': 'enabled "{name}"',
    'status.deleted': 'deleted "{name}"',
    'status.unknownAction': 'unknown action "{action}"',
    'flow.unknown': 'unknown flow "{name}" (deepjit_status list shows available flows)',
    'flow.disabled': 'flow "{name}" is disabled',
    'flow.noSteps': 'flow "{name}" has no steps',
    'flow.recursive': 'flow "{name}" references deepjit\'s own tools; recursive JIT flows are not allowed',
};
const zh = {
    'status.empty': '尚无任何 deepjit 产物。',
    'status.nameRequired': '{action} 操作需要提供 name',
    'status.unknown': '未知产物 "{name}"',
    'status.fileMissing': '产物 "{name}" 的文件缺失：{path}',
    'status.alreadyDisabled': '产物 "{name}" 已处于禁用状态',
    'status.alreadyActive': '产物 "{name}" 已处于启用状态',
    'status.disabled': '已禁用 "{name}"',
    'status.enabled': '已启用 "{name}"',
    'status.deleted': '已删除 "{name}"',
    'status.unknownAction': '未知操作 "{action}"',
    'flow.unknown': '未知流程 "{name}"（可用 deepjit_status 查看已有流程）',
    'flow.disabled': '流程 "{name}" 已被禁用',
    'flow.noSteps': '流程 "{name}" 没有任何步骤',
    'flow.recursive': '流程 "{name}" 引用了 deepjit 自身的工具，不允许递归 JIT 流程',
};
let current = 'en';
function detect() {
    const lang = (process.env.LC_ALL ?? process.env.LANG ?? '').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
}
function isLocale(value) {
    return value === 'en' || value === 'zh';
}
/**
 * Resolve and apply the active locale.
 * Priority: explicit preference (non-auto) > dsh-provided locale > environment
 * (LC_ALL/LANG) > English.
 * @param preference - user config override; 'auto' defers to dsh/env.
 * @param dshLocale - locale reported by the harness (e.g. the web client's
 *   `locale` settings namespace), when available.
 */
export function setLocale(preference, dshLocale) {
    if (preference !== 'auto') {
        current = preference;
        return;
    }
    if (isLocale(dshLocale)) {
        current = dshLocale;
        return;
    }
    current = detect();
}
export function getLocale() {
    return current;
}
/** Translate a message key, substituting {param} placeholders. */
export function t(key, params) {
    let text = current === 'zh' ? zh[key] : en[key];
    if (params) {
        for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(value);
        }
    }
    return text;
}
//# sourceMappingURL=i18n.js.map