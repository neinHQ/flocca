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

describe('Auth password reset routes', () => {
  const forgotPassword = findRouteHandler('/forgot-password', 'post');
  const resetPassword = findRouteHandler('/reset-password', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.RESET_PASSWORD_URL;
  });

  test('POST /auth/forgot-password validates email', async () => {
    const req = { body: {} };
    const res = makeRes();

    await forgotPassword(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Email required/);
  });

  test('POST /auth/forgot-password always returns success for unknown email', async () => {
    __mockPrisma.user.findUnique.mockResolvedValue(null);
    const req = { body: { email: 'missing@example.com' } };
    const res = makeRes();

    await forgotPassword(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(__mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('POST /auth/forgot-password stores reset token hash for known user', async () => {
    __mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'test@example.com' });
    __mockPrisma.user.update.mockResolvedValue({});
    const req = { body: { email: 'test@example.com' } };
    const res = makeRes();

    await forgotPassword(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.resetToken).toBe('string');
    expect(res.body.resetToken.length).toBeGreaterThan(20);
    expect(__mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({
        passwordResetTokenHash: expect.any(String),
        passwordResetExpiresAt: expect.any(Date)
      })
    }));
  });

  test('POST /auth/reset-password validates minimum password length', async () => {
    const req = { body: { token: 'tok', password: 'short' } };
    const res = makeRes();
    await resetPassword(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/at least 8/);
  });

  test('POST /auth/reset-password rejects invalid token', async () => {
    __mockPrisma.user.findFirst.mockResolvedValue(null);
    const req = { body: { token: 'badtoken', password: 'longenough123' } };
    const res = makeRes();

    await resetPassword(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid or expired/);
  });

  test('POST /auth/reset-password updates password and clears token fields', async () => {
    __mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    __mockPrisma.user.update.mockResolvedValue({});
    const req = { body: { token: 'validtoken', password: 'longenough123' } };
    const res = makeRes();

    await resetPassword(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(__mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({
        password: expect.any(String),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      })
    }));
  });
});
