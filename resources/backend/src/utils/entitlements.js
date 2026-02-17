const FREE = ['free.github', 'free.codebase', 'free.testing'];
const PRO = ['pro.connectors', 'pro.tools'];
const ENTERPRISE = ['enterprise.sso', 'enterprise.audit_logs', 'enterprise.policy_controls'];

function inferPlanTier(user) {
    if (!user) return 'free';
    if (user.planTier) return user.planTier;

    // Backward compatibility with existing subscriptionStatus values.
    if (['individual', 'pro', 'active'].includes(user.subscriptionStatus)) return 'pro';
    if (['teams', 'team'].includes(user.subscriptionStatus)) return 'team';
    if (user.subscriptionStatus === 'enterprise') return 'enterprise';
    return 'free';
}

function defaultCapabilitiesForPlan(planTier) {
    const caps = new Set(FREE);

    if (['pro', 'team', 'enterprise'].includes(planTier)) {
        PRO.forEach((c) => caps.add(c));
    }

    if (planTier === 'enterprise') {
        ENTERPRISE.forEach((c) => caps.add(c));
    }

    return caps;
}

function applyOverrides(capabilities, overrides) {
    if (!overrides || typeof overrides !== 'object') return capabilities;

    const allow = Array.isArray(overrides.allow) ? overrides.allow : [];
    const deny = Array.isArray(overrides.deny) ? overrides.deny : [];

    for (const c of allow) capabilities.add(c);
    for (const c of deny) capabilities.delete(c);

    return capabilities;
}

function buildEntitlements(user) {
    const planTier = inferPlanTier(user);
    const caps = applyOverrides(defaultCapabilitiesForPlan(planTier), user?.capabilityOverrides || undefined);

    return {
        planTier,
        capabilities: Array.from(caps).sort(),
        capabilityOverrides: user?.capabilityOverrides || null
    };
}

module.exports = {
    buildEntitlements,
    inferPlanTier
};
