# project-structure-validate

<p>
  <img src="https://img.shields.io/badge/made%20by-Alessandro%20Massarotti%20Jr-cf7113?style=flat-square">
  <img src="https://img.shields.io/badge/Node.js-24-cf7113?style=flat-square">
  <img alt="GitHub language count" src="https://img.shields.io/github/languages/count/Alessandro-Massarotti-Jr/project-structure-validatey?color=cf7113&style=flat-square">
  <img alt="GitHub Top Language" src="https://img.shields.io/github/languages/top/Alessandro-Massarotti-Jr/project-structure-validatey?color=cf7113&style=flat-square">
</p>


A format for describing a project's folder and file structure in a `.project-structure.json` file, and validating that the real project follows it.

## Samples

See [docs/samples/README.md](docs/samples/README.md) for complete `.project-structure.json` examples, each with the structure it accepts.

## Usage

```sh
# In any project (default file: .project-structure.json)
npx project-structure-validate
npx project-structure-validate .my-file.json

# Inside this repository (builds first)
npm run project-structure-validate
npm run project-structure-validate -- .my-file.json
```

The folder containing the schema file is the project root. The command first checks the schema file itself, then the project's folders and files, and exits with code `1` on any problem.

When the project follows the schema:

```
✔ Project structure matches .project-structure.json
```

When the project breaks a rule, every violation is listed with the item's path:

```
✖ 3 project structure violation(s):
  ✖ src/repositories/userRepository/Teste.ts - file does not match any pattern of the folder
  ✖ src/repositories/userRepository/mocks - folder not declared in .project-structure.json
  ✖ src - required file "index.ts" not found
```

When the schema file itself is invalid, each problem is reported with a [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901) to where it is, and the project is not checked:

```
✖ 2 error(s) in schema .project-structure.json:
  ✖ /root/src/children/{{name}}.ts - variable "{{name}}" is used in the name but not declared in "variables"
  ✖ /root/src/children/{{name}}.ts/strict - only allowed when "kind" is "folder"
```

From code:

```ts
import { validateSchema, validateStructure } from 'project-structure-validate';

const result = validateSchema(JSON.parse(content));
if (!result.valid) {
    console.error(result.issues); // [{ path, message }]
} else {
    const structure = validateStructure(result.schema, projectDir);
    console.error(structure.violations); // [{ path, message }]
}
```

## File fields

