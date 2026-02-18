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
            description: 'Manage projects, MRs, and pipelines.',
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
            description: 'Inspect clusters, pods, logs, and apply manifests.',
            icon: 'server',
            type: 'remote',
            connectCommand: 'flocca.connectKubernetes'
        },
        {
            id: 'azuredevops',
            name: 'Azure DevOps',
            description: 'Boards, Repos, and Pipelines.',
            icon: 'cloud',
            type: 'remote',
            connectCommand: 'flocca.connectAzureDevOps'
        },
        {
            id: 'docker',
            name: 'Docker',
            description: 'Manage containers and images.',
            icon: 'vm',
            type: 'local',
            connectCommand: 'flocca.connectDocker'
        },
        {
            id: 'testrail',
            name: 'TestRail',
            description: 'Manage Test Cases, Runs, and Results.',
            icon: 'beaker',
            type: 'remote',
            connectCommand: 'flocca.connectTestRail'
        },
        {
            id: 'cypress',
            name: 'Cypress',
            description: 'E2E Testing Execution & Artifacts.',
            icon: 'play-circle',
            type: 'local',
            connectCommand: 'flocca.connectCypress'
        },
        {
            id: 'teams',
            name: 'Microsoft Teams',
            description: 'Messaging, Channels, and Users.',
            icon: 'comment',
            type: 'remote',
            connectCommand: 'flocca.connectTeams'
        },

        {
            id: 'azure',
            name: 'Azure Cloud',
            description: 'VMs, App Service, AKS, Monitor, Storage.',
            icon: 'azure', // Codicon has 'azure'
            type: 'remote',
            connectCommand: 'flocca.connectAzure'
        },
        {
            id: 'jira',
            name: 'Jira',
            description: 'Manage projects, issues, and agile boards.',
            icon: 'layout', // approximation
            type: 'remote',
            connectCommand: 'flocca.connectJira'
        },
        {
            id: 'slack',
            name: 'Slack',
            description: 'Send messages and manage channels.',
            icon: 'comment-discussion',
            type: 'local',
            connectCommand: 'flocca.connectSlack'
        },
        {
            id: 'confluence',
            name: 'Confluence',
            description: 'Search and read documentation pages.',
            icon: 'book',
            type: 'remote',
            connectCommand: 'flocca.connectConfluence'
        },
        {
            id: 'postgres',
            name: 'PostgreSQL',
            description: 'Read-only access to SQL databases.',
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
            description: 'Access workspaces and pages.',
            icon: 'notebook',
            type: 'remote',
            connectCommand: 'flocca.connectNotion'
        },
        {
            id: 'sentry',
            name: 'Sentry',
            description: 'Monitor Issues and Releases.',
            icon: 'bug',
            type: 'remote',
            connectCommand: 'flocca.connectSentry'
        },
        {
            id: 'github_actions',
            name: 'GitHub Actions',
            description: 'Workflows, Runs, and CI/CD.',
            icon: 'play',
            type: 'remote',
            connectCommand: 'flocca.connectGHA'
        },
        {
            id: 'aws',
            name: 'AWS Cloud',
            description: 'EC2, S3, Lambda, CloudWatch, ECS, EKS.',
            icon: 'server',
            type: 'remote',
            connectCommand: 'flocca.connectAWS'
        },
        {
            id: 'gcp',
            name: 'Google Cloud',
            description: 'Compute, Storage, and Kubernetes Engine.',
            icon: 'cloud',
            type: 'remote',
            connectCommand: 'flocca.connectGCP'
        },
        {
            id: 'elastic',
            name: 'Elasticsearch',
            description: 'Search and analyze data in real-time.',
            icon: 'search',
            type: 'remote',
            connectCommand: 'flocca.connectElastic'
        },
        {
            id: 'observability',
            name: 'Observability',
            description: 'Prometheus Metrics and Grafana Dashboards.',
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
            description: 'Test Management for Jira (Cloud/Server).',
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
            description: 'Design file access and introspection.',
            icon: 'paint-can', // approximation
            type: 'remote',
            connectCommand: 'flocca.connectFigma'
        },
        {
            id: 'stripe',
            name: 'Stripe',
            description: 'Manage payments and subscriptions.',
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
