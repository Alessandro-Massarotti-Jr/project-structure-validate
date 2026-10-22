import { describe, expect, it } from '@jest/globals';
import { validateSchema } from './validateSchema';

const repositorySchema = () => ({
    version: '1.0.0',
    ignore: ['node_modules', 'dist'],
    root: {
        src: {
            kind: 'folder',
            required: true,
            description: 'Source code',
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
                                        name: { convention: 'PascalCase', regex: '^[A-Z]' },
                                        implementation: {},
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

/** Wraps a single node as the only child of the root. */
const withNode = (name: string, node: unknown) => ({ version: '1.0.0', root: { [name]: node } });

function issues(input: unknown) {
    const result = validateSchema(input);
    return result.valid ? [] : result.issues;
}

function assertIssue(input: unknown, path: string, messagePart: string) {
    expect(issues(input)).toContainEqual({ path, message: expect.stringContaining(messagePart) });
}

describe('validateSchema', () => {
    it('accepts a valid schema', () => {
        const result = validateSchema(repositorySchema());
        expect(result.valid ? [] : result.issues).toEqual([]);
        expect(result.valid).toBe(true);
    });

    describe('top level', () => {
        it('rejects anything that is not an object', () => {
            assertIssue([], '', 'must be a JSON object');
            assertIssue(null, '', 'must be a JSON object');
        });

        it('requires version and root', () => {
            assertIssue({}, '/version', 'missing required field');
            assertIssue({}, '/root', 'missing required field');
        });

        it('rejects unsupported versions', () => {
            assertIssue({ version: '2.0.0', root: {} }, '/version', 'unsupported version');
            assertIssue({ version: 1, root: {} }, '/version', 'must be a string');
        });

        it('rejects unknown fields', () => {
            assertIssue({ version: '1.0.0', root: {}, extra: true }, '/extra', 'unknown field');
        });

        it('validates ignore entries', () => {
            const input = { version: '1.0.0', root: {}, ignore: ['dist', 'a/b', '', 'dist'] };
            assertIssue(input, '/ignore/1', 'exact name');
            assertIssue(input, '/ignore/2', 'non-empty string');
            assertIssue(input, '/ignore/3', 'more than once');
            assertIssue({ version: '1.0.0', root: {}, ignore: 'dist' }, '/ignore', 'must be an array');
        });
    });

    describe('nodes', () => {
        it('requires a valid kind', () => {
            assertIssue(withNode('src', {}), '/root/src/kind', 'missing required field');
            assertIssue(withNode('src', { kind: 'dir' }), '/root/src/kind', 'must be "folder" or "file"');
        });

        it('rejects fields that belong to the other kind', () => {
            assertIssue(withNode('a.ts', { kind: 'file', children: {} }), '/root/a.ts/children', 'only allowed when "kind" is "folder"');
            assertIssue(withNode('a.ts', { kind: 'file', strict: true }), '/root/a.ts/strict', 'only allowed when "kind" is "folder"');
            assertIssue(withNode('src', { kind: 'folder', companions: [] }), '/root/src/companions', 'only allowed when "kind" is "file"');
        });

        it('rejects unknown fields and wrong types', () => {
            assertIssue(withNode('src', { kind: 'folder', optional: true }), '/root/src/optional', 'unknown field');
            assertIssue(withNode('src', { kind: 'folder', required: 'yes' }), '/root/src/required', 'must be a boolean');
            assertIssue(withNode('src', { kind: 'folder', strict: 1 }), '/root/src/strict', 'must be a boolean');
            assertIssue(withNode('src', { kind: 'folder', description: 1 }), '/root/src/description', 'must be a string');
            assertIssue(withNode('src', { kind: 'folder', children: [] }), '/root/src/children', 'must be an object');
        });

        it('rejects invalid names', () => {
            assertIssue(withNode('', { kind: 'file' }), '/root/', 'cannot be empty');
            assertIssue(withNode('src/index.ts', { kind: 'file' }), '/root/src~1index.ts', 'cannot contain "/"');
            assertIssue(withNode('..', { kind: 'folder' }), '/root/..', 'not a valid name');
            assertIssue(withNode('{{name.ts', { kind: 'file' }), '/root/{{name.ts', 'never closed');
            assertIssue(withNode('name}}.ts', { kind: 'file' }), '/root/name}}.ts', 'without a matching');
            assertIssue(withNode('{{1x}}.ts', { kind: 'file' }), '/root/{{1x}}.ts', 'invalid variable name');
        });

        it('reports problems in nested children', () => {
            const input = withNode('src', { kind: 'folder', children: { lib: { kind: 'folder', children: { 'a.ts': {} } } } });
            assertIssue(input, '/root/src/children/lib/children/a.ts/kind', 'missing required field');
        });
    });

    describe('variables', () => {
        it('requires every variable in the name to be declared', () => {
            assertIssue(withNode('{{name}}.ts', { kind: 'file' }), '/root/{{name}}.ts', '"{{name}}" is used in the name but not declared');
        });

        it('rejects declared variables that are not used', () => {
            const input = withNode('index.ts', { kind: 'file', variables: { name: {} } });
            assertIssue(input, '/root/index.ts/variables/name', 'declared but not used');
        });

        it('accepts variables without convention or regex', () => {
            expect(issues(withNode('{{name}}.ts', { kind: 'file', variables: { name: {} } }))).toEqual([]);
        });

        it('rejects a variable used twice in the same name', () => {
            const input = withNode('{{name}}-{{name}}.ts', { kind: 'file', variables: { name: {} } });
            assertIssue(input, '/root/{{name}}-{{name}}.ts', 'used more than once');
        });

        it('validates convention and regex', () => {
            const node = (definition: unknown) => withNode('{{name}}.ts', { kind: 'file', variables: { name: definition } });
            assertIssue(node({ convention: 'UPPERCASE' }), '/root/{{name}}.ts/variables/name/convention', 'must be one of');
            assertIssue(node({ regex: '[a-z' }), '/root/{{name}}.ts/variables/name/regex', 'invalid regular expression');
            assertIssue(node({ regex: 1 }), '/root/{{name}}.ts/variables/name/regex', 'must be a string');
            assertIssue(node({ pattern: 'x' }), '/root/{{name}}.ts/variables/name/pattern', 'unknown field');
            assertIssue(node('PascalCase'), '/root/{{name}}.ts/variables/name', 'must be an object');
        });

        it.each([
            'camelCase',
            'PascalCase',
            'snake_case',
            'kebab-case',
            'SCREAMING_SNAKE_CASE',
            'SCREAMING-KEBAB-CASE',
            'flatcase',
            'SCREAMINGFLATCASE',
            'Train-Case',
        ])('accepts the documented convention %s', (convention) => {
            const input = withNode('{{name}}.ts', { kind: 'file', variables: { name: { convention } } });
            expect(issues(input)).toEqual([]);
        });

        it('rejects adjacent variables when none comes from a parent folder', () => {
            const input = withNode('{{implementation}}{{name}}Repository.ts', {
                kind: 'file',
                variables: { implementation: {}, name: {} },
            });
            assertIssue(input, '/root/{{implementation}}{{name}}Repository.ts', 'adjacent variables {{implementation}}{{name}}');
        });

        it('does not treat variables of sibling folders as bound', () => {
            const input = {
                version: '1.0.0',
                root: {
                    '{{name}}': { kind: 'folder', variables: { name: {} } },
                    '{{a}}{{name}}.ts': { kind: 'file', variables: { a: {}, name: {} } },
                },
            };
            assertIssue(input, '/root/{{a}}{{name}}.ts', 'adjacent variables');
        });
    });

    describe('companions', () => {
        const fileWithCompanions = (companions: unknown) =>
            withNode('{{name}}.ts', { kind: 'file', variables: { name: {} }, companions });

        it('accepts companions using the owner variables', () => {
            expect(issues(fileWithCompanions(['{{name}}.spec.ts', '{{name}}.md']))).toEqual([]);
        });

        it('rejects variables the owner does not use', () => {
            assertIssue(fileWithCompanions(['{{other}}.spec.ts']), '/root/{{name}}.ts/companions/0', '"{{other}}" is not used in the owner');
        });

        it('rejects invalid companion lists', () => {
            assertIssue(fileWithCompanions('{{name}}.spec.ts'), '/root/{{name}}.ts/companions', 'must be an array');
            assertIssue(fileWithCompanions([1]), '/root/{{name}}.ts/companions/0', 'must be a string');
            assertIssue(fileWithCompanions(['{{name}}.ts']), '/root/{{name}}.ts/companions/0', 'its own companion');
            assertIssue(fileWithCompanions(['a.ts', 'a.ts']), '/root/{{name}}.ts/companions/1', 'more than once');
            assertIssue(fileWithCompanions(['{{name.spec.ts']), '/root/{{name}}.ts/companions/0', 'never closed');
            assertIssue(fileWithCompanions(['spec/{{name}}.ts']), '/root/{{name}}.ts/companions/0', 'cannot contain "/"');
        });
    });

    it('reports every problem instead of stopping at the first', () => {
        const found = issues({ version: 2, root: { a: { kind: 'x' }, b: 1 }, extra: 1 });
        expect(found).toHaveLength(4);
    });
});
