# Testing Guide

This project has comprehensive test coverage for both utility functions and data persistence operations.

## Quick Start

```bash
# Run all tests
npm run test:run

# Run tests with coverage report
npm run test:cov

# Interactive test runner (watch mode)
npm test
```

## Test Suites

### 1. Utility Functions (`app-utils.spec.ts`)
Tests pure business logic functions without external dependencies.

```bash
# Run utility tests only
npm run test:run src/__tests__/app-utils.spec.ts
```

**Coverage: 26 tests**
- ✅ Date/time helpers (`getWeekStart`, `formatTimeLabel`, time conversions)
- ✅ Color palette selection (`nextPaletteColor`)
- ✅ Statistics computation (`computeWeeklyStats`)
- ✅ Week management (`buildCopyWeekPatch`, `countWeekBlocks`)
- ✅ Edge cases & performance testing
- ✅ Parameterized tests for multiple scenarios

### 2. Data Persistence (`data-persistence.spec.ts`)
Tests database operations and data saving/loading with mocked Supabase.

```bash
# Run persistence tests only
npm run test:run src/__tests__/data-persistence.spec.ts
```

**Coverage: 13 tests**
- ✅ **Objective CRUD**: Create, read, update, delete operations
- ✅ **Schedule Persistence**: Save/load weekly schedules
- ✅ **User Preferences**: Settings persistence
- ✅ **Error Handling**: Auth failures, network timeouts, database errors
- ✅ **Data Validation**: Input validation and constraint handling
- ✅ **Calendar Detection**: Check for existing entries

## Test Commands Reference

| Command | Description | Use Case |
|---------|-------------|----------|
| `npm test` | Interactive test runner | Development & debugging |
| `npm run test:run` | Run all tests once | CI/CD & verification |
| `npm run test:cov` | Run with coverage report | Code quality analysis |

## Coverage Reports

After running `npm run test:cov`:

1. **Terminal Summary** - Quick overview of coverage percentages
2. **HTML Report** - Open `coverage/lcov-report/index.html` in browser for detailed line-by-line coverage
3. **Coverage Files** - Generated in `coverage/` directory

### Coverage Metrics
- **Lines**: Percentage of code lines executed
- **Functions**: Percentage of functions called
- **Branches**: Percentage of if/else paths taken
- **Statements**: Percentage of code statements executed

## Test Structure

```
src/__tests__/
├── app-utils.spec.ts      # Pure function tests (fast)
└── data-persistence.spec.ts   # Database operation tests (mocked)
```

## What's Tested

### ✅ Business Logic
- Time calculations and formatting
- Week start calculations (Monday/Sunday)
- Color palette management
- Statistics computation
- Data structure transformations

### ✅ Data Operations
- Objective management (CRUD)
- Schedule saving and loading
- User preferences persistence
- Authentication handling
- Error scenarios and retries

### ✅ Edge Cases
- Invalid inputs
- Boundary values
- Empty data sets
- Network failures
- Authentication errors

## Expected Behavior

### Successful Test Run
```
✓ src/__tests__/app-utils.spec.ts (26 tests)
✓ src/__tests__/data-persistence.spec.ts (13 tests)

Test Files  2 passed (2)
     Tests  39 passed (39)
```

### Error Logging
Some tests intentionally trigger errors to verify error handling:
```
stderr | Database operation failed: saveWeek {
  code: undefined,
  message: 'Database connection failed',
  timestamp: '2025-09-25T13:16:51.262Z'
}
```
These are **expected and indicate proper error handling**.

## Mocking Strategy

- **Supabase**: Completely mocked to avoid real database calls
- **Query Builder**: Full mock implementation supporting all Supabase methods
- **Authentication**: Mocked user sessions and auth states
- **Error Scenarios**: Controlled error injection for testing failure paths

## Performance Expectations

- **Utility Tests**: ~11ms (very fast, pure functions)
- **Persistence Tests**: ~6s (includes retry logic and error handling)
- **Total Runtime**: ~7s for full test suite

## Troubleshooting

### Common Issues

**Test Timeouts**
- Default timeout: 5000ms
- Persistence tests may take longer due to retry logic
- All current tests are optimized to complete within timeouts

**Mock Errors**
- If tests fail with "query.method is not a function", the mock may be missing Supabase methods
- Current implementation includes comprehensive method coverage

**Coverage Issues**
- Low coverage usually indicates untested error paths or edge cases
- Focus on testing critical business logic over 100% coverage

## Development Workflow

1. **Write Tests First** (TDD approach recommended)
2. **Run Tests Frequently** during development
3. **Check Coverage** before commits
4. **Update Tests** when adding new features

## CI/CD Integration

For automated testing in CI/CD pipelines:

```bash
# Install dependencies
npm ci

# Run tests (fails on any test failure)
npm run test:run

# Generate coverage report
npm run test:cov
```

## Future Enhancements

Potential test improvements:
- Integration tests with real database (test environment)
- End-to-end testing with Cypress/Playwright
- Visual regression testing for UI components
- API contract testing
- Load testing for database operations

---

**Current Status: ✅ 39/39 tests passing**

This testing setup provides confidence in both the business logic and data persistence layers of the application.