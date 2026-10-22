import { CONVENTIONS, isConvention } from './conventions';
import { parsePattern, PatternSegment, PatternSyntaxError, VARIABLE_NAME, variableNames } from './pattern';
import type { ProjectStructure } from './types';

export const SUPPORTED_VERSIONS: readonly string[] = ['1.0.0'];

export interface SchemaIssue {
    /** JSON Pointer (RFC 6901) to the offending value, e.g. `/root/src/children/index.ts/kind`. */
    path: string;
    message: string;
}

export type SchemaValidationResult =
    | { valid: true; schema: ProjectStructure; issues: [] }
    | { valid: false; issues: SchemaIssue[] };

type NodeKind = 'folder' | 'file';
type JsonObject = Record<string, unknown>;

const ROOT_FIELDS: readonly string[] = ['version', 'ignore', 'root'];
const VARIABLE_FIELDS: readonly string[] = ['convention', 'regex'];
const COMMON_NODE_FIELDS: readonly string[] = ['kind', 'description', 'required', 'variables'];
const KIND_ONLY_FIELDS: Record<NodeKind, readonly string[]> = {
    folder: ['children', 'strict'],
    file: ['companions'],
};

/**
 * Checks that a parsed `.project-structure.json` follows the format described in the README.
 * Reports every problem found instead of stopping at the first one.
 */
export function validateSchema(input: unknown): SchemaValidationResult {
    const validator = new SchemaValidator();
    validator.validate(input);

    if (validator.issues.length === 0) {
        return { valid: true, schema: input as ProjectStructure, issues: [] };
    }
    return { valid: false, issues: validator.issues };
}

class SchemaValidator {
    readonly issues: SchemaIssue[] = [];

    validate(input: unknown): void {
        if (!isObject(input)) {
            this.report('', 'the schema must be a JSON object');
            return;
        }

        this.checkUnknownFields(input, '', ROOT_FIELDS);
        this.validateVersion(input.version);
        this.validateIgnore(input.ignore);

        if (input.root === undefined) {
            this.report('/root', 'missing required field');
        } else {
            this.validateChildren(input.root, '/root', new Set());
        }
    }

    private validateVersion(value: unknown): void {
        if (value === undefined) {
            this.report('/version', 'missing required field');
        } else if (typeof value !== 'string') {
            this.report('/version', 'must be a string');
        } else if (!SUPPORTED_VERSIONS.includes(value)) {
            this.report('/version', `unsupported version "${value}"; supported: ${SUPPORTED_VERSIONS.join(', ')}`);
        }
    }

    private validateIgnore(value: unknown): void {
        if (value === undefined) {
            return;
        }
        if (!Array.isArray(value)) {
            this.report('/ignore', 'must be an array of names');
            return;
        }

        const seen = new Set<string>();
        value.forEach((entry: unknown, index) => {
            const path = pointer('/ignore', String(index));
            if (typeof entry !== 'string' || entry === '') {
                this.report(path, 'must be a non-empty string');
            } else if (/[/\\]/.test(entry)) {
                this.report(path, 'must be an exact name, without "/" or "\\"');
            } else if (seen.has(entry)) {
                this.report(path, `"${entry}" is listed more than once`);
            }
            if (typeof entry === 'string') {
                seen.add(entry);
            }
        });
    }

    private validateChildren(value: unknown, path: string, boundVariables: ReadonlySet<string>): void {
        if (!isObject(value)) {
            this.report(path, 'must be an object mapping names to nodes');
            return;
        }
        for (const [name, node] of Object.entries(value)) {
            this.validateNode(name, node, pointer(path, name), boundVariables);
        }
    }

    /**
     * @param boundVariables variables already matched by ancestor folders.
     */
    private validateNode(name: string, value: unknown, path: string, boundVariables: ReadonlySet<string>): void {
        if (!isObject(value)) {
            this.report(path, 'must be an object');
            return;
        }

        const kind = value.kind;
        if (kind === undefined) {
            this.report(pointer(path, 'kind'), 'missing required field');
            return;
        }
        if (kind !== 'folder' && kind !== 'file') {
            this.report(pointer(path, 'kind'), 'must be "folder" or "file"');
            return;
        }

        this.checkNodeFields(value, path, kind);
        this.expectOptional(value.description, 'string', pointer(path, 'description'));
        this.expectOptional(value.required, 'boolean', pointer(path, 'required'));

        const declared = this.validateVariables(value.variables, pointer(path, 'variables'));
        const segments = this.validateName(name, path);
        const used = segments ? variableNames(segments) : [...declared];
        if (segments) {
            this.checkVariableUsage(segments, declared, boundVariables, path);
        }

        if (kind === 'folder') {
            this.expectOptional(value.strict, 'boolean', pointer(path, 'strict'));
            if (value.children !== undefined) {
                const childBound = new Set([...boundVariables, ...used]);
                this.validateChildren(value.children, pointer(path, 'children'), childBound);
            }
        } else {
            this.validateCompanions(value.companions, pointer(path, 'companions'), name, new Set(used));
        }
    }

    private checkNodeFields(value: JsonObject, path: string, kind: NodeKind): void {
        const otherKind: NodeKind = kind === 'folder' ? 'file' : 'folder';
        for (const field of Object.keys(value)) {
            if (COMMON_NODE_FIELDS.includes(field) || KIND_ONLY_FIELDS[kind].includes(field)) {
                continue;
            }
            if (KIND_ONLY_FIELDS[otherKind].includes(field)) {
                this.report(pointer(path, field), `only allowed when "kind" is "${otherKind}"`);
            } else {
                this.report(pointer(path, field), 'unknown field');
            }
        }
    }