| Field     | Type       | Required | Description                                                                 |
|-----------|------------|----------|-----------------------------------------------------------------------------|
| `version` | `string`   | yes      | Version of the file format (not the project's version).                     |
| `ignore`  | `string[]` | no       | Names of folders or files that are never validated. See [Ignore](#ignore).  |
| `root`    | `object`   | yes      | Nodes at the project root. The key is the item's name and the value is a [node](#nodes). |

## Nodes

Each key inside `root` or `children` is the name of a folder or file. The name can be fixed (`index.ts`) or a pattern with [variables](#variables) (`{{name}}Repository`). A name cannot contain `/` or `\`: nested items are declared with `children`.

Fields not listed below are rejected, as are fields that belong to the other `kind` (for example, `children` on a file).

| Field         | Type                 | Required | Applies to | Description                                                                                 |
|---------------|----------------------|----------|------------|---------------------------------------------------------------------------------------------|
| `kind`        | `"folder" \| "file"` | yes      | both       | Whether the item is a folder or a file.                                                     |
| `description` | `string`             | no       | both       | Free text describing the item. Does not affect validation.                                   |
| `required`    | `boolean`            | no       | both       | Whether at least one item matching this node must exist. Default: `false`.                   |
| `variables`   | `object`             | no       | both       | Definition of the variables used in the name. See [Variables](#variables).                   |
| `children`    | `object`             | no       | folder     | Items inside the folder.                                                                     |
| `strict`      | `boolean`            | no       | folder     | Whether undeclared items inside the folder are forbidden. Default: `false`.                  |
| `companions`  | `string[]`           | no       | file       | Files that must exist next to each file matching this node. See [Companions](#companions).  |

## Validation rules

### Undeclared items

An item that matches no node **is not validated**. The exception is when its folder has `strict: true`, in which case the item is an error.

### `required`

- With `required: true`, **at least one** item matching the node must exist inside the parent folder. If none exists, the parent folder is reported as an **invalid directory**, since it lacks the items that justify its existence.
- Without `required` (or with `false`), the item is optional and may not exist.
- The rule is only checked if the parent folder exists. If an optional folder doesn't exist, nothing inside it is enforced.
- When a folder has several children with `required: true`, **each** of them must have at least one item.
- `root` is treated as a folder that always exists. Root nodes follow the same rules: `src` is only required if it has `required: true`.

On a node with a variable, such as `{{implementation}}{{name}}Repository.ts`, `required: true` demands at least one implementation. There can be several.

### `strict`

With `strict: true`, every item inside the folder must match a node in `children` or be a companion of a declared file. Any other item is an error.

`strict` applies **only to the level where it is declared**. Subfolders do not inherit it. To make a subfolder strict too, declare `strict: true` on it.

Items listed in `ignore` are not affected by `strict`.

### Companions

`companions` lists the files that must exist **next to each file** matching the node, in the same folder.

```json
"{{implementation}}{{name}}Repository.ts": {
    "kind": "file",
    "companions": ["{{implementation}}{{name}}Repository.unit.spec.ts"]
}
```

If `PostgresUserRepository.ts` exists, then `PostgresUserRepository.unit.spec.ts` must exist.

- A companion **uses the owner file's variables**, with the same values and the same conventions. It has no `variables` block of its own and cannot use variables the owner doesn't declare.
- A companion counts as a declared item, so it is not an error in a `strict` folder even though it isn't listed in `children`.

### Ignore

Each `ignore` entry is an **exact name** and applies **at any level**. With `"ignore": ["node_modules"]`, every folder or file named `node_modules` is ignored at any depth, along with everything inside it.

Globs are not supported: `*.log` only ignores an item literally named `*.log`.

## Variables

A variable is written in the node's name as `{{name}}` and matches part of the real item's name.

Every variable used in the name **must be declared** in that node's `variables` block. The declaration's fields are optional:

```json
"variables": {
    "name": {
        "convention": "PascalCase",
        "regex": "^[A-Z][a-zA-Z0-9]*$"
    },
    "implementation": {}
}
```

| Field        | Type     | Required | Description                                                                                  |
|--------------|----------|----------|----------------------------------------------------------------------------------------------|
| `convention` | `string` | no       | Naming convention of the value at that node. See [Conventions](#conventions).                |
| `regex`      | `string` | no       | Extra validation, applied **in addition to** the convention, to the value as written at that node. |

Without `convention`, the variable accepts any sequence of letters, digits, `-` and `_`. A variable never matches `.` or `/`.

Rules for variables in a name:

- Variable names use letters, digits and `_`, and don't start with a digit.
- A declared variable must be used in the name, and a variable can appear only once in the same name.
- Adjacent variables, like `{{implementation}}{{name}}`, can't be split unambiguously. They are only allowed when all but one of them already have a value from a parent folder. In the example, `name` comes from the `{{name}}Repository` folder, so only `implementation` is new.

### Same variable at different levels

A variable matched in a folder is **fixed for all its descendants**. If a child uses a variable with the same name, it represents **the same value**, written in the convention declared on the child.

```
userAccountRepository/           name = userAccount  (camelCase)
└── IUserAccountRepository.ts    name = UserAccount  (PascalCase)  ✔ same value
└── IOrderRepository.ts          name = Order        (PascalCase)  ✘ different value
```

Two values are considered equal when they have the same letters, ignoring case and the `-` and `_` separators. `userAccount`, `UserAccount`, `user-account`, `USER_ACCOUNT` and `useraccount` are the same value.

The child redeclares the variable in its own `variables` block, with the convention (and, optionally, the `regex`) that applies there.

### Pattern precedence

A file can match more than one node. `IUserRepository.ts`, for example, matches `I{{name}}Repository.ts` and also `{{implementation}}{{name}}Repository.ts` (with `implementation = I`).

In that case **the most specific node wins**: the one whose name has the most fixed characters (outside variables). The file belongs only to that node and doesn't count toward the others. Here, `I{{name}}Repository.ts` takes the interface.

If two nodes tie, the file is reported as ambiguous.

## Conventions

Accepted values for `convention`:

| Convention             | Rule                                                   | Examples                                         | Common usage                                                     |
|------------------------|--------------------------------------------------------|--------------------------------------------------|------------------------------------------------------------------|
| `camelCase`            | First word lowercase, the rest start with uppercase.   | `userName`, `getUserById`, `isActive`            | Variables, functions and methods in JavaScript/TypeScript.       |
| `PascalCase`           | Every word starts with uppercase.                      | `UserService`, `CreateUserUseCase`, `HttpClient` | Classes, types, interfaces and React components.                 |
| `snake_case`           | Lowercase words separated by `_`.                      | `user_name`, `get_user_by_id`, `created_at`      | Python, Go in some contexts, databases and SQL column names.     |
| `kebab-case`           | Lowercase words separated by `-`.                      | `user-service`, `create-user`, `user-controller` | Files, folders, URLs, routes and package names.                  |
| `SCREAMING_SNAKE_CASE` | All uppercase, separated by `_`.                       | `MAX_RETRIES`, `DATABASE_URL`, `JWT_SECRET`      | Constants and environment variables.                             |
| `SCREAMING-KEBAB-CASE` | All uppercase, separated by `-`.                       | `USER-SERVICE`, `CONTENT-TYPE`                   | Some HTTP headers and specific naming standards.                 |
| `flatcase`             | All words together, lowercase, no separators.          | `username`, `userid`                             | Some identifiers and tool- or protocol-specific names.           |
| `SCREAMINGFLATCASE`    | All words together, uppercase, no separators.          | `USERNAME`, `USERID`                             | Some legacy identifiers and tool-specific names.                 |
| `Train-Case`           | Capitalized words separated by `-`.                    | `User-Service`, `Create-User`                    | Less common; some naming standards and specific contexts.        |

Acronyms are written as regular words: `HttpClient` is `PascalCase`, `HTTPClient` is not.

Expressions used to validate each convention:

| Convention             | Expression                               |
|------------------------|------------------------------------------|
| `camelCase`            | `^[a-z][a-z0-9]*([A-Z][a-z0-9]+)*$`      |
| `PascalCase`           | `^([A-Z][a-z0-9]+)+$`                    |
| `snake_case`           | `^[a-z][a-z0-9]*(_[a-z0-9]+)*$`          |
| `kebab-case`           | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`          |
| `SCREAMING_SNAKE_CASE` | `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`          |
| `SCREAMING-KEBAB-CASE` | `^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$`          |
| `flatcase`             | `^[a-z][a-z0-9]*$`                       |
| `SCREAMINGFLATCASE`    | `^[A-Z][A-Z0-9]*$`                       |
| `Train-Case`           | `^[A-Z][a-z0-9]*(-[A-Z][a-z0-9]*)*$`     |

<br>

---

Developed by [Alessandro Massarotti Jr](https://github.com/Alessandro-Massarotti-Jr) 🤖