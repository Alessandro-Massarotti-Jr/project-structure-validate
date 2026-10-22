export type PatternSegment =
    | { kind: 'literal'; value: string }
    | { kind: 'variable'; name: string };

export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class PatternSyntaxError extends Error {}

/**
 * Splits a node name such as `I{{name}}Repository.ts` into literal and variable segments.
 */
export function parsePattern(pattern: string): PatternSegment[] {
    const segments: PatternSegment[] = [];
    let index = 0;

    while (index < pattern.length) {
        const open = pattern.indexOf('{{', index);
        const literalEnd = open === -1 ? pattern.length : open;

        if (literalEnd > index) {
            const literal = pattern.slice(index, literalEnd);
            if (literal.includes('}}')) {
                throw new PatternSyntaxError('found "}}" without a matching "{{"');
            }
            segments.push({ kind: 'literal', value: literal });
        }

        if (open === -1) {
            break;
        }

        const close = pattern.indexOf('}}', open + 2);
        if (close === -1) {
            throw new PatternSyntaxError('"{{" is never closed with "}}"');
        }

        const name = pattern.slice(open + 2, close);
        if (!VARIABLE_NAME.test(name)) {
            throw new PatternSyntaxError(
                `invalid variable name "${name}"; use letters, digits and "_", not starting with a digit`,
            );
        }

        segments.push({ kind: 'variable', name });
        index = close + 2;
    }

    return segments;
}

export function variableNames(segments: readonly PatternSegment[]): string[] {
    return segments.flatMap((segment) => (segment.kind === 'variable' ? [segment.name] : []));
}
