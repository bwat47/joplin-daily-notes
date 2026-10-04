const register = vi.hoisted(() => vi.fn());

vi.mock('api', () => ({
    default: { plugins: { register } },
}));

describe('plugin registration', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('logs a registration rejection', async () => {
        const error = new Error('registration failed');
        register.mockRejectedValue(error);
        const { logger } = await import('./logger');
        const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});

        await import('./index');

        await vi.waitFor(() => {
            expect(logError).toHaveBeenCalledWith('Plugin registration failed.', error);
        });
    });

    test('does not log an error when registration succeeds', async () => {
        register.mockResolvedValue(undefined);
        const { logger } = await import('./logger');
        const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});

        await import('./index');

        expect(register).toHaveBeenCalledOnce();
        expect(logError).not.toHaveBeenCalled();
    });
});
