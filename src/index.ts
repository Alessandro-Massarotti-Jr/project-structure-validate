export { CONVENTIONS, isConvention } from './schema/conventions';
export type { Convention } from './schema/conventions';
export { parsePattern, PatternSyntaxError } from './schema/pattern';
export type { PatternSegment } from './schema/pattern';
export type { FileNode, FolderNode, ProjectStructure, StructureNode, VariableDefinition } from './schema/types';
export { SUPPORTED_VERSIONS, validateSchema } from './schema/validateSchema';
export type { SchemaIssue, SchemaValidationResult } from './schema/validateSchema';
export { validateStructure } from './structure/validateStructure';
export type { StructureValidationOptions, StructureValidationResult, StructureViolation } from './structure/validateStructure';
