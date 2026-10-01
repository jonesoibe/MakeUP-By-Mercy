module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Several suites boot the whole app; give them room
  testTimeout: 30000,
  collectCoverageFrom: ['server.js'],
  coverageDirectory: 'coverage',
  // Floors, not goals: they fail the run if coverage regresses.
  coverageThreshold: {
    global: { statements: 70, branches: 55, functions: 70, lines: 70 }
  }
};
