import type { Convention } from './conventions';

export interface VariableDefinition {
    convention?: Convention;
    regex?: string;
}

interface BaseNode {
    description?: string;
    required?: boolean;
    variables?: Record<string, VariableDefinition>;
}

export interface FolderNode extends BaseNode {
    kind: 'folder';
    strict?: boolean;
    children?: Record<string, StructureNode>;
}

export interface FileNode extends BaseNode {
    kind: 'file';
    companions?: string[];
}

export type StructureNode = FolderNode | FileNode;

export interface ProjectStructure {
    version: string;
    ignore?: string[];
    root: Record<string, StructureNode>;
}
