import { afterAll, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProjectStructure } from '../schema/types';
import { validateStructure } from './validateStructure';

const repositorySchema = (): ProjectStructure => ({
    version: '1.0.0',
    ignore: ['node_modules'],
    root: {
        src: {
            kind: 'folder',
            required: true,
            children: {
                'index.ts': { kind: 'file', required: true },
                repositories: {
                    kind: 'folder',
                    children: {
                        '{{name}}Repository': {
                            kind: 'folder',
                            strict: true,
                            variables: { name: { convention: 'camelCase' } },
                            children: {
                                'I{{name}}Repository.ts': {
                                    kind: 'file',
                                    required: true,
                                    variables: { name: { convention: 'PascalCase' } },
                                },
                                '{{implementation}}{{name}}Repository.ts': {
                                    kind: 'file',
                                    required: true,
                                    variables: {
                                        name: { convention: 'PascalCase' },
                                        implementation: { convention: 'PascalCase' },
                                    },
                                    companions: ['{{implementation}}{{name}}Repository.unit.spec.ts'],
                                },
                            },
                        },
                    },
                },
            },
        },
    },
});

const validRepository = [
    'src/index.ts',
    'src/repositories/userAccountRepository/IUserAccountRepository.ts',
    'src/repositories/userAccountRepository/PostgresUserAccountRepository.ts',
    'src/repositories/userAccountRepository/PostgresUserAccountRepository.unit.spec.ts',
];

const tempRoots: string[] = [];
afterAll(() => tempRoots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Creates a temporary project. Paths ending in "/" are empty folders, the rest are files. */
function project(paths: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'project-structure-'));
    tempRoots.push(root);
    for (const path of paths) {
        if (path.endsWith('/')) {
            mkdirSync(join(root, path), { recursive: true });
        } else {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), '');
        }
    }
    return root;
}

function violations(paths: readonly string[], schema = repositorySchema()) {
    return validateStructure(schema, project(paths)).violations;
}

function assertViolation(paths: readonly string[], path: string, messagePart: string, schema = repositorySchema()) {
    expect(violations(paths, schema)).toContainEqual({ path, message: expect.stringContaining(messagePart) });
}

describe('validateStructure', () => {
    it('accepts a project that follows the schema', () => {
        expect(violations(validRepository)).toEqual([]);
    });

    it('ignores undeclared items outside strict folders', () => {
        expect(violations([...validRepository, 'README.md', 'src/utils/helpers.ts'])).toEqual([]);
    });

    it('ignores listed names at any depth, even in strict folders', () => {
        expect(violations([...validRepository, 'src/repositories/userAccountRepository/node_modules/x.js'])).toEqual([]);
    });

    describe('required', () => {
        it('reports missing required items on the parent folder', () => {
            assertViolation([], '.', 'required folder "src" not found');
            assertViolation(['src/main.ts'], 'src', 'required file "index.ts" not found');
        });

        it('does not enforce children of optional folders that do not exist', () => {
            expect(violations(['src/index.ts'])).toEqual([]);
        });

        it('does not count a file taken by a more specific node', () => {
            assertViolation(
                ['src/index.ts', 'src/repositories/userRepository/IUserRepository.ts'],
                'src/repositories/userRepository',
                'required file "{{implementation}}{{name}}Repository.ts" not found',
            );
        });
    });

    describe('strict', () => {
        const dir = 'src/repositories/userAccountRepository';

        it('reports undeclared files and folders', () => {
            assertViolation([...validRepository, `${dir}/helpers.ts`], `${dir}/helpers.ts`, 'file does not match any pattern of the folder');
            assertViolation([...validRepository, `${dir}/mocks/`], `${dir}/mocks`, 'folder not declared in .project-structure.json');
        });

        it('only applies to the level where it is declared', () => {
            expect(violations([...validRepository, 'src/repositories/notes.md'])).toEqual([]);
        });
    });

    describe('variables', () => {
        it('reports values that break the convention', () => {
            assertViolation(
                ['src/index.ts', 'src/repositories/UserRepository/'],
                'src/repositories/UserRepository',
                'does not follow the camelCase convention',
            );
        });

        it('reports values different from the parent folder', () => {
            const dir = 'src/repositories/userAccountRepository';
            assertViolation([...validRepository, `${dir}/IOrderRepository.ts`], `${dir}/IOrderRepository.ts`, 'same value as the parent folder');
        });

        it('accepts the same value in another convention', () => {
            const schema: ProjectStructure = {
                version: '1.0.0',
                root: {
                    '{{name}}': {
                        kind: 'folder',
                        variables: { name: { convention: 'kebab-case' } },
                        strict: true,
                        children: { '{{name}}.ts': { kind: 'file', variables: { name: { convention: 'PascalCase' } } } },
                    },
                },
            };
            expect(violations(['user-account/UserAccount.ts'], schema)).toEqual([]);
        });

        it('applies regex in addition to the convention', () => {
            const schema: ProjectStructure = {
                version: '1.0.0',
                root: { '{{name}}.ts': { kind: 'file', variables: { name: { convention: 'PascalCase', regex: '^User' } } } },
            };
            assertViolation(['OrderService.ts'], 'OrderService.ts', 'does not match the regex ^User', schema);
        });
    });

    describe('companions', () => {
        it('reports missing companions on the owner file', () => {
            const owner = 'src/repositories/userAccountRepository/PostgresUserAccountRepository.ts';
            assertViolation(
                validRepository.filter((path) => !path.endsWith('.unit.spec.ts')),
                owner,
                'companion file "PostgresUserAccountRepository.unit.spec.ts" not found',
            );
        });
    });

    it('reports items that match two equally specific nodes as ambiguous', () => {
        const schema: ProjectStructure = {
            version: '1.0.0',
            root: {
                '{{a}}.ts': { kind: 'file', variables: { a: {} } },
                '{{b}}.ts': { kind: 'file', variables: { b: {} } },
            },
        };
        assertViolation(['index.ts'], 'index.ts', 'more than one pattern', schema);
    });
});
