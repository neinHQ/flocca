import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { DashboardProvider } from '../../ui/chatProvider';
import { McpClientManager } from '../../services/mcpClientService';
import { TeamService } from '../../services/teamService';
import { AuthService } from '../../services/authService';

suite('DashboardProvider Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let provider: DashboardProvider;
    let mockClientManager: any;
    let mockContext: any;
    let mockWebviewView: any;
    let mockWebview: any;
    let mockState: Map<string, any>;
    let onDidReceiveMessageCallback: (data: any) => void;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockState = new Map<string, any>();
        mockState.set('flocca.subscriptionStatus', 'active');
        mockState.set('flocca.userId', 'u1');
        mockState.set('flocca.email', 'user@example.com');

        // 1. Mock McpClientManager
        mockClientManager = {
            getClient: sandbox.stub().returns(undefined), // Default disconnected
            getConnectedClients: sandbox.stub().returns([]),
            disconnect: sandbox.stub().resolves(),
            connectLocal: sandbox.stub().resolves()
        };

        // 2. Mock Context for Subscription
        mockContext = {
            globalState: {
                get: sandbox.stub().callsFake((key: string) => mockState.get(key)),
                update: sandbox.stub().callsFake(async (key: string, value: any) => {
                    mockState.set(key, value);
                })
            },
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves()
            },
            asAbsolutePath: (p: string) => `/abs/${p}`
        };

        // 3. Mock Webview
        onDidReceiveMessageCallback = () => { };
        mockWebview = {
            options: {},
            html: '',
            onDidReceiveMessage: (cb: any) => { onDidReceiveMessageCallback = cb; },
            postMessage: sandbox.spy()
        };

        mockWebviewView = {
            webview: mockWebview
        };

        sandbox.stub(global, 'setTimeout').callsFake((() => 0) as any);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);
        sandbox.stub(TeamService.prototype, 'getMyTeams').resolves([]);

        // 4. Create Provider
        // @ts-ignore
        provider = new DashboardProvider(vscode.Uri.parse('file:///tmp'), mockClientManager as McpClientManager, mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('updateStatus sends correct paid/connected status', async () => {
        // Setup connected state
        mockClientManager.getConnectedClients.returns(['github']);

        // Resolve view
        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});

        // Trigger update
        await provider.updateStatus();

        // Assert
        assert.ok(mockWebview.postMessage.called);
        const args = mockWebview.postMessage.lastCall.args[0];
        assert.strictEqual(args.type, 'updateStatus');
        assert.ok(args.status.connectedServers.includes('github'));
        assert.strictEqual(args.status.isPaid, true);
    });

    test('connectCommand message triggers command', async () => {
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');

        // Resolve view
        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});

        // Simulate Message
        await onDidReceiveMessageCallback({ type: 'connectCommand', command: 'flocca.connectGitHub' });

        // Assert
        assert.ok(executeCommandStub.calledWith('flocca.connectGitHub'));
    });

    test('openSeatManager loads and posts seat manager data', async () => {
        const getSeatSummaryStub = sandbox.stub(TeamService.prototype, 'getSeatSummary').resolves({
            plan: 'teams',
            seatsPurchased: 3,
            seatsUsed: 1,
            seatsAvailable: 2,
            topUpMinimum: 3
        });
        const getSeatAssignmentsStub = sandbox.stub(TeamService.prototype, 'getSeatAssignments').resolves([
            { userId: 'u1', email: 'a@b.com', role: 'OWNER', skus: ['qa_core'] }
        ]);
        const getSkuCatalogStub = sandbox.stub(TeamService.prototype, 'getSkuCatalog').resolves([
            { id: 'qa_core', name: 'QA Core' }
        ]);

        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        await onDidReceiveMessageCallback({ type: 'openSeatManager', teamId: 't1' });

        assert.ok(getSeatSummaryStub.calledOnceWithExactly('t1'));
        assert.ok(getSeatAssignmentsStub.calledOnceWithExactly('t1'));
        assert.ok(getSkuCatalogStub.calledOnce);
        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'seatManagerData',
                data: sinon.match({
                    teamId: 't1',
                    summary: sinon.match.has('seatsPurchased', 3)
                })
            })
        );
    });

    test('assignSkus posts seatLimitExceeded when API returns 409', async () => {
        const err: any = new Error('Seat limit exceeded');
        err.status = 409;
        err.payload = {
            seats: {
                requiredAdditional: 2,
                recommendedTopUp: 3
            }
        };

        sandbox.stub(TeamService.prototype, 'assignSkus').rejects(err);
        sandbox.stub(TeamService.prototype, 'getSeatSummary').resolves({
            plan: 'teams',
            seatsPurchased: 1,
            seatsUsed: 1,
            seatsAvailable: 0,
            topUpMinimum: 3
        });
        sandbox.stub(TeamService.prototype, 'getSeatAssignments').resolves([]);
        sandbox.stub(TeamService.prototype, 'getSkuCatalog').resolves([]);

        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        await onDidReceiveMessageCallback({
            type: 'assignSkus',
            teamId: 't1',
            targetUserId: 'u2',
            skus: ['qa_core']
        });

        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'seatLimitExceeded',
                data: sinon.match({
                    requiredAdditional: 2,
                    recommendedTopUp: 3
                })
            })
        );
    });

    test('assignSkus success refreshes seat manager, updates status, and shows toast', async () => {
        const assignSkusStub = sandbox.stub(TeamService.prototype, 'assignSkus').resolves({
            success: true
        });
        const getSeatSummaryStub = sandbox.stub(TeamService.prototype, 'getSeatSummary').resolves({
            plan: 'teams',
            seatsPurchased: 3,
            seatsUsed: 2,
            seatsAvailable: 1,
            topUpMinimum: 3
        });
        sandbox.stub(TeamService.prototype, 'getSeatAssignments').resolves([
            { userId: 'u1', email: 'a@b.com', role: 'OWNER', skus: ['qa_core'] },
            { userId: 'u2', email: 'c@d.com', role: 'MEMBER', skus: ['qa_core'] }
        ]);
        sandbox.stub(TeamService.prototype, 'getSkuCatalog').resolves([
            { id: 'qa_core', name: 'QA Core' }
        ]);

        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        await onDidReceiveMessageCallback({
            type: 'assignSkus',
            teamId: 't1',
            targetUserId: 'u2',
            skus: ['qa_core']
        });

        const infoStub = vscode.window.showInformationMessage as unknown as sinon.SinonStub;
        assert.ok(assignSkusStub.calledOnceWithExactly('t1', 'u2', ['qa_core']));
        assert.ok(getSeatSummaryStub.calledOnceWithExactly('t1'));
        assert.ok(infoStub.calledWith('Seat assignment updated.'));
        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'seatManagerData',
                data: sinon.match({ teamId: 't1' })
            })
        );
        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'updateStatus'
            })
        );
    });

    test('topUpSeats calls service and refreshes seat manager data', async () => {
        const topUpSeatsStub = sandbox.stub(TeamService.prototype, 'topUpSeats').resolves({
            success: true,
            seatsPurchased: 6
        });
        const getSeatSummaryStub = sandbox.stub(TeamService.prototype, 'getSeatSummary').resolves({
            plan: 'teams',
            seatsPurchased: 6,
            seatsUsed: 2,
            seatsAvailable: 4,
            topUpMinimum: 3
        });
        sandbox.stub(TeamService.prototype, 'getSeatAssignments').resolves([]);
        sandbox.stub(TeamService.prototype, 'getSkuCatalog').resolves([]);

        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        await onDidReceiveMessageCallback({
            type: 'topUpSeats',
            teamId: 't1',
            addSeats: 3
        });

        assert.ok(topUpSeatsStub.calledOnceWithExactly('t1', 3));
        assert.ok(getSeatSummaryStub.calledOnceWithExactly('t1'));
        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'seatManagerData',
                data: sinon.match({ teamId: 't1' })
            })
        );
    });

    test('showSubscriptionManager posts showSubscription message', () => {
        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        provider.showSubscriptionManager();

        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'showSubscription'
            })
        );
    });

    test('logout message disconnects clients, clears state and posts loggedOut', async () => {
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
        mockClientManager.getConnectedClients.returns(['github', 'jira']);

        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        await onDidReceiveMessageCallback({ type: 'logout' });

        assert.strictEqual(mockState.get('flocca.email'), undefined);
        assert.strictEqual(mockState.get('flocca.subscriptionStatus'), undefined);
        assert.ok(mockClientManager.disconnect.calledTwice);
        assert.ok(mockClientManager.disconnect.calledWith('github'));
        assert.ok(mockClientManager.disconnect.calledWith('jira'));
        assert.ok(
            mockWebview.postMessage.calledWithMatch({
                type: 'loggedOut'
            })
        );
        assert.ok(executeCommandStub.calledWith('setContext', 'flocca.auth.loggedIn', false));
        assert.ok(executeCommandStub.calledWith('setContext', 'flocca.auth.paid', false));
    });

    test('login restores cloud-backed MCP connections on new device', async () => {
        sandbox.stub(AuthService.prototype, 'login').resolves({
            user: {
                id: 'u_cloud',
                email: 'user@example.com',
                entitlements: { planTier: 'pro', capabilities: ['pro.connectors'] }
            }
        } as any);
        sandbox.stub(AuthService.prototype, 'getConnectedProviders').resolves(['github']);
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});
        await onDidReceiveMessageCallback({ type: 'login', email: 'user@example.com', password: 'pw' });

        assert.ok(mockClientManager.connectLocal.calledWithMatch(
            'github',
            'node',
            sinon.match.array,
            sinon.match({
                FLOCCA_USER_ID: 'u_cloud',
                FLOCCA_PROXY_URL: sinon.match(/\/proxy\/github$/)
            })
        ));
        assert.ok(executeCommandStub.calledWith('setContext', 'flocca.connected.github', true));
    });
});
