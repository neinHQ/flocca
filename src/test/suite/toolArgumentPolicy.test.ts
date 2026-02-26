import * as assert from 'assert';
import { validateToolArguments } from '../../services/toolArgumentPolicy';

suite('ToolArgumentPolicy Test Suite', () => {
    test('zephyr_enterprise_create_test_case rejects empty args', () => {
        const result = validateToolArguments('zephyr-enterprise', 'zephyr_enterprise_create_test_case', {});
        assert.strictEqual(result.ok, false);
        if (!result.ok) {
            assert.ok(result.reason.includes('name'));
        }
    });

    test('zephyr_enterprise_search_test_cases allows empty args (server fallback)', () => {
        const result = validateToolArguments('zephyr-enterprise', 'zephyr_enterprise_search_test_cases', {});
        assert.strictEqual(result.ok, true);
    });

    test('zephyr_update_test_case requires key and at least one field', () => {
        const missingKey = validateToolArguments('zephyr', 'zephyr_update_test_case', { title: 'new' });
        assert.strictEqual(missingKey.ok, false);

        const noFields = validateToolArguments('zephyr', 'zephyr_update_test_case', { key: 'TC-1' });
        assert.strictEqual(noFields.ok, false);

        const valid = validateToolArguments('zephyr', 'zephyr_update_test_case', { key: 'TC-1', title: 'new' });
        assert.strictEqual(valid.ok, true);
    });
});
