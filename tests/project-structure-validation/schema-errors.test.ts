import { describe, expect, it } from '@jest/globals';
import { validateSchema } from '../../src/schema/validateSchema';

/**
 * Error scenarios of `validateSchema`, following the rules described in the README.
 * Each `describe` mirrors a README section.
 */

/** Wraps nodes as the root of an otherwise valid schema. */
const withRoot = (root: unknown) => ({ version: '1.0.0', root });

/** Wraps a single node as the only child of the root. */
const withNode = (name: string, node: unknown) => withRoot({ [name]: node });

/** Wraps a single node as the only child of a `src` folder. */
const insideSrc = (name: string, node: unknown) => withRoot({ src: { kind: 'folder', children: { [name]: node } } });

function issues(input: unknown) {
    const result = validateSchema(input);
    return result.valid ? [] : result.issues;
}

function expectValid(input: unknown) {
    expect(issues(input)).toEqual([]);
}

function expectIssue(input: unknown, path: string, messagePart: string) {
    expect(issues(input)).toContainEqual({ path, message: expect.stringContaining(messagePart) });
}

function expectIssueAt(input: unknown, path: string) {
    expect(issues(input)).toContainEqual(expect.objectContaining({ path }));
}

describe('schema error scenarios described in the README', () => {
    describe('error output', () => {
        it('reports the README example with JSON Pointers to each problem', () => {
            const input = insideSrc('{{name}}.ts', { kind: 'file', strict: true });
            expect(issues(input)).toEqual(
                expect.arrayContaining([
                    {
                        path: '/root/src/children/{{name}}.ts',
                        message: 'variable "{{name}}" is used in the name but not declared in "variables"',
                    },
                    { path: '/root/src/children/{{name}}.ts/strict', message: 'only allowed when "kind" is "folder"' },
                ]),
            );
            expect(issues(input)).toHaveLength(2);
        });

        it('escapes "~" and "/" in JSON Pointers', () => {
            expectIssueAt(withNode('a~b', { kind: 'dir' }), '/root/a~0b/kind');
            expectIssueAt(withNode('a/b', { kind: 'file' }), '/root/a~1b');
        });

        it('returns the schema only when it is valid', () => {
            const valid = validateSchema(withRoot({}));
            expect(valid).toEqual({ valid: true, schema: withRoot({}), issues: [] });

            const invalid = validateSchema({});
            expect(invalid.valid).toBe(false);
            expect(invalid).not.toHaveProperty('schema');
        });

        it('reports every problem instead of stopping at the first', () => {
            const input = {
                ignore: 'node_modules',
                root: {
                    'a.ts': { kind: 'file', children: {} },
                    src: { kind: 'folder', required: 'yes', companions: [] },
                },
            };
            expect(issues(input)).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: '/version' }),
                    expect.objectContaining({ path: '/ignore' }),
                    expect.objectContaining({ path: '/root/a.ts/children' }),
                    expect.objectContaining({ path: '/root/src/required' }),
                    expect.objectContaining({ path: '/root/src/companions' }),
                ]),
            );
        });
    });

    describe('file fields', () => {
        it.each([[[]], [null], ['schema'], [1]])('rejects a schema that is not a JSON object: %p', (input) => {
            expectIssueAt(input, '');
        });

        it('requires "version"', () => {
            expectIssue({ root: {} }, '/version', 'missing required field');
        });

        it('requires "version" to be a string', () => {
            expectIssue({ version: 1, root: {} }, '/version', 'must be a string');
        });

        it('requires "root"', () => {
            expectIssue({ version: '1.0.0' }, '/root', 'missing required field');
        });

        it.each([[[]], ['src'], [null], [1]])('requires "root" to be an object: %p', (root) => {
            expectIssueAt(withRoot(root), '/root');
        });

        it('accepts an empty "root"', () => {
            expectValid(withRoot({}));
        });

        it('accepts a schema without "ignore"', () => {
            expectValid(withRoot({ src: { kind: 'folder' } }));
        });
    });

    describe('ignore', () => {
        const withIgnore = (ignore: unknown) => ({ version: '1.0.0', ignore, root: {} });

        it.each([['node_modules'], [{}], [null]])('requires an array: %p', (ignore) => {
            expectIssueAt(withIgnore(ignore), '/ignore');
        });

        it.each([[1], [null], [true], [{}]])('requires every entry to be a string: %p', (entry) => {
            expectIssueAt(withIgnore(['node_modules', entry]), '/ignore/1');
        });

        it('rejects entries with a path, since entries are exact names', () => {
            expectIssueAt(withIgnore(['dist/cache']), '/ignore/0');
            expectIssueAt(withIgnore(['dist\\cache']), '/ignore/0');
        });

        it('accepts glob-looking entries as literal names', () => {
            expectValid(withIgnore(['*.log', 'node_modules', '.git']));
        });
    });

    describe('nodes', () => {
        describe('kind', () => {
            it('is required', () => {
                expectIssue(withNode('src', {}), '/root/src/kind', 'missing required field');
            });

            it.each([['dir'], ['Folder'], ['FILE'], [1], [null]])('must be "folder" or "file": %p', (kind) => {
                expectIssueAt(withNode('src', { kind }), '/root/src/kind');
            });
        });

        it.each([['string'], [1], [null], [[]], [true]])('must be an object: %p', (node) => {
            expectIssueAt(withNode('src', node), '/root/src');
        });

        describe('names', () => {
            it('cannot contain "/"', () => {
                expectIssueAt(withNode('src/index.ts', { kind: 'file' }), '/root/src~1index.ts');
            });

            it('cannot contain "\\"', () => {
                expectIssueAt(withNode('src\\index.ts', { kind: 'file' }), '/root/src\\index.ts');
            });

            it('cannot contain "/" in nested children either', () => {
                expectIssueAt(insideSrc('lib/index.ts', { kind: 'file' }), '/root/src/children/lib~1index.ts');
            });

            it('accepts nested items declared with "children"', () => {
                expectValid(
                    withNode('src', { kind: 'folder', children: { lib: { kind: 'folder', children: { 'index.ts': { kind: 'file' } } } } }),
                );
            });
        });

        describe('fields', () => {
            it.each([['optional'], ['name'], ['pattern'], ['ignore'], ['Kind']])('rejects the unknown field "%s"', (field) => {
                expectIssue(withNode('src', { kind: 'folder', [field]: true }), `/root/src/${field}`, 'unknown field');
                expectIssue(withNode('a.ts', { kind: 'file', [field]: true }), `/root/a.ts/${field}`, 'unknown field');
            });

            it.each([['children', {}], ['strict', true]])('rejects the folder-only field "%s" on a file', (field, value) => {
                expectIssue(withNode('a.ts', { kind: 'file', [field]: value }), `/root/a.ts/${field}`, 'only allowed when "kind" is "folder"');
            });

            it('rejects the file-only field "companions" on a folder', () => {
                expectIssue(withNode('src', { kind: 'folder', companions: [] }), '/root/src/companions', 'only allowed when "kind" is "file"');
            });

            it.each([['folder'], ['file']])('accepts "description", "required" and "variables" on a %s', (kind) => {
                expectValid(withNode('{{name}}', { kind, description: 'text', required: true, variables: { name: {} } }));
            });
        });

        describe('field types', () => {
            it.each([[1], [true], [null], [{}]])('"description" must be a string: %p', (description) => {
                expectIssueAt(withNode('src', { kind: 'folder', description }), '/root/src/description');
            });

            it.each([['true'], [1], [null], [{}]])('"required" must be a boolean: %p', (required) => {
                expectIssueAt(withNode('src', { kind: 'folder', required }), '/root/src/required');
                expectIssueAt(withNode('a.ts', { kind: 'file', required }), '/root/a.ts/required');
            });

            it.each([['true'], [1], [null], [{}]])('"strict" must be a boolean: %p', (strict) => {
                expectIssueAt(withNode('src', { kind: 'folder', strict }), '/root/src/strict');
            });

            it.each([[[]], ['index.ts'], [1], [null]])('"children" must be an object: %p', (children) => {
                expectIssueAt(withNode('src', { kind: 'folder', children }), '/root/src/children');
            });

            it.each([['a.spec.ts'], [{}], [1], [null]])('"companions" must be an array: %p', (companions) => {
                expectIssueAt(withNode('a.ts', { kind: 'file', companions }), '/root/a.ts/companions');
            });

            it.each([[1], [null], [{}], [[]]])('every companion must be a string: %p', (companion) => {
                expectIssueAt(withNode('a.ts', { kind: 'file', companions: ['a.spec.ts', companion] }), '/root/a.ts/companions/1');
            });

            it.each([['camelCase'], [[]], [1], [null]])('"variables" must be an object: %p', (variables) => {
                expectIssueAt(withNode('src', { kind: 'folder', variables }), '/root/src/variables');
            });
        });

        it('validates nested children with the same rules as the root', () => {
            const input = insideSrc('lib', {
                kind: 'folder',
                children: { 'a.ts': { kind: 'file', strict: true }, b: { kind: 'dir' } },
            });
            expectIssue(input, '/root/src/children/lib/children/a.ts/strict', 'only allowed when "kind" is "folder"');
            expectIssueAt(input, '/root/src/children/lib/children/b/kind');
        });
    });

    describe('variables', () => {
        describe('declaration', () => {
            it('requires every variable used in the name to be declared', () => {
                expectIssue(
                    withNode('{{name}}Repository', { kind: 'folder' }),
                    '/root/{{name}}Repository',
                    'variable "{{name}}" is used in the name but not declared in "variables"',
                );
            });

            it('reports each undeclared variable', () => {
                const input = withNode('{{a}}-{{b}}.ts', { kind: 'file', variables: {} });
                expectIssue(input, '/root/{{a}}-{{b}}.ts', '"{{a}}"');
                expectIssue(input, '/root/{{a}}-{{b}}.ts', '"{{b}}"');
            });

            it('requires the declaration in the node itself, even if a parent folder declares it', () => {
                const input = withNode('{{name}}Repository', {
                    kind: 'folder',
                    variables: { name: {} },
                    children: { 'I{{name}}Repository.ts': { kind: 'file' } },
                });
                expectIssue(
                    input,
                    '/root/{{name}}Repository/children/I{{name}}Repository.ts',
                    'variable "{{name}}" is used in the name but not declared in "variables"',
                );
            });

            it('requires every declared variable to be used in the name', () => {
                expectIssueAt(withNode('index.ts', { kind: 'file', variables: { name: {} } }), '/root/index.ts/variables/name');
            });

            it('accepts a declaration without convention or regex', () => {
                expectValid(withNode('{{name}}.ts', { kind: 'file', variables: { name: {} } }));
            });

            it.each([['camelCase'], [1], [null], [[]]])('requires each definition to be an object: %p', (definition) => {
                expectIssueAt(withNode('{{name}}.ts', { kind: 'file', variables: { name: definition } }), '/root/{{name}}.ts/variables/name');
            });
        });

        describe('variable names', () => {
            it.each([['1name'], ['my-name'], ['my.name'], ['my name'], ['nome$']])('rejects "%s" in the node name', (variable) => {
                const name = `{{${variable}}}.ts`;
                expectIssueAt(withNode(name, { kind: 'file', variables: { [variable]: {} } }), `/root/${name}`);
            });

            it.each([['1name'], ['my-name'], ['my.name']])('rejects "%s" in the "variables" block', (variable) => {
                expectIssueAt(withNode('index.ts', { kind: 'file', variables: { [variable]: {} } }), `/root/index.ts/variables/${variable}`);
            });

            it.each([['name'], ['_name'], ['Name2'], ['my_name'], ['NAME']])('accepts "%s"', (variable) => {
                const name = `{{${variable}}}.ts`;
                expectValid(withNode(name, { kind: 'file', variables: { [variable]: {} } }));
            });
        });

        it('rejects a variable used more than once in the same name', () => {
            expectIssueAt(withNode('{{name}}.{{name}}.ts', { kind: 'file', variables: { name: {} } }), '/root/{{name}}.{{name}}.ts');
        });

        describe('convention', () => {
            const withConvention = (convention: unknown) =>
                withNode('{{name}}.ts', { kind: 'file', variables: { name: { convention } } });

            it.each([
                ['camelCase'],
                ['PascalCase'],
                ['snake_case'],
                ['kebab-case'],
                ['SCREAMING_SNAKE_CASE'],
                ['SCREAMING-KEBAB-CASE'],
                ['flatcase'],
                ['SCREAMINGFLATCASE'],
                ['Train-Case'],
            ])('accepts %s', (convention) => {
                expectValid(withConvention(convention));
            });

            it.each([['camelcase'], ['pascalCase'], ['UPPERCASE'], ['lowercase'], [''], [1], [null], [['camelCase']]])(
                'rejects %p',
                (convention) => {
                    expectIssueAt(withConvention(convention), '/root/{{name}}.ts/variables/name/convention');
                },
            );
        });

        describe('regex', () => {
            const withRegex = (regex: unknown) => withNode('{{name}}.ts', { kind: 'file', variables: { name: { regex } } });

            it('accepts a valid regular expression, alone or with a convention', () => {
                expectValid(withRegex('^[A-Z][a-zA-Z0-9]*$'));
                expectValid(withNode('{{name}}.ts', { kind: 'file', variables: { name: { convention: 'PascalCase', regex: '^User' } } }));
            });

            it.each([[1], [true], [null], [{}]])('must be a string: %p', (regex) => {
                expectIssueAt(withRegex(regex), '/root/{{name}}.ts/variables/name/regex');
            });

            it.each([['[a-z'], ['(abc'], ['*abc'], ['a{2,1}']])('rejects the invalid regular expression %p', (regex) => {
                expectIssueAt(withRegex(regex), '/root/{{name}}.ts/variables/name/regex');
            });
        });

        describe('adjacent variables', () => {
            it('rejects them when none comes from a parent folder', () => {
                const input = withNode('{{implementation}}{{name}}Repository.ts', {
                    kind: 'file',
                    variables: { implementation: {}, name: {} },
                });
                expectIssueAt(input, '/root/{{implementation}}{{name}}Repository.ts');
            });

            it('rejects them when more than one is new, even if another comes from a parent folder', () => {
                const input = withNode('{{name}}Repository', {
                    kind: 'folder',
                    variables: { name: {} },
                    children: {
                        '{{a}}{{b}}{{name}}.ts': { kind: 'file', variables: { a: {}, b: {}, name: {} } },
                    },
                });
                expectIssueAt(input, '/root/{{name}}Repository/children/{{a}}{{b}}{{name}}.ts');
            });

            it('accepts them when all but one come from a parent folder', () => {
                const input = withNode('{{name}}Repository', {
                    kind: 'folder',
                    variables: { name: {} },
                    children: {
                        '{{implementation}}{{name}}Repository.ts': {
                            kind: 'file',
                            variables: { implementation: {}, name: {} },
                        },
                    },
                });
                expectValid(input);
            });

            it('accepts a value from any ancestor folder, not only the direct parent', () => {
                const input = withNode('{{name}}', {
                    kind: 'folder',
                    variables: { name: {} },
                    children: {
                        lib: {
                            kind: 'folder',
                            children: { '{{prefix}}{{name}}.ts': { kind: 'file', variables: { prefix: {}, name: {} } } },
                        },
                    },
                });
                expectValid(input);
            });

            it('does not take values from sibling folders', () => {
                const input = withRoot({
                    '{{name}}': { kind: 'folder', variables: { name: {} } },
                    '{{prefix}}{{name}}.ts': { kind: 'file', variables: { prefix: {}, name: {} } },
                });
                expectIssueAt(input, '/root/{{prefix}}{{name}}.ts');
            });

            it('accepts variables separated by a fixed part', () => {
                expectValid(withNode('{{a}}.{{b}}.ts', { kind: 'file', variables: { a: {}, b: {} } }));
            });
        });
    });

    describe('companions', () => {
        const ownerWithCompanions = (companions: unknown) =>
            withNode('{{name}}.ts', { kind: 'file', variables: { name: {} }, companions });

        it('accepts companions using the owner variables', () => {
            expectValid(ownerWithCompanions(['{{name}}.unit.spec.ts', '{{name}}.md']));
        });

        it('accepts fixed companions', () => {
            expectValid(withNode('index.ts', { kind: 'file', companions: ['index.spec.ts'] }));
        });

        it('rejects variables the owner does not declare', () => {
            expectIssueAt(ownerWithCompanions(['{{other}}.spec.ts']), '/root/{{name}}.ts/companions/0');
            expectIssueAt(withNode('index.ts', { kind: 'file', companions: ['{{name}}.spec.ts'] }), '/root/index.ts/companions/0');
        });

        it('rejects variables that only an ancestor folder declares', () => {
            const input = withNode('{{name}}Repository', {
                kind: 'folder',
                variables: { name: {} },
                children: { 'index.ts': { kind: 'file', companions: ['{{name}}.spec.ts'] } },
            });
            expectIssueAt(input, '/root/{{name}}Repository/children/index.ts/companions/0');
        });

        it('rejects companions with a path', () => {
            expectIssueAt(ownerWithCompanions(['__tests__/{{name}}.spec.ts']), '/root/{{name}}.ts/companions/0');
            expectIssueAt(ownerWithCompanions(['__tests__\\{{name}}.spec.ts']), '/root/{{name}}.ts/companions/0');
        });

        it('rejects companions on a folder', () => {
            expectIssue(withNode('src', { kind: 'folder', companions: ['index.ts'] }), '/root/src/companions', 'only allowed when "kind" is "file"');
        });
    });
});
