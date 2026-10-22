import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONVENTIONS } from '../schema/conventions';
import { parsePattern, PatternSegment } from '../schema/pattern';
import type { ProjectStructure, StructureNode } from '../schema/types';

export interface StructureViolation {
    /** Path of the offending item relative to the project root, with "/" separators ("." for the root itself). */
    path: string;
    message: string;
}

export interface StructureValidationResult {
    valid: boolean;
    violations: StructureViolation[];
}

export interface StructureValidationOptions {
    /** Name of the schema file, used in messages. Default: `.project-structure.json`. */
    schemaFileName?: string;
}

type NodeKind = StructureNode['kind'];
type Variables = ReadonlyMap<string, string>;

interface CompiledNode {
    name: string;
    node: StructureNode;
    segments: PatternSegment[];
    /** Number of characters outside variables; the node with more wins when an item matches several. */
    fixedLength: number;
}

interface NodeMatch {
    compiled: CompiledNode;
    /** Variable values as written in the item's name. */
    values: Map<string, string>;
    problems: string[];
}

type Resolution =
    | { type: 'match'; match: NodeMatch }
    | { type: 'ambiguous'; matches: NodeMatch[] }
    | { type: 'none' };

/** A variable matches letters, digits, "-" and "_", never "." or "/". */
const VARIABLE_CHAR = /^[A-Za-z0-9_-]$/;

/**
 * Checks that the folders and files under `rootDir` follow an already validated schema,
 * using the rules described in the README. Reports every violation found.
 */
export function validateStructure(
    schema: ProjectStructure,
    rootDir: string,
    options: StructureValidationOptions = {},
): StructureValidationResult {
    const validator = new StructureValidator(schema, options.schemaFileName ?? '.project-structure.json');
    validator.validateFolder(rootDir, '.', schema.root, false, new Map());
    return { valid: validator.violations.length === 0, violations: validator.violations };
}

class StructureValidator {
    readonly violations: StructureViolation[] = [];
    private readonly ignore: ReadonlySet<string>;

    constructor(
        schema: ProjectStructure,
        private readonly schemaFileName: string,
    ) {
        this.ignore = new Set(schema.ignore ?? []);
    }

    validateFolder(
        dir: string,
        relativePath: string,
        children: Record<string, StructureNode>,
        strict: boolean,
        bound: Variables,
    ): void {
        const nodes = Object.entries(children).map(([name, node]) => compile(name, node));
        const entries = readdirSync(dir, { withFileTypes: true })
            .filter((entry) => !this.ignore.has(entry.name))
            .sort((a, b) => a.name.localeCompare(b.name));
        const fileNames = new Set(entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name));

        const resolved = entries.map((entry) => {
            const kind: NodeKind = entry.isDirectory() ? 'folder' : 'file';
            return { entry, kind, path: childPath(relativePath, entry.name), resolution: resolve(entry.name, kind, nodes, bound) };
        });

        // Companions of the valid files are declared items, even when they match no node.
        const companions = new Map<string, string[]>();
        for (const { kind, path, resolution } of resolved) {
            if (kind === 'file' && resolution.type === 'match' && resolution.match.problems.length === 0) {
                companions.set(path, companionNames(resolution.match));
            }
        }
        const companionSet = new Set([...companions.values()].flat());

        const matchedNodes = new Set<CompiledNode>();
        for (const { entry, kind, path, resolution } of resolved) {
            if (resolution.type === 'match') {
                const { compiled, values, problems } = resolution.match;
                matchedNodes.add(compiled);

                if (problems.length > 0) {
                    if (!companionSet.has(entry.name)) {
                        this.report(path, `${label(kind)} does not match "${compiled.name}": ${problems.join('; ')}`);
                    }
                } else if (compiled.node.kind === 'folder') {
                    this.validateFolder(
                        join(dir, entry.name),
                        path,
                        compiled.node.children ?? {},
                        compiled.node.strict ?? false,
                        new Map([...bound, ...values]),
                    );
                }
            } else if (resolution.type === 'ambiguous') {
                const names = resolution.matches.map((match) => `"${match.compiled.name}"`).join(', ');
                this.report(path, `${label(kind)} matches more than one pattern: ${names}`);
            } else if (strict && !companionSet.has(entry.name)) {
                this.report(
                    path,
                    kind === 'folder' ? `folder not declared in ${this.schemaFileName}` : 'file does not match any pattern of the folder',
                );
            }
        }

        for (const [ownerPath, names] of companions) {
            for (const name of names) {
                if (!fileNames.has(name)) {
                    this.report(ownerPath, `companion file "${name}" not found`);
                }
            }
        }

