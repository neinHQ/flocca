const { SKU_CATALOG, listSkus, validateSkus } = require('./skuCatalog');

describe('Phase 3.1 SKU catalog utility', () => {
  test('listSkus returns catalog entries', () => {
    const skus = listSkus();
    expect(Array.isArray(skus)).toBe(true);
    expect(skus.length).toBeGreaterThan(0);
    expect(skus.map((s) => s.id)).toContain('qa_core');
    expect(skus.map((s) => s.id)).toContain('devops_core');
  });

  test('validateSkus accepts known ids and rejects unknown ids', () => {
    expect(validateSkus(['qa_core', 'dev_core'])).toBe(true);
    expect(validateSkus(['qa_core', 'missing_sku'])).toBe(false);
    expect(validateSkus('qa_core')).toBe(false);
  });

  test('catalog ids are unique', () => {
    const ids = Object.keys(SKU_CATALOG);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });
});
