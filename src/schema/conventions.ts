export const CONVENTIONS = {
    camelCase: /^[a-z][a-z0-9]*([A-Z][a-z0-9]+)*$/,
    PascalCase: /^([A-Z][a-z0-9]+)+$/,
    snake_case: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
    'kebab-case': /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    SCREAMING_SNAKE_CASE: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
    'SCREAMING-KEBAB-CASE': /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/,
    flatcase: /^[a-z][a-z0-9]*$/,
    SCREAMINGFLATCASE: /^[A-Z][A-Z0-9]*$/,
    'Train-Case': /^[A-Z][a-z0-9]*(-[A-Z][a-z0-9]*)*$/,
} as const satisfies Record<string, RegExp>;

export type Convention = keyof typeof CONVENTIONS;

export function isConvention(value: string): value is Convention {
    return Object.hasOwn(CONVENTIONS, value);
}
