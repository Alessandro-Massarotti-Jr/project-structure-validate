import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateSchema } from '../../src/schema/validateSchema';

const SAMPLES_DIR = resolve(__dirname, '../../docs/samples');
const SCHEMA_FILE = '.project-structure.json';

const samples = readdirSync(SAMPLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

describe('docs/samples schemas', () => {
    it('finds at least one sample', () => {
        expect(samples.length).toBeGreaterThan(0);
    });

    it.each(samples)(`%s/${SCHEMA_FILE} is a valid schema`, (sample) => {
        const content = readFileSync(join(SAMPLES_DIR, sample, SCHEMA_FILE), 'utf8');
        const result = validateSchema(JSON.parse(content.replace(/^\uFEFF/, '')));
        expect(result.valid ? [] : result.issues).toEqual([]);
        expect(result.valid).toBe(true);
    });
});
