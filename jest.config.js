module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@backend/(.*)$': '<rootDir>/backend/$1',
  },
  collectCoverageFrom: [
    'backend/**/*.ts',
    'shared/**/*.ts',
    '!backend/api/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
