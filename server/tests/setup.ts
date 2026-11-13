process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'unit-test-session-signing-secret-32-characters';
process.env.MOCK_GEMINI ??= 'true';
