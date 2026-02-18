const logsRouter = require('./logs');

function findRouteHandler(path, method) {
  const layer = logsRouter.stack.find(
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

describe('Logs route', () => {
  const postClientLog = findRouteHandler('/client', 'post');
  let logSpy;
  let errSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('POST /logs/client accepts info logs', () => {
    const req = {
      body: {
        level: 'info',
        message: 'connect_attempt',
        provider: 'jira',
        phase: 'attempt',
        userId: 'u1'
      }
    };
    const res = makeRes();

    postClientLog(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(logSpy).toHaveBeenCalled();
  });

  test('POST /logs/client routes error logs to console.error', () => {
    const req = {
      body: {
        level: 'error',
        message: 'connect_failed',
        provider: 'jira',
        phase: 'connect_local',
        userId: 'u1',
        context: { error: 'boom' }
      }
    };
    const res = makeRes();

    postClientLog(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(errSpy).toHaveBeenCalled();
  });
});
