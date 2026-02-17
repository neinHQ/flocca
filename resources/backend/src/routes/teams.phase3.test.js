jest.mock('@prisma/client', () => {
  const mockPrisma = {
    teamMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn()
    },
    team: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn()
    },
    user: {
      upsert: jest.fn(),
      findUnique: jest.fn()
    },
    inviteCode: {
      create: jest.fn(),
      findUnique: jest.fn()
    }
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma),
    __mockPrisma: mockPrisma
  };
});

jest.mock('stripe', () => {
  const mockStripe = {
    subscriptions: {
      retrieve: jest.fn(),
      update: jest.fn()
    }
  };
  return () => mockStripe;
});

const { __mockPrisma } = require('@prisma/client');
const stripeClient = require('stripe')();
const teamsRouter = require('./teams');

function findRouteHandler(path, method) {
  const layer = teamsRouter.stack.find(
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

describe('Phase 3.1 team seats routes', () => {
  const seatSummaryHandler = findRouteHandler('/:teamId/seats/summary', 'get');
  const assignHandler = findRouteHandler('/:teamId/seats/assign', 'post');
  const topupHandler = findRouteHandler('/:teamId/seats/topup', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PRICE_ID_TEAMS = 'price_team';
    process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_ent';
  });

  test('seat summary returns purchased/used/available', async () => {
    __mockPrisma.teamMember.findUnique.mockResolvedValue({ userId: 'u1', teamId: 't1', role: 'MEMBER' });
    __mockPrisma.team.findUnique.mockResolvedValue({
      id: 't1',
      seatPlan: 'teams',
      billingUser: { id: 'u1', stripeSubscriptionId: 'sub_1' },
      members: [
        { userId: 'u1', assignedSkus: ['qa_core'] },
        { userId: 'u2', assignedSkus: [] }
      ]
    });
    stripeClient.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 3, price: { id: 'price_team' } }] }
    });

    const req = { headers: { 'x-flocca-user-id': 'u1' }, params: { teamId: 't1' }, query: {} };
    const res = makeRes();

    await seatSummaryHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.seatsPurchased).toBe(3);
    expect(res.body.seatsUsed).toBe(1);
    expect(res.body.seatsAvailable).toBe(2);
    expect(res.body.topUpMinimum).toBe(3);
  });

  test('assign denies non-admin member', async () => {
    __mockPrisma.teamMember.findUnique.mockResolvedValue({ userId: 'u1', teamId: 't1', role: 'MEMBER' });

    const req = {
      headers: { 'x-flocca-user-id': 'u1' },
      params: { teamId: 't1' },
      body: { targetUserId: 'u2', skus: ['qa_core'] },
      query: {}
    };
    const res = makeRes();

    await assignHandler(req, res);
    expect(res.statusCode).toBe(403);
  });

  test('assign returns 409 when seat limit is exceeded', async () => {
    __mockPrisma.teamMember.findUnique.mockImplementation(({ where }) => {
      const id = where.userId_teamId.userId;
      if (id === 'admin') return Promise.resolve({ userId: 'admin', teamId: 't1', role: 'ADMIN', assignedSkus: ['qa_core'] });
      if (id === 'u2') return Promise.resolve({ userId: 'u2', teamId: 't1', role: 'MEMBER', assignedSkus: [] });
      return Promise.resolve(null);
    });

    __mockPrisma.team.findUnique.mockResolvedValue({
      id: 't1',
      seatPlan: 'teams',
      billingUser: { id: 'admin', stripeSubscriptionId: 'sub_1' },
      members: [
        { userId: 'admin', assignedSkus: ['qa_core'] },
        { userId: 'u2', assignedSkus: [] }
      ]
    });

    stripeClient.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_team' } }] }
    });

    const req = {
      headers: { 'x-flocca-user-id': 'admin' },
      params: { teamId: 't1' },
      body: { targetUserId: 'u2', skus: ['qa_core'] },
      query: {}
    };
    const res = makeRes();

    await assignHandler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/Seat limit exceeded/);
    expect(res.body.seats.topUpMinimum).toBe(3);
  });

  test('top up seats updates subscription quantity with proration', async () => {
    __mockPrisma.teamMember.findUnique.mockResolvedValue({ userId: 'owner', teamId: 't1', role: 'OWNER' });
    __mockPrisma.team.findUnique.mockResolvedValue({
      id: 't1',
      seatPlan: 'teams',
      billingUser: { id: 'owner', stripeSubscriptionId: 'sub_1' },
      members: []
    });

    stripeClient.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', quantity: 3, price: { id: 'price_team' } }] }
    });
    stripeClient.subscriptions.update.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_1', quantity: 6, price: { id: 'price_team' } }] }
    });

    const req = {
      headers: { 'x-flocca-user-id': 'owner' },
      params: { teamId: 't1' },
      body: { addSeats: 3 },
      query: {}
    };
    const res = makeRes();

    await topupHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.seatsPurchased).toBe(6);
    expect(stripeClient.subscriptions.update).toHaveBeenCalledWith('sub_1', expect.objectContaining({
      proration_behavior: 'create_prorations'
    }));
  });
});
