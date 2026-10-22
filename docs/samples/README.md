# Samples

Complete `.project-structure.json` examples. Each folder has the schema file and a README showing the structure it accepts.

| Sample            | Description                                                                                                                     |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------|
| [0001](0001/)     | A minimal `src` folder with `index.ts` and strict `{{name}}Repository` folders.                                                  |
| [0002](0002/)     | A TypeScript MCP gateway organized as vertical slices (one provider per backend), with unit tests next to the sources, ADRs and Claude Code hooks and skills. |
| [0003](0003/)     | Repository pattern: a required `src` folder with `index.ts` and strict `{{name}}Repository` folders holding an interface plus implementations with unit-test companions. |

To check a project against one of them, copy its `.project-structure.json` to the project root and run:

```sh
npx project-structure-validate
```
