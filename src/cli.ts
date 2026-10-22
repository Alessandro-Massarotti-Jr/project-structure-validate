#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { styleText } from 'node:util';
import { validateSchema } from './schema/validateSchema';
import { validateStructure } from './structure/validateStructure';

const DEFAULT_SCHEMA_FILE = '.project-structure.json';

const USAGE = `Usage: project-structure-validate [file]

Checks the schema file and, if it is valid, the project structure.
The folder containing the file is treated as the project root.

  file   Schema file (default: ${DEFAULT_SCHEMA_FILE})`;

const red = (text: string) => styleText('red', text, { stream: process.stderr });
const green = (text: string) => styleText('green', text, { stream: process.stdout });
const dim = (text: string) => styleText('dim', text, { stream: process.stderr });

function printErrors(title: string, lines: readonly string[]): void {
    console.error(red(`✖ ${title}`));
    for (const line of lines) {
        console.error(`  ${red('✖')} ${line}`);
    }
}

function validate(file: string): number {
    const filePath = resolve(file);
    const fileName = basename(filePath);

    let content: string;
    try {
        content = readFileSync(filePath, 'utf8');
    } catch (error) {
        printErrors(`Could not read ${fileName}`, [(error as Error).message]);
        return 1;
    }

    let input: unknown;
    try {
        input = JSON.parse(content.replace(/^﻿/, ''));
    } catch (error) {
        printErrors(`${fileName} is not valid JSON`, [(error as Error).message]);
        return 1;
    }

    const schema = validateSchema(input);
    if (!schema.valid) {
        printErrors(
            `${schema.issues.length} error(s) in schema ${fileName}:`,
            schema.issues.map((issue) => `${issue.path || '/'} ${dim('-')} ${issue.message}`),
        );
        return 1;
    }

    const structure = validateStructure(schema.schema, dirname(filePath), { schemaFileName: fileName });
    if (!structure.valid) {
        printErrors(
            `${structure.violations.length} project structure violation(s):`,
            structure.violations.map((violation) => `${violation.path} ${dim('-')} ${violation.message}`),
        );
        return 1;
    }

    console.log(green(`✔ Project structure matches ${fileName}`));
    return 0;
}

function main(argv: string[]): number {
    const [arg, ...rest] = argv;
    if (arg === '--help' || arg === '-h') {
        console.log(USAGE);
        return 0;
    }
    if (rest.length > 0 || arg?.startsWith('-')) {
        console.error(`Invalid arguments: ${argv.join(' ')}\n\n${USAGE}`);
        return 1;
    }
    return validate(arg ?? DEFAULT_SCHEMA_FILE);
}

process.exitCode = main(process.argv.slice(2));
