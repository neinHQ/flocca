const { buildEntitlements, inferPlanTier } = require('./entitlements');

describe('Phase 2 entitlements utility', () => {
  test('inferPlanTier maps legacy statuses', () => {
    expect(inferPlanTier({ subscriptionStatus: 'individual' })).toBe('pro');
    expect(inferPlanTier({ subscriptionStatus: 'teams' })).toBe('team');
    expect(inferPlanTier({ subscriptionStatus: 'enterprise' })).toBe('enterprise');
    expect(inferPlanTier({ subscriptionStatus: 'free' })).toBe('free');
  });

  test('buildEntitlements returns free capabilities for free users', () => {
    const ent = buildEntitlements({ subscriptionStatus: 'free' });
    expect(ent.planTier).toBe('free');
    expect(ent.capabilities).toEqual(expect.arrayContaining(['free.github', 'free.codebase', 'free.testing']));
    expect(ent.capabilities).not.toContain('pro.connectors');
  });

  test('buildEntitlements returns pro capabilities for team users', () => {
    const ent = buildEntitlements({ subscriptionStatus: 'teams' });
    expect(ent.planTier).toBe('team');
    expect(ent.capabilities).toEqual(expect.arrayContaining(['pro.connectors', 'pro.tools']));
  });

  test('buildEntitlements applies allow/deny overrides', () => {
    const ent = buildEntitlements({
      planTier: 'pro',
      capabilityOverrides: {
        allow: ['enterprise.audit_logs'],
        deny: ['pro.tools']
      }
    });

    expect(ent.capabilities).toContain('pro.connectors');
    expect(ent.capabilities).toContain('enterprise.audit_logs');
    expect(ent.capabilities).not.toContain('pro.tools');
  });
});
