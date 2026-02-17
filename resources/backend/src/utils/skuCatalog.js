const SKU_CATALOG = {
    qa_core: {
        id: 'qa_core',
        name: 'QA Core',
        connectors: ['jira', 'confluence', 'github_actions', 'gitlab', 'bitbucket', 'zephyr', 'testrail', 'cypress', 'playwright', 'pytest']
    },
    qa_plus: {
        id: 'qa_plus',
        name: 'QA Plus',
        connectors: ['slack', 'teams', 'sentry', 'notion', 'postgres', 'elastic', 'observability']
    },
    devops_core: {
        id: 'devops_core',
        name: 'DevOps Core',
        connectors: ['jira', 'confluence', 'github_actions', 'gitlab', 'bitbucket', 'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'sentry', 'observability']
    },
    devops_plus: {
        id: 'devops_plus',
        name: 'DevOps Plus',
        connectors: ['slack', 'teams', 'notion', 'postgres', 'elastic', 'testrail']
    },
    dev_core: {
        id: 'dev_core',
        name: 'Developer Core',
        connectors: ['github', 'gitlab', 'bitbucket', 'github_actions', 'jira', 'confluence', 'codebase', 'playwright', 'pytest']
    },
    dev_plus: {
        id: 'dev_plus',
        name: 'Developer Plus',
        connectors: ['slack', 'teams', 'notion', 'sentry', 'postgres']
    },
    pm_core: {
        id: 'pm_core',
        name: 'PM Core',
        connectors: ['jira', 'confluence', 'notion', 'slack', 'teams', 'github_actions']
    },
    pm_plus: {
        id: 'pm_plus',
        name: 'PM Plus',
        connectors: ['github', 'gitlab', 'bitbucket', 'zephyr', 'testrail', 'sentry', 'observability']
    }
};

function listSkus() {
    return Object.values(SKU_CATALOG);
}

function validateSkus(skus = []) {
    if (!Array.isArray(skus)) return false;
    return skus.every((s) => SKU_CATALOG[s]);
}

module.exports = {
    SKU_CATALOG,
    listSkus,
    validateSkus
};