        for (const compiled of nodes) {
            if (compiled.node.required && !matchedNodes.has(compiled)) {
                this.report(
                    relativePath,
                    compiled.node.kind === 'folder'
                        ? `required folder "${compiled.name}" not found`
                        : `required file "${compiled.name}" not found`,
                );
            }
        }
    }

    private report(path: string, message: string): void {
        this.violations.push({ path, message });
    }
}

function compile(name: string, node: StructureNode): CompiledNode {
    const segments = parsePattern(name);
    const fixedLength = segments.reduce((total, segment) => total + (segment.kind === 'literal' ? segment.value.length : 0), 0);
    return { name, node, segments, fixedLength };
}

/**
 * Picks the node an item belongs to. Nodes whose variables are all satisfied are preferred; among them,
 * the most specific one wins. When no node is satisfied, the most specific one whose shape matches is
 * returned with its problems so they can be reported.
 */
function resolve(name: string, kind: NodeKind, nodes: readonly CompiledNode[], bound: Variables): Resolution {
    const candidates = nodes
        .filter((compiled) => compiled.node.kind === kind)
        .map((compiled) => bestMatch(compiled, name, bound))
        .filter((match): match is NodeMatch => match !== undefined);

    const valid = candidates.filter((match) => match.problems.length === 0);
    const pool = valid.length > 0 ? valid : candidates;
    if (pool.length === 0) {
        return { type: 'none' };
    }

    const best = Math.max(...pool.map((match) => match.compiled.fixedLength));
    const top = pool.filter((match) => match.compiled.fixedLength === best);
    if (valid.length > 0 && top.length > 1) {
        return { type: 'ambiguous', matches: top };
    }
    return { type: 'match', match: top[0]! };
}

/** Among every way the name can be split into the node's variables, returns the one with the fewest problems. */
function bestMatch(compiled: CompiledNode, name: string, bound: Variables): NodeMatch | undefined {
    let best: NodeMatch | undefined;
    for (const values of splits(compiled.segments, name)) {
        const problems = variableProblems(compiled.node, values, bound);
        if (!best || problems.length < best.problems.length) {
            best = { compiled, values, problems };
        }
        if (problems.length === 0) {
            break;
        }
    }
    return best;
}

function splits(segments: readonly PatternSegment[], name: string): Map<string, string>[] {
    const results: Map<string, string>[] = [];
    const values = new Map<string, string>();

    const walk = (index: number, position: number): void => {
        const segment = segments[index];
        if (!segment) {
            if (position === name.length) {
                results.push(new Map(values));
            }
            return;
        }
        if (segment.kind === 'literal') {
            if (name.startsWith(segment.value, position)) {
                walk(index + 1, position + segment.value.length);
            }
            return;
        }
        for (let end = position + 1; end <= name.length && VARIABLE_CHAR.test(name.charAt(end - 1)); end++) {
            values.set(segment.name, name.slice(position, end));
            walk(index + 1, end);
        }
        values.delete(segment.name);
    };

    walk(0, 0);
    return results;
}

function variableProblems(node: StructureNode, values: Variables, bound: Variables): string[] {
    const problems: string[] = [];
    for (const [name, value] of values) {
        const definition = node.variables?.[name] ?? {};
        const inherited = bound.get(name);

        if (inherited !== undefined && normalize(inherited) !== normalize(value)) {
            problems.push(`{{${name}}} = "${value}" should be the same value as the parent folder ("${inherited}")`);
        }
        if (definition.convention && !CONVENTIONS[definition.convention].test(value)) {
            problems.push(`{{${name}}} = "${value}" does not follow the ${definition.convention} convention`);
        }
        if (definition.regex !== undefined && !new RegExp(definition.regex).test(value)) {
            problems.push(`{{${name}}} = "${value}" does not match the regex ${definition.regex}`);
        }
    }
    return problems;
}

function companionNames(match: NodeMatch): string[] {
    if (match.compiled.node.kind !== 'file') {
        return [];
    }
    return (match.compiled.node.companions ?? []).map((pattern) =>
        parsePattern(pattern)
            .map((segment) => (segment.kind === 'literal' ? segment.value : (match.values.get(segment.name) ?? '')))
            .join(''),
    );
}

/** Values are equal when they have the same letters, ignoring case and the "-" and "_" separators. */
function normalize(value: string): string {
    return value.replace(/[-_]/g, '').toLowerCase();
}

function childPath(parent: string, name: string): string {
    return parent === '.' ? name : `${parent}/${name}`;
}

function label(kind: NodeKind): string {
    return kind === 'folder' ? 'folder' : 'file';
}
