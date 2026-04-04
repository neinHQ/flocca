module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/resources/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.vscode-test/',
    '/out/',
    '/src/'
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/.vscode-test'
  ]
};
