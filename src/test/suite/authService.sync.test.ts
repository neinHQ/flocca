import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { AuthService } from '../../services/authService';

suite('AuthService Connection Sync', () => {
    let sandbox: sinon.SinonSandbox;
    let service: AuthService;

    setup(() => {
        sandbox = sinon.createSandbox();
        const mockContext = {
            secrets: {
                get: sandbox.stub().resolves(undefined),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;
        service = new AuthService(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('getConnectedProviders returns only connected provider keys', async () => {
        const fetchStub = sandbox.stub(globalThis, 'fetch' as any).resolves({
            ok: true,
            json: async () => ({
                github: { connected: true },
                jira: { connected: false },
                slack: { connected: true }
            })
        } as any);

        const providers = await service.getConnectedProviders('u1');
        assert.deepStrictEqual(providers.sort(), ['github', 'slack']);
        assert.ok(fetchStub.calledOnce);
    });

    test('saveConnection posts provider payload in extension mode', async () => {
        const fetchStub = sandbox.stub(globalThis, 'fetch' as any).resolves({
            ok: true,
            text: async () => ''
        } as any);

        await service.saveConnection('jira', { email: 'a@b.com', token: 't' }, 'u1');

        assert.ok(fetchStub.calledOnce);
        const [, options] = fetchStub.firstCall.args as [string, any];
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.headers['X-Flocca-Client'], 'extension');
        const body = JSON.parse(options.body);
        assert.strictEqual(body.state, 'u1');
        assert.strictEqual(body.email, 'a@b.com');
    });
});
