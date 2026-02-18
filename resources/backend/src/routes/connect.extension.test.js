jest.mock('../db', () => ({
  user: { upsert: jest.fn() },
  connection: { upsert: jest.fn() }
}));

jest.mock('../../utils/crypto', () => ({
  encrypt: jest.fn(() => ({ encryptedData: 'enc', iv: 'abcd1234' }))
}));

const prisma = require('../db');
const connectRouter = require('./connect');

function findRouteHandler(path, method) {
  const layer = connectRouter.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[0].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    redirectUrl: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    }
  };
}

describe('Connect route extension mode', () => {
  const postConnect = findRouteHandler('/:provider', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_KEY = 'test-key';
    prisma.user.upsert.mockResolvedValue({ id: 'u1' });
    prisma.connection.upsert.mockResolvedValue({});
  });

  test('POST /connect/:provider returns JSON for extension client and upserts connection', async () => {
    const req = {
      params: { provider: 'jira' },
      headers: { 'x-flocca-client': 'extension' },
      body: {
        state: 'u1',
        email: 'a@b.com',
        token: 'tkn',
        site: 'https://company.atlassian.net'
      }
    };
    const res = makeRes();

    await postConnect(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, provider: 'jira', userId: 'u1' });
    expect(prisma.connection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_provider: {
          userId: 'u1',
          provider: 'jira'
        }
      },
      update: expect.objectContaining({
        encryptedData: 'enc'
      }),
      data: expect.objectContaining({
        userId: 'u1',
        provider: 'jira'
      })
    }));
  });
});