    /**
     * Returns the names of the declared variables, even the ones whose definition is invalid,
     * so that usage checks don't report them a second time.
     */
    private validateVariables(value: unknown, path: string): Set<string> {
        const declared = new Set<string>();
        if (value === undefined) {
            return declared;
        }
        if (!isObject(value)) {
            this.report(path, 'must be an object mapping variable names to definitions');
            return declared;
        }

        for (const [name, definition] of Object.entries(value)) {
            declared.add(name);
            const definitionPath = pointer(path, name);

            if (!VARIABLE_NAME.test(name)) {
                this.report(definitionPath, 'invalid variable name; use letters, digits and "_", not starting with a digit');
            }
            if (!isObject(definition)) {
                this.report(definitionPath, 'must be an object');
                continue;
            }

            this.checkUnknownFields(definition, definitionPath, VARIABLE_FIELDS);

            const { convention, regex } = definition;
            if (convention !== undefined && (typeof convention !== 'string' || !isConvention(convention))) {
                this.report(
                    pointer(definitionPath, 'convention'),
                    `must be one of: ${Object.keys(CONVENTIONS).join(', ')}`,
                );
            }
            if (regex !== undefined) {
                if (typeof regex !== 'string') {
                    this.report(pointer(definitionPath, 'regex'), 'must be a string');
                } else {
                    try {
                        new RegExp(regex);
                    } catch (error) {
                        this.report(pointer(definitionPath, 'regex'), `invalid regular expression: ${errorMessage(error)}`);
                    }
                }
            }
        }

        return declared;
    }

    private validateName(name: string, path: string): PatternSegment[] | undefined {
        if (name === '') {
            this.report(path, 'name cannot be empty');
            return undefined;
        }

        let segments: PatternSegment[];
        try {
            segments = parsePattern(name);
        } catch (error) {
            if (error instanceof PatternSyntaxError) {
                this.report(path, `invalid name: ${error.message}`);
                return undefined;
            }
            throw error;
        }

        if (/[/\\]/.test(name)) {
            this.report(path, 'name cannot contain "/" or "\\"; declare nested items with "children"');
        } else if (name === '.' || name === '..') {
            this.report(path, `"${name}" is not a valid name`);
        }

        return segments;
    }

    private checkVariableUsage(
        segments: readonly PatternSegment[],
        declared: ReadonlySet<string>,
        boundVariables: ReadonlySet<string>,
        path: string,
    ): void {
        const used = variableNames(segments);
        const usedSet = new Set(used);

        for (const name of usedSet) {
            if (!declared.has(name)) {
                this.report(path, `variable "{{${name}}}" is used in the name but not declared in "variables"`);
            }
            if (used.indexOf(name) !== used.lastIndexOf(name)) {
                this.report(path, `variable "{{${name}}}" is used more than once in the name`);
            }
        }
        for (const name of declared) {
            if (!usedSet.has(name)) {
                this.report(pointer(pointer(path, 'variables'), name), 'variable is declared but not used in the name');
            }
        }

        // Adjacent variables like `{{implementation}}{{name}}` can only be split when all but one
        // of them already have a value from an ancestor folder.
        let run: string[] = [];
        const checkRun = () => {
            const unbound = run.filter((name) => !boundVariables.has(name));
            if (unbound.length > 1) {
                const written = run.map((name) => `{{${name}}}`).join('');
                this.report(
                    path,
                    `adjacent variables ${written} cannot be told apart; all but one must come from a parent folder ` +
                        `(new here: ${unbound.join(', ')})`,
                );
            }
            run = [];
        };
        for (const segment of segments) {
            if (segment.kind === 'variable') {
                run.push(segment.name);
            } else {
                checkRun();
            }
        }
        checkRun();
    }

    private validateCompanions(value: unknown, path: string, ownerName: string, ownerVariables: ReadonlySet<string>): void {
        if (value === undefined) {
            return;
        }
        if (!Array.isArray(value)) {
            this.report(path, 'must be an array of file names');
            return;
        }

        const seen = new Set<string>();
        value.forEach((companion: unknown, index) => {
            const companionPath = pointer(path, String(index));
            if (typeof companion !== 'string') {
                this.report(companionPath, 'must be a string');
                return;
            }

            const segments = this.validateName(companion, companionPath);
            if (!segments) {
                return;
            }

            if (companion === ownerName) {
                this.report(companionPath, 'a file cannot be its own companion');
            }
            if (seen.has(companion)) {
                this.report(companionPath, `"${companion}" is listed more than once`);
            }
            seen.add(companion);

            for (const name of new Set(variableNames(segments))) {
                if (!ownerVariables.has(name)) {
                    this.report(companionPath, `variable "{{${name}}}" is not used in the owner file's name`);
                }
            }
        });
    }

    private checkUnknownFields(value: JsonObject, path: string, allowed: readonly string[]): void {
        for (const field of Object.keys(value)) {
            if (!allowed.includes(field)) {
                this.report(pointer(path, field), 'unknown field');
            }
        }
    }

    private expectOptional(value: unknown, type: 'string' | 'boolean', path: string): void {
        if (value !== undefined && typeof value !== type) {
            this.report(path, `must be a ${type}`);
        }
    }

    private report(path: string, message: string): void {
        this.issues.push({ path, message });
    }
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointer(path: string, key: string): string {
    return `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
