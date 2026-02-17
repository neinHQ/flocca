jest.mock('@prisma/client', () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn()
    }
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma),
    __mockPrisma: mockPrisma
  };
});

const { __mockPrisma } = require('@prisma/client');
const authRouter = require('./auth');

function findRouteHandler(path, method) {
  const layer = authRouter.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[0].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('Phase 2 auth entitlements routes', () => {
  const getEntitlements = findRouteHandler('/entitlements', 'get');
  const postEntitlements = findRouteHandler('/entitlements', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_API_KEY = 'test-admin-key';
  });

  test('GET /auth/entitlements requires userId', async () => {
    const req = { query: {}, headers: {} };
    const res = makeRes();

    await getEntitlements(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing userId/);
  });

  test('GET /auth/entitlements returns computed entitlements', async () => {
    __mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      subscriptionStatus: 'teams',
      planTier: 'team',
      capabilityOverrides: null
    });

    const req = { query: { userId: 'u1' }, headers: {} };
    const res = makeRes();

    await getEntitlements(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.entitlements.planTier).toBe('team');
    expect(res.body.entitlements.capabilities).toEqual(expect.arrayContaining(['pro.connectors', 'pro.tools']));
  });

  test('POST /auth/entitlements requires admin key', async () => {
    const req = { headers: {}, body: { userId: 'u1', planTier: 'enterprise' } };
    const res = makeRes();

    await postEntitlements(req, res);
    expect(res.statusCode).toBe(403);
  });

  test('POST /auth/entitlements updates plan and overrides', async () => {
    __mockPrisma.user.update.mockResolvedValue({
      id: 'u1',
      subscriptionStatus: 'free',
      planTier: 'enterprise',
      capabilityOverrides: { allow: ['enterprise.sso'], deny: ['pro.tools'] }
    });

    const req = {
      headers: { 'x-admin-key': 'test-admin-key' },
      body: {
        userId: 'u1',
        planTier: 'enterprise',
        allow: ['enterprise.sso'],
        deny: ['pro.tools']
      }
    };
    const res = makeRes();

    await postEntitlements(req, res);
    expect(res.statusCode).toBe(200);

    expect(__mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: {
        planTier: 'enterprise',
        capabilityOverrides: { allow: ['enterprise.sso'], deny: ['pro.tools'] }
      }
    }));

    expect(res.body.user.entitlements.capabilities).toContain('enterprise.sso');
    expect(res.body.user.entitlements.capabilities).not.toContain('pro.tools');
  });
});
