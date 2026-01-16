# Contributing to Beads Kanban

Thank you for your interest in contributing to Beads Kanban! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Getting Started

### Prerequisites

- Node.js 20 or higher
- VS Code 1.90 or higher
- Git
- Beads CLI (`bd`) for testing daemon adapter features

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:

   ```bash
   git clone https://github.com/YOUR-USERNAME/Beads-Kanban.git
   cd Beads-Kanban
   ```

3. Add upstream remote:

   ```bash
   git remote add upstream https://github.com/davidcforbes/Beads-Kanban.git
   ```

### Install Dependencies

```bash
npm install
```

### Build and Run

```bash
# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Run extension in debug mode
# Press F5 in VS Code with the project open
```

## Development Workflow

### 1. Create a Branch

Always create a new branch for your work:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Branch naming conventions:

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/improvements

### 2. Make Changes

- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:adapter
npm run test:validation

# Run tests in watch mode
npm run test:watch

# Check test coverage
npm run test:coverage
```

### 4. Lint Your Code

```bash
npm run lint
```

### 5. Commit Your Changes

We use conventional commit messages:

```bash
git commit -m "type(scope): description"
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test additions or modifications
- `chore`: Build process or tooling changes
- `perf`: Performance improvements

**Examples:**

```bash
git commit -m "feat(table): add column reordering via drag-and-drop"
git commit -m "fix(kanban): resolve card position issue after drag"
git commit -m "docs(readme): update installation instructions"
```

### 6. Push to Your Fork

```bash
git push origin your-branch-name
```

### 7. Create a Pull Request

1. Go to your fork on GitHub
2. Click "New Pull Request"
3. Select your branch
4. Fill out the PR template
5. Link related issues using keywords (e.g., "Fixes #123")

## Pull Request Process

### Before Submitting

- [ ] Code compiles without errors
- [ ] All tests pass
- [ ] ESLint shows no errors
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] Branch is up to date with main

### PR Requirements

1. **Clear Description**: Explain what changes you made and why
2. **Screenshots**: Include before/after screenshots for UI changes
3. **Testing**: Describe how you tested your changes
4. **Breaking Changes**: Clearly mark any breaking changes

### Review Process

1. A maintainer will review your PR within 1-2 weeks
2. Address any requested changes
3. Once approved, your PR will be merged
4. Your contribution will be credited in the release notes

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict type checking
- Avoid `any` types when possible
- Document complex types with comments

### Code Style

- Use 4 spaces for indentation (tabs for TypeScript)
- Use single quotes for strings
- Add semicolons
- Use meaningful variable names
- Keep functions small and focused
- Maximum line length: 120 characters

### File Organization

```text
src/
├── extension.ts        # Extension entry point
├── beadsAdapter.ts     # sql.js adapter
├── daemonBeadsAdapter.ts  # Daemon adapter
├── types.ts            # Type definitions
└── test/
    └── suite/          # Test files
media/
├── board.js            # Webview UI logic
└── styles.css          # Webview styling
```

### Documentation

- Add JSDoc comments for public functions
- Document complex algorithms
- Update README.md for feature changes
- Update CLAUDE.md for architecture changes

## Testing Guidelines

### Test Categories

1. **Unit Tests**: Test individual functions and modules
2. **Integration Tests**: Test adapter integration
3. **UI Tests**: Test webview functionality

### Writing Tests

```typescript
import { describe, it } from 'mocha';
import { expect } from 'chai';

describe('MyFeature', () => {
    it('should do something specific', () => {
        // Arrange
        const input = 'test';

        // Act
        const result = myFunction(input);

        // Assert
        expect(result).to.equal('expected');
    });
});
```

### Test Coverage

- Aim for >80% code coverage
- All new features must include tests
- All bug fixes must include regression tests

## Reporting Bugs

### Before Reporting

1. Check if the bug has already been reported in [Issues](https://github.com/davidcforbes/Beads-Kanban/issues)
2. Verify the bug in the latest version
3. Collect relevant information:
   - VS Code version
   - Extension version
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior

### Bug Report Template

Use the bug report template when creating an issue. Include:

- Clear, descriptive title
- Detailed steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Error messages from Developer Console
- Environment details

## Suggesting Features

### Before Suggesting

1. Check existing [Issues](https://github.com/davidcforbes/Beads-Kanban/issues) and [Discussions](https://github.com/davidcforbes/Beads-Kanban/discussions)
2. Consider if the feature aligns with project goals
3. Think about how it benefits most users

### Feature Request Template

Use the feature request template when creating an issue. Include:

- Clear, descriptive title
- Problem statement: What problem does this solve?
- Proposed solution: How should it work?
- Alternatives considered
- Mockups or examples (if applicable)
- Why this would benefit users

## Development Tips

### Debugging the Extension

1. Press `F5` to launch Extension Development Host
2. Open Developer Tools: `Help > Toggle Developer Tools`
3. Set breakpoints in TypeScript files
4. Use `console.log()` in webview code
5. Check the Output panel for extension logs

### Testing with Large Databases

```bash
# Create test database with many issues
bd create "Test issue {1..1000}" --type task

# Test incremental loading
# Open Kanban board and verify performance
```

### Hot Reload

The extension supports hot reload for webview changes:

1. Make changes to `media/board.js` or `media/styles.css`
2. Click "Refresh" button in the webview
3. No need to reload the entire extension

## Questions?

- **GitHub Discussions**: [Ask questions](https://github.com/davidcforbes/Beads-Kanban/discussions)
- **Issues**: [Report bugs or request features](https://github.com/davidcforbes/Beads-Kanban/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Beads Kanban!** 🎉

Your contributions help make this project better for everyone in the Beads community.
