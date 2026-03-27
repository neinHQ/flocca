export type ArgPolicyResult = { ok: true } | { ok: false; reason: string };

function isNonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function isNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNumberish(value: unknown): boolean {
    return isNumber(value) || (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value)));
}

function isNonEmptyArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

function hasAnyField(args: Record<string, unknown>, fields: Array<string | string[]>): boolean {
    return fields.some((field) => {
        const keys = Array.isArray(field) ? field : [field];
        return keys.some((key) => args[key] !== undefined && args[key] !== null);
    });
}

export function validateToolArguments(serverName: string, toolName: string, args: unknown): ArgPolicyResult {
    const payload = (args && typeof args === 'object') ? args as Record<string, unknown> : {};

    switch (toolName) {
        // Zephyr Enterprise write tools
        case 'zephyr_enterprise_create_test_case':
            if (!isNonEmptyString(payload.name)) return { ok: false, reason: 'Missing required argument: name' };
            return { ok: true };
        case 'zephyr_enterprise_update_test_case':
            if (!isNumberish(payload.id) && !isNumberish(payload.testCaseId) && !isNumberish(payload.test_case_id)) {
                return { ok: false, reason: 'Missing required argument: id' };
            }
            if (!hasAnyField(payload, ['name', 'description', 'steps', ['folder_id', 'folderId'], 'priority', ['custom_fields', 'customFields']])) {
                return { ok: false, reason: 'At least one updatable field is required: name, description, steps, folder_id/folderId, priority, custom_fields/customFields' };
            }
            return { ok: true };
        case 'zephyr_enterprise_create_cycle':
            if (!isNonEmptyString(payload.name)) return { ok: false, reason: 'Missing required argument: name' };
            return { ok: true };
        case 'zephyr_enterprise_add_test_cases_to_cycle':
            if (!isNumberish(payload.cycle_id) && !isNumberish(payload.cycleId)) return { ok: false, reason: 'Missing required argument: cycle_id/cycleId' };
            if (!isNonEmptyArray(payload.test_case_ids) && !isNonEmptyArray(payload.testCaseIds)) return { ok: false, reason: 'Missing required argument: test_case_ids/testCaseIds' };
            return { ok: true };

        // Zephyr Scale write tools
        case 'zephyr_create_test_case':
            if (!isNonEmptyString(payload.title)) return { ok: false, reason: 'Missing required argument: title' };
            return { ok: true };
        case 'zephyr_update_test_case':
            if (!isNonEmptyString(payload.key)) return { ok: false, reason: 'Missing required argument: key' };
            if (!hasAnyField(payload, ['title', 'objective', 'precondition', 'steps', 'labels', 'folder_id', 'links'])) {
                return { ok: false, reason: 'At least one updatable field is required: title, objective, precondition, steps, labels, folder_id, links' };
            }
            return { ok: true };
        case 'zephyr_create_test_cycle':
            if (!isNonEmptyString(payload.name)) return { ok: false, reason: 'Missing required argument: name' };
            return { ok: true };
        case 'zephyr_add_tests_to_cycle':
            if (!isNonEmptyString(payload.cycle_key)) return { ok: false, reason: 'Missing required argument: cycle_key' };
            if (!isNonEmptyArray(payload.test_case_keys)) return { ok: false, reason: 'Missing required argument: test_case_keys' };
            return { ok: true };
        default:
            return { ok: true };
    }
}
