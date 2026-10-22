# 0003

Repository-pattern example: a required `src` folder with `index.ts` and strict `{{name}}Repository` folders holding an interface plus implementations with unit-test companions.

## Example

```json
{
    "version": "1.0.0",
    "ignore": ["node_modules", "dist", ".git"],
    "root": {
        "src": {
            "kind": "folder",
            "required": true,
            "description": "Source code",
            "children": {
                "index.ts": {
                    "kind": "file",
                    "required": true
                },
                "repositories": {
                    "kind": "folder",
                    "children": {
                        "{{name}}Repository": {
                            "kind": "folder",
                            "strict": true,
                            "variables": {
                                "name": { "convention": "camelCase" }
                            },
                            "children": {
                                "I{{name}}Repository.ts": {
                                    "kind": "file",
                                    "required": true,
                                    "variables": {
                                        "name": { "convention": "PascalCase" }
                                    }
                                },
                                "{{implementation}}{{name}}Repository.ts": {
                                    "kind": "file",
                                    "required": true,
                                    "variables": {
                                        "name": { "convention": "PascalCase" },
                                        "implementation": { "convention": "PascalCase" }
                                    },
                                    "companions": [
                                        "{{implementation}}{{name}}Repository.unit.spec.ts"
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

This file accepts the following structure:

```
src/
├── index.ts
└── repositories/
    └── userRepository/
        ├── IUserRepository.ts
        ├── PostgresUserRepository.ts
        ├── PostgresUserRepository.unit.spec.ts
        ├── MongoUserRepository.ts
        └── MongoUserRepository.unit.spec.ts
```
