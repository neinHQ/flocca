import * as vscode from 'vscode';

export interface ServerDefinition {
    id: string;
    name: string;
    description: string;
    icon: string; // codicon name or url
    type: 'local' | 'remote';
    connectCommand?: string; // Command to trigger connection wizard
    docsUrl?: string;
}

export class ServerRegistryService {
    private registry: ServerDefinition[] = [
        {
            id: 'github',
            name: 'GitHub',
            description: 'Repos, Issues, Files.',
            icon: 'github',
            type: 'remote',
            connectCommand: 'flocca.connectGitHub'
        },
        {
            id: 'gitlab',
            name: 'GitLab',
            description: 'Projects, MRs, pipelines.',
            icon: 'git-merge',
            type: 'remote',
            connectCommand: 'flocca.connectGitLab'
        },
        {
            id: 'bitbucket',
            name: 'Bitbucket',
            description: 'Repos, PRs, Pipelines.',
            icon: 'repo',
            type: 'remote',
            connectCommand: 'flocca.connectBitbucket'
        },
        {
            id: 'kubernetes',
            name: 'Kubernetes',
            description: 'Clusters, pods, logs.',
            icon: 'server',
            type: 'remote',
            connectCommand: 'flocca.connectKubernetes'
        },
        {
            id: 'azuredevops',
            name: 'Azure DevOps',
            description: 'Boards, repos, pipelines.',
            icon: 'cloud',
            type: 'remote',
            connectCommand: 'flocca.connectAzureDevOps'
        },
        {
            id: 'docker',
            name: 'Docker',
            description: 'Containers and images.',
            icon: 'vm',
            type: 'local',
            connectCommand: 'flocca.connectDocker'
        },
        {
            id: 'testrail',
            name: 'TestRail',
            description: 'Test cases and runs.',
            icon: 'beaker',
            type: 'remote',
            connectCommand: 'flocca.connectTestRail'
        },
        {
            id: 'cypress',
            name: 'Cypress',
            description: 'Run Cypress E2E tests.',
            icon: 'play-circle',
            type: 'local',
            connectCommand: 'flocca.connectCypress'
        },
        {
            id: 'teams',
            name: 'Microsoft Teams',
            description: 'Messages and channels.',
            icon: 'comment',
            type: 'remote',
            connectCommand: 'flocca.connectTeams'
        },

        {
            id: 'azure',
            name: 'Azure Cloud',
            description: 'VMs, AKS, storage.',
            icon: 'azure', // Codicon has 'azure'
            type: 'remote',
            connectCommand: 'flocca.connectAzure'
        },
        {
            id: 'jira',
            name: 'Jira',
            description: 'Projects and issues.',
            icon: 'layout', // approximation
            type: 'remote',
            connectCommand: 'flocca.connectJira'
        },
        {
            id: 'slack',
            name: 'Slack',
            description: 'Messages and channels.',
            icon: 'comment-discussion',
            type: 'local',
            connectCommand: 'flocca.connectSlack'
        },
        {
            id: 'confluence',
            name: 'Confluence',
            description: 'Search docs pages.',
            icon: 'book',
            type: 'remote',
            connectCommand: 'flocca.connectConfluence'
        },
        {
            id: 'postgres',
            name: 'PostgreSQL',
            description: 'Read-only SQL access.',
            icon: 'database',
            type: 'local',
            connectCommand: 'flocca.connectPostgres' // Assuming we have or will have this
        },
        {
            id: 'pytest',
            name: 'Pytest',
            description: 'Run Python tests locally.',
            icon: 'beaker',
            type: 'local',
            connectCommand: 'flocca.connectPytest' // Helper to add config?
        },
        {
            id: 'playwright',
            name: 'Playwright',
            description: 'Run E2E browser tests.',
            icon: 'browser',
            type: 'local',
            connectCommand: 'flocca.connectPlaywright'
        },
        {
            id: 'notion',
            name: 'Notion',
            description: 'Workspaces and pages.',
            icon: 'notebook',
            type: 'remote',
            connectCommand: 'flocca.connectNotion'
        },
        {
            id: 'sentry',
            name: 'Sentry',
            description: 'Issues and releases.',
            icon: 'bug',
            type: 'remote',
            connectCommand: 'flocca.connectSentry'
        },
        {
            id: 'github_actions',
            name: 'GitHub Actions',
            description: 'Workflows and runs.',
            icon: 'play',
            type: 'remote',
            connectCommand: 'flocca.connectGHA'
        },
        {
            id: 'aws',
            name: 'AWS Cloud',
            description: 'EC2, S3, Lambda, ECS.',
            icon: 'server',
            type: 'remote',
            connectCommand: 'flocca.connectAWS'
        },
        {
            id: 'gcp',
            name: 'Google Cloud',
            description: 'Compute and storage.',
            icon: 'cloud',
            type: 'remote',
            connectCommand: 'flocca.connectGCP'
        },
        {
            id: 'elastic',
            name: 'Elasticsearch',
            description: 'Search and analytics.',
            icon: 'search',
            type: 'remote',
            connectCommand: 'flocca.connectElastic'
        },
        {
            id: 'observability',
            name: 'Observability',
            description: 'Metrics and dashboards.',
            icon: 'graph',
            type: 'remote',
            connectCommand: 'flocca.connectObservability'
        },
        {
            id: 'codebase',
            name: 'Local Codebase',
            description: 'Search your local code.',
            icon: 'file-code',
            type: 'local',
            connectCommand: 'flocca.connectCodebase' // I need to verify if this command exists
        },
        {
            id: 'zephyr',
            name: 'Zephyr Scale',
            description: 'Jira test management.',
            icon: 'beaker',
            type: 'remote',
            connectCommand: 'flocca.connectZephyr'
        },
        {
            id: 'zephyr-enterprise',
            name: 'Zephyr Enterprise',
            description: 'Enterprise Test Management.',
            icon: 'server-process',
            type: 'remote',
            connectCommand: 'flocca.connectZephyrEnterprise'
        },
        {
            id: 'figma',
            name: 'Figma',
            description: 'Design file access.',
            icon: 'paint-can', // approximation
            type: 'remote',
            connectCommand: 'flocca.connectFigma'
        },
        {
            id: 'stripe',
            name: 'Stripe',
            description: 'Payments and billing.',
            icon: 'credit-card',
            type: 'remote',
            connectCommand: 'flocca.connectStripe',
            docsUrl: 'https://stripe.com'
        }
    ];

    getRegistry(): ServerDefinition[] {
        return this.registry;
    }
}
